//TIP With Search Everywhere, you can find any action, file, or symbol in your project. Press <shortcut actionId="Shift"/> <shortcut actionId="Shift"/>, type in <b>terminal</b>, and press <shortcut actionId="EditorEnter"/>. Then run <shortcut raw="npm run dev"/> in the terminal and click the link in its output to open the app in the browser.

import initiator from './workers/initiator.ts';
import expensiveComputation1 from './examples/expensive-computation.ts';
import { MainWorkerFactory, WorkerConfig } from './tools';

function handleWorkers(workers: WorkerConfig[]): void {
  const worker = new MainWorkerFactory(initiator, { workers });

  // worker.initWorkers();

  console.log(worker);
  const btn = document.getElementById('increaseByOne')!;

  btn.onclick = () => {
    worker.runWorker('exp1', { seconds: 10 }).then((res) => {
      console.log(`\n\n<<<<< btn.onclick  >>>>> => res -> `, res);
    });
  };
}

handleWorkers([
  {
    name: 'exp1',
    role: 'computation',
    func: expensiveComputation1,
    maxConcurrency: 4,
  },
]);
