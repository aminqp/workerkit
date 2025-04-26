import {
  MainWorkerFactoryOptions,
  MainWorkerFactoryWorker,
  WorkerConfig,
  WorkerFunction,
  WorkerInstanceConfig,
  WorkerResult,
} from './types.ts';
import { WorkerFactory } from '../worker-factory';

enum RESULT_STATUS {
  FULFILLED = 'fulfilled',
  REJECTED = 'rejected',
}

const threadHasError = function () {
  let seconds = 5;
  seconds *= Math.random() + 0.5;
  let start = new Date();
  while ((new Date().valueOf() - start.valueOf()) / 1000 < seconds);

  throw new Error('someErrorThread');
};

class MainWorkerFactory {
  private readonly _worker: Worker;
  private readonly _workers: MainWorkerFactoryOptions['workers'];
  private _activeWorkers: MainWorkerFactoryWorker[] = [];
  private _workersResult: unknown[] = [];
  private readonly _threads: number;

  constructor(workerFunction: any, options: MainWorkerFactoryOptions) {
    const workerCode: string = workerFunction.toString();
    const workerBlob = new Blob([`(${workerCode})()`], {
      type: 'application/javascript',
    });

    this._workers = options.workers;
    this._worker = new Worker(URL.createObjectURL(workerBlob));

    this._threads = navigator.hardwareConcurrency;
  }

  initWorkers() {
    this._activeWorkers = this._workers.map((worker) => ({
      ...worker,
      worker: new WorkerFactory(worker.func),
    }));
  }

  initWorker(workerFunction: WorkerFunction) {
    return new WorkerFactory(workerFunction);
  }

  /**
   * Partitions an array into a specified number of chunks
   * @param array The array to partition
   * @param numChunks The number of chunks to create
   * @returns An array of chunks
   */
  partitionArray<T>(array: T[], numChunks: number): T[][] {
    if (!array.length) return [];
    if (numChunks <= 0) throw new Error('Number of chunks must be positive');
    if (numChunks === 1) return [array.slice()];

    // Ensure we don't create more chunks than there are elements
    const validChunks = Math.min(numChunks, array.length);
    const result: T[][] = [];

    // Calculate minimum size per chunk
    const chunkSize = Math.floor(array.length / validChunks);
    // Calculate how many chunks get an extra element
    const remainder = array.length % validChunks;

    let startIndex = 0;

    for (let i = 0; i < validChunks; i++) {
      // Add one extra item to the first 'remainder' chunks
      const currentChunkSize = chunkSize + (i < remainder ? 1 : 0);
      const endIndex = startIndex + currentChunkSize;

      result.push(array.slice(startIndex, endIndex));
      startIndex = endIndex;
    }

    return result;
  }

  /**
   * Runs a worker with the specified name and input data
   * @param workerName The name of the worker to run
   * @param data The data to process
   * @returns A promise that resolves with the worker results
   */
  async runWorker(
    workerName: string,
    {
      srcData,
      ...otherParams
    }: { srcData: unknown | unknown[] } & Record<string, unknown>,
  ): Promise<PromiseSettledResult<WorkerResult>[]> {
    console.log('\n\n <<<<  runWorker >>>> => srcData -> ', srcData);
    const foundWorker = this.findWorkerByName(workerName);

    if (!foundWorker) {
      const error = new Error(`Worker ${workerName} not found`);
      return Promise.reject(error);
    }

    const threadCount = foundWorker.maxConcurrency || this._threads;
    const shouldPartition = Boolean(
      Array.isArray(srcData) && srcData.length > 1 && foundWorker.partition,
    );

    // Prepare data for worker(s)
    const processedData = shouldPartition
      ? this.partitionArray(srcData as unknown[], threadCount)
      : srcData;

    // Initialize and execute workers
    const workerPromises = this.createWorkerPromises(
      foundWorker,
      workerName,
      { data: processedData, ...otherParams },
      threadCount,
      shouldPartition,
    );

    return Promise.allSettled(workerPromises);
  }

