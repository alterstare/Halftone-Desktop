// File tools (CLAUDE.md §5.6, §5.7): plans first (nothing is touched), then
// running only the items the user kept. 썸네일 and 이름 복구 are undo steps;
// wav files go to the OS recycle bin (restored from there).
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { basename, dirname, extname, join } from 'path'
import type { CoverItem, RenameItem, ToolResult, WavItem } from '../../shared/types'
import type { Db } from '../db'
import type { ActionLog } from '../actionLog'
import type { JobContext } from '../queue'
import { readDir, workTitle } from '../library/scan'
import { probe } from '../library/probe'
import { fillName, repairSiblings } from '../names/mojibake'
import { namesMap, needsTranslation } from '../names/translate'
import { nfkc, trackKey, trackNumber } from '../names/normalize'
import { hasCover, readTag, replaceTag } from './id3'
import type { EncodeOptions } from './wav'

export type TrashFn = (path: string) => Promise<void>
export type EncodeFn = (src: string, dst: string, opts: EncodeOptions, signal: AbortSignal, onProgress: (p: number) => void) => Promise<void>

// Same track lengths within this many seconds.
const SAME_LENGTH_S = 1
// Windows path limit.
const MAX_PATH = 259

interface WorkRef {
  id: number
  path: string
  title: string
  cover_path: string | null
  images_json: string
}

function worksOf(db: Db, ids: number[] | null): WorkRef[] {
  const all = db.prepare('SELECT id, path, title, cover_path, images_json FROM works ORDER BY title').all() as WorkRef[]
  return ids ? all.filter((w) => ids.includes(w.id)) : all
}

const itemId = (...parts: string[]): string => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16)

async function walkFiles(dir: string, out: string[] = []): Promise<string[]> {
  for (const e of await readDir(dir)) {
    const p = join(dir, e.name)
    if (e.isDirectory()) await walkFiles(p, out)
    else if (e.isFile()) out.push(p)
  }
  return out
}

const stemOf = (p: string): string => basename(p, extname(p))
const lower = (s: string): string => nfkc(s).toLowerCase()

async function seconds(path: string): Promise<number | null> {
  try {
    return (await probe(path, (await fs.stat(path)).size)).duration
  } catch {
    return null
  }
}

