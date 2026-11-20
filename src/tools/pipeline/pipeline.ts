import { PipelineStep, CollectedResult } from '../main-worker-factory/types';
import { WorkerFactory } from '../worker-factory';
import { WorkerMode } from '../worker-factory/worker-factory';
import { extractTransferable } from '../extract-transferable';
import {
  errorFromEvent,
  markErrorHandled,
  onAbort,
  terminatedError,
} from '../lifecycle';
import { replyData } from '../worker-reply';
import {
  memoryInput,
  noteMemoryInputReader,
  readsMemoryInput,
} from '../memory-input';
import { PipelineContext } from './types';

/**
 * Executes a pipeline of workers, handling initialization, data flow, and termination.
 *
 * Workers are linked together via `MessageChannel`s: data flows directly from one worker
 * to the next without routing through the main thread, while errors and the final result
 * come back to the main thread. A single-step pipeline is simply a chain of length one.
 *
 * The first step may start from a `__memory_ref__` instead of `srcData`; the referenced
 * data is read from the MemoryWorker before the chain starts.
 *
 * @param steps - An array of pipeline steps, where each step defines the worker name and input parameters.
 * @param context - The execution context (provides logger, memory store, worker tracking, run signal).
 * @returns A promise that resolves to a CollectedResult containing the final output of the pipeline, or rejects on error.
 * @throws {Error} If the pipeline is empty, the worker manager is terminated, or a worker is not found.
 * @template TResult - The type of the pipeline result.
 */
