import * as path from 'path';
import { Construct } from 'constructs';
import * as fs from 'fs-extra';
import { WAITER_ARN_ENV_VARIABLE } from './nodejs-entrypoint';
import * as cxapi from '../../../cx-api';
import { Annotations } from '../annotations';
import { AssetStaging } from '../asset-staging';
import { FileAssetPackaging } from '../assets';
import { CfnResource } from '../cfn-resource';
import { Duration } from '../duration';
import { FileSystem } from '../fs';
import { PolicySynthesizer, getPrecreatedRoleConfig } from '../helpers-internal';
import { Lazy } from '../lazy';
import { makeUniqueResourceName } from '../private/unique-resource-name';
import { Size } from '../size';
import { Stack } from '../stack';
import { Token } from '../token';

const ENTRYPOINT_FILENAME = '__entrypoint__';
const ENTRYPOINT_NODEJS_SOURCE = path.join(__dirname, 'nodejs-entrypoint.js');
export const INLINE_CUSTOM_RESOURCE_CONTEXT = '@aws-cdk/core:inlineCustomResourceIfPossible';

/**
 * Log Options for the state machine.
 */
export interface CustomResourceWaiterLogOptions {
  /**
   * Determines whether execution data is included in your log.
   *
   * @default false
   */
  readonly includeExecutionData?: boolean;

  /**
   * Defines which category of execution history events are logged.
   *
   * @default ERROR
   */
  readonly level?: 'OFF' | 'ALL' | 'ERROR' | 'FATAL';

  /**
   * The number of days to retain the log events in the specified log group.
   * @default 60 days
   */
  readonly retention?: Duration
}

/**
 * Initialization properties for `CustomResourceProvider`.
 *
 */
export interface CustomResourceProviderProps {
  /**
   * Whether or not the cloudformation response wrapper (`nodejs-entrypoint.ts`) is used.
   * If set to `true`, `nodejs-entrypoint.js` is bundled in the same asset as the custom resource
   * and set as the entrypoint. If set to `false`, the custom resource provided is the
   * entrypoint.
   *
   * @default - `true` if `inlineCode: false` and `false` otherwise.
   */
  readonly useCfnResponseWrapper?: boolean;

  /**
   * A local file system directory with the provider's code. The code will be
   * bundled into a zip asset and wired to the provider's AWS Lambda function.
   */
  readonly codeDirectory: string;

  /**
   * The AWS Lambda runtime and version to use for the provider.
   */
  readonly runtime: CustomResourceProviderRuntime;

  /**
   * A set of IAM policy statements to include in the inline policy of the
   * provider's lambda function.
   *
   * **Please note**: these are direct IAM JSON policy blobs, *not* `iam.PolicyStatement`
   * objects like you will see in the rest of the CDK.
   *
   * @default - no additional inline policy
   *
   * @example
   * const provider = CustomResourceProvider.getOrCreateProvider(this, 'Custom::MyCustomResourceType', {
   *   codeDirectory: `${__dirname}/my-handler`,
   *   runtime: CustomResourceProviderRuntime.NODEJS_18_X,
   *   policyStatements: [
   *     {
   *       Effect: 'Allow',
   *       Action: 's3:PutObject*',
   *       Resource: '*',
   *     }
   *   ],
   * });
   */
  readonly policyStatements?: any[];

  /**
   * AWS Lambda timeout for the provider.
   *
   * @default Duration.minutes(15)
   */
  readonly timeout?: Duration;

  /**
   * The amount of memory that your function has access to. Increasing the
   * function's memory also increases its CPU allocation.
   *
   * @default Size.mebibytes(128)
   */
  readonly memorySize?: Size;

  /**
   * Key-value pairs that are passed to Lambda as Environment
   *
   * @default - No environment variables.
   */
  readonly environment?: { [key: string]: string };

  /**
   * A description of the function.
   *
   * @default - No description.
   */
  readonly description?: string;

  /**
   * Whether handler might not handle all operations completely in first invocation
   *
   * When `true` creates state machine to periodically check if operation is completed
   * by re-invoking the handler with original event with additional fields,
   * IsWaiting=true and IsComplete=false, until IsComplete is returned `true` or retries
   * are exhausted.
   *
   * @default - provider is synchronous. This means that the handler
   * is expected to finish all lifecycle operations within the initial invocation.
   */
  readonly handleAsync?: boolean;

