// Envelope 모바일 (CLAUDE.md §5.10): a library folder shared with the phone
// through files in it, the way Sorta shares its 정리 폴더 with Sorta 모바일.
//   <라이브러리 폴더>/.envelope/mobile.envpack   works + what the user did (PC → phone)
//   <라이브러리 폴더>/.envelope/covers/, subs/  covers, the program's subtitles
//   <라이브러리 폴더>/.envelope/mobile/*.json  the phone's changes (phone → PC),
//                                            applied here and deleted
// Format: shared/mobilePack.ts (identical in the mobile repo). Only with
// 설정 › 라이브러리 › 모바일 공유 on — the one thing besides 파일 정리 that
// writes into library folders, and only inside .envelope.
import { createHash } from 'crypto'
import { existsSync, mkdirSync, promises as fs, readFileSync, renameSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { gunzipSync, gzipSync } from 'zlib'
import type { Db } from './db'
import type { Settings, SePref } from '../shared/types'
import { EDITS_FORMAT, PACK_COVERS, PACK_EDITS, PACK_FILE, PACK_FORMAT, PACK_SUBS, PACK_VERSION, sameBookmark } from '../shared/mobilePack'
import type { MobileEditFile, MobilePack, PackWork } from '../shared/mobilePack'
import * as library from './library'
import { thumbnail } from './thumbs'

const APP_SUB = 'envsub:'
const sha1 = (s: string | Buffer): string => createHash('sha1').update(s).digest('hex')

// "<root>\a\b" → "a/b" (a split work keeps its "|<code>")
export function relOf(root: string, p: string): string | null {
  const r = root.replace(/[\\/]+$/, '')
  if (p.length <= r.length + 1 || p.slice(0, r.length).toLowerCase() !== r.toLowerCase() || !/[\\/]/.test(p[r.length])) return null
  return p.slice(r.length + 1).replace(/\\/g, '/')
}

// ---- PC → phone ----

// The pack before covers / subtitle files are put in place: covers still the
// PC paths, subtitles as their text. Its hash says whether anything changed.
export interface DraftPack {
  root: string
  hash: string
  works: (PackWork & { coverSrc: string | null })[]
  groups: string[]
  subText: Record<string, Record<string, string>> // track rel → lang → vtt
}

export function draftPack(db: Db, s: Settings, root: string): DraftPack {
  const rows = library.mobileWorkRows(db, s, root)
  const appSubs = new Map<string, Record<string, string>>()
  for (const r of db.prepare('SELECT track_path, lang, vtt FROM app_subs').all() as { track_path: string; lang: string; vtt: string }[]) {
    const rel = relOf(root, r.track_path)
    if (!rel) continue
    appSubs.set(rel, { ...appSubs.get(rel), [r.lang]: r.vtt })
  }
  const subText: DraftPack['subText'] = {}
  const works = rows.flatMap((w) => {
    const rel = relOf(root, w.path)
    if (!rel) return []
    const tracks = w.tracks.flatMap((t) => {
      const trel = relOf(root, t.path)
      if (!trel) return []
      const subs = t.subs.flatMap((x) => {
        if (x.path.startsWith(APP_SUB)) {
          const lang = x.path.slice(APP_SUB.length, x.path.indexOf(':', APP_SUB.length))
          const text = appSubs.get(trel)?.[lang]
          if (!text) return []
          subText[trel] = { ...subText[trel], [lang]: text }
          return [{ rel: `${APP_SUB}${lang}:${trel}`, lang: x.lang }]
        }
        const r = relOf(root, x.path)
        return r ? [{ rel: r, lang: x.lang }] : []
      })
      return [{ ...t, rel: trel, subs, path: undefined }]
    })
    return [
      {
        id: w.id,
        rel,
        code: w.code,
        title: w.title,
        folderTitle: w.folderTitle,
        dlTitle: w.dlTitle,
        cover: null,
        coverSrc: w.cover,
        images: w.images.map((p) => relOf(root, p)).filter((x): x is string => !!x),
        addedAt: w.addedAt,
        circle: w.circle,
        voices: w.voices,
        tags: w.tags,
        content: w.content,
        age: w.age,
        lang: w.lang,
        mojibake: w.mojibake,
        sePref: w.sePref,
        edition: w.edition,
        favorite: w.favorite,
        rank: w.rank,
        plays: w.plays,
        lastPlayedAt: w.lastPlayedAt,
        lastGroup: w.lastGroup,
        groups: w.groups,
        progress: w.progress,
        offsets: w.offsets,
        bookmarks: w.bookmarks,
        tracks: tracks.map(({ path: _p, ...t }) => t)
      }
    ]
  })
  const groups = (db.prepare('SELECT name FROM groups ORDER BY name COLLATE NOCASE').all() as { name: string }[]).map((g) => g.name)
  const hash = sha1(JSON.stringify([works, groups, subText]))
  return { root, hash, works, groups, subText }
}

// Files in a .envelope folder no longer used by the pack go (only ours there).
async function prune(dir: string, keep: Set<string>): Promise<void> {
  for (const f of await fs.readdir(dir).catch(() => [] as string[])) if (!keep.has(f)) await fs.rm(join(dir, f), { force: true }).catch(() => {})
}

async function writeIfMissing(file: string, data: Buffer | string): Promise<void> {
  if (existsSync(file)) return
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, data)
  await fs.rename(tmp, file)
}

