// 대본 기반 자막: script lines per track → timings from a small speech model
// (tiny, then base / small when too many lines stay unsure) → subtitles in
// the script's language, and for a Japanese script also Korean (the script is
// translated, which is better than translating what the engine heard).
import type { AutoSubResult, Cue, ScriptPreview, ScriptSource, ScriptSubOptions, SubLang, SubtitleText, TrackGroup, WorkDetail } from '../../shared/types'
import type { Db } from '../db'
import type { AsrEngine } from '../asr/engines'
import type { JobContext } from '../queue'
import type { DecodeFn } from '../autosub'
import { sourceVersion, transcribeSegments } from '../autosub'
import type { GlossaryEntry, Translator } from '../translate'
import { TranslateStop, translateLines } from '../translate'
import { readScript } from './read'
import { scriptLines, splitByTracks } from './text'
import { ALIGN, alignAcross, alignByLength, alignJapanese, toAlignedCues } from './align'

export { findScripts, scriptFromFile } from './read'

// The script lines of each track; null = a whole script without track
// headings (the lines are then placed by aligning across all tracks).
export async function scriptByTrack(work: WorkDetail, src: ScriptSource): Promise<Map<string, string[]> | null> {
  if (src.kind === 'perTrack') {
    const out = new Map<string, string[]>()
    for (const f of src.files ?? []) {
      const lines = scriptLines(await readScript(f.path))
        .filter((l) => l.heading === undefined)
        .map((l) => l.text)
      if (lines.length) out.set(f.groupKey, lines)
    }
    return out
  }
  return splitByTracks(scriptLines(await readScript(src.path)), work.groups)
}

export async function previewScript(work: WorkDetail, src: ScriptSource): Promise<ScriptPreview[]> {
  const by = await scriptByTrack(work, src)
  if (!by) return [] // no headings: split by what is heard, while making the subtitles
  return work.groups
    .filter((g) => by.has(g.key))
    .map((g) => ({ groupKey: g.key, title: g.title, lines: by.get(g.key)!.length, first: by.get(g.key)![0] }))
}

export interface ScriptSubDeps {
  decode: DecodeFn
  // engines to try for timings, smallest first (local: tiny → base → small)
  alignEngines: () => Promise<AsrEngine[]>
  asr: () => Promise<AsrEngine> // Korean scripts: segments from the normal engine
  maxChunkS: number
  translator: Translator | null
  glossary: GlossaryEntry[]
  prompt: string
  readSub: (path: string) => Promise<SubtitleText>
  saveSub: (trackId: number, lang: SubLang, cues: Cue[], overwrite: boolean) => Promise<{ conflict: boolean }>
}

async function hasSub(g: TrackGroup, lang: SubLang, read: ScriptSubDeps['readSub']): Promise<SubtitleText | null> {
  for (const v of g.versions)
    for (const s of v.subs) {
      if (s.lang === lang) return read(s.path)
      if (s.lang === null) {
        const t = await read(s.path).catch(() => null)
        if (t?.lang === lang) return t
      }
    }
  return null
}