  /**
   * In case of async handler the total timeout to indicate how long the
   * waiter will wait. Has no effect for non async handler. Can exceed 15 min,
   * and be max 1 hour.
   *
   * NOTE: Must be multiple of query interval
   * @default - 30 min
   */
  readonly waiterTotalTimeout?: Duration

  /**
   * In case of async handler the interval for the interval the resource action
   * is checked to be completed. Has no effect for non async handler.
   *
   * NOTE: Must integrally divide totalTimeout
   * @default - 30 seconds
   */
  readonly waiterQueryInterval?: Duration

  /**
   * Log options for Loggroup used for logging of waiter in case handler is async.
   *
   * @default - no log options
   */
  readonly waiterLogOptions?: CustomResourceWaiterLogOptions;

  /**
   * Disable waiter state machine logs
   * @default false
   */
  readonly disableWaiterLogs?: boolean
}

/**
 * The lambda runtime to use for the resource provider. This also indicates
 * which language is used for the handler.
 */
export enum CustomResourceProviderRuntime {
  /**
   * Node.js 12.x
   * @deprecated Use latest version
   */
  NODEJS_12_X = 'nodejs12.x',

  /**
   * Node.js 12.x
   * @deprecated Use latest version
   */
  NODEJS_12 = 'deprecated_nodejs12.x',

  /**
   * Node.js 14.x
   * @deprecated Use latest version
   */
  NODEJS_14_X = 'nodejs14.x',

  /**
   * Node.js 16.x
   */
  NODEJS_16_X = 'nodejs16.x',

  /**
   * Node.js 18.x
   */
  NODEJS_18_X = 'nodejs18.x',
}

/**
 * An AWS-Lambda backed custom resource provider, for CDK Construct Library constructs
 *
 * This is a provider for `CustomResource` constructs, backed by an AWS Lambda
 * Function. It only supports NodeJS runtimes.
 *
 * > **Application builders do not need to use this provider type**. This is not
 * > a generic custom resource provider class. It is specifically
 * > intended to be used only by constructs in the AWS CDK Construct Library, and
 * > only exists here because of reverse dependency issues (for example, it cannot
 * > use `iam.PolicyStatement` objects, since the `iam` library already depends on
 * > the CDK `core` library and we cannot have cyclic dependencies).
 *
 * If you are not writing constructs for the AWS Construct Library, you should
 * use the `Provider` class in the `custom-resources` module instead, which has
 * a better API and supports all Lambda runtimes, not just Node.
 *
 * N.B.: When you are writing Custom Resource Providers, there are a number of
 * lifecycle events you have to pay attention to. These are documented in the
 * README of the `custom-resources` module. Be sure to give the documentation
 * in that module a read, regardless of whether you end up using the Provider
 * class in there or this one.
 */
export class CustomResourceProvider extends Construct {
  /**
   * Returns a stack-level singleton ARN (service token) for the custom resource
   * provider.
   *
   * @param scope Construct scope
   * @param uniqueid A globally unique id that will be used for the stack-level
   * construct.
   * @param props Provider properties which will only be applied when the
   * provider is first created.
   * @returns the service token of the custom resource provider, which should be
   * used when defining a `CustomResource`.
   */
  public static getOrCreate(scope: Construct, uniqueid: string, props: CustomResourceProviderProps) {
    return this.getOrCreateProvider(scope, uniqueid, props).serviceToken;
  }

  /**
   * Returns a stack-level singleton for the custom resource provider.
   *
   * @param scope Construct scope
   * @param uniqueid A globally unique id that will be used for the stack-level
   * construct.
   * @param props Provider properties which will only be applied when the
   * provider is first created.
   * @returns the service token of the custom resource provider, which should be
   * used when defining a `CustomResource`.
   */
  public static getOrCreateProvider(scope: Construct, uniqueid: string, props: CustomResourceProviderProps) {
    const id = `${uniqueid}CustomResourceProvider`;
    const stack = Stack.of(scope);
    const provider = stack.node.tryFindChild(id) as CustomResourceProvider
      ?? new CustomResourceProvider(stack, id, props);

    return provider;
  }

  /**
   * The ARN of the provider's AWS Lambda function which should be used as the
   * `serviceToken` when defining a custom resource.
   *
   * @example
   * declare const myProvider: CustomResourceProvider;
   *
   * new CustomResource(this, 'MyCustomResource', {
   *   serviceToken: myProvider.serviceToken,
   *   properties: {
   *     myPropertyOne: 'one',
   *     myPropertyTwo: 'two',
   *   },
   * });
   */
  public readonly serviceToken: string;

