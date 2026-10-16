// 대본 찾기 · 읽기: whole-work scripts (台本 / daihon / シナリオ / 대본 …, as
// txt · pdf · docx) and per-track script folders (Script/, 다함께 번역 대본/ …
// — one txt per track, often a copy of the audio folders).
import { promises as fsp } from 'fs'
import { basename, dirname, extname, join, relative } from 'path'
import type { ScriptSource, TrackGroup, WorkDetail } from '../../shared/types'
import { decodeText, langOfText } from '../subtitle'
import { stem, trackKey, trackNumber } from '../names/normalize'

const SCRIPT_NAME = /台本|daihon|シナリオ|scenario|script|대본|recording|セリフ|せりふ|脚本/i
const NOT_SCRIPT = /readme|credit|license|作品説明|작품설명|規約|注意|お読み|사용\s*규약|使用/i
const EXTS = new Set(['.txt', '.pdf', '.docx'])

export async function readScript(path: string): Promise<string> {
  const ext = extname(path).toLowerCase()
  if (ext === '.docx') {
    const mammoth = await import('mammoth')
    return (await mammoth.extractRawText({ path })).value
  }
  if (ext === '.pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await fsp.readFile(path)), isEvalSupported: false, useSystemFonts: false }).promise
    const pages: string[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const content = await (await doc.getPage(p)).getTextContent()
      pages.push(content.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : '') : '')).join(''))
    }
    await doc.destroy()
    return pages.join('\n')
  }
  return decodeText(await fsp.readFile(path))
}

async function walk(dir: string, depth: number, out: string[]): Promise<void> {
  let list: import('fs').Dirent[]
  try {
    list = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of list) {
    const p = join(dir, e.name)
    if (e.isDirectory() && depth > 0) await walk(p, depth - 1, out)
    else if (e.isFile() && EXTS.has(extname(e.name).toLowerCase()) && !NOT_SCRIPT.test(e.name)) out.push(p)
  }
}

// The group a per-track script file belongs to: same name (any version), else
// the same track number.
function groupOf(file: string, groups: TrackGroup[]): TrackGroup | undefined {
  const key = trackKey(stem(basename(file)))
  const byName = groups.find((g) => g.versions.some((v) => trackKey(stem(basename(v.path))) === key))
  if (byName) return byName
  const n = trackNumber(stem(basename(file)))
  const main = groups.filter((g) => g.role === 'main')
  return n !== null ? main.find((g) => trackNumber(g.title) === n) : undefined
}

// A file the user picked as the script (any name, anywhere): one script for
// the whole work, like a found one. null = not a txt / pdf / docx.
export async function scriptFromFile(path: string): Promise<ScriptSource | null> {
  if (!EXTS.has(extname(path).toLowerCase())) return null
  return { id: `file:${path}`, kind: 'whole', path, label: basename(path), lang: await sampleLang(path) }
}

async function sampleLang(path: string): Promise<'ja' | 'ko' | 'other'> {
  try {
    const text = extname(path).toLowerCase() === '.txt' ? decodeText(await fsp.readFile(path)) : await readScript(path)
    return langOfText(text.slice(0, 6000))
  } catch {
    return 'other'
  }
}

export async function findScripts(work: WorkDetail): Promise<ScriptSource[]> {
  const files: string[] = []
  await walk(work.path, 5, files)
  const groups = work.groups.filter((g) => g.role !== 'sample')
  const out: ScriptSource[] = []
  const used = new Set<string>()
  // per-track: a folder where several txt files match tracks
  const byDir = new Map<string, string[]>()
  for (const f of files) if (extname(f).toLowerCase() === '.txt') byDir.set(dirname(f), [...(byDir.get(dirname(f)) ?? []), f])
  for (const [dir, list] of byDir) {
    const matched = list.map((f) => ({ f, g: groupOf(f, groups) })).filter((x) => x.g)
    if (matched.length < 2 && !(matched.length === 1 && groups.length === 1)) continue
    for (const m of matched) used.add(m.f)
    out.push({
      id: `dir:${dir}`,
      kind: 'perTrack',
      path: dir,
      label: relative(work.path, dir) || basename(dir),
      lang: await sampleLang(matched[0].f),
      files: matched.map((m) => ({ groupKey: m.g!.key, path: m.f }))
    })
  }
  // whole-work scripts
  for (const f of files) {
    if (used.has(f)) continue
    const rel = relative(work.path, f)
    if (!SCRIPT_NAME.test(rel)) continue
    out.push({ id: `file:${f}`, kind: 'whole', path: f, label: rel, lang: await sampleLang(f) })
  }
  // Korean per-track folders beat everything (nothing to translate); then Japanese
  const rank = (s: ScriptSource): number => (s.lang === 'ja' ? 0 : s.lang === 'ko' ? 1 : 2) + (s.kind === 'perTrack' ? 0 : 0.5)
  return out.sort((a, b) => rank(a) - rank(b))
}
