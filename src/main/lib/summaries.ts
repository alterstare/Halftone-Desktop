// On-disk cache of doujin gallery summaries (title, thumb, tags…) keyed by
// gallery code — userData/onlineSummaries.json. Online favorite lists and the
// unified favorites view render from it, so a list seen once shows instantly
// instead of re-fetching every gallery.
//
// Fetching runs through ONE shared queue (CONCURRENCY at a time) so callers
// asking for overlapping codes never fetch twice. The cache is saved every few
// seconds while it runs — leaving the screen or quitting keeps what arrived,
// and resumeFavoriteSummaries() picks the rest up on the next start. Overall
// progress goes to the activity bar via setSummaryProgressHandler.
import { app } from 'electron'
import { join } from 'path'
import { promises as fs, writeFileSync, renameSync, existsSync } from 'fs'
import type { GallerySummary } from '../../shared/ipc'
import { summary } from './doujin'
import { encodeWeb } from './media'

const FILE = (): string => join(app.getPath('userData'), 'onlineSummaries.json')
const CONCURRENCY = 6
const SAVE_MS = 2000

let cache: Record<string, GallerySummary> | null = null

async function load(): Promise<Record<string, GallerySummary>> {
  if (cache) return cache
  try {
    cache = JSON.parse(await fs.readFile(FILE(), 'utf-8'))
    // Older entries for renumbered galleries carry the site's new id in `code`
    // (see fetchOne) — key them back to the code they were fetched for.
    for (const [k, g] of Object.entries(cache!)) {
      if (g && g.code !== k) {
        cache![k] = { ...g, code: k }
        dirty = true
      }
    }
    if (dirty) scheduleSave()
  } catch {
    // Unreadable (not just missing): set it aside instead of overwriting it
    // with whatever gets fetched next.
    if (existsSync(FILE())) await fs.rename(FILE(), `${FILE()}.corrupt-${Date.now()}`).catch(() => {})
    cache = {}
  }
  return cache!
}

// Saving: this file is several MB. It used to be written in place, async —
// including from 'before-quit', where the process exited mid-write and left a
// truncated file; the next start read nothing and re-fetched ~7000 summaries.
// Now: one write at a time, to a .tmp then renamed over (a cut-off write never
// replaces the good file), only when something changed, and synchronously on
// quit.
let saveTimer: ReturnType<typeof setTimeout> | null = null
let dirty = false
let saving: Promise<void> = Promise.resolve()
function saveNow(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  if (!cache || !dirty) return saving
  dirty = false
  const text = JSON.stringify(cache)
  saving = saving
    .catch(() => {})
    .then(async () => {
      const tmp = FILE() + '.tmp'
      await fs.writeFile(tmp, text)
      await fs.rename(tmp, FILE())
    })
    .catch(() => {
      dirty = true // retry with the next save
    })
  return saving
}
function scheduleSave(): void {
  dirty = true
  if (!saveTimer) saveTimer = setTimeout(() => void saveNow(), SAVE_MS)
}
function saveSync(): void {
  if (!cache || !dirty) return
  try {
    const tmp = FILE() + '.quit.tmp'
    writeFileSync(tmp, JSON.stringify(cache))
    renameSync(tmp, FILE())
    dirty = false
  } catch {
    /* keep the previous file */
  }
}

// --- shared queue ---
const waiting: string[] = []
const resolvers = new Map<string, () => void>()
const inflight = new Map<string, Promise<void>>()
// Unreachable / deleted galleries: not retried again this session.
const failed = new Set<string>()
let active = 0
let batchDone = 0
let batchTotal = 0

type Progress = { done: number; total: number; running: boolean }
let onProgress: ((p: Progress) => void) | null = null
export function setSummaryProgressHandler(fn: (p: Progress) => void): void {
  onProgress = fn
}
let lastEmit = 0
function emit(force = false): void {
  const now = Date.now()
  if (!force && now - lastEmit < 250) return
  lastEmit = now
  onProgress?.({ done: batchDone, total: batchTotal, running: active > 0 || waiting.length > 0 || retrying > 0 })
}

let onFail: ((code: string) => void) | null = null
export function setSummaryFailedHandler(fn: (code: string) => void): void {
  onFail = fn
}

