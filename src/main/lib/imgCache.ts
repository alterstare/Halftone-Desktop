// Disk cache for remote images served through mangaimg:// (doujin thumbnails
// and pages, manga-site covers and pages) — userData/imgcache. Chromium's own
// HTTP cache doesn't keep custom-scheme responses across restarts, so without
// this every thumbnail was downloaded again on each launch.
//
// Files are keyed by a hash of the (normalized) url. Capped at CACHE_MAX bytes:
// past that, the least recently used files go first (reads refresh mtime), so
// thumbnails that keep being shown stay while old chapter pages age out.
import { app } from 'electron'
import { join } from 'path'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'

const CACHE_MAX = 2 * 1024 * 1024 * 1024 // 2 GB
const TRIM_TO = 0.85 // after eviction, total ≤ 85% of the cap
const dir = (): string => join(app.getPath('userData'), 'imgcache')

// Doujin image urls carry a rotating host letter and a time-based path segment
// (gg.js) — the same image under a new url. Drop both so it stays one entry.
function normalize(url: string): string {
  return url.replace(/^https?:\/\/[a-z0-9]+\./i, '').replace(/\/\d{10}\//, '/')
}

function fileFor(url: string): string {
  const key = createHash('sha1').update(normalize(url)).digest('hex')
  return join(dir(), key.slice(0, 2), key)
}

// Running total of cached bytes (scanned once, lazily), for eviction.
let total = -1
let trimming = false

async function scanTotal(): Promise<{ file: string; size: number; mtime: number }[]> {
  const out: { file: string; size: number; mtime: number }[] = []
  let subs: string[] = []
  try {
    subs = await fs.readdir(dir())
  } catch {
    return out
  }
  for (const sub of subs) {
    let names: string[] = []
    try {
      names = await fs.readdir(join(dir(), sub))
    } catch {
      continue
    }
    for (const n of names) {
      const file = join(dir(), sub, n)
      try {
        const st = await fs.stat(file)
        out.push({ file, size: st.size, mtime: st.mtimeMs })
      } catch {
        /* vanished */
      }
    }
  }
  return out
}

async function trimIfNeeded(): Promise<void> {
  if (trimming || total <= CACHE_MAX) return
  trimming = true
  try {
    const files = await scanTotal()
    total = files.reduce((a, f) => a + f.size, 0)
    if (total <= CACHE_MAX) return
    files.sort((a, b) => a.mtime - b.mtime) // least recently used first
    for (const f of files) {
      if (total <= CACHE_MAX * TRIM_TO) break
      await fs.unlink(f.file).catch(() => {})
      total -= f.size
    }
  } finally {
    trimming = false
  }
}

const inflight = new Map<string, Promise<Buffer>>()

// Bytes for `url`: from disk if cached, else `fetcher()` (once, even when many
// requests ask at the same time), then stored. Failures aren't cached.
export async function cachedImage(url: string, fetcher: () => Promise<Buffer>): Promise<Buffer> {
  const file = fileFor(url)
  try {
    const buf = await fs.readFile(file)
    const now = new Date()
    void fs.utimes(file, now, now).catch(() => {}) // recently used
    return buf
  } catch {
    /* not cached */
  }
  const cur = inflight.get(file)
  if (cur) return cur
  const p = (async () => {
    const buf = await fetcher()
    if (buf.length) {
      try {
        await fs.mkdir(join(file, '..'), { recursive: true })
        await fs.writeFile(file, buf)
        if (total < 0) total = (await scanTotal()).reduce((a, f) => a + f.size, 0)
        else total += buf.length
        void trimIfNeeded()
      } catch {
        /* disk full / locked → just serve it */
      }
    }
    return buf
  })()
  inflight.set(file, p)
  try {
    return await p
  } finally {
    inflight.delete(file)
  }
}
