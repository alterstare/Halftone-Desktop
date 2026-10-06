import type { ComicChapter } from '../../shared/ipc'

// Cache the sibling-chapter list per series so the reader's left list and its
// prev/next buttons share one (slow, queued) scrape instead of fetching twice.
const cache = new Map<string, Promise<ComicChapter[]>>()

export function getComicChapters(seriesUrl: string): Promise<ComicChapter[]> {
  let p = cache.get(seriesUrl)
  if (!p) {
    p = window.api.comicChapters(seriesUrl)
    cache.set(seriesUrl, p)
    p.catch(() => cache.delete(seriesUrl)) // let a failed scrape retry later
  }
  return p
}
