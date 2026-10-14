// 위치 맞추기.
// · Japanese script ↔ Japanese speech: both normalized (katakana → hiragana,
//   no long-vowel marks / punctuation / spaces, NFKC), aligned character by
//   character (edit-distance DP inside a band around the diagonal). A line
//   takes the times of its matched characters; unmatched lines are spread
//   between their neighbours by length. Confidence = share of matched chars.
// · Korean script ↔ Japanese speech: characters can't match, so lines are
//   matched to the engine's segments by length (Gale–Church): 1–1, 1–2, 2–1,
//   and skips.
import type { Cue } from '../../shared/types'
import type { AsrSegment, AsrWord } from '../asr/clean'

// a substitution costs as much as a skip on both sides
const SUB = 2

export const ALIGN = {
  band: 400, // DP band half-width (chars) beyond the length difference
  maxCells: 80_000_000, // larger problems are cut in two by time
  lowConf: 0.5, // a line with fewer matched chars is "low"
  retryRatio: 0.3, // more low lines than this → try the next model
  minLen: 0.4 // s
}

export function normJa(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[ーｰ〜~～]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase()
}

export interface TimedChar {
  c: string
  t0: number
  t1: number
  track?: number // index in a joined list of tracks
}

// Engine noise that never matches a script: "(笑)", "♪", and endless runs of
// one character ("ううううう…", whisper's way of filling moans).
const NOISE_WORD = /^\s*[(（\[［].*[)）\]］]\s*$/
const MAX_RUN = 4

export function timedChars(words: AsrWord[]): TimedChar[] {
  const out: TimedChar[] = []
  for (const w of words) {
    if (NOISE_WORD.test(w.text)) continue
    const cs = [...normJa(w.text)].filter((c, i, all) => {
      let run = 0
      for (let k = i; k >= 0 && all[k] === c; k--) run++
      return run <= MAX_RUN
    })
    if (!cs.length) continue
    const step = Math.max(0, w.end - w.start) / cs.length
    cs.forEach((c, i) => out.push({ c, t0: w.start + i * step, t1: w.start + (i + 1) * step }))
  }
  return out.filter((c, i) => i < MAX_RUN || !out.slice(i - MAX_RUN, i).every((p) => p.c === c.c))
}

// Edit-distance alignment of a (script) against b (speech) in a band; returns
// for each char of a the index in b it matched exactly, or -1.
function bandAlign(a: string[], b: string[]): Int32Array {
  const n = a.length
  const m = b.length
  const match = new Int32Array(n).fill(-1)
  if (!n || !m) return match
  const W = ALIGN.band + Math.abs(n - m)
  const width = 2 * W + 1
  const center = (i: number): number => Math.round((i * m) / n)
  const INF = 1 << 29
  const trace = new Uint8Array((n + 1) * width) // 0 diag, 1 up (gap in b), 2 left (gap in a)
  let prev = new Int32Array(width).fill(INF)
  let cur = new Int32Array(width).fill(INF)
  // row 0
  for (let k = 0; k < width; k++) {
    const j = center(0) - W + k
    if (j >= 0 && j <= m) {
      prev[k] = j
      trace[k] = 2
    }
  }
  for (let i = 1; i <= n; i++) {
    cur.fill(INF)
    const c0 = center(i) - W
    const p0 = center(i - 1) - W
    for (let k = 0; k < width; k++) {
      const j = c0 + k
      if (j < 0 || j > m) continue
      let best = INF
      let dir = 1
      // up: (i-1, j)
      const ku = j - p0
      if (ku >= 0 && ku < width && prev[ku] < INF) {
        best = prev[ku] + 1
        dir = 1
      }
      // diag: (i-1, j-1)
      const kd = j - 1 - p0
      if (j > 0 && kd >= 0 && kd < width && prev[kd] < INF) {
        const cost = prev[kd] + (a[i - 1] === b[j - 1] ? 0 : SUB)
        if (cost < best) {
          best = cost
          dir = 0
        }
      }
      // left: (i, j-1)
      if (k > 0 && cur[k - 1] < INF && cur[k - 1] + 1 < best) {
        best = cur[k - 1] + 1
        dir = 2
      }
      cur[k] = best
      trace[i * width + k] = dir
    }
    ;[prev, cur] = [cur, prev]
  }
  // trace back from (n, m)
  let i = n
  let j = m
  while (i > 0 && j >= 0) {
    const k = j - (center(i) - W)
    if (k < 0 || k >= width) break
    const dir = trace[i * width + k]
    if (dir === 0) {
      if (a[i - 1] === b[j - 1]) match[i - 1] = j - 1
      i--
      j--
    } else if (dir === 1) i--
    else j--
  }
  return match
}

