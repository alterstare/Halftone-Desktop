// Pixel tools behind the translation editor's inpaint tools (TransEditor): the
// fill's region, a selection's mask, the magnetic lasso's path along edges and
// the healing brush's blend. All on page-size RGBA arrays (canvas space).

export interface Pt {
  x: number
  y: number
}

// The pixels reachable from (x, y) through colours within `tol` (per channel, of
// the start pixel's), 4-connected, inside `within` when given.
export function floodRegion(d: Uint8ClampedArray, W: number, H: number, x: number, y: number, tol: number, within: Uint8Array | null): Uint8Array {
  const out = new Uint8Array(W * H)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H) return out
  const s = (y0 * W + x0) * 4
  const [r, g, b] = [d[s], d[s + 1], d[s + 2]]
  const near = (i: number): boolean => {
    const o = i * 4
    return Math.abs(d[o] - r) <= tol && Math.abs(d[o + 1] - g) <= tol && Math.abs(d[o + 2] - b) <= tol
  }
  const stack = [y0 * W + x0]
  if (within && !within[stack[0]]) return out
  out[stack[0]] = 1
  while (stack.length) {
    const i = stack.pop()!
    const px = i % W
    const py = (i - px) / W
    const visit = (j: number): void => {
      if (out[j] || (within && !within[j]) || !near(j)) return
      out[j] = 1
      stack.push(j)
    }
    if (px > 0) visit(i - 1)
    if (px < W - 1) visit(i + 1)
    if (py > 0) visit(i - W)
    if (py < H - 1) visit(i + W)
  }
  return out
}

// A closed polygon as a page mask.
export function polygonMask(pts: Pt[], W: number, H: number): Uint8Array {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'
  ctx.fill(polygonPath(pts))
  const d = ctx.getImageData(0, 0, W, H).data
  const m = new Uint8Array(W * H)
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] >= 128 ? 1 : 0
  return m
}

export function polygonPath(pts: Pt[]): Path2D {
  const p = new Path2D()
  pts.forEach((q, k) => (k ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)))
  p.closePath()
  return p
}

// Cost of stepping onto each pixel for the magnetic lasso: low on strong edges
// (luminance gradient), high on flat ground.
export function edgeCost(d: Uint8ClampedArray, W: number, H: number): Float32Array {
  const lum = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  const g = new Float32Array(W * H)
  let max = 1
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      const gx = lum[i + 1] - lum[i - 1]
      const gy = lum[i + W] - lum[i - W]
      g[i] = Math.hypot(gx, gy)
      if (g[i] > max) max = g[i]
    }
  for (let i = 0; i < g.length; i++) g[i] = 1 - Math.min(1, g[i] / (max * 0.5)) + 0.02
  return g
}

// The cheapest 8-connected path from `a` to `b` over `cost` (Dijkstra), searched
// within their box grown by `margin`; a straight line when that box is too big.
const WIRE_MAX = 700 * 700
export function livewire(cost: Float32Array, W: number, H: number, a: Pt, b: Pt, margin = 40): Pt[] {
  const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - margin))
  const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - margin))
  const x1 = Math.min(W - 1, Math.ceil(Math.max(a.x, b.x) + margin))
  const y1 = Math.min(H - 1, Math.ceil(Math.max(a.y, b.y) + margin))
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  if (w * h > WIRE_MAX || w < 1 || h < 1) return [b]
  const n = w * h
  // Float64: a float32 distance rounded up let a settled pixel be expanded
  // again and again from equal entries.
  const dist = new Float64Array(n).fill(Infinity)
  const done = new Uint8Array(n)
  const prev = new Int32Array(n).fill(-1)
  const at = (p: Pt): number => (Math.round(p.y) - y0) * w + (Math.round(p.x) - x0)
  const s = at(a)
  const t = at(b)
  // Binary heap of [dist, index].
  const hd: number[] = []
  const hi: number[] = []
  const push = (dv: number, i: number): void => {
    hd.push(dv)
    hi.push(i)
    let k = hd.length - 1
    while (k > 0) {
      const p = (k - 1) >> 1
      if (hd[p] <= hd[k]) break
      ;[hd[p], hd[k]] = [hd[k], hd[p]]
      ;[hi[p], hi[k]] = [hi[k], hi[p]]
      k = p
    }
  }
  const pop = (): number => {
    const top = hi[0]
    const ld = hd.pop()!
    const li = hi.pop()!
    if (hd.length) {
      hd[0] = ld
      hi[0] = li
      let k = 0
      for (;;) {
        const l = 2 * k + 1
        const r = l + 1
        let m = k
        if (l < hd.length && hd[l] < hd[m]) m = l
        if (r < hd.length && hd[r] < hd[m]) m = r
        if (m === k) break
        ;[hd[m], hd[k]] = [hd[k], hd[m]]
        ;[hi[m], hi[k]] = [hi[k], hi[m]]
        k = m
      }
    }
    return top
  }
  dist[s] = 0
  push(0, s)
  while (hd.length) {
    const dv = hd[0]
    const i = pop()
    if (done[i] || dv > dist[i]) continue
    done[i] = 1
    if (i === t) break
    const x = i % w
    const y = (i - x) / w
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const xx = x + dx
        const yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const j = yy * w + xx
        if (done[j]) continue
        const nd = dv + cost[(y0 + yy) * W + x0 + xx] * (dx && dy ? 1.414 : 1)
        if (nd < dist[j]) {
          dist[j] = nd
          prev[j] = i
          push(nd, j)
        }
      }
  }
  const path: Pt[] = []
  for (let i = t; i >= 0 && i !== s; i = prev[i]) path.push({ x: x0 + (i % w), y: y0 + Math.floor(i / w) })
  return path.reverse()
}