  /**
   * The ARN of the provider's AWS Lambda function role.
   */
  public readonly roleArn: string;

  /**
   * The hash of the lambda code backing this provider. Can be used to trigger updates
   * on code changes, even when the properties of a custom resource remain unchanged.
   */
  public get codeHash(): string {
    if (!this._codeHash) {
      throw new Error('This custom resource uses inlineCode: true and does not have a codeHash');
    }
    return this._codeHash;
  }

  private _codeHash?: string;

  private policyStatements?: any[];
  private _role?: CfnResource;

  protected constructor(scope: Construct, id: string, props: CustomResourceProviderProps) {
    super(scope, id);

    if (props.handleAsync &&
      (props.waiterLogOptions || props.waiterTotalTimeout || props.waiterQueryInterval || 'disableWaiterLogs' in props)
    ) {
      Annotations.of(this).addWarning(
        'waiterLogOptions,waiterTotalTimeout, waiterQueryInterval and/or disableWaiterLogs can only be specified when handleAsync=True',
      );
    }

    const stack = Stack.of(scope);

    // verify we have an index file there
    if (!fs.existsSync(path.join(props.codeDirectory, 'index.js'))) {
      throw new Error(`cannot find ${props.codeDirectory}/index.js`);
    }

    const { code, codeHandler, metadata } = this.createCodePropAndMetadata(props, stack);

    if (props.policyStatements) {
      for (const statement of props.policyStatements) {
        this.addToRolePolicy(statement);
      }
    }

    const config = getPrecreatedRoleConfig(this, `${this.node.path}/Role`);
    type AssumePolicyStatement = {
      Action: string,
      Effect: 'Allow'| 'Deny',
      Principal: {Service: string},
      Condition?: Record<string, Record<string, string>>
    }
    const assumeRolePolicyDoc: AssumePolicyStatement[] = [
      { Action: 'sts:AssumeRole', Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' } },
    ];
    const managedPolicyArn = 'arn:${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole';

    let handlerName: string | undefined;
    let handlerArn: string | undefined;
    let waiterName: string | undefined;
    let waiterArn: string | undefined;
    let waiterDefinition: string | undefined;
    if (props.handleAsync) {
      handlerName = makeUniqueResourceName([stack.stackName, id, 'Handler'], { maxLength: 128 });
      handlerArn = `arn:${stack.partition}:lambda:${stack.region}:${stack.account}:function:${handlerName}`;
      waiterName = makeUniqueResourceName([stack.stackName, id, 'Waiter'], { maxLength: 128 });
      waiterArn = `arn:${stack.partition}:states:${stack.region}:${stack.account}:stateMachine:${waiterName}`;
      assumeRolePolicyDoc.push( {
        Action: 'sts:AssumeRole',
        Effect: 'Allow',
        Principal: { Service: 'states.amazonaws.com' },
        Condition: {
          ArnLike: {
            'aws:SourceArn': waiterArn,
          },
          StringEquals: {
            'aws:SourceAccount': stack.account,
          },
        },
      });
      this.addToRolePolicy(
        {
          Effect: 'Allow',
          Action: ['states:StartExecution'],
          Resource: [waiterArn],
        },
      );
      this.addToRolePolicy(
        {
          Effect: 'Allow',
          Action: ['lambda:InvokeFunction'],
          Resource: [handlerArn],
        },
      );
      waiterDefinition = this.createWaiterDefinition(handlerArn, props.waiterTotalTimeout, props.waiterQueryInterval);
    }

    // need to initialize this attribute, but there should never be an instance
    // where config.enabled=true && config.preventSynthesis=true
    this.roleArn = '';
    if (config.enabled) {
      // gives policyStatements a chance to resolve
      this.node.addValidation({
        validate: () => {
          PolicySynthesizer.getOrCreate(this).addRole(`${this.node.path}/Role`, {
            missing: !config.precreatedRoleName,
            roleName: config.precreatedRoleName ?? id+'Role',
            managedPolicies: [{ managedPolicyArn: managedPolicyArn }],
            policyStatements: this.policyStatements ?? [],
            assumeRolePolicy: assumeRolePolicyDoc as any,
          });
          return [];
        },
      });
      this.roleArn = Stack.of(this).formatArn({
        region: '',
        service: 'iam',
        resource: 'role',
        resourceName: config.precreatedRoleName,
      });
    }
    if (!config.preventSynthesis) {
      this._role = new CfnResource(this, 'Role', {
        type: 'AWS::IAM::Role',
        properties: {
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: assumeRolePolicyDoc,
          },
          ManagedPolicyArns: [
            { 'Fn::Sub': managedPolicyArn },
          ],
          Policies: Lazy.any({ produce: () => this.renderPolicies() }),
        },
      });
      this.roleArn = Token.asString(this._role.getAtt('Arn'));
    }

    const timeout = props.timeout ?? Duration.minutes(15);
    const memory = props.memorySize ?? Size.mebibytes(128);

    const handler = new CfnResource(this, 'Handler', {
      type: 'AWS::Lambda::Function',
      properties: {
        FunctionName: handlerName,
        Code: code,
        Timeout: timeout.toSeconds(),
        MemorySize: memory.toMebibytes(),
        Handler: codeHandler,
        Role: this.roleArn,
        Runtime: customResourceProviderRuntimeToString(props.runtime),
        Environment: this.renderEnvironmentVariables({
          ...props.environment,
          ...(waiterArn && { [WAITER_ARN_ENV_VARIABLE]: waiterArn }),
        }),
        Description: props.description ?? undefined,
      },
    });

    if (this._role) {
      handler.addDependency(this._role);
    }

    if (metadata) {
      Object.entries(metadata).forEach(([k, v]) => handler.addMetadata(k, v));
    }
    if (waiterDefinition) {
      let waiterLoggingConfiguration;
      if (!props.disableWaiterLogs) {
        const waiterLogGroup = new CfnResource(this, 'WaiterLogs', {
          type: 'AWS::Logs::LogGroup',
          properties: {
            LogGroupName: `/cdk/custom-resource/waiter/${waiterName}`,
            RetentionDays: (props.waiterLogOptions?.retention ?? Duration.days(60)).toDays(),
          },
        });
        waiterLoggingConfiguration = {
          Destinations: [
            {
              CloudWatchLogsLogGroup: waiterLogGroup,
              IncludeExecutionData: props.waiterLogOptions?.includeExecutionData ?? false,
              Level: props.waiterLogOptions?.level ?? 'ERROR',
            },
          ],
        };
      }
      const waiter = new CfnResource(this, 'Waiter', {
        type: 'AWS::StepFunctions::StateMachine',
        properties: {
          StateMachineName: waiterName,
          DefinitionString: waiterDefinition,
          RoleArn: this.roleArn,
          LoggingConfiguration: waiterLoggingConfiguration,
        },
      });

      waiter.addDependency(handler);
      if (this._role) {
        waiter.addDependency(this._role);
      }
    }

    this.serviceToken = Token.asString(handler.getAtt('Arn'));
  }

