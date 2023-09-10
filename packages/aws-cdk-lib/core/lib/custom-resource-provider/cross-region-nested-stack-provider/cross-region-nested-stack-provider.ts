import * as path from 'path';
import { Construct } from 'constructs';
import { CfnResource, TagType } from '../../cfn-resource';
import { CfnStackProps } from '../../cloudformation.generated';
import { CustomResource } from '../../custom-resource';
import { Lazy } from '../../lazy';
import { IResolvable } from '../../resolvable';
import { Stack } from '../../stack';
import { ITaggable, TagManager } from '../../tag-manager';
import { IInspectable, TreeInspector } from '../../tree';
import { CustomResourceProvider, CustomResourceProviderRuntime } from '../custom-resource-provider';

const CROSS_REGION_NESTED_STACK_RESOURCE_TYPE = 'Custom::AWSCDKCrossRegionNestedStack';

/**
 * Properties for an CrossRegionNestedStack
 */
export interface CrossRegionNestedStackProps extends CfnStackProps {
  /**
   * Region to deploy stack in
   */
  targetRegion: string
}

/**
 * Creates a custom resource that will return a list of stack imports from a given
 * The export can then be referenced by the export name.
 *
 * @internal - this is intentionally not exported from core
 */
export class CrossRegionNestedStack extends CustomResource implements ITaggable, IInspectable {
  private properties: {
    TemplateURL: string;
    TargetRegion: string;
    Parameters: IResolvable | Record<string, string> | undefined;
    Tags: string[];
    TimeoutInMinutes: number | undefined;
    NotificationARNs: string[] | undefined;
  };

  public readonly attrId: string;
  public notificationArns?: string[] | undefined;
  public parameters?: IResolvable | Record<string, string> | undefined;
  public readonly tags: TagManager;
  public readonly templateUrl: string;
  public timeoutInMinutes?: number | undefined;
  public cfnResource: CfnResource;

  constructor(scope: Construct, id: string, props: CrossRegionNestedStackProps) {
    if (!props.templateUrl) {
      throw new Error('templateUrl property is required.');
    }
    const tags = new TagManager(TagType.STANDARD, CROSS_REGION_NESTED_STACK_RESOURCE_TYPE, props.tags);
    const properties = {
      NotificationARNs: props.notificationArns,
      Parameters: props.parameters,
      Tags: Lazy.list({ produce: () => this.tags.renderTags() }),
      TemplateURL: props.templateUrl,
      TimeoutInMinutes: props.timeoutInMinutes,
      TargetRegion: props.targetRegion,
    };
    // Should we pass top level scope to always create this in top level stack?
    const serviceToken = CustomResourceProvider.getOrCreate(scope, CROSS_REGION_NESTED_STACK_RESOURCE_TYPE, {
      codeDirectory: path.join(__dirname, 'handler'),
      runtime: CustomResourceProviderRuntime.NODEJS_18_X,
      policyStatements: [{
        Effect: 'Allow',
        Resource: '*',
        Action: [
          'cloudformation:ListResources',
          'cloudformation:DeleteResource',
          'cloudformation:CancelResourceRequest',
          'cloudformation:GetResource',
          'cloudformation:UpdateResource',
          'cloudformation:GetResourceRequestStatus',
          'cloudformation:ListResourceRequests',
          'cloudformation:CreateResource',
        ],
      },
      {
        Effect: 'Allow',
        Resource: '*',
        Action: [
          'cloudformation:DescribeStacks',
          'cloudformation:GetStackPolicy',
          'cloudformation:ListStacks',
        ],
      },
      {
        Effect: 'Allow',
        Resource: Stack.of(scope).formatArn({
          service: 'iam',
          resource: 'role',
          resourceName: '*',
        }),
        Action: [
          'iam:PassRole',
        ],
      }],
    });

    super(scope, id, { serviceToken: serviceToken, properties, resourceType: CROSS_REGION_NESTED_STACK_RESOURCE_TYPE });
    this.tags = tags;
    this.properties = properties;
    this.attrId = this.ref;
    this.notificationArns = props.notificationArns;
    this.parameters = props.parameters;
    this.templateUrl = props.templateUrl;
    this.timeoutInMinutes = props.timeoutInMinutes;
    this.cfnResource = this.node.defaultChild as CfnResource;
  }

  public inspect(inspector: TreeInspector): void {
    inspector.addAttribute('aws:cdk:cloudformation:type', CROSS_REGION_NESTED_STACK_RESOURCE_TYPE);
    inspector.addAttribute('aws:cdk:cloudformation:props', this.properties);
  }
}