export interface AlignedLine {
  start: number
  end: number
  conf: number // 0–1
}

// Spread lines without a time between their neighbours, by length; keep order.
function fill(lines: string[], times: (AlignedLine | null)[], total: number): AlignedLine[] {
  const out: AlignedLine[] = []
  let i = 0
  while (i < lines.length) {
    if (times[i]) {
      out.push(times[i]!)
      i++
      continue
    }
    let j = i
    while (j < lines.length && !times[j]) j++
    const from = out.length ? out[out.length - 1].end : 0
    const to = j < lines.length ? times[j]!.start : Math.max(from + 1, total)
    const lens = lines.slice(i, j).map((l) => Math.max(1, l.length))
    const sum = lens.reduce((a, b) => a + b, 0)
    let t = from
    for (const len of lens) {
      const d = ((to - from) * len) / sum
      out.push({ start: t, end: t + d, conf: 0 })
      t += d
    }
    i = j
  }
  // monotonic, minimum length, no overlap
  for (let k = 0; k < out.length; k++) {
    if (k && out[k].start < out[k - 1].start) out[k].start = out[k - 1].start
    if (out[k].end < out[k].start + ALIGN.minLen) out[k].end = out[k].start + ALIGN.minLen
    if (k && out[k - 1].end > out[k].start) out[k - 1].end = Math.max(out[k - 1].start + 0.1, out[k].start)
  }
  return out
}

export const segWords = (segs: AsrSegment[]): AsrWord[] => segs.flatMap((s) => (s.words?.length ? s.words : [{ start: s.start, end: s.end, text: s.text }]))

// Runs of vowels / ん / っ ("ぅっ", "おおお…") are moans the engine rarely
// writes the same way; a line's confidence counts the rest.
const MOAN_RUN = /[あいうえおんっぁぃぅぇぉゔ]{2,}/g
export const heardLength = (norm: string): number => {
  const rest = norm.replace(MOAN_RUN, '').length
  return rest >= 2 ? rest : norm.length
}

export interface LineMatch {
  first: number // index into the chars, -1 = none
  last: number
  conf: number
}

// Which speech characters each line matched.
export function matchLines(lines: string[], chars: TimedChar[]): LineMatch[] {
  const norm = lines.map(normJa)
  const a: string[] = []
  const lineOf: number[] = []
  norm.forEach((l, li) => [...l].forEach((c) => (a.push(c), lineOf.push(li))))
  const b = chars.map((c) => c.c)
  const match =
    (a.length + 1) * (b.length + 1) <= ALIGN.maxCells * 2
      ? globalAlign(a, b)
      : (a.length + 1) * (2 * (ALIGN.band + Math.abs(a.length - b.length)) + 1) > ALIGN.maxCells
        ? splitAlign(a, b)
        : bandAlign(a, b)
  const counts = lines.map(() => 0)
  const first = lines.map(() => -1)
  const last = lines.map(() => -1)
  for (let i = 0; i < a.length; i++) {
    const j = match[i]
    if (j < 0) continue
    const li = lineOf[i]
    counts[li]++
    if (first[li] < 0) first[li] = j
    last[li] = j
  }
  return lines.map((_, li) => {
    const len = heardLength(norm[li])
    const conf = len ? Math.min(1, counts[li] / len) : 0
    // a few stray matches: place the line by its neighbours instead
    return conf < 0.2 || first[li] < 0 ? { first: -1, last: -1, conf } : { first: first[li], last: last[li], conf }
  })
}

export function timesOf(matches: LineMatch[], chars: TimedChar[]): (AlignedLine | null)[] {
  return matches.map((m) => (m.first < 0 ? null : { start: chars[m.first].t0, end: chars[m.last].t1, conf: m.conf }))
}