function clock(s: number | null): string {
  if (s === null) return '?'
  const t = Math.round(s)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

// ---------- wav 정리 ----------

export async function planWav(db: Db, ids: number[] | null, ctx?: JobContext): Promise<WavItem[]> {
  const out: WavItem[] = []
  const works = worksOf(db, ids)
  for (let i = 0; i < works.length; i++) {
    ctx?.report(i, works.length)
    const w = works[i]
    const files = await walkFiles(w.path)
    const byDir = new Map<string, string[]>()
    for (const f of files) byDir.set(dirname(f), [...(byDir.get(dirname(f)) ?? []), f])
    for (const list of byDir.values()) {
      const wavs = list.filter((f) => extname(f).toLowerCase() === '.wav')
      const mp3s = list.filter((f) => extname(f).toLowerCase() === '.mp3')
      for (const wav of wavs) {
        const base = { id: itemId(wav), workId: w.id, workTitle: w.title, wav, bytes: (await fs.stat(wav)).size }
        const wavSeconds = await seconds(wav)
        const exact = mp3s.find((m) => lower(stemOf(m)) === lower(stemOf(wav)))
        const near = exact ? undefined : mp3s.find((m) => trackKey(stemOf(m)) === trackKey(stemOf(wav)))
        const pair = exact ?? near
        if (wavSeconds === null) {
          out.push({ ...base, kind: 'skip', mp3: pair ?? '', wavSeconds, mp3Seconds: null, reason: '읽을 수 없는 wav입니다' })
          continue
        }
        if (!pair) {
          out.push({ ...base, kind: 'convert', mp3: join(dirname(wav), `${stemOf(wav)}.mp3`), wavSeconds, mp3Seconds: null })
          continue
        }
        const mp3Seconds = await seconds(pair)
        const same = mp3Seconds !== null && Math.abs(mp3Seconds - wavSeconds) <= SAME_LENGTH_S
        if (!same)
          out.push({ ...base, kind: 'skip', mp3: pair, wavSeconds, mp3Seconds, reason: `재생시간이 다릅니다 (wav ${clock(wavSeconds)} · mp3 ${clock(mp3Seconds)})` })
        else out.push({ ...base, kind: exact ? 'delete' : 'check', mp3: pair, wavSeconds, mp3Seconds })
      }
    }
  }
  return out
}

export async function runWav(
  db: Db,
  items: WavItem[],
  deps: { encode: EncodeFn; trash: TrashFn; bitrate: EncodeOptions['bitrate'] },
  ctx: JobContext
): Promise<ToolResult> {
  const failed: string[] = []
  const done: { wav: string; mp3: string; kind: string }[] = []
  const todo = items.filter((x) => x.kind !== 'skip')
  for (let i = 0; i < todo.length; i++) {
    if (ctx.signal.aborted) break
    const it = todo[i]
    const name = basename(it.wav)
    try {
      if (it.kind === 'convert') {
        ctx.report(i, todo.length, `mp3로 바꾸는 중 · ${name}`)
        try {
          await fs.access(it.mp3)
          throw new Error('같은 이름의 mp3가 이미 있습니다')
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
        }
        const part = `${it.mp3}.part`
        try {
          await deps.encode(it.wav, part, { bitrate: deps.bitrate }, ctx.signal, (p) => ctx.report(i + p, todo.length, `mp3로 바꾸는 중 · ${name}`))
          const got = (await probe(part, (await fs.stat(part)).size, 'mp3')).duration
          if (got === null || it.wavSeconds === null || Math.abs(got - it.wavSeconds) > SAME_LENGTH_S)
            throw new Error(`만든 mp3의 길이가 다릅니다 (${clock(got)} / ${clock(it.wavSeconds)})`)
          await fs.rename(part, it.mp3)
        } catch (e) {
          await fs.rm(part, { force: true })
          throw e
        }
        const st = await fs.stat(it.wav)
        await fs.utimes(it.mp3, st.atime, st.mtime) // keeps date sorting
      } else ctx.report(i, todo.length, `휴지통으로 보내는 중 · ${name}`)
      await deps.trash(it.wav)
      done.push({ wav: it.wav, mp3: it.mp3, kind: it.kind })
    } catch (e) {
      failed.push(`${name}: ${String((e as Error)?.message ?? e)}`)
    }
  }
  ctx.report(todo.length, todo.length)
  const conv = done.filter((d) => d.kind === 'convert').length
  const summary = `wav 정리 · mp3 변환 ${conv}개, wav 삭제 ${done.length}개 (휴지통)`
  if (done.length)
    db.prepare('INSERT INTO file_history (kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?)').run('wav', summary, JSON.stringify(done), Date.now())
  return { ok: !failed.length, message: `${summary}${failed.length ? `, ${failed.length}개 실패` : ''}`, done: done.length, failed }
}

// ---------- mp3 썸네일 (ID3) ----------

// "01.png" / "track01.jpg" / "1.jpg": a picture for one track number.
function imageNumber(p: string): number | null {
  const m = nfkc(stemOf(p)).match(/^[^\d]{0,8}?(\d{1,3})[^\d]{0,3}$/)
  return m ? Number(m[1]) : null
}

export async function planCover(db: Db, ids: number[] | null, skipExisting: boolean, ctx?: JobContext): Promise<CoverItem[]> {
  const out: CoverItem[] = []
  const works = worksOf(db, ids)
  for (let i = 0; i < works.length; i++) {
    ctx?.report(i, works.length)
    const w = works[i]
    const images = [w.cover_path, ...(JSON.parse(w.images_json) as string[])].filter((x): x is string => !!x)
    const numbered = new Map<number, string>()
    for (const img of images) {
      const n = imageNumber(img)
      if (n !== null && !numbered.has(n)) numbered.set(n, img)
    }
    const tracks = db.prepare("SELECT path, title FROM tracks WHERE work_id = ? AND ext = '.mp3' ORDER BY sort, path").all(w.id) as {
      path: string
      title: string
    }[]
    for (const t of tracks) {
      const n = trackNumber(t.title)
      const image = (n !== null && numbered.size > 1 ? numbered.get(n) : undefined) ?? w.cover_path
      const has = await hasCover(t.path).catch(() => false)
      if (has && skipExisting) continue
      out.push({ id: itemId(t.path), workId: w.id, workTitle: w.title, track: t.path, image, hasCover: has })
    }
  }
  return out
}

export interface CoverUndo {
  label: string
  items: { path: string; backup: string }[] // backup = saved tag file ('' tag = none)
}

export async function runCover(
  log: ActionLog,
  items: CoverItem[],
  opts: { square: boolean; backupsDir: string },
  ctx: JobContext
): Promise<ToolResult> {
  const sharp = (await import('sharp')).default
  sharp.cache(false) // an open cache keeps library files locked on Windows (renaming them fails)
  const NodeID3 = (await import('node-id3')).default
  const jpegs = new Map<string, Buffer>()
  const undo: CoverUndo = { label: 'mp3 썸네일 넣기', items: [] }
  const failed: string[] = []
  const todo = items.filter((x) => x.image)
  for (let i = 0; i < todo.length; i++) {
    if (ctx.signal.aborted) break
    const it = todo[i]
    ctx.report(i, todo.length, `썸네일 넣는 중 · ${basename(it.track)}`)
    try {
      let jpeg = jpegs.get(it.image!)
      if (!jpeg) {
        const img = sharp(it.image!, { failOn: 'none' }).rotate()
        jpeg = await (opts.square ? img.resize(600, 600, { fit: 'cover' }) : img.resize(800, 800, { fit: 'inside', withoutEnlargement: true }))
          .jpeg({ quality: 88, mozjpeg: true })
          .toBuffer()
        jpegs.set(it.image!, jpeg)
      }
      const backup = join(opts.backupsDir, `${itemId(it.track, String(Date.now()))}.id3`)
      await fs.writeFile(backup, await readTag(it.track))
      const st = await fs.stat(it.track)
      const out = NodeID3.update(
        { image: { mime: 'image/jpeg', type: { id: 3, name: 'front cover' }, description: '', imageBuffer: jpeg } },
        await fs.readFile(it.track)
      )
      if (!Buffer.isBuffer(out)) throw new Error('태그를 쓰지 못했습니다')
      const tmp = `${it.track}.env-tmp`
      await fs.writeFile(tmp, out)
      await fs.rename(tmp, it.track)
      await fs.utimes(it.track, st.atime, st.mtime)
      undo.items.push({ path: it.track, backup })
    } catch (e) {
      failed.push(`${basename(it.track)}: ${String((e as Error)?.message ?? e)}`)
    }
  }
  if (undo.items.length) log.record('tools.cover', undo)
  ctx.report(todo.length, todo.length)
  return { ok: !failed.length, message: `mp3 ${undo.items.length}개에 썸네일을 넣었습니다${failed.length ? `, ${failed.length}개 실패` : ''}`, done: undo.items.length, failed }
}

export function registerCoverUndo(log: ActionLog): void {
  log.register<CoverUndo>('tools.cover', async (p) => {
    for (const it of p.items) await replaceTag(it.path, await fs.readFile(it.backup))
  })
}

// ---------- 이름 복구 ----------

const FORBIDDEN: Record<string, string> = { '\\': '＼', '/': '／', ':': '：', '*': '＊', '?': '？', '"': '＂', '<': '＜', '>': '＞', '|': '｜' }
export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, (c) => FORBIDDEN[c]).replace(/[. ]+$/, '') || '_'
}

