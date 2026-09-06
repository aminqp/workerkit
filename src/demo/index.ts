import { initExpCard } from './cards/exp1';
import { initGenCard } from './cards/gen';
import { initTransformCard } from './cards/transform';
import { initListCard } from './cards/list';
import { initImageCard } from './cards/image';
import { initLogsCard } from './cards/logs';
import { initDelayedCard } from './cards/delayed';
import { initFlakyCard } from './cards/flaky';
import { initPartialCard } from './cards/partial';
import { initBenchCard } from './cards/bench';
import { initFetchCard } from './cards/fetch';
import { initPipelineCard } from './cards/pipeline';
import { initPipelineBenchCard } from './cards/pipeline-bench';
import { initPersistentCard } from './cards/persistent';
import { initPersistentBenchCard } from './cards/persistent-bench';
import { initBundlerCard } from './cards/bundler';
import { initWorkerInstanceCard } from './cards/worker-instance';
import { initNativePipelineCard } from './cards/native-pipeline';
import { initMemoryCard } from './cards/memory';

export function initDemo() {
  initExpCard();
  initGenCard();
  initTransformCard();
  initListCard();
  initImageCard();
  initLogsCard();
  initDelayedCard();
  initFlakyCard();
  initPartialCard();
  initBenchCard();
  initFetchCard();
  initPipelineCard();
  initPipelineBenchCard();
  initPersistentCard();
  initPersistentBenchCard();
  initBundlerCard();
  initWorkerInstanceCard();
  initNativePipelineCard();
  initMemoryCard();
}

// Initialize card listeners
initDemo();
