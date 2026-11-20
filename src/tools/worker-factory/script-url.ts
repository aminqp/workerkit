/**
 * `blob:` URLs for generated worker scripts, one per distinct script.
 *
 * Every `blob:` URL keeps its script in memory until the page unloads or the
 * URL is revoked. Creating a fresh URL for every worker would grow memory
 * with every call in a long-lived app (each run starts one worker per
 * thread), so workers running the same script share one URL. The number of
 * URLs is bounded by the number of distinct worker functions.
 */
const urls = new Map<string, string>();

/**
 * Returns the `blob:` URL for a worker script, creating it on first use.
 *
 * @param source - The complete worker script.
 */
export function scriptUrl(source: string): string {
  let url = urls.get(source);
  if (url === undefined) {
    url = URL.createObjectURL(
      new Blob([source], { type: 'application/javascript' }),
    );
    urls.set(source, url);
  }
  return url;
}

/**
 * Revokes every cached URL and empties the cache. Workers that are already
 * running are unaffected. Intended for tests.
 */
export function forgetScriptUrls(): void {
  for (const url of urls.values()) URL.revokeObjectURL?.(url);
  urls.clear();
}
