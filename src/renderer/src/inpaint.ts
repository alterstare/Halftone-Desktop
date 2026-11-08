import type { TransResult, TransBlock, TextGradient, TextMask, TextStyle, TransRegion, TransDoc } from '../../shared/ipc'

// In-place ("circle to search" style) rendering: erase the original text inside
// each speech bubble and typeset the Korean translation in the same spot. All
// done locally on a canvas — no extra API cost beyond the Papago OCR we already
// pay for. Block coords are in the sent (≤1920px) image pixel space, which is
// also the canvas space we draw into.

const FONT = '"Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif'

// MUST match translate.ts: the image is downscaled to this before being sent to
// Papago, so block coords live in that pixel space. The canvas must be sized to
// it (NOT to res.w/h, which is only the text-extent from Papago's doc corners
// and can be narrower than the real page → right-side text drifts right).
const MAX_SIDE = 1920

// Outline each Papago block + its index (diagnostics). Leave false normally.
const DEBUG_BOXES = false

// The font a layout measures and draws with: the auto look, or a block's style
// (editor). Set per job while layoutAll lays it out (`face`), kept on its layouts.
interface Face {
  family: string
  weight: number
  italic: boolean
}
const DEFAULT_FACE: Face = { family: FONT, weight: 600, italic: false }
let face = DEFAULT_FACE
const fontAt = (fs: number, f: Face = face): string => `${f.italic ? 'italic ' : ''}${f.weight} ${fs}px ${f.family}`
function faceOf(s?: TextStyle): Face {
  if (!s || (s.font === undefined && s.bold === undefined && !s.italic)) return DEFAULT_FACE
  return { family: s.font ? `"${s.font}", ${FONT}` : FONT, weight: s.bold === true ? 800 : s.bold === false ? 400 : 600, italic: !!s.italic }
}

type RGB = [number, number, number]

// Load an image CORS-clean so the canvas stays readable (getImageData) for
// background-colour sampling. mangaimg:// sends Access-Control-Allow-Origin: *.
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('이미지 로드 실패'))
    img.src = src
  })
}

function luminance([r, g, b]: RGB): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

export function rgbToHex([r, g, b]: RGB): string {
  const h = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) return [255, 255, 255]
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

// Downscaled canvas size for an image (matches translate.ts's send size), so the
// editor can position overlay boxes in the same pixel space the block coords use.
export function canvasSize(img: HTMLImageElement): { W: number; H: number; scale: number } {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
  return { W: Math.round(img.naturalWidth * scale), H: Math.round(img.naturalHeight * scale), scale }
}

// Auto bubble-fill colour for a block, as hex — the editor's default swatch when
// the user hasn't picked one. Samples from a clean copy of the image.
export function autoBgHex(img: HTMLImageElement, b: TransBlock): string {
  const { W, H } = canvasSize(img)
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return '#ffffff'
  ctx.drawImage(img, 0, 0, W, H)
  return rgbToHex(sampleBg(ctx, b, W, H))
}

// Background colour of the block = the bubble's fill (or the art under the text):
// the colour that is both inside the box and in the ring around it. The text's
// colours are only inside (bold or glowing text can be most of the box), a
// neighbouring bubble's border or the art beyond only in the ring; the
// background is in both. Colours in 16-level buckets; the one with the largest
// lesser share of the two wins (the inside's commonest if none is in both).
function sampleBg(ctx: CanvasRenderingContext2D, b: TransBlock, W: number, H: number): RGB {
  const ring = Math.max(3, Math.round(Math.min(b.w, b.h) * 0.15))
  const x0 = Math.max(0, Math.floor(b.x - 2 * ring))
  const y0 = Math.max(0, Math.floor(b.y - 2 * ring))
  const w = Math.min(W, Math.ceil(b.x + b.w + 2 * ring)) - x0
  const h = Math.min(H, Math.ceil(b.y + b.h + 2 * ring)) - y0
  if (w <= 0 || h <= 0) return [255, 255, 255]
  const d = ctx.getImageData(x0, y0, w, h).data
  type Bucket = { inn: number; out: number; r: number; g: number; b: number }
  const buckets = new Map<number, Bucket>()
  let nIn = 0
  let nOut = 0
  for (let y = 0; y < h; y += 2)
    for (let x = 0; x < w; x += 2) {
      const X = x0 + x
      const Y = y0 + y
      const inside = X >= b.x && X < b.x + b.w && Y >= b.y && Y < b.y + b.h
      const o = (y * w + x) * 4
      const key = ((d[o] >> 4) << 8) | ((d[o + 1] >> 4) << 4) | (d[o + 2] >> 4)
      let e = buckets.get(key)
      if (!e) buckets.set(key, (e = { inn: 0, out: 0, r: 0, g: 0, b: 0 }))
      if (inside) {
        e.inn++
        nIn++
      } else {
        e.out++
        nOut++
      }
      e.r += d[o]
      e.g += d[o + 1]
      e.b += d[o + 2]
    }
  const both = (e: Bucket): number => Math.min(e.inn / Math.max(1, nIn), e.out / Math.max(1, nOut))
  let best: Bucket | null = null
  for (const e of buckets.values()) if (!best || both(e) > both(best)) best = e
  if (!best || both(best) < 0.02) for (const e of buckets.values()) if (!best || e.inn > best.inn) best = e
  if (!best) return [255, 255, 255]
  const n = best.inn + best.out
  return [Math.round(best.r / n), Math.round(best.g / n), Math.round(best.b / n)]
}
// Erase / bubble tuning. A pixel counts as bubble fill when every channel is within
// BG_TOL of the bubble's fill colour.
const BG_TOL = 48
// Glyph anti-aliasing that still passes as fill: grow the glyph mask this many px.
const GROW = 2
// Outline gaps up to about 2 × GAP px wide count as closed. A fill that still runs
// out into the page (over MAX_BUBBLE of it) is tried again with wider gaps, up to
// MAX_GAP; past that it isn't a bubble.
const GAP = 2
const MAX_GAP = 4
const MAX_BUBBLE = 0.15
// Text over art: a colour (8 levels per channel) belongs to the text when its share
// inside the box is TEXT_RATIO× its share in the ring around the box.
const TEXT_RATIO = 2.5
// Glyphs within this many px of a text group join it (a column's characters).
const JOIN = 4

// A rectangle of the page; the masks laid over it are row-major w × h.
export interface Rect {
  x0: number
  y0: number
  w: number
  h: number
}

// The text's colours: those common among its glyph pixels (`idx`, at least
// TEXT_SHARE of them) and clearly off the background — a glyph's fill, its
// outline, its glow.
const TEXT_SHARE = 0.05
function textColours(d: Uint8ClampedArray, idx: number[], bg: RGB): RGB[] {
  if (idx.length < 20) return []
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (const i of idx) {
    const o = i * 4
    const key = ((d[o] >> 4) << 8) | ((d[o + 1] >> 4) << 4) | (d[o + 2] >> 4)
    const e = buckets.get(key)
    if (e) {
      e.n++
      e.r += d[o]
      e.g += d[o + 1]
      e.b += d[o + 2]
    } else buckets.set(key, { n: 1, r: d[o], g: d[o + 1], b: d[o + 2] })
  }
  const out: RGB[] = []
  for (const e of buckets.values()) {
    if (e.n < idx.length * TEXT_SHARE) continue
    const c: RGB = [e.r / e.n, e.g / e.n, e.b / e.n]
    if (Math.max(...c.map((v, k) => Math.abs(v - bg[k]))) > 20) out.push(c)
  }
  return out
}

// A pixel in the text's colour (tighter than the fill test: glyph edges blend).
const TEXT_TOL = 60
const nearText = (d: Uint8ClampedArray, o: number, c: RGB): boolean =>
  Math.abs(d[o] - c[0]) <= TEXT_TOL && Math.abs(d[o + 1] - c[1]) <= TEXT_TOL && Math.abs(d[o + 2] - c[2]) <= TEXT_TOL

// A pixel nearer one of the text's colours than the background's: a glyph's or
// its blended edge's (the erase takes it; the rebuild never draws from it).
function textSide(d: Uint8ClampedArray, o: number, inks: RGB[], bg: RGB): boolean {
  const dist = (c: RGB): number => Math.abs(d[o] - c[0]) + Math.abs(d[o + 1] - c[1]) + Math.abs(d[o + 2] - c[2])
  const off = dist(bg)
  return inks.some((c) => dist(c) < off)
}
const nearFill = (d: Uint8ClampedArray, o: number, c: RGB): boolean =>
  Math.abs(d[o] - c[0]) <= BG_TOL && Math.abs(d[o + 1] - c[1]) <= BG_TOL && Math.abs(d[o + 2] - c[2]) <= BG_TOL

// Is page pixel (x, y) text in the detector's mask?
function maskAt(tm: TextMask, x: number, y: number): boolean {
  const mx = Math.floor((x + 0.5) * tm.scale)
  const my = Math.floor((y + 0.5) * tm.scale)
  if (mx < 0 || my < 0 || mx >= tm.w || my >= tm.h) return false
  const j = my * tm.w + mx
  return (tm.bits[j >> 3] & (1 << (j & 7))) !== 0
}

// Mark (in `mask`) the pixels of `r` that `where` marks and the text mask covers.
// Returns how many.
function markMasked(tm: TextMask, r: Rect, where: Uint8Array, mask: Uint8Array): number {
  let hits = 0
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const i = y * r.w + x
      if (where[i] && maskAt(tm, r.x0 + x, r.y0 + y)) {
        mask[i] = 1
        hits++
      }
    }
  return hits
}

// Average of the most common colour (16 levels per channel) among page pixels `idx`.
function dominant(d: Uint8ClampedArray, idx: Iterable<number>): RGB {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (const i of idx) {
    const o = i * 4
    const key = ((d[o] >> 4) << 8) | ((d[o + 1] >> 4) << 4) | (d[o + 2] >> 4)
    const e = buckets.get(key)
    if (e) {
      e.n++
      e.r += d[o]
      e.g += d[o + 1]
      e.b += d[o + 2]
    } else buckets.set(key, { n: 1, r: d[o], g: d[o + 1], b: d[o + 2] })
  }
  let best: { n: number; r: number; g: number; b: number } | null = null
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e
  return best ? [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] : [255, 255, 255]
}

// ── Bubbles, found once per page ─────────────────────────────────────────────
// A bubble is the area of one flat fill colour, closed by its outline, around
// some text — found from the text, never from the OCR boxes, so the same balloon
// comes out the same whatever text it holds and however the OCR boxed it. The
// blocks are then only assigned to the bubbles (and their lobes) they sit in.

// A speech bubble: its fill colour, where it is (`inside`, over the bubble's own
// rect: the fill, the glyphs it encloses and any see-through part), the glyphs
// its fill encloses (`holes`) and its lobes (tails and inkless bumps dropped).
interface Bubble extends Rect {
  kind: BubbleKind
  fill: RGB
  inside: Uint8Array
  holes: Uint8Array
  lobes: Shape[]
  rays?: Rays // plain: the outline its rays traced
  probe?: number[] // the text it was found from
  open?: boolean // see-through: its extension ran out into the art (or found none)
  note?: string // diagnostics (scripts/inpaint-debug)
  em?: number // its text's size (thin runs out of it are cut at a share of it)
}

// One group of text (a column, a line, a paragraph) a bubble is filled from: the
// colour around it, the pixels of that colour next to it (the fill's seeds) and
// the page pixels a bubble must hold to be its bubble (its glyphs, or a grid over
// the box when there is no text mask).
interface Seed {
  fill: RGB
  px: number[]
  probe: number[]
}

// A block's text pixels (page indices): the text mask inside its box.
function blockInk(tm: TextMask | undefined, b: TransBlock, W: number, H: number): number[] {
  const out: number[] = []
  if (!tm) return out
  const x1 = Math.min(W, Math.ceil(b.x + b.w))
  const y1 = Math.min(H, Math.ceil(b.y + b.h))
  for (let y = Math.max(0, Math.floor(b.y)); y < y1; y++)
    for (let x = Math.max(0, Math.floor(b.x)); x < x1; x++) if (maskAt(tm, x, y)) out.push(y * W + x)
  return out
}

// A 10 × 10 grid of page pixels over a block's box.
function boxGrid(b: TransBlock, W: number, H: number): number[] {
  const out: number[] = []
  for (let j = 0; j < 10; j++)
    for (let i = 0; i < 10; i++) {
      const x = Math.max(0, Math.min(W - 1, Math.round(b.x + (b.w * (i + 0.5)) / 10)))
      const y = Math.max(0, Math.min(H - 1, Math.round(b.y + (b.h * (j + 0.5)) / 10)))
      out.push(y * W + x)
    }
  return out
}

// A block's text in groups, each with the colour right around it — a block whose
// box spans joined balloons of different colours gets one seed per balloon.
// Without text pixels the box is the one group and its dominant colour the fill.
function seedsOf(d: Uint8ClampedArray, W: number, H: number, b: TransBlock, ink: number[]): Seed[] {
  const bx0 = Math.max(0, Math.floor(b.x))
  const by0 = Math.max(0, Math.floor(b.y))
  const bx1 = Math.min(W, Math.ceil(b.x + b.w))
  const by1 = Math.min(H, Math.ceil(b.y + b.h))
  if (ink.length < 20) {
    const box: number[] = []
    for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) box.push(y * W + x)
    const fill = dominant(d, box)
    return [{ fill, px: box.filter((i) => nearFill(d, i * 4, fill)), probe: boxGrid(b, W, H) }]
  }
  const m = 2 * JOIN
  const r: Rect = { x0: Math.max(0, bx0 - m), y0: Math.max(0, by0 - m), w: 0, h: 0 }
  r.w = Math.min(W, bx1 + m) - r.x0
  r.h = Math.min(H, by1 + m) - r.y0
  const n = r.w * r.h
  const local = (i: number): number => (Math.floor(i / W) - r.y0) * r.w + (i % W) - r.x0
  const text = new Uint8Array(n)
  for (const i of ink) text[local(i)] = 1
  const joined = text.slice()
  grow(joined, r.w, r.h, JOIN, null)
  // Groups = 8-connected parts of the joined text.
  const label = new Int32Array(n).fill(-1)
  let groups = 0
  for (let s = 0; s < n; s++) {
    if (!joined[s] || label[s] >= 0) continue
    const stack = [s]
    label[s] = groups
    while (stack.length) {
      const i = stack.pop()!
      const x = i % r.w
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const j = i + dy * r.w + dx
          if (xx < 0 || xx >= r.w || j < 0 || j >= n || !joined[j] || label[j] >= 0) continue
          label[j] = groups
          stack.push(j)
        }
    }
    groups++
  }
  const page = (i: number): number => (r.y0 + Math.floor(i / r.w)) * W + r.x0 + (i % r.w)
  const seeds: Seed[] = []
  for (let g = 0; g < groups; g++) {
    const own = new Uint8Array(n)
    const probe: number[] = []
    for (let i = 0; i < n; i++)
      if (label[i] === g) {
        own[i] = 1
        if (text[i]) probe.push(page(i))
      }
    if (probe.length < 15) continue
    // The ring: up to JOIN px past the group, off any text.
    const ring = own.slice()
    grow(ring, r.w, r.h, JOIN, null)
    const px: number[] = []
    for (let i = 0; i < n; i++) if (ring[i] && !joined[i]) px.push(page(i))
    if (!px.length) continue
    const fill = dominant(d, px)
    seeds.push({ fill, px: px.filter((i) => nearFill(d, i * 4, fill)), probe })
  }
  return seeds
}

// A flood over the page: the pixels it reached (`m`, over its rect `r`).
interface Flood {
  r: Rect
  m: Uint8Array
  area: number
}

// Flood the page from the seeds through the pixels `ok` marks, shrunk by `gap` px
// (so a gap in the wall up to about 2 × gap wide stays closed), then grown back by
// the gap. The shrinking is separable and lazy: a pixel is core when the
// (2 gap + 1)² square around it is all ok. Widens the gap (up to MAX_GAP) while the
// flood grows past `max` pixels; null when it still does, or no seed is core.
function flood(W: number, H: number, ok: (i: number) => boolean, seeds: number[], max: number): Flood | null {
  const n = W * H
  for (let gap = GAP; gap <= MAX_GAP; gap++) {
    const row = new Uint8Array(n) // 0 unknown, 1 its row span is all ok, 2 not
    const core = new Uint8Array(n)
    const rowOk = (i: number): boolean => {
      if (row[i]) return row[i] === 1
      const x = i % W
      let good = true
      for (let xx = Math.max(0, x - gap); xx <= Math.min(W - 1, x + gap) && good; xx++) good = ok(i - x + xx)
      row[i] = good ? 1 : 2
      return good
    }
    const isCore = (i: number): boolean => {
      if (core[i]) return core[i] === 1
      const y = Math.floor(i / W)
      let good = true
      for (let yy = Math.max(0, y - gap); yy <= Math.min(H - 1, y + gap) && good; yy++) good = rowOk(i + (yy - y) * W)
      core[i] = good ? 1 : 2
      return good
    }
    const seen = new Uint8Array(n)
    const stack: number[] = []
    for (const i of seeds)
      if (!seen[i] && isCore(i)) {
        seen[i] = 1
        stack.push(i)
      }
    if (!stack.length) return null
    let count = stack.length
    let x0 = W
    let y0 = H
    let x1 = 0
    let y1 = 0
    while (stack.length && count <= max) {
      const i = stack.pop()!
      const x = i % W
      const y = (i - x) / W
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j < 0 || j >= n || seen[j] || !isCore(j)) continue
        seen[j] = 1
        stack.push(j)
        count++
      }
    }
    if (count > max) continue
    const p = gap + 1
    const r: Rect = { x0: Math.max(0, x0 - p), y0: Math.max(0, y0 - p), w: 0, h: 0 }
    r.w = Math.min(W, x1 + p + 1) - r.x0
    r.h = Math.min(H, y1 + p + 1) - r.y0
    const m = new Uint8Array(r.w * r.h)
    const okL = new Uint8Array(r.w * r.h)
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w; x++) {
        const i = (r.y0 + y) * W + r.x0 + x
        m[y * r.w + x] = seen[i]
        okL[y * r.w + x] = ok(i) ? 1 : 0
      }
    grow(m, r.w, r.h, gap, okL)
    return { r, m, area: m.reduce((a, v) => a + v, 0) }
  }
  return null
}

// A mask plus everything it encloses (the glyphs in a bubble's fill).
function withHoles(m: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h
  const outside = new Uint8Array(n)
  const stack: number[] = []
  const seed = (i: number): void => {
    if (outside[i] || m[i]) return
    outside[i] = 1
    stack.push(i)
  }
  for (let x = 0; x < w; x++) {
    seed(x)
    seed((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    seed(y * w)
    seed(y * w + w - 1)
  }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < n) seed(j)
  }
  for (let i = 0; i < n; i++) outside[i] ^= 1
  return outside
}

// A rect mask moved onto a rect that holds it.
function remap(m: Uint8Array, from: Rect, to: Rect): Uint8Array {
  const out = new Uint8Array(to.w * to.h)
  for (let y = 0; y < from.h; y++)
    for (let x = 0; x < from.w; x++) if (m[y * from.w + x]) out[(from.y0 - to.y0 + y) * to.w + from.x0 - to.x0 + x] = 1
  return out
}

const union = (a: Rect, b: Rect): Rect => {
  const x0 = Math.min(a.x0, b.x0)
  const y0 = Math.min(a.y0, b.y0)
  return { x0, y0, w: Math.max(a.x0 + a.w, b.x0 + b.w) - x0, h: Math.max(a.y0 + a.h, b.y0 + b.h) - y0 }
}

// See-through balloons show the art behind part of their fill. The bubble then
// reaches on past the fill colour up to its outline: everything bright enough
// the fill connects to, within the block's box grown by EXT_REACH of its size on
// each side (and the fill) — a balloon hugs its text. Reaching that limit
// anywhere but at the page's edge means it ran out (no outline, or a gap in it)
// into the art: no extension then.
// "Bright enough": a white balloon at opacity α lifts whatever is behind it to
// at least α × 255, so with α measured (below) that floor (less ALPHA_TOL) —
// dark art behind the balloon then no longer stops the flood short of the
// outline. Without α, or when that floor leaks, lum > DARK.
const DARK = 150
const EXT_REACH = 0.6
const ALPHA_TOL = 10
const SEE_THROUGH_GROWTH = 1.1
const OUTLINED_RAYS = 2
const RIM = 6
const CARVE_SAMPLES = 300

// The plain-fill part of a bubble: the fill colour flooded from the seeds, the
// text next to it (in a gradient balloon the fill colour covers only part of
// it, and its glyph columns would otherwise wall it off into strips) and what
// they enclose. Only the text by its block's box (`box`, an em round it): the
// mask can take a balloon's outline or the focus lines round it for text too,
// and with them the fill would take in the outline and past it.
interface FillPart {
  fill: RGB
  fl: Flood
  inside: Uint8Array // over fl.r
}
function fillPart(
  d: Uint8ClampedArray,
  W: number,
  H: number,
  fill: RGB,
  seeds: number[],
  tm: TextMask | undefined,
  box: TransBlock
): FillPart | null {
  const fl = flood(W, H, (i) => nearFill(d, i * 4, fill), seeds, W * H * MAX_BUBBLE)
  if (!fl) return null
  const r = fl.r
  const solid = fl.m.slice()
  if (tm) {
    const text = new Uint8Array(r.w * r.h)
    const near = fl.m.slice()
    grow(near, r.w, r.h, JOIN, null)
    const em = box.size ?? Math.min(box.w, box.h)
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w; x++) {
        const X = r.x0 + x
        const Y = r.y0 + y
        if (X < box.x - em || Y < box.y - em || X > box.x + box.w + em || Y > box.y + box.h + em) near[y * r.w + x] = 0
      }
    markMasked(tm, r, near, text)
    grow(text, r.w, r.h, JOIN, null)
    for (let i = 0; i < solid.length; i++) solid[i] |= text[i]
  }
  return { fill, fl, inside: withHoles(solid, r.w, r.h) }
}