export function alignJapanese(lines: string[], segs: AsrSegment[], total: number): AlignedLine[] {
  const chars = timedChars(segWords(segs))
  return fill(lines, timesOf(matchLines(lines, chars), chars), total)
}

// Full edit-distance alignment of a (script) and b (speech). Returns per char
// of a its match in b (or -1).
function globalAlign(a: string[], b: string[]): Int32Array {
  const n = a.length
  const m = b.length
  const match = new Int32Array(n).fill(-1)
  if (!m || !n) return match
  const W = m + 1
  const trace = new Uint8Array((n + 1) * W) // 0 diag, 1 up (skip script char), 2 left (skip speech char)
  let prev = new Int32Array(W)
  let cur = new Int32Array(W)
  for (let j = 0; j <= m; j++) {
    prev[j] = j
    trace[j] = 2
  }
  for (let i = 1; i <= n; i++) {
    cur[0] = i
    trace[i * W] = 1
    const ai = a[i - 1]
    for (let j = 1; j <= m; j++) {
      let c = prev[j - 1] + (ai === b[j - 1] ? 0 : SUB)
      let d = 0
      if (prev[j] + 1 < c) {
        c = prev[j] + 1
        d = 1
      }
      if (cur[j - 1] + 1 < c) {
        c = cur[j - 1] + 1
        d = 2
      }
      cur[j] = c
      trace[i * W + j] = d
    }
    ;[prev, cur] = [cur, prev]
  }
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const d = trace[i * W + j]
    if (d === 0) {
      if (a[i - 1] === b[j - 1]) match[i - 1] = j - 1
      i--
      j--
    } else if (d === 1) i--
    else j--
  }
  return match
}

const trigrams = (t: string): Set<string> => {
  const out = new Set<string>()
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3))
  return out
}

// Which track each line belongs to: every line is scored against every
// track's speech (its 3-grams heard there, each weighted by how few tracks
// have it — phrases every track says tell nothing), then the lines are cut
// into one run per track, in order, maximizing the total score. Robust to
// noise (moans, made-up text) that throws a character alignment off.
export function partitionLines(lines: string[], trackTexts: string[]): number[] {
  const T = trackTexts.length
  const sets = trackTexts.map((t) => trigrams(normJa(t)))
  const df = new Map<string, number>()
  for (const set of sets) for (const x of set) df.set(x, (df.get(x) ?? 0) + 1)
  const score = lines.map((l) => {
    const g = [...trigrams(normJa(l))]
    return sets.map((set) => {
      if (g.length < 2) return 0 // too short to tell (moans, "うん")
      let hit = 0
      for (const x of g) if (set.has(x)) hit += Math.log(T / df.get(x)!)
      return hit / g.length
    })
  })
  const L = lines.length
  const best = Array.from({ length: L }, () => new Float64Array(T))
  const from = Array.from({ length: L }, () => new Int32Array(T))
  for (let k = 0; k < T; k++) best[0][k] = score[0]?.[k] ?? 0
  for (let l = 1; l < L; l++) {
    let pm = -Infinity
    let pk = 0
    for (let k = 0; k < T; k++) {
      if (best[l - 1][k] > pm) {
        pm = best[l - 1][k]
        pk = k
      }
      best[l][k] = score[l][k] + pm
      from[l][k] = pk // best previous track ≤ k
    }
  }
  const owner = new Array<number>(L).fill(0)
  if (!L) return owner
  let k = 0
  for (let j = 1; j < T; j++) if (best[L - 1][j] > best[L - 1][k]) k = j
  for (let l = L - 1; l >= 0; l--) {
    owner[l] = k
    k = from[l][k]
  }
  return owner
}

// A whole script without track headings: lines to tracks (above), then each
// track's lines aligned to its own speech.
export function alignAcross(lines: string[], tracks: { segs: AsrSegment[]; total: number }[]): Map<number, { lines: string[]; al: AlignedLine[] }> {
  const owner = partitionLines(
    lines,
    tracks.map((t) => segWords(t.segs).map((w) => w.text).join(''))
  )
  const out = new Map<number, { lines: string[]; al: AlignedLine[] }>()
  tracks.forEach((t, k) => {
    const sub = lines.filter((_, i) => owner[i] === k)
    if (sub.length) out.set(k, { lines: sub, al: alignJapanese(sub, t.segs, t.total) })
  })
  return out
}

