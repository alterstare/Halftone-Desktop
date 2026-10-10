import { useEffect, useState } from 'react'
import type { GallerySummary } from '../../shared/ipc'
import { useStore } from './store'

// Main fetches summaries (title / thumbnail / tags) through one background
// queue — saved as it goes, resumed after a restart. Mirror its progress as
// ONE activity-bar row. Wired once in App.
let syncJob: string | null = null
export function watchSummarySync(): () => void {
  // Summaries main fetched (in the background, or after a screen already asked
  // and got nothing yet) → straight into this cache, re-rendering subscribers.
  const offArrived = window.api.onSummaryArrived((list) => {
    for (const g of list) cache.set(g.code, g)
    notify()
  })
  const offSync = window.api.onSummarySync(({ done, total, running }) => {
    const { startJob, updateJob, endJob } = useStore.getState()
    if (running && total > 0) {
      if (!syncJob) syncJob = startJob('meta', 'doujin', '즐겨찾기 정보 불러오기 (제목·썸네일·태그)')
      updateJob(syncJob, { done, total })
    } else if (!running && syncJob) {
      endJob(syncJob, { status: 'done', done, total, detail: `${done}개` })
      syncJob = null
    }
  })
  return () => {
    offArrived()
    offSync()
  }
}

// Summaries for `codes`, requested in chunks so the screen fills in as each
// chunk arrives instead of waiting for thousands at once.
const CHUNK = 60
export function fetchSummaries(
  codes: string[],
  onChunk?: (list: GallerySummary[]) => void
): Promise<GallerySummary[]> {
  const chunks: string[][] = []
  for (let i = 0; i < codes.length; i += CHUNK) chunks.push(codes.slice(i, i + CHUNK))
  return Promise.all(
    chunks.map((c) =>
      window.api.doujinSummaries(c).then((list) => {
        onChunk?.(list)
        return list
      })
    )
  ).then((parts) => parts.flat())
}

// Online favorites are stored without tags (just title/artist/thumb). Fetch the
// full gallery summary (tags etc.) for favorite codes once, cache it for the
// session, and re-render subscribers when new summaries land.
const cache = new Map<string, GallerySummary>()
const pending = new Set<string>()
const listeners = new Set<() => void>()
// Re-render subscribers at most every 150ms: summaries land in many small
// batches, and each notify re-filters / re-sorts the whole favorites list.
let notifyTimer: ReturnType<typeof setTimeout> | null = null
function notify(): void {
  if (notifyTimer) return
  notifyTimer = setTimeout(() => {
    notifyTimer = null
    listeners.forEach((fn) => fn())
  }, 150)
}

// Languages of favorites (code → language), for the 언어 분류 filter without
// loading every summary. Filled in bulk from main, then from arrivals.
const langs = new Map<string, string | null>()
export function getFavLanguage(code: string): string | null | undefined {
  return langs.has(code) ? langs.get(code) : cache.get(code)?.language
}
export async function loadFavLanguages(codes: string[]): Promise<void> {
  const need = codes.filter((c) => !langs.has(c) && !cache.has(c))
  if (!need.length) return
  const map = await window.api.favLanguages(need)
  for (const [c, l] of Object.entries(map)) langs.set(c, l)
  notify()
}

export function getFavSummary(code: string): GallerySummary | undefined {
  return cache.get(code)
}

function request(codes: string[]): void {
  const need = codes.filter((c) => /^\d+$/.test(c) && !cache.has(c) && !pending.has(c))
  if (!need.length) return
  need.forEach((c) => pending.add(c))
  fetchSummaries(need, (list) => {
    for (const g of list) cache.set(g.code, g)
    notify()
  })
    .catch(() => {})
    .finally(() => {
      need.forEach((c) => pending.delete(c))
      notify()
    })
}

// Subscribe to summaries for these codes; returns a version number that bumps
// whenever new data arrives (use it as a memo dependency).
export function useFavSummaries(codes: string[]): number {
  const [ver, setVer] = useState(0)
  useEffect(() => {
    const fn = (): void => setVer((v) => v + 1)
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])
  const key = codes.join(',')
  useEffect(() => {
    request(codes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return ver
}