// ── What kind of balloon ─────────────────────────────────────────────────────
// Each kind is found its own way:
//   see-through  a translucent balloon showing the art behind part of it: the fill
//                and the rest up to its outline (above its opacity's floor). Told
//                by an opacity measured on its fill, the work's opacity on a light
//                not-white fill, or an outlined find whose outline holds more than
//                its fill.
//   outlined     an opaque fill closed by a dark outline: the fill colour, flooded
//                up to the outline.
//   plain        an opaque fill with no outline, straight onto a background of
//                another (often close) colour: the fill colour within the outline
//                its rays traced. Joined plain balloons (no outline between) each
//                trace their own and split what they share (`carve`).
// Outlined vs plain is told by rays (below).
type BubbleKind = 'outlined' | 'plain' | 'see-through'

// Told from RAYS rays out of a text group's box: past the box, each runs on
// over the fill (and glyphs) to where it first leaves the fill colour. A dark run
// within LOOK px there is an outline; else a step onto the background. More
// steps than outlines → plain.
const RAYS = 48
const LEAVE = 14 // a pixel off the fill (channel distance) at a step
// … or this far off it however gently it got there: half the contrast past
// the fill's edge, within these.
const DRIFT_MIN = 10
const DRIFT_MAX = 40
const LOOK = 10
const OUTLINE_DROP = 70 // an outline: this much darker than the fill
const PLAIN_SHARE = 0.3 // of the rays that ended, steps needed for plain
const PLAIN_CHROMA = 12 // a plain balloon's fill: about grey (paper or black)
const PLAIN_LIGHT = 200 // … and paper white or ink black, not a grey wall
const PLAIN_DARK = 60
const PLAIN_HOLDS = 0.8 // of its text's box a plain balloon holds
// The share of box `b` inside rect `r`.
function boxInside(b: TransBlock, r: Rect): number {
  const w = Math.min(b.x + b.w, r.x0 + r.w) - Math.max(b.x, r.x0)
  const h = Math.min(b.y + b.h, r.y0 + r.h) - Math.max(b.y, r.y0)
  return w > 0 && h > 0 ? (w * h) / Math.max(1, b.w * b.h) : 0
}
const chroma = (c: RGB): number => Math.max(...c) - Math.min(...c)

interface Rays {
  kind: 'outlined' | 'plain'
  cx: number
  cy: number
  radius: number[] // per ray (angle 2πk / RAYS): where it left the fill
  fill: RGB
  drift: number // how far off `fill` the fill itself ranges
  outlines: number // rays that ended on an outline
  steps: number // rays that ended on another colour, no outline
  note: string
}

const chDist = (d: Uint8ClampedArray, o: number, c: RGB): number =>
  Math.max(Math.abs(d[o] - c[0]), Math.abs(d[o + 1] - c[1]), Math.abs(d[o + 2] - c[2]))

function castRays(d: Uint8ClampedArray, W: number, H: number, b: TransBlock, seedFill: RGB, tm: TextMask | undefined): Rays {
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  const offGlyph = (x: number, y: number): boolean =>
    !tm ||
    ![
      [0, 0],
      [-3, 0],
      [3, 0],
      [0, -3],
      [0, 3]
    ].some(([ox, oy]) => maskAt(tm, x + ox, y + oy))
  // The fill: the most common colour in a ring 3–8 px around the box (the
  // colour right around the glyphs is often their own outline or halo).
  const clear: number[] = []
  for (let y = Math.max(0, Math.floor(b.y) - 8); y < Math.min(H, b.y + b.h + 8); y++)
    for (let x = Math.max(0, Math.floor(b.x) - 8); x < Math.min(W, b.x + b.w + 8); x++)
      if (Math.max(b.x - x, x - b.x - b.w, b.y - y, y - b.y - b.h) >= 3) clear.push(y * W + x)
  const fill = clear.length >= 30 ? dominant(d, clear) : seedFill
  const lumF = luminance(fill)
  const reach = Math.max(b.w, b.h) * 1.5 + 40
  const glyph = Math.max(6, Math.round((b.size ?? 16) * 0.6))
  // Each ray, given how far off the fill it may drift: where it leaves the fill,
  // whether onto an outline, and how far off the fill what it met is.
  const trace = (drift: number) => {
    const radius: (number | null)[] = []
    const contrast: number[] = []
    let outlines = 0
    let steps = 0
    for (let k = 0; k < RAYS; k++) {
      const a = (2 * Math.PI * k) / RAYS
      const dx = Math.cos(a)
      const dy = Math.sin(a)
      const at = (t: number): number => {
        const x = Math.round(cx + dx * t)
        const y = Math.round(cy + dy * t)
        return x < 0 || y < 0 || x >= W || y >= H ? -1 : y * W + x
      }
      let end: number | null = null
      // The fill as this ray sees it, followed along a gradient fill.
      const ref: RGB = [...fill]
      const near = (q: number): boolean => q >= 0 && chDist(d, q * 4, ref) <= LEAVE && chDist(d, q * 4, fill) <= drift
      let started = false
      for (let t = 1; t <= reach; t++) {
        const i = at(t)
        if (i < 0) {
          end = t // the page's edge
          break
        }
        const x = i % W
        const y = (i - x) / W
        if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) continue
        // Glyphs (with their anti-aliasing, past the coarse mask).
        if (!offGlyph(x, y)) continue
        // Past the text, the fill takes up from the first pixel close to it.
        if (!started && chDist(d, i * 4, fill) <= drift) for (let c = 0; c < 3; c++) ref[c] = d[i * 4 + c]
        started = true
        if (near(i)) {
          // Slowly: a soft edge (a few px) mustn't carry it onto the background.
          for (let c = 0; c < 3; c++) ref[c] = ref[c] * 0.9 + d[i * 4 + c] * 0.1
          continue
        }
        if (near(at(t + 1))) continue // a speck
        // A glyph (its stroke or halo) near the text: the fill again past it.
        if (Math.max(b.x - x, x - b.x - b.w, b.y - y, y - b.y - b.h) <= glyph) {
          let back = -1
          for (let s = 2; s <= glyph && back < 0; s++) if ([0, 1, 2].every((u) => near(at(t + s + u)))) back = s
          if (back > 0) {
            t += back
            continue
          }
        }
        end = t
        let low = 255
        for (let s = 0; s < LOOK; s++) {
          const q = at(t + s)
          if (q < 0) break
          const o = q * 4
          low = Math.min(low, 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2])
        }
        if (low < lumF - OUTLINE_DROP) outlines++
        else steps++
        const q = at(t + 3)
        if (q >= 0) contrast.push(chDist(d, q * 4, fill))
        break
      }
      radius.push(end)
    }
    return { radius, contrast, outlines, steps }
  }
  // How far the fill itself may range (a gradient balloon): well short of how
  // far off it its surroundings are — a white balloon on light grey allows
  // little, a black one on the art a lot.
  const first = trace(255)
  const c = first.contrast.sort((p, q) => p - q)[first.contrast.length >> 1] ?? 0
  const drift = Math.max(DRIFT_MIN, Math.min(DRIFT_MAX, c * 0.5))
  const { radius, outlines, steps } = trace(drift)
  const ended = outlines + steps
  const plain = steps > outlines && steps >= ended * PLAIN_SHARE && steps >= RAYS * 0.2
  // Rays that never left the fill (it runs into a background as light as it):
  // their neighbours' reach.
  const known = radius.filter((r): r is number => r !== null)
  const fallback = known.length ? known.sort((p, q) => p - q)[known.length >> 1] : reach
  const filled = radius.map((r, k) => {
    if (r !== null) return r
    for (let s = 1; s < RAYS / 2; s++) {
      const p = radius[(k - s + RAYS) % RAYS]
      const q = radius[(k + s) % RAYS]
      if (p !== null && q !== null) return Math.min(p, q)
      if (p !== null || q !== null) return (p ?? q)!
    }
    return fallback
  })
  // A lone ray far past both neighbours ran out through a gap (a tail's mouth).
  const trimmed = filled.map((r, k) => Math.min(r, 1.5 * Math.max(filled[(k + RAYS - 1) % RAYS], filled[(k + 1) % RAYS])))
  return {
    kind: plain ? 'plain' : 'outlined',
    cx,
    cy,
    radius: trimmed,
    fill,
    drift,
    outlines,
    steps,
    note: `rays ${outlines} outline / ${steps} step / ${RAYS - ended} open, drift ${Math.round(drift)}`
  }
}

// The area inside the outline the rays traced.
function rayArea(rays: Rays): number {
  return rays.radius.reduce((a, r) => a + r * r, 0) * (Math.PI / RAYS)
}
const FLOOD_SPILL = 1.6

// How deep page point (x, y) is in the outline the rays traced (+ `pad` px): 0
// at its centre, 1 on it.
function rayDepth(rays: Rays, x: number, y: number, pad = 0): number {
  const { cx, cy, radius } = rays
  const dx = x - cx
  const dy = y - cy
  let a = Math.atan2(dy, dx) / (2 * Math.PI)
  if (a < 0) a += 1
  const f = a * RAYS
  const k = Math.floor(f) % RAYS
  const t = f - Math.floor(f)
  const r = radius[k] * (1 - t) + radius[(k + 1) % RAYS] * t + pad
  return Math.hypot(dx, dy) / Math.max(1, r)
}

// A plain balloon's fill part: its fill colour (as the rays saw it), flooded
// from the seeds within the outline the rays traced (+ a few px), so where the
// background comes close to the fill it still stops there.
function plainPart(d: Uint8ClampedArray, W: number, H: number, seeds: number[], rays: Rays, tm: TextMask | undefined): FillPart | null {
  const { fill } = rays
  const ok = (i: number): boolean => chDist(d, i * 4, fill) <= rays.drift && rayDepth(rays, i % W, Math.floor(i / W), 3) <= 1
  const fl = flood(W, H, ok, seeds.filter(ok), W * H * MAX_BUBBLE)
  if (!fl) return null
  const r = fl.r
  const solid = fl.m.slice()
  if (tm) {
    const text = new Uint8Array(r.w * r.h)
    const near = fl.m.slice()
    grow(near, r.w, r.h, JOIN, null)
    markMasked(tm, r, near, text)
    grow(text, r.w, r.h, JOIN, null)
    for (let i = 0; i < solid.length; i++) solid[i] |= text[i]
  }
  return { fill, fl, inside: withHoles(solid, r.w, r.h) }
}

// ── A see-through balloon's opacity ──────────────────────────────────────────
// Its plain-fill part is the balloon over a flat background; just past its
// outline is that background bare. Fill F = α·255 + (1 − α)·B per channel →
// α = (F − B) / (255 − B). Sampled along the fill's edge (a dark outline, then
// a flat patch past it), per bubble the median; a work's balloons share one
// opacity, so the samples are pooled over its pages (`Opacity`).
const ALPHA_MIN_SAMPLES = 30
const ALPHA_AGREE = 0.12 // a white balloon: the channels give about the same α
function measureAlpha(d: Uint8ClampedArray, W: number, H: number, part: FillPart): number | null {
  const { fl, inside } = part
  const r = fl.r
  const F = part.fill
  // An opaque white balloon (or one over white) tells nothing.
  if (luminance(F) >= 245) return null
  const lum = (x: number, y: number): number => {
    const o = (y * W + x) * 4
    return 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]
  }
  const line = Math.min(110, luminance(F) - 60)
  const flat = (x: number, y: number): boolean => {
    let lo = 255
    let hi = 0
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const v = lum(x + dx, y + dy)
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
    return hi - lo <= 8
  }
  const out: number[] = []
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ]
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      if (!fl.m[y * r.w + x]) continue
      for (const [dx, dy] of dirs) {
        const nx = x + dx
        const ny = y + dy
        if (nx >= 0 && ny >= 0 && nx < r.w && ny < r.h && inside[ny * r.w + nx]) continue
        // Walk out: the outline (dark run, ≤ 6 px), then the background.
        const X = r.x0 + x
        const Y = r.y0 + y
        let a = -1
        let b = -1
        for (let k = 1; k <= 14; k++) {
          const px = X + dx * k
          const py = Y + dy * k
          if (px < 1 || py < 1 || px >= W - 1 || py >= H - 1) break
          const dark = lum(px, py) < line
          if (a < 0 && dark) a = k
          else if (a >= 0 && !dark) {
            b = k
            break
          }
        }
        if (a < 0 || b < 0 || b - a > 6) continue
        const bx = X + dx * (b + 2)
        const by = Y + dy * (b + 2)
        if (bx < 1 || by < 1 || bx >= W - 1 || by >= H - 1 || !flat(bx, by)) continue
        const o = (by * W + bx) * 4
        if (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2] > luminance(F) - 15) continue
        const ch: number[] = []
        for (let c = 0; c < 3; c++) if (255 - d[o + c] >= 40) ch.push((F[c] - d[o + c]) / (255 - d[o + c]))
        if (!ch.length || Math.max(...ch) - Math.min(...ch) > ALPHA_AGREE) continue
        const al = ch.reduce((s, v) => s + v, 0) / ch.length
        if (al > 0.05 && al < 0.95) out.push(al)
      }
    }
  if (out.length < ALPHA_MIN_SAMPLES) return null
  out.sort((p, q) => p - q)
  return out[out.length >> 1]
}

// Opacities measured per work (the folder its pages are in), per page (a page
// redrawn replaces its own).
const opacities = new Map<string, Map<string, number[]>>()
// The opacity for a page: its own bubbles' and the work's other pages' pooled.
function pageOpacity(page: string, found: number[]): number | null {
  const work = page.slice(0, page.lastIndexOf('/') + 1)
  let pages = opacities.get(work)
  if (!pages) opacities.set(work, (pages = new Map()))
  if (page) pages.set(page, found)
  const all = page ? [...pages.values()].flat() : found
  if (!all.length) return null
  all.sort((p, q) => p - q)
  return all[all.length >> 1]
}

// The bubble around a fill part: it, and for a see-through balloon the rest up
// to its outline (above `floor`, else DARK); split into lobes.
function makeBubble(
  d: Uint8ClampedArray,
  W: number,
  H: number,
  part: FillPart,
  kind: BubbleKind,
  box: TransBlock,
  tm: TextMask | undefined,
  floor: number | null
): Bubble | null {
  const n = W * H
  const { fill, fl } = part
  const em = box.size ?? Math.min(box.w, box.h)
  let r = fl.r
  let inside = part.inside
  if (kind === 'plain') {
    const holes = new Uint8Array(r.w * r.h)
    for (let i = 0; i < holes.length; i++) holes[i] = inside[i] & (fl.m[i] ^ 1)
    return splitBubble({ ...r, kind, fill, inside, holes, lobes: [], note: `fill ${fl.area}`, em }, tm)
  }
  const core: number[] = []
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (fl.m[y * r.w + x]) core.push((r.y0 + y) * W + r.x0 + x)
  const lum = (i: number): number => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  const ax0 = Math.max(0, Math.min(r.x0, Math.floor(box.x - box.w * EXT_REACH)))
  const ay0 = Math.max(0, Math.min(r.y0, Math.floor(box.y - box.h * EXT_REACH)))
  const ax1 = Math.min(W, Math.max(r.x0 + r.w, Math.ceil(box.x + box.w * (1 + EXT_REACH))))
  const ay1 = Math.min(H, Math.max(r.y0 + r.h, Math.ceil(box.y + box.h * (1 + EXT_REACH))))
  const inA = (i: number): boolean => {
    const x = i % W
    const y = (i - x) / W
    return x >= ax0 && x < ax1 && y >= ay0 && y < ay1
  }
  // Reached the limit (not the page edge)?
  const leaks = (ext: Flood): boolean => {
    for (let y = 0; y < ext.r.h; y++)
      for (let x = 0; x < ext.r.w; x++) {
        if (!ext.m[y * ext.r.w + x]) continue
        const X = ext.r.x0 + x
        const Y = ext.r.y0 + y
        if ((X === ax0 && ax0 > 0) || (Y === ay0 && ay0 > 0) || (X === ax1 - 1 && ax1 < W) || (Y === ay1 - 1 && ay1 < H)) return true
      }
    return false
  }
  // The measured floor first; DARK when it leaks (or there is none).
  const floors = floor === null ? [DARK] : floor < DARK ? [floor, DARK] : [floor]
  let ext: Flood | null = null
  let leaked = true
  let used = DARK
  for (const f of floors) {
    used = f
    ext = flood(W, H, (i) => inA(i) && lum(i) > f, core, n * MAX_BUBBLE)
    leaked = !ext || leaks(ext)
    if (!leaked) break
  }
  let whole = inside
  const note =
    (ext ? `fill ${fl.area} ext ${ext.area} [${ext.r.x0},${ext.r.y0},${ext.r.w},${ext.r.h}]${leaked ? ' leaked' : ''}` : 'no ext') +
    ` floor ${Math.round(used)}`
  if (ext && !leaked) {
    // An outlined fill whose outline holds more than it: see-through after all
    // (a white part next to the text, the art showing past it).
    if (ext.area > fl.area * SEE_THROUGH_GROWTH) kind = 'see-through'
    const u = union(r, ext.r)
    const all = remap(inside, r, u)
    const more = withHoles(ext.m, ext.r.w, ext.r.h)
    for (let y = 0; y < ext.r.h; y++)
      for (let x = 0; x < ext.r.w; x++) if (more[y * ext.r.w + x]) all[(ext.r.y0 - u.y0 + y) * u.w + ext.r.x0 - u.x0 + x] = 1
    const m = remap(fl.m, r, u)
    inside = remap(inside, r, u)
    r = u
    whole = all
    // The glyphs the fill encloses (the part of the text the mask may miss).
    const holes = new Uint8Array(r.w * r.h)
    for (let i = 0; i < holes.length; i++) holes[i] = inside[i] & (m[i] ^ 1)
    return splitBubble({ ...r, kind, fill, inside: whole, holes, lobes: [], note, em }, tm)
  }
  const holes = new Uint8Array(r.w * r.h)
  for (let i = 0; i < holes.length; i++) holes[i] = inside[i] & (fl.m[i] ^ 1)
  return splitBubble({ ...r, kind, fill, inside: whole, holes, lobes: [], note, open: true, em }, tm)
}

// A bubble's lobes. Lobes that held none of the text (tails, bumps) are no place
// for it and are dropped; null when none is left.
function splitBubble(bb: Bubble, tm: TextMask | undefined): Bubble | null {
  const { fill, holes } = bb
  const r: Rect = bb
  // Where the original text is: the text mask, else what the fill encloses.
  const inkMask = new Uint8Array(r.w * r.h)
  if (tm) markMasked(tm, r, bb.inside, inkMask)
  else inkMask.set(holes)
  const whole = opened(bb.inside, r.w, r.h, inkMask, Math.max(OPEN, Math.round((bb.em ?? 0) * OPEN_EM)))
  if (whole !== bb.inside) bb = { ...bb, inside: whole, holes: holes.map((v, i) => v & whole[i]), }
  const label = lobeLabels(whole, r.w, r.h)
  const count = label.reduce((m, v) => Math.max(m, v + 1), 0)
  let lobes: Shape[] = []
  for (let k = 0; k < count; k++) {
    const m = new Uint8Array(r.w * r.h)
    for (let i = 0; i < m.length; i++) if (label[i] === k) m[i] = 1
    // The rim (thin, low in the distance map) can fall to a neighbouring lobe
    // that wraps around to it: each lobe takes back RIM px of the bubble.
    grow(m, r.w, r.h, RIM, whole)
    const s = makeShape(r.x0, r.y0, r.w, r.h, m, inkMask, fill)
    if (s) lobes.push(s)
  }
  const biggest = lobes.reduce((a, s) => Math.max(a, s.area), 0)
  lobes = lobes.filter((s) => s.area >= Math.max(MIN_LOBE_AREA, biggest * 0.04))
  const inked = lobes.filter((s) => s.ink >= s.area * MIN_INK)
  lobes = inked.length ? inked : lobes.filter((s) => s.area === biggest)
  return lobes.length ? { ...bb, lobes } : null
}

// A fill without the thin runs it took out of the balloon — between the focus
// lines round a burst balloon (their tips leave gaps), through a break in an
// outline: opened by `k` px (OPEN_EM of the text's size, OPEN at least — gone
// where narrower than 2k + 1), the parts holding text (`ink`) kept and grown
// back. `m` itself when nothing went.
const OPEN = 4
const OPEN_EM = 0.3
function opened(m: Uint8Array, w: number, h: number, ink: Uint8Array, k: number): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = m[i] ^ 1
  grow(out, w, h, k, null)
  for (let i = 0; i < out.length; i++) out[i] = m[i] & (out[i] ^ 1)
  // The eroded parts with text in them.
  const keep = new Uint8Array(w * h)
  const stack: number[] = []
  for (let i = 0; i < out.length; i++) {
    if (!out[i] || keep[i] || !ink[i]) continue
    keep[i] = 1
    stack.push(i)
    while (stack.length) {
      const j = stack.pop()!
      const x = j % w
      for (const q of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w])
        if (q >= 0 && q < out.length && out[q] && !keep[q]) {
          keep[q] = 1
          stack.push(q)
        }
    }
  }
  if (!keep.some((v) => v)) return m
  grow(keep, w, h, k + 1, m)
  // Gone: only what the opening cut off past a thin run (not just its rim).
  let lost = 0
  for (let i = 0; i < keep.length; i++) if (m[i] && !keep[i]) lost++
  return lost ? keep : m
}

