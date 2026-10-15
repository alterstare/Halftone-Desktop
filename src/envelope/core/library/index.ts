// Library in the DB: saving scan results, the work list, a work's tracks with
// the version to play, listening progress, and the Halftone-style collection
// features (즐겨찾기, 별점, 그룹).
import type { Db } from '../db'
import { namesMap, needsTranslation } from '../names/translate'
import type {
  Bookmark,
  Edition,
  FormatPref,
  Group,
  SePref,
  Settings,
  SubFile,
  TrackGroup,
  TrackVersion,
  WorkDetail,
  WorkLang,
  WorkSummary, SubLang } from '../../shared/types'
import type { KnownProbes, ScannedWork } from './scan'
import { naturalCompare } from '../names/normalize'

// A track counts as heard once the position is this close to its end (s).
export const FINISHED_MARGIN = 10

// ---- saving scans ----

export function knownProbes(db: Db, workPath: string): KnownProbes {
  const rows = db
    .prepare(
      `SELECT t.path, t.size, t.mtime, t.duration, t.bitrate FROM tracks t JOIN works w ON w.id = t.work_id WHERE w.path = ?`
    )
    .all(workPath) as { path: string; size: number; mtime: number; duration: number | null; bitrate: number | null }[]
  return new Map(rows.map((r) => [r.path, r]))
}

