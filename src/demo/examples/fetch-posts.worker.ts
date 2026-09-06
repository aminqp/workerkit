/**
 * Fetches posts from a public REST API and enriches each post with a
 * word-count derived from its body — all off the main thread.
 */

export interface Post {
  userId: number;
  id: number;
  title: string;
  body: string;
}

export interface EnrichedPost extends Post {
  wordCount: number;
  titleCase: string;
}

export async function fetchAndEnrichPosts({
  data,
}: {
  data: { limit: number };
}): Promise<EnrichedPost[]> {
  const { limit } = Array.isArray(data) ? data[0] : data;

  const response = await fetch(
    `https://jsonplaceholder.typicode.com/posts?_limit=${limit}`,
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const posts: Post[] = await response.json();

  return posts.map((post) => ({
    ...post,
    wordCount: post.body.trim().split(/\s+/).length,
    titleCase: post.title.replace(/\b\w/g, (c) => c.toUpperCase()),
  }));
}