// Share of page pixels `idx` inside a rect mask.
function shareIn(m: Uint8Array, r: Rect, W: number, idx: number[]): number {
  if (!idx.length) return 0
  let k = 0
  for (const i of idx) {
    const x = (i % W) - r.x0
    const y = Math.floor(i / W) - r.y0
    if (x >= 0 && y >= 0 && x < r.w && y < r.h && m[y * r.w + x]) k++
  }
  return k / idx.length
}

// Bubbles sharing over MERGE of the smaller one's area are the same balloon.
const MERGE = 0.3

// Two parts of one balloon in different shades (a see-through part over dark
// art next to the plain fill) touch with no outline between: at least TOUCH px of
// one lie right next to the other.
const TOUCH = 30
function touching(a: Bubble, b: Bubble): boolean {
  const x0 = Math.max(a.x0, b.x0) - 1
  const y0 = Math.max(a.y0, b.y0) - 1
  const x1 = Math.min(a.x0 + a.w, b.x0 + b.w) + 1
  const y1 = Math.min(a.y0 + a.h, b.y0 + b.h) + 1
  const at = (m: Bubble, x: number, y: number): number =>
    x < m.x0 || y < m.y0 || x >= m.x0 + m.w || y >= m.y0 + m.h ? 0 : m.inside[(y - m.y0) * m.w + x - m.x0]
  let k = 0
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if (at(a, x, y) && (at(b, x - 1, y) || at(b, x + 1, y) || at(b, x, y - 1) || at(b, x, y + 1)) && ++k >= TOUCH) return true
  return false
}

// Shared area of two bubbles, as a share of the smaller one.
function overlap(a: Bubble, b: Bubble): number {
  const x0 = Math.max(a.x0, b.x0)
  const y0 = Math.max(a.y0, b.y0)
  const x1 = Math.min(a.x0 + a.w, b.x0 + b.w)
  const y1 = Math.min(a.y0 + a.h, b.y0 + b.h)
  if (x1 <= x0 || y1 <= y0) return 0
  let both = 0
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      both += a.inside[(y - a.y0) * a.w + x - a.x0] & b.inside[(y - b.y0) * b.w + x - b.x0]
  const area = (m: Uint8Array): number => m.reduce((s, v) => s + v, 0)
  return both / Math.max(1, Math.min(area(a.inside), area(b.inside)))
}

// One bubble from two finds of it (the fill of the bigger one).
function mergeBubbles(a: Bubble, b: Bubble, tm: TextMask | undefined): Bubble | null {
  const u = union(a, b)
  const inside = remap(a.inside, a, u)
  const holes = remap(a.holes, a, u)
  const bi = remap(b.inside, b, u)
  const bh = remap(b.holes, b, u)
  for (let i = 0; i < inside.length; i++) {
    inside[i] |= bi[i]
    holes[i] |= bh[i]
  }
  const big = a.inside.reduce((s, v) => s + v, 0) >= b.inside.reduce((s, v) => s + v, 0) ? a : b
  return splitBubble(
    {
      ...u,
      kind: big.kind,
      fill: big.fill,
      inside: withHoles(inside, u.w, u.h),
      holes,
      lobes: [],
      note: `merged (${a.note}) + (${b.note})`,
      em: Math.max(a.em ?? 0, b.em ?? 0) || undefined
    },
    tm
  )
}

// Every bubble holding some of the blocks' text, each found once. The fill
// parts first, so the balloons' opacity (`page`: the page's URL, for pooling it
// over the work) is known before any is extended.
function findBubbles(
  d: Uint8ClampedArray,
  W: number,
  H: number,
  blocks: TransBlock[],
  inks: number[][],
  tm: TextMask | undefined,
  page: string
): Bubble[] {
  // Each text group's balloon: told outlined / plain by its rays, its fill part
  // found that kind's way.
  const parts: {
    part: FillPart
    kind: BubbleKind
    box: TransBlock
    probe: number[]
    note: string
    alpha: number | null
    rays?: Rays
    cast: Rays
    seed: Seed
  }[] = []
  blocks.forEach((b, k) => {
    for (const s of seedsOf(d, W, H, b, inks[k])) {
      const rays = castRays(d, W, H, b, s.fill, tm)
      // Text already in a find is found again only as plain, against a plain
      // find: joined plain balloons have no outline to stop one find at, so
      // each balloon traces its own and they are told apart below.
      const plain = rays.kind === 'plain'
      if (parts.some((p) => !(plain && p.rays) && shareIn(p.part.inside, p.part.fl.r, W, s.probe) >= 0.5)) continue
      // A fill showing a measurable opacity is see-through (its rays leave the
      // fill onto the see-through part, looking plain); else the rays tell.
      let flat = fillPart(d, W, H, s.fill, s.px, tm, b)
      // A fill flood far past where the rays left the fill ran out into a
      // background close to it (a white balloon on light grey): plain.
      if (flat && flat.fl.area > rayArea(rays) * FLOOD_SPILL) {
        rays.kind = 'plain'
        flat = null
      }
      const alpha = flat && measureAlpha(d, W, H, flat)
      const kind: BubbleKind = alpha !== null ? 'see-through' : rays.kind
      const part = kind === 'plain' ? plainPart(d, W, H, s.px, rays, tm) : flat
      if (!part) continue
      // No outline, so only its fill says it's a balloon: paper (white, or a black
      // balloon's black) — a coloured patch is the art (skin, a sheet), a grey one
      // a wall or the sky.
      if (kind === 'plain' && (chroma(part.fill) > PLAIN_CHROMA || (luminance(part.fill) < PLAIN_LIGHT && luminance(part.fill) > PLAIN_DARK))) continue
      parts.push({ part, kind, box: b, probe: s.probe, note: rays.note, alpha, rays: kind === 'plain' ? rays : undefined, cast: rays, seed: s })
    }
  })
  const alpha = pageOpacity(
    page,
    parts.map((p) => p.alpha).filter((a): a is number => a !== null)
  )
  // The work's other light, not-white balloons share that opacity (a dark
  // fill is no white balloon over the art).
  for (const p of parts) {
    const l = luminance(p.part.fill)
    if (p.kind !== 'see-through' && alpha !== null && l < 245 && l > 255 * alpha - 2 * ALPHA_TOL) {
      if (p.kind === 'plain') {
        const flat = fillPart(d, W, H, p.seed.fill, p.seed.px, tm, p.box)
        if (!flat || (p.rays && flat.fl.area > rayArea(p.rays) * FLOOD_SPILL)) continue
        p.part = flat
        p.rays = undefined
      }
      p.kind = 'see-through'
    }
  }
  const floor = alpha === null ? null : alpha * 255 - ALPHA_TOL
  const bubbles: Bubble[] = []
  for (const { part, kind, box, probe, note, rays, cast } of parts) {
    if (bubbles.some((bb) => !(rays && bb.rays) && shareIn(bb.inside, bb, W, probe) >= 0.5)) continue
    const bb = makeBubble(d, W, H, part, kind, box, tm, floor)
    // Its text has to be in it — not just next to a flat patch of the art.
    if (!bb || shareIn(bb.inside, bb, W, probe) < 0.5) continue
    // With no outline, all of it: text running on well past a white patch (a
    // window, the sky) is on the art.
    if (bb.kind === 'plain' && boxInside(box, bb) < PLAIN_HOLDS) continue
    // White over the art leaves a see-through fill under its text light (over
    // DARK, and at least α × 255): a darker one is a flat patch of the art
    // (skin, a shadow).
    if (bb.kind === 'see-through' && luminance(bb.fill) < Math.max(DARK, 255 * (alpha ?? 0))) continue
    // A see-through balloon is closed: its extension stops at its outline, or
    // its rays end on one (OUTLINED_RAYS × those that don't). Open both ways,
    // it's the art.
    if (bb.kind === 'see-through' && bb.open && cast.outlines < cast.steps * OUTLINED_RAYS) continue
    bb.note = `${bb.kind}: ${note}; ${bb.note}${bb.kind === 'see-through' && alpha !== null ? ` α ${alpha.toFixed(2)}` : ''}`
    // The same balloon found again from text on another shade of it (a
    // gradient or see-through balloon) → one bubble, not two on top of each
    // other or side by side. Plain balloons meet with no outline between:
    // touching ones are still two.
    const k = bubbles.findIndex(
      (o) => overlap(o, bb) >= (o.rays && rays ? 0.02 : MERGE) || (o.kind !== 'plain' && bb.kind !== 'plain' && touching(o, bb))
    )
    bb.rays = rays
    bb.probe = probe
    const o = k >= 0 ? bubbles[k] : null
    // Plain finds: one balloon when each holds the other's text; else joined
    // balloons, the shared part split between them.
    if (o?.rays && o.probe && rays) {
      if (shareIn(bb.inside, bb, W, o.probe) < 0.5 || shareIn(o.inside, o, W, probe) < 0.5) {
        const [a, b] = carve(o, bb, W, tm)
        const one = a && b ? joinLobes(a, b) : (a ?? b)
        if (one) bubbles[k] = one
        else bubbles.splice(k, 1)
        continue
      }
    }
    const merged = o ? mergeBubbles(o, bb, tm) : null
    if (merged && o?.rays) {
      merged.rays = o.rays
      merged.probe = [...(o.probe ?? []), ...probe]
    }
    if (merged) bubbles[k] = merged
    else if (!o) bubbles.push(bb)
  }
  return bubbles
}

// Joined plain balloons, carved apart: one bubble (one balloon chain), its lobes
// the balloons' — kept as carved, not split again by shape (no neck between).
function joinLobes(a: Bubble, b: Bubble): Bubble {
  const u = union(a, b)
  const inside = remap(a.inside, a, u)
  const holes = remap(a.holes, a, u)
  const bi = remap(b.inside, b, u)
  const bh = remap(b.holes, b, u)
  for (let i = 0; i < inside.length; i++) {
    inside[i] |= bi[i]
    holes[i] |= bh[i]
  }
  return {
    ...u,
    kind: 'plain',
    fill: a.fill,
    inside,
    holes,
    lobes: [...a.lobes, ...b.lobes],
    rays: a.rays,
    probe: [...(a.probe ?? []), ...(b.probe ?? [])],
    note: `joined (${a.note}) + (${b.note})`
  }
}

// Two joined plain balloons that each found the other's near half too: the
// shared pixels go to whichever's text is nearer.
function carve(a: Bubble, b: Bubble, W: number, tm: TextMask | undefined): [Bubble | null, Bubble | null] {
  const x0 = Math.max(a.x0, b.x0)
  const y0 = Math.max(a.y0, b.y0)
  const x1 = Math.min(a.x0 + a.w, b.x0 + b.w)
  const y1 = Math.min(a.y0 + a.h, b.y0 + b.h)
  // Nearer whose text? (Its glyphs, sampled — not its OCR box, which can run
  // well past them, nor its traced outline, which runs on into the other
  // balloon with no outline between to stop it.)
  const sample = (idx: number[]): number[][] => {
    const step = Math.max(1, Math.floor(idx.length / CARVE_SAMPLES))
    const out: number[][] = []
    for (let k = 0; k < idx.length; k += step) out.push([idx[k] % W, Math.floor(idx[k] / W)])
    return out
  }
  const pa = sample(a.probe ?? [])
  const pb = sample(b.probe ?? [])
  const near = (ps: number[][], x: number, y: number): number => {
    let m = Infinity
    for (const [px, py] of ps) m = Math.min(m, (px - x) * (px - x) + (py - y) * (py - y))
    return m
  }
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const ia = (y - a.y0) * a.w + x - a.x0
      const ib = (y - b.y0) * b.w + x - b.x0
      if (!a.inside[ia] || !b.inside[ib]) continue
      const lose = (pa.length && pb.length ? near(pa, x, y) <= near(pb, x, y) : rayDepth(a.rays!, x, y) <= rayDepth(b.rays!, x, y)) ? b : a
      const i = lose === a ? ia : ib
      lose.inside[i] = 0
      lose.holes[i] = 0
    }
  return [splitBubble(a, tm), splitBubble(b, tm)]
}

// Erase the original text in a bubble: the text mask's glyphs in it (and just
// past it — a stroke touching the outline) or in its blocks' boxes, and what its
// fill encloses near that text or in those boxes (the mask can miss a ♡ or a
// dash). Rebuilt from the fill (or the art) around them, so the outline stays.
function eraseBubble(
  ctx: CanvasRenderingContext2D,
  bb: Bubble,
  boxes: TransBlock[],
  kept: TransBlock[],
  tm: TextMask | undefined
): void {
  const R = MASK_REACH
  const W = ctx.canvas.width
  const H = ctx.canvas.height
  const r: Rect = { x0: Math.max(0, bb.x0 - R), y0: Math.max(0, bb.y0 - R), w: 0, h: 0 }
  r.w = Math.min(W, bb.x0 + bb.w + R) - r.x0
  r.h = Math.min(H, bb.y0 + bb.h + R) - r.y0
  const img = ctx.getImageData(r.x0, r.y0, r.w, r.h)
  const n = r.w * r.h
  const inB = remap(bb.inside, bb, r)
  const holes = remap(bb.holes, bb, r)
  const zone = inB.slice()
  grow(zone, r.w, r.h, R, null)
  const inBoxes = new Uint8Array(n)
  for (const b of boxes) {
    // Glyph edges, a ‥ or an outline poke out of the OCR box: an outline's width past it.
    const p = Math.max(2, Math.min(b.w, b.h) * 0.1, (b.size ?? 0) * OUTLINE_REACH)
    for (let y = Math.max(0, Math.floor(b.y - p) - r.y0); y < Math.min(r.h, Math.ceil(b.y + b.h + p) - r.y0); y++)
      for (let x = Math.max(0, Math.floor(b.x - p) - r.x0); x < Math.min(r.w, Math.ceil(b.x + b.w + p) - r.x0); x++)
        inBoxes[y * r.w + x] = 1
  }
  const allow = new Uint8Array(n)
  for (let i = 0; i < n; i++) allow[i] = zone[i] | inBoxes[i]
  // Text left as it is (SFX) in the bubble stays.
  for (const b of kept)
    for (let y = Math.max(0, Math.floor(b.y) - r.y0); y < Math.min(r.h, Math.ceil(b.y + b.h) - r.y0); y++)
      for (let x = Math.max(0, Math.floor(b.x) - r.x0); x < Math.min(r.w, Math.ceil(b.x + b.w) - r.x0); x++) {
        allow[y * r.w + x] = 0
        holes[y * r.w + x] = 0
      }
  const text = new Uint8Array(n)
  if (tm) markMasked(tm, r, allow, text)
  // Past the balloon's inside or on its rim, only strokes near its boxes' own
  // text: the detector can take an outline, or the focus lines round a burst
  // balloon, for text too (and the fill took them in as its holes).
  const own = new Uint8Array(n)
  for (let i = 0; i < n; i++) own[i] = text[i] & inBoxes[i]
  grow(own, r.w, r.h, R, null)
  const deep = new Uint8Array(n)
  for (let i = 0; i < n; i++) deep[i] = inB[i] ^ 1
  grow(deep, r.w, r.h, RIM_DEPTH, null)
  for (let i = 0; i < n; i++) deep[i] = inB[i] & (deep[i] ^ 1)
  for (let i = 0; i < n; i++)
    if (!own[i] && !deep[i]) {
      text[i] = 0
      holes[i] = 0
    }
  const mask = text.slice()
  // The mask is a bit coarser than the page (≈1024px vs ≤1920px) → grow it more.
  grow(mask, r.w, r.h, GROW + 1, allow)
  // What the mask missed (a ……, a small ♡, a glyph's outline or glow) is
  // erased too. An opaque balloon is one flat fill: per box, the pixels nearer
  // one of its text's colours than the fill are text (erased in the box, never
  // a source for the rebuild anywhere around). A see-through one shows the art
  // under its text — the mask's colours are the art's too — so there: per box,
  // the pixels in its strokes' colour (`glyphColour`), erased, the art left a
  // source.
  const avoid = new Uint8Array(n)
  const opaque = bb.kind !== 'see-through'
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor(b.x) - r.x0)
    const y0 = Math.max(0, Math.floor(b.y) - r.y0)
    const x1 = Math.min(r.w, Math.ceil(b.x + b.w) - r.x0)
    const y1 = Math.min(r.h, Math.ceil(b.y + b.h) - r.y0)
    const glyphs: number[] = []
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (text[y * r.w + x]) glyphs.push(y * r.w + x)
    let inks = textColours(img.data, glyphs, bb.fill)
    if (!opaque) {
      // The strokes' cores (the mask's commonest colour can be the art's).
      const c = glyphColour(img.data, glyphs, bb.fill)
      // Text in about the fill's own brightness is no colour to go by.
      if (!c || Math.abs(luminance(c) - luminance(bb.fill)) < 40) continue
      inks = [c]
    }
    if (!inks.length) continue
    const hit = new Uint8Array(n)
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * r.w + x
        if (inB[i] && allow[i] && (opaque ? textSide(img.data, i * 4, inks, bb.fill) : nearText(img.data, i * 4, inks[0]))) hit[i] = 1
      }
    // Their blended edges too, or the rebuild smears the colour back in.
    grow(hit, r.w, r.h, GROW + 1, inB)
    for (let i = 0; i < n; i++) {
      mask[i] |= hit[i] & allow[i]
      if (opaque && zone[i] && textSide(img.data, i * 4, inks, bb.fill)) avoid[i] = 1
    }
  }
  grow(avoid, r.w, r.h, 1, null)
  const near = mask.slice()
  grow(near, r.w, r.h, R, null)
  for (let i = 0; i < n; i++) if (holes[i] && (near[i] || inBoxes[i])) mask[i] = 1
  grow(mask, r.w, r.h, GROW, inB)
  fillIn(img.data, mask, r.w, r.h, avoid)
  ctx.putImageData(img, r.x0, r.y0)
}

// Paint a bubble flat (a manual colour from the editor).
function paintBubble(ctx: CanvasRenderingContext2D, bb: Bubble, c: RGB): void {
  const img = ctx.getImageData(bb.x0, bb.y0, bb.w, bb.h)
  for (let i = 0; i < bb.w * bb.h; i++) {
    if (!bb.inside[i]) continue
    img.data[i * 4] = c[0]
    img.data[i * 4 + 1] = c[1]
    img.data[i * 4 + 2] = c[2]
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, bb.x0, bb.y0)
}

// Erase a block that sits on the art (no bubble), never outside its padded box
// (an outline's width past it): the detector's text pixels when it found any
// here, else the pixels in the text's own colours (`markTextColours`), else the
// whole box. Then whatever near those is in the strokes' colour or the one
// round them (`ink`, `rim`: an outline, a glyph the mask only half took). Rebuilt
// from their surroundings (`fillIn`); a manual colour (`manual`) paints the box
// flat instead.
function eraseOnArt(
  ctx: CanvasRenderingContext2D,
  b: TransBlock,
  manual: RGB | null,
  tm: TextMask | undefined,
  W: number,
  H: number,
  ink: RGB | null = null,
  rim: RGB | null = null
): void {
  const em = b.size ?? Math.min(b.w, b.h)
  const reach = Math.max(2, Math.round(em * OUTLINE_REACH))
  const pad = Math.max(2, Math.min(b.w, b.h) * 0.1, manual ? 0 : reach)
  const rp = Math.max(pad + 3, Math.min(b.w, b.h) * 0.2)
  const r: Rect = { x0: Math.max(0, Math.floor(b.x - rp)), y0: Math.max(0, Math.floor(b.y - rp)), w: 0, h: 0 }
  r.w = Math.min(W, Math.ceil(b.x + b.w + rp)) - r.x0
  r.h = Math.min(H, Math.ceil(b.y + b.h + rp)) - r.y0
  if (r.w <= 2 || r.h <= 2) return
  const img = ctx.getImageData(r.x0, r.y0, r.w, r.h)
  const d = img.data
  const n = r.w * r.h
  const inBox = new Uint8Array(n)
  let boxCount = 0
  for (let y = Math.max(0, Math.floor(b.y - pad) - r.y0); y < Math.min(r.h, Math.ceil(b.y + b.h + pad) - r.y0); y++)
    for (let x = Math.max(0, Math.floor(b.x - pad) - r.x0); x < Math.min(r.w, Math.ceil(b.x + b.w + pad) - r.x0); x++) {
      inBox[y * r.w + x] = 1
      boxCount++
    }
  let mask = new Uint8Array(n)
  if (manual) mask = inBox
  else if (tm && markMasked(tm, r, inBox, mask) >= boxCount * 0.01) {
    // The mask is a bit coarser than the page (≈1024px vs ≤1920px) → grow more.
    grow(mask, r.w, r.h, GROW + 1, inBox)
  } else if (markTextColours(d, inBox, mask, n) < boxCount * 0.02) mask = inBox
  else grow(mask, r.w, r.h, GROW + 1, inBox)
  if (!manual && (ink || rim)) {
    const near = mask.slice()
    grow(near, r.w, r.h, reach, inBox)
    const hit = new Uint8Array(n)
    for (let i = 0; i < n; i++)
      if (near[i] && !mask[i] && ((ink && nearText(d, i * 4, ink)) || (rim && nearText(d, i * 4, rim)))) hit[i] = 1
    // Their blended edges too, or the rebuild smears the colour back in.
    grow(hit, r.w, r.h, 1, inBox)
    for (let i = 0; i < n; i++) mask[i] |= hit[i]
  }

  if (manual) {
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue
      d[i * 4] = manual[0]
      d[i * 4 + 1] = manual[1]
      d[i * 4 + 2] = manual[2]
      d[i * 4 + 3] = 255
    }
  } else {
    fillIn(d, mask, r.w, r.h, textColoured(d, mask, inBox, r.w, r.h))
    // The model paints a little past the erase too: the soft edge of a glow or
    // outline the mask stops short of.
    if (erasing) {
      const wide = mask.slice()
      grow(wide, r.w, r.h, Math.ceil(reach / 2), null)
      erasing.add(r, wide)
    }
  }
  ctx.putImageData(img, r.x0, r.y0)
}


