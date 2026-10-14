// 대본 정리 · 트랙 나누기: keep what is said, drop stage directions (（SE：…）,
// 【…】, ＜…＞), unwrap 名前「…」, and cut the whole script at track headings
// (トラック1 / Track 2 / 01. / 第3話 …).
import type { TrackGroup } from '../../shared/types'
import { nfkc, trackNumber } from '../names/normalize'

export interface ScriptLine {
  text: string
  heading?: number // track number of a heading line
}

const KANJI_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const HEADING = /^[\s#＃■□◆◇●○▼▽☆★◎【\[（(]*\s*(?:トラック|track|tr\.?|트랙|第|chapter|ch\.?)\s*([0-9０-９]+|[一二三四五六七八九十]+)/i
const NUM_HEADING = /^[\s【\[]*([0-9０-９]{1,2})\s*[.．、)）:：\]】\s]/

function headingNumber(line: string): number | null {
  const m = line.match(HEADING)
  if (m) {
    const raw = m[1]
    return /\d/.test(nfkc(raw)) ? Number(nfkc(raw)) : (raw.length === 2 && raw[0] === '十' ? 10 + (KANJI_NUM[raw[1]] ?? 0) : KANJI_NUM[raw] ?? null)
  }
  const n = line.match(NUM_HEADING)
  if (n && line.length <= 40 && !/[「『“"]/.test(line)) return Number(nfkc(n[1]))
  return null
}

const DIRECTION = /^[（(【＜<\[［〔].*[）)】＞>\]］〕]$/

export function scriptLines(raw: string): ScriptLine[] {
  const out: ScriptLine[] = []
  for (let line of raw.replace(/\r/g, '').split('\n')) {
    line = line.trim()
    if (!line) continue
    const h = headingNumber(line)
    if (h !== null) {
      out.push({ text: line, heading: h })
      continue
    }
    if (DIRECTION.test(line)) continue // a whole line of stage direction
    // inline directions / notes
    line = line.replace(/[（(](?:SE|ＳＥ|効果音|BGM|ＢＧＭ|間|ト書き|注|※)[^）)]*[）)]/g, '').replace(/【[^】]*】|＜[^＞]*＞|<[^>]*>/g, '')
    // 名前「…」 / 名前『…』 → what is said
    const quoted = line.match(/^[^「『]{0,12}[「『](.*)[」』]$/)
    if (quoted) line = quoted[1]
    else {
      const named = line.match(/^([^\s：:「」]{1,10})[：:]\s*(.+)$/)
      if (named) line = named[2]
    }
    line = line.replace(/^[「『]|[」』]$/g, '').trim()
    if (line && /[\p{L}\p{N}]/u.test(line)) out.push({ text: line })
  }
  return out
}

// Track headings → the lines of each track. Headings name a track number;
// without any (or with one track only) everything goes to the first track.
export function splitByTracks(lines: ScriptLine[], groups: TrackGroup[]): Map<string, string[]> | null {
  const main = groups.filter((g) => g.role === 'main')
  const out = new Map<string, string[]>()
  const heads = lines.filter((l) => l.heading !== undefined)
  if (!heads.length) {
    if (main.length !== 1) return null
    out.set(main[0].key, lines.map((l) => l.text))
    return out
  }
  let cur: TrackGroup | undefined
  let seq = 0
  for (const l of lines) {
    if (l.heading !== undefined) {
      seq++
      cur = main.find((g) => trackNumber(g.title) === l.heading) ?? main[seq - 1]
      continue
    }
    if (!cur) continue // text before the first heading: title page, cast list …
    out.set(cur.key, [...(out.get(cur.key) ?? []), l.text])
  }
  return out.size ? out : null
}
