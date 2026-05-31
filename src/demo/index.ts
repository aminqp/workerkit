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
import type { Foreman } from './ui-helpers';

export function initDemo(foreman: Foreman) {
  initExpCard(foreman);
  initGenCard(foreman);
  initTransformCard(foreman);
  initListCard(foreman);
  initImageCard(foreman);
  initLogsCard(foreman);
  initDelayedCard(foreman);
  initFlakyCard(foreman);
  initPartialCard(foreman);
  initBenchCard(foreman);
  initFetchCard(foreman);
  initPipelineCard(foreman);
  initPipelineBenchCard(foreman);
  initPersistentCard(foreman);
  initPersistentBenchCard(foreman);
}
