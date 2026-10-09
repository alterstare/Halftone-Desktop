import { hasExclusions, filterExcluded, getExcluded } from './exclude'
import { isComicCode } from './util'

// Caches the per-work image url list so thumbnails and the reader share one
// readdir round-trip. Cleared entries reload on demand.
const cache = new Map<string, Promise<string[]>>()
// Reverse index (page src → its work and position), filled as lists load, so
// translation can find a page's previous page and its work's character notes.
const pageIndex = new Map<string, { workId: string; idx: number; srcs: string[] }>()

export function getImages(workId: string): Promise<string[]> {
  let p = cache.get(workId)
  if (!p) {
    p = window.api.getWorkImages(workId).then((srcs) => {
      srcs.forEach((s, idx) => pageIndex.set(s, { workId, idx, srcs }))
      return srcs
    })
    cache.set(workId, p)
  }
  return p
}

export function pageOf(src: string): { workId: string; idx: number; srcs: string[] } | undefined {
  return pageIndex.get(src)
}

export function invalidate(workId: string): void {
  cache.delete(workId)
}

export async function getCover(workId: string): Promise<string | null> {
  const imgs = await getImages(workId)
  if (!imgs.length) return null
  if (!hasExclusions()) return imgs[0]
  // Use the first page that isn't a registered/excluded image.
  const kept = await filterExcluded(imgs.slice(0, 6), getExcluded())
  return kept[0] ?? imgs[0]
}

// Online (streamed) gallery image urls, keyed by doujin code.
const onlineCache = new Map<string, Promise<string[]>>()

export function getOnlineImages(code: string): Promise<string[]> {
  let p = onlineCache.get(code)
  if (!p) {
    // A manga-site "code" is the chapter viewer URL (http…); a doujin code is numeric.
    p = isComicCode(code) ? window.api.comicReadUrls(code) : window.api.doujinReadUrls(code)
    onlineCache.set(code, p)
  }
  return p
}

// 다시 불러오기: drop the cached list and fetch it again, reloading the
// chapter page (a page list cut short by the site's lazy viewer, or a dead
// image host the site has since swapped out).
export function reloadOnlineImages(code: string): Promise<string[]> {
  const p = isComicCode(code) ? window.api.comicReadUrls(code, true) : window.api.doujinReadUrls(code)
  onlineCache.set(code, p)
  return p
}
