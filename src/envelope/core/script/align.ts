// 위치 맞추기.
// · Japanese script ↔ Japanese speech: both normalized (katakana → hiragana,
//   no long-vowel marks / punctuation / spaces, NFKC), aligned character by
//   character (edit-distance DP inside a band around the diagonal). A line
//   takes the times of its matched characters; unmatched lines are spread
//   between their neighbours by length. Confidence = share of matched chars.
// · Korean script ↔ Japanese speech: characters can't match, so the heard
//   pieces are machine-translated and matched by content (alignByContent,
//   below); by length alone (Gale–Church: 1–1, 1–2, 2–1, skips) when
//   nothing may be translated.
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

// ---- Korean script ↔ Japanese speech by content ----
// Length alone drifts on long tracks (measured on 9 tracks / 1002 lines with
// the provided subtitles as truth: start within 1 s 15%, within 3 s 24%). So
// the heard speech is cut into pieces (word times, at sentence marks and
// pauses; moans left out), the pieces are machine-translated, and lines and
// pieces are paired in order by the syllable pairs they share — names, calls
// and words a translation keeps are anchors. Lines between two anchors go
// onto the pieces between them by length. Same tracks: 62% / 82%.

export const CONTENT = {
  minScore: 0.12, // a pair must share more than this (Dice of syllable pairs)
  lenWeight: 0.08, // penalty per log of length ratio
  smallGrams: 3, // fewer syllable pairs than this weigh less ("너" ↔ "너,")
  pauseS: 0.5, // a gap between words this long cuts a piece
  leadS: 0.3 // lines start this much before the speech (as subtitles do)
}

// a piece of speech that is only moans / noise: nothing to find a line by
const JA_MOAN_RUN = /[あいうえおんっぁぃぅぇぉゔはひふへほ]{2,}/g
export function moanPiece(text: string): boolean {
  if (NOISE_WORD.test(text)) return true
  return normJa(text).replace(JA_MOAN_RUN, '').length < 3
}

// whisper's segments can hold many sentences (one ran 50 s): cut them at
// sentence marks and pauses by the word times; moans left out
export function speechPieces(segs: AsrSegment[]): AsrSegment[] {
  const out: AsrSegment[] = []
  for (const s of segs) {
    const ws = s.words ?? []
    if (ws.length < 2) {
      out.push({ start: s.start, end: s.end, text: s.text })
      continue
    }
    let cur: AsrWord[] = []
    const flush = (): void => {
      if (cur.length) out.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join('') })
      cur = []
    }
    ws.forEach((w, i) => {
      cur.push(w)
      const next = ws[i + 1]
      if (!next || /[、。！？!?…]\s*$/.test(w.text) || next.start - w.end > CONTENT.pauseS) flush()
    })
    flush()
  }
  return out.filter((p) => !moanPiece(p.text))
}

const koNorm = (s: string): string => s.replace(/[^가-힣0-9a-zA-Z]/g, '')
function syllablePairs(s: string): Map<string, number> {
  const m = new Map<string, number>()
  const t = koNorm(s)
  for (let i = 0; i + 2 <= t.length; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) ?? 0) + 1)
  if (t.length === 1) m.set(t, 1)
  return m
}
function shared(a: Map<string, number>, b: Map<string, number>): number {
  let na = 0
  let nb = 0
  let both = 0
  for (const v of a.values()) na += v
  for (const v of b.values()) nb += v
  for (const [k, v] of a) both += Math.min(v, b.get(k) ?? 0)
  return na + nb ? ((2 * both) / (na + nb)) * Math.min(1, Math.min(na, nb) / CONTENT.smallGrams) : 0
}
const mergePairs = (ms: Map<string, number>[]): Map<string, number> => {
  const out = new Map<string, number>()
  for (const m of ms) for (const [k, v] of m) out.set(k, (out.get(k) ?? 0) + v)
  return out
}

// pieces: heard speech with its Korean translation ('' = not translated)
export function alignByContent(lines: string[], pieces: { start: number; end: number; ko: string }[], total: number): AlignedLine[] {
  const n = lines.length
  const m = pieces.length
  const lg = lines.map(syllablePairs)
  const pg = pieces.map((p) => syllablePairs(p.ko))
  const ll = lines.map((l) => koNorm(l).length)
  const pl = pieces.map((p) => koNorm(p.ko).length)
  const score = (i: number, a: number, j: number, b: number): number => {
    let l1 = 0
    let l2 = 0
    for (let k = 0; k < a; k++) l1 += ll[i + k]
    for (let k = 0; k < b; k++) l2 += pl[j + k]
    const s = shared(a === 1 ? lg[i] : mergePairs(lg.slice(i, i + a)), b === 1 ? pg[j] : mergePairs(pg.slice(j, j + b)))
    return s - CONTENT.minScore - CONTENT.lenWeight * Math.abs(Math.log((l1 + 2) / (l2 + 2))) - 0.02 * (a + b - 2)
  }
  // best total score in order: a line may go unheard, a piece may have no
  // line; 1 line ↔ 1–4 pieces or 2–3 lines ↔ 1 piece
  const D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(-Infinity))
  const B = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)) // lines * 8 + pieces
  D[0][0] = 0
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= m; j++) {
      const d = D[i][j]
      if (d === -Infinity) continue
      const relax = (a: number, b: number, v: number): void => {
        if (v > D[i + a][j + b]) {
          D[i + a][j + b] = v
          B[i + a][j + b] = a * 8 + b
        }
      }
      if (i < n) relax(1, 0, d)
      if (j < m) relax(0, 1, d)
      for (let a = 1; a <= 3 && i + a <= n; a++)
        for (let b = 1; b <= (a > 1 ? 1 : 4) && j + b <= m; b++) relax(a, b, d + score(i, a, j, b))
    }
  const times: (AlignedLine | null)[] = lines.map(() => null)
  const place = (i0: number, i1: number, start: number, end: number, conf: number): void => {
    const lens = ll.slice(i0, i1).map((x) => Math.max(1, x))
    const sum = lens.reduce((x, y) => x + y, 0)
    let t = start
    lens.forEach((len, k) => {
      const d = ((end - start) * len) / sum
      times[i0 + k] = { start: t, end: t + d, conf }
      t += d
    })
  }
  const anchors: [number, number, number, number][] = []
  for (let i = n, j = m; i > 0 || j > 0; ) {
    const a = B[i][j] >> 3
    const b = B[i][j] & 7
    if (!a && !b) break
    if (a && b) {
      const gain = D[i][j] - D[i - a][j - b]
      place(i - a, i, pieces[j - b].start, pieces[j - 1].end, Math.min(1, gain + CONTENT.minScore + 0.3))
      anchors.push([i - a, i, j - b, j])
    }
    i -= a
    j -= b
  }
  // between two anchors: the lines left over onto the pieces left over, by length
  anchors.reverse()
  let li = 0
  let pj = 0
  for (const [i0, i1, j0, j1] of [...anchors, [n, n, m, m]]) {
    if (i0 > li && j0 > pj) {
      const gap = pieces.slice(pj, j0).map((p) => ({ start: p.start, end: p.end, text: p.ko }))
      alignByLength(lines.slice(li, i0), gap, total).forEach((t, k) => {
        if (t.conf > 0.3) times[li + k] = { ...t, conf: Math.min(t.conf, 0.4) }
      })
    }
    li = i1
    pj = j1
  }
  for (const t of times) if (t) t.start = Math.max(0, t.start - CONTENT.leadS)
  return fill(lines, times, total)
}
