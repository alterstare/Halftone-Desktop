// Library scan (CLAUDE.md §5.1, cases from a real library analysis): find the
// works under a library folder, then inside each work sort files into tracks
// (with their versions: SE on/off × format folders × editions), extras,
// samples and images. Names are repaired (뷁어) before anything reads them;
// files are never touched.
import { promises as fs } from 'fs'
import type { Dirent } from 'fs'
import { basename, extname, join } from 'path'
import { fillName, repairSiblings } from '../names/mojibake'
import { naturalCompare, nfkc, stem, trackKey, trackNumber } from '../names/normalize'
import { folderRole, isSampleName, labelKey, seOf } from './roles'
import type { FolderRole } from './roles'
import { probe } from './probe'
import { SUB_EXTS, langOfName } from '../subtitle'
import type { SubFile } from '../../shared/types'

export const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus'])
export const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.webm'])
export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif'])
const JUNK = /^(?:thumbs\.db|\.ds_store|desktop\.ini)$|^\._/i
const CODE = /(?<![a-z0-9])([RVB]J\d{6,8})(?!\d)/i
// Same track in two groups only if their lengths agree this closely: seconds,
// or a share of the length (voice-only versions run a few % shorter).
const MERGE_TOLERANCE_S = 2
const MERGE_TOLERANCE_RATIO = 0.05

export type Se = 'on' | 'off' | 'unknown'
export type Role = 'main' | 'extra' | 'sample'

export interface ScannedTrack {
  path: string
  title: string // repaired file name without extension
  ext: string // '.mp3'
  kind: 'audio' | 'video'
  role: Role
  edition: string // '' when the work has one edition
  editionKey: string
  se: Se
  formatDir: string // nearest format folder ("wav"), '' if none
  groupKey: string // equal for versions of one track
  sort: number // order of the track's group in the work
  duration: number | null
  bitrate: number | null
  size: number
  mtime: number
  mojibake: boolean // its name or a folder on the way was 뷁어
  relDir: string // repaired folder path inside the work, '/'-joined
  subs: SubFile[] // subtitle files next to it with the same name
}

export interface ScannedWork {
  path: string
  code: string | null
  title: string
  cover: string | null
  images: string[] // background order
  tracks: ScannedTrack[]
  mojibake: boolean
  addedAt: number | null // folder creation time ("추가순")
}

// Earlier probe results, reused while size and mtime are unchanged.
export type KnownProbes = Map<string, { size: number; mtime: number; duration: number | null; bitrate: number | null }>

export async function readDir(dir: string): Promise<Dirent[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((e) => !JUNK.test(e.name))
  } catch {
    return []
  }
}

async function hasMedia(dir: string, depth = 0): Promise<boolean> {
  if (depth > 6) return false
  const entries = await readDir(dir)
  for (const e of entries) {
    const ext = extname(e.name).toLowerCase()
    if (e.isFile() && (AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext))) return true
  }
  for (const e of entries) if (e.isDirectory() && (await hasMedia(join(dir, e.name), depth + 1))) return true
  return false
}

// Works under a library folder: each folder right below it — or, for a
// circle-style folder whose children carry work codes, those children.
export async function findWorks(root: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await readDir(root)) {
    if (!e.isDirectory()) continue
    const p = join(root, e.name)
    if (CODE.test(e.name)) {
      out.push(p)
      continue
    }
    const coded = (await readDir(p)).filter((c) => c.isDirectory() && CODE.test(c.name))
    if (coded.length) out.push(...coded.map((c) => join(p, c.name)))
    else if (await hasMedia(p)) out.push(p)
  }
  return out.sort(naturalCompare)
}

interface RawFile {
  path: string
  segs: string[] // repaired folder names inside the work
  name: string // repaired file name
  mojibake: boolean
  size: number
  mtime: number
}

// parentMoji: the folder itself is 뷁어 (context for short names); anyMoji: any
// folder on the way is (the track is flagged).
async function walk(dir: string, segs: string[], parentMoji: boolean, anyMoji: boolean, out: RawFile[], dirs: string[][]): Promise<void> {
  const entries = await readDir(dir)
  const fixed = repairSiblings(
    entries.map((e) => e.name),
    parentMoji
  )
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const p = join(dir, e.name)
    const moji = fixed[i].mojibake || anyMoji
    if (e.isDirectory()) {
      dirs.push([...segs, fixed[i].text])
      await walk(p, [...segs, fixed[i].text], fixed[i].mojibake, moji, out, dirs)
    } else if (e.isFile() && extname(e.name)) {
      try {
        const st = await fs.stat(p)
        out.push({ path: p, segs, name: fixed[i].text, mojibake: moji, size: st.size, mtime: Math.floor(st.mtimeMs) })
      } catch {
        // vanished while scanning
      }
    }
  }
}

