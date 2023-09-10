import * as path from 'path';
import { Construct } from 'constructs';
import { readFileSync } from 'fs-extra';
import { toCloudFormation } from './util';
import {
  Stack, NestedStack, CfnStack, Resource, CfnResource, App, CfnOutput,
} from '../lib';

describe('nested-stack', () => {
  test('a nested-stack has a defaultChild', () => {
    const stack = new Stack();
    var nestedStack = new NestedStack(stack, 'MyNestedStack');
    var cfn_nestedStack = (nestedStack.node.defaultChild) as CfnStack;
    cfn_nestedStack.addPropertyOverride('TemplateURL', 'http://my-url.com');
    expect(toCloudFormation(stack)).toEqual({
      Resources: {
        MyNestedStackNestedStackMyNestedStackNestedStackResource9C617903: {
          DeletionPolicy: 'Delete',
          Properties: {
            TemplateURL: 'http://my-url.com',
          },
          Type: 'AWS::CloudFormation::Stack',
          UpdateReplacePolicy: 'Delete',
        },
      },
    });
  });
  test('a nested-stack has a description in templateOptions.', () => {
    const description = 'This is a description.';
    const stack = new Stack();
    var nestedStack = new NestedStack(stack, 'MyNestedStack', {
      description,
    });

    expect(nestedStack.templateOptions.description).toEqual(description);
  });

  test('can create cross region references when crossRegionReferences=true', () => {
    // GIVEN
    const app = new App();
    const stack1 = new Stack(app, 'Stack1', {
      env: {
        account: '123456789012',
        region: 'bermuda-triangle-1337',
      },
      crossRegionReferences: true,
    });
    const stack2 = new Stack(app, 'Stack2', {
      env: {
        account: '123456789012',
        region: 'bermuda-triangle-42',
      },
      crossRegionReferences: true,
    });
    const nestedStack = new NestedStack(stack1, 'Nested1');
    const nestedStack2 = new NestedStack(stack2, 'Nested2');

    // WHEN
    const myResource = new MyResource(nestedStack, 'Resource1');

    new CfnResource(nestedStack2, 'Resource2', {
      type: 'My::Resource',
      properties: {
        Prop1: myResource.name,
      },
    });

    // THEN
    const assembly = app.synth();
    const nestedTemplate2 = JSON.parse(readFileSync(path.join(assembly.directory, `${nestedStack2.artifactId}.nested.template.json`), 'utf8'));
    expect(nestedTemplate2).toMatchObject({
      Resources: {
        Resource2: {
          Properties: {
            Prop1: {
              Ref: 'referencetoStack2ExportsReader861D07DCcdkexportsStack2Stack1bermudatriangle1337FnGetAttNested1NestedStackNested1NestedStackResourceCD0AD36BOutputsStack1Nested1Resource178AEB067RefCEEE331E',
            },
          },
          Type: 'My::Resource',
        },
      },
    });
    const template2 = assembly.getStackByName(stack2.stackName).template;
    expect(template2?.Resources).toMatchObject({
      ExportsReader8B249524: {
        DeletionPolicy: 'Delete',
        Properties: {
          ReaderProps: {
            imports: {
              '/cdk/exports/Stack2/Stack1bermudatriangle1337FnGetAttNested1NestedStackNested1NestedStackResourceCD0AD36BOutputsStack1Nested1Resource178AEB067RefCEEE331E': '{{resolve:ssm:/cdk/exports/Stack2/Stack1bermudatriangle1337FnGetAttNested1NestedStackNested1NestedStackResourceCD0AD36BOutputsStack1Nested1Resource178AEB067RefCEEE331E}}',
            },
            region: 'bermuda-triangle-42',
            prefix: 'Stack2',
          },
          ServiceToken: {
            'Fn::GetAtt': [
              'CustomCrossRegionExportReaderCustomResourceProviderHandler46647B68',
              'Arn',
            ],
          },
        },
        Type: 'Custom::CrossRegionExportReader',
        UpdateReplacePolicy: 'Delete',
      },
    });
    const template1 = assembly.getStackByName(stack1.stackName).template;
    const nestedTemplate1 = JSON.parse(readFileSync(path.join(assembly.directory, `${nestedStack.artifactId}.nested.template.json`), 'utf8'));
    expect(nestedTemplate1?.Outputs).toEqual({
      Stack1Nested1Resource178AEB067Ref: {
        Value: {
          Ref: 'Resource1CCD41AB7',
        },
      },
    });

    expect(template1?.Resources).toMatchObject({
      ExportsWriterbermudatriangle42E59594276156AC73: {
        DeletionPolicy: 'Delete',
        Properties: {
          WriterProps: {
            exports: {
              '/cdk/exports/Stack2/Stack1bermudatriangle1337FnGetAttNested1NestedStackNested1NestedStackResourceCD0AD36BOutputsStack1Nested1Resource178AEB067RefCEEE331E': {
                'Fn::GetAtt': [
                  'Nested1NestedStackNested1NestedStackResourceCD0AD36B',
                  'Outputs.Stack1Nested1Resource178AEB067Ref',
                ],
              },
            },
            region: 'bermuda-triangle-42',
          },
          ServiceToken: {
            'Fn::GetAtt': [
              'CustomCrossRegionExportWriterCustomResourceProviderHandlerD8786E8A',
              'Arn',
            ],
          },
        },
        Type: 'Custom::CrossRegionExportWriter',
        UpdateReplacePolicy: 'Delete',
      },
    });
  });

  test('cannot create cross region references when crossRegionReferences=false', () => {
    // GIVEN
    const app = new App();
    const stack1 = new Stack(app, 'Stack1', {
      env: {
        account: '123456789012',
        region: 'bermuda-triangle-1337',
      },
    });
    const stack2 = new Stack(app, 'Stack2', {
      env: {
        account: '123456789012',
        region: 'bermuda-triangle-42',
      },
    });
    const nestedStack = new NestedStack(stack1, 'MyNestedStack');

    // WHEN
    const myResource = new MyResource(nestedStack, 'MyResource');
    new CfnOutput(stack2, 'Output', {
      value: myResource.name,
    });

    // THEN
    expect(() => toCloudFormation(stack2)).toThrow(
      /Cannot use resource 'Stack1\/MyNestedStack\/MyResource' in a cross-environment fashion/);
  });

  test('can use reference to resource in nestedStack', () => {
    // GIVEN
    const app = new App();
    const stack1 = new Stack(app, 'Stack1');
    const nestedStack = new NestedStack(stack1, 'Nested1');

    // WHEN
    const myResource = new MyResource(nestedStack, 'Resource1');

    new CfnResource(stack1, 'Resource2', {
      type: 'My::Resource',
      properties: {
        Prop1: myResource.name,
      },
    });

    // THEN
    const assembly = app.synth();
    const template1 = assembly.getStackByName(stack1.stackName).template;
    const nestedTemplate1 = JSON.parse(readFileSync(path.join(assembly.directory, `${nestedStack.artifactId}.nested.template.json`), 'utf8'));
    expect(nestedTemplate1?.Outputs).toEqual({
      Stack1Nested1Resource178AEB067Ref: {
        Value: {
          Ref: 'Resource1CCD41AB7',
        },
      },
    });

    expect(template1?.Resources).toMatchObject({
      Nested1NestedStackNested1NestedStackResourceCD0AD36B: {
        Type: 'AWS::CloudFormation::Stack',
        DeletionPolicy: 'Delete',
        UpdateReplacePolicy: 'Delete',
        Properties: {
          TemplateURL: {
            'Fn::Join': [
              '',
              [
                'https://s3.',
                {
                  Ref: 'AWS::Region',
                },
                '.',
                {
                  Ref: 'AWS::URLSuffix',
                },
                '/',
                {
                  'Fn::Sub': 'cdk-hnb659fds-assets-${AWS::AccountId}-${AWS::Region}',
                },
                '/2a514726f5e8baa6c42e076c7c5ed6d9677cbc87484cd018621b98deddaf8f47.json',
              ],
            ],
          },
        },
      },
      Resource2: {
        Properties: {
          Prop1: {
            'Fn::GetAtt': [
              'Nested1NestedStackNested1NestedStackResourceCD0AD36B',
              'Outputs.Stack1Nested1Resource178AEB067Ref',
            ],
          },
        },
        Type: 'My::Resource',
      },
    });
  });

  test('can use reference to resource in cross region nestedStack', () => {
    // GIVEN
    const account = '123456789012';
    const envRegion1 = {
      account,
      region: 'bermuda-triangle-1337',
    };
    const envRegion2 = {
      account,
      region: 'bermuda-triangle-4567',
    };
    const app = new App();
    const stack1 = new Stack(app, 'Stack1', {
      env: envRegion1,
    });
    const nestedStack = new NestedStack(stack1, 'Nested1', {
      env: envRegion2,
    });

    // WHEN
    const myResource = new MyResource(nestedStack, 'Resource1');

    new CfnResource(stack1, 'Resource2', {
      type: 'My::Resource',
      properties: {
        Prop1: myResource.name,
      },
    });

    // THEN
    const assembly = app.synth();
    const template1 = assembly.getStackByName(stack1.stackName).template;
    const nestedTemplate1 = JSON.parse(readFileSync(path.join(assembly.directory, `${nestedStack.artifactId}.nested.template.json`), 'utf8'));
    expect(nestedTemplate1?.Outputs).toEqual({
      Stack1Nested1Resource178AEB067Ref: {
        Value: {
          Ref: 'Resource1CCD41AB7',
        },
      },
    });

    expect(template1?.Resources).toMatchObject({
      Nested1NestedStackNested1NestedStackResourceCD0AD36B: {
        Type: 'Custom::AWSCDKCrossRegionNestedStack',
        DeletionPolicy: 'Delete',
        UpdateReplacePolicy: 'Delete',
        Properties: {
          TemplateURL: {
            'Fn::Join': [
              '',
              [
                'https://s3.bermuda-triangle-1337.',
                {
                  Ref: 'AWS::URLSuffix',
                },
                '/cdk-hnb659fds-assets-123456789012-bermuda-triangle-1337/2a514726f5e8baa6c42e076c7c5ed6d9677cbc87484cd018621b98deddaf8f47.json',
              ],
            ],
          },
        },
      },
      Resource2: {
        Properties: {
          Prop1: {
            'Fn::GetAtt': [
              'Nested1NestedStackNested1NestedStackResourceCD0AD36B',
              'Outputs.Stack1Nested1Resource178AEB067Ref',
            ],
          },
        },
        Type: 'My::Resource',
      },
    });
  });

  test('can use reference from nestedStack to parent resource', () => {
    // GIVEN
    const app = new App();
    const stack1 = new Stack(app, 'Stack1');
    const nestedStack = new NestedStack(stack1, 'Nested1');

    // WHEN
    const myResource = new MyResource(stack1, 'Resource1');
    new CfnResource(nestedStack, 'Resource2', {
      type: 'My::Resource',
      properties: {
        Prop1: myResource.name,
      },
    });

    // THEN
    const assembly = app.synth();
    const template1 = assembly.getStackByName(stack1.stackName).template;
    const nestedTemplate1 = JSON.parse(readFileSync(path.join(assembly.directory, `${nestedStack.artifactId}.nested.template.json`), 'utf8'));

    expect(template1?.Resources).toMatchObject({
      Nested1NestedStackNested1NestedStackResourceCD0AD36B: {
        Type: 'AWS::CloudFormation::Stack',
        DeletionPolicy: 'Delete',
        UpdateReplacePolicy: 'Delete',
        Properties: {
          TemplateURL: {
            'Fn::Join': [
              '',
              [
                'https://s3.',
                {
                  Ref: 'AWS::Region',
                },
                '.',
                {
                  Ref: 'AWS::URLSuffix',
                },
                '/',
                {
                  'Fn::Sub': 'cdk-hnb659fds-assets-${AWS::AccountId}-${AWS::Region}',
                },
                '/808381c273dad41ef3ac8a540e64a3b203a80caa63636e942e8cc5e0133ff83d.json',
              ],
            ],
          },
        },
      },
    });
    expect(nestedTemplate1).toEqual({
      Parameters: {
        referencetoStack1Resource1C03478CCRef: {
          Type: 'String',
        },
      },
      Resources: {
        Resource2: {
          Properties: {
            Prop1: {
              Ref: 'referencetoStack1Resource1C03478CCRef',
            },
          },
          Type: 'My::Resource',
        },
      },
    });
  });

  test('can use reference from cross region nestedStack to parent resource', () => {
    // GIVEN
    const account = '123456789012';
    const envRegion1 = {
      account,
      region: 'bermuda-triangle-1337',
    };
    const envRegion2 = {
      account,
      region: 'bermuda-triangle-4567',
    };
    const app = new App();
    const stack1 = new Stack(app, 'Stack1', {
      env: envRegion1,
    });
    const nestedStack = new NestedStack(stack1, 'Nested1', {
      env: envRegion2,
    });

    // WHEN
    const myResource = new MyResource(stack1, 'Resource1');
    new CfnResource(nestedStack, 'Resource2', {
      type: 'My::Resource',
      properties: {
        Prop1: myResource.name,
      },
    });

    // THEN
    const assembly = app.synth();
    const template1 = assembly.getStackByName(stack1.stackName).template;
    const nestedTemplate1 = JSON.parse(readFileSync(path.join(assembly.directory, `${nestedStack.artifactId}.nested.template.json`), 'utf8'));

    expect(template1?.Resources).toMatchObject({
      Nested1NestedStackNested1NestedStackResourceCD0AD36B: {
        Type: 'Custom::AWSCDKCrossRegionNestedStack',
        DeletionPolicy: 'Delete',
        UpdateReplacePolicy: 'Delete',
        Properties: {
          TemplateURL: {
            'Fn::Join': [
              '',
              [
                'https://s3.bermuda-triangle-1337.',
                {
                  Ref: 'AWS::URLSuffix',
                },
                '/cdk-hnb659fds-assets-123456789012-bermuda-triangle-1337/808381c273dad41ef3ac8a540e64a3b203a80caa63636e942e8cc5e0133ff83d.json',
              ],
            ],
          },
        },
      },
    });
    expect(nestedTemplate1).toEqual({
      Parameters: {
        referencetoStack1Resource1C03478CCRef: {
          Type: 'String',
        },
      },
      Resources: {
        Resource2: {
          Properties: {
            Prop1: {
              Ref: 'referencetoStack1Resource1C03478CCRef',
            },
          },
          Type: 'My::Resource',
        },
      },
    });
  });

  test('references between sibling nested stacks should output from one and getAtt from the other', () => {
    // GIVEN
    const app = new App();
    const parent = new Stack(app, 'Parent');
    const nested1 = new NestedStack(parent, 'Nested1');
    const nested2 = new NestedStack(parent, 'Nested2');

    // WHEN
    const resource1 = new CfnResource(nested1, 'Resource1', { type: 'Resource1' });
    new CfnResource(nested2, 'Resource2', {
      type: 'Resource2',
      properties: {
        RefToResource1: resource1.ref,
      },
    });

    // THEN
    const assembly = app.synth();
    const parentTemplate = assembly.getStackByName(parent.stackName).template;
    const nestedTemplate1 = JSON.parse(readFileSync(path.join(assembly.directory, `${nested1.artifactId}.nested.template.json`), 'utf8'));
    const nestedTemplate2 = JSON.parse(readFileSync(path.join(assembly.directory, `${nested2.artifactId}.nested.template.json`), 'utf8'));

    // producing nested stack
    expect(nestedTemplate1).toMatchObject({
      Resources: {
        Resource1: {
          Type: 'Resource1',
        },
      },
      Outputs: {
        ParentNested1Resource15F3F0657Ref: {
          Value: {
            Ref: 'Resource1',
          },
        },
      },
    });

    // consuming nested stack
    expect(nestedTemplate2).toMatchObject({
      Resources: {
        Resource2: {
          Type: 'Resource2',
          Properties: {
            RefToResource1: {
              Ref: 'referencetoParentNested1NestedStackNested1NestedStackResource9C05342COutputsParentNested1Resource15F3F0657Ref',
            },
          },
        },
      },
      Parameters: {
        referencetoParentNested1NestedStackNested1NestedStackResource9C05342COutputsParentNested1Resource15F3F0657Ref: {
          Type: 'String',
        },
      },
    });

    // parent
    expect(parentTemplate.Resources).toMatchObject({
      Nested1NestedStackNested1NestedStackResourceCD0AD36B: {
        DeletionPolicy: 'Delete',
        Properties: {
          TemplateURL: {
            'Fn::Join': [
              '',
              [
                'https://s3.',
                {
                  Ref: 'AWS::Region',
                },
                '.',
                {
                  Ref: 'AWS::URLSuffix',
                },
                '/',
                {
                  'Fn::Sub': 'cdk-hnb659fds-assets-${AWS::AccountId}-${AWS::Region}',
                },
                '/be914eb00fe39c8070fa61e08535fd1bd647102a516dfe5d9f14c62b9d023e0f.json',
              ],
            ],
          },
        },
        Type: 'AWS::CloudFormation::Stack',
        UpdateReplacePolicy: 'Delete',
      },
      Nested2NestedStackNested2NestedStackResource877A1112: {
        DeletionPolicy: 'Delete',
        Properties: {
          Parameters: {
            referencetoParentNested1NestedStackNested1NestedStackResource9C05342COutputsParentNested1Resource15F3F0657Ref: {
              'Fn::GetAtt': [
                'Nested1NestedStackNested1NestedStackResourceCD0AD36B',
                'Outputs.ParentNested1Resource15F3F0657Ref',
              ],
            },
          },
          TemplateURL: {
            'Fn::Join': [
              '',
              [
                'https://s3.',
                {
                  Ref: 'AWS::Region',
                },
                '.',
                {
                  Ref: 'AWS::URLSuffix',
                },
                '/',
                {
                  'Fn::Sub': 'cdk-hnb659fds-assets-${AWS::AccountId}-${AWS::Region}',
                },
                '/50259167acf8c67d225b5fd2c54589d22dffa957e4ce116f41f3e31180529f51.json',
              ],
            ],
          },
        },
        Type: 'AWS::CloudFormation::Stack',
        UpdateReplacePolicy: 'Delete',
      },
    });
  });

  test('references between sibling cross region nested stacks should output from one and getAtt from the other', () => {
    // GIVEN
    const account = '123456789012';
    const envRegion1 = {
      account,
      region: 'bermuda-triangle-1337',
    };
    const envRegion2 = {
      account,
      region: 'bermuda-triangle-4567',
    };
    const envRegion3 = {
      account,
      region: 'bermuda-triangle-9876',
    };
    const app = new App();
    const parent = new Stack(app, 'Parent', { env: envRegion1 });
    const nested1 = new NestedStack(parent, 'Nested1', { env: envRegion2 });
    const nested2 = new NestedStack(parent, 'Nested2', { env: envRegion3 });

    // WHEN
    const resource1 = new CfnResource(nested1, 'Resource1', { type: 'Resource1' });
    new CfnResource(nested2, 'Resource2', {
      type: 'Resource2',
      properties: {
        RefToResource1: resource1.ref,
      },
    });

    // THEN
    const assembly = app.synth();
    const parentTemplate = assembly.getStackByName(parent.stackName).template;
    const nested1Template = JSON.parse(readFileSync(path.join(assembly.directory, `${nested1.artifactId}.nested.template.json`), 'utf8'));
    const nested2Template = JSON.parse(readFileSync(path.join(assembly.directory, `${nested2.artifactId}.nested.template.json`), 'utf8'));

    // producing nested stack
    expect(nested1Template).toMatchObject({
      Resources: {
        Resource1: {
          Type: 'Resource1',
        },
      },
      Outputs: {
        ParentNested1Resource15F3F0657Ref: {
          Value: {
            Ref: 'Resource1',
          },
        },
      },
    });

    // consuming nested stack
    expect(nested2Template).toMatchObject({
      Resources: {
        Resource2: {
          Type: 'Resource2',
          Properties: {
            RefToResource1: {
              Ref: 'referencetoParentNested1NestedStackNested1NestedStackResource9C05342COutputsParentNested1Resource15F3F0657Ref',
            },
          },
        },
      },
      Parameters: {
        referencetoParentNested1NestedStackNested1NestedStackResource9C05342COutputsParentNested1Resource15F3F0657Ref: {
          Type: 'String',
        },
      },
    });

    // parent
    expect(parentTemplate).toMatchObject(
      {
        Resources: {
          Nested1NestedStackNested1NestedStackResourceCD0AD36B: {
            DeletionPolicy: 'Delete',
            Properties: {
              TemplateURL: {
                'Fn::Join': [
                  '',
                  [
                    'https://s3.bermuda-triangle-1337.',
                    {
                      Ref: 'AWS::URLSuffix',
                    },
                    '/cdk-hnb659fds-assets-123456789012-bermuda-triangle-1337/be914eb00fe39c8070fa61e08535fd1bd647102a516dfe5d9f14c62b9d023e0f.json',
                  ],
                ],
              },
            },
            Type: 'Custom::AWSCDKCrossRegionNestedStack',
            UpdateReplacePolicy: 'Delete',
          },
          Nested2NestedStackNested2NestedStackResource877A1112: {
            DeletionPolicy: 'Delete',
            Properties: {
              Parameters: {
                referencetoParentNested1NestedStackNested1NestedStackResource9C05342COutputsParentNested1Resource15F3F0657Ref: {
                  'Fn::GetAtt': [
                    'Nested1NestedStackNested1NestedStackResourceCD0AD36B',
                    'Outputs.ParentNested1Resource15F3F0657Ref',

                  ],
                },
              },
              TemplateURL: {
                'Fn::Join': [
                  '',
                  [
                    'https://s3.bermuda-triangle-1337.',
                    {
                      Ref: 'AWS::URLSuffix',
                    },
                    '/cdk-hnb659fds-assets-123456789012-bermuda-triangle-1337/50259167acf8c67d225b5fd2c54589d22dffa957e4ce116f41f3e31180529f51.json',
                  ],
                ],
              },
            },
            Type: 'Custom::AWSCDKCrossRegionNestedStack',
            UpdateReplacePolicy: 'Delete',
          },
        },
      },
    );
  });

  test('another non-nested stack takes a reference on a resource within the nested stack (the parent exports)', () => {
    // GIVEN
    const envRegion1 = {
      account: '123456789012',
      region: 'bermuda-triangle-1337',
    };
    const app = new App();
    const stack1 = new Stack(app, 'Stack1', { env: envRegion1 });
    const stack2 = new Stack(app, 'Stack2', { env: envRegion1 });
    const nestedUnderStack1 = new NestedStack(stack1, 'NestedUnderStack1');
    const resourceInNestedStack = new CfnResource(nestedUnderStack1, 'ResourceInNestedStack', { type: 'MyResource' });

    // WHEN
    new CfnResource(stack2, 'ResourceInStack2', {
      type: 'JustResource',
      properties: {
        RefToSibling: resourceInNestedStack.getAtt('MyAttribute'),
      },
    });

    // THEN
    const assembly = app.synth();

    // nested stack should output this value as if it was referenced by the parent (without the export)
    expect(
      JSON.parse(readFileSync(path.join(assembly.directory, `${nestedUnderStack1.artifactId}.nested.template.json`), 'utf8')),
    ).toMatchObject({
      Resources: {
        ResourceInNestedStack: {
          Type: 'MyResource',
        },
      },
      Outputs: {
        Stack1NestedUnderStack1ResourceInNestedStack6EE9DCD2MyAttribute: {
          Value: {
            'Fn::GetAtt': [
              'ResourceInNestedStack',
              'MyAttribute',
            ],
          },
        },
      },
    });

    // parent stack (stack1) should export this value
    expect(assembly.getStackByName(stack1.stackName).template).toMatchObject({
      Outputs: {
        // eslint-disable-next-line max-len
        ExportsOutputFnGetAttNestedUnderStack1NestedStackNestedUnderStack1NestedStackResourceF616305BOutputsStack1NestedUnderStack1ResourceInNestedStack6EE9DCD2MyAttribute564EECF3: {
          Value: { 'Fn::GetAtt': ['NestedUnderStack1NestedStackNestedUnderStack1NestedStackResourceF616305B', 'Outputs.Stack1NestedUnderStack1ResourceInNestedStack6EE9DCD2MyAttribute'] },
          Export: { Name: 'Stack1:ExportsOutputFnGetAttNestedUnderStack1NestedStackNestedUnderStack1NestedStackResourceF616305BOutputsStack1NestedUnderStack1ResourceInNestedStack6EE9DCD2MyAttribute564EECF3' },
        },
      },
    });

    // consuming stack should use ImportValue to import the value from the parent stack
    expect(assembly.getStackByName(stack2.stackName).template).toMatchObject({
      Resources: {
        ResourceInStack2: {
          Type: 'JustResource',
          Properties: {
            RefToSibling: {
              'Fn::ImportValue': 'Stack1:ExportsOutputFnGetAttNestedUnderStack1NestedStackNestedUnderStack1NestedStackResourceF616305BOutputsStack1NestedUnderStack1ResourceInNestedStack6EE9DCD2MyAttribute564EECF3',
            },
          },
        },
      },
    });

    expect(assembly.stacks.length).toEqual(2);
    const stack1Artifact = assembly.getStackByName(stack1.stackName);
    const stack2Artifact = assembly.getStackByName(stack2.stackName);
    expect(stack2Artifact.dependencies).toContain(stack1Artifact);
  });

  test('another non-nested stack takes a reference on a resource within the cross region nested stack (the parent exports)', () => {
    // GIVEN
    const envRegion1 = {
      account: '123456789012',
      region: 'bermuda-triangle-1337',
    };
    const envRegion2 = {
      account: '123456789012',
      region: 'bermuda-triangle-4567',
    };
    const app = new App();
    const stack1 = new Stack(app, 'Stack1', { env: envRegion1 });
    const stack2 = new Stack(app, 'Stack2', { env: envRegion1 });
    const nestedUnderStack1 = new NestedStack(stack1, 'NestedUnderStack1', { env: envRegion2 });
    const resourceInNestedStack = new CfnResource(nestedUnderStack1, 'ResourceInNestedStack', { type: 'MyResource' });

    // WHEN
    new CfnResource(stack2, 'ResourceInStack2', {
      type: 'JustResource',
      properties: {
        RefToSibling: resourceInNestedStack.getAtt('MyAttribute'),
      },
    });

    // THEN
    const assembly = app.synth();

    // nested stack should output this value as if it was referenced by the parent (without the export)
    expect(
      JSON.parse(readFileSync(path.join(assembly.directory, `${nestedUnderStack1.artifactId}.nested.template.json`), 'utf8'),
      )).toMatchObject({
      Resources: {
        ResourceInNestedStack: {
          Type: 'MyResource',
        },
      },
      Outputs: {
        Stack1NestedUnderStack1ResourceInNestedStack6EE9DCD2MyAttribute: {
          Value: {
            'Fn::GetAtt': [
              'ResourceInNestedStack',
              'MyAttribute',
            ],
          },
        },
      },
    });

    // parent stack (stack1) should export this value
    expect(assembly.getStackByName(stack1.stackName).template).toMatchObject({
      Outputs: {
        // eslint-disable-next-line max-len
        ExportsOutputFnGetAttNestedUnderStack1NestedStackNestedUnderStack1NestedStackResourceF616305BOutputsStack1NestedUnderStack1ResourceInNestedStack6EE9DCD2MyAttribute564EECF3: {
          Value: { 'Fn::GetAtt': ['NestedUnderStack1NestedStackNestedUnderStack1NestedStackResourceF616305B', 'Outputs.Stack1NestedUnderStack1ResourceInNestedStack6EE9DCD2MyAttribute'] },
          Export: { Name: 'Stack1:ExportsOutputFnGetAttNestedUnderStack1NestedStackNestedUnderStack1NestedStackResourceF616305BOutputsStack1NestedUnderStack1ResourceInNestedStack6EE9DCD2MyAttribute564EECF3' },
        },
      },
    });

    // consuming stack should use ImportValue to import the value from the parent stack
    expect(assembly.getStackByName(stack2.stackName).template).toMatchObject({
      Resources: {
        ResourceInStack2: {
          Type: 'JustResource',
          Properties: {
            RefToSibling: {
              'Fn::ImportValue': 'Stack1:ExportsOutputFnGetAttNestedUnderStack1NestedStackNestedUnderStack1NestedStackResourceF616305BOutputsStack1NestedUnderStack1ResourceInNestedStack6EE9DCD2MyAttribute564EECF3',
            },
          },
        },
      },
    });

    expect(assembly.stacks.length).toEqual(2);
    const stack1Artifact = assembly.getStackByName(stack1.stackName);
    const stack2Artifact = assembly.getStackByName(stack2.stackName);
    expect(stack2Artifact.dependencies).toContain(stack1Artifact);
  });

  test('can use reference between non-sibling nestedStacks in the same region.', () => {
    // GIVEN
    const envRegion1 = {
      account: '123456789012',
      region: 'bermuda-triangle-1337',
    };
    const app = new App();
    const stack1 = new Stack(app, 'Stack1', {
      env: envRegion1,
    });
    const stack2 = new Stack(app, 'Stack2', {
      env: envRegion1,
    });
    const nestedStack1 = new NestedStack(stack1, 'Nested1');
    const nestedStack2 = new NestedStack(stack2, 'Nested2');

    // WHEN
    const myResource = new MyResource(nestedStack1, 'Resource1');
    new CfnResource(nestedStack2, 'Resource2', {
      type: 'My::Resource',
      properties: {
        Prop1: myResource.name,
      },
    });

    // THEN
    const assembly = app.synth();
    const template1 = assembly.getStackByName(stack1.stackName).template;
    const nestedTemplate1 = JSON.parse(readFileSync(path.join(assembly.directory, `${nestedStack1.artifactId}.nested.template.json`), 'utf8'));
    const template2 = assembly.getStackByName(stack2.stackName).template;
    const nestedTemplate2 = JSON.parse(readFileSync(path.join(assembly.directory, `${nestedStack2.artifactId}.nested.template.json`), 'utf8'));

    expect(template1.Resources).toMatchObject({
      Nested1NestedStackNested1NestedStackResourceCD0AD36B: {
        Type: 'AWS::CloudFormation::Stack',
        DeletionPolicy: 'Delete',
        UpdateReplacePolicy: 'Delete',
        Properties: {
          TemplateURL: {
            'Fn::Join': [
              '',
              [
                'https://s3.bermuda-triangle-1337.',
                {
                  Ref: 'AWS::URLSuffix',
                },
                '/cdk-hnb659fds-assets-123456789012-bermuda-triangle-1337/2a514726f5e8baa6c42e076c7c5ed6d9677cbc87484cd018621b98deddaf8f47.json',
              ],
            ],
          },
        },
      },
    });
    expect(template1.Outputs).toMatchObject({
    });
    expect(nestedTemplate1).toEqual({
      Outputs: {
        Stack1Nested1Resource178AEB067Ref: {
          Value: {
            Ref: 'Resource1CCD41AB7',
          },
        },
      },
      Resources: {
        Resource1CCD41AB7: {
          Type: 'My::Resource',
        },
      },
    });
    expect(template2.Resources).toMatchObject({
      Nested2NestedStackNested2NestedStackResource877A1112: {
        Type: 'AWS::CloudFormation::Stack',
        DeletionPolicy: 'Delete',
        UpdateReplacePolicy: 'Delete',
        Properties: {
          TemplateURL: {
            'Fn::Join': [
              '',
              [
                'https://s3.bermuda-triangle-1337.',
                {
                  Ref: 'AWS::URLSuffix',
                },
                '/cdk-hnb659fds-assets-123456789012-bermuda-triangle-1337/e1a1be032e2b332fc6e278b92e5143550098617328b2694bfcab4d6e9ae78cb6.json',
              ],
            ],
          },
        },
      },
    });
    expect(nestedTemplate2).toEqual({
      Resources: {
        Resource2: {
          Properties: {
            Prop1: {
              'Fn::ImportValue': 'Stack1:ExportsOutputFnGetAttNested1NestedStackNested1NestedStackResourceCD0AD36BOutputsStack1Nested1Resource178AEB067Ref03A71AFD',
            },
          },
          Type: 'My::Resource',
        },
      },
    });
  });

  test('references from deep non-sibling nestedStacks go trough top level.', () => {
    // GIVEN
    const envRegion1 = {
      account: '123456789012',
      region: 'bermuda-triangle-1337',
    };
    const app = new App();
    const stack1 = new Stack(app, 'Stack1', {
      env: envRegion1,
    });
    const intermediate1a = new NestedStack(stack1, 'Intermdiate1a');
    const intermediate1b = new NestedStack(intermediate1a, 'Intermdiate1b');
    const nestedStack1 = new NestedStack(intermediate1b, 'Nested1');
    const stack2 = new Stack(app, 'Stack2', {
      env: envRegion1,
    });
    const intermediate2 = new NestedStack(stack2, 'Intermdiate2');
    const nestedStack2 = new NestedStack(intermediate2, 'Nested2');

    // WHEN
    const myResource = new MyResource(nestedStack1, 'Resource1');
    new CfnResource(nestedStack2, 'Resource2', {
      type: 'My::Resource',
      properties: {
        Prop1: myResource.name,
      },
    });

    // THEN
    const assembly = app.synth();
    expect(assembly.getStackByName(stack1.stackName).template).toMatchObject({
      Outputs: {
        // eslint-disable-next-line max-len
        ExportsOutputFnGetAttIntermdiate1aNestedStackIntermdiate1aNestedStackResource1823CF54OutputsStack1Intermdiate1aIntermdiate1bNestedStackIntermdiate1bNestedStackResourceEF3EF381OutputsStack1Intermdiate1aIntermdiate1bNested1NestedStackNested1N7973E1BF: {
          Export: {
            Name: 'Stack1:ExportsOutputFnGetAttIntermdiate1aNestedStackIntermdiate1aNestedStackResource1823CF54OutputsStack1Intermdiate1aIntermdiate1bNestedStackIntermdiate1bNestedStackResourceEF3EF381OutputsStack1Intermdiate1aIntermdiate1bNested1NestedStackNested1N7973E1BF',
          },
          Value: {
            'Fn::GetAtt': [
              'Intermdiate1aNestedStackIntermdiate1aNestedStackResource1823CF54',
              'Outputs.Stack1Intermdiate1aIntermdiate1bNestedStackIntermdiate1bNestedStackResourceEF3EF381OutputsStack1Intermdiate1aIntermdiate1bNested1NestedStackNested1NestedStackResourceBB38C2C5OutputsStack1Intermdiate1aIntermdiate1bNested1Resource17C8B32E7Ref',
            ],
          },
        },
      },
    });
    expect(JSON.parse(readFileSync(path.join(assembly.directory, `${nestedStack1.artifactId}.nested.template.json`), 'utf8'))).toStrictEqual( {
      Outputs: {
        Stack1Intermdiate1aIntermdiate1bNested1Resource17C8B32E7Ref: {
          Value: {
            Ref: 'Resource1CCD41AB7',
          },
        },
      },
      Resources: {
        Resource1CCD41AB7: {
          Type: 'My::Resource',
        },
      },
    });
    expect(JSON.parse(readFileSync(path.join(assembly.directory, `${intermediate1a.artifactId}.nested.template.json`), 'utf8'))).toMatchObject({
      Outputs: {
        // eslint-disable-next-line max-len
        Stack1Intermdiate1aIntermdiate1bNestedStackIntermdiate1bNestedStackResourceEF3EF381OutputsStack1Intermdiate1aIntermdiate1bNested1NestedStackNested1NestedStackResourceBB38C2C5OutputsStack1Intermdiate1aIntermdiate1bNested1Resource17C8B32E7Ref: {
          Value: {
            'Fn::GetAtt': [
              'Intermdiate1bNestedStackIntermdiate1bNestedStackResourceB99AE4F5',
              'Outputs.Stack1Intermdiate1aIntermdiate1bNested1NestedStackNested1NestedStackResourceBB38C2C5OutputsStack1Intermdiate1aIntermdiate1bNested1Resource17C8B32E7Ref',
            ],
          },
        },
      },
    });
    expect(JSON.parse(readFileSync(path.join(assembly.directory, `${intermediate1b.artifactId}.nested.template.json`), 'utf8'))).toMatchObject({
      Outputs: {
        // eslint-disable-next-line max-len
        Stack1Intermdiate1aIntermdiate1bNested1NestedStackNested1NestedStackResourceBB38C2C5OutputsStack1Intermdiate1aIntermdiate1bNested1Resource17C8B32E7Ref: {
          Value: {
            'Fn::GetAtt': [
              'Nested1NestedStackNested1NestedStackResourceCD0AD36B',
              'Outputs.Stack1Intermdiate1aIntermdiate1bNested1Resource17C8B32E7Ref',
            ],
          },
        },
      },
    });
    expect(assembly.getStackByName(stack2.stackName).template.Resources).toStrictEqual({
      Intermdiate2NestedStackIntermdiate2NestedStackResource8CBC0B0D: {
        DeletionPolicy: 'Delete',
        Type: 'AWS::CloudFormation::Stack',
        UpdateReplacePolicy: 'Delete',
        Properties: {
          TemplateURL: {
            'Fn::Join': [
              '',
              [
                'https://s3.bermuda-triangle-1337.',
                {
                  Ref: 'AWS::URLSuffix',
                },
                '/cdk-hnb659fds-assets-123456789012-bermuda-triangle-1337/f3eaf832cde2c8858c0514033a3b11af210e8b6a5ea324179d5661d6689da18b.json',
              ],
            ],
          },
        },
      },
    });
    expect(JSON.parse(readFileSync(path.join(assembly.directory, `${nestedStack2.artifactId}.nested.template.json`), 'utf8'))).toMatchObject({
      Resources: {
        Resource2: {
          Properties: {
            Prop1: {
              'Fn::ImportValue': 'Stack1:ExportsOutputFnGetAttIntermdiate1aNestedStackIntermdiate1aNestedStackResource1823CF54OutputsStack1Intermdiate1aIntermdiate1bNestedStackIntermdiate1bNestedStackResourceEF3EF381OutputsStack1Intermdiate1aIntermdiate1bNested1NestedStackNested1N7973E1BF',
            },
          },
          Type: 'My::Resource',
        },
      },
    });
  });

  test('can use reference between cross region nestedStacks with containing stacks in same region(the containing stacks export/import)', () => {
    // GIVEN
    const envRegion1 = {
      account: '123456789012',
      region: 'bermuda-triangle-1337',
    };
    const envRegion2 = {
      account: '123456789012',
      region: 'bermuda-triangle-4567',
    };
    const envRegion3 = {
      account: '123456789012',
      region: 'bermuda-triangle-9876',
    };
    const app = new App();
    const stack1 = new Stack(app, 'Stack1', {
      env: envRegion1,
    });
    const stack2 = new Stack(app, 'Stack2', {
      env: envRegion1,
    });
    const nestedStack1 = new NestedStack(stack1, 'Nested1', { env: envRegion2 });
    const nestedStack2 = new NestedStack(stack2, 'Nested2', { env: envRegion3 });

    // WHEN
    const myResource = new MyResource(nestedStack1, 'Resource1');
    new CfnResource(nestedStack2, 'Resource2', {
      type: 'My::Resource',
      properties: {
        Prop1: myResource.name,
      },
    });

    // THEN
    const assembly = app.synth();
    const template1 = assembly.getStackByName(stack1.stackName).template;
    const nestedTemplate1 = JSON.parse(readFileSync(path.join(assembly.directory, `${nestedStack1.artifactId}.nested.template.json`), 'utf8'));
    const template2 = assembly.getStackByName(stack2.stackName).template;
    const nestedTemplate2 = JSON.parse(readFileSync(path.join(assembly.directory, `${nestedStack2.artifactId}.nested.template.json`), 'utf8'));

    expect(template1.Resources).toMatchObject({
      Nested1NestedStackNested1NestedStackResourceCD0AD36B: {
        Type: 'Custom::AWSCDKCrossRegionNestedStack',
        DeletionPolicy: 'Delete',
        UpdateReplacePolicy: 'Delete',
        Properties: {
          TemplateURL: {
            'Fn::Join': [
              '',
              [
                'https://s3.bermuda-triangle-1337.',
                {
                  Ref: 'AWS::URLSuffix',
                },
                '/cdk-hnb659fds-assets-123456789012-bermuda-triangle-1337/2a514726f5e8baa6c42e076c7c5ed6d9677cbc87484cd018621b98deddaf8f47.json',
              ],
            ],
          },
        },
      },
    });
    expect(template1.Outputs).toMatchObject({
    });
    expect(nestedTemplate1).toEqual({
      Outputs: {
        Stack1Nested1Resource178AEB067Ref: {
          Value: {
            Ref: 'Resource1CCD41AB7',
          },
        },
      },
      Resources: {
        Resource1CCD41AB7: {
          Type: 'My::Resource',
        },
      },
    });
    expect(template2.Resources).toMatchObject({
      Nested2NestedStackNested2NestedStackResource877A1112: {
        Type: 'Custom::AWSCDKCrossRegionNestedStack',
        DeletionPolicy: 'Delete',
        UpdateReplacePolicy: 'Delete',
        Properties: {
          TemplateURL: {
            'Fn::Join': [
              '',
              [
                'https://s3.bermuda-triangle-1337.',
                {
                  Ref: 'AWS::URLSuffix',
                },
                '/cdk-hnb659fds-assets-123456789012-bermuda-triangle-1337/37c445ea48c938c1e68e3f26666bda752aa1380c9faa0deb3e6f52070753c56d.json',
              ],
            ],
          },
        },
      },
    });
    expect(nestedTemplate2).toEqual({
      Parameters: {
        referencetoStack1Nested1NestedStackNested1NestedStackResource3AC5F6D4OutputsStack1Nested1Resource178AEB067Ref: {
          Type: 'String',
        },
      },
      Resources: {
        Resource2: {
          Properties: {
            Prop1: {
              Ref: 'referencetoStack1Nested1NestedStackNested1NestedStackResource3AC5F6D4OutputsStack1Nested1Resource178AEB067Ref',
            },
          },
          Type: 'My::Resource',
        },
      },
    });
  });
});

class MyResource extends Resource {
  public readonly arn: string;
  public readonly name: string;

  constructor(scope: Construct, id: string, physicalName?: string) {
    super(scope, id, { physicalName });

    const res = new CfnResource(this, 'Resource', {
      type: 'My::Resource',
      properties: {
        resourceName: this.physicalName,
      },
    });

    this.name = this.getResourceNameAttribute(res.ref.toString());
    this.arn = this.getResourceArnAttribute(res.getAtt('Arn').toString(), {
      region: '',
      account: '',
      resource: 'my-resource',
      resourceName: this.physicalName,
      service: 'myservice',
    });
  }
}