// Covers (small jpgs from the thumbnail cache) and subtitle texts as files,
// then the pack itself (written to a temporary name and swapped in).
export async function writePack(d: DraftPack, appVersion: string, thumbsDir: string): Promise<MobilePack> {
  const coverDir = join(d.root, PACK_COVERS)
  const subDir = join(d.root, PACK_SUBS)
  mkdirSync(coverDir, { recursive: true })
  mkdirSync(subDir, { recursive: true })
  const covers = new Set<string>()
  const works: PackWork[] = []
  for (const { coverSrc, ...w } of d.works) {
    let cover: string | null = null
    if (coverSrc) {
      try {
        const th = await thumbnail(coverSrc, thumbsDir)
        const name = basename(th)
        await writeIfMissing(join(coverDir, name), await fs.readFile(th))
        covers.add(name)
        cover = `${PACK_COVERS}/${name}`
      } catch {
        // picture gone / unreadable: no cover on the phone
      }
    }
    works.push({ ...w, cover })
  }
  const subs: MobilePack['subs'] = {}
  const subFiles = new Set<string>()
  for (const [rel, langs] of Object.entries(d.subText)) {
    for (const [lang, text] of Object.entries(langs)) {
      const name = `${sha1(text)}.vtt`
      await writeIfMissing(join(subDir, name), text)
      subFiles.add(name)
      subs[rel] = { ...subs[rel], [lang]: `${PACK_SUBS}/${name}` }
    }
  }
  const pack: MobilePack = { format: PACK_FORMAT, v: PACK_VERSION, createdAt: Date.now(), app: `Envelope ${appVersion}`, groups: d.groups, works, subs }
  const file = join(d.root, PACK_FILE)
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, gzipSync(JSON.stringify(pack)))
  await fs.rename(tmp, file)
  await prune(coverDir, covers)
  await prune(subDir, subFiles)
  return pack
}

// On quit (no await possible): the pack only, covers / subtitles as they are.
export function writePackSync(d: DraftPack, appVersion: string): void {
  const file = join(d.root, PACK_FILE)
  if (!existsSync(file)) return
  // the last pack's covers / subtitle files are reused: the state fields change
  const old = JSON.parse(gunzipSync(readFileSync(file)).toString()) as MobilePack
  const byRel = new Map(old.works.map((w) => [w.rel, w]))
  const works: PackWork[] = d.works.map(({ coverSrc: _c, ...w }) => ({ ...w, cover: byRel.get(w.rel)?.cover ?? null }))
  const pack: MobilePack = { ...old, createdAt: Date.now(), app: `Envelope ${appVersion}`, groups: d.groups, works }
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, gzipSync(JSON.stringify(pack)))
  renameSync(tmp, file)
}

// ---- phone → PC ----

export async function pendingEdits(root: string): Promise<string[]> {
  const dir = join(root, PACK_EDITS)
  const names = await fs.readdir(dir).catch(() => [] as string[])
  return names.filter((n) => n.endsWith('.json')).map((n) => join(dir, n))
}

function groupId(db: Db, name: string): number {
  const g = db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number } | undefined
  return g?.id ?? library.createGroup(db, name)
}

