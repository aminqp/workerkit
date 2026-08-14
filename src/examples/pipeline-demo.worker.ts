/**
 * Pipeline demo: fetch → transform → filter
 *
 * These workers are designed to be chained via `foreman.pipeline()`.
 * Data flows directly between workers without touching the main thread.
 */

export interface Post {
  userId: number;
  id: number;
  title: string;
  body: string;
}

export interface EnrichedPost {
  id: number;
  title: string;
  titleUpperCase: string;
  wordCount: number;
  bodyPreview: string;
}

export interface FilteredPost extends EnrichedPost {
  isLong: boolean;
}

/**
 * Step 1: Fetch posts from an API
 */
export function fetchPosts({
  data,
}: {
  data: { limit: number };
}): Promise<Post[]> {
  return fetch(
    `https://jsonplaceholder.typicode.com/posts?_limit=${data.limit}`,
  ).then((res) => res.json());
}

/**
 * Step 2: Transform raw posts into enriched format
 * Receives the output of fetchPosts directly via MessageChannel
 */
export function transformPosts({ data }: { data: Post[] }): EnrichedPost[] {
  return data.map((post) => ({
    id: post.id,
    title: post.title,
    titleUpperCase: post.title.toUpperCase(),
    wordCount: post.body.split(/\s+/).length,
    bodyPreview: post.body.slice(0, 80) + '…',
  }));
}

/**
 * Step 3: Filter to only posts with more than 10 words
 * Receives the output of transformPosts directly via MessageChannel
 */
export function filterPosts({
  data,
  options,
}: {
  data: EnrichedPost[];
  options?: { minWords?: number };
}): FilteredPost[] {
  const minWords = options?.minWords ?? 10;
  return data
    .filter((post) => post.wordCount > minWords)
    .map((post) => ({ ...post, isLong: post.wordCount > 20 }));
}