// The text's colours around an erase on the art (`textColours` of its masked
// pixels, against the commonest colour outside the box): its pixels in the box
// join the erase (with their blended edges), the rest — a glow or stroke past
// the box — come back as the pixels the rebuild must not draw from. Undefined
// when no colour stands off the background, or the ground isn't flat.
const FLAT = 0.6
function textColoured(d: Uint8ClampedArray, mask: Uint8Array, inBox: Uint8Array, w: number, h: number): Uint8Array | undefined {
  const n = w * h
  const out: number[] = []
  const masked: number[] = []
  for (let i = 0; i < n; i++) {
    if (!inBox[i]) out.push(i)
    else if (mask[i]) masked.push(i)
  }
  if (!out.length) return undefined
  const bg = dominant(d, out)
  // Over the art the mask's colours are the art's too: only a flat ground (a
  // balloon the bubble search missed) gives the text's colours away.
  if (out.filter((i) => nearFill(d, i * 4, bg)).length < out.length * FLAT) return undefined
  const inks = textColours(d, masked, bg)
  if (!inks.length) return undefined
  const hit = new Uint8Array(n)
  const avoid = new Uint8Array(n)
  for (let i = 0; i < n; i++)
    if (textSide(d, i * 4, inks, bg)) {
      if (inBox[i]) hit[i] = 1
      else avoid[i] = 1
    }
  grow(hit, w, h, GROW + 1, inBox)
  for (let i = 0; i < n; i++) mask[i] |= hit[i]
  grow(avoid, w, h, 1, null)
  return avoid
}

// Text over art: mark (in `mask`) the box pixels whose colour is much more common
// inside the box than in the ring around it — the art and the light around it run
// on past the box, the text's colours don't. Returns how many were marked.
function markTextColours(d: Uint8ClampedArray, inBox: Uint8Array, mask: Uint8Array, n: number): number {
  const key = (i: number): number => ((d[i * 4] >> 5) << 6) | ((d[i * 4 + 1] >> 5) << 3) | (d[i * 4 + 2] >> 5)
  const inC = new Uint32Array(512)
  const outC = new Uint32Array(512)
  let nIn = 0
  let nOut = 0
  for (let i = 0; i < n; i++) {
    if (inBox[i]) {
      inC[key(i)]++
      nIn++
    } else {
      outC[key(i)]++
      nOut++
    }
  }
  if (!nIn || !nOut) return 0
  const text = new Uint8Array(512)
  for (let k = 0; k < 512; k++) {
    const fi = inC[k] / nIn
    if (fi >= 0.005 && fi > (outC[k] / nOut) * TEXT_RATIO) text[k] = 1
  }
  let hits = 0
  for (let i = 0; i < n; i++)
    if (inBox[i] && text[key(i)]) {
      mask[i] = 1
      hits++
    }
  return hits
}

// One lobe of a bubble (a plain bubble is one lobe; balloons joined into a chain
// are several), for laying the translation out in the bubble instead of the
// (often narrow, vertical) OCR box. Coords are relative to (x0, y0). `half[y]` =
// how far the lobe reaches left/right of the centre column on row y (the nearer
// side; 0 = not in it).
interface Shape {
  x0: number
  y0: number
  w: number
  h: number
  cx: number
  cy: number
  top: number
  bottom: number
  area: number
  ink: number // pixels of the original text in the lobe
  inkMask: Uint8Array // where the original text is (region coords, shared)
  half: Float32Array
  inside: Uint8Array
  fill: RGB // the bubble's fill colour
  room?: boolean // the room of text on the art (`artRooms`), no balloon
}

// A neck narrower than (1 - NECK) of the smaller lobe's radius splits two lobes;
// lobes with a radius under MIN_LOBE_R px are never split off (tails, bumps).
const NECK = 0.4
const MIN_LOBE_R = 10
const MIN_LOBE_AREA = 300
// A lobe is a place for text only if it held some of the original text (this
// share of its area) — not a tail's tip, nor fill run out past an outline gap.
const MIN_INK = 0.02
// How far past a bubble the text mask may still erase (px).
const MASK_REACH = 4
const RIM_DEPTH = 6 // a balloon's rim, where an outline taken for text lies

// Split a bubble mask into lobes: a distance transform gives each pixel its
// distance to the outline (the "radius" there), then pixels join from the widest
// inward; where two growing lobes meet at a neck clearly narrower than the smaller
// one's own widest point, they stay apart. Returns a lobe index per pixel (-1 =
// outside the bubble).
function lobeLabels(inside: Uint8Array, w: number, h: number): Int32Array {
  const n = w * h
  const dist = new Float32Array(n)
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : dist[y * w + x])
  for (let i = 0; i < n; i++) dist[i] = inside[i] ? 1e9 : 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!inside[i]) continue
      dist[i] = Math.min(dist[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414)
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (!inside[i]) continue
      dist[i] = Math.min(dist[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414)
    }

  // Bucket the pixels by distance, widest first.
  let maxD = 0
  for (let i = 0; i < n; i++) if (dist[i] > maxD) maxD = dist[i]
  const nb = Math.floor(maxD) + 1
  const start = new Int32Array(nb + 1)
  for (let i = 0; i < n; i++) if (inside[i]) start[nb - 1 - Math.floor(dist[i]) + 1]++
  for (let k = 0; k < nb; k++) start[k + 1] += start[k]
  const order = new Int32Array(start[nb])
  const fill = start.slice()
  for (let i = 0; i < n; i++) if (inside[i]) order[fill[nb - 1 - Math.floor(dist[i])]++] = i

  const parent = new Int32Array(n).fill(-1)
  const peak = new Float32Array(n)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  for (const p of order) {
    parent[p] = p
    peak[p] = dist[p]
    const x = p % w
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx
        const q = p + dy * w + dx
        if ((!dx && !dy) || xx < 0 || xx >= w || q < 0 || q >= n || parent[q] < 0) continue
        const a = find(p)
        const c = find(q)
        if (a === c) continue
        const lo = Math.min(peak[a], peak[c])
        if (lo >= MIN_LOBE_R && lo - dist[p] >= NECK * lo) continue // a neck: keep apart
        if (peak[a] >= peak[c]) parent[c] = a
        else parent[a] = c
      }
  }

  const label = new Int32Array(n).fill(-1)
  const ids = new Map<number, number>()
  for (let i = 0; i < n; i++) {
    if (!inside[i]) continue
    const root = find(i)
    let id = ids.get(root)
    if (id === undefined) ids.set(root, (id = ids.size))
    label[i] = id
  }
  return label
}

function makeShape(
  x0: number,
  y0: number,
  w: number,
  h: number,
  inside: Uint8Array,
  inkMask: Uint8Array,
  fill: RGB
): Shape | null {
  let sx = 0
  let sy = 0
  let c = 0
  let top = h
  let bottom = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!inside[y * w + x]) continue
      sx += x
      sy += y
      c++
      if (y < top) top = y
      bottom = y
    }
  if (!c) return null
  const cx = Math.round(sx / c)
  const cy = sy / c
  const half = new Float32Array(h)
  for (let y = 0; y < h; y++) {
    if (!inside[y * w + cx]) continue
    let l = cx
    let rr = cx
    while (l > 0 && inside[y * w + l - 1]) l--
    while (rr < w - 1 && inside[y * w + rr + 1]) rr++
    half[y] = Math.min(cx - l, rr - cx)
  }
  let ink = 0
  for (let i = 0; i < w * h; i++) ink += inside[i] & inkMask[i]
  return { x0, y0, w, h, cx, cy, top, bottom, area: c, ink, inkMask, half, inside, fill }
}

// Usable line width between rows ya..yb (shape coords), less `margin` each side.
function spanAt(s: Shape, ya: number, yb: number, margin: number): number {
  const a = Math.floor(ya - margin / 2)
  const z = Math.ceil(yb + margin / 2)
  if (a < 0 || z >= s.h) return 0
  let m = Infinity
  for (let y = a; y <= z; y++) m = Math.min(m, s.half[y])
  return Math.max(0, 2 * (m - margin))
}

// Block centre inside a bubble shape → the block sits in that bubble.
function shapeHas(s: Shape, b: TransBlock): boolean {
  const x = Math.round(b.x + b.w / 2) - s.x0
  const y = Math.round(b.y + b.h / 2) - s.y0
  return x >= 0 && y >= 0 && x < s.w && y < s.h && s.inside[y * s.w + x] === 1
}

// Grow `mask` by `steps` px (8-neighbour), only into pixels `allow` marks (any if null).
function grow(mask: Uint8Array, w: number, h: number, steps: number, allow: Uint8Array | null): void {
  for (let s = 0; s < steps; s++) {
    const add: number[] = []
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (mask[i] || (allow && !allow[i])) continue
        let hit = false
        for (let dy = -1; dy <= 1 && !hit; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            const yy = y + dy
            if (xx >= 0 && yy >= 0 && xx < w && yy < h && mask[yy * w + xx]) {
              hit = true
              break
            }
          }
        if (hit) add.push(i)
      }
    for (const i of add) mask[i] = 1
  }
}

// Rebuild masked pixels from their surroundings, onion-peel style: each pass
// fills the masked pixels touching known ones with the average of those known
// 8-neighbours, so colour flows in evenly from every side. Pixels `avoid` marks
// (the text's colour the mask missed — a glow, an anti-aliased edge) are never a
// source: they would flow back in. Only masked pixels nothing else reaches are
// then filled from them after all.
function fillIn(d: Uint8ClampedArray, mask: Uint8Array, w: number, h: number, avoid?: Uint8Array): void {
  const hole = mask.slice()
  if (avoid) {
    const skip = new Uint8Array(w * h)
    for (let i = 0; i < skip.length; i++) skip[i] = avoid[i] && !mask[i] ? 1 : 0
    peel(d, hole, w, h, skip)
  }
  peel(d, hole, w, h)
}

// fillIn's pass: the pixels `mask` marks rebuilt from those neither it nor
// `skip` marks; each one filled is cleared in `mask` (what's left, they never
// reach).
function peel(d: Uint8ClampedArray, mask: Uint8Array, w: number, h: number, skip?: Uint8Array): void {  const n = w * h
  const known = new Uint8Array(n)
  for (let i = 0; i < n; i++) known[i] = mask[i] || skip?.[i] ? 0 : 1
  const queued = new Uint8Array(n)
  const nbrs = (i: number, f: (j: number) => void): void => {
    const x = i % w
    const y = (i - x) / w
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const xx = x + dx
        const yy = y + dy
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) f(yy * w + xx)
      }
  }
  let front: number[] = []
  for (let i = 0; i < n; i++) {
    if (known[i] || !mask[i]) continue
    let edge = false
    nbrs(i, (j) => {
      if (known[j]) edge = true
    })
    if (edge) {
      front.push(i)
      queued[i] = 1
    }
  }
  while (front.length) {
    const vals = new Float32Array(front.length * 3)
    front.forEach((i, k) => {
      let r = 0
      let g = 0
      let bl = 0
      let c = 0
      nbrs(i, (j) => {
        if (!known[j]) return
        r += d[j * 4]
        g += d[j * 4 + 1]
        bl += d[j * 4 + 2]
        c++
      })
      vals[k * 3] = r / c
      vals[k * 3 + 1] = g / c
      vals[k * 3 + 2] = bl / c
    })
    const next: number[] = []
    front.forEach((i, k) => {
      d[i * 4] = vals[k * 3]
      d[i * 4 + 1] = vals[k * 3 + 1]
      d[i * 4 + 2] = vals[k * 3 + 2]
      d[i * 4 + 3] = 255
      known[i] = 1
      mask[i] = 0
    })
    for (const i of front)
      nbrs(i, (j) => {
        if (known[j] || queued[j] || !mask[j]) return
        queued[j] = 1
        next.push(j)
      })
    front = next
  }
}

// Onomatopoeia / sound-effect detector.
//
// Geometry alone (box size) misses SMALL SFX, so the PRIMARY signal is the source
// SCRIPT: Japanese *dialogue* almost always contains hiragana (grammar particles,
// okurigana), while onomatopoeia/mimetic words are written in katakana only. So a
// katakana-only block — no hiragana, no kanji — is almost certainly SFX regardless
// of its size. Blocks that are only punctuation/symbols carry nothing worth
// translating either. A geometric rule stays as a fallback for when the source
// text is missing or non-Japanese (huge box per character).
const HIRAGANA = /[぀-ゟ]/
const KANJI = /[㐀-䶿一-鿿]/
const KATAKANA = /[゠-ヿｦ-ﾝ]/ // incl. long-vowel and half-width
const HAS_LETTER = /[\p{L}\p{N}]/u

// Kana blocks whose "core" length (below) is at most this are treated as
// SFX/interjections and skipped. Blocks that contain kanji are exempt (short kanji
// lines are usually real dialogue, e.g. 何だ). Tune if too / not aggressive enough.
const SFX_MAX_LEN = 3

// Small kana, long-vowel marks and interpuncts don't add a mora — strip them before
// counting so どちゅっ / ドキーッ count like ~2 letters (else they slip past the length
// rule and a stray one gets translated even though its twin was skipped).
const NON_MORA = /[ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ゛゜ーｰ・~〜～]/g
function coreLen(s: string): number {
  return [...s.replace(NON_MORA, '')].filter((c) => HAS_LETTER.test(c)).length
}

// True if the whole (letters-only) string is a short unit repeated — the signature
// of a mimetic word: ドキドキ (ドキ×2), ゴゴゴ (ゴ×3), ざわざわ (ざわ×2).
function isRepeatedUnit(t: string): boolean {
  for (let u = 1; u <= 3; u++) {
    if (t.length >= u * 2 && t.length % u === 0 && t.slice(0, u).repeat(t.length / u) === t) return true
  }
  return false
}

export function isSfx(b: TransBlock, W: number, H: number): boolean {
  const src = (b.text || '').trim()
  if (src) {
    // Nothing meaningful (pure !? … symbols).
    if (!HAS_LETTER.test(src)) return true
    const letters = [...src].filter((c) => HAS_LETTER.test(c))
    const noKanji = !KANJI.test(src)
    // Katakana-only Japanese → onomatopoeia (dialogue would carry hiragana/kanji).
    if (KATAKANA.test(src) && !HIRAGANA.test(src) && noKanji) return true
    // Short kana blocks (no kanji) → SFX / grunts (오라, 바츄, ドキ, どちゅっ …).
    if (noKanji && coreLen(src) <= SFX_MAX_LEN) return true
    // Repeated-unit mimetic words of any length (ドキドキ, ざわざわ, ゴゴゴ).
    if (isRepeatedUnit(letters.join(''))) return true
    // Past those, hiragana / kanji means dialogue — whatever the box size.
    if (HIRAGANA.test(src) || !noKanji) return false
  } else if (b.tr) {
    // No source text from the engine (only a translation) → can't script-detect;
    // judge by the translation instead: a short one is almost always an SFX (도츄 …).
    if (coreLen(b.tr) <= SFX_MAX_LEN) return true
  }
  // Fallback: non-Japanese / still ambiguous → a big box holding few characters.
  const chars = [...(src || b.tr || '').replace(/\s/g, '')].length
  if (chars <= 0) return false
  const areaFrac = (b.w * b.h) / (W * H)
  return areaFrac / chars > 0.004 || (chars <= 6 && areaFrac > 0.03)
}

// Punctuation that belongs to the text before it and never starts a line. An
// ellipsis — "...", "……" — may only where it stands on its own (after a space);
// written onto a word it stays with it, whole.
const TRAILING = /^[,.!?:;、。，．！？：；~〜～♡♥」』）)\]]+$/
const ELLIPSIS = /…|\.\.|・・/
const trails = (s: string): boolean => TRAILING.test(s) && !ELLIPSIS.test(s)
const DOTS = /[….・]/
// An ellipsis run written onto a word, and the text going on after it
// ("직장이라…활용하기"): a place to break, as a space is — the ellipsis staying up.
const AFTER_DOTS = /(?<=[^\s….・](?:…+|\.{2,}|・{2,}))(?=[^\s….・!?！？,、。~〜～♡♥」』）)\]])/
// A line's width less the trailing punctuation it ends in (that hangs past the
// line's edge rather than going down a line alone).
function bodyWidth(ctx: CanvasRenderingContext2D, line: string): number {
  const m = /[,.!?:;、。，．！？：；~〜～♡♥」』）)\]]+$/.exec(line)
  return ctx.measureText(m && trails(m[0]) ? line.slice(0, m.index) : line).width
}

// Where a Korean word may be cut inside it, by its grammar (no analyser — the
// endings and particles dialogue uses): before a particle (오빠/한테, 집/에서),
// before an auxiliary verb after its connector (먹고/싶다, 해/줄까), after a
// connective ending (가면/좋겠다). Single-syllable particles (은/는/이/가…) are
// left on: cut there, they'd stand alone.
const PARTICLES = [
  '한테', '에게', '에서', '에선', '으로', '로서', '로써', '까지', '부터', '처럼', '보다', '이랑', '하고',
  '마저', '조차', '밖에', '만큼', '대로', '께서', '이나', '이라도', '라도', '이야', '같이', '한테서', '에게서',
  '같' // 같다/같은/같아 — often written onto the noun before it
]
const AUX_AFTER = /[고어아여해게지서워와봐돼줘져]$/
const AUX = /^(싶|있|없|주|줘|줄|준|줍|보|봐|볼|본|버리|버려|버린|버릴|않|안|못|대|놓|놔|두|둬|가|와|오|올|갈|내|낼|지|져|드리|드려)/
const CONNECTIVE = /(면|고|서|는데|은데|지만|니까|려고|도록|면서|다가|더니|자마자)$/
const HANGUL = /[가-힣]/
const ENDING_START = /^[어아여으이었았였]/
function koreanCut(left: string, right: string): boolean {
  if (!HANGUL.test(left.slice(-1)) || !HANGUL.test(right[0] ?? '')) return false
  if (PARTICLES.some((p) => right.startsWith(p))) return true
  if (AUX_AFTER.test(left) && AUX.test(right)) return true
  return CONNECTIVE.test(left)
}

// Where to cut a word (chars) wider than its line: as far in as fits (`fits(k)`:
// its first k chars do), at a grammar boundary if there is one; else as far as
// fits. Never a line starting with trailing punctuation, nor a Korean syllable
// split off alone on either side (자/궁) — 0 when that leaves no cut, unless
// `loose` (then as far as fits, whatever it leaves).
function cutAt(chars: string[], fits: (k: number) => boolean, loose: boolean): number {
  const n = chars.length
  let max = 1
  while (max + 1 < n && fits(max + 1)) max++
  const lone = (s: string[]): boolean => s.length === 1 && HANGUL.test(s[0])
  const ok = (k: number): boolean =>
    k >= 1 &&
    k < n &&
    !(trails(chars[k]) && !(chars[k] === '.' && (chars[k - 1] === '.' || chars[k + 1] === '.'))) &&
    // Not into an ellipsis, nor one off the word it's written onto.
    !(DOTS.test(chars[k]) && chars[k - 1] !== ' ') &&
    !lone(chars.slice(0, k)) &&
    !lone(chars.slice(k))
  for (let k = max; k >= 2; k--) if (ok(k) && koreanCut(chars.slice(0, k).join(''), chars.slice(k).join(''))) return k
  // A piece starting on an ending's vowel (달라붙/어서) reads worst: anywhere else first.
  for (let k = max; k >= 1; k--) if (ok(k) && !ENDING_START.test(chars[k])) return k
  for (let k = max; k >= 1; k--) if (ok(k)) return k
  return loose ? max : 0
}

