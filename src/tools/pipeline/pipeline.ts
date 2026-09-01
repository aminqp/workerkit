import { PipelineStep } from '../main-worker-factory/types';
import { WorkerFactory } from '../worker-factory';
import { WorkerMode } from '../worker-factory/worker-factory';
import { extractTransferable } from '../extract-transferable';
import { PipelineContext } from './types';

export async function executePipeline<TResult = unknown>(
  steps: PipelineStep[],
  context: PipelineContext,
): Promise<TResult> {
  if (context.isTerminated()) {
    context.logger.error(
      'Attempted to execute pipeline after MainWorkerFactory was terminated',
    );
    throw new Error('MainWorkerFactory has been terminated');
  }

  if (steps.length === 0) {
    context.logger.error('Attempted to execute an empty pipeline');
    throw new Error('Pipeline requires at least one step');
  }

  if (steps.length === 1) {
    const step = steps[0];
    const { worker: _workerName, srcData, ...stepParams } = step;
    const config = context.findWorkerByName(step.worker);
    if (!config) {
      context.logger.error(
        `Pipeline step config not found for worker: "${step.worker}"`,
      );
      throw new Error(`Worker "${step.worker}" not found`);
    }
    const factory = new WorkerFactory(config.func, {
      createWorker: config.createWorker,
    });
    context.trackWorker(factory.getWorker);
    const raw = factory.getWorker;

    return new Promise<TResult>((resolve, reject) => {
      raw.onmessage = (event) => {
        context.terminateWorker(raw);
        if (event.data?.ok === false) {
          context.logger.error(
            `Pipeline step ${step.worker} failed`,
            event.data.error,
          );
          reject(new Error(event.data.error));
        } else resolve(event.data?.data as TResult);
      };
      raw.onerror = (event) => {
        context.terminateWorker(raw);
        context.logger.error(
          `Pipeline step ${step.worker} encountered an error event`,
          event,
        );
        reject(event);
      };
      const payloadData = srcData ?? {};
      const payload = { data: payloadData, ...stepParams, index: 0 };
      context.logger.verbose(
        `Starting single-step pipeline for worker ${step.worker}`,
      );
      raw.postMessage(payload, extractTransferable(payload));
    });
  }

  // Build the pipeline: connect workers via MessageChannels
  return new Promise<TResult>((resolve, reject) => {
    const workers: Worker[] = [];
    const channels: MessageChannel[] = [];

    // Create all workers
    for (const step of steps) {
      const config = context.findWorkerByName(step.worker);
      if (!config) {
        context.logger.error(
          `Pipeline step config not found for worker: "${step.worker}"`,
        );
        reject(new Error(`Worker "${step.worker}" not found`));
        return;
      }
      const factory = new WorkerFactory(config.func, {
        mode: WorkerMode.Pipeline,
        createWorker: config.createWorker,
      });
      const raw = context.trackWorker(factory.getWorker);
      workers.push(raw);
    }

    // Create channels between adjacent workers
    for (
      let channelIndex = 0;
      channelIndex < workers.length - 1;
      channelIndex++
    ) {
      channels.push(new MessageChannel());
    }

    // Wire up: each worker (except last) gets an output port
    // Each worker (except first) gets an input port
    for (let stepIndex = 0; stepIndex < workers.length; stepIndex++) {
      const {
        worker: _workerName,
        srcData: _sourceData,
        ...stepParams
      } = steps[stepIndex];
      const transferList: Transferable[] = [];
      const ports: { inputPort?: MessagePort; outputPort?: MessagePort } = {};

      if (stepIndex > 0) {
        // Receive input from previous worker's channel
        ports.inputPort = channels[stepIndex - 1].port1;
        transferList.push(ports.inputPort);
      }

      if (stepIndex < workers.length - 1) {
        // Send output to next worker's channel
        ports.outputPort = channels[stepIndex].port2;
        transferList.push(ports.outputPort);
      }

      // Send ports to the worker for pipeline wiring
      workers[stepIndex].postMessage(
        { __pipeline_ports__: true, stepParams, ...ports },
        transferList,
      );

      // Fallback relay for plain native workers that post messages to the main thread
      if (stepIndex < workers.length - 1) {
        const currentWorker = workers[stepIndex];
        const nextWorker = workers[stepIndex + 1];
        const {
          worker: _nextWorkerName,
          srcData: _nextSourceData,
          ...nextParams
        } = steps[stepIndex + 1];

        currentWorker.onmessage = (event) => {
          if (event.data && event.data.__pipeline_ports__) return;

          if (event.data?.ok === false) {
            context.logger.error(
              `Pipeline step ${steps[stepIndex].worker} failed`,
              event.data.error,
            );
            workers.forEach((worker) => context.terminateWorker(worker));
            reject(new Error(event.data.error));
            return;
          }

          const payloadData =
            event.data?.ok !== undefined ? event.data.data : event.data;
          const payload = { data: payloadData, ...nextParams, index: 0 };
          nextWorker.postMessage(payload, extractTransferable(payload));
        };

        currentWorker.onerror = (event) => {
          context.logger.error(
            `Pipeline step ${steps[stepIndex].worker} encountered an error event`,
            event,
          );
          workers.forEach((worker) => context.terminateWorker(worker));
          reject(event);
        };
      }
    }

    // Listen for the final worker's result
    const lastWorker = workers[workers.length - 1];
    lastWorker.onmessage = (event) => {
      // Terminate all workers
      workers.forEach((worker) => context.terminateWorker(worker));
      if (event.data?.ok === false) {
        context.logger.error(`Final pipeline step failed`, event.data.error);
        reject(new Error(event.data.error));
      } else resolve(event.data?.data as TResult);
    };
    lastWorker.onerror = (event) => {
      workers.forEach((worker) => context.terminateWorker(worker));
      context.logger.error(
        `Final pipeline step encountered an error event`,
        event,
      );
      reject(event);
    };

    // Kick off the first worker with srcData and stepParams
    const {
      worker: _firstWorkerName,
      srcData: initialData,
      ...initialParams
    } = steps[0];

    let firstPayloadData = initialData;
    const memoryRef = initialParams.__memory_ref__ as string | undefined;
    const shouldDeleteMemory = Boolean(initialParams.deleteMemory);

    if (firstPayloadData === undefined && memoryRef) {
      if (!context.memoryStore.has(memoryRef)) {
        workers.forEach((w) => context.terminateWorker(w));
        context.logger.error(
          `Memory reference "${memoryRef}" not found in MemoryStore`,
        );
        reject(
          new Error(`Memory reference "${memoryRef}" not found in MemoryStore`),
        );
        return;
      }
      firstPayloadData = context.memoryStore.get(memoryRef);
      if (shouldDeleteMemory) {
        context.memoryStore.delete(memoryRef);
      }
      delete initialParams.__memory_ref__;
      delete initialParams.deleteMemory;
    }
    if (firstPayloadData === undefined) {
      firstPayloadData = {};
    }

    const firstPayload = {
      data: firstPayloadData,
      ...initialParams,
      index: 0,
    };
    context.logger.verbose(`Starting full pipeline with ${steps.length} steps`);
    workers[0].postMessage(firstPayload, extractTransferable(firstPayload));
  });
}