// Apply the phone's files (oldest edits first) and delete them. Returns how
// many edits changed something here.
export async function applyEdits(db: Db, root: string, files: string[]): Promise<number> {
  const batches: MobileEditFile[] = []
  for (const f of files) {
    try {
      const b = JSON.parse(await fs.readFile(f, 'utf8')) as MobileEditFile
      if (b.format === EDITS_FORMAT) batches.push(b)
    } catch {
      continue // being written right now: next time
    }
  }
  const ids = new Map<string, number>()
  for (const w of db.prepare('SELECT id, path FROM works WHERE root = ?').all(root) as { id: number; path: string }[]) {
    const rel = relOf(root, w.path)
    if (rel) ids.set(rel, w.id)
  }
  const edits = batches.flatMap((b) => b.edits).sort((a, b) => a.at - b.at)
  let n = 0
  db.transaction(() => {
    for (const e of edits) {
      if (e.op === 'group') {
        const g = db.prepare('SELECT id FROM groups WHERE name = ?').get(e.name) as { id: number } | undefined
        if (e.action === 'create' && !g) library.createGroup(db, e.name)
        else if (e.action === 'rename' && g && e.to && !db.prepare('SELECT 1 FROM groups WHERE name = ?').get(e.to)) library.renameGroup(db, g.id, e.to)
        else if (e.action === 'delete' && g) library.deleteGroup(db, g.id)
        else continue
        n++
        continue
      }
      const id = ids.get(e.work)
      if (id === undefined) continue // not in this PC's library (any more)
      if (e.op === 'work') {
        const st = e.set
        if (st.favorite !== undefined) library.setFavorite(db, [id], st.favorite)
        if (st.rank !== undefined) library.setRank(db, [id], st.rank)
        if (st.sePref !== undefined) db.prepare('UPDATE works SET se_pref = ? WHERE id = ?').run(st.sePref as SePref | null, id)
        if (st.edition !== undefined) db.prepare('UPDATE works SET edition = ? WHERE id = ?').run(st.edition, id)
        if (st.groups) {
          const want = new Set(st.groups.map((g) => groupId(db, g)))
          const have = (db.prepare('SELECT group_id AS g FROM work_groups WHERE work_id = ?').all(id) as { g: number }[]).map((r) => r.g)
          for (const g of have) if (!want.has(g)) library.setGroupMembership(db, [id], g, false)
          for (const g of want) library.setGroupMembership(db, [id], g, true)
        }
      } else if (e.op === 'progress') {
        // the newer listening wins (the PC may have played the same track since)
        const cur = db.prepare('SELECT played_at FROM progress WHERE work_id = ? AND group_key = ?').get(id, e.groupKey) as { played_at: number } | undefined
        if (cur && cur.played_at >= e.at) continue
        library.saveProgress(db, { workId: id, groupKey: e.groupKey, position: e.position, duration: e.duration ?? undefined }, e.at)
        const last = db.prepare('SELECT MAX(played_at) AS t FROM progress WHERE work_id = ?').get(id) as { t: number | null }
        if (last.t !== null && last.t > e.at) {
          const g = db.prepare('SELECT group_key FROM progress WHERE work_id = ? AND played_at = ?').get(id, last.t) as { group_key: string }
          db.prepare('UPDATE works SET last_played_at = ?, last_group = ? WHERE id = ?').run(last.t, g.group_key, id)
        }
      } else if (e.op === 'reset') {
        db.prepare('DELETE FROM progress WHERE work_id = ? AND played_at <= ?').run(id, e.at)
        if (!db.prepare('SELECT 1 FROM progress WHERE work_id = ?').get(id)) library.resetProgress(db, id)
      } else if (e.op === 'play') {
        library.countPlay(db, id)
      } else if (e.op === 'offset') {
        library.setSubOffset(db, id, e.groupKey, e.offset)
      } else if (e.op === 'bookmark') {
        const marks = library.listBookmarks(db, id)
        if (e.action === 'add') {
          if (!marks.some((b) => sameBookmark(b, e))) library.addBookmark(db, id, e.groupKey, e.position, e.name ?? '북마크')
          else continue
        } else {
          const gone = marks.filter((b) => sameBookmark(b, e))
          if (!gone.length) continue
          gone.forEach((b) => library.deleteBookmark(db, b.id))
        }
      }
      n++
    }
  })()
  for (const f of files) await fs.rm(f, { force: true }).catch(() => {})
  return n
}
