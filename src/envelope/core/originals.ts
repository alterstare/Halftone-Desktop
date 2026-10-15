// 원래 이름 기록 (CLAUDE.md §5.9): each work's names as first seen — the work
// folder and every folder / file under it (뷁어 as its repaired Japanese) — and
// its Japanese subtitles, so they can be put back after renaming (번역한 이름)
// or redoing subtitles. Kept in the program (table `originals`) from the first
// scan on, never overwritten — only names / subtitles not seen before are
// added. A folder change (파일 정리 › 폴더 변경) also leaves the record in the
// work folder as envelope-original.json (설정; that file is read back when the
// program has no record, e.g. after reinstalling).
import { promises as fs } from 'fs'
import { basename, dirname, extname, join, relative, sep } from 'path'
import type { Db } from './db'
import { ORIGINALS_FILE, workEntries } from './tools'
import { decodeText, parseSubtitle, toVtt } from './subtitle'

export { ORIGINALS_FILE }

export interface OrigEntry {
  orig: string // relative path in the original names ("/" between parts)
  cur: string // where it is now (kept up to date when Envelope renames)
  dir: boolean
  size?: number // files: to find them again after a rename elsewhere
  mtime?: number
}
export interface OrigSub {
  file: string // the audio's `orig`
  lang: 'ja'
  vtt: string
}
export interface OrigRecord {
  app: 'Envelope'
  version: 1
  about: string
  recordedAt: number
  work: { folder: string; title: string; code: string | null; dlTitle: string | null }
  entries: OrigEntry[]
  subs: OrigSub[]
}

const ABOUT =
  'Envelope가 기록한 이 작품의 원래 이름(깨진 이름은 복구한 일본어)과 일본어 자막입니다. Envelope › 파일 정리 › 이름 › 폴더 변경 › 기록한 원래 이름으로 되돌릴 수 있습니다. 지우지 마세요.'

const slash = (p: string): string => p.split(sep).join('/')
const rel = (root: string, p: string): string => slash(relative(root, p))

// What the work looks like now, its names repaired.
async function snapshot(workPath: string): Promise<{ folder: string; entries: OrigEntry[] }> {
  const all = (await workEntries({ path: workPath })).filter((e) => basename(e.path) !== ORIGINALS_FILE)
  const fixedOf = new Map(all.map((e) => [e.path, e.fixed]))
  const origOf = (p: string): string => {
    const parts: string[] = []
    for (let q = p; q !== workPath && q.length > workPath.length; q = dirname(q)) parts.unshift(fixedOf.get(q) ?? basename(q))
    return parts.join('/')
  }
  const entries: OrigEntry[] = []
  for (const e of all) {
    if (e.depth < 0) continue
    const it: OrigEntry = { orig: origOf(e.path), cur: rel(workPath, e.path), dir: e.dir }
    if (!e.dir) {
      const st = await fs.stat(e.path).catch(() => null)
      if (st) Object.assign(it, { size: st.size, mtime: Math.floor(st.mtimeMs) })
    }
    entries.push(it)
  }
  const own = all.find((e) => e.depth < 0)
  return { folder: own?.fixed ?? basename(workPath), entries: entries.sort((a, b) => a.cur.localeCompare(b.cur)) }
}

// Current entries (relative paths) matched to the record: by where Envelope
// last left them, else (files) by size + date — a file renamed elsewhere.
// Folders not matched themselves follow from the files inside them.
export async function matchRecord(rec: OrigRecord, workPath: string): Promise<Map<string, string>> {
  const now = (await workEntries({ path: workPath })).filter((e) => e.depth >= 0 && basename(e.path) !== ORIGINALS_FILE)
  const out = new Map<string, string>() // current relative path → original relative path
  const used = new Set<OrigEntry>()
  const byCur = new Map(rec.entries.map((e) => [e.cur, e]))
  const files: { cur: string; size: number; mtime: number }[] = []
  for (const e of now) {
    const cur = rel(workPath, e.path)
    const r = byCur.get(cur)
    if (r && r.dir === e.dir) {
      out.set(cur, r.orig)
      used.add(r)
    } else if (!e.dir) {
      const st = await fs.stat(e.path).catch(() => null)
      if (st) files.push({ cur, size: st.size, mtime: Math.floor(st.mtimeMs) })
    }
  }
  for (const f of files) {
    const r = rec.entries.find((x) => !x.dir && !used.has(x) && x.size === f.size && x.mtime === f.mtime)
    if (r) {
      out.set(f.cur, r.orig)
      used.add(r)
    }
  }
  // folders: from the files under them, part by part
  for (const e of now) {
    if (!e.dir) continue
    const cur = rel(workPath, e.path)
    if (out.has(cur)) continue
    for (const [c, o] of out) {
      const cs = c.split('/')
      const os = o.split('/')
      const depth = cur.split('/').length
      if (cs.length === os.length && c.startsWith(cur + '/')) {
        out.set(cur, os.slice(0, depth).join('/'))
        break
      }
    }
  }
  return out
}