// Every folder and file of a work, its repaired name (lost characters filled
// from the title and the other names), deepest first; the work folder last.
export interface WorkEntry {
  path: string
  dir: boolean
  name: string // on disk
  fixed: string // repaired
  depth: number // -1 = the work folder
  moji: boolean
  filled: number
}

export async function workEntries(w: { path: string }): Promise<WorkEntry[]> {
  const raw: Omit<WorkEntry, 'filled'>[] = []
  const walk = async (dir: string, depth: number, parentMoji: boolean): Promise<void> => {
    const list = await readDir(dir)
    const fixed = repairSiblings(
      list.map((e) => e.name),
      parentMoji
    )
    for (let k = 0; k < list.length; k++) {
      const e = list[k]
      if (!e.isDirectory() && !e.isFile()) continue
      const p = join(dir, e.name)
      raw.push({ path: p, dir: e.isDirectory(), name: e.name, fixed: fixed[k].text, depth, moji: fixed[k].mojibake })
      if (e.isDirectory()) await walk(p, depth + 1, fixed[k].mojibake)
    }
  }
  const own = repairSiblings([basename(w.path)])[0]
  raw.push({ path: w.path, dir: true, name: basename(w.path), fixed: own.text, depth: -1, moji: own.mojibake })
  await walk(w.path, 0, own.mojibake)
  const refs = [workTitle(basename(w.path)).title, ...raw.map((e) => e.fixed)]
  return raw
    .sort((a, b) => b.depth - a.depth)
    .map((e) => {
      const f = fillName(e.fixed, refs)
      return { ...e, fixed: f.text, filled: f.filled }
    })
}

