import * as https from 'https';
import * as url from 'url';
// eslint-disable-next-line import/no-extraneous-dependencies
import { SFN, type StartExecutionInput, type StartExecutionOutput } from '@aws-sdk/client-sfn';

// for unit tests
export const external = {
  sendHttpRequest: defaultSendHttpRequest,
  log: defaultLog,
  includeStackTraces: true,
  userHandlerIndex: './index',
};

const CREATE_FAILED_PHYSICAL_ID_MARKER = 'AWSCDK::CustomResourceProviderFramework::CREATE_FAILED';
const MISSING_PHYSICAL_ID_MARKER = 'AWSCDK::CustomResourceProviderFramework::MISSING_PHYSICAL_ID';

export const COMPLETE_KEY = 'IsComplete';
const WAITING_KEY = 'IsWaiting';
export const WAITER_ARN_ENV_VARIABLE = 'CUSTOM_RESOURCE_WAITER_ARN';
const WAITER_ARN = process.env[WAITER_ARN_ENV_VARIABLE];
const WAITER_ENABLED = !!WAITER_ARN;

export type Response = AWSLambda.CloudFormationCustomResourceEvent & HandlerResponse;
export type Handler = (event: AWSLambda.CloudFormationCustomResourceEvent, context: AWSLambda.Context) => Promise<HandlerResponse | void>;
export type HandlerResponse = undefined | {
  Data?: any;
  PhysicalResourceId?: string;
  Reason?: string;
  NoEcho?: boolean;
};
export type TimeoutEvent = {
  Cause: string
}
export type IsCompleteRequest = AWSLambda.CloudFormationCustomResourceEvent & HandlerResponse & {
  IsWaiting?: boolean
}

class Retry extends Error { }

export async function handler(event: AWSLambda.CloudFormationCustomResourceEvent | IsCompleteRequest | TimeoutEvent, context: AWSLambda.Context) {
  if ('Cause' in event) {
    // Is timeout event
    return onTimeout(event);
  }
  const sanitizedEvent = { ...event, ResponseURL: '...' };
  external.log(JSON.stringify(sanitizedEvent, undefined, 2));

  // ignore DELETE event when the physical resource ID is the marker that
  // indicates that this DELETE is a subsequent DELETE to a failed CREATE
  // operation.
  if (event.RequestType === 'Delete' && event.PhysicalResourceId === CREATE_FAILED_PHYSICAL_ID_MARKER) {
    external.log('ignoring DELETE event caused by a failed CREATE event');
    await submitResponse('SUCCESS', event);
    return;
  }

  try {
    // invoke the user handler. this is intentionally inside the try-catch to
    // ensure that if there is an error it's reported as a failure to
    // cloudformation (otherwise cfn waits).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const userHandler: Handler = require(external.userHandlerIndex).handler;
    const result = await userHandler(sanitizedEvent, context);

    // validate user response and create the combined event
    const responseEvent = renderResponse(event, result);

    // If this is an not async provider based on whether we have a waiter,
    // or if response is marking action complete in case of async handler
    // then we can return a positive response.
    if (!WAITER_ENABLED || (COMPLETE_KEY in responseEvent && responseEvent[COMPLETE_KEY] === true)) {
      // submit to cfn as success
      await submitResponse('SUCCESS', responseEvent);
      return;
    }
    // We explicitly check for Complete field to be false
    // otherwise we might repeatedly invoke (create) event handler when it does
    // not expect to be invoked for complete checking
    if (!(COMPLETE_KEY in responseEvent) || responseEvent[COMPLETE_KEY] !== false) {
      await submitResponse('FAILED', {
        ...responseEvent,
        Reason: 'Async handler implementation failed to explictly mark action with IsComplete',
      });
      return;
    }

    if (!('IsWaiting' in event)) {
      // not yet waiting so kicking off waiter
      const waiter = {
        stateMachineArn: WAITER_ARN,
        name: responseEvent.RequestId,
        input: JSON.stringify({
          ...responseEvent,
          [WAITING_KEY]: true,
        }),
      };
      external.log('starting waiter', waiter);
      // kick off waiter state machine
      await startExecution(waiter);
    } else {
      // Not complete so throw, so waiter will trigger retry.
      // Adding serialized event so timeout task gets event, when retries are exhausted.
      throw new Retry(JSON.stringify(event));
    }
  } catch (e: any) {
    if (e instanceof Retry) {
      throw e;
    }
    const resp: Response = {
      ...event,
      Reason: external.includeStackTraces ? e.stack : e.message,
    };

    if (!resp.PhysicalResourceId) {
      // special case: if CREATE fails, which usually implies, we usually don't
      // have a physical resource id. in this case, the subsequent DELETE
      // operation does not have any meaning, and will likely fail as well. to
      // address this, we use a marker so the provider framework can simply
      // ignore the subsequent DELETE.
      if (event.RequestType === 'Create') {
        external.log('CREATE failed, responding with a marker physical resource id so that the subsequent DELETE will be ignored');
        resp.PhysicalResourceId = CREATE_FAILED_PHYSICAL_ID_MARKER;
      } else {
        // otherwise, if PhysicalResourceId is not specified, something is
        // terribly wrong because all other events should have an ID.
        external.log(`ERROR: Malformed event. "PhysicalResourceId" is required: ${JSON.stringify(event)}`);
      }
    }

    // this is an actual error, fail the activity altogether and exist.
    await submitResponse('FAILED', resp);
  }
}