// Too big for one band: align the halves (cut both at the same share).
function splitAlign(a: string[], b: string[]): Int32Array {
  const ha = Math.floor(a.length / 2)
  const hb = Math.floor(b.length / 2)
  const left = bandAlign(a.slice(0, ha), b.slice(0, hb))
  const right = bandAlign(a.slice(ha), b.slice(hb))
  const out = new Int32Array(a.length)
  out.set(left)
  right.forEach((v, i) => (out[ha + i] = v < 0 ? -1 : v + hb))
  return out
}

export { fill }

export function alignByLength(lines: string[], segs: AsrSegment[], total: number): AlignedLine[] {
  const lk = lines.map((l) => Math.max(1, l.replace(/\s/g, '').length))
  const lj = segs.map((s) => Math.max(1, s.text.replace(/\s/g, '').length))
  const n = lk.length
  const m = lj.length
  if (!m) return fill(lines, lines.map(() => null), total)
  const r = lk.reduce((x, y) => x + y, 0) / lj.reduce((x, y) => x + y, 0)
  const cost = (ko: number, ja: number): number => Math.abs(ko - r * ja) / Math.sqrt(r * ja + 1)
  const SKIP = 3.5
  const D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity))
  const B = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1))
  D[0][0] = 0
  // moves: 1 = 1–1, 2 = 1–2, 3 = 2–1, 4 = line without segment, 5 = segment without line
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= m; j++) {
      const d = D[i][j]
      if (!isFinite(d)) continue
      const relax = (ii: number, jj: number, c: number, mv: number): void => {
        if (ii <= n && jj <= m && d + c < D[ii][jj]) {
          D[ii][jj] = d + c
          B[ii][jj] = mv
        }
      }
      if (i < n && j < m) relax(i + 1, j + 1, cost(lk[i], lj[j]), 1)
      if (i < n && j + 1 < m) relax(i + 1, j + 2, cost(lk[i], lj[j] + lj[j + 1]) + 0.5, 2)
      if (i + 1 < n && j < m) relax(i + 2, j + 1, cost(lk[i] + lk[i + 1], lj[j]) + 0.5, 3)
      if (i < n) relax(i + 1, j, SKIP, 4)
      if (j < m) relax(i, j + 1, SKIP * 0.6, 5)
    }
  const times: (AlignedLine | null)[] = lines.map(() => null)
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const mv = B[i][j]
    if (mv === 1) {
      const c = cost(lk[i - 1], lj[j - 1])
      times[i - 1] = { start: segs[j - 1].start, end: segs[j - 1].end, conf: Math.max(0, 1 - c / SKIP) }
      i--
      j--
    } else if (mv === 2) {
      times[i - 1] = { start: segs[j - 2].start, end: segs[j - 1].end, conf: Math.max(0, 1 - cost(lk[i - 1], lj[j - 2] + lj[j - 1]) / SKIP) }
      i--
      j -= 2
    } else if (mv === 3) {
      const s = segs[j - 1]
      const share = lk[i - 2] / (lk[i - 2] + lk[i - 1])
      const mid = s.start + (s.end - s.start) * share
      const conf = Math.max(0, 1 - cost(lk[i - 2] + lk[i - 1], lj[j - 1]) / SKIP) * 0.9
      times[i - 2] = { start: s.start, end: mid, conf }
      times[i - 1] = { start: mid, end: s.end, conf }
      i -= 2
      j--
    } else if (mv === 4) i--
    else if (mv === 5) j--
    else break
  }
  return fill(lines, times, total)
}

export function toAlignedCues(lines: string[], al: AlignedLine[]): Cue[] {
  return lines.map((text, i) => ({
    start: Math.round(al[i].start * 1000) / 1000,
    end: Math.round(al[i].end * 1000) / 1000,
    text,
    ...(al[i].conf < ALIGN.lowConf ? { low: true } : {})
  }))
}