interface WorkRow {
  id: number
  path: string
  title: string
  code: string | null
  dl_title: string | null
}

export function loadRecord(db: Db, workId: number): OrigRecord | null {
  const row = db.prepare('SELECT json FROM originals WHERE work_id = ?').get(workId) as { json: string } | undefined
  return row ? (JSON.parse(row.json) as OrigRecord) : null
}
function storeRecord(db: Db, workId: number, rec: OrigRecord): void {
  db.prepare(
    'INSERT INTO originals (work_id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(work_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at'
  ).run(workId, JSON.stringify(rec), Date.now())
}

async function readFolderRecord(workPath: string): Promise<OrigRecord | null> {
  try {
    const r = JSON.parse(await fs.readFile(join(workPath, ORIGINALS_FILE), 'utf8')) as OrigRecord
    return r?.app === 'Envelope' && Array.isArray(r.entries) ? { ...r, subs: r.subs ?? [] } : null
  } catch {
    return null
  }
}

// The Japanese subtitles each track has now (files next to it, then the
// program's own), as vtt.
async function japaneseSubs(db: Db, workId: number): Promise<Map<string, string>> {
  const out = new Map<string, string>() // track path → vtt
  const tracks = db.prepare('SELECT path, subs_json FROM tracks WHERE work_id = ?').all(workId) as { path: string; subs_json: string }[]
  for (const t of tracks) {
    const app = db.prepare("SELECT vtt FROM app_subs WHERE track_path = ? AND lang = 'ja'").get(t.path) as { vtt: string } | undefined
    if (app) {
      out.set(t.path, app.vtt)
      continue
    }
    const file = (JSON.parse(t.subs_json) as { path: string; lang: string }[]).find((s) => s.lang === 'ja')
    if (!file) continue
    try {
      const cues = parseSubtitle(decodeText(await fs.readFile(file.path)), extname(file.path))
      if (cues.length) out.set(t.path, toVtt(cues))
    } catch {
      // unreadable: not recorded this time
    }
  }
  return out
}

// Record what is new for a work (everything, the first time). Returns whether
// the record changed.
export async function recordWork(db: Db, workId: number): Promise<boolean> {
  const w = db.prepare('SELECT id, path, title, code, dl_title FROM works WHERE id = ?').get(workId) as WorkRow | undefined
  if (!w) return false
  let rec = loadRecord(db, w.id)
  const imported = !rec
  if (!rec) rec = await readFolderRecord(w.path)
  // nothing new since the last time: every track is known and has its subtitle recorded
  if (rec && !imported) {
    const known = new Set(rec.entries.map((e) => e.cur))
    const tracks = db.prepare('SELECT path, subs_json FROM tracks WHERE work_id = ?').all(w.id) as { path: string; subs_json: string }[]
    const subbed = new Set(rec.subs.map((s) => s.file))
    const origOf = new Map(rec.entries.map((e) => [e.cur, e.orig]))
    const jaNow = (p: string, j: string): boolean =>
      (JSON.parse(j) as { lang: string }[]).some((s) => s.lang === 'ja') || !!db.prepare("SELECT 1 FROM app_subs WHERE track_path = ? AND lang = 'ja'").get(p)
    const stale = tracks.some((t) => {
      const cur = rel(w.path, t.path)
      return !known.has(cur) || (jaNow(t.path, t.subs_json) && !subbed.has(origOf.get(cur) ?? ''))
    })
    if (!stale) return false
  }
  const snap = await snapshot(w.path)
  let changed = false
  if (!rec) {
    rec = { app: 'Envelope', version: 1, about: ABOUT, recordedAt: Date.now(), work: { folder: snap.folder, title: w.title, code: w.code, dlTitle: w.dl_title }, entries: snap.entries, subs: [] }
    changed = true
  } else {
    // keep what was recorded; add only what it hasn't seen
    const match = await matchRecord(rec, w.path)
    for (const e of snap.entries) {
      const known = match.get(e.cur)
      const old = known !== undefined ? rec.entries.find((x) => x.orig === known) : undefined
      if (old) {
        if (old.cur !== e.cur || old.size !== e.size || old.mtime !== e.mtime) {
          Object.assign(old, { cur: e.cur, size: e.size, mtime: e.mtime })
          changed = true
        }
      } else if (!rec.entries.some((x) => x.orig === e.orig)) {
        rec.entries.push(e)
        changed = true
      }
    }
    if (imported) changed = true
  }
  const origOf = new Map(rec.entries.map((e) => [e.cur, e.orig]))
  for (const [track, vtt] of await japaneseSubs(db, w.id)) {
    const file = origOf.get(rel(w.path, track))
    if (file && !rec.subs.some((s) => s.file === file)) {
      rec.subs.push({ file, lang: 'ja', vtt })
      changed = true
    }
  }
  if (changed) storeRecord(db, w.id, rec)
  return changed
}