  /**
   * Finds a worker by name
   * @param workerName The name of the worker to find
   * @returns The worker configuration if found, otherwise undefined
   */
  private findWorkerByName(workerName: string) {
    return this._workers.find((worker) => worker.name === workerName);
  }

  /**
   * Creates promises for each worker instance
   * @param workerConfig The worker configuration
   * @param workerName The name of the worker
   * @param srcWorkerData
   * @param threadCount The number of threads to use
   * @param isPartitioned Whether the data is partitioned
   * @returns An array of promises for the worker executions
   */
  private createWorkerPromises(
    workerConfig: WorkerConfig,
    workerName: string,
    srcWorkerData: { data: unknown | unknown[][] } & Partial<
      Record<string, unknown>
    >,
    threadCount: number,
    isPartitioned: boolean,
  ): Promise<WorkerResult>[] {
    const { data: srcData, ...otherParams } = srcWorkerData;
    return Array(threadCount)
      .fill(0)
      .map((_, index) => {
        const workerData =
          isPartitioned && Array.isArray(srcData) ? srcData[index] : srcData;

        return this.runWorkerWithRetry(
          {
            workerFunc: workerConfig.func,
            workerName,
            index,
            data: { data: workerData, ...otherParams },
          },
          workerConfig.retries,
        );
      });
  }

  runWorkerWithRetry(
    workerConfigs: WorkerInstanceConfig,
    retryCount = 2,
  ): Promise<WorkerResult> {
    console.log(
      '\n\n <<<<  runWorkerWithRetry >>>> => workerConfigs -> ',
      workerConfigs,
    );
    return this.initiateWorker(workerConfigs)
      .then((result: WorkerResult) => {
        return Promise.resolve(result);
      })
      .catch((error) => {
        if (retryCount > 0) {
          console.error(
            `Worker ${workerConfigs.index} failed, retrying (${retryCount} attempts remaining):`,
            error,
          );
          return this.runWorkerWithRetry(
            {
              ...workerConfigs,
              index: workerConfigs.index,
              // workerConfigs.index === 3
              //   ? workerConfigs.index - 1
              //   : workerConfigs.index,
            },
            retryCount - 1,
          );
        } else {
          console.error(`Worker failed after multiple retries:`, error);
          return Promise.reject(error); // Re-throw the error after exhausting retries
        }
      });
  }

  initiateWorker({
    workerFunc,
    workerName,
    index,
    data,
  }: WorkerInstanceConfig): Promise<WorkerResult> {
    return new Promise((resolve, reject) => {
      // let worker = this.initWorker(workerFunc);

      let worker = this.initWorker(workerFunc);
      // index % 2 === 0
      //   ? this.initWorker(workerFunc)
      //   : this.initWorker(threadHasError);

      // TODO-qp:: handle failed threads
      worker.getWorker.onerror = (event) => {
        worker.getWorker.terminate();
        reject({
          index,
          workerConfigs: {
            workerFunc,
            workerName,
            index,
            data,
          },
          failedResult: event,
        });
      };

      worker.getWorker.onmessage = (event) => {
        // this.catchResult({
        //   workerResult: event.data,
        //   index,
        //   resolve,
        // });

        resolve({
          index,
          workerConfigs: {
            workerFunc,
            workerName,
            index,
            data,
          },
          successResult: event,
        });
        worker.getWorker.terminate();
      };

      worker.getWorker.postMessage({
        index,
        ...(Array.isArray(data) ? { data } : data),
      });
    });
  }

  catchResult({
    workerResult,
    index,
    resolve,
  }: {
    workerResult: unknown;
    index: number;
    resolve: (value: unknown) => void;
  }) {
    this._workersResult[index] = workerResult;

    if (this._workersResult.length === this._threads) {
      console.log(`\n\n<<<<< IS FINISHED  >>>>> =>  -> `);
      resolve(this._workersResult);
    }
  }

  get getWorker() {
    return this._worker;
  }
}

export default MainWorkerFactory;
