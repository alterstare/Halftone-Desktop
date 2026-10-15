// 자동 자막: for each track of a work — decode → find speech → engine (chunk by
// chunk, each result cached so a stopped job resumes where it was) → clean →
// "<name>.ja.vtt"; then translate those lines → "<name>.ko.vtt". Existing
// subtitles are kept unless the user asks to redo them.
import { promises as fsp } from 'fs'
import type { AutoSubOptions, AutoSubResult, Cue, SubLang, SubtitleText, TrackGroup, TrackVersion, WorkDetail } from '../shared/types'
import type { Db } from './db'
import type { AsrEngine } from './asr/engines'
import type { AsrSegment } from './asr/clean'
import { cleanSegments, toCues } from './asr/clean'
import { chunkAudio, detectSpeech, planChunks, toTrackTime } from './asr/vad'
import type { GlossaryEntry, Translator } from './translate'
import { TranslateStop, translateLines } from './translate'
import type { JobContext } from './queue'

export type DecodeFn = (path: string, signal?: AbortSignal) => Promise<Int16Array>

export type { AutoSubOptions, AutoSubResult }

export interface AutoSubDeps {
  decode: DecodeFn
  asr: AsrEngine | null
  maxChunkS: number
  translator: Translator | null
  glossary: GlossaryEntry[]
  prompt: string
  readSub: (path: string) => Promise<SubtitleText>
  saveSub: (trackId: number, lang: SubLang, cues: Cue[], overwrite: boolean) => Promise<{ conflict: boolean }>
}


// Engine results by key (chunks of audio, translated batches).
export function cacheGet<T>(db: Db, key: string): T | null {
  const r = db.prepare('SELECT result_json FROM jobs WHERE key = ?').get(key) as { result_json: string } | undefined
  return r ? (JSON.parse(r.result_json) as T) : null
}
export function cachePut(db: Db, key: string, kind: string, engine: string, value: unknown): void {
  db.prepare(
    'INSERT INTO jobs (key, kind, engine, result_json, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET result_json = excluded.result_json, created_at = excluded.created_at'
  ).run(key, kind, engine, JSON.stringify(value), Date.now())
}

// The file to transcribe: the voice-only version when there is one (clearer
// speech), else the one played.
export function sourceVersion(g: TrackGroup): TrackVersion {
  const audio = g.versions.filter((v) => v.kind === 'audio')
  return audio.find((v) => v.se === 'off') ?? g.versions.find((v) => v.id === g.chosen) ?? audio[0] ?? g.versions[0]
}