export function workTitle(folder: string): { code: string | null; title: string } {
  const name = repairSiblings([folder])[0].text
  const m = name.match(CODE)
  if (!m) return { code: null, title: name.trim() }
  const title = name.replace(m[0], '').replace(/^[\s_\-]+|[\s_\-]+$/g, '')
  return { code: m[1].toUpperCase(), title: title || m[1].toUpperCase() }
}

export async function scanWork(dir: string, known: KnownProbes = new Map()): Promise<ScannedWork> {
  const { code, title } = workTitle(basename(dir))
  const files: RawFile[] = []
  const dirs: string[][] = []
  await walk(dir, [], false, false, files, dirs)

  // Lost "_" characters: fill from the work title and every other name.
  const refs = [title, ...new Set([...files.map((f) => f.name), ...dirs.flat()])]
  const fill = (s: string): string => fillName(s, refs).text
  for (const f of files) {
    f.name = fill(f.name)
    f.segs = f.segs.map(fill)
  }

  // Subtitles by folder + name: "x.vtt", "x.ja.srt", "x.mp3.vtt", "x.wav.vtt".
  const subKey = (segs: string[], name: string): string => `${segs.join('/')}|${nfkc(name).toLowerCase().trim()}`
  const subs = new Map<string, { file: RawFile; inner: string }[]>()
  for (const f of files) {
    if (!SUB_EXTS.has(extname(f.name).toLowerCase())) continue
    const base = f.name.slice(0, -extname(f.name).length)
    const inner = extname(base).toLowerCase() // ".mp3" in "x.mp3.vtt"
    const k = subKey(f.segs, stem(f.name).replace(/\.(ja|jp|jpn|ko|kr|kor)$/i, ''))
    subs.set(k, [...(subs.get(k) ?? []), { file: f, inner }])
  }

  const tracks: ScannedTrack[] = []
  const images: RawFile[] = []
  for (const f of files) {
    const ext = extname(f.name).toLowerCase()
    if (IMAGE_EXTS.has(ext)) images.push(f)
    if (!AUDIO_EXTS.has(ext) && !VIDEO_EXTS.has(ext)) continue
    const roles: FolderRole[] = f.segs.map(folderRole)
    const t = stem(f.name)
    const role: Role = roles.some((r) => r.sample) || isSampleName(t) ? 'sample' : roles.some((r) => r.extra) ? 'extra' : 'main'
    const nearest = <K extends 'se' | 'format'>(k: K): FolderRole[K] | null => {
      for (let i = roles.length - 1; i >= 0; i--) if (roles[i][k]) return roles[i][k]
      return null
    }
    const edition = role === 'main' ? roles.map((r) => r.label).filter(Boolean).join(' / ') : ''
    let pr = known.get(f.path)
    if (!pr || pr.size !== f.size || pr.mtime !== f.mtime) pr = { size: f.size, mtime: f.mtime, ...(await probe(f.path, f.size)) }
    tracks.push({
      path: f.path,
      title: t,
      ext,
      kind: AUDIO_EXTS.has(ext) ? 'audio' : 'video',
      role,
      edition,
      editionKey: labelKey(edition),
      se: nearest('se') ?? seOf(t) ?? 'unknown',
      formatDir: nearest('format') ?? '',
      groupKey: '',
      sort: 0,
      duration: pr.duration,
      bitrate: pr.bitrate,
      size: f.size,
      mtime: f.mtime,
      mojibake: f.mojibake,
      relDir: f.segs.join('/'),
      // "x.mp3.vtt" before "x.wav.vtt" for x.mp3
      subs: (subs.get(subKey(f.segs, t)) ?? [])
        .sort((a, b) => Number(b.inner === ext) - Number(a.inner === ext))
        .map(({ file }) => ({ path: file.path, lang: langOfName(file.name) }))
    })
  }

  // Editions exist only when two folders name different ones; files outside
  // any edition folder then form their own. One named folder next to loose
  // files is just the same story with a longer folder name.
  const named = new Set(tracks.filter((t) => t.role === 'main' && t.editionKey).map((t) => t.editionKey))
  if (named.size <= 1)
    for (const t of tracks) {
      t.edition = ''
      t.editionKey = ''
    }

  groupTracks(tracks)
  const cover = pickCover(images)
  return {
    path: dir,
    code,
    title,
    cover: cover?.path ?? null,
    images: rankBackgrounds(images).map((i) => i.path),
    tracks,
    mojibake: files.some((f) => f.mojibake),
    addedAt: await fs.stat(dir).then(
      (st) => Math.floor(st.birthtimeMs || st.mtimeMs),
      () => null
    )
  }
}