// Healing brush, at the stroke's end: the pixels it cloned (`mask`, page size)
// keep the source's texture but take the destination's tone — the difference
// between destination and source along the stroke's edge is spread over its
// inside (onion-peel averaging, like a membrane) and added. `base` is the page
// before the stroke, `out` the layer the clone went into (RGBA, page size);
// the source of pixel p is p + (dx, dy).
export function healStroke(base: Uint8ClampedArray, out: Uint8ClampedArray, mask: Uint8Array, W: number, H: number, dx: number, dy: number): void {
  // The stroke's box, a pixel wider.
  let x0 = W
  let y0 = H
  let x1 = -1
  let y1 = -1
  for (let i = 0; i < W * H; i++)
    if (mask[i]) {
      const x = i % W
      const y = (i - x) / W
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  if (x1 < 0) return
  x0 = Math.max(0, x0 - 1)
  y0 = Math.max(0, y0 - 1)
  x1 = Math.min(W - 1, x1 + 1)
  y1 = Math.min(H - 1, y1 + 1)
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const src = (x: number, y: number, c: number): number => {
    const sx = Math.max(0, Math.min(W - 1, x + dx))
    const sy = Math.max(0, Math.min(H - 1, y + dy))
    return base[(sy * W + sx) * 4 + c]
  }
  // Known differences: the ring just outside the stroke.
  const diff = new Float32Array(w * h * 3)
  const known = new Uint8Array(w * h)
  const hole = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const g = (y0 + y) * W + x0 + x
      if (mask[g]) hole[y * w + x] = 1
      else {
        known[y * w + x] = 1
        for (let c = 0; c < 3; c++) diff[(y * w + x) * 3 + c] = base[g * 4 + c] - src(x0 + x, y0 + y, c)
      }
    }
  // Peel inward: each pass fills the hole pixels touching known ones.
  let front: number[] = []
  const edge = (i: number): boolean => {
    const x = i % w
    const y = (i - x) / w
    for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++)
      for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) if (known[yy * w + xx]) return true
    return false
  }
  for (let i = 0; i < w * h; i++) if (hole[i] && edge(i)) front.push(i)
  const queued = new Uint8Array(w * h)
  for (const i of front) queued[i] = 1
  while (front.length) {
    const vals = front.map((i) => {
      const x = i % w
      const y = (i - x) / w
      const v = [0, 0, 0]
      let k = 0
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++)
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
          const j = yy * w + xx
          if (!known[j]) continue
          for (let c = 0; c < 3; c++) v[c] += diff[j * 3 + c]
          k++
        }
      return v.map((s) => s / Math.max(1, k))
    })
    front.forEach((i, k) => {
      for (let c = 0; c < 3; c++) diff[i * 3 + c] = vals[k][c]
      known[i] = 1
    })
    const next: number[] = []
    for (const i of front) {
      const x = i % w
      const y = (i - x) / w
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++)
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
          const j = yy * w + xx
          if (hole[j] && !known[j] && !queued[j]) {
            queued[j] = 1
            next.push(j)
          }
        }
    }
    front = next
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!hole[y * w + x]) continue
      const g = (y0 + y) * W + x0 + x
      for (let c = 0; c < 3; c++) out[g * 4 + c] = Math.max(0, Math.min(255, Math.round(src(x0 + x, y0 + y, c) + diff[(y * w + x) * 3 + c])))
      out[g * 4 + 3] = 255
    }
}
