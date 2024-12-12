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
      const threads =
        foundWorker.maxConcurrency || navigator.hardwareConcurrency;

      const someErrorThread = function () {
        let counter = 0
        while (counter < 99999){
          counter += 1
        };
        throw new Error('someErrorThread');
      }

      Array(threads)
        .fill(0)
        .forEach((_,idx) => {
          // let worker = idx !== 3 ? this.initWorker(foundWorker.func) : this.initWorker(someErrorThread);
          let worker = this.initWorker(foundWorker.func)

          // TODO-qp:: handle failed threads
          worker.getWorker.onerror = (event) => {
            console.log(`\n\n<<<<<  worker.getWorker.onerror >>>>> => event -> `, event);
            worker.getWorker.terminate();

            worker = this.initWorker(foundWorker.func);
            console.log(`\n\n<<<<<  worker.getWorker.onerror >>>>> => worker -> `, worker);
          }

          worker.getWorker.onmessage = (event) => {
            console.log(
              `Worker ${workerName} finished with result: ${event.data}`,
            );
            result.push(event.data);

            if (result.length === threads) {
              console.log(`\n\n<<<<< IS FINISHED  >>>>> =>  -> `);
              resolve(result);
            }
            worker.getWorker.terminate();
          };

          worker.getWorker.postMessage(data);
        });
    });
  }

  get getWorker() {
    return this._worker;
  }
}

export default MainWorkerFactory;