// A file's name without its extension chain: "01_おかえり.mp3.ja.vtt" and
// "01_おかえり.mp3" share the stem "01_おかえり", so a track and its subtitles
// get the same translation.
const SUFFIX = /(?:\.(?:mp3|wav|flac|m4a|ogg|opus|mp4|aac))?(?:\.(?:ja|ko|en|jp|kr|zh|jpn|kor))?\.[0-9a-z]{1,5}$/i
export function splitSuffix(name: string, dir: boolean): { stem: string; suffix: string } {
  const m = dir ? null : name.match(SUFFIX)
  return m && m.index ? { stem: name.slice(0, m.index), suffix: m[0] } : { stem: name, suffix: '' }
}

// Names to translate for a work: its title (shown in the library) and every
// folder / file stem under it.
export async function nameItemsOf(w: { path: string; title: string }): Promise<{ path: string; name: string }[]> {
  const out = [{ path: w.path, name: w.title }]
  for (const e of await workEntries(w)) if (e.depth >= 0) out.push({ path: e.path, name: splitSuffix(e.fixed, e.dir).stem })
  return out
}

// The work folder with its title part swapped for the translation (the work
// code and anything around the title stay).
function translatedFolder(fixed: string, translated: string): string {
  const { code, title } = workTitle(fixed)
  if (title && title !== code && fixed.includes(title)) return fixed.replace(title, translated)
  return code ? `${code} ${translated}` : translated
}