let onArrive: ((g: GallerySummary) => void) | null = null
export function setSummaryArrivedHandler(fn: (g: GallerySummary) => void): void {
  onArrive = fn
}

// Every cached summary (for one-off backfills).
export async function allCachedSummaries(): Promise<Record<string, GallerySummary>> {
  return load()
}

// Only a 404 means the gallery is gone. Anything else (timeout, reset, the site
// throttling a burst of requests) is retried a few times with a growing pause —
// those used to be dropped for the whole session, leaving hundreds of
// favorites without a title or thumbnail although the gallery was fine.
const MAX_ATTEMPTS = 4
const attempts = new Map<string, number>()
let retrying = 0
const isGone = (e: unknown): boolean => /->\s*404\b/.test(String((e as Error)?.message ?? e))

async function fetchOne(code: string): Promise<'ok' | 'gone' | 'retry'> {
  try {
    const s = await summary(code)
    // Keep the code we asked for: a renumbered gallery answers with its NEW id,
    // and favorites / screens look summaries up by the code they hold — with
    // the new id here, 600+ favorites never got their title or thumbnail.
    const g = { ...s, code, thumbUrl: s.thumbUrl ? encodeWeb(s.thumbUrl) : null }
    cache![code] = g
    onArrive?.(g)
    scheduleSave()
    return 'ok'
  } catch (e) {
    return isGone(e) ? 'gone' : 'retry'
  }
}

function settle(code: string): void {
  batchDone++
  attempts.delete(code)
  inflight.delete(code)
  resolvers.get(code)?.()
  resolvers.delete(code)
}

function pump(): void {
  while (active < CONCURRENCY && waiting.length) {
    const code = waiting.shift()!
    active++
    void fetchOne(code).then((r) => {
      active--
      const n = (attempts.get(code) ?? 0) + 1
      if (r === 'retry' && n < MAX_ATTEMPTS) {
        // Back of the queue after a pause (5s, 10s, 15s); still pending.
        attempts.set(code, n)
        retrying++
        setTimeout(() => {
          retrying--
          waiting.push(code)
          pump()
        }, 5000 * n)
      } else {
        if (r !== 'ok') {
          failed.add(code)
          onFail?.(code)
        }
        settle(code)
      }
      if (!active && !waiting.length && !retrying) {
        void saveNow()
        emit(true) // running: false → the activity row completes
        batchDone = batchTotal = 0
      } else emit()
      pump()
    })
  }
}

function enqueue(code: string): Promise<void> {
  const cur = inflight.get(code)
  if (cur) return cur
  const p = new Promise<void>((r) => resolvers.set(code, r))
  inflight.set(code, p)
  waiting.push(code)
  batchTotal++
  return p
}

// Codes not cached yet (and not given up on this session: 404, or still failing
// after MAX_ATTEMPTS).
async function missingOf(codes: string[]): Promise<string[]> {
  const c = await load()
  return [...new Set(codes)].filter((code) => code && /^\d+$/.test(code) && !c[code] && !failed.has(code))
}

// Make sure every code in `codes` is cached (fetching only the missing ones),
// and return the whole cache map. `cb` reports this call's own progress.
// Unreachable galleries are skipped silently.
export async function ensureSummaries(
  codes: string[],
  cb?: (done: number, total: number) => void
): Promise<Record<string, GallerySummary>> {
  const missing = await missingOf(codes)
  if (missing.length) {
    let done = 0
    cb?.(0, missing.length)
    const all = missing.map((code) => enqueue(code).then(() => cb?.(++done, missing.length)))
    emit(true)
    pump()
    await Promise.all(all)
  }
  return cache!
}

// Cached summaries for `codes` right now (no waiting); missing ones are queued
// and reach the renderer through the arrival push when they land.
export async function cachedSummariesNow(codes: string[]): Promise<GallerySummary[]> {
  const c = await load()
  void queueSummaries(codes)
  return codes.map((code) => c[code]).filter(Boolean)
}

// Start (or continue) fetching summaries for `codes` in the background.
export async function queueSummaries(codes: string[]): Promise<void> {
  const missing = await missingOf(codes)
  if (!missing.length) return
  for (const code of missing) void enqueue(code)
  emit(true)
  pump()
}

// Flush whatever arrived before the app closes (synchronously — an async write
// here gets cut off by the exit).
app.on('before-quit', () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  saveSync()
})
