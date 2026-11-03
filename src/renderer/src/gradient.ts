import type { GradStop, TextGradient } from '../../shared/ipc'
import { rgbToHex } from './inpaint'

// 그라데이션 인식 (the translation editor's 인페인팅 stage): the gradient a
// lettering (a sound effect, say) is filled with, read off the page so the
// Korean text can wear it.
//   1. The ground: the colours along the picked area's border.
//   2. The letters: pixels clearly off every ground colour; when most of them
//      are coloured, only the coloured ones (a white / dark outline round a
//      coloured fill is the outline, not the fill).
//   3. The direction: the angle whose bands across the letters are the most
//      even in colour (least spread within each band).
//   4. The stops: the band colours along it, kept only where a straight blend
//      between the kept ones misses them.

const BANDS = 16
const GROUND_DIST = 48 // off every ground colour by this much (RGB distance) = a letter
const COLOURED = 40 // chroma (max − min channel) of a coloured pixel
const STOP_MISS = 20 // a band this far from the blend between stops gets a stop
const MAX_STOPS = 5

type RGB = [number, number, number]
const dist = (a: RGB, b: RGB): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const chroma = (c: RGB): number => Math.max(...c) - Math.min(...c)

// `d`: the page's pixels (W wide); `inside`: the picked area's pixels (page
// indices); `border`: those on its edge. Null when there are too few letters.
export function readGradient(d: Uint8ClampedArray, W: number, inside: number[], border: number[]): TextGradient | null {
  const px = (i: number): RGB => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]
  // 1. Ground colours: the border's common colours (32 levels a channel), down
  //    to 90% of it.
  const counts = new Map<number, { n: number; sum: RGB }>()
  for (const i of border) {
    const c = px(i)
    const k = ((c[0] >> 3) << 10) | ((c[1] >> 3) << 5) | (c[2] >> 3)
    const e = counts.get(k) ?? { n: 0, sum: [0, 0, 0] as RGB }
    e.n++
    e.sum = [e.sum[0] + c[0], e.sum[1] + c[1], e.sum[2] + c[2]]
    counts.set(k, e)
  }
  const ground: RGB[] = []
  let covered = 0
  for (const e of [...counts.values()].sort((a, b) => b.n - a.n)) {
    if (covered >= border.length * 0.9) break
    ground.push([e.sum[0] / e.n, e.sum[1] / e.n, e.sum[2] / e.n])
    covered += e.n
  }
  // 2. The letters.
  let ink = inside.filter((i) => ground.every((g) => dist(px(i), g) > GROUND_DIST))
  const coloured = ink.filter((i) => chroma(px(i)) > COLOURED)
  if (coloured.length > ink.length * 0.3) ink = coloured
  if (ink.length < 30) return null

  // 3. The direction (0–175°; the other half is the same with the stops reversed).
  const xy = ink.map((i) => [i % W, Math.floor(i / W)])
  const cols = ink.map(px)
  const bandsAt = (deg: number): { mean: (RGB | null)[]; sse: number } => {
    const a = (deg * Math.PI) / 180
    const t = xy.map(([x, y]) => x * Math.cos(a) + y * Math.sin(a))
    const sorted = [...t].sort((p, q) => p - q)
    const lo = sorted[Math.floor(sorted.length * 0.02)]
    const hi = sorted[Math.floor(sorted.length * 0.98)]
    const span = Math.max(1e-6, hi - lo)
    const n = Array(BANDS).fill(0)
    const sum = Array.from({ length: BANDS }, () => [0, 0, 0])
    const sq = Array(BANDS).fill(0)
    t.forEach((v, k) => {
      const b = Math.max(0, Math.min(BANDS - 1, Math.floor(((v - lo) / span) * BANDS)))
      const c = cols[k]
      n[b]++
      for (let ch = 0; ch < 3; ch++) {
        sum[b][ch] += c[ch]
        sq[b] += c[ch] * c[ch]
      }
    })
    let sse = 0
    const mean = n.map((m, b) => {
      if (!m) return null
      const mu: RGB = [sum[b][0] / m, sum[b][1] / m, sum[b][2] / m]
      sse += sq[b] - m * (mu[0] * mu[0] + mu[1] * mu[1] + mu[2] * mu[2])
      return mu
    })
    return { mean, sse }
  }
  let best = { deg: 90, ...bandsAt(90) }
  for (let deg = 0; deg < 180; deg += 5) {
    const r = bandsAt(deg)
    if (r.sse < best.sse) best = { deg, ...r }
  }
  // Empty bands: the nearest filled one's colour.
  const filled = best.mean.map((m, b) => {
    if (m) return m
    for (let k = 1; k < BANDS; k++) {
      const c = best.mean[b - k] ?? best.mean[b + k]
      if (c) return c
    }
    return [0, 0, 0] as RGB
  })

  // 4. Stops: both ends, then the band furthest off the blend between its
  //    neighbouring stops, while that is clearly off.
  const pos = (b: number): number => b / (BANDS - 1)
  const keep = [0, BANDS - 1]
  while (keep.length < MAX_STOPS) {
    let worst = -1
    let miss = STOP_MISS
    for (let k = 0; k + 1 < keep.length; k++) {
      const a = keep[k]
      const b = keep[k + 1]
      for (let m = a + 1; m < b; m++) {
        const f = (m - a) / (b - a)
        const lerp: RGB = [0, 1, 2].map((ch) => filled[a][ch] + (filled[b][ch] - filled[a][ch]) * f) as RGB
        const e = dist(filled[m], lerp)
        if (e > miss) {
          miss = e
          worst = m
        }
      }
    }
    if (worst < 0) break
    keep.push(worst)
    keep.sort((p, q) => p - q)
  }
  const stops: GradStop[] = keep.map((b) => ({
    pos: pos(b),
    color: rgbToHex(filled[b].map((v) => Math.round(v)) as RGB),
    alpha: 1
  }))
  return { angle: best.deg, stops }
}

// The colour (hex) and alpha at `t` (0–1) along a gradient's stops.
export function gradientAt(g: TextGradient, t: number): { color: string; alpha: number } {
  const st = [...g.stops].sort((p, q) => p.pos - q.pos)
  if (!st.length) return { color: '#000000', alpha: 1 }
  if (t <= st[0].pos) return { color: st[0].color, alpha: st[0].alpha }
  for (let k = 0; k + 1 < st.length; k++) {
    const a = st[k]
    const b = st[k + 1]
    if (t > b.pos) continue
    const f = (t - a.pos) / Math.max(1e-6, b.pos - a.pos)
    const ca = hex(a.color)
    const cb = hex(b.color)
    return { color: rgbToHex(ca.map((v, ch) => Math.round(v + (cb[ch] - v) * f)) as RGB), alpha: a.alpha + (b.alpha - a.alpha) * f }
  }
  const z = st[st.length - 1]
  return { color: z.color, alpha: z.alpha }
}
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

// CSS for a gradient's preview (left → right along its stops).
export function gradientCss(g: TextGradient, angle = 90): string {
  const st = [...g.stops].sort((p, q) => p.pos - q.pos)
  const c = (s: GradStop): string => {
    const [r, gg, b] = hex(s.color)
    return `rgba(${r},${gg},${b},${s.alpha}) ${Math.round(s.pos * 100)}%`
  }
  return `linear-gradient(${angle}deg, ${st.map(c).join(', ')})`
}