export async function planRename(db: Db, ids: number[] | null, ctx?: JobContext, mode: 'repair' | 'translate' = 'repair'): Promise<RenameItem[]> {
  const out: RenameItem[] = []
  const works = worksOf(db, ids)
  const translated = mode === 'translate' ? namesMap(db) : null
  for (let i = 0; i < works.length; i++) {
    ctx?.report(i, works.length)
    const w = works[i]
    const entries = await workEntries(w)
    const taken = new Map<string, Set<string>>() // folder → lower-case names after renaming
    for (const e of entries) {
      const d = dirname(e.path)
      if (!taken.has(d)) taken.set(d, new Set((e.depth < 0 ? (await readDir(d)).map((x) => x.name) : []).map((x) => x.toLowerCase())))
      taken.get(d)!.add(e.name.toLowerCase())
    }
    for (const e of entries) {
      // the work folder takes its translation only when its own title is
      // Japanese (a Korean folder keeps its name even if the DLsite title was
      // translated for showing)
      const found = translated?.get(e.path)
      const t = found && (e.depth >= 0 || needsTranslation(workTitle(e.fixed).title)) ? found : undefined
      const target = !t ? e.fixed : e.depth < 0 ? translatedFolder(e.fixed, t) : t + splitSuffix(e.fixed, e.dir).suffix
      let name = safeName(target)
      if (name === e.name) continue
      const used = taken.get(dirname(e.path))!
      used.delete(e.name.toLowerCase())
      let problem: RenameItem['problem']
      if (used.has(name.toLowerCase())) {
        problem = 'conflict'
        const ext = e.dir ? '' : extname(name)
        const base = name.slice(0, name.length - ext.length)
        for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})${ext}`
      }
      used.add(name.toLowerCase())
      const to = join(dirname(e.path), name)
      if (to.length > MAX_PATH) problem = 'too-long'
      out.push({
        id: itemId(e.path),
        workId: w.id,
        workTitle: w.title,
        from: e.path,
        to,
        dir: e.dir,
        work: e.depth < 0 || undefined,
        translated: !!t || undefined,
        filled: e.filled,
        // in a 뷁어 name every "_" left may be a lost character (or a real one)
        unfilled: e.moji ? (name.match(/_/g) ?? []).length : 0,
        problem
      })
    }
  }
  return out
}

export interface RenameUndo {
  label: string
  items: { from: string; to: string }[] // in the order they were renamed
}

export type AfterRename = (pairs: { from: string; to: string }[], items?: RenameItem[]) => Promise<void>

// Children before their folders (the plan's order), so every path is still
// valid when its turn comes. Undo goes backwards. Never over an existing
// file (Windows rename would replace it).
export async function runRename(log: ActionLog, items: RenameItem[], ctx: JobContext, after?: AfterRename): Promise<ToolResult> {
  const undo: RenameUndo = { label: items.some((x) => x.translated) ? '이름 바꾸기 (번역)' : '이름 복구', items: [] }
  const failed: string[] = []
  const todo = items.filter((x) => x.problem !== 'too-long')
  for (let i = 0; i < todo.length; i++) {
    if (ctx.signal.aborted) break
    const it = todo[i]
    ctx.report(i, todo.length, `이름 바꾸는 중 · ${basename(it.to)}`)
    try {
      if (it.to.toLowerCase() !== it.from.toLowerCase() && (await exists(it.to))) throw new Error('같은 이름의 파일이 이미 있습니다')
      await fs.rename(it.from, it.to)
      undo.items.push({ from: it.from, to: it.to })
    } catch (e) {
      failed.push(`${basename(it.from)}: ${String((e as Error)?.message ?? e)}`)
    }
  }
  if (undo.items.length) {
    log.record('tools.rename', undo)
    ctx.report(todo.length, todo.length, '라이브러리에 반영하는 중')
    await after?.(undo.items, items)
  }
  ctx.report(todo.length, todo.length)
  return { ok: !failed.length, message: `이름 ${undo.items.length}개를 바꿨습니다${failed.length ? `, ${failed.length}개 실패` : ''}`, done: undo.items.length, failed }
}

const exists = (p: string): Promise<boolean> =>
  fs.stat(p).then(
    () => true,
    () => false
  )

export function registerRenameUndo(log: ActionLog, after?: AfterRename): void {
  log.register<RenameUndo>('tools.rename', async (p) => {
    const back = [...p.items].reverse().map((it) => ({ from: it.to, to: it.from }))
    for (const it of back) await fs.rename(it.from, it.to)
    await after?.(back)
  })
}
