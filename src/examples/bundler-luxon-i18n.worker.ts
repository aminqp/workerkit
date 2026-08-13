/**
 * Worker script intended for module bundlers (Webpack 5, Vite, Rollup, Parcel).
 *
 * Demonstrates importing third-party modules (`luxon`, `i18next`) and external
 * application configuration modules (`./i18n.config.ts`) directly inside a Web Worker.
 *
 * When bundled via `new URL('./bundler-luxon-i18n.worker.ts', import.meta.url)`,
 * the module bundler bundles this worker along with all its external package dependencies
 * and application imports into a dedicated Web Worker asset chunk.
 */
import { DateTime } from 'luxon';
import i18next from './i18n.config.ts';

export interface DataPayload {
  items: { id: string; date: string; value: number }[];
  locale: string;
  delayMs?: number;
}

export interface TransformedItem {
  id: string;
  formattedDate: string;
  daysAgo: number;
  translatedCategory: string;
  translatedStatus: string;
  transformedValue: number;
}

// Standard worker message event listener expected by MainWorkerFactory
self.addEventListener('message', async (event) => {
  try {
    const payload = (event.data?.data ?? event.data) as DataPayload;

    // Artificial delay to make worker execution visibly active in DevTools and UI
    const delay = payload.delayMs ?? 1500;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const locale = payload.locale || 'en';

    const transformed: TransformedItem[] = (payload.items || []).map((item) => {
      // Use Luxon DateTime for parsing, formatting, and diffing
      const dt = DateTime.fromISO(item.date);
      const daysDiff = Math.abs(Math.round(dt.diffNow('days').days));

      // Use real i18next instance imported from external config module
      const categoryLabel = i18next.t('category', { lng: locale });
      const statusLabel = i18next.t('status', { lng: locale });

      return {
        id: item.id,
        formattedDate: dt.toFormat('yyyy-MM-dd HH:mm'),
        daysAgo: daysDiff,
        translatedCategory: categoryLabel,
        translatedStatus: statusLabel,
        transformedValue: Math.round(item.value * 100) / 100,
      };
    });

    self.postMessage({ ok: true, data: transformed });
  } catch (err) {
    self.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
