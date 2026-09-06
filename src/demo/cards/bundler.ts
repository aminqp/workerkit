import { setRunning, setDone, setError } from '../ui-helpers';

import { foreman } from '../demo.ts';

export function initBundlerCard() {
  const btn = document.getElementById(
    'btn-bundler',
  ) as HTMLButtonElement | null;
  if (!btn) return;

  btn.onclick = async () => {
    const begin = performance.now();
    setRunning('bundler', btn);
    try {
      const { data } = await foreman.runWorker('bundlerLuxonI18n', {
        srcData: {
          locale: 'es',
          items: [
            { id: 'tx-101', date: '2026-08-01T10:00:00Z', value: 1250.509 },
            { id: 'tx-102', date: '2026-08-10T14:30:00Z', value: 89.99 },
            { id: 'tx-103', date: '2026-08-12T09:15:00Z', value: 450.0 },
          ],
        },
      });

      const lines = [
        `${data.length} items transformed in worker with Luxon & i18next:`,
        '',
        ...data.map(
          (it) =>
            `[${it.id}] ${it.translatedCategory} (${it.translatedStatus})\n     Luxon Date: ${it.formattedDate} (${it.daysAgo} days ago) | Val: $${it.transformedValue}`,
        ),
      ];
      setDone('bundler', btn, performance.now() - begin, lines.join('\n'));
    } catch (e) {
      setError('bundler', btn, e);
    }
  };
}