export async function executePipeline<TResult = unknown>(
  steps: PipelineStep[],
  context: PipelineContext,
): Promise<CollectedResult<TResult>> {
  const { signal } = context;
  if (context.isTerminated() || signal.aborted) {
    context.logger.error(
      'Attempted to execute pipeline after MainWorkerFactory was terminated',
    );
    throw terminatedError();
  }

  if (steps.length === 0) {
    context.logger.error('Attempted to execute an empty pipeline');
    throw new Error('Pipeline requires at least one step');
  }

  const configs = steps.map((step) => {
    const config = context.findWorkerByName(step.worker);
    if (!config) {
      context.logger.error(
        `Pipeline step config not found for worker: "${step.worker}"`,
      );
      throw new Error(`Worker "${step.worker}" not found`);
    }
    return config;
  });

  // Resolve the first step's input before any worker starts.
  const {
    worker: _firstWorkerName,
    srcData: initialData,
    ...initialParams
  } = steps[0];
  let firstPayloadData = initialData;
  const memoryRef = initialParams.__memory_ref__ as string | undefined;
  const shouldDeleteMemory = Boolean(initialParams.deleteMemory);
  delete initialParams.__memory_ref__;
  delete initialParams.deleteMemory;
  /** Port the first step reads its stored input over, if it reads it itself. */
  let inputReadPort: MessagePort | undefined;
  /** Stored input to delete once the pipeline is done reading it. */
  let deleteWhenDone: string | undefined;

  if (firstPayloadData === undefined && memoryRef) {
    if (!context.memoryStore.has(memoryRef)) {
      context.logger.error(
        `Memory reference "${memoryRef}" not found in MemoryStore`,
      );
      throw new Error(
        `Memory reference "${memoryRef}" not found in MemoryStore`,
      );
    }
    if (readsMemoryInput(configs[0])) {
      // The first step reads the stored input straight from the MemoryWorker.
      inputReadPort = await context.memoryWorkerProxy.allocateWorkerPort();
      firstPayloadData = memoryInput(memoryRef);
      if (shouldDeleteMemory) deleteWhenDone = memoryRef;
    } else {
      // A hand-written first step can't read it: send it the data.
      firstPayloadData = await context.memoryWorkerProxy.get(memoryRef);
      if (shouldDeleteMemory) {
        context.memoryStore.delete(memoryRef);
        await context.memoryWorkerProxy.delete(memoryRef);
      }
    }
  }
  if (firstPayloadData === undefined) {
    firstPayloadData = {};
  }
  if (signal.aborted) {
    inputReadPort?.close();
    throw terminatedError();
  }

  try {
    return await runChain();
  } finally {
    if (deleteWhenDone) {
      context.memoryStore.delete(deleteWhenDone);
      await context.memoryWorkerProxy.delete(deleteWhenDone).catch(() => {});
    }
  }

  /** Starts the step workers, wires them together, and settles with the last step's result. */
  function runChain() {
    return new Promise<CollectedResult<TResult>>((resolve, reject) => {
      const workers: Worker[] = [];
      let settled = false;

      const terminateAll = () =>
        workers.forEach((worker) => context.terminateWorker(worker));

      const stopListening = onAbort(signal, () => fail(terminatedError()));

      function fail(error: unknown) {
        if (settled) return;
        settled = true;
        stopListening();
        terminateAll();
        reject(error);
      }

      function succeed(data: TResult) {
        if (settled) return;
        settled = true;
        stopListening();
        terminateAll();
        resolve({ data, succeeded: 1, failed: 0, errors: [] });
      }

      try {
        // Create all workers
        for (const config of configs) {
          const factory = new WorkerFactory(config.func, {
            mode: WorkerMode.Pipeline,
            createWorker: config.createWorker,
          });
          workers.push(context.trackWorker(factory.getWorker));
        }
      } catch (err) {
        inputReadPort?.close();
        fail(err);
        return;
      }

      if (inputReadPort) {
        // Read-only: the step reads its input over this port but sends its
        // result on through the pipeline, not into the MemoryWorker.
        workers[0].postMessage(
          {
            __init_memory_port__: true,
            factoryToken: context.factoryToken,
            storeResult: false,
          },
          [inputReadPort],
        );
      }

      // Create channels between adjacent workers
      const channels = workers.slice(1).map(() => new MessageChannel());

      // Wire up: each worker (except last) gets an output port,
      // each worker (except first) gets an input port.
      for (let stepIndex = 0; stepIndex < workers.length; stepIndex++) {
        const {
          worker: _workerName,
          srcData: _sourceData,
          ...stepParams
        } = steps[stepIndex];
        if (stepIndex === 0) {
          // Step 0's ref has been resolved into its input above.
          delete stepParams.__memory_ref__;
          delete stepParams.deleteMemory;
        }
        const transferList: Transferable[] = [];
        const ports: { inputPort?: MessagePort; outputPort?: MessagePort } = {};

        if (stepIndex > 0) {
          ports.inputPort = channels[stepIndex - 1].port1;
          transferList.push(ports.inputPort);
        }
        if (stepIndex < workers.length - 1) {
          ports.outputPort = channels[stepIndex].port2;
          transferList.push(ports.outputPort);
        }

        // Wiring message — only needed when there are ports to connect. A
        // single-step pipeline gets exactly one message (its payload), which
        // keeps hand-written native workers working unchanged.
        if (transferList.length > 0) {
          workers[stepIndex].postMessage(
            { __pipeline_ports__: true, stepParams, ...ports },
            transferList,
          );
        }

        const stepName = steps[stepIndex].worker;
        workers[stepIndex].onerror = (event) => {
          markErrorHandled(event);
          context.logger.error(
            `Pipeline step ${stepName} encountered an error event`,
            event,
          );
          fail(errorFromEvent(event, `Pipeline step "${stepName}" failed`));
        };

        if (stepIndex < workers.length - 1) {
          // Fallback relay for plain native workers that post messages to the main thread
          const nextWorker = workers[stepIndex + 1];
          const {
            worker: _nextWorkerName,
            srcData: _nextSourceData,
            ...nextParams
          } = steps[stepIndex + 1];

          workers[stepIndex].onmessage = (event) => {
            if (event.data && event.data.__pipeline_ports__) return;

            if (event.data?.ok === false) {
              context.logger.error(
                `Pipeline step ${stepName} failed`,
                event.data.error,
              );
              fail(new Error(event.data.error));
              return;
            }

            const payloadData =
              event.data?.ok !== undefined ? event.data.data : event.data;
            const payload = { data: payloadData, ...nextParams, index: 0 };
            nextWorker.postMessage(payload, extractTransferable(payload));
          };
        }
      }

      // Listen for the final worker's result
      const lastWorker = workers[workers.length - 1];
      lastWorker.onmessage = (event) => {
        if (event.data && event.data.__pipeline_ports__) return;
        noteMemoryInputReader(
          configs[configs.length - 1].createWorker,
          event.data,
        );
        if (event.data?.ok === false) {
          context.logger.error(`Final pipeline step failed`, event.data.error);
          fail(new Error(event.data.error));
        } else {
          succeed(replyData(event.data) as TResult);
        }
      };

      // Kick off the first worker with srcData and stepParams
      const firstPayload = {
        data: firstPayloadData,
        ...initialParams,
        index: 0,
      };
      context.logger.verbose(`Starting pipeline with ${steps.length} step(s)`);
      try {
        workers[0].postMessage(firstPayload, extractTransferable(firstPayload));
      } catch (err) {
        fail(err);
      }
    });
  }
}
