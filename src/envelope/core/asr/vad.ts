// Voice activity: where in a track someone speaks. Energy against the track's
// own noise floor (so quiet ASMR whispering still counts), smoothed. Speech is
// then packed into chunks for the engines — the silences between parts are
// shortened, which keeps engines from inventing text in long quiet stretches,
// and a time map puts the results back on the track's own clock.
import { ASR_RATE } from './audio'

export const VAD = {
  frameMs: 30,
  floorPercentile: 0.15, // the noise floor = this quantile of frame levels
  aboveFloorDb: 10, // speech: this much louder than the floor…
  minDb: -58, // …and at least this loud (dBFS)
  mergeGapS: 0.6, // join speech parts closer than this
  minSpeechS: 0.25, // drop shorter blips
  padS: 0.25 // keep a little air around each part
}

export interface Span {
  start: number // s
  end: number
}

export function detectSpeech(pcm: Int16Array, rate = ASR_RATE): Span[] {
  const frame = Math.max(1, Math.round((rate * VAD.frameMs) / 1000))
  const n = Math.floor(pcm.length / frame)
  if (!n) return []
  const db = new Float32Array(n)
  for (let f = 0; f < n; f++) {
    let s = 0
    for (let i = f * frame; i < (f + 1) * frame; i++) s += pcm[i] * pcm[i]
    const rms = Math.sqrt(s / frame) / 32768
    db[f] = rms > 0 ? 20 * Math.log10(rms) : -120
  }
  const sorted = Array.from(db).sort((a, b) => a - b)
  const floor = sorted[Math.floor(sorted.length * VAD.floorPercentile)]
  const thr = Math.max(VAD.minDb, floor + VAD.aboveFloorDb)
  const sec = frame / rate
  const spans: Span[] = []
  let start = -1
  for (let f = 0; f <= n; f++) {
    const on = f < n && db[f] >= thr
    if (on && start < 0) start = f
    if (!on && start >= 0) {
      spans.push({ start: start * sec, end: f * sec })
      start = -1
    }
  }
  // merge close parts, drop blips, pad
  const merged: Span[] = []
  for (const s of spans) {
    const last = merged[merged.length - 1]
    if (last && s.start - last.end < VAD.mergeGapS) last.end = s.end
    else merged.push({ ...s })
  }
  const total = pcm.length / rate
  return merged
    .filter((s) => s.end - s.start >= VAD.minSpeechS)
    .map((s) => ({ start: Math.max(0, s.start - VAD.padS), end: Math.min(total, s.end + VAD.padS) }))
}

export interface Piece {
  src: number // s on the track
  out: number // s in the chunk audio
  len: number // s
}

export interface Chunk {
  pieces: Piece[]
  length: number // s of chunk audio
}

// Pack speech spans into chunks of at most maxS seconds of audio, keeping
// gapS of silence between the parts. A span longer than maxS is split.
export function planChunks(spans: Span[], maxS: number, gapS = 0.4): Chunk[] {
  const chunks: Chunk[] = []
  let cur: Chunk = { pieces: [], length: 0 }
  const push = (src: number, len: number): void => {
    const need = (cur.pieces.length ? gapS : 0) + len
    if (cur.pieces.length && cur.length + need > maxS) {
      chunks.push(cur)
      cur = { pieces: [], length: 0 }
    }
    const out = cur.pieces.length ? cur.length + gapS : 0
    cur.pieces.push({ src, out, len })
    cur.length = out + len
  }
  for (const s of spans) {
    for (let t = s.start; t < s.end - 1e-6; t += maxS) push(t, Math.min(maxS, s.end - t))
  }
  if (cur.pieces.length) chunks.push(cur)
  return chunks
}

// The chunk's audio: its pieces cut from the track with silence between.
export function chunkAudio(pcm: Int16Array, chunk: Chunk, rate = ASR_RATE): Int16Array {
  const out = new Int16Array(Math.ceil(chunk.length * rate))
  for (const p of chunk.pieces) {
    const from = Math.round(p.src * rate)
    const len = Math.min(Math.round(p.len * rate), pcm.length - from)
    if (len > 0) out.set(pcm.subarray(from, from + len), Math.round(p.out * rate))
  }
  return out
}

// A time in the chunk audio → the time on the track.
export function toTrackTime(chunk: Chunk, t: number): number {
  let best = chunk.pieces[0]
  for (const p of chunk.pieces) if (p.out <= t + 1e-6) best = p
  if (!best) return t
  return best.src + Math.min(Math.max(0, t - best.out), best.len)
}