// Word wrap into lines whose widths `widthAt(line)` gives. Breaks at spaces; a
// word wider than its line (Korean often has long runs) breaks per character —
// or, with `breakWords` off, makes the wrap fail (null). Honors explicit newlines.
// Trailing punctuation stays with the text before it (`trails`, hanging).
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  widthAt: (line: number) => number,
  breakWords = true,
  loose = false
): string[] | null {
  const lines: string[] = []
  for (const para of text.replace(/\r/g, '').split('\n')) {
    let cur = ''
    // A space before punctuation ("어때 ,") would let it wrap alone. A word with
    // an ellipsis inside goes as two (`glued`: no space before the second).
    const words: string[] = []
    const glued = new Set<number>()
    for (const w of para.split(' '))
      if (words.length && trails(w)) words[words.length - 1] += w
      else
        w.split(AFTER_DOTS).forEach((piece, k) => {
          if (k) glued.add(words.length)
          words.push(piece)
        })
    for (const [wi, word] of words.entries()) {
      const next = cur ? `${cur}${glued.has(wi) ? '' : ' '}${word}` : word
      if (bodyWidth(ctx, next) <= widthAt(lines.length)) {
        cur = next
        continue
      }
      if (cur) lines.push(cur)
      cur = ''
      if (!breakWords && bodyWidth(ctx, word) > widthAt(lines.length)) return null
      // A word wider than the line: cut where it reads best (`cutAt`).
      let rest = [...word]
      while (rest.length) {
        const fits = (k: number): boolean => bodyWidth(ctx, rest.slice(0, k).join('')) <= widthAt(lines.length)
        if (fits(rest.length)) break
        const k = cutAt(rest, fits, loose)
        if (!k) return null
        lines.push(rest.slice(0, k).join(''))
        rest = rest.slice(k)
      }
      cur = rest.join('')
    }
    lines.push(cur)
  }
  return lines.length ? lines : ['']
}

interface Layout {
  fs: number
  lines: string[]
  cx: number // centre x of the lines
  top: number // y of the first line's top
  over?: boolean // runs over its lobe's outline (didn't fit)
  text?: string // over: the text and the lobe it didn't fit
  shape?: Shape
  fill?: RGB // the bubble's fill under it (unset: the block's colour)
  face?: Face // its font (unset: the auto look)
}

const lineH = (fs: number): number => fs * 1.18

// Largest font (up to `cap`) that fits the OCR box (the fallback, and what manual
// blocks use). An auto block (`floor` set) shrinks only down to `floor`; past
// that it keeps `cap` and runs over the box.
function layoutInBox(ctx: CanvasRenderingContext2D, b: TransBlock, text: string, cap = 72, floor?: number): Layout {
  const pad = Math.max(3, Math.min(b.w, b.h) * 0.08)
  const maxW = Math.max(8, b.w - pad * 2)
  const maxH = Math.max(8, b.h - pad * 2)
  const low = floor ?? 9
  let fs = floor === undefined ? 9 : cap
  let lines: string[] | null = null
  for (let f = floor === undefined ? Math.max(9, Math.min(Math.round(maxH), cap)) : cap; f >= low; f--) {
    ctx.font = fontAt(f)
    const ls = wrap(ctx, text, () => maxW, true, true) ?? []
    if ((ls.length * lineH(f) <= maxH && ls.every((l) => bodyWidth(ctx, l) <= maxW)) || (f === 9 && floor === undefined)) {
      fs = f
      lines = ls
      break
    }
  }
  if (!lines) {
    ctx.font = fontAt(fs)
    lines = wrap(ctx, text, () => Math.max(maxW, fs * 2), true, true) ?? []
  }
  return { fs, lines, cx: b.x + b.w / 2, top: b.y + (b.h - lines.length * lineH(fs)) / 2 }
}

// The source text's size estimated from its box and character count.
function maxFontFor(b: TransBlock): number {
  const chars = [...(b.text || '').replace(/\s/g, '')].length
  const est = chars ? Math.sqrt((b.w * b.h) / chars) : Math.min(b.w, b.h)
  return Math.round(Math.max(12, Math.min(72, est * 1.15)))
}

// Lay `text` out in a lobe at font size `fs`: n lines centred on the lobe's
// centre, each line as wide as the lobe is at its rows. null if it doesn't fit.
function fitAt(ctx: CanvasRenderingContext2D, text: string, s: Shape, fs: number, breakWords = true): Layout | null {
  ctx.font = fontAt(fs)
  const lh = lineH(fs)
  const margin = fs * 0.08
  let widest = 0
  for (let y = 0; y < s.h; y++) widest = Math.max(widest, s.half[y] * 2)
  const total = ctx.measureText(text.replace(/\s+/g, ' ')).width
  for (let n = Math.max(1, Math.ceil(total / Math.max(1, widest))); n * lh <= s.bottom - s.top + 1; n++) {
    const top = s.cy - (n * lh) / 2
    const widthAt = (i: number): number => (i < n ? spanAt(s, top + i * lh, top + (i + 1) * lh, margin) : 0)
    const ls = wrap(ctx, text, widthAt, breakWords)
    if (!ls || ls.length > n) continue
    // Fewer lines than slots → centre what we have, then re-check the widths.
    const t = s.cy - (ls.length * lh) / 2
    if (ls.every((l, i) => bodyWidth(ctx, l) <= spanAt(s, t + i * lh, t + (i + 1) * lh, margin)))
      return { fs, lines: ls, cx: s.x0 + s.cx, top: s.y0 + t, fill: s.fill }
  }
  return null
}

// Keeping words whole is worth this much of the font size.
const WHOLE_WORDS = 0.8

// The source text's size comes first: a layout shrinks to fit its lobe down to
// MIN_SHRINK of it; past that it keeps the size and runs over the outline.
// The size is trusted only when the source text could have sat at it in its
// lobes (a misread size — art taken for a giant glyph — couldn't): else it fits
// as it can, down to 9.
const MIN_SHRINK = 0.85
function sizeTrusted(b: TransBlock, lobes: Shape[]): boolean {
  // A room on the art is the source text's own place: it held it at that size.
  if (b.size && lobes.some((s) => s.room)) return true
  const chars = [...(b.text || '').replace(/\s/g, '')].length
  return !lobes.length || (!!b.size && chars * b.size * b.size <= lobes.reduce((a, s) => a + s.area, 0))
}
const minFont = (b: TransBlock, lobes: Shape[] = []): number =>
  sizeTrusted(b, lobes) ? Math.max(9, Math.round(targetFont(b) * MIN_SHRINK)) : 9
// The size a layout that fits nowhere keeps (running over the outline).
const keptFont = (b: TransBlock, lobes: Shape[]): number => (sizeTrusted(b, lobes) ? targetFont(b) : 9)

// `text` at font size `fs` centred on a lobe it doesn't fit: lines no wider than
// the lobe's widest row (a word broken if need be), running on past its top and
// bottom — wider lines would leave a narrow balloon altogether.
function overflowAt(ctx: CanvasRenderingContext2D, text: string, s: Shape, fs: number): Layout {
  ctx.font = fontAt(fs)
  const lh = lineH(fs)
  let widest = 0
  for (let y = 0; y < s.h; y++) widest = Math.max(widest, s.half[y] * 2)
  const w = Math.max(fs * 1.2, widest - fs * 0.5)
  const lines = wrap(ctx, text, () => w, true, true) ?? []
  return { fs, lines, cx: s.x0 + s.cx, top: s.y0 + s.cy - (lines.length * lh) / 2, fill: s.fill, over: true, text, shape: s }
}

// Largest font (from the source's size down to minFont) that fits the lobe —
// with words kept whole unless that costs more than WHOLE_WORDS of the size (a
// word broken mid-way reads worse than a slightly smaller one, so whole words
// may go that much under minFont); none → the source's size over the outline.
function layoutInShape(ctx: CanvasRenderingContext2D, b: TransBlock, text: string, s: Shape, keep?: number): Layout {
  const largest = (breakWords: boolean, floor: number): Layout | null => {
    for (let fs = targetFont(b); fs >= floor; fs--) {
      const lay = fitAt(ctx, text, s, fs, breakWords)
      if (lay) return lay
    }
    return null
  }
  const broken = largest(true, minFont(b, [s]))
  // A room on the art takes a little more of it before the text gets smaller.
  const whole = largest(false, s.room ? minFont(b, [s]) : Math.max(9, Math.floor((broken?.fs ?? minFont(b, [s])) * WHOLE_WORDS)))
  const best = whole && (!broken || whole.fs >= broken.fs * WHOLE_WORDS) ? whole : broken
  return best ?? overflowAt(ctx, text, s, keep ?? keptFont(b, [s]))
}

// Manga reading order of lobes: top to bottom; side by side (rows overlapping by
// half) → right to left.
function readingOrder(a: Shape, b: Shape): number {
  const ov = Math.min(a.y0 + a.bottom, b.y0 + b.bottom) - Math.max(a.y0 + a.top, b.y0 + b.top)
  const hmin = Math.min(a.bottom - a.top, b.bottom - b.top)
  if (ov > hmin * 0.5) return b.x0 + b.cx - (a.x0 + a.cx)
  return a.y0 + a.cy - (b.y0 + b.cy)
}

// One block's text over several joined lobes: split it at spaces (per character
// when there are too few words) into one piece per lobe, in reading order, and
// lay every piece out at one shared font size — the largest at which some split
// fits every lobe. Splits tried first: at sentence ends (the source paragraphs
// are whole sentences too), nearest the lobes' share of the source text; then
// around that share at any word.
function layoutSplit(ctx: CanvasRenderingContext2D, b: TransBlock, text: string, lobes: Shape[], keep?: number): Layout[] | null {
  const k = lobes.length
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const byWord = words.length >= k
  const units = byWord ? words : [...text.replace(/\s+/g, '')]
  const sep = byWord ? ' ' : ''
  if (units.length < k) return null
  const len = units.map((u) => [...u].length)
  const pre = [0]
  for (const l of len) pre.push(pre[pre.length - 1] + l)
  // Each lobe's share: how much of the original text it held (its area when
  // some lobe shows none).
  const weight = (s: Shape): number => (lobes.every((l) => l.ink > 0) ? s.ink : s.area)
  const total = lobes.reduce((a, s) => a + weight(s), 0)

  // Cut i (between lobe i and i+1) near where lobe i's share of the text ends.
  const ideal: number[] = []
  let acc = 0
  for (let i = 0; i < k - 1; i++) {
    acc += weight(lobes[i]) / total
    let best = 1
    for (let j = 1; j < units.length; j++) if (Math.abs(pre[j] - acc * pre[units.length]) < Math.abs(pre[best] - acc * pre[units.length])) best = j
    ideal.push(best)
  }
  const atEnds: number[][] = []
  const off = (cuts: number[]): number => cuts.reduce((a, c, i) => a + Math.abs(pre[c] - pre[ideal[i]]), 0)
  if (byWord) {
    const ends: number[] = []
    for (let j = 1; j < units.length; j++) if (SENTENCE_END.test(units[j - 1])) ends.push(j)
    const pick = (i: number, from: number, cur: number[]): void => {
      if (i === k - 1) atEnds.push(cur)
      else for (let e = from; e < ends.length && atEnds.length < 100; e++) pick(i + 1, e + 1, [...cur, ends[e]])
    }
    pick(0, 0, [])
    atEnds.sort((a, c) => off(a) - off(c))
  }
  const cands: number[][] = []
  const offs = [0, -1, 1, -2, 2]
  const build = (i: number, cur: number[]): void => {
    if (cands.length >= 200) return
    if (i === k - 1) {
      cands.push(cur)
      return
    }
    for (const o of offs) {
      const c = ideal[i] + o
      const prev = i ? cur[i - 1] : 0
      if (c > prev && c < units.length - (k - 2 - i)) build(i + 1, [...cur, c])
    }
  }
  build(0, [])

  const tryAt = (cs: number[][], fs: number, breakWords: boolean): Layout[] | null => {
    for (const cuts of cs) {
      const bounds = [0, ...cuts, units.length]
      const out: Layout[] = []
      for (let i = 0; i < k; i++) {
        const lay = fitAt(ctx, units.slice(bounds[i], bounds[i + 1]).join(sep), lobes[i], fs, breakWords)
        if (!lay) break
        out.push(lay)
      }
      if (out.length === k) return out
    }
    return null
  }
  // Fitting is (close to) monotone in the font size → binary search it.
  const largest = (cs: number[][], breakWords: boolean): Layout[] | null => {
    let lo = minFont(b, lobes)
    let hi = targetFont(b)
    let best = tryAt(cs, lo, breakWords)
    if (!best) return null
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      const r = tryAt(cs, mid, breakWords)
      if (r) {
        best = r
        lo = mid
      } else hi = mid - 1
    }
    return best
  }
  const better = (pref: Layout[] | null, other: Layout[] | null, worth: number): Layout[] | null =>
    pref && (!other || pref[0].fs >= other[0].fs * worth) ? pref : other
  const bestOf = (cs: number[][]): Layout[] | null => (cs.length ? better(largest(cs, false), largest(cs, true), WHOLE_WORDS) : null)
  const fits = better(bestOf(atEnds), bestOf(cands), SENTENCE_CUTS)
  if (fits) return fits
  // No split fits at near the source's size: the closest one at that size, over
  // the outlines.
  const cuts = atEnds[0] ?? cands[0]
  if (!cuts) return null
  const bounds = [0, ...cuts, units.length]
  const fs = keep ?? keptFont(b, lobes)
  return lobes.map((s, i) => overflowAt(ctx, units.slice(bounds[i], bounds[i + 1]).join(sep), s, fs))
}

// Cutting at sentence ends is worth this much of the font size.
const SENTENCE_CUTS = 0.75

// A word that ends a sentence (or a line of dialogue).
const SENTENCE_END = /[.!?。！？♡♥~〜…」』)]$/

// Share of a block's box (sampled on a grid) that lies in a lobe.
function boxShare(s: Shape, b: TransBlock): number {
  let n = 0
  for (let i = 0; i < 10; i++)
    for (let j = 0; j < 10; j++) {
      const x = Math.round(b.x + (b.w * (i + 0.5)) / 10) - s.x0
      const y = Math.round(b.y + (b.h * (j + 0.5)) / 10) - s.y0
      if (x >= 0 && y >= 0 && x < s.w && y < s.h && s.inside[y * s.w + x]) n++
    }
  return n / 100
}

// A block's text sits in the lobe: its centre is in it, or a quarter of its box.
const sitsIn = (s: Shape, b: TransBlock): boolean => shapeHas(s, b) || boxShare(s, b) >= 0.25

// Distance from a point to a block's box (0 inside it).
function boxDist(b: TransBlock, x: number, y: number): number {
  const dx = Math.max(b.x - x, 0, x - (b.x + b.w))
  const dy = Math.max(b.y - y, 0, y - (b.y + b.h))
  return Math.hypot(dx, dy)
}

// The part of a lobe nearer to block `b`'s box than to any rival's — joined
// balloons whose necks are too wide to split still get one part per block, cut
// between where the original texts were. Ties (overlapping boxes) go to the
// nearer box centre.
function voronoiPart(s: Shape, b: TransBlock, rivals: TransBlock[]): Shape | null {
  const key = (o: TransBlock, x: number, y: number): number =>
    boxDist(o, x, y) * 1e4 + Math.hypot(x - (o.x + o.w / 2), y - (o.y + o.h / 2))
  const m = new Uint8Array(s.w * s.h)
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      if (!s.inside[y * s.w + x]) continue
      const X = s.x0 + x
      const Y = s.y0 + y
      const mine = key(b, X, Y)
      if (rivals.every((o) => mine <= key(o, X, Y))) m[y * s.w + x] = 1
    }
  return makeShape(s.x0, s.y0, s.w, s.h, m, s.inkMask, s.fill)
}

// A paragraph's part plus the paragraph's own box: the source text stood there,
// so it's room for the translation even where the fill test lost it (a
// see-through balloon showing the art behind).
function withBox(s: Shape | null, p: TransBlock): Shape | null {
  if (!s) return null
  const m = s.inside.slice()
  for (let y = Math.max(0, Math.floor(p.y) - s.y0); y < Math.min(s.h, Math.ceil(p.y + p.h) - s.y0); y++)
    for (let x = Math.max(0, Math.floor(p.x) - s.x0); x < Math.min(s.w, Math.ceil(p.x + p.w) - s.x0); x++) m[y * s.w + x] = 1
  return makeShape(s.x0, s.y0, s.w, s.h, m, s.inkMask, s.fill)
}

// The translation goes at about the source text's size: the OCR's glyph size when
// it has one, else an estimate from the box and its character count. Smaller only
// when it won't fit.
const SIZE_K = 1
function targetFont(b: TransBlock): number {
  if (b.size) return Math.round(Math.max(10, Math.min(72, b.size * SIZE_K)))
  return maxFontFor(b)
}

// Where a block's translation goes: the lobes holding its text (at least
// MIN_SHARE of it; only its own part of a lobe other blocks' text is in too), in
// reading order. Several of its source paragraphs in one part (joined balloons
// too wide-necked to split by shape, boxed by the OCR as one block) → one part
// per paragraph. Empty → keep to the OCR box (the text sits on the art).
const MIN_SHARE = 0.15
const HOME_SHARE = 0.25
function ownParts(b: TransBlock, mine: Shape[], holders: Map<Shape, TransBlock[]>): Shape[] {
  const parts = mine
    .map((s) => {
      const rivals = (holders.get(s) ?? []).filter((o) => o !== b)
      return rivals.length ? voronoiPart(s, b, rivals) : s
    })
    .filter((s): s is Shape => !!s)
  const all = (b.paras ?? []).map(([x, y, w, h]) => ({ x, y, w, h, text: '', tr: '' }))
  // Widely spaced lines come back as one paragraph per line — that's one
  // paragraph, not a chain of balloons: it takes two of several lines.
  const lines = b.size ? all.filter((p) => Math.min(p.w, p.h) >= b.size! * 1.6).length : all.length
  if (lines < 2) return parts.sort(readingOrder)
  return parts
    .flatMap((part) => {
      const paras = all.filter((p) => sitsIn(part, p))
      if (paras.length < 2) return [part]
      return paras
        .map((p) => withBox(voronoiPart(part, p, paras.filter((q) => q !== p)), p))
        .filter((s): s is Shape => !!s)
    })
    .sort(readingOrder)
}

// Manga reading order of two boxes: side by side (rows overlapping by half) →
// right to left; else top to bottom.
function boxOrder(a: TransBlock, b: TransBlock): number {
  const ov = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (ov > Math.min(a.h, b.h) * 0.5) return b.x + b.w - (a.x + a.w)
  return a.y - b.y
}

// Same speaker by colour: both unknown, or within this per channel.
const SAME_INK = 48
const sameInk = (a: RGB | null, b: RGB | null): boolean =>
  a === null || b === null ? a === b : Math.max(...a.map((v, c) => Math.abs(v - b[c]))) <= SAME_INK

// Translation layouts for a block: split over its parts, else in the part that
// fits it largest, else the OCR box. `keep`: the size to run over the outline
// at when it fits nowhere (default: its own).
function layoutFor(ctx: CanvasRenderingContext2D, b: TransBlock, text: string, parts: Shape[], keep?: number): Layout[] {
  // The room the editor's box was moved to: there, at its size, smaller to fit.
  if (b.room) {
    const [x, y, w, h] = b.room
    return [layoutInBox(ctx, { ...b, x, y, w, h }, text, targetFont(b), minFont(b))]
  }
  if (parts.length > 1) {
    const lays = layoutSplit(ctx, b, text, parts, keep)
    if (lays) return lays
  }
  const big = [...parts].sort((p, q) => q.area - p.area)[0]
  if (big) return [layoutInShape(ctx, b, text, big, keep)]
  return [b.bg ? layoutInBox(ctx, b, text) : layoutInBox(ctx, b, text, targetFont(b), minFont(b))]
}

// One font is one size, but the OCR measures each block's apart (its lines'
// median thickness — off by a quarter either way): sizes within SAME_FONT of
// their neighbours are taken as one font, at the group's median.
const SAME_FONT = 1.3
function pageSizes<K>(own: Map<K, number>): Map<K, number> {
  const sized = [...own].sort((p, q) => p[1] - q[1])
  const out = new Map<K, number>()
  for (let i = 0; i < sized.length; ) {
    let j = i + 1
    while (j < sized.length && sized[j][1] <= sized[j - 1][1] * SAME_FONT && sized[j][1] <= sized[i][1] * SAME_FONT ** 2) j++
    const group = sized.slice(i, j)
    const median = group[group.length >> 1][1]
    for (const [k] of group) out.set(k, median)
    i = j
  }
  return out
}

// The text a block draws: a manually edited block's translation as it is (empty
// = erase), an auto block's or else its source text.
const drawnText = (b: TransBlock): string => (b.bg || b.edited ? b.tr : b.tr || b.text)

// The room one speech's joined blocks were moved to in the editor (any of theirs).
const speechRoom = (group: Job[]): number[] | undefined => group.find((j) => j.b.room)?.b.room