let sfn: SFN;
async function startExecution(req: StartExecutionInput): Promise<StartExecutionOutput> {
  if (!sfn) {
    sfn = new SFN({});
  }

  return sfn.startExecution(req);
}

// invoked when completion retries are exhausted.
async function onTimeout(timeoutEvent: any) {
  external.log('timeoutHandler', timeoutEvent);
  const completeRequest = JSON.parse(JSON.parse(timeoutEvent.Cause).errorMessage) as IsCompleteRequest;
  await submitResponse('FAILED', { ...completeRequest, Reason: 'Operation timed out' });
}

function renderResponse(
  cfnRequest: AWSLambda.CloudFormationCustomResourceEvent & { PhysicalResourceId?: string },
  handlerResponse: void | HandlerResponse = { }): Response {

  // if physical ID is not returned, we have some defaults for you based
  // on the request type.
  const physicalResourceId = handlerResponse.PhysicalResourceId ?? cfnRequest.PhysicalResourceId ?? cfnRequest.RequestId;

  // if we are in DELETE and physical ID was changed, it's an error.
  if (cfnRequest.RequestType === 'Delete' && physicalResourceId !== cfnRequest.PhysicalResourceId) {
    throw new Error(`DELETE: cannot change the physical resource ID from "${cfnRequest.PhysicalResourceId}" to "${handlerResponse.PhysicalResourceId}" during deletion`);
  }

  // merge request event and result event (result prevails).
  return {
    ...cfnRequest,
    ...handlerResponse,
    PhysicalResourceId: physicalResourceId,
  };
}

async function submitResponse(status: 'SUCCESS' | 'FAILED', event: Response) {
  const json: AWSLambda.CloudFormationCustomResourceResponse = {
    Status: status,
    Reason: event.Reason ?? status,
    StackId: event.StackId,
    RequestId: event.RequestId,
    PhysicalResourceId: event.PhysicalResourceId || MISSING_PHYSICAL_ID_MARKER,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: event.NoEcho,
    Data: event.Data,
  };

  external.log('submit response to cloudformation', json);

  const responseBody = JSON.stringify(json);
  const parsedUrl = url.parse(event.ResponseURL);
  const req = {
    hostname: parsedUrl.hostname,
    path: parsedUrl.path,
    method: 'PUT',
    headers: {
      'content-type': '',
      'content-length': Buffer.byteLength(responseBody, 'utf8'),
    },
  };

  const retryOptions = {
    attempts: 5,
    sleep: 1000,
  };
  await withRetries(retryOptions, external.sendHttpRequest)(req, responseBody);
}

async function defaultSendHttpRequest(options: https.RequestOptions, responseBody: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const request = https.request(options, _ => resolve());
      request.on('error', reject);
      request.write(responseBody);
      request.end();
    } catch (e) {
      reject(e);
    }
  });
}

function defaultLog(fmt: string, ...params: any[]) {
  // eslint-disable-next-line no-console
  console.log(fmt, ...params);
}

export interface RetryOptions {
  /** How many retries (will at least try once) */
  readonly attempts: number;
  /** Sleep base, in ms */
  readonly sleep: number;
}

export function withRetries<A extends Array<any>, B>(options: RetryOptions, fn: (...xs: A) => Promise<B>): (...xs: A) => Promise<B> {
  return async (...xs: A) => {
    let attempts = options.attempts;
    let ms = options.sleep;
    while (true) {
      try {
        return await fn(...xs);
      } catch (e) {
        if (attempts-- <= 0) {
          throw e;
        }
        await sleep(Math.floor(Math.random() * ms));
        ms *= 2;
      }
    }
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((ok) => setTimeout(ok, ms));
}
