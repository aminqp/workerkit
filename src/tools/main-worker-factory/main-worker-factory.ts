import {
  MainWorkerFactoryOptions,
  MainWorkerFactoryWorker,
  WorkerFunction,
} from './types.ts';
import { WorkerFactory } from '../worker-factory';

class MainWorkerFactory {
  private readonly _worker: Worker;
  private readonly _workers: MainWorkerFactoryOptions['workers'];
  private _activeWorkers: MainWorkerFactoryWorker[] = [];

  constructor(workerFunction: any, options: MainWorkerFactoryOptions) {
    const workerCode: string = workerFunction.toString();
    const workerBlob = new Blob([`(${workerCode})()`], {
      type: 'application/javascript',
    });

    this._workers = options.workers;
    this._worker = new Worker(URL.createObjectURL(workerBlob));
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

  runWorker(workerName: string, data: any) {
    return new Promise((resolve, reject) => {
      const foundWorker = this._workers.find(
        (worker) => worker.name === workerName,
      );
      if (!foundWorker) {
        reject(new Error(`Worker ${workerName} not found`));

        throw new Error(`Worker ${workerName} not found`);
      }

      const result: any = [];
      let isFinished = false;

      Array(foundWorker.maxConcurrency || 1)
        .fill(0)
        .forEach((_, idx) => {
          const worker = this.initWorker(foundWorker.func);

          worker.getWorker.onmessage = (event) => {
            console.log(
              `Worker ${workerName} finished with result: ${event.data}`,
            );
            result.push(event.data);

            console.log(
              `\n\n<<<<<  Array(foundWorker.maxConcurrency  >>>>> => idx === foundWorker.maxConcurrency -> `,
              idx,
              foundWorker.maxConcurrency,
              idx === foundWorker.maxConcurrency,
            );
            if (idx === foundWorker.maxConcurrency) {
              isFinished = true;
            }
            worker.getWorker.terminate();
          };

          worker.getWorker.postMessage(data);
        });

      console.log('>>> result', result);
      if (isFinished) {
        resolve(result);
      }
    });
  }

  get getWorker() {
    return this._worker;
  }
}

export default MainWorkerFactory;