// Every job's layouts, each block at its font's page-wide size (never over
// GROW_MAX × its own). One that doesn't fit at that size tries its own; fitting
// nowhere, it runs over its outline at the size the rest of its font fitted at
// (the median) if that's smaller — not at a bigger one of its own.
const GROW_MAX = 1.1
function layoutAll(ctx: CanvasRenderingContext2D, jobs: Job[]): Map<Job, Layout[]> {
  // Each block at its own size (the OCR's character pitch).
  const own = new Map<Job, number>()
  for (const j of jobs) {
    const s = j.b.size
    if (!j.b.bg && !j.into && s && !j.unit.style?.size) own.set(j, s)
  }
  // Lay a job out in its own font.
  const inFace = <T extends Layout | Layout[]>(j: Job, f: () => T): T => {
    face = faceOf(j.unit.style)
    try {
      const out = f()
      for (const l of Array.isArray(out) ? out : [out]) l.face = face
      return out
    } finally {
      face = DEFAULT_FACE
    }
  }
  const sizes = pageSizes(own)
  const mine = (j: Job): TransBlock => (own.has(j) ? { ...j.unit, size: own.get(j) } : j.unit)
  const as = (j: Job): TransBlock => {
    const s = sizes.get(j)
    return s ? { ...j.unit, size: Math.min(s, Math.round(own.get(j)! * GROW_MAX)) } : j.unit
  }
  const over = (ls: Layout[]): boolean => ls.some((l) => l.over)
  const out = new Map<Job, Layout[]>()
  for (const j of jobs) {
    if (j.into || !drawnText(j.unit)) continue
    let lays = inFace(j, () => layoutFor(ctx, as(j), drawnText(j.unit), j.parts))
    if (over(lays) && sizes.has(j)) lays = inFace(j, () => layoutFor(ctx, mine(j), drawnText(j.unit), j.parts))
    out.set(j, lays)
  }
  for (const [j, lays] of out) {
    if (!over(lays)) continue
    const font = sizes.get(j)
    const fitted = [...out]
      .filter(([o, ls]) => o !== j && font !== undefined && sizes.get(o) === font && !over(ls))
      .map(([, ls]) => ls[0].fs)
      .sort((p, q) => p - q)
    const keep = fitted[fitted.length >> 1]
    if (keep && keep < lays[0].fs) out.set(j, inFace(j, () => layoutFor(ctx, mine(j), drawnText(j.unit), j.parts, keep)))
  }
  // Text that doesn't fit its lobe takes room around it — but only room no
  // other block's parts or text hold: it moves aside rather than over them.
  // No room at its size → it shrinks into its lobe after all.
  const W = ctx.canvas.width
  const H = ctx.canvas.height
  const owner = new Uint16Array(W * H) // job index + 1 of the part a pixel is in
  jobs.forEach((j, k) => {
    for (const s of j.parts)
      for (let y = 0; y < s.h; y++)
        for (let x = 0; x < s.w; x++) if (s.inside[y * s.w + x]) owner[(s.y0 + y) * W + s.x0 + x] = k + 1
  })
  const placed: { k: number; r: Rect }[] = []
  jobs.forEach((j, k) => {
    for (const l of out.get(j) ?? []) if (!l.over) placed.push({ k, r: textRect(ctx, l) })
  })
  jobs.forEach((j, k) => {
    const lays = out.get(j)
    if (!lays || !over(lays)) return
    const free = (x: number, y: number): boolean => {
      const o = owner[y * W + x]
      return (!o || o === k + 1) && !placed.some((p) => p.k !== k && x >= p.r.x0 && y >= p.r.y0 && x < p.r.x0 + p.r.w && y < p.r.y0 + p.r.h)
    }
    const done = lays.map((l) =>
      l.over && l.shape ? inFace(j, () => claim(ctx, l.text ?? '', l.shape!, l.fs, free, W, H) ?? shrinkInto(ctx, l.text ?? '', l.shape!, l.fs) ?? l) : l
    )
    out.set(j, done)
    for (const l of done) placed.push({ k, r: textRect(ctx, l) })
  })
  return out
}

// The page rect a layout's lines cover (plus their halo).
function textRect(ctx: CanvasRenderingContext2D, l: Layout): Rect {
  ctx.font = fontAt(l.fs, l.face)
  const w = Math.max(0, ...l.lines.map((s) => ctx.measureText(s).width))
  const pad = l.fs * 0.15
  return { x0: Math.round(l.cx - w / 2 - pad), y0: Math.round(l.top - pad), w: Math.round(w + 2 * pad), h: Math.round(l.lines.length * lineH(l.fs) + 2 * pad) }
}

// `text` at `fs` in its lobe grown by up to 2 × fs over `free` page pixels —
// widening step by step, so it takes no more room past the lobe than it needs.
function claim(
  ctx: CanvasRenderingContext2D,
  text: string,
  s: Shape,
  fs: number,
  free: (x: number, y: number) => boolean,
  W: number,
  H: number
): Layout | null {
  for (const k of [0.25, 0.5, 1, 1.5, 2]) {
    const g = Math.round(fs * k)
    const x0 = Math.max(0, s.x0 - g)
    const y0 = Math.max(0, s.y0 - g)
    const w = Math.min(W, s.x0 + s.w + g) - x0
    const h = Math.min(H, s.y0 + s.h + g) - y0
    const m = new Uint8Array(w * h)
    const allow = new Uint8Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const sx = x0 + x - s.x0
        const sy = y0 + y - s.y0
        if (sx >= 0 && sy >= 0 && sx < s.w && sy < s.h && s.inside[sy * s.w + sx]) m[y * w + x] = 1
        allow[y * w + x] = free(x0 + x, y0 + y) ? 1 : 0
      }
    grow(m, w, h, g, allow)
    const room = makeShape(x0, y0, w, h, m, new Uint8Array(w * h), s.fill)
    const lay = room && (fitAt(ctx, text, room, fs, false) ?? fitAt(ctx, text, room, fs, true))
    if (lay) return { ...lay, fill: s.fill, over: true }
  }
  return null
}

// `text` in its lobe after all, at the largest size under `fs` that fits.
function shrinkInto(ctx: CanvasRenderingContext2D, text: string, s: Shape, fs: number): Layout | null {
  for (let f = fs - 1; f >= 9; f--) {
    const lay = fitAt(ctx, text, s, f, false) ?? fitAt(ctx, text, s, f, true)
    if (lay) return lay
  }
  return null
}

// The source text's colour (speakers can be told apart by it alone): the most
// common colour of its glyph pixels well off the colour under them (the glyphs'
// halo or outline in that colour drops out) — of the farthest 15% of those, the
// strokes' cores rather than their anti-aliased edges. null: too few to tell.
function glyphColour(d: Uint8ClampedArray, ink: number[], bg: RGB): RGB | null {
  const off = ink.map((i) => ({ i, dist: chDist(d, i * 4, bg) })).filter((p) => p.dist > 60)
  if (off.length < 20) return null
  off.sort((p, q) => q.dist - p.dist)
  return dominant(
    d,
    off.slice(0, Math.max(20, Math.round(off.length * 0.15))).map((p) => p.i)
  )
}

// Draw the laid-out lines centred, each in its text's colours (`paintAt(line)`;
// no ink → dark or light against the background), with a halo for readability:
// the text's own outline colour when it has one; else on the art the opposite
// shade of the text (the art under it varies — the text keeps one look), in a
// balloon the background's colour when the text stands out from it, else the
// opposite shade.
function drawText(ctx: CanvasRenderingContext2D, lay: Layout, bg: RGB, paintAt: (line: number) => Paint, onArt = false): void {
  ctx.font = fontAt(lay.fs, lay.face)
  const lh = lineH(lay.fs)
  const dark = luminance(bg) > 140 // light background → dark text
  // Each line centred on its body; trailing punctuation hangs past it.
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.lineJoin = 'round'
  // Text running over its outline stays on the page.
  const half = Math.max(0, ...lay.lines.map((l) => ctx.measureText(l).width)) / 2 + lay.fs * 0.1
  const cx = Math.max(half, Math.min(ctx.canvas.width - half, lay.cx))
  let y = Math.max(0, Math.min(ctx.canvas.height - lay.lines.length * lh, lay.top))
  lay.lines.forEach((line, k) => {
    const { ink, halo: own } = paintAt(k)
    const fill: RGB = ink ?? (dark ? [20, 20, 20] : [244, 244, 244])
    const opposite: RGB = luminance(fill) > 140 ? [0, 0, 0] : [255, 255, 255]
    const halo = own ?? (onArt ? opposite : Math.abs(luminance(fill) - luminance(bg)) >= 60 ? bg : opposite)
    const x = cx - bodyWidth(ctx, line) / 2
    ctx.lineWidth = Math.max(1.5, lay.fs * (own || onArt ? 0.2 : 0.14))
    ctx.strokeStyle = `rgba(${halo[0]},${halo[1]},${halo[2]},${own ? 1 : 0.85})`
    ctx.strokeText(line, x, y)
    ctx.fillStyle = rgbToHex(fill)
    ctx.fillText(line, x, y)
    y += lh
  })
}

// Which paragraph of `text` each of its laid-out lines is from (the wrap keeps
// every non-space character, in order).
function lineParas(lines: string[], text: string): number[] {
  const left = text.split('\n').map((p) => p.replace(/\s/g, '').length)
  let k = 0
  return lines.map((l) => {
    while (k < left.length - 1 && left[k] <= 0) k++
    left[k] -= l.replace(/\s/g, '').length
    return k
  })
}

// ── Text on the art (no balloon) ─────────────────────────────────────────────

// The colours of a block's text, read off its glyphs alone (the art next to
// them has every colour), and whether it has an outline of its own — the mark
// of text set on the art: a band of one colour round the glyphs with other
// colours past it (a balloon's fill goes on past it). Robust to a mask a little
// off the glyphs (it may take the outline in, or miss the strokes' edges):
//   - the masked pixels' commonest colour, and the commonest of the rest when
//     enough are off it: ink and outline/ground in some order;
//   - the outer of the two is the ground when one goes on past the text (the
//     ring beyond, `reach`..2 × `reach` out, is clearly more it), else the one
//     less deep in the glyphs (nearer the mask's edge): the outline round the ink;
//   - one colour only: the ink; the ring's commonest colour off it, if most of
//     the ring is it, is the outline/ground;
//   - the outer colour is the text's own outline (drawn as its halo) unless
//     it's that ground.
// null ink: too few glyph pixels, or no one colour among them.
const OUTLINE_REACH = 0.25 // an outline's width at most, of the glyph size
const PAINT_SECOND = 0.15 // of the masked pixels, off the commonest colour
const PAINT_AGREE = 0.4
const GROUND_APART = 0.15 // of the ring beyond: one colour this much more of it is the ground
interface TextPaint extends Paint {
  rim: RGB | null // the colour round the ink (outline, or the ground right there)
}
function textPaint(d: Uint8ClampedArray, W: number, H: number, tm: TextMask | undefined, b: TransBlock): TextPaint {
  const none = { ink: null, halo: null, rim: null }
  if (!tm) return none
  const reach = Math.max(2, Math.round((b.size ?? Math.min(b.w, b.h)) * OUTLINE_REACH))
  const x0 = Math.max(0, Math.floor(b.x) - 2 * reach)
  const y0 = Math.max(0, Math.floor(b.y) - 2 * reach)
  const w = Math.min(W, Math.ceil(b.x + b.w) + 2 * reach) - x0
  const h = Math.min(H, Math.ceil(b.y + b.h) + 2 * reach) - y0
  const n = w * h
  const page = (i: number): number => (y0 + Math.floor(i / w)) * W + x0 + (i % w)
  const m = new Uint8Array(n)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const X = x0 + x
      const Y = y0 + y
      if (X >= b.x && Y >= b.y && X < b.x + b.w && Y < b.y + b.h && maskAt(tm, X, Y)) m[y * w + x] = 1
    }
  const masked: number[] = []
  for (let i = 0; i < n; i++) if (m[i]) masked.push(page(i))
  if (masked.length < 20) return none
  const near1 = m.slice()
  grow(near1, w, h, 1, null)
  const near = near1.slice()
  grow(near, w, h, reach, null)
  const far = near.slice()
  grow(far, w, h, reach, null)
  const ring: number[] = []
  const beyond: number[] = []
  for (let i = 0; i < n; i++) {
    if (near[i] && !near1[i]) ring.push(page(i))
    else if (far[i] && !near[i]) beyond.push(page(i))
  }
  const share = (idx: number[], c: RGB): number => (idx.length ? idx.filter((i) => nearText(d, i * 4, c)).length / idx.length : 0)
  const a = dominant(d, masked)
  const rest = masked.filter((i) => !nearText(d, i * 4, a))
  let ink: RGB
  let outer: RGB | null = null
  if (rest.length >= masked.length * PAINT_SECOND && rest.length >= 20) {
    const c = dominant(d, rest)
    // The ink lies deeper in the glyphs than their outline: the one whose
    // pixels are on average farther from the mask's edge.
    const depth = new Uint16Array(n)
    for (let i = 0; i < n; i++) if (near1[i]) depth[i] = 0xffff
    const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : depth[y * w + x])
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (depth[y * w + x]) depth[y * w + x] = Math.min(depth[y * w + x], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1, at(x + 1, y - 1) + 1)
    for (let y = h - 1; y >= 0; y--)
      for (let x = w - 1; x >= 0; x--)
        if (depth[y * w + x]) depth[y * w + x] = Math.min(depth[y * w + x], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1, at(x - 1, y + 1) + 1)
    const mean = (col: RGB): number => {
      let sum = 0
      let k = 0
      for (let i = 0; i < n; i++)
        if (near1[i] && nearText(d, page(i) * 4, col)) {
          sum += depth[i]
          k++
        }
      return k ? sum / k : 0
    }
    // The ground the text sits on goes on past it, an outline doesn't: the one
    // clearly more of the ring beyond is outer.
    const ba = share(beyond, a)
    const bc = share(beyond, c)
    const outerA = Math.abs(ba - bc) >= GROUND_APART ? ba > bc : mean(a) < mean(c)
    ink = outerA ? c : a
    outer = outerA ? a : c
  } else {
    ink = a
    const off = ring.filter((i) => !nearText(d, i * 4, a))
    const c = off.length >= 20 ? dominant(d, off) : null
    if (c && share(off, c) >= PAINT_AGREE) outer = c
  }
  if (share(masked, ink) < PAINT_AGREE * (outer ? 0.5 : 1)) return none
  if (!outer || Math.abs(luminance(outer) - luminance(ink)) < 60) return { ink, halo: null, rim: null }
  return { ink, halo: share(beyond, outer) < 0.5 ? outer : null, rim: outer }
}

// The text colours seen per page of a work (page URL's folder), pooled: one
// colour of text in a work is drawn as one colour, whatever it was measured
// against (a glyph's blended edges pull its measure toward the colour under it).
const inksSeen = new Map<string, Map<string, RGB[]>>()
// Each colour as its group's per-channel median (groups: colours within
// SAME_INK of the group's first, darkest first), over the work's pages so far.
function settleInks(page: string, cs: (RGB | null)[]): (RGB | null)[] {
  const found = cs.filter((c): c is RGB => c !== null)
  const work = page.slice(0, page.lastIndexOf('/') + 1)
  let pages = inksSeen.get(work)
  if (!pages) inksSeen.set(work, (pages = new Map()))
  if (page) pages.set(page, found)
  const all = (page ? [...pages.values()].flat() : found).sort((p, q) => luminance(p) - luminance(q) || p[0] - q[0] || p[1] - q[1])
  const groups: RGB[][] = []
  for (const c of all) {
    const g = groups.find((g) => sameInk(g[0], c))
    if (g) g.push(c)
    else groups.push([c])
  }
  const median = (g: RGB[]): RGB => [0, 1, 2].map((k) => g.map((c) => c[k]).sort((p, q) => p - q)[g.length >> 1]) as RGB
  return cs.map((c) => {
    if (!c) return c
    const g = groups.find((g) => g.includes(c)) ?? groups.find((g) => sameInk(g[0], c))
    return g ? median(g) : c
  })
}

// Text on the art has no balloon to fill: its room is where the source text
// stood — its lines (columns) and the gaps between them — so the translation
// hides no more of the art than the source did. Blocks side by side (lines
// within ROOM_GAP ems, overlapping by ROOM_OVERLAP) share one room, laid out
// across it; each block's text a paragraph of its own (another speaker, another
// line), in reading order, in its own colours. The first block draws them all.
// Not fitting at 85% of its size, it takes room past it (`claim`), as text
// running over a balloon does, rather than getting smaller still.
// ROOM_GAP is the gap across lines (column beside column); along them (one
// block's columns ending above the next's) only ROOM_RUN — that is two
// balloons stacked, not one speech (4087000 p.2: 2.5 em apart, joined).
const ROOM_OVERLAP = 0.3
const ROOM_GAP = 2.5
const ROOM_RUN = 1
function artRooms(jobs: Job[]): void {
  const rects = (j: Job): Rect[] => (j.b.cols ?? [[j.b.x, j.b.y, j.b.w, j.b.h]]).map(([x, y, w, h]) => ({ x0: x, y0: y, w, h }))
  const em = (j: Job): number => j.b.size ?? Math.min(j.b.w, j.b.h)
  // Lines run top to bottom (Japanese columns) when they are taller than wide.
  const upright = (j: Job): boolean => {
    const rs = rects(j)
    return rs.reduce((s, r) => s + r.h, 0) > rs.reduce((s, r) => s + r.w, 0)
  }
  const side = (a: Rect, b: Rect, e: number, up: boolean | null): boolean => {
    const gx = Math.max(b.x0 - (a.x0 + a.w), a.x0 - (b.x0 + b.w))
    const gy = Math.max(b.y0 - (a.y0 + a.h), a.y0 - (b.y0 + b.h))
    return (
      (gx <= e * (up === false ? ROOM_RUN : ROOM_GAP) && -gy >= ROOM_OVERLAP * Math.min(a.h, b.h)) ||
      (gy <= e * (up === true ? ROOM_RUN : ROOM_GAP) && -gx >= ROOM_OVERLAP * Math.min(a.w, b.w))
    )
  }
  const parent = jobs.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let a = 0; a < jobs.length; a++)
    for (let b = a + 1; b < jobs.length; b++) {
      const e = Math.max(em(jobs[a]), em(jobs[b]))
      const up = upright(jobs[a]) === upright(jobs[b]) ? upright(jobs[a]) : null
      if (rects(jobs[a]).some((ra) => rects(jobs[b]).some((rb) => side(ra, rb, e, up)))) parent[find(a)] = find(b)
    }
  const groups = new Map<number, Job[]>()
  jobs.forEach((j, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), j]))
  for (const group of groups.values()) {
    group.sort((p, q) => boxOrder(p.b, q.b))
    const rs = group.flatMap(rects)
    const e = Math.max(...group.map(em))
    const x0 = Math.floor(Math.min(...rs.map((r) => r.x0)))
    const y0 = Math.floor(Math.min(...rs.map((r) => r.y0)))
    const w = Math.ceil(Math.max(...rs.map((r) => r.x0 + r.w))) - x0
    const h = Math.ceil(Math.max(...rs.map((r) => r.y0 + r.h))) - y0
    if (w < 2 || h < 2) continue
    const inside = new Uint8Array(w * h)
    for (const r of rs)
      for (let y = Math.max(0, Math.floor(r.y0) - y0); y < Math.min(h, Math.ceil(r.y0 + r.h) - y0); y++)
        for (let x = Math.max(0, Math.floor(r.x0) - x0); x < Math.min(w, Math.ceil(r.x0 + r.w) - x0); x++) inside[y * w + x] = 1
    bridge(inside, w, h, Math.round(e * ROOM_GAP))
    const [lead, ...rest] = group
    const room = makeShape(x0, y0, w, h, inside, new Uint8Array(w * h), lead.bg)
    if (!room) continue
    room.room = true
    const sizes = group.map((j) => j.b.size).filter((v): v is number => !!v).sort((p, q) => p - q)
    lead.unit = {
      ...lead.b,
      x: x0,
      y: y0,
      w,
      h,
      text: group.map((j) => j.b.text).join('\n'),
      tr: group.map((j) => drawnText(j.b)).join('\n'),
      size: sizes.length ? sizes[sizes.length >> 1] : undefined,
      paras: undefined,
      cols: undefined,
      room: speechRoom(group)
    }
    lead.parts = [room]
    lead.paints = group.map((j) => ({ ink: j.ink, halo: j.halo }))
    for (const j of rest) {
      j.into = lead
      j.parts = []
    }
  }
}

// Fill the gaps of up to `max` px between marked runs, along rows and columns.
function bridge(m: Uint8Array, w: number, h: number, max: number): void {
  const pass = (n: number, len: number, at: (k: number, t: number) => number): void => {
    for (let k = 0; k < n; k++) {
      let last = -1
      for (let t = 0; t < len; t++) {
        if (!m[at(k, t)]) continue
        if (last >= 0 && t - last - 1 <= max) for (let u = last + 1; u < t; u++) m[at(k, u)] = 1
        last = t
      }
    }
  }
  pass(h, w, (y, x) => y * w + x)
  pass(w, h, (x, y) => y * w + x)
}

// A text's colours: its fill (null: dark or light against the ground) and its
// outline (null: none of its own).
interface Paint {
  ink: RGB | null
  halo: RGB | null
}

// One block to draw: its colour on the art (sampled, or the editor's), the bubble
// parts it owns (empty → lay out in the OCR box) and, for a manual block, the
// bubble its box sits in (painted flat).
interface Job {
  b: TransBlock
  // What it lays out: its block, or the blocks of one speech in one lobe joined
  // (their boxes' union, their texts in reading order).
  unit: TransBlock
  into?: Job // joined into another block's speech: draws nothing itself
  i: number
  bg: RGB
  ink: RGB | null // the source text's colour
  halo: RGB | null // its outline's colour, when it has one (text on the art)
  rim: RGB | null // on the art: the colour round its ink (its outline, or the ground)
  // Per paragraph of a room's joined text (several blocks on the art): each
  // block's own colours.
  paints?: Paint[]
  parts: Shape[]
  bubble: Bubble | null // the bubble most of its text is in
  bubbles: Set<Bubble> // the bubbles its parts are in
  onArt?: boolean // a document's block: on the art (else: !bubble)
  // A document's job: where each block's translation starts in the unit's text.
  segs?: { b: TransBlock; start: number }[]
}