// After Envelope renamed something (called while the works still have their
// old paths): where each recorded entry is now, relative to the work's new
// folder.
export function moveRecords(db: Db, map: (p: string) => string): void {
  const rows = db.prepare('SELECT o.work_id, o.json, w.path FROM originals o JOIN works w ON w.id = o.work_id').all() as { work_id: number; json: string; path: string }[]
  for (const r of rows) {
    const rec = JSON.parse(r.json) as OrigRecord
    const root = map(r.path)
    let changed = false
    for (const e of rec.entries) {
      const next = rel(root, map(join(r.path, ...e.cur.split('/'))))
      if (next !== e.cur && !next.startsWith('..')) {
        e.cur = next
        changed = true
      }
    }
    if (changed) storeRecord(db, r.work_id, rec)
  }
}

// Leave the record in the work folder (a folder change was made there).
export async function writeFolderRecord(db: Db, workId: number): Promise<void> {
  const w = db.prepare('SELECT path FROM works WHERE id = ?').get(workId) as { path: string } | undefined
  const rec = loadRecord(db, workId)
  if (!w || !rec) return
  await fs.writeFile(join(w.path, ORIGINALS_FILE), JSON.stringify(rec, null, 2), 'utf8')
}

// The original name each current folder / file goes back to (absolute path →
// name), for 파일 정리 › 이름 › 기록한 원래 이름. A file whose type changed
// (wav → mp3) keeps its new extension.
export async function originalNames(db: Db, w: { id: number; path: string }): Promise<Map<string, string>> {
  const rec = loadRecord(db, w.id) ?? (await readFolderRecord(w.path))
  const out = new Map<string, string>()
  if (!rec) return out
  for (const [cur, orig] of await matchRecord(rec, w.path)) {
    let name = orig.split('/').pop()!
    const now = cur.split('/').pop()!
    const isDir = rec.entries.find((e) => e.orig === orig)?.dir ?? !extname(now)
    if (!isDir && extname(name).toLowerCase() !== extname(now).toLowerCase()) name = name.slice(0, name.length - extname(name).length) + extname(now)
    out.set(join(w.path, ...cur.split('/')), name)
  }
  out.set(w.path, rec.work.folder)
  return out
}

// The recorded Japanese subtitles and the track each belongs to now.
export async function recordedSubs(db: Db, w: { id: number; path: string }): Promise<{ trackPath: string; vtt: string }[]> {
  const rec = loadRecord(db, w.id) ?? (await readFolderRecord(w.path))
  if (!rec?.subs.length) return []
  const back = new Map<string, string>() // orig → current
  for (const [cur, orig] of await matchRecord(rec, w.path)) back.set(orig, cur)
  const out: { trackPath: string; vtt: string }[] = []
  for (const s of rec.subs) {
    const cur = back.get(s.file)
    if (cur) out.push({ trackPath: join(w.path, ...cur.split('/')), vtt: s.vtt })
  }
  return out
}