  /**
   * Returns the code property for the custom resource as well as any metadata.
   * If the code is to be uploaded as an asset, the asset gets created in this function.
   */
  private createCodePropAndMetadata(props: CustomResourceProviderProps, stack: Stack): {
    code: Code,
    codeHandler: string,
    metadata?: {[key: string]: string},
  } {
    let codeHandler = 'index.handler';
    const inlineCode = this.node.tryGetContext(INLINE_CUSTOM_RESOURCE_CONTEXT);
    if (!inlineCode) {
      const stagingDirectory = FileSystem.mkdtemp('cdk-custom-resource');
      fs.copySync(props.codeDirectory, stagingDirectory, { filter: (src, _dest) => !src.endsWith('.ts') });

      if (props.useCfnResponseWrapper ?? true) {
        fs.copyFileSync(ENTRYPOINT_NODEJS_SOURCE, path.join(stagingDirectory, `${ENTRYPOINT_FILENAME}.js`));
        codeHandler = `${ENTRYPOINT_FILENAME}.handler`;
      }

      const staging = new AssetStaging(this, 'Staging', {
        sourcePath: stagingDirectory,
      });

      const assetFileName = staging.relativeStagedPath(stack);

      const asset = stack.synthesizer.addFileAsset({
        fileName: assetFileName,
        sourceHash: staging.assetHash,
        packaging: FileAssetPackaging.ZIP_DIRECTORY,
      });

      this._codeHash = staging.assetHash;

      return {
        code: {
          S3Bucket: asset.bucketName,
          S3Key: asset.objectKey,
        },
        codeHandler,
        metadata: this.node.tryGetContext(cxapi.ASSET_RESOURCE_METADATA_ENABLED_CONTEXT) ? {
          [cxapi.ASSET_RESOURCE_METADATA_PATH_KEY]: assetFileName,
          [cxapi.ASSET_RESOURCE_METADATA_PROPERTY_KEY]: 'Code',
        } : undefined,
      };
    }

    return {
      code: {
        ZipFile: fs.readFileSync(path.join(props.codeDirectory, 'index.js'), 'utf-8'),
      },
      codeHandler,
    };
  }