// The blocks to draw (SFX skipped), the page's bubbles and which parts of them
// each block's translation goes in, looked at on the clean page.
function planJobs(
  ctx: CanvasRenderingContext2D,
  res: TransResult,
  W: number,
  H: number,
  page = ''
): { jobs: Job[]; bubbles: Bubble[]; kept: TransBlock[] } {
  const live: { b: TransBlock; i: number }[] = []
  res.blocks.forEach((b, i) => {
    if (b.w <= 0 || b.h <= 0) return
    // A block touched in the editor is an explicit "draw this" — only auto blocks
    // get the SFX/onomatopoeia skip.
    if (!b.bg && !b.edited && !b.room && isSfx(b, W, H)) return
    live.push({ b, i })
  })
  const d = ctx.getImageData(0, 0, W, H).data
  const inks = live.map(({ b }) => blockInk(res.mask, b, W, H))
  const bubbles = findBubbles(
    d,
    W,
    H,
    live.map((l) => l.b),
    inks,
    res.mask,
    page
  )
  const lobes = bubbles.flatMap((bb) => bb.lobes)
  // How much of a block's text a lobe (or bubble) holds.
  const share = (m: Uint8Array, r: Rect, k: number): number =>
    shareIn(m, r, W, inks[k].length >= 20 ? inks[k] : boxGrid(live[k].b, W, H))
  const jobs: Job[] = live.map(({ b, i }, k) => {
    // The bubble holding most of its text (a block the OCR boxed together with
    // a sound effect beside the balloon has only part of its text in it).
    let home: Bubble | null = null
    let best = HOME_SHARE
    for (const bb of bubbles) {
      const s = share(bb.inside, bb, k)
      if (s >= best) {
        best = s
        home = bb
      }
    }
    // A manual block keeps the box the editor placed.
    const mine = b.bg || !home ? [] : lobes.filter((s) => share(s.inside, s, k) >= MIN_SHARE)
    const bg = b.bg ? hexToRgb(b.bg) : (mine[0]?.fill ?? sampleBg(ctx, b, W, H))
    // In a balloon, the glyphs' colour off its fill; on the art (the colour
    // around the glyphs is the art's), read off the glyphs alone.
    const paint = home || b.bg ? null : textPaint(d, W, H, res.mask, b)
    const ink = home ? glyphColour(d, inks[k], b.bg ? bg : home.fill) : (paint?.ink ?? null)
    return {
      b,
      unit: b,
      i,
      bg,
      ink,
      halo: paint?.halo ?? null,
      rim: paint?.rim ?? null,
      parts: mine,
      bubble: home,
      bubbles: new Set(bubbles.filter((bb) => mine.some((s) => bb.lobes.includes(s))))
    }
  })
  // Blocks whose text is all in one lobe, in one colour, are one speech the OCR
  // boxed in pieces: the first in reading order draws their texts joined over
  // the lobe. (Another colour is another speaker: they share the lobe.)
  const byLobe = new Map<Shape, Job[]>()
  for (const j of jobs) if (j.parts.length === 1 && !j.b.bg) byLobe.set(j.parts[0], [...(byLobe.get(j.parts[0]) ?? []), j])
  for (const group of byLobe.values()) {
    const speeches: Job[][] = []
    for (const j of group) {
      const same = speeches.find((s) => sameInk(s[0].ink, j.ink))
      if (same) same.push(j)
      else speeches.push([j])
    }
    for (const speech of speeches) {
      if (speech.length < 2) continue
      speech.sort((p, q) => boxOrder(p.b, q.b))
      const [lead, ...rest] = speech
      const x0 = Math.min(...speech.map((j) => j.b.x))
      const y0 = Math.min(...speech.map((j) => j.b.y))
      lead.unit = {
        ...lead.b,
        x: x0,
        y: y0,
        w: Math.max(...speech.map((j) => j.b.x + j.b.w)) - x0,
        h: Math.max(...speech.map((j) => j.b.y + j.b.h)) - y0,
        text: speech.map((j) => j.b.text).join(''),
        tr: speech.map((j) => drawnText(j.b)).filter(Boolean).join(' '),
        paras: undefined,
        room: speechRoom(speech)
      }
      for (const j of rest) {
        j.into = lead
        j.parts = []
      }
    }
  }
  const holders = new Map<Shape, TransBlock[]>()
  for (const j of jobs) for (const s of j.parts) holders.set(s, [...(holders.get(s) ?? []), j.unit])
  // Text left as it is (SFX) still holds its part of a lobe: a balloon joined
  // to the one a block's text is in isn't room for that block.
  const kept = res.blocks.filter((b) => b.w > 0 && b.h > 0 && !live.some((l) => l.b === b))
  for (const s of holders.keys())
    for (const b of kept) if (sitsIn(s, b)) holders.set(s, [...holders.get(s)!, b])
  for (const j of jobs) j.parts = ownParts(j.unit, j.parts, holders)
  // One colour of text is one colour throughout the work.
  const settled = settleInks(page, [...jobs.map((j) => j.ink), ...jobs.map((j) => j.halo)])
  jobs.forEach((j, k) => {
    j.ink = settled[k]
    j.halo = settled[jobs.length + k]
  })
  // A colour set in the editor wins (its outline then follows the usual rule).
  for (const j of jobs)
    if (j.b.ink) {
      j.ink = hexToRgb(j.b.ink)
      j.halo = null
    }
  artRooms(jobs.filter((j) => !j.bubble && !j.b.bg))
  return { jobs, bubbles, kept }
}

// Erase every block's source text: balloon text with its balloon's fill, the
// rest rebuilt from the art round it (`heal`: the inpainting model's page).
function eraseAll(
  ctx: CanvasRenderingContext2D,
  jobs: Job[],
  bubbles: Bubble[],
  kept: TransBlock[],
  tm: TextMask | undefined,
  W: number,
  H: number,
  heal: Healed | null
): void {
  const all = [...jobs.map((j) => j.b), ...kept]
  for (const j of jobs) {
    if (j.b.bg && j.bubble) paintBubble(ctx, j.bubble, j.bg)
    else if (!j.bubble || (!j.parts.length && !j.into))
      eraseOnArt(ctx, j.b.bg ? j.b : maskReach(tm, j.b, all, W, H), j.b.bg ? j.bg : null, tm, W, H, j.ink, j.rim)
  }
  // The inpainting model's page over those erases (and a little round them).
  if (heal) {
    const img = ctx.getImageData(0, 0, W, H)
    for (let g = 0; g < W * H; g++) if (heal.mask[g]) for (let c = 0; c < 3; c++) img.data[g * 4 + c] = heal.data[g * 4 + c]
    ctx.putImageData(img, 0, 0)
  }
  for (const bb of bubbles) {
    // Each box's part in this bubble's rect (a box running past it onto a sound
    // effect beside the balloon erases only its balloon part).
    const boxes = jobs
      .filter((j) => !j.b.bg && j.bubbles.has(bb))
      .map((j) => {
        const x0 = Math.max(j.b.x, bb.x0)
        const y0 = Math.max(j.b.y, bb.y0)
        return { ...j.b, x: x0, y: y0, w: Math.min(j.b.x + j.b.w, bb.x0 + bb.w) - x0, h: Math.min(j.b.y + j.b.h, bb.y0 + bb.h) - y0 }
      })
      .filter((b) => b.w > 0 && b.h > 0)
    if (boxes.length) eraseBubble(ctx, bb, boxes, kept, tm)
  }
}

// A block's box grown to the text mask's strokes that run on past it: the
// detector's box can stop a few glyphs short of a column's end (a big bold line,
// "!!") while its mask goes on. Mask strokes within REACH_GAP ems of each other
// are one run; the runs that start in the box are followed up to REACH_MAX ems
// past it, never into another block's box.
const REACH_GAP = 0.6
const REACH_MAX = 4
function maskReach(tm: TextMask | undefined, b: TransBlock, others: TransBlock[], W: number, H: number): TransBlock {
  if (!tm) return b
  const em = b.size ?? Math.min(b.w, b.h)
  const far = em * REACH_MAX
  const x0 = Math.max(0, Math.floor(b.x - far))
  const y0 = Math.max(0, Math.floor(b.y - far))
  const w = Math.min(W, Math.ceil(b.x + b.w + far)) - x0
  const h = Math.min(H, Math.ceil(b.y + b.h + far)) - y0
  if (w < 2 || h < 2) return b
  // Each cell STEP page px square: masked if any page pixel in it is.
  const STEP = Math.max(1, Math.round(1 / tm.scale))
  const cw = Math.ceil(w / STEP)
  const ch = Math.ceil(h / STEP)
  const taken = (x: number, y: number): boolean =>
    others.some((o) => o !== b && x >= o.x && y >= o.y && x < o.x + o.w && y < o.y + o.h)
  const m = new Uint8Array(cw * ch)
  for (let cy = 0; cy < ch; cy++)
    for (let cx = 0; cx < cw; cx++) {
      const px = x0 + cx * STEP + (STEP >> 1)
      const py = y0 + cy * STEP + (STEP >> 1)
      if (px < W && py < H && maskAt(tm, px, py) && !taken(px, py)) m[cy * cw + cx] = 1
    }
  // Runs: the mask with its gaps closed.
  const joined = m.slice()
  grow(joined, cw, ch, Math.max(1, Math.round((em * REACH_GAP) / 2 / STEP)), null)
  const inBox = (cx: number, cy: number): boolean => {
    const px = x0 + cx * STEP
    const py = y0 + cy * STEP
    return px >= b.x && py >= b.y && px < b.x + b.w && py < b.y + b.h
  }
  const seen = new Uint8Array(cw * ch)
  const stack: number[] = []
  for (let cy = 0; cy < ch; cy++)
    for (let cx = 0; cx < cw; cx++) {
      const i = cy * cw + cx
      if (m[i] && inBox(cx, cy)) {
        seen[i] = 1
        stack.push(i)
      }
    }
  let [l, t, r, bt] = [b.x, b.y, b.x + b.w, b.y + b.h]
  while (stack.length) {
    const i = stack.pop()!
    const cx = i % cw
    const cy = (i - cx) / cw
    if (m[i]) {
      l = Math.min(l, x0 + cx * STEP)
      t = Math.min(t, y0 + cy * STEP)
      r = Math.max(r, x0 + (cx + 1) * STEP)
      bt = Math.max(bt, y0 + (cy + 1) * STEP)
    }
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const xx = cx + dx
        const yy = cy + dy
        if (xx < 0 || yy < 0 || xx >= cw || yy >= ch) continue
        const j = yy * cw + xx
        if (seen[j] || !joined[j]) continue
        seen[j] = 1
        stack.push(j)
      }
  }
  return l < b.x || t < b.y || r > b.x + b.w || bt > b.y + b.h ? { ...b, x: l, y: t, w: r - l, h: bt - t } : b
}

// The page's key for the work-wide text colours ('' for a page given as data).
const pageKey = (img: HTMLImageElement): string => (img.src.startsWith('data:') ? '' : img.src)

// ── Inpainting model (optional) ─────────────────────────────────────────────
// With the LaMa model downloaded (설정 › 번역), the art under erased text on the
// art is painted by it — line art and tones carried through — instead of
// fillIn's averaging. Balloons keep their flat fill. healPage finds those
// erases (the same erase run, recorded), sends patches round them, and returns
// the page with what came back; drawTranslation pastes it over its own fill.

// The page with the model's patches (`data`, RGBA) where `mask` is set.
export interface Healed {
  data: Uint8ClampedArray
  mask: Uint8Array
  W: number
  H: number
}

// While healPage measures: every erase on the art, into one page mask.
let erasing: { add: (r: Rect, mask: Uint8Array) => void } | null = null

const LAMA_SIDE = 512
const PATCH_MARGIN = 0.4 // art round an erase in a patch, × its longer side
const PATCH_MIN_MARGIN = 24
const HEALS_KEPT = 6
const HEAL_EDGE = 3
const healed = new Map<string, Promise<Healed | null>>()

// The model's page for this translation, or null (no model, nothing on the art,
// or it failed). Kept per page and blocks.
export async function healPage(img: HTMLImageElement, res: TransResult): Promise<Healed | null> {
  if (!res.ok || !res.blocks.length || !window.api?.lamaStatus) return null
  try {
    if (!(await window.api.lamaStatus()).installed) return null
  } catch {
    return null
  }
  const key = [img.src, res.mask?.w ?? 0, ...res.blocks.map((b) => [b.x, b.y, b.w, b.h, b.size, b.bg, !!(b.edited || b.room)].join())].join('\n')
  let p = healed.get(key)
  if (!p) {
    p = heal(img, res).catch((e) => {
      console.error('inpaint model failed', e)
      return null
    })
    healed.set(key, p)
    if (healed.size > HEALS_KEPT) healed.delete(healed.keys().next().value!)
  }
  return p
}

async function heal(img: HTMLImageElement, res: TransResult): Promise<Healed | null> {
  const { W, H } = canvasSize(img)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, W, H)
  const page = ctx.getImageData(0, 0, W, H)
  // The erases drawTranslation will make on the art.
  const holes = new Uint8Array(W * H)
  const rects: Rect[] = []
  erasing = {
    add: (r, mask) => {
      let x0 = r.w
      let y0 = r.h
      let x1 = -1
      let y1 = -1
      for (let y = 0; y < r.h; y++)
        for (let x = 0; x < r.w; x++) {
          if (!mask[y * r.w + x]) continue
          holes[(r.y0 + y) * W + r.x0 + x] = 1
          x0 = Math.min(x0, x)
          y0 = Math.min(y0, y)
          x1 = Math.max(x1, x)
          y1 = Math.max(y1, y)
        }
      if (x1 >= 0) rects.push({ x0: r.x0 + x0, y0: r.y0 + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 })
    }
  }
  try {
    const { jobs, bubbles, kept } = planJobs(ctx, res, W, H, pageKey(img))
    eraseAll(ctx, jobs, bubbles, kept, res.mask, W, H, null)
  } finally {
    erasing = null
  }
  if (!rects.length) return null
  ctx.putImageData(page, 0, 0)
  // A glow's last pixels can lie past the erase's box: HEAL_EDGE more all round.
  grow(holes, W, H, HEAL_EDGE, null)

  const out: Healed = { data: page.data.slice(), mask: new Uint8Array(W * H), W, H }
  await lamaInto(canvas, holes, rects, out)
  return out
}

// The model's painting of `holes` (patches round `rects`) on `canvas` into `out`.
async function lamaInto(canvas: HTMLCanvasElement, holes: Uint8Array, rects: Rect[], out: Healed): Promise<void> {
  const { W, H } = out
  const S = LAMA_SIDE
  const sq = document.createElement('canvas')
  sq.width = sq.height = S
  const sctx = sq.getContext('2d', { willReadFrequently: true })!
  const back = document.createElement('canvas')
  const bctx = back.getContext('2d', { willReadFrequently: true })!
  for (const p of patches(rects, W, H)) {
    sctx.drawImage(canvas, p.x0, p.y0, p.w, p.h, 0, 0, S, S)
    const px = sctx.getImageData(0, 0, S, S).data
    // A patch pixel is a hole if any page pixel under it is (then a pixel more,
    // for the resampling's blur).
    const m = new Uint8Array(S * S)
    const span = (v: number, len: number): [number, number] => {
      const a = Math.floor((v * S) / len)
      return [a, Math.max(a + 1, Math.ceil(((v + 1) * S) / len))]
    }
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        if (!holes[(p.y0 + y) * W + p.x0 + x]) continue
        const [ty0, ty1] = span(y, p.h)
        const [tx0, tx1] = span(x, p.w)
        for (let ty = ty0; ty < ty1; ty++) for (let tx = tx0; tx < tx1; tx++) m[ty * S + tx] = 1
      }
    grow(m, S, S, 1, null)
    const rgb = new Uint8Array(S * S * 3)
    for (let i = 0; i < S * S; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = px[i * 4 + c]
    const painted = await window.api.lamaPatch(rgb, m)
    if (!painted) continue
    const done = sctx.createImageData(S, S)
    for (let i = 0; i < S * S; i++) {
      for (let c = 0; c < 3; c++) done.data[i * 4 + c] = painted[i * 3 + c]
      done.data[i * 4 + 3] = 255
    }
    sctx.putImageData(done, 0, 0)
    back.width = p.w
    back.height = p.h
    bctx.drawImage(sq, 0, 0, S, S, 0, 0, p.w, p.h)
    const got = bctx.getImageData(0, 0, p.w, p.h).data
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const g = (p.y0 + y) * W + p.x0 + x
        if (!holes[g] || out.mask[g]) continue
        for (let c = 0; c < 3; c++) out.data[g * 4 + c] = got[(y * p.w + x) * 4 + c]
        out.mask[g] = 1
      }
  }
}

// The editor's 자동 인페인팅 over the user's selection (a sound effect, say):
// every selected pixel painted from round it — by the model when installed,
// else the built-in fill. `rects`: the selections' boxes (the model's patches).
export async function fillSelection(page: ImageData, holes: Uint8Array, rects: Rect[]): Promise<ImageData> {
  const { width: W, height: H } = page
  const out = new ImageData(page.data.slice(), W, H)
  let lama = false
  try {
    lama = !!window.api?.lamaStatus && (await window.api.lamaStatus()).installed
  } catch {
    /* no model */
  }
  if (lama) {
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    canvas.getContext('2d', { willReadFrequently: true })!.putImageData(page, 0, 0)
    const healed: Healed = { data: out.data, mask: new Uint8Array(W * H), W, H }
    try {
      await lamaInto(canvas, holes, rects, healed)
    } catch (e) {
      console.error('inpaint model failed', e)
    }
    // What the model didn't paint (a failed patch): the built-in fill.
    const rest = new Uint8Array(W * H)
    let left = false
    for (let i = 0; i < rest.length; i++)
      if (holes[i] && !healed.mask[i]) {
        rest[i] = 1
        left = true
      }
    if (left) fillIn(out.data, rest, W, H)
  } else fillIn(out.data, holes, W, H)
  return out
}

// Square patches round the erases (with PATCH_MARGIN of art for context, and
// LAMA_SIDE at least), the ones that overlap merged, kept inside the page.
function patches(rects: Rect[], W: number, H: number): Rect[] {
  const box = (r: Rect): Rect => {
    const side = Math.max(r.w, r.h)
    // At least the model's own size: a small erase is painted at full detail.
    const s = Math.max(LAMA_SIDE, Math.round(side + 2 * Math.max(PATCH_MIN_MARGIN, side * PATCH_MARGIN)))
    const w = Math.min(W, Math.max(s, r.w))
    const h = Math.min(H, Math.max(s, r.h))
    const x0 = Math.max(0, Math.min(W - w, Math.round(r.x0 + r.w / 2 - w / 2)))
    const y0 = Math.max(0, Math.min(H - h, Math.round(r.y0 + r.h / 2 - h / 2)))
    return { x0, y0, w, h }
  }
  let ps = rects.map(box)
  for (let merged = true; merged; ) {
    merged = false
    for (let a = 0; a < ps.length && !merged; a++)
      for (let b = a + 1; b < ps.length && !merged; b++) {
        const p = ps[a]
        const q = ps[b]
        if (p.x0 >= q.x0 + q.w || q.x0 >= p.x0 + p.w || p.y0 >= q.y0 + q.h || q.y0 >= p.y0 + p.h) continue
        const x0 = Math.min(p.x0, q.x0)
        const y0 = Math.min(p.y0, q.y0)
        const u = box({ x0, y0, w: Math.max(p.x0 + p.w, q.x0 + q.w) - x0, h: Math.max(p.y0 + p.h, q.y0 + q.h) - y0 })
        ps = [...ps.filter((_, k) => k !== a && k !== b), u]
        merged = true
      }
  }
  return ps
}

// Erase original text + typeset the translation for every block.
// How drawTranslation draws:
//   heal  — healPage's result for this page (null / left out: the built-in fill)
//   paint — the editor's painted layer, over the erased page, under the text
//   text  — draw the text on this canvas instead (transparent, page size), leaving
//           `canvas` the erased page alone (the editor's layers)
export interface DrawOpts {
  heal?: Healed | null
  paint?: CanvasImageSource | null
  text?: HTMLCanvasElement
}

// What drawTranslation drew, by block index: its text colour (hex), and the box
// its translation is in (the room it was typeset in: its balloon lobe(s), its room
// on the art, or the box the editor placed). `skip`: left as it is (a sound
// effect) — the OCR box. null: joined into the block `lead` names.
export interface DrawnBox {
  x: number
  y: number
  w: number
  h: number
  skip?: boolean
}
export interface Drawn {
  inks: string[]
  boxes: (DrawnBox | null)[]
  lead: number[]
}

