// After the engine: drop what it made up, merge stutters, and cut long lines
// into subtitle-sized cues.
import type { Cue } from '../../shared/types'

export interface AsrWord {
  start: number
  end: number
  text: string
  p?: number // probability 0–1 when the engine gives one
}

export interface AsrSegment {
  start: number // s
  end: number
  text: string
  words?: AsrWord[]
  noSpeech?: number // the engine's "no speech" probability
}

export const CLEAN = {
  maxChars: 30, // a cue longer than this is split at punctuation
  maxRepeat: 2, // the same line more than this many times in a row → once
  noSpeechMax: 0.8 // segments the engine itself thinks are silence
}

// Lines whisper writes into silence / music (Japanese YouTube outros etc.).
const HALLUCINATIONS = [
  /ご視聴(ありがとう|有難う)ございました/,
  /ご清聴ありがとうございました/,
  /チャンネル登録/,
  /高評価/,
  /字幕(は|by|：|:)/i,
  /次回(も|の)動画/,
  /^(\s|[。、…・.]+)*$/,
  /^\(.*(音楽|拍手|笑).*\)$/,
  /^[(（]?(BGM|bgm|♪+)[)）]?$/
]

const norm = (s: string): string => s.replace(/[\s。、！？!?…・.,]/g, '')

export function cleanSegments(segs: AsrSegment[]): AsrSegment[] {
  const out: AsrSegment[] = []
  let run = 0
  for (const s of segs) {
    const text = collapseRuns(s.text.trim())
    if (!text || HALLUCINATIONS.some((r) => r.test(text))) continue
    if ((s.noSpeech ?? 0) > CLEAN.noSpeechMax) continue
    const last = out[out.length - 1]
    if (last && norm(last.text) === norm(text)) {
      run++
      if (run >= CLEAN.maxRepeat) {
        last.end = Math.max(last.end, s.end)
        continue
      }
    } else run = 0
    out.push({ ...s, text })
  }
  return out
}

// "あああああああああああ" → at most 8 of the same character in a row.
function collapseRuns(s: string): string {
  return s.replace(/(.)\1{8,}/gu, (_m, c: string) => c.repeat(8))
}

// Segments → cues, long ones split at sentence punctuation with the time
// shared out by length (by word times when the engine gave them).
export function toCues(segs: AsrSegment[]): Cue[] {
  const cues: Cue[] = []
  for (const s of segs) {
    const parts = splitText(s.text)
    const total = parts.reduce((n, p) => n + p.length, 0) || 1
    let t = s.start
    for (const p of parts) {
      const len = ((s.end - s.start) * p.length) / total
      cues.push({ start: round(t), end: round(t + len), text: p })
      t += len
    }
  }
  return cues
}

function splitText(text: string): string[] {
  if (text.length <= CLEAN.maxChars) return [text]
  const sentences = text.match(/[^。！？!?♡♪]+[。！？!?♡♪]*/gu) ?? [text]
  const out: string[] = []
  let cur = ''
  for (const s of sentences) {
    if (cur && (cur + s).length > CLEAN.maxChars) {
      out.push(cur)
      cur = ''
    }
    cur += s
    while (cur.length > CLEAN.maxChars * 1.6) {
      const cut = cur.lastIndexOf('、', CLEAN.maxChars) > 4 ? cur.lastIndexOf('、', CLEAN.maxChars) + 1 : CLEAN.maxChars
      out.push(cur.slice(0, cut))
      cur = cur.slice(cut)
    }
  }
  if (cur) out.push(cur)
  return out.map((x) => x.trim()).filter(Boolean)
}

const round = (t: number): number => Math.round(t * 1000) / 1000
