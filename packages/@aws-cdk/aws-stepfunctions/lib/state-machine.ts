import cloudwatch = require('@aws-cdk/aws-cloudwatch');
import events = require('@aws-cdk/aws-events');
import iam = require('@aws-cdk/aws-iam');
import cdk = require('@aws-cdk/cdk');
import { StateGraph } from './state-graph';
import { cloudformation } from './stepfunctions.generated';
import { IChainable } from './types';

/**
 * Properties for defining a State Machine
 */
export interface StateMachineProps {
  /**
   * A name for the state machine
   *
   * @default A name is automatically generated
   */
  stateMachineName?: string;

  /**
   * Definition for this state machine
   */
  definition: IChainable;

  /**
   * The execution role for the state machine service
   *
   * @default A role is automatically created
   */
  role?: iam.Role;

  /**
   * Maximum run time for this state machine
   *
   * @default No timeout
   */
  timeoutSeconds?: number;
}

/**
 * Define a StepFunctions State Machine
 */
export class StateMachine extends cdk.Construct {
  public readonly role: iam.Role;
  public readonly stateMachineName: string;
  public readonly stateMachineArn: string;

  /** A role used by CloudWatch events to trigger a build */
  private eventsRole?: iam.Role;

  constructor(parent: cdk.Construct, id: string, props: StateMachineProps) {
    super(parent, id);

    this.role = props.role || new iam.Role(this, 'Role', {
      assumedBy: new cdk.ServicePrincipal(new cdk.FnConcat('states.', new cdk.AwsRegion(), '.amazonaws.com').toString()),
    });

    const graph = new StateGraph(props.definition.startState, `State Machine ${id} definition`);
    graph.timeoutSeconds = props.timeoutSeconds;

    const resource = new cloudformation.StateMachineResource(this, 'Resource', {
      stateMachineName: props.stateMachineName,
      roleArn: this.role.roleArn,
      definitionString: cdk.CloudFormationJSON.stringify(graph.toGraphJson()),
    });

    for (const statement of graph.policyStatements) {
      this.addToRolePolicy(statement);
    }

    this.stateMachineName = resource.stateMachineName;
    this.stateMachineArn = resource.stateMachineArn;
  }

  /**
   * Add the given statement to the role's policy
   */
  public addToRolePolicy(statement: cdk.PolicyStatement) {
    this.role.addToPolicy(statement);
  }

  /**
   * Allows using state machines as event rule targets.
   */
  public asEventRuleTarget(_ruleArn: string, _ruleId: string): events.EventRuleTargetProps {
    if (!this.eventsRole) {
      this.eventsRole = new iam.Role(this, 'EventsRole', {
        assumedBy: new cdk.ServicePrincipal('events.amazonaws.com')
      });

      this.eventsRole.addToPolicy(new cdk.PolicyStatement()
        .addAction('states:StartExecution')
        .addResource(this.stateMachineArn));
    }

    return {
      id: this.id,
      arn: this.stateMachineArn,
      roleArn: this.eventsRole.roleArn,
    };
  }

  /**
   * Return the given named metric for this State Machine's executions
   *
   * @default sum over 5 minutes
   */
  public metric(metricName: string, props?: cloudwatch.MetricCustomization): cloudwatch.Metric {
    return new cloudwatch.Metric({
      namespace: 'AWS/States',
      metricName,
      dimensions: { StateMachineArn: this.stateMachineArn },
      statistic: 'sum',
      ...props
    });
  }

  /**
   * Metric for the number of executions that failed
   *
   * @default sum over 5 minutes
   */
  public metricFailed(props?: cloudwatch.MetricCustomization): cloudwatch.Metric {
    return this.metric('ExecutionsFailed', props);
  }

  /**
   * Metric for the number of executions that were throttled
   *
   * @default sum over 5 minutes
   */
  public metricThrottled(props?: cloudwatch.MetricCustomization): cloudwatch.Metric {
    return this.metric('ExecutionThrottled', props);
  }

  /**
   * Metric for the number of executions that were aborted
   *
   * @default sum over 5 minutes
   */
  public metricAborted(props?: cloudwatch.MetricCustomization): cloudwatch.Metric {
    return this.metric('ExecutionsAborted', props);
  }

  /**
   * Metric for the number of executions that succeeded
   *
   * @default sum over 5 minutes
   */
  public metricSucceeded(props?: cloudwatch.MetricCustomization): cloudwatch.Metric {
    return this.metric('ExecutionsSucceeded', props);
  }

  /**
   * Metric for the number of executions that succeeded
   *
   * @default sum over 5 minutes
   */
  public metricTimedOut(props?: cloudwatch.MetricCustomization): cloudwatch.Metric {
    return this.metric('ExecutionsTimedOut', props);
  }

  /**
   * Metric for the number of executions that were started
   *
   * @default sum over 5 minutes
   */
  public metricStarted(props?: cloudwatch.MetricCustomization): cloudwatch.Metric {
    return this.metric('ExecutionsStarted', props);
  }
}
