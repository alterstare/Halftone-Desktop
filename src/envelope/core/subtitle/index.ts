// Subtitles (CLAUDE.md §5.3): read vtt / srt / lrc / ass in any of the
// encodings these works ship with, tell the language, write vtt.
import iconv from 'iconv-lite'
import type { Cue, SubLang } from '../../shared/types'
import { isExtHangul, MOJIBAKE_RATIO } from '../names/mojibake'

export type { Cue, SubLang }

export const SUB_EXTS = new Set(['.vtt', '.srt', '.lrc', '.ass', '.ssa'])

// First line of every file Env writes (so it knows which files it may update).
export const ENV_MARK = 'NOTE Env'

// ---- text decoding ----

// UTF-8 / UTF-16 (BOM), else UTF-8 if valid, else whichever of Shift-JIS and
// CP949 reads with fewer broken characters. Shift-JIS bytes often read as
// valid CP949 too — but then as 뷁어 (extension hangul), which decides ties.
export function decodeText(buf: Buffer): string {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8')
  if (buf[0] === 0xff && buf[1] === 0xfe) return iconv.decode(buf.subarray(2), 'utf16le')
  if (buf[0] === 0xfe && buf[1] === 0xff) return iconv.decode(buf.subarray(2), 'utf16be')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    // not UTF-8
  }
  const bad = (s: string): number => (s.match(/�/g) ?? []).length
  const sjis = iconv.decode(buf, 'shift_jis')
  const kr = iconv.decode(buf, 'cp949')
  if (bad(sjis) !== bad(kr)) return bad(sjis) < bad(kr) ? sjis : kr
  const hangul = [...kr].filter((c) => /[가-힣]/.test(c))
  const ext = hangul.filter(isExtHangul).length
  return hangul.length && ext / hangul.length < MOJIBAKE_RATIO ? kr : sjis
}

// ---- language ----

export function langOfText(s: string): SubLang {
  const hangul = (s.match(/[가-힣]/g) ?? []).length
  const kana = (s.match(/[぀-ヿ]/g) ?? []).length
  if (!hangul && !kana) return 'other'
  return hangul >= kana ? 'ko' : 'ja'
}

const LANG_TAG: Record<string, SubLang> = { ja: 'ja', jp: 'ja', jpn: 'ja', japanese: 'ja', ko: 'ko', kr: 'ko', kor: 'ko', korean: 'ko' }

// "x.ja.srt" → 'ja'; null when the name has no language tag.
export function langOfName(name: string): SubLang | null {
  const m = name.toLowerCase().match(/\.([a-z]{2,8})\.(?:vtt|srt|lrc|ass|ssa)$/)
  return (m && LANG_TAG[m[1]]) || null
}

// ---- parsing ----

function time(s: string): number {
  // 01:02:03.456 / 02:03.456 / 01:02:03,456
  const p = s.trim().replace(',', '.').split(':').map(Number)
  return p.reduce((acc, x) => acc * 60 + x, 0)
}

const clean = (s: string): string =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim()

const TIMING = /(\d{1,2}:)?\d{1,2}:\d{1,2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{1,2}[.,]\d{1,3}/

// vtt and srt: blocks separated by blank lines, a timing line, then text.
function parseBlocks(text: string): Cue[] {
  const out: Cue[] = []
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n')
    const i = lines.findIndex((l) => TIMING.test(l))
    if (i < 0 || /^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue
    const [a, b] = lines[i].split('-->')
    const body = clean(lines.slice(i + 1).join('\n'))
    // cue id "low": script alignment wasn't sure of the timing (shown in the editor)
    if (body) out.push({ start: time(a), end: time(b.trim().split(/\s/)[0]), text: body, ...(i > 0 && lines[i - 1].trim() === 'low' ? { low: true } : {}) })
  }
  return out
}

function parseLrc(text: string): Cue[] {
  const marks: { t: number; text: string }[] = []
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)]
    if (!stamps.length) continue
    const body = clean(line.replace(/\[[^\]]*\]/g, ''))
    for (const s of stamps) marks.push({ t: Number(s[1]) * 60 + Number(s[2].replace(':', '.')), text: body })
  }
  marks.sort((a, b) => a.t - b.t)
  return marks
    .map((m, i) => ({ start: m.t, end: marks[i + 1]?.t ?? m.t + 5, text: m.text }))
    .filter((c) => c.text)
}

function parseAss(text: string): Cue[] {
  const out: Cue[] = []
  let format: string[] = []
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (/^Format:/i.test(line) && !format.length) format = line.slice(7).split(',').map((s) => s.trim().toLowerCase())
    if (!/^Dialogue:/i.test(line) || !format.length) continue
    const parts = line.slice(9).split(',')
    const at = (k: string): string => parts[format.indexOf(k)] ?? ''
    const body = parts
      .slice(format.indexOf('text'))
      .join(',')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/gi, '\n')
      .trim()
    if (body) out.push({ start: time(at('start')), end: time(at('end')), text: body })
  }
  return out
}

export function parseSubtitle(text: string, ext: string): Cue[] {
  const e = ext.toLowerCase()
  const cues = e === '.lrc' ? parseLrc(text) : e === '.ass' || e === '.ssa' ? parseAss(text) : parseBlocks(text)
  return cues.filter((c) => isFinite(c.start) && isFinite(c.end)).sort((a, b) => a.start - b.start)
}

// ---- writing ----

function stamp(s: number): string {
  const ms = Math.max(0, Math.round(s * 1000))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const sec = Math.floor((ms % 60000) / 1000)
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(sec)}.${pad(ms % 1000, 3)}`
}

export function toVtt(cues: Cue[]): string {
  const body = cues.map((c) => `${c.low ? 'low\n' : ''}${stamp(c.start)} --> ${stamp(c.end)}\n${c.text.trim()}`).join('\n\n')
  return `WEBVTT\n\n${ENV_MARK} — Envelope에서 만든 자막입니다.\n\n${body}\n`
}

export const isEnvMade = (text: string): boolean => text.slice(0, 200).includes(ENV_MARK)
