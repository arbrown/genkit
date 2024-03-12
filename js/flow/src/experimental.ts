import { Action, Operation, asyncSleep } from '@genkit-ai/common';
import logging from '@genkit-ai/common/logging';
import * as z from 'zod';
import { PollingConfig } from './context';
import {
  FlowExecutionError,
  FlowNotFoundError,
  FlowStillRunningError,
} from './errors';
import { Flow, FlowWrapper, RunStepConfig, StepsFunction, flow } from './flow';
import { Invoker, Scheduler } from './types';
import { getActiveContext } from './utils';

/**
 * Defines the durable flow.
 */
export function durableFlow<
  I extends z.ZodTypeAny,
  O extends z.ZodTypeAny,
  S extends z.ZodTypeAny
>(
  config: {
    name: string;
    input: I;
    output: O;
    streamType?: S;
    invoker?: Invoker<I, O, S>;
    scheduler?: Scheduler<I, O, S>;
  },
  steps: StepsFunction<I, O, S>
): Flow<I, O, S> {
  return flow(
    {
      name: config.name,
      input: config.input,
      output: config.output,
      streamType: config.streamType,
      invoker: config.invoker,
      experimentalScheduler: config.scheduler,
      experimentalDurable: true,
    },
    steps
  );
}

/**
 * Schedules a flow run. This is always return an operation that's not completed (done=false).
 */
export async function scheduleFlow<
  I extends z.ZodTypeAny,
  O extends z.ZodTypeAny,
  S extends z.ZodTypeAny
>(
  flow: Flow<I, O, S> | FlowWrapper<I, O, S>,
  payload: z.infer<I>,
  delaySeconds?: number
): Promise<Operation> {
  if (!(flow instanceof Flow)) {
    flow = flow.flow;
  }
  const state = await flow.invoker(flow, {
    schedule: {
      input: flow.input.parse(payload),
      delay: delaySeconds,
    },
  });
  return state;
}

/**
 * Resumes an interrupted flow.
 */
export async function resumeFlow<
  I extends z.ZodTypeAny,
  O extends z.ZodTypeAny,
  S extends z.ZodTypeAny
>(
  flow: Flow<I, O, S> | FlowWrapper<I, O, S>,
  flowId: string,
  payload: any
): Promise<Operation> {
  if (!(flow instanceof Flow)) {
    flow = flow.flow;
  }
  return await flow.invoker(flow, {
    resume: {
      flowId,
      payload,
    },
  });
}

/**
 * Returns an operation representing current state of the flow.
 */
export async function getFlowState<
  I extends z.ZodTypeAny,
  O extends z.ZodTypeAny,
  S extends z.ZodTypeAny
>(
  flow: Flow<I, O, S> | FlowWrapper<I, O, S>,
  flowId: string
): Promise<Operation> {
  if (!(flow instanceof Flow)) {
    flow = flow.flow;
  }
  const state = await (await flow.stateStore).load(flowId);
  if (!state) {
    throw new FlowNotFoundError(`flow state ${flowId} not found`);
  }
  return state.operation;
}
/**
 * A flow steap that executes an action with provided input and memoizes the output.
 */
export function runAction<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  action: Action<I, O>,
  input: z.infer<I>,
  actionConfig?: RunStepConfig
): Promise<z.infer<O>> {
  const config: RunStepConfig = {
    ...actionConfig,
    name: actionConfig?.name || action.__action.name,
  };
  return run(config, input, () => action(input));
}

/**
 * A local utility that waits for the flow execution to complete. If flow errored then a
 * {@link FlowExecutionError} will be thrown.
 */
export async function waitFlowToComplete<
  I extends z.ZodTypeAny,
  O extends z.ZodTypeAny,
  S extends z.ZodTypeAny
>(
  flow: Flow<I, O, S> | FlowWrapper<I, O, S>,
  flowId: string
): Promise<z.infer<O>> {
  if (!(flow instanceof Flow)) {
    flow = flow.flow;
  }
  let state: Operation | undefined = undefined;
  try {
    state = await getFlowState(flow, flowId);
  } catch (e) {
    logging.error(e);
    // TODO: add timeout
    if (!(e instanceof FlowNotFoundError)) {
      throw e;
    }
  }
  if (state && state?.done) {
    return parseOutput(flowId, state);
  } else {
    await asyncSleep(1000);
    return await waitFlowToComplete(flow, flowId);
  }
}

function parseOutput<O extends z.ZodTypeAny>(
  flowId: string,
  state: Operation
): z.infer<O> {
  if (!state.done) {
    throw new FlowStillRunningError(flowId);
  }
  if (state.result?.error) {
    throw new FlowExecutionError(
      flowId,
      state.result.error,
      state.result.stacktrace
    );
  }
  return state.result?.response;
}

export function run<T>(
  experimentalConfig: RunStepConfig,
  func: () => Promise<T>
): Promise<T>;
export function run<T>(
  experimentalConfig: RunStepConfig,
  input: any | undefined,
  func: () => Promise<T>
): Promise<T>;
export function run<T>(name: string, func: () => Promise<T>): Promise<T>;

/**
 * A flow steap that executes the provided function and memoizes the output.
 */
export function run<T>(
  nameOrConfig: string | RunStepConfig,
  funcOrInput: () => Promise<T>,
  fn?: () => Promise<T>
): Promise<T> {
  let config: RunStepConfig;
  if (typeof nameOrConfig === 'string') {
    config = {
      name: nameOrConfig,
    };
  } else {
    config = nameOrConfig;
  }
  const func = arguments.length === 3 ? fn : funcOrInput;
  const input = arguments.length === 3 ? funcOrInput : undefined;
  if (!func) {
    throw new Error('unable to resolve run function');
  }
  const ctx = getActiveContext();
  if (!ctx) throw new Error('can only be run from a flow');
  return ctx.run(config, input, func);
}

/**
 * Interrupts the flow execution until the flow is resumed with input defined by `responseSchema`.
 */
export function interrupt<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  stepName: string,
  responseSchema: I,
  func?: (payload: z.infer<I>) => Promise<z.infer<O>>
): Promise<z.infer<O>> {
  const ctx = getActiveContext();
  if (!ctx) throw new Error('interrupt can only be run from a flow');
  return ctx.interrupt(
    stepName,
    func || ((input: z.infer<I>): z.infer<O> => input),
    responseSchema
  );
}

/**
 * Interrupts flow execution and resumes it when specified amount if time elapses.
 */
export function sleep(actionId: string, durationMs: number) {
  const ctx = getActiveContext();
  if (!ctx) throw new Error('sleep can only be run from a flow');
  return ctx.sleep(actionId, durationMs);
}

/**
 * Interrupts the flow and periodically check for the flow ID to complete.
 */
export function waitFor(
  stepName: string,
  flow: Flow<z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>,
  flowIds: string[],
  pollingConfig?: PollingConfig
): Promise<Operation[]> {
  const ctx = getActiveContext();
  if (!ctx) throw new Error('waitFor can only be run from a flow');
  return ctx.waitFor({ flow, stepName, flowIds, pollingConfig });
}