async function subOf(g: TrackGroup, lang: SubLang, read: AutoSubDeps['readSub']): Promise<SubtitleText | null> {
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

export async function autoSubWork(db: Db, work: WorkDetail, deps: AutoSubDeps, opts: AutoSubOptions, ctx: JobContext): Promise<AutoSubResult> {
  const res: AutoSubResult = { made: 0, skipped: [], failed: [] }
  // Korean-voice works: their speech is Korean, nothing to translate
  const lang: SubLang = work.lang === 'ko-voice' ? 'ko' : 'ja'
  const groups = work.groups.filter(
    (g) => (g.role === 'main' || (opts.extras && g.role === 'extra')) && (!opts.groupKeys || opts.groupKeys.includes(g.key)) && g.versions.some((v) => v.kind === 'audio')
  )
  const steps = groups.length * ((opts.transcribe ? 1 : 0) + (opts.translate && lang === 'ja' ? 1 : 0)) || 1
  let step = 0
  const report = (frac: number, label: string): void => ctx.report(Math.min(steps, step + frac), steps, label)

  for (const g of groups) {
    ctx.signal.throwIfAborted()
    const v = sourceVersion(g)
    try {
      let original = await subOf(g, lang, deps.readSub)
      if (opts.transcribe) {
        if (original && !opts.redo) res.skipped.push(`${g.title}: 자막이 이미 있습니다`)
        else if (!deps.asr) throw new Error('받아쓰기 엔진이 없습니다')
        else {
          report(0, `받아쓰기 · ${g.title}`)
          const cues = await transcribeTrack(db, v, deps, lang, ctx, (f) => report(f, `받아쓰기 · ${g.title}`))
          if (!cues.length) res.skipped.push(`${g.title}: 말소리를 찾지 못했습니다`)
          else {
            const saved = await deps.saveSub(v.id, lang, cues, opts.redo)
            if (saved.conflict) res.skipped.push(`${g.title}: 다른 프로그램이 만든 자막이 있어 저장하지 않았습니다`)
            else {
              res.made++
              original = { path: '', cues, lang, envMade: true }
            }
          }
        }
        step++
      }
      if (opts.translate && lang === 'ja') {
        const ko = await subOf(g, 'ko', deps.readSub)
        if (!original?.cues.length) res.skipped.push(`${g.title}: 번역할 일본어 자막이 없습니다`)
        else if (ko && !opts.redo) res.skipped.push(`${g.title}: 한국어 자막이 이미 있습니다`)
        else if (!deps.translator) throw new Error('번역 엔진이 없습니다')
        else {
          report(0, `번역 · ${g.title}`)
          const src = original.cues
          const out = await translateLines(
            src.map((c) => c.text.replace(/\n/g, ' ')),
            deps.translator,
            {
              kind: 'subtitle',
              glossary: deps.glossary,
              prompt: deps.prompt,
              signal: ctx.signal,
              onWait: (w) => report(0, w ? `번역 · ${g.title} · 사용 한도 대기 ${w}초` : `번역 · ${g.title}`)
            },
            (d, t) => report(d / t, `번역 · ${g.title}`)
          )
          const cues = src.map((c, i) => ({ start: c.start, end: c.end, text: out[i].trim() })).filter((c) => c.text)
          const saved = await deps.saveSub(v.id, 'ko', cues, opts.redo)
          if (saved.conflict) res.skipped.push(`${g.title}: 다른 프로그램이 만든 한국어 자막이 있어 저장하지 않았습니다`)
          else res.made++
        }
        step++
      }
    } catch (e) {
      if (ctx.signal.aborted || e instanceof TranslateStop) throw e
      res.failed.push(`${g.title}: ${String((e as Error)?.message ?? e)}`)
      step = Math.ceil(step + 0.01)
    }
  }
  return res
}

// One track → cues on the track's clock.
export async function transcribeTrack(
  db: Db,
  v: TrackVersion,
  deps: AutoSubDeps,
  language: string,
  ctx: JobContext,
  onFraction: (f: number) => void,
  words = false
): Promise<Cue[]> {
  const segs = await transcribeSegments(db, v, deps, language, ctx, onFraction, words)
  return toCues(cleanSegments(segs))
}

export async function transcribeSegments(
  db: Db,
  v: TrackVersion,
  deps: AutoSubDeps,
  language: string,
  ctx: JobContext,
  onFraction: (f: number) => void,
  words = false
): Promise<AsrSegment[]> {
  const asr = deps.asr!
  const st = await fsp.stat(v.path)
  const fileKey = `${v.path}|${st.size}|${Math.round(st.mtimeMs)}`
  const pcm = await deps.decode(v.path, ctx.signal)
  const chunks = planChunks(detectSpeech(pcm), deps.maxChunkS)
  const total = chunks.reduce((n, c) => n + c.length, 0) || 1
  let doneS = 0
  const all: AsrSegment[] = []
  for (let i = 0; i < chunks.length; i++) {
    ctx.signal.throwIfAborted()
    const c = chunks[i]
    const key = `asr|${asr.id}|${language}|${words ? 'w' : 's'}|${fileKey}|${i}|${c.pieces[0].src.toFixed(2)}|${c.length.toFixed(2)}`
    let segs = cacheGet<AsrSegment[]>(db, key)
    if (!segs) {
      segs = await asr.transcribe(chunkAudio(pcm, c), {
        language,
        words,
        signal: ctx.signal,
        onProgress: (f) => onFraction((doneS + f * c.length) / total)
      })
      cachePut(db, key, 'asr', asr.id, segs)
    }
    for (const s of segs) {
      all.push({
        ...s,
        start: toTrackTime(c, s.start),
        end: toTrackTime(c, s.end),
        words: s.words?.map((w) => ({ ...w, start: toTrackTime(c, w.start), end: toTrackTime(c, w.end) }))
      })
    }
    doneS += c.length
    onFraction(doneS / total)
  }
  return all.sort((a, b) => a.start - b.start)
}