// Insert or refresh a work; its tracks are replaced (progress, favorite, stars
// and groups are kept).
export function saveWork(db: Db, root: string, w: ScannedWork, now = Date.now()): number {
  return db.transaction(() => {
    const row = db.prepare('SELECT id FROM works WHERE path = ?').get(w.path) as { id: number } | undefined
    let id: number
    if (row) {
      id = row.id
      db.prepare(
        `UPDATE works SET root = ?, code = ?, title = ?, cover_path = ?, images_json = ?, mojibake = ?, scanned_at = ? WHERE id = ?`
      ).run(root, w.code, w.title, w.cover, JSON.stringify(w.images), w.mojibake ? 1 : 0, now, id)
      db.prepare('DELETE FROM tracks WHERE work_id = ?').run(id)
    } else {
      id = Number(
        db
          .prepare(
            `INSERT INTO works (path, root, code, title, cover_path, images_json, mojibake, added_at, scanned_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(w.path, root, w.code, w.title, w.cover, JSON.stringify(w.images), w.mojibake ? 1 : 0, w.addedAt ?? now, now).lastInsertRowid
      )
    }
    const ins = db.prepare(
      `INSERT INTO tracks (work_id, path, title, ext, kind, role, edition, edition_key, se, format_dir, group_key, sort,
                           duration, bitrate, size, mtime, mojibake, rel_dir, subs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const t of w.tracks)
      ins.run(id, t.path, t.title, t.ext, t.kind, t.role, t.edition, t.editionKey, t.se, t.formatDir, t.groupKey, t.sort,
        t.duration, t.bitrate, t.size, t.mtime, t.mojibake ? 1 : 0, t.relDir, JSON.stringify(t.subs))
    return id
  })()
}

// Drop works that are gone: under a scanned root but not found again, or
// under a root no longer in the library.
export function pruneWorks(db: Db, roots: string[], found: Set<string>): number {
  let n = 0
  for (const w of db.prepare('SELECT id, path, root FROM works').all() as { id: number; path: string; root: string }[]) {
    if (!roots.includes(w.root) || !found.has(w.path)) {
      db.prepare('DELETE FROM works WHERE id = ?').run(w.id)
      n++
    }
  }
  return n
}

// ---- version choice ----

const LOSSLESS = new Set(['.wav', '.flac'])

export function chooseVersion(vs: TrackVersion[], se: SePref, format: FormatPref): TrackVersion {
  const seRank = (v: TrackVersion): number => (v.se === se ? 0 : v.se === 'unknown' ? 1 : 2)
  const fmtRank = (v: TrackVersion): number => (LOSSLESS.has(v.ext) === (format === 'lossless') ? 0 : 1)
  return [...vs].sort(
    (a, b) => seRank(a) - seRank(b) || fmtRank(a) - fmtRank(b) || (b.bitrate ?? 0) - (a.bitrate ?? 0) || naturalCompare(a.path, b.path)
  )[0]
}

// 【한국어 자막판】 / 한국어 음성 releases vs the Japanese original.
export function workLang(title: string): WorkLang {
  if (/한국어\s*음성/.test(title)) return 'ko-voice'
  const hangul = (title.match(/[가-힣]/g) ?? []).length
  const kana = (title.match(/[぀-ヿ]/g) ?? []).length
  return /한국어\s*자막/.test(title) || hangul > kana ? 'ko-sub' : 'ja'
}

// The title shown: DLsite's when chosen, or when the folder name is only the
// work code (nothing else to show).
export function shownTitle(w: { title: string; code: string | null; dl_title: string | null }, s: Settings): string {
  if (w.dl_title && (s.titleSource === 'dlsite' || !w.title || w.title === w.code)) return w.dl_title
  return w.title
}

// The cover shown: DLsite's when chosen (or when the folder has no picture).
export function shownCover(w: { cover_path: string | null; dl_cover: string | null }, s: Settings): string | null {
  return (s.coverSource === 'dlsite' && w.dl_cover) || w.cover_path || w.dl_cover
}

// ---- reading ----

interface TrackRow {
  id: number
  work_id: number
  path: string
  title: string
  ext: string
  kind: 'audio' | 'video'
  role: 'main' | 'extra' | 'sample'
  edition: string
  edition_key: string
  se: 'on' | 'off' | 'unknown'
  format_dir: string
  group_key: string
  sort: number
  duration: number | null
  bitrate: number | null
  rel_dir: string
  subs_json: string
}

interface WorkRow {
  id: number
  path: string
  code: string | null
  title: string
  cover_path: string | null
  images_json: string
  mojibake: number
  added_at: number
  last_played_at: number | null
  last_group: string | null
  se_pref: SePref | null
  edition: string | null
  favorite: number
  rank: number
  dl_title: string | null
  dl_circle: string | null
  dl_voices: string | null
  dl_cover: string | null
}

// Subtitles kept in the program are listed as "envsub:<lang>:<audio path>",
// before the files next to the audio (they win when both have a language).
export const APP_SUB = 'envsub:'
export const appSubPath = (lang: string, trackPath: string): string => `${APP_SUB}${lang}:${trackPath}`
export function parseAppSubPath(p: string): { lang: SubLang; trackPath: string } | null {
  if (!p.startsWith(APP_SUB)) return null
  const rest = p.slice(APP_SUB.length)
  const at = rest.indexOf(':')
  return at < 0 ? null : { lang: rest.slice(0, at) as SubLang, trackPath: rest.slice(at + 1) }
}
function withAppSubs(db: Db, rows: TrackRow[]): TrackRow[] {
  const all = db.prepare('SELECT track_path, lang FROM app_subs').all() as { track_path: string; lang: string }[]
  if (!all.length) return rows
  const by = new Map<string, string[]>()
  for (const r of all) by.set(r.track_path, [...(by.get(r.track_path) ?? []), r.lang])
  return rows.map((t) => {
    const langs = by.get(t.path)
    if (!langs) return t
    const own = langs.map((lang) => ({ path: appSubPath(lang, t.path), lang }))
    return { ...t, subs_json: JSON.stringify([...own, ...(JSON.parse(t.subs_json) as SubFile[])]) }
  })
}

const toVersion = (t: TrackRow): TrackVersion => ({
  id: t.id,
  path: t.path,
  title: t.title,
  ext: t.ext,
  kind: t.kind,
  se: t.se,
  formatDir: t.format_dir,
  relDir: t.rel_dir,
  bitrate: t.bitrate,
  duration: t.duration,
  subs: JSON.parse(t.subs_json) as SubFile[]
})

function editionsOf(tracks: TrackRow[]): Edition[] {
  const m = new Map<string, string>()
  for (const t of tracks) if (t.role === 'main' && !m.has(t.edition_key)) m.set(t.edition_key, t.edition || '기본')
  if (m.size <= 1) return []
  return [...m].map(([key, label]) => ({ key, label })).sort((a, b) => naturalCompare(a.label, b.label))
}

type Progress = Map<string, { position: number; duration: number | null }>

function buildGroups(
  w: WorkRow,
  tracks: TrackRow[],
  progress: Progress,
  offsets: Map<string, number>,
  s: Settings,
  names?: Map<string, string>
): { groups: TrackGroup[]; editions: Edition[]; edition: string } {
  const editions = editionsOf(tracks)
  const edition = editions.length ? (editions.some((e) => e.key === w.edition) ? w.edition! : editions[0].key) : ''
  const sePref = w.se_pref ?? s.sePref
  const byGroup = new Map<string, TrackRow[]>()
  for (const t of tracks) {
    if (t.role === 'main' && editions.length && t.edition_key !== edition) continue
    const g = byGroup.get(t.group_key)
    if (g) g.push(t)
    else byGroup.set(t.group_key, [t])
  }
  const roleOrder = { main: 0, extra: 1, sample: 2 }
  const groups = [...byGroup.entries()]
    .sort(([, a], [, b]) => roleOrder[a[0].role] - roleOrder[b[0].role] || a[0].sort - b[0].sort)
    .map(([key, rows]): TrackGroup => {
      const versions = rows.map(toVersion)
      const chosen0 = chooseVersion(versions, sePref, s.formatPref)
      const original = chosen0.title
      if (names) for (const v of versions) v.title = names.get(v.path) ?? v.title
      const chosen = chosen0
      const duration = chosen.duration ?? versions.find((v) => v.duration)?.duration ?? null
      const p = progress.get(key)
      const d = p?.duration ?? duration
      return {
        key,
        title: chosen.title,
        role: rows[0].role,
        versions,
        chosen: chosen.id,
        position: p?.position ?? 0,
        duration,
        finished: !!p && !!d && p.position >= d - FINISHED_MARGIN,
        subOffset: offsets.get(key) ?? 0,
        originalTitle: chosen.title !== original ? original : undefined
      }
    })
  return { groups, editions, edition }
}

function byWork<T extends { work_id: number }>(rows: T[]): Map<number, T[]> {
  const out = new Map<number, T[]>()
  for (const r of rows) {
    const l = out.get(r.work_id)
    if (l) l.push(r)
    else out.set(r.work_id, [r])
  }
  return out
}

function progressOf(db: Db, workId?: number): Map<number, Progress> {
  const rows = (
    workId === undefined
      ? db.prepare('SELECT work_id, group_key, position, duration FROM progress').all()
      : db.prepare('SELECT work_id, group_key, position, duration FROM progress WHERE work_id = ?').all(workId)
  ) as { work_id: number; group_key: string; position: number; duration: number | null }[]
  const out = new Map<number, Progress>()
  for (const [id, rs] of byWork(rows)) out.set(id, new Map(rs.map((r) => [r.group_key, { position: r.position, duration: r.duration }])))
  return out
}

function offsetsOf(db: Db, workId?: number): Map<number, Map<string, number>> {
  const rows = (
    workId === undefined
      ? db.prepare('SELECT work_id, group_key, sub_offset FROM track_prefs').all()
      : db.prepare('SELECT work_id, group_key, sub_offset FROM track_prefs WHERE work_id = ?').all(workId)
  ) as { work_id: number; group_key: string; sub_offset: number }[]
  const out = new Map<number, Map<string, number>>()
  for (const [id, rs] of byWork(rows)) out.set(id, new Map(rs.map((r) => [r.group_key, r.sub_offset])))
  return out
}

function groupIdsOf(db: Db, workId?: number): Map<number, number[]> {
  const rows = (
    workId === undefined
      ? db.prepare('SELECT work_id, group_id FROM work_groups').all()
      : db.prepare('SELECT work_id, group_id FROM work_groups WHERE work_id = ?').all(workId)
  ) as { work_id: number; group_id: number }[]
  const out = new Map<number, number[]>()
  for (const [id, rs] of byWork(rows)) out.set(id, rs.map((r) => r.group_id))
  return out
}

// 이름 표시 › 번역한 이름: the translations by path (else nothing)
function shownNames(db: Db, s: Settings): Map<string, string> | undefined {
  return s.nameDisplay === 'translated' ? namesMap(db) : undefined
}

// The title with 이름 표시 › 번역한 이름: the translation when there is one;
// else a folder title already in Korean beats a Japanese DLsite title.
function nameTitle(w: WorkRow, s: Settings, names: Map<string, string> | undefined): string {
  const t = names?.get(w.path)
  if (t) return t
  const shown = shownTitle(w, s)
  return names && shown !== w.title && workLang(w.title) !== 'ja' && workLang(shown) === 'ja' ? w.title : shown
}

// What 이름 번역 translates for a work's title: the folder title, or — when
// that is only the code (or has no Japanese) and isn't Korean — DLsite's.
export function titleToTranslate(w: { title: string; code: string | null; dl_title: string | null }): string {
  if (needsTranslation(w.title) || workLang(w.title) !== 'ja') return w.title
  return w.dl_title && needsTranslation(w.dl_title) ? w.dl_title : w.title
}

export function listWorks(db: Db, s: Settings): WorkSummary[] {
  const works = db.prepare('SELECT * FROM works').all() as WorkRow[]
  const names = shownNames(db, s)
  const tracks = byWork(withAppSubs(db, db.prepare('SELECT * FROM tracks').all() as TrackRow[]))
  const progress = progressOf(db)
  const offsets = offsetsOf(db)
  const groupIds = groupIdsOf(db)
  const out = works.map((w): WorkSummary => {
    const { groups } = buildGroups(w, tracks.get(w.id) ?? [], progress.get(w.id) ?? new Map(), offsets.get(w.id) ?? new Map(), s)
    const main = groups.filter((g) => g.role === 'main')
    const known = main.filter((g) => g.duration)
    return {
      id: w.id,
      path: w.path,
      code: w.code,
      title: nameTitle(w, s, names),
      cover: shownCover(w, s),
      tracks: main.length,
      duration: known.length ? known.reduce((n, g) => n + g.duration!, 0) : null,
      played: main.filter((g) => g.position > 0).length,
      finished: main.filter((g) => g.finished).length,
      addedAt: w.added_at,
      lastPlayedAt: w.last_played_at,
      mojibake: !!w.mojibake,
      favorite: !!w.favorite,
      rank: w.rank,
      groupIds: groupIds.get(w.id) ?? [],
      lang: workLang(w.title),
      subtitled: main.filter((g) => g.versions.some((v) => v.subs.length)).length,
      folderTitle: w.title,
      circle: w.dl_circle,
      voices: w.dl_voices ? (JSON.parse(w.dl_voices) as string[]) : []
    }
  })
  // ascending; 내림차순 reverses
  const by: Record<Settings['libSort'], (a: WorkSummary, b: WorkSummary) => number> = {
    recent: (a, b) => (a.lastPlayedAt ?? 0) - (b.lastPlayedAt ?? 0) || a.addedAt - b.addedAt,
    added: (a, b) => a.addedAt - b.addedAt,
    title: (a, b) => naturalCompare(a.title, b.title),
    code: (a, b) => naturalCompare(a.code ?? '~', b.code ?? '~'),
    length: (a, b) => (a.duration ?? 0) - (b.duration ?? 0),
    rank: (a, b) => a.rank - b.rank || naturalCompare(b.title, a.title)
  }
  out.sort(by[s.libSort] ?? by.recent)
  return s.libDir === 'desc' ? out.reverse() : out
}

// Stage pictures: the folder's, with the DLsite cover first when chosen (or
// alone when the folder has none).
function imagesOf(w: WorkRow, s: Settings): string[] {
  const own = JSON.parse(w.images_json) as string[]
  if (!w.dl_cover) return own
  return s.coverSource === 'dlsite' || !own.length ? [w.dl_cover, ...own] : own
}

export function workDetail(db: Db, id: number, s: Settings): WorkDetail | null {
  const w = db.prepare('SELECT * FROM works WHERE id = ?').get(id) as WorkRow | undefined
  if (!w) return null
  const tracks = withAppSubs(db, db.prepare('SELECT * FROM tracks WHERE work_id = ?').all(id) as TrackRow[])
  const names = shownNames(db, s)
  const { groups, editions, edition } = buildGroups(w, tracks, progressOf(db, id).get(id) ?? new Map(), offsetsOf(db, id).get(id) ?? new Map(), s, names)
  return {
    id: w.id,
    path: w.path,
    code: w.code,
    title: nameTitle(w, s, names),
    cover: shownCover(w, s),
    images: imagesOf(w, s),
    editions,
    edition,
    sePref: w.se_pref ?? s.sePref,
    hasSeChoice: groups.some((g) => g.versions.some((v) => v.se === 'on') && g.versions.some((v) => v.se === 'off')),
    groups,
    lastGroup: w.last_group,
    mojibake: !!w.mojibake,
    favorite: !!w.favorite,
    rank: w.rank,
    groupIds: groupIdsOf(db, id).get(id) ?? [],
    lang: workLang(w.title),
    folderTitle: w.title,
    dlTitle: w.dl_title,
    circle: w.dl_circle,
    voices: w.dl_voices ? (JSON.parse(w.dl_voices) as string[]) : [],
    bookmarks: listBookmarks(db, id, groups.map((g) => g.key))
  }
}

export function setWorkPrefs(db: Db, id: number, p: { sePref?: SePref; edition?: string }): void {
  if (p.sePref !== undefined) db.prepare('UPDATE works SET se_pref = ? WHERE id = ?').run(p.sePref, id)
  if (p.edition !== undefined) db.prepare('UPDATE works SET edition = ? WHERE id = ?').run(p.edition, id)
}

export interface ProgressUpdate {
  workId: number
  groupKey: string
  position: number
  trackId?: number // the file playing: its duration is filled in when unknown
  duration?: number
}

export function saveProgress(db: Db, p: ProgressUpdate, now = Date.now()): void {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO progress (work_id, group_key, position, duration, played_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(work_id, group_key) DO UPDATE SET position = excluded.position,
         duration = COALESCE(excluded.duration, progress.duration), played_at = excluded.played_at`
    ).run(p.workId, p.groupKey, p.position, p.duration ?? null, now)
    db.prepare('UPDATE works SET last_played_at = ?, last_group = ? WHERE id = ?').run(now, p.groupKey, p.workId)
    if (p.trackId !== undefined && p.duration)
      db.prepare('UPDATE tracks SET duration = ? WHERE id = ? AND duration IS NULL').run(p.duration, p.trackId)
  })()
}

// 처음부터: forget the listening progress of a work.
export function resetProgress(db: Db, workId: number): void {
  db.prepare('DELETE FROM progress WHERE work_id = ?').run(workId)
  db.prepare('UPDATE works SET last_group = NULL WHERE id = ?').run(workId)
}

export function setSubOffset(db: Db, workId: number, groupKey: string, offset: number): void {
  db.prepare(
    `INSERT INTO track_prefs (work_id, group_key, sub_offset) VALUES (?, ?, ?)
     ON CONFLICT(work_id, group_key) DO UPDATE SET sub_offset = excluded.sub_offset`
  ).run(workId, groupKey, offset)
}

// Names to translate: the work's title and every track's (repaired) name.
export function namesOfWork(db: Db, workId: number): { path: string; name: string }[] {
  const w = db.prepare('SELECT path, title FROM works WHERE id = ?').get(workId) as { path: string; title: string } | undefined
  if (!w) return []
  const tracks = db.prepare('SELECT path, title FROM tracks WHERE work_id = ? ORDER BY sort').all(workId) as { path: string; title: string }[]
  return [{ path: w.path, name: w.title }, ...tracks.map((t) => ({ path: t.path, name: t.title }))]
}

// ---- 북마크 ----

// In the order of the work's tracks (`order` = group keys), then by time.
export function listBookmarks(db: Db, workId: number, order: string[] = []): Bookmark[] {
  const rows = db
    .prepare('SELECT id, work_id AS workId, group_key AS groupKey, position, name, created_at AS createdAt FROM bookmarks WHERE work_id = ?')
    .all(workId) as Bookmark[]
  const at = (k: string): number => (order.indexOf(k) < 0 ? order.length : order.indexOf(k))
  return rows.sort((a, b) => at(a.groupKey) - at(b.groupKey) || a.position - b.position)
}

export function addBookmark(db: Db, workId: number, groupKey: string, position: number, name: string): number {
  const n = name.trim() || '북마크'
  return Number(
    db
      .prepare('INSERT INTO bookmarks (work_id, group_key, position, name, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(workId, groupKey, Math.max(0, position), n, Date.now()).lastInsertRowid
  )
}

export function renameBookmark(db: Db, id: number, name: string): void {
  db.prepare('UPDATE bookmarks SET name = ? WHERE id = ?').run(name.trim() || '북마크', id)
}

export function deleteBookmark(db: Db, id: number): void {
  db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id)
}

// ---- 즐겨찾기 · 별점 · 그룹 ----

export function setFavorite(db: Db, ids: number[], on: boolean): void {
  const st = db.prepare('UPDATE works SET favorite = ? WHERE id = ?')
  db.transaction(() => ids.forEach((id) => st.run(on ? 1 : 0, id)))()
}

export function setRank(db: Db, ids: number[], rank: number): void {
  const st = db.prepare('UPDATE works SET rank = ? WHERE id = ?')
  const r = Math.max(0, Math.min(5, Math.round(rank)))
  db.transaction(() => ids.forEach((id) => st.run(r, id)))()
}

export function listGroups(db: Db): Group[] {
  return db
    .prepare(
      `SELECT g.id, g.name, (SELECT COUNT(*) FROM work_groups wg WHERE wg.group_id = g.id) AS count
       FROM groups g ORDER BY g.name COLLATE NOCASE`
    )
    .all() as Group[]
}

export function createGroup(db: Db, name: string, ids: number[] = []): number {
  const n = name.trim()
  if (!n) throw new Error('그룹 이름을 입력하세요')
  const ex = db.prepare('SELECT id FROM groups WHERE name = ?').get(n) as { id: number } | undefined
  const id = ex?.id ?? Number(db.prepare('INSERT INTO groups (name, created_at) VALUES (?, ?)').run(n, Date.now()).lastInsertRowid)
  setGroupMembership(db, ids, id, true)
  return id
}

export function renameGroup(db: Db, id: number, name: string): void {
  const n = name.trim()
  if (!n) throw new Error('그룹 이름을 입력하세요')
  db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(n, id)
}

export function deleteGroup(db: Db, id: number): void {
  db.prepare('DELETE FROM groups WHERE id = ?').run(id)
}

export function setGroupMembership(db: Db, ids: number[], groupId: number, on: boolean): void {
  const st = on
    ? db.prepare('INSERT OR IGNORE INTO work_groups (work_id, group_id) VALUES (?, ?)')
    : db.prepare('DELETE FROM work_groups WHERE work_id = ? AND group_id = ?')
  db.transaction(() => ids.forEach((id) => st.run(id, groupId)))()
}

// ---- subtitles ----

export function trackById(db: Db, id: number): { id: number; work_id: number; path: string; subs_json: string } | undefined {
  return db.prepare('SELECT id, work_id, path, subs_json FROM tracks WHERE id = ?').get(id) as
    | { id: number; work_id: number; path: string; subs_json: string }
    | undefined
}

// A subtitle file written next to a track becomes one of its subtitles.
export function addTrackSub(db: Db, trackId: number, sub: SubFile): void {
  const t = trackById(db, trackId)
  if (!t) return
  const subs = (JSON.parse(t.subs_json) as SubFile[]).filter((x) => x.path !== sub.path)
  db.prepare('UPDATE tracks SET subs_json = ? WHERE id = ?').run(JSON.stringify([sub, ...subs]), trackId)
}

export function removeTrackSub(db: Db, path: string): void {
  for (const t of db.prepare("SELECT id, subs_json FROM tracks WHERE subs_json LIKE '%' || ? || '%'").all(JSON.stringify(path).slice(1, -1)) as {
    id: number
    subs_json: string
  }[]) {
    const subs = (JSON.parse(t.subs_json) as SubFile[]).filter((x) => x.path !== path)
    db.prepare('UPDATE tracks SET subs_json = ? WHERE id = ?').run(JSON.stringify(subs), t.id)
  }
}
