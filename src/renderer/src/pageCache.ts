// Online list pages (doujin index / search, manga-site lists): each fetched once
// and kept a few minutes, so the pages either side of the one shown can be
// loaded ahead and paging to them shows the list at once. A page still being
// fetched is shared (the click waits for the prefetch already under way).

const TTL = 5 * 60_000
const MAX = 40

type Entry = { at: number; p: Promise<unknown>; v?: unknown }
const cache = new Map<string, Entry>()

function live(key: string): Entry | undefined {
  const e = cache.get(key)
  if (e && Date.now() - e.at > TTL) {
    cache.delete(key)
    return undefined
  }
  return e
}

// The page's list: the cached one, the fetch under way, or a new fetch.
export function loadPage<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = live(key)
  if (hit) return hit.p as Promise<T>
  const e: Entry = { at: Date.now(), p: Promise.resolve() }
  e.p = fn().then(
    (v) => {
      e.v = v
      return v
    },
    (err) => {
      if (cache.get(key) === e) cache.delete(key) // a failure isn't kept
      throw err
    }
  )
  cache.set(key, e)
  while (cache.size > MAX) cache.delete(cache.keys().next().value!)
  return e.p as Promise<T>
}

// The page's list if it has already arrived (shown without a loader).
export function cachedPage<T>(key: string): T | undefined {
  return live(key)?.v as T | undefined
}

// Load pages ahead, errors ignored (the page itself shows them when opened).
export function prefetchPages(jobs: [string, () => Promise<unknown>][]): void {
  for (const [key, fn] of jobs) loadPage(key, fn).catch(() => {})
}

// A forced reload (🌐 pressed again): drop the cached pages whose key starts so.
export function dropPages(prefix: string): void {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k)
}