export function drawTranslation(canvas: HTMLCanvasElement, img: HTMLImageElement, res: TransResult, opts: DrawOpts = {}): Drawn {
  const out: Drawn = { inks: [], boxes: res.blocks.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, skip: true })), lead: res.blocks.map((_, i) => i) }
  const { heal } = opts
  // Size the canvas to the sent (downscaled) image — the space the block coords
  // are actually in — replicating translate.ts's downscale exactly.
  const { W, H } = canvasSize(img)
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return out
  ctx.drawImage(img, 0, 0, W, H)

  if (DEBUG_BOXES) {
    console.log('[inpaint] canvas', W, 'x', H, 'blocks', res.blocks.length)
    console.table(
      res.blocks.map((b, i) => ({
        i,
        x: Math.round(b.x),
        y: Math.round(b.y),
        w: Math.round(b.w),
        h: Math.round(b.h),
        src: b.text.slice(0, 18),
        tr: b.tr.slice(0, 18)
      }))
    )
  }

  // Look at the clean page first (bubbles, fill colours), then erase everything,
  // then draw — so no erase wipes text already drawn.
  const { jobs, bubbles, kept } = planJobs(ctx, res, W, H, pageKey(img))
  eraseAll(ctx, jobs, bubbles, kept, res.mask, W, H, heal && heal.W === W && heal.H === H ? heal : null)

  // A manually edited block (bg set) has an authoritative translation: an empty
  // tr means "erase this bubble", so DON'T fall back to the source text (that would
  // repaint the original Japanese). Auto blocks still fall back when the engine
  // gave a box but no translation (`drawnText`).
  if (opts.paint) ctx.drawImage(opts.paint, 0, 0, W, H)
  let tctx = ctx
  if (opts.text) {
    opts.text.width = W
    opts.text.height = H
    tctx = opts.text.getContext('2d') ?? ctx
  }
  const layouts = layoutAll(ctx, jobs)
  const { inks } = out
  for (const job of jobs) {
    const { b, i, bg, ink, halo, paints } = job
    inks[i] = rgbToHex(ink ?? (luminance(bg) > 140 ? [20, 20, 20] : [244, 244, 244]))
    out.boxes[i] = job.into ? null : drawnBox(ctx, job, layouts.get(job) ?? [])
    if (job.into) out.lead[i] = job.into.i
    for (const lay of layouts.get(job) ?? []) {
      const paras = paints && lineParas(lay.lines, drawnText(job.unit))
      drawText(tctx, lay, lay.fill ?? bg, (k) => (paints && paras ? paints[paras[k]] : { ink, halo }), !job.bubble)
    }
    if (DEBUG_BOXES) {
      ctx.save()
      ctx.strokeStyle = 'rgba(255,0,0,0.9)'
      ctx.lineWidth = 2
      ctx.strokeRect(b.x, b.y, b.w, b.h)
      ctx.fillStyle = 'red'
      ctx.font = `bold 16px ${FONT}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(String(i), b.x + 2, b.y + 2)
      ctx.restore()
    }
  }
  return out
}

// The box a job's translation is in: the room it was placed in, the box of a
// manual block, else its parts with the text drawn (text can run past them).
function drawnBox(ctx: CanvasRenderingContext2D, job: Job, lays: Layout[]): DrawnBox {
  const { unit, b } = job
  if (unit.room) {
    const [x, y, w, h] = unit.room
    return { x, y, w, h }
  }
  if (b.bg) return { x: b.x, y: b.y, w: b.w, h: b.h }
  const rs: Rect[] = [...job.parts, ...lays.map((l) => textRect(ctx, l))]
  if (!rs.length) return { x: unit.x, y: unit.y, w: unit.w, h: unit.h }
  const x = Math.min(...rs.map((r) => r.x0))
  const y = Math.min(...rs.map((r) => r.y0))
  return { x, y, w: Math.max(...rs.map((r) => r.x0 + r.w)) - x, h: Math.max(...rs.map((r) => r.y0 + r.h)) - y }
}

// ── Editor documents (TransDoc) ──────────────────────────────────────────────
// The editor works in layers: bubble regions (where each translation goes),
// painted layers (the erase, the user's paint) and the text. The auto pass
// fills them once (`autoPage`); from then on the text is laid out from the
// regions alone (`drawDocText`) — moving a box or recolouring text redraws
// only the text, never the page analysis and erase (≈1 s a page).

// A mask (row-major, 1 = in) bit-packed (bit i&7 of byte i>>3) as base64.
export function packMask(m: Uint8Array): string {
  const bytes = new Uint8Array((m.length + 7) >> 3)
  for (let i = 0; i < m.length; i++) if (m[i]) bytes[i >> 3] |= 1 << (i & 7)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
export function unpackMask(bits: string, n: number): Uint8Array {
  const bin = atob(bits)
  const m = new Uint8Array(n)
  for (let i = 0; i < n; i++) if ((bin.charCodeAt(i >> 3) >> (i & 7)) & 1) m[i] = 1
  return m
}
const regionMasks = new WeakMap<TransRegion, Uint8Array>()
export function regionMask(r: TransRegion): Uint8Array {
  let m = regionMasks.get(r)
  if (!m) {
    m = unpackMask(r.bits, r.w * r.h)
    regionMasks.set(r, m)
  }
  return m
}
const regionShapes = new WeakMap<TransRegion, Shape | null>()
function regionShape(r: TransRegion): Shape | null {
  if (regionShapes.has(r)) return regionShapes.get(r)!
  const s = makeShape(r.x, r.y, r.w, r.h, regionMask(r), new Uint8Array(r.w * r.h), r.fill ? hexToRgb(r.fill) : [255, 255, 255])
  if (s) {
    s.ink = r.ink ?? 0
    if (r.room) s.room = true
  }
  regionShapes.set(r, s)
  return s
}

// What the auto pass makes of a page, as editor layers: the blocks (each with
// the colours it read, `look`), the region each translation went in (its
// balloon parts, or its room on the art) and the erase — the page's pixels it
// changed (opaque) over transparent. `res.blocks` need ids.
export interface AutoPage {
  blocks: TransBlock[]
  regions: Omit<TransRegion, 'layer'>[]
  erase: ImageData
}
export function autoPage(img: HTMLImageElement, res: TransResult, heal: Healed | null): AutoPage {
  const { W, H } = canvasSize(img)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, W, H)
  const page = ctx.getImageData(0, 0, W, H)
  const { jobs, bubbles, kept } = planJobs(ctx, res, W, H, pageKey(img))
  const hex = (c: RGB | null): string | undefined => (c ? rgbToHex(c) : undefined)
  const look = new Map<TransBlock, TransBlock['look']>()
  for (const j of jobs) look.set(j.b, { ink: hex(j.ink), halo: hex(j.halo), fill: rgbToHex(j.bg), art: !j.bubble })
  const regions: Omit<TransRegion, 'layer'>[] = []
  for (const j of jobs) {
    if (j.into) continue
    const ids = [j, ...jobs.filter((o) => o.into === j)].map((o) => o.b.id ?? '')
    for (const s of j.parts)
      regions.push({ id: `r${regions.length}`, blocks: ids, x: s.x0, y: s.y0, w: s.w, h: s.h, bits: packMask(s.inside), ink: s.ink, fill: rgbToHex(s.fill), room: s.room || undefined })
  }
  eraseAll(ctx, jobs, bubbles, kept, res.mask, W, H, heal && heal.W === W && heal.H === H ? heal : null)
  const erase = ctx.getImageData(0, 0, W, H)
  const a = page.data
  const e = erase.data
  for (let i = 0; i < a.length; i += 4) if (a[i] === e[i] && a[i + 1] === e[i + 1] && a[i + 2] === e[i + 2]) e[i + 3] = 0
  const blocks = res.blocks.map((b) => {
    const l = look.get(b)
    return l ? { ...b, look: l } : b
  })
  return { blocks, regions, erase }
}

// A document's jobs: each block in the regions listing it (on the topmost
// bubble layer that lists it), blocks sharing their one region joined into one
// speech as the auto pass joins them (bubble: one text; room on the art: one
// paragraph per block, each in its colours).
function docJobs(blocks: TransBlock[], regions: TransRegion[], W: number, H: number): Job[] {
  const byBlock = new Map<string, TransRegion[]>()
  const layerOf = new Map<string, string>()
  for (const r of regions)
    for (const id of r.blocks) {
      const l = layerOf.get(id) ?? r.layer
      layerOf.set(id, l)
      if (l === r.layer) byBlock.set(id, [...(byBlock.get(id) ?? []), r])
    }
  const jobs: Job[] = []
  const only = new Map<Job, TransRegion>()
  blocks.forEach((b, i) => {
    if (b.w <= 0 || b.h <= 0) return
    if (!b.bg && !b.edited && !b.room && isSfx(b, W, H)) return
    const rs = (b.id && byBlock.get(b.id)) || []
    const parts = rs.map(regionShape).filter((s): s is Shape => !!s)
    const l = b.look
    const fill: RGB = b.bg ? hexToRgb(b.bg) : l?.fill ? hexToRgb(l.fill) : [255, 255, 255]
    const j: Job = {
      b,
      unit: b.style?.size ? { ...b, size: b.style.size } : b,
      i,
      bg: fill,
      ink: l?.ink ? hexToRgb(l.ink) : null,
      halo: l?.halo ? hexToRgb(l.halo) : null,
      rim: null,
      parts,
      bubble: null,
      bubbles: new Set(),
      onArt: l?.art ?? (rs.length > 0 && rs.every((r) => r.room)),
      segs: [{ b, start: 0 }]
    }
    jobs.push(j)
    if (rs.length === 1) only.set(j, rs[0])
  })
  const groups = new Map<TransRegion, Job[]>()
  for (const [j, r] of only) groups.set(r, [...(groups.get(r) ?? []), j])
  for (const [r, group] of groups) {
    if (group.length < 2) continue
    group.sort((p, q) => boxOrder(p.b, q.b))
    const [lead, ...rest] = group
    const x0 = Math.min(...group.map((j) => j.b.x))
    const y0 = Math.min(...group.map((j) => j.b.y))
    const box = { x: x0, y: y0, w: Math.max(...group.map((j) => j.b.x + j.b.w)) - x0, h: Math.max(...group.map((j) => j.b.y + j.b.h)) - y0 }
    // Bubble: the non-empty texts joined by spaces; room: one line each.
    const parts = r.room ? group : group.filter((j) => drawnText(j.b))
    const sep = r.room ? '\n' : ' '
    let at = 0
    lead.segs = parts.map((j) => {
      const seg = { b: j.b, start: at }
      at += drawnText(j.b).length + sep.length
      return seg
    })
    const sizes = group.map((j) => j.b.size).filter((v): v is number => !!v).sort((p, q) => p - q)
    lead.unit = {
      ...lead.unit,
      ...box,
      text: group.map((j) => j.b.text).join(r.room ? '\n' : ''),
      tr: parts.map((j) => drawnText(j.b)).join(sep),
      paras: undefined,
      cols: r.room ? undefined : lead.b.cols,
      room: speechRoom(group),
      size: lead.b.style?.size ?? (r.room && sizes.length ? sizes[sizes.length >> 1] : lead.b.size)
    }
    if (r.room) lead.paints = group.map((j) => ({ ink: j.ink, halo: j.halo }))
    for (const j of rest) {
      j.into = lead
      j.parts = []
    }
  }
  return jobs
}

// The translations of a document, laid out from its regions, drawn on `canvas`
// (page size, cleared). Returns what was drawn, as drawTranslation does.
export function drawDocText(canvas: HTMLCanvasElement, doc: Pick<TransDoc, 'W' | 'H' | 'blocks' | 'regions'>): Drawn {
  const { W, H, blocks } = doc
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W
    canvas.height = H
  }
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, W, H)
  const out: Drawn = { inks: [], boxes: blocks.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, skip: true })), lead: blocks.map((_, i) => i) }
  const jobs = docJobs(blocks, doc.regions, W, H)
  const layouts = layoutAll(ctx, jobs)
  for (const job of jobs) {
    const { i, bg, ink, halo, paints } = job
    out.inks[i] = rgbToHex(ink ?? (luminance(bg) > 140 ? [20, 20, 20] : [244, 244, 244]))
    out.boxes[i] = job.into ? null : drawnBox(ctx, job, layouts.get(job) ?? [])
    if (job.into) out.lead[i] = job.into.i
    const lays = layouts.get(job) ?? []
    const text = drawnText(job.unit)
    const paras = paints && lineParas(lays.flatMap((l) => l.lines), text)
    const styled = job.segs?.some((s) => s.b.style || s.b.runs?.length)
    // Turned text: round the centre of its box (as the editor shows the box).
    const rot = blocks[i].rot
    const box = out.boxes[i]
    ctx.save()
    if (rot && box) {
      const cx = box.x + box.w / 2
      const cy = box.y + box.h / 2
      ctx.translate(cx, cy)
      ctx.rotate((rot * Math.PI) / 180)
      ctx.translate(-cx, -cy)
    }
    // The whole text's extent: a gradient runs across all of it.
    const rs = lays.map((l) => textRect(ctx, l))
    const area = rs.length
      ? (() => {
          const x0 = Math.min(...rs.map((r) => r.x0))
          const y0 = Math.min(...rs.map((r) => r.y0))
          return { x0, y0, w: Math.max(...rs.map((r) => r.x0 + r.w)) - x0, h: Math.max(...rs.map((r) => r.y0 + r.h)) - y0 }
        })()
      : null
    let line0 = 0
    const at = { p: 0 } // where the next line's text starts in `text`
    for (const lay of lays) {
      const first = line0
      const paintAt = (k: number): Paint => (paints && paras ? paints[paras[first + k]] : { ink, halo })
      if (styled) drawRich(ctx, lay, lay.fill ?? bg, paintAt, !!job.onArt, text, at, job.segs!, area)
      else drawText(ctx, lay, lay.fill ?? bg, paintAt, !!job.onArt)
      line0 += lay.lines.length
    }
    ctx.restore()
  }
  return out
}

// A text gradient as a canvas fill over `r` (its stops' alpha × `opacity`).
function gradientFill(ctx: CanvasRenderingContext2D, g: TextGradient, r: Rect, opacity = 1): CanvasGradient {
  const a = (g.angle * Math.PI) / 180
  const dx = Math.cos(a)
  const dy = Math.sin(a)
  // Half its length: the rect's extent along the direction.
  const half = (Math.abs(r.w * dx) + Math.abs(r.h * dy)) / 2
  const cx = r.x0 + r.w / 2
  const cy = r.y0 + r.h / 2
  const lin = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half)
  for (const st of [...g.stops].sort((p, q) => p.pos - q.pos)) {
    const [R, G, B] = hexToRgb(st.color)
    lin.addColorStop(Math.max(0, Math.min(1, st.pos)), `rgba(${R},${G},${B},${Math.max(0, Math.min(1, st.alpha * opacity))})`)
  }
  return lin
}

// A document drawn as the viewer shows it: the page, then its painted layers
// and text in layer order (bubble layers are a guide only).
export function renderDoc(canvas: HTMLCanvasElement, img: HTMLImageElement, doc: TransDoc, images: Map<string, CanvasImageSource>): void {
  const { W, H } = doc
  canvas.width = W
  canvas.height = H
  // Software canvas, as drawTranslation's: the GPU one scales the page otherwise.
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, W, H)
  for (const l of [...doc.layers].reverse()) {
    if (!l.visible) continue
    if (l.kind === 'pixels') {
      const im = images.get(l.id)
      if (im) ctx.drawImage(im, 0, 0, W, H)
    } else if (l.kind === 'text') {
      const t = document.createElement('canvas')
      drawDocText(t, doc)
      ctx.drawImage(t, 0, 0)
    }
  }
}

// A character's style: its block's, then the run over it. A block's size and
// font went into its layout already; a run's go per character.
function styleAt(segs: { b: TransBlock; start: number }[], off: number): TextStyle {
  let seg = segs[0]
  for (const s of segs) if (s.start <= off) seg = s
  const k = off - seg.start
  const run = seg.b.runs?.find((r) => r.start <= k && k < r.end)
  const base = seg.b.style ?? {}
  return {
    color: run?.color ?? base.color,
    underline: run?.underline ?? base.underline,
    strike: run?.strike ?? base.strike,
    outline: run?.outline ?? base.outline,
    outlineWidth: run?.outlineWidth ?? base.outlineWidth,
    outlineColor: run?.outlineColor ?? base.outlineColor,
    opacity: run?.opacity ?? base.opacity,
    gradient: run?.gradient ?? base.gradient,
    size: run?.size,
    font: run?.font,
    bold: run?.bold,
    italic: run?.italic
  }
}

// drawText with per-character styles (the editor's 번역문 stage): each line cut
// into runs of one style, measured in their own fonts; aligned as the block
// says (default centred, as drawText).
function drawRich(
  ctx: CanvasRenderingContext2D,
  lay: Layout,
  bg: RGB,
  paintAt: (line: number) => Paint,
  onArt: boolean,
  text: string,
  at: { p: number },
  segs: { b: TransBlock; start: number }[],
  area: Rect | null
): void {
  const base = lay.face ?? DEFAULT_FACE
  const dark = luminance(bg) > 140
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.lineJoin = 'round'
  // Each line's characters → their offsets in `text` (the wrap keeps every
  // non-space character, in order).
  const lines = lay.lines.map((line) =>
    [...line].map((ch) => {
      if (/\s/.test(ch)) {
        if (/\s/.test(text[at.p] ?? '')) return { ch, off: at.p++ }
        return { ch, off: Math.max(0, at.p - 1) }
      }
      while (at.p < text.length && text[at.p] !== ch) at.p++
      return { ch, off: Math.min(at.p++, Math.max(0, text.length - 1)) }
    })
  )
  interface Piece {
    s: string
    st: TextStyle
    key: string
    font: string
    fs: number
    w: number
  }
  const measured = lines.map((cs) => {
    const pieces: Piece[] = []
    for (const { ch, off } of cs) {
      const st = styleAt(segs, off)
      const key = JSON.stringify(st)
      const last = pieces[pieces.length - 1]
      if (last && last.key === key) last.s += ch
      else {
        const fs = st.size ?? lay.fs
        const f: Face = {
          family: st.font ? `"${st.font}", ${FONT}` : base.family,
          weight: st.bold === true ? 800 : st.bold === false ? 400 : base.weight,
          italic: st.italic ?? base.italic
        }
        pieces.push({ s: ch, st, key, font: fontAt(fs, f), fs, w: 0 })
      }
    }
    let w = 0
    for (const p of pieces) {
      ctx.font = p.font
      p.w = ctx.measureText(p.s).width
      w += p.w
    }
    // Trailing punctuation hangs past the line (as bodyWidth).
    const end = pieces[pieces.length - 1]
    const m = end && /[,.!?:;、。，．！？：；~〜～♡♥」』）)\]]+$/.exec(end.s)
    let body = w
    if (end && m && trails(m[0])) {
      ctx.font = end.font
      body -= ctx.measureText(m[0]).width
    }
    return { pieces, body, fs: Math.max(lay.fs, ...pieces.map((p) => p.fs)) }
  })
  const align = segs[0].b.style?.align ?? 'center'
  const widest = Math.max(0, ...measured.map((l) => l.body))
  const half = widest / 2 + lay.fs * 0.1
  const cx = Math.max(half, Math.min(ctx.canvas.width - half, lay.cx))
  const total = measured.reduce((a, l) => a + lineH(l.fs), 0)
  let y = Math.max(0, Math.min(ctx.canvas.height - total, lay.top))
  measured.forEach((line, k) => {
    const { ink, halo: own } = paintAt(k)
    let x = align === 'left' || align === 'justify' ? cx - widest / 2 : align === 'right' ? cx + widest / 2 - line.body : cx - line.body / 2
    // Justify: every line but a paragraph's last spreads to the widest.
    const next = lines[k + 1]?.[0]?.off
    const lastOfPara = next === undefined || text.slice(lines[k][lines[k].length - 1]?.off ?? 0, next).includes('\n')
    const gaps = align === 'justify' && !lastOfPara ? Math.max(0, widest - line.body) : 0
    const spaces = line.pieces.reduce((a, p) => a + (p.s.match(/ /g)?.length ?? 0), 0)
    const chars = line.pieces.reduce((a, p) => a + [...p.s].length, 0)
    const per = gaps ? gaps / (spaces || Math.max(1, chars - 1)) : 0
    for (const p of line.pieces) {
      const grad = p.st.gradient?.stops.length ? p.st.gradient : null
      const fill: RGB = grad ? hexToRgb(grad.stops[0].color) : p.st.color ? hexToRgb(p.st.color) : (ink ?? (dark ? [20, 20, 20] : [244, 244, 244]))
      const opposite: RGB = luminance(fill) > 140 ? [0, 0, 0] : [255, 255, 255]
      const halo = own ?? (onArt ? opposite : Math.abs(luminance(fill) - luminance(bg)) >= 60 ? bg : opposite)
      ctx.font = p.font
      // Outline turned off: no stroke at all (not even the auto halo).
      const stroke = p.st.outline !== false
      if (p.st.outline) {
        // A set outline: its width outside the glyph (the stroke is centred).
        ctx.lineWidth = Math.max(0.5, (p.st.outlineWidth ?? 3) * 2)
        ctx.strokeStyle = p.st.outlineColor ?? rgbToHex(opposite)
      } else {
        ctx.lineWidth = Math.max(1.5, p.fs * (own || onArt ? 0.2 : 0.14))
        ctx.strokeStyle = `rgba(${halo[0]},${halo[1]},${halo[2]},${own ? 1 : 0.85})`
      }
      const op = p.st.opacity ?? 1
      ctx.fillStyle =
        grad && area ? gradientFill(ctx, grad, area, op) : op < 1 ? `rgba(${fill[0]},${fill[1]},${fill[2]},${Math.max(0, op)})` : rgbToHex(fill)
      // Mixed sizes sit on one baseline (about).
      const py = y + (line.fs - p.fs) * 0.85
      const x0 = x
      if (per) {
        for (const ch of p.s) {
          if (stroke) ctx.strokeText(ch, x, py)
          ctx.fillText(ch, x, py)
          x += ctx.measureText(ch).width + (spaces ? (ch === ' ' ? per : 0) : per)
        }
      } else {
        if (stroke) ctx.strokeText(p.s, x, py)
        ctx.fillText(p.s, x, py)
        x += p.w
      }
      const t = Math.max(1, p.fs * 0.06)
      if (p.st.underline) ctx.fillRect(x0, py + p.fs * 1.02, x - x0, t)
      if (p.st.strike) ctx.fillRect(x0, py + p.fs * 0.5, x - x0, t)
    }
    y += lineH(line.fs)
  })
}