export async function scriptSubWork(db: Db, work: WorkDetail, src: ScriptSource, deps: ScriptSubDeps, opts: ScriptSubOptions, ctx: JobContext): Promise<AutoSubResult> {
  const res: AutoSubResult = { made: 0, skipped: [], failed: [] }
  const lang: SubLang = src.lang === 'ko' ? 'ko' : 'ja'
  let by = await scriptByTrack(work, src)
  // timings found while splitting (whole script, no headings)
  const placed = new Map<string, Cue[]>()
  if (!by) {
    if (lang !== 'ja') throw new Error('트랙 제목이 없는 대본은 일본어 대본만 맞출 수 있습니다')
    const heard = await splitByHearing(db, work, src, deps, ctx)
    for (const [k, v] of heard) placed.set(k, v.cues)
    by = new Map([...heard].map(([k, v]) => [k, v.cues.map((c) => c.text)]))
  }
  const groups = work.groups.filter((g) => by.has(g.key))
  const total = groups.length || 1
  let step = 0
  for (const g of groups) {
    ctx.signal.throwIfAborted()
    const lines = by.get(g.key)!
    const v = sourceVersion(g)
    const report = (f: number, label: string): void => ctx.report(Math.min(total, step + f), total, `${label} · ${g.title}`)
    try {
      const existing = await hasSub(g, lang, deps.readSub)
      if (existing && !opts.redo) {
        res.skipped.push(`${g.title}: 자막이 이미 있습니다`)
        step++
        continue
      }
      const duration = g.duration ?? 0
      let cues: Cue[]
      if (placed.has(g.key)) cues = placed.get(g.key)!
      else if (lang === 'ja') {
        // smallest model first; a bigger one when too many lines stay unsure
        let best: Cue[] | null = null
        let bestLow = Infinity
        const engines = await deps.alignEngines()
        for (let e = 0; e < engines.length; e++) {
          const segs = await transcribeSegments(db, v, { ...deps, asr: engines[e], translator: null, glossary: [], saveSub: deps.saveSub }, 'ja', ctx, (f) => report((e + f) / engines.length, '대본 맞추기'), true)
          const c = toAlignedCues(lines, alignJapanese(lines, segs, duration || segs[segs.length - 1]?.end || 0))
          const low = c.filter((x) => x.low).length / Math.max(1, c.length)
          if (low < bestLow) {
            best = c
            bestLow = low
          }
          if (low <= ALIGN.retryRatio) break
        }
        cues = best ?? []
      } else {
        const segs = await transcribeSegments(db, v, { ...deps, asr: await deps.asr(), translator: null, glossary: [], saveSub: deps.saveSub }, 'ja', ctx, (f) => report(f, '대본 맞추기'))
        cues = toAlignedCues(lines, alignByLength(lines, segs, duration || segs[segs.length - 1]?.end || 0))
      }
      const saved = await deps.saveSub(v.id, lang, cues, opts.redo)
      if (saved.conflict) res.skipped.push(`${g.title}: 다른 프로그램이 만든 자막이 있어 저장하지 않았습니다`)
      else res.made++
      if (lang === 'ja' && opts.translate) {
        const ko = await hasSub(g, 'ko', deps.readSub)
        if (ko && !opts.redo) res.skipped.push(`${g.title}: 한국어 자막이 이미 있습니다`)
        else if (!deps.translator) throw new Error('번역 엔진이 없습니다')
        else {
          const out = await translateLines(lines, deps.translator, {
              kind: 'script',
              glossary: deps.glossary,
              prompt: deps.prompt,
              signal: ctx.signal,
              onWait: (w) => report(0.7, w ? `대본 번역 · 사용 한도 대기 ${w}초` : '대본 번역')
            }, (d, t) =>
            report(0.7 + (0.3 * d) / t, '대본 번역')
          )
          const koCues = cues.map((c, i) => ({ ...c, text: out[i].trim() })).filter((c) => c.text)
          const s2 = await deps.saveSub(v.id, 'ko', koCues, opts.redo)
          if (!s2.conflict) res.made++
        }
      }
    } catch (e) {
      if (ctx.signal.aborted || e instanceof TranslateStop) throw e
      res.failed.push(`${g.title}: ${String((e as Error)?.message ?? e)}`)
    }
    step++
  }
  return res
}

// Whole script, no headings: transcribe every main track (small model, word
// times), align the script across them all, give each line to its track.
// Tries the next model when too many lines stay unsure.
async function splitByHearing(db: Db, work: WorkDetail, src: ScriptSource, deps: ScriptSubDeps, ctx: JobContext): Promise<Map<string, { cues: Cue[] }>> {
  const lines = scriptLines(await readScript(src.path))
    .filter((l) => l.heading === undefined)
    .map((l) => l.text)
  const groups = work.groups.filter((g) => g.role === 'main')
  const engines = await deps.alignEngines()
  let best: Map<string, { cues: Cue[] }> | null = null
  let bestLow = Infinity
  for (let e = 0; e < engines.length; e++) {
    const tracks: { segs: Awaited<ReturnType<typeof transcribeSegments>>; total: number }[] = []
    for (let k = 0; k < groups.length; k++) {
      const g = groups[k]
      const segs = await transcribeSegments(
        db,
        sourceVersion(g),
        { ...deps, asr: engines[e], translator: null, glossary: [], saveSub: deps.saveSub },
        'ja',
        ctx,
        (f) => ctx.report((k + f) / groups.length, 1, `대본 나누기 · ${g.title}`),
        true
      )
      tracks.push({ segs, total: g.duration ?? segs[segs.length - 1]?.end ?? 0 })
    }
    const across = alignAcross(lines, tracks)
    const out = new Map<string, { cues: Cue[] }>()
    let low = 0
    for (const [k, v] of across) {
      const cues = toAlignedCues(v.lines, v.al)
      low += cues.filter((c) => c.low).length
      out.set(groups[k].key, { cues })
    }
    const ratio = low / Math.max(1, lines.length)
    if (ratio < bestLow) {
      best = out
      bestLow = ratio
    }
    if (ratio <= ALIGN.retryRatio) break
  }
  return best ?? new Map()
}