  /**
   * Add an IAM policy statement to the inline policy of the
   * provider's lambda function's role.
   *
   * **Please note**: this is a direct IAM JSON policy blob, *not* a `iam.PolicyStatement`
   * object like you will see in the rest of the CDK.
   *
   *
   * @example
   * declare const myProvider: CustomResourceProvider;
   *
   * myProvider.addToRolePolicy({
   *   Effect: 'Allow',
   *   Action: 's3:GetObject',
   *   Resource: '*',
   * });
   */
  public addToRolePolicy(statement: any): void {
    if (!this.policyStatements) {
      this.policyStatements = [];
    }
    this.policyStatements.push(statement);
  }

  private renderPolicies() {
    if (!this.policyStatements) {
      return undefined;
    }

    const policies = [{
      PolicyName: 'Inline',
      PolicyDocument: {
        Version: '2012-10-17',
        Statement: this.policyStatements,
      },
    }];

    return policies;
  }

  private renderEnvironmentVariables(env?: { [key: string]: string }) {
    if (!env || Object.keys(env).length === 0) {
      return undefined;
    }

    env = { ...env }; // Copy

    // Always use regional endpoints
    env.AWS_STS_REGIONAL_ENDPOINTS = 'regional';

    // Sort environment so the hash of the function used to create
    // `currentVersion` is not affected by key order (this is how lambda does
    // it)
    const variables: { [key: string]: string } = {};
    const keys = Object.keys(env).sort();

    for (const key of keys) {
      variables[key] = env[key];
    }

    return { Variables: variables };
  }

  private createWaiterDefinition(handlerArn: string, totalTimeout?: Duration, queryInterval?: Duration ) {
    const retry = calculateRetryPolicy({ totalTimeout, queryInterval });
    return Stack.of(this).toJsonString({
      StartAt: 'isComplete-task',
      States: {
        'isComplete-task': {
          End: true,
          Retry: [{
            ErrorEquals: ['States.ALL'],
            IntervalSeconds: retry.interval,
            MaxAttempts: retry.maxAttempts,
            BackoffRate: retry.backoffRate,
          }],
          Catch: [{
            ErrorEquals: ['States.ALL'],
            Next: 'onTimeout-task',
          }],
          Type: 'Task',
          Resource: handlerArn,
        },
        'onTimeout-task': {
          End: true,
          Type: 'Task',
          Resource: handlerArn,
        },
      },
    });
  }
}

function customResourceProviderRuntimeToString(x: CustomResourceProviderRuntime): string {
  switch (x) {
    case CustomResourceProviderRuntime.NODEJS_12:
    case CustomResourceProviderRuntime.NODEJS_12_X:
      return 'nodejs12.x';
    case CustomResourceProviderRuntime.NODEJS_14_X:
      return 'nodejs14.x';
    case CustomResourceProviderRuntime.NODEJS_16_X:
      return 'nodejs16.x';
    case CustomResourceProviderRuntime.NODEJS_18_X:
      return 'nodejs18.x';
  }
}

type Code = {
  ZipFile: string,
} | {
  S3Bucket: string,
  S3Key: string,
};

const DEFAULT_TIMEOUT = Duration.minutes(30);
const DEFAULT_INTERVAL = Duration.seconds(30);

function calculateRetryPolicy(props: { totalTimeout?: Duration, queryInterval?: Duration } = { }) {
  const totalTimeout = props.totalTimeout || DEFAULT_TIMEOUT;
  const interval = props.queryInterval || DEFAULT_INTERVAL;
  const maxAttempts = totalTimeout.toSeconds() / interval.toSeconds();

  if (Math.round(maxAttempts) !== maxAttempts) {
    throw new Error(`Cannot determine retry count since totalTimeout=${totalTimeout.toSeconds()}s is not integrally dividable by queryInterval=${interval.toSeconds()}s`);
  }

  return {
    maxAttempts,
    interval,
    backoffRate: 1,
  };
}
