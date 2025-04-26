//TIP With Search Everywhere, you can find any action, file, or symbol in your project. Press <shortcut actionId="Shift"/> <shortcut actionId="Shift"/>, type in <b>terminal</b>, and press <shortcut actionId="EditorEnter"/>. Then run <shortcut raw="npm run dev"/> in the terminal and click the link in its output to open the app in the browser.

import initiator from './workers/initiator.ts';
import expensiveComputation1 from './examples/expensive-computation-1.ts';
import { MainWorkerFactory, WorkerConfig } from './tools';
import { transformArray } from './examples/list-transformer';
import { generateRandomData } from './examples/mocker';
import { listTransformArray } from './examples/large-list/list-transformer';
import {
  generateListTransformArrayTestData,
} from './examples/large-list/tools';

function setupWorkers(workers: WorkerConfig[]) {
  const foreman = new MainWorkerFactory(initiator, { workers });

  console.log(foreman);

  return { foreman };
}

const { foreman } = setupWorkers([
  {
    name: 'exp1',
    role: 'computation',
    func: expensiveComputation1,
    retries: 3,
    // maxConcurrency: navigator.hardwareConcurrency,
  },
  {
    name: 'generateRandomData',
    role: 'computation',
    func: generateRandomData,
    retries: 3,
    maxConcurrency: 13,
    // maxConcurrency: navigator.hardwareConcurrency,
  },
  {
    name: 'transformArray',
    role: 'computation',
    partition: true,
    func: transformArray,
    maxConcurrency: 8,
  },
  {
    name: 'generateListTransformArrayTestData',
    role: 'computation',
    partition: true,
    func: generateListTransformArrayTestData,
    maxConcurrency: 10,
  },
  {
    name: 'listTransformArray',
    role: 'computation',
    partition: true,
    func: listTransformArray,
  },
]);

const increaseByOneBtn = document.getElementById('increaseByOne')!;
const increaseByTwoBtn = document.getElementById('increaseByTwo')!;

increaseByOneBtn.onclick = () => {
  const begin = performance.now();
  console.log(`\n\n<<<<< THREAD IS STARTED  >>>>> =>  -> `);

  foreman.runWorker('exp1', { srcData: { seconds: 10 } }).then((res) => {
    console.log(`\n\n<<<<< btn.onclick  >>>>> => res -> `, res);
    console.log(
      `\n\n<<<<<  THREAD IS FINISHED IN >>>>> =>  -> `,
      performance.now() - begin,
      'ms',
    );
  });

  foreman
    .runWorker('generateRandomData', { srcData: {}, count: 300000 })
    .then((res) => {
      console.log(`\n\n<<<<< btn.onclick  >>>>> => res -> `, res);
      console.log(
        `\n\n<<<<<  THREAD IS FINISHED IN >>>>> =>  -> `,
        performance.now() - begin,
        'ms',
      );

      const testData = res.reduce(
        (acc, item) => [...acc, ...item.value.successResult.data],
        [],
      );
      foreman
        .runWorker('transformArray', {
          srcData: testData,
          options: {
            prefix: 'prefix',
            suffix: 'suffix',
            currency: 'currency',
            uppercase: 'uppercase',
            lowercase: 'lowercase',
            round: 'round',
            multiplier: 'multiplier',
            join: 'join',
          },
        })
        .then((res) => {
          console.log(`\n\n<<<<< btn.onclick  >>>>> => res -> `, res);
          console.log(
            `\n\n<<<<<  THREAD IS FINISHED IN >>>>> =>  -> `,
            performance.now() - begin,
            'ms',
          );
        });
    });
};

increaseByTwoBtn.onclick = () => {
  const begin = performance.now();
  console.log(`\n\n<<<<< THREAD IS STARTED  >>>>> =>  -> `);

  foreman
    .runWorker('generateListTransformArrayTestData', { srcData: {}, count: 30000 })
    .then((res) => {
      console.log(`\n\n<<<<< btn.onclick  >>>>> => res -> `, res);
      const testData = res.reduce(
        (acc, item) => [...acc, ...item.value.successResult.data],
        [],
      );

      console.log('\n\n <<<<  generateListTransformArrayTestData >>>> => testData -> ', testData);

      foreman
        .runWorker('listTransformArray', {
          srcData: testData,
          // options: { },
        })
        .then((res) => {
          const result = res.reduce(
            (acc, item) => [...acc, ...item.value.successResult.data],
            [],
          );
          console.log(`\n\n<<<<< btn.onclick  >>>>> => result -> `, result);
          console.log(
            `\n\n<<<<<  THREAD IS FINISHED IN >>>>> =>  -> `,
            performance.now() - begin,
            'ms',
          );
        });
    });
};