// ---- grouping versions of one track ----

const slot = (t: ScannedTrack): string => `${t.se}|${t.formatDir}|${t.ext}`
const median = (g: ScannedTrack[]): number | null => {
  const d = g.map((t) => t.duration).filter((x): x is number => x !== null)
  return d.length ? d.sort((a, b) => a - b)[Math.floor(d.length / 2)] : null
}

// A group that has explicit SE versions: its unmarked versions are the other kind.
function resolveSe(g: ScannedTrack[]): void {
  const on = g.some((t) => t.se === 'on')
  const off = g.some((t) => t.se === 'off')
  if (on === off) return
  for (const t of g) if (t.se === 'unknown') t.se = on ? 'off' : 'on'
}

export function groupTracks(tracks: ScannedTrack[]): void {
  // 1. same normalized name
  const byKey = new Map<string, ScannedTrack[]>()
  for (const t of tracks) {
    const k = `${t.editionKey}|${t.role}|${trackKey(t.title)}`
    const g = byKey.get(k)
    if (g) g.push(t)
    else byKey.set(k, [t])
  }

  // 2. same track number, versions that don't collide, lengths that agree
  // ("ABC_Tr1_v1_Voice_Only" ↔ "ABC_Tr1_v1_20240130")
  const clusters: { key: string; tracks: ScannedTrack[] }[] = []
  for (const [key, g] of byKey) {
    const scope = key.slice(0, key.lastIndexOf('|'))
    const num = trackNumber(g[0].title)
    const d = median(g)
    const into =
      num === null
        ? undefined
        : clusters.find((c) => {
            if (!c.key.startsWith(scope + '|') || trackNumber(c.tracks[0].title) !== num) return false
            const slots = new Set(c.tracks.map(slot))
            if (g.some((t) => slots.has(slot(t)))) return false
            const cd = median(c.tracks)
            return d === null || cd === null || Math.abs(d - cd) <= Math.max(MERGE_TOLERANCE_S, MERGE_TOLERANCE_RATIO * Math.max(d, cd))
          })
    if (into) into.tracks.push(...g)
    else clusters.push({ key, tracks: [...g] })
  }

  for (const c of clusters) {
    resolveSe(c.tracks)
    for (const t of c.tracks) t.groupKey = c.key
  }
  const label = (c: { tracks: ScannedTrack[] }): string => c.tracks[0].title
  clusters.sort((a, b) => naturalCompare(label(a), label(b)))
  clusters.forEach((c, i) => c.tracks.forEach((t) => (t.sort = i)))
}

// ---- images ----

const COVER_GOOD = /タイトルあり|タイトルロゴあり|제목\s*있음|타이틀\s*(?:있음|포함)|title|ジャケット|jacket|cover|表紙|サムネ|thumb|main|メイン|키\s*비주얼|キービジュアル/
const ILLUST = /イラスト|일러스트|illust|자켓|재킷/
const PLAIN = /なし|無し|없음|제거|without|文字ナシ|ロゴ無し|no\s*title/
const COVER_BAD = /差分|sample|キャラクター|charactor|character|ストーリー|story|告知|cg|캐릭터|스토리/

function coverScore(f: RawFile): number {
  const n = nfkc(f.name).toLowerCase()
  let s = -f.segs.length
  if (COVER_GOOD.test(n)) s += 5
  if (ILLUST.test(n)) s += 3
  if (PLAIN.test(n)) s -= 2
  if (COVER_BAD.test(n)) s -= 4
  if (f.segs.some((x) => /sample|サンプル|샘플/i.test(x))) s -= 10
  return s
}

function bgScore(f: RawFile): number {
  const n = nfkc(f.name).toLowerCase()
  return coverScore(f) + (PLAIN.test(n) ? 7 : 0)
}

function pickCover(images: RawFile[]): RawFile | null {
  let best: RawFile | null = null
  let bestScore = -Infinity
  for (const f of images) {
    const s = coverScore(f)
    if (s > bestScore || (s === bestScore && best && naturalCompare(f.name, best.name) < 0)) {
      best = f
      bestScore = s
    }
  }
  return best
}

function rankBackgrounds(images: RawFile[]): RawFile[] {
  return images
    .filter((f) => !f.segs.some((x) => /sample|サンプル|샘플/i.test(x)))
    .map((f) => ({ f, s: bgScore(f) }))
    .sort((a, b) => b.s - a.s || naturalCompare(a.f.name, b.f.name))
    .map((x) => x.f)
}
