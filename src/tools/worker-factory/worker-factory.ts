const workerTemplate = (func: string) => `
self.addEventListener('message', (event) => {
    var begin = performance.now();

    console.log('start');

    const output = ${func}(event.data);

    console.log('finish in', performance.now() - begin, 'ms');

    self.postMessage(output);
  })
`

class WorkerFactory {
  readonly _worker: Worker;

  constructor(workerFunction: any) {
    const workerCode: string = workerTemplate(workerFunction.toString());
    const workerBlob = new Blob([workerCode], {
      type: 'application/javascript',
    });

    this._worker = new Worker(URL.createObjectURL(workerBlob));
  }

  get getWorker() {
    return this._worker;
  }
}

export default WorkerFactory;
