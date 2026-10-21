// 감시 다운로드: settings.watchTokens are artist / tag search tokens; on each app
// start the renderer asks for galleries uploaded since the last check and
// queues their downloads. Only works newer than the last check count: the first
// check of a token just records "now" (its newest id + the time), so adding a
// watch never pulls the artist's back catalogue, and a work the user deleted
// is older than the last check, so it is never fetched again.
import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { WatchHit } from '../../shared/ipc'
import type { WatchLanguage } from '../../shared/types'
import { store } from '../context'
import { fetchRawGallery, fetchTokenIds } from './doujin'

interface WatchState {
  seen: Record<string, number> // token → newest gallery id at the last check
  since?: Record<string, number> // token → time of its first check (ms)
  got?: string[] // codes this feature already queued — never queued twice
}

const file = (): string => join(app.getPath('userData'), 'watch.json')

async function load(): Promise<WatchState> {
  try {
    return JSON.parse(await fs.readFile(file(), 'utf-8')) as WatchState
  } catch {
    return { seen: {} }
  }
}

async function save(st: WatchState): Promise<void> {
  const tmp = file() + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(st), 'utf-8')
  await fs.rename(tmp, file())
}

// Gallery language → the watch language keys (한국어/영어/일본어/기타).
function langKey(lang: string | null | undefined): WatchLanguage {
  const l = (lang ?? '').toLowerCase()
  return l === 'korean' || l === 'english' || l === 'japanese' ? l : 'other'
}

let running: Promise<WatchHit[]> | null = null

export function checkWatch(): Promise<WatchHit[]> {
  // Startup and the settings button may overlap — share one run.
  running ??= run().finally(() => (running = null))
  return running
}

// Gallery upload date ("2024-05-01 07:21:00-05") → ms, null if unparsable.
function uploadedAt(date: string | undefined): number | null {
  const t = date ? new Date(date).getTime() : NaN
  return Number.isFinite(t) ? t : null
}

// Upload-time slack for the first-check cutoff: the site indexes a gallery a
// little after its upload time, so one uploaded just before the first check can
// still be missing from that check's list.
const SLACK = 3_600_000

async function run(): Promise<WatchHit[]> {
  const s = store.settings
  const tokens = [...new Set((s.watchTokens ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))]
  const langs = new Set(s.watchLanguages ?? ['korean'])
  const st = await load()
  const since = (st.since ??= {})
  const got = new Set(st.got ?? [])
  // Forget removed tokens, so re-adding one later starts from "now" again.
  for (const k of Object.keys(st.seen)) if (!tokens.includes(k)) delete st.seen[k]
  for (const k of Object.keys(since)) if (!tokens.includes(k)) delete since[k]

  const have = new Set([...store.works.values()].map((w) => w.code).filter(Boolean))
  // Candidate id → earliest first-check time of the tokens that found it.
  const fresh = new Map<number, number>()
  const now = Date.now()
  for (const tok of tokens) {
    let ids: number[]
    try {
      ids = await fetchTokenIds(tok, 'all')
    } catch {
      continue // offline / address unset — try again next start
    }
    let max = 0
    for (const id of ids) if (id > max) max = id
    const base = st.seen[tok]
    if (base === undefined) {
      // First check: the baseline is now — nothing already uploaded downloads.
      st.seen[tok] = max
      since[tok] = now
      continue
    }
    since[tok] ??= now
    for (const id of ids) {
      const code = String(id)
      if (id <= base || have.has(code) || got.has(code)) continue
      fresh.set(id, Math.min(fresh.get(id) ?? Infinity, since[tok]))
    }
    if (max > base) st.seen[tok] = max
  }

  const hits: WatchHit[] = []
  const queue = [...fresh.keys()].sort((a, b) => a - b)
  // Language + upload date come from each gallery's metadata, 4 at a time.
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        try {
          const g = await fetchRawGallery(String(id))
          const at = uploadedAt(g.date)
          if (at !== null && at < fresh.get(id)! - SLACK) continue // uploaded before the watch began
          if (langs.has(langKey(g.language))) hits.push({ code: String(id), title: g.title })
        } catch {
          /* gallery gone or unreachable — skip */
        }
      }
    })
  )
  for (const h of hits) got.add(h.code)
  st.got = [...got].slice(-5000)
  await save(st)
  return hits.sort((a, b) => Number(a.code) - Number(b.code))
}
