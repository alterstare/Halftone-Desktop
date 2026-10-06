// Local OCR for the "로컬 OCR + LLM 번역" engine — runs entirely in the app
// (onnxruntime-node, no Python):
//   1. comic-text-detector   finds the text blocks (speech bubbles) on a page
//   2a. manga-ocr            reads a Japanese block (vertical or horizontal)
//   2b. PaddleOCR (PP-OCRv3) finds the lines in an English block, then reads
//                            each line (CTC)
// Models (~225MB, Apache-2.0) are downloaded once into userData/ocr-models.
// Images are decoded / cropped / resized with Electron's nativeImage, so no
// extra image library is needed.
import { app, nativeImage, net, type NativeImage } from 'electron'
import { promises as fs, createWriteStream } from 'fs'
import { join } from 'path'
import type * as OrtNs from 'onnxruntime-node'
import type { TransBlock } from '../../shared/ipc'

// onnxruntime-node is a native addon — loaded on first use only.
let ortMod: typeof OrtNs | null = null
async function ort(): Promise<typeof OrtNs> {
  if (!ortMod) ortMod = (await import('onnxruntime-node')) as typeof OrtNs
  return ortMod
}

const HF = 'https://huggingface.co'
const MODELS = [
  { file: 'comic-text-detector.onnx', url: `${HF}/mayocream/comic-text-detector-onnx/resolve/main/comic-text-detector.onnx` },
  { file: 'manga-ocr-encoder.onnx', url: `${HF}/onnx-community/manga-ocr-base-ONNX/resolve/main/onnx/encoder_model_quantized.onnx` },
  { file: 'manga-ocr-decoder.onnx', url: `${HF}/onnx-community/manga-ocr-base-ONNX/resolve/main/onnx/decoder_model_quantized.onnx` },
  { file: 'manga-ocr-vocab.txt', url: `${HF}/kha-white/manga-ocr-base/resolve/main/vocab.txt` },
  { file: 'paddle-en-det.onnx', url: `${HF}/SWHL/RapidOCR/resolve/main/PP-OCRv4/en_PP-OCRv3_det_infer.onnx` },
  { file: 'paddle-en-rec.onnx', url: `${HF}/SWHL/RapidOCR/resolve/main/PP-OCRv3/en_PP-OCRv3_rec_infer.onnx` },
  { file: 'paddle-en-dict.txt', url: 'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/release/2.7/ppocr/utils/en_dict.txt' }
] as const
export const OCR_MODELS_MB = 225

const modelDir = (): string => join(app.getPath('userData'), 'ocr-models')
const modelPath = (f: string): string => join(modelDir(), f)

export async function ocrModelsInstalled(): Promise<boolean> {
  for (const m of MODELS) {
    try {
      const st = await fs.stat(modelPath(m.file))
      if (!st.size) return false
    } catch {
      return false
    }
  }
  return true
}

// Download every model file (skipping ones already there). Reports overall
// progress as bytes done / total (total grows as each response's size is known).
let downloading: Promise<void> | null = null
export function downloadOcrModels(onProgress: (done: number, total: number) => void): Promise<void> {
  if (downloading) return downloading
  downloading = (async () => {
    await fs.mkdir(modelDir(), { recursive: true })
    let done = 0
    let total = OCR_MODELS_MB * 1024 * 1024
    for (const m of MODELS) {
      const dest = modelPath(m.file)
      try {
        const st = await fs.stat(dest)
        if (st.size) {
          done += st.size
          onProgress(done, total)
          continue
        }
      } catch {
        /* not there yet */
      }
      const res = await net.fetch(m.url)
      if (!res.ok || !res.body) throw new Error(`모델 다운로드 실패 (${m.file}: HTTP ${res.status})`)
      const part = dest + '.part'
      const out = createWriteStream(part)
      const reader = res.body.getReader()
      for (;;) {
        const { done: end, value } = await reader.read()
        if (end) break
        out.write(Buffer.from(value))
        done += value.byteLength
        if (done > total) total = done
        onProgress(done, total)
      }
      await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())))
      await fs.rename(part, dest)
    }
    onProgress(total, total)
  })().finally(() => {
    downloading = null
  })
  return downloading
}

export async function deleteOcrModels(): Promise<void> {
  sessions = null
  await fs.rm(modelDir(), { recursive: true, force: true })
}

// ---- sessions (loaded once) ----
type Sess = OrtNs.InferenceSession
let sessions: {
  det: Sess
  jpEnc: Sess
  jpDec: Sess
  vocab: string[]
  enDet: Sess
  enRec: Sess
  enDict: string[]
} | null = null

async function loadSessions(): Promise<NonNullable<typeof sessions>> {
  if (sessions) return sessions
  if (!(await ocrModelsInstalled())) throw new Error('로컬 OCR 모델이 없습니다 — 설정 › 번역에서 먼저 받아 주세요')
  const o = await ort()
  const open = (f: string): Promise<Sess> => o.InferenceSession.create(modelPath(f))
  const lines = async (f: string): Promise<string[]> =>
    (await fs.readFile(modelPath(f), 'utf8')).split('\n').map((l) => l.replace('\r', ''))
  sessions = {
    det: await open('comic-text-detector.onnx'),
    jpEnc: await open('manga-ocr-encoder.onnx'),
    jpDec: await open('manga-ocr-decoder.onnx'),
    vocab: (await lines('manga-ocr-vocab.txt')).map((l) => l.trim()),
    enDet: await open('paddle-en-det.onnx'),
    enRec: await open('paddle-en-rec.onnx'),
    // CTC classes: 0 = blank, then the dictionary, then a trailing space.
    enDict: ['', ...(await lines('paddle-en-dict.txt')).filter((l) => l !== ''), ' ']
  }
  return sessions
}

// ---- pixel helpers (nativeImage bitmaps are BGRA) ----
type Px = { w: number; h: number; d: Buffer }
function pixels(img: NativeImage): Px {
  const { width: w, height: h } = img.getSize()
  return { w, h, d: img.toBitmap() }
}
const R = (p: Px, i: number): number => p.d[i * 4 + 2]
const G = (p: Px, i: number): number => p.d[i * 4 + 1]
const B = (p: Px, i: number): number => p.d[i * 4]

interface Box {
  x1: number
  y1: number
  x2: number
  y2: number
  conf: number
}

// 1. text blocks on the page (letterboxed to 1024, YOLO-style output + NMS)
async function detectBlocks(img: NativeImage): Promise<{ blocks: Box[]; lines: Line[] }> {
  const s = await loadSessions()
  const o = await ort()
  const S = 1024
  const { width, height } = img.getSize()
  const scale = Math.min(S / width, S / height)
  const nw = Math.round(width * scale)
  const nh = Math.round(height * scale)
  const p = pixels(img.resize({ width: nw, height: nh, quality: 'best' }))
  const x = new Float32Array(3 * S * S)
  for (let yy = 0; yy < p.h; yy++)
    for (let xx = 0; xx < p.w; xx++) {
      const i = yy * p.w + xx
      const j = yy * S + xx
      x[j] = R(p, i) / 255
      x[S * S + j] = G(p, i) / 255
      x[2 * S * S + j] = B(p, i) / 255
    }
  const out = await s.det.run({ images: new o.Tensor('float32', x, [1, 3, S, S]) })
  const blk = out.blk.data as Float32Array
  const boxes: Box[] = []
  for (let i = 0; i < (out.blk.dims[1] as number); i++) {
    const k = i * 7
    const conf = blk[k + 4] * Math.max(blk[k + 5], blk[k + 6])
    if (conf < 0.3) continue // low on purpose: misread junk is filtered after OCR (isJunk)
    const [cx, cy, w, h] = [blk[k], blk[k + 1], blk[k + 2], blk[k + 3]]
    boxes.push({
      x1: Math.max(0, (cx - w / 2) / scale),
      y1: Math.max(0, (cy - h / 2) / scale),
      x2: Math.min(width, (cx + w / 2) / scale),
      y2: Math.min(height, (cy + h / 2) / scale),
      conf
    })
  }
  boxes.sort((a, b) => b.conf - a.conf)
  const iou = (a: Box, b: Box): number => {
    const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1))
    const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1))
    const n = ix * iy
    return n / ((a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - n)
  }
  // The detector sometimes returns one bubble AND a bigger box covering that
  // bubble plus its neighbour. Plain NMS then either keeps both (same line
  // read twice) or drops the big one (neighbour's text lost). When one box
  // sits inside another, cut the inner part off the outer box and keep the
  // rest as its own block; if no clean cut exists, merge the two.
  let keep: Box[] = []
  const area = (a: Box): number => (a.x2 - a.x1) * (a.y2 - a.y1)
  const inside = (a: Box, b: Box): number => {
    const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1))
    const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1))
    return (ix * iy) / Math.min(area(a), area(b))
  }
  const rest = (big: Box, small: Box): Box | null => {
    const bw = big.x2 - big.x1
    const bh = big.y2 - big.y1
    const spansW = small.x1 <= big.x1 + bw * 0.15 && small.x2 >= big.x2 - bw * 0.15
    const spansH = small.y1 <= big.y1 + bh * 0.15 && small.y2 >= big.y2 - bh * 0.15
    let r: Box | null = null
    if (spansW && small.y1 - big.y1 < bh * 0.15) r = { ...big, y1: small.y2 }
    else if (spansW && big.y2 - small.y2 < bh * 0.15) r = { ...big, y2: small.y1 }
    else if (spansH && small.x1 - big.x1 < bw * 0.15) r = { ...big, x1: small.x2 }
    else if (spansH && big.x2 - small.x2 < bw * 0.15) r = { ...big, x2: small.x1 }
    return r && r.x2 - r.x1 > Math.max(8, bw * 0.2) && r.y2 - r.y1 > Math.max(8, bh * 0.2) ? r : null
  }
  for (const b of boxes) {
    if (b.x2 - b.x1 <= 4 || b.y2 - b.y1 <= 4) continue
    const qi = keep.findIndex((q) => inside(q, b) > 0.8)
    if (qi >= 0) {
      const q = keep[qi]
      if (area(q) > area(b) * 1.3 || area(b) > area(q) * 1.3) {
        const [big, small] = area(q) > area(b) ? [q, b] : [b, q]
        const r = rest(big, small)
        keep = keep.filter((_, i) => i !== qi)
        if (r) keep.push(small, r)
        else
          keep.push({
            x1: Math.min(q.x1, b.x1),
            y1: Math.min(q.y1, b.y1),
            x2: Math.max(q.x2, b.x2),
            y2: Math.max(q.y2, b.y2),
            conf: Math.max(q.conf, b.conf)
          })
      }
      continue // near-identical box: already covered
    }
    if (!keep.some((q) => iou(q, b) > 0.35)) keep.push(b)
  }
  // A box straddling two others (half of each bubble) repeats their text; drop
  // it when other boxes already cover most of it. Weakest boxes go first.
  for (const b of [...keep].sort((p, q) => p.conf - q.conf)) {
    const others = keep.filter((q) => q !== b && inside(q, b) > 0)
    const cov = others.reduce((a, q) => {
      const ix = Math.max(0, Math.min(q.x2, b.x2) - Math.max(q.x1, b.x1))
      const iy = Math.max(0, Math.min(q.y2, b.y2) - Math.max(q.y1, b.y1))
      return a + ix * iy
    }, 0)
    if (others.length >= 2 && cov >= 0.6 * area(b)) keep = keep.filter((q) => q !== b)
  }

  // Text lines from the detector's own DB line map (output `det`, channel 0).
  // Used twice: lines no block covers become extra blocks (free text the block
  // head missed — names, captions, narration), and multi-line horizontal blocks
  // are read line by line (manga-ocr squashes a whole paragraph badly).
  const map = out.det.data as Float32Array
  const seen = new Uint8Array(S * S)
  const lines: Line[] = []
  for (let yy = 0; yy < nh; yy++)
    for (let xx = 0; xx < nw; xx++) {
      const i0 = yy * S + xx
      if (seen[i0] || map[i0] < 0.3) continue
      let x1 = S, y1 = S, x2 = 0, y2 = 0, n = 0
      const st = [i0]
      seen[i0] = 1
      while (st.length) {
        const q = st.pop()!
        const qx = q % S
        const qy = (q / S) | 0
        n++
        if (qx < x1) x1 = qx
        if (qx > x2) x2 = qx
        if (qy < y1) y1 = qy
        if (qy > y2) y2 = qy
        for (const r of [q - 1, q + 1, q - S, q + S])
          if (r >= 0 && r < S * S && !seen[r] && map[r] >= 0.3 && Math.abs((r % S) - qx) <= 1) {
            seen[r] = 1
            st.push(r)
          }
      }
      const t = Math.min(x2 - x1, y2 - y1) + 1
      if (n < 25 || t < 4 || Math.max(x2 - x1, y2 - y1) + 1 < t * 1.5) continue // specks / blobs
      const e = Math.round(t * 0.5) // DB shrinks text regions — expand back
      lines.push({
        x1: Math.max(0, (x1 - e) / scale),
        y1: Math.max(0, (y1 - e) / scale),
        x2: Math.min(width, (x2 + e) / scale),
        y2: Math.min(height, (y2 + e) / scale),
        t: (t + 2 * e) / scale,
        vert: y2 - y1 > x2 - x1
      })
    }
  // Uncovered lines → group neighbours of the same direction into blocks.
  // A line counts as covered when half of it overlaps a block (text often pokes
  // out of a tight block; such slivers must not become blocks of their own).
  // Summed over all blocks: stacked bubbles' columns can fuse into one long line.
  const covered = (l: Line): boolean =>
    keep.reduce((a, b) => {
      const ix = Math.max(0, Math.min(b.x2, l.x2) - Math.max(b.x1, l.x1))
      const iy = Math.max(0, Math.min(b.y2, l.y2) - Math.max(b.y1, l.y1))
      return a + ix * iy
    }, 0) >=
    0.5 * (l.x2 - l.x1) * (l.y2 - l.y1)
  const groups: Line[] = lines.filter((l) => !covered(l)).map((l) => ({ ...l }))
  for (let merged = true; merged; ) {
    merged = false
    for (let a = 0; a < groups.length && !merged; a++)
      for (let b = a + 1; b < groups.length && !merged; b++) {
        const A = groups[a]
        const B = groups[b]
        const g = Math.min(A.t, B.t) * 0.6
        if (A.vert !== B.vert || !(A.x1 - g < B.x2 && B.x1 - g < A.x2 && A.y1 - g < B.y2 && B.y1 - g < A.y2)) continue
        groups[a] = {
          x1: Math.min(A.x1, B.x1),
          y1: Math.min(A.y1, B.y1),
          x2: Math.max(A.x2, B.x2),
          y2: Math.max(A.y2, B.y2),
          t: Math.max(A.t, B.t),
          vert: A.vert
        }
        groups.splice(b, 1)
        merged = true
      }
  }
  for (const g of groups) if (g.x2 - g.x1 >= 8 && g.y2 - g.y1 >= 8) keep.push({ ...g, conf: 0 })

  // reading order: top-to-bottom, right-to-left within a row band
  keep.sort((a, b) => (Math.abs(a.y1 - b.y1) < 40 ? b.x1 - a.x1 : a.y1 - b.y1))
  return { blocks: keep, lines }
}

const holds = (b: Box, l: Line): boolean => {
  const cx = (l.x1 + l.x2) / 2
  const cy = (l.y1 + l.y2) / 2
  return cx > b.x1 && cx < b.x2 && cy > b.y1 && cy < b.y2
}

interface Line {
  x1: number
  y1: number
  x2: number
  y2: number
  t: number // thickness (line height for horizontal text)
  vert: boolean
}

const crop = (img: NativeImage, b: { x1: number; y1: number; x2: number; y2: number }): NativeImage =>
  img.crop({
    x: Math.round(b.x1),
    y: Math.round(b.y1),
    width: Math.max(1, Math.round(b.x2 - b.x1)),
    height: Math.max(1, Math.round(b.y2 - b.y1))
  })

// 2a. Japanese: manga-ocr (ViT encoder + greedy BERT decoder)
// Returns the text plus its confidence (mean softmax probability of the picked tokens).
async function readJapanese(block: NativeImage): Promise<{ text: string; conf: number }> {
  const s = await loadSessions()
  const o = await ort()
  const p = pixels(block.resize({ width: 224, height: 224, quality: 'best' }))
  const x = new Float32Array(3 * 224 * 224)
  for (let i = 0; i < 224 * 224; i++) {
    // Darkest channel, not luminance: coloured lettering (pink/red text on grey
    // art) keeps its contrast instead of greying out; black text is unchanged.
    const g = Math.min(R(p, i), G(p, i), B(p, i)) / 255
    const v = (g - 0.5) / 0.5
    x[i] = v
    x[224 * 224 + i] = v
    x[2 * 224 * 224 + i] = v
  }
  const h = (await s.jpEnc.run({ pixel_values: new o.Tensor('float32', x, [1, 3, 224, 224]) })).last_hidden_state
  const ids = [2] // [CLS] = decoder start
  const probs: number[] = []
  for (let step = 0; step < 300; step++) {
    const r = await s.jpDec.run({
      input_ids: new o.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      encoder_hidden_states: h
    })
    const L = r.logits.data as Float32Array
    const V = r.logits.dims[2] as number
    const off = (ids.length - 1) * V
    let best = 0
    let bv = -Infinity
    for (let v = 0; v < V; v++) if (L[off + v] > bv) ((bv = L[off + v]), (best = v))
    if (best === 3) break // [SEP]
    let sum = 0
    for (let v = 0; v < V; v++) sum += Math.exp(L[off + v] - bv)
    probs.push(1 / sum)
    ids.push(best)
  }
  const text = ids
    .slice(1)
    .map((i) => s.vocab[i])
    .filter((t) => t && !(t.startsWith('[') && t.endsWith(']')))
    .join('')
    .replaceAll('##', '')
    .replace(/\s+/g, '')
    // Greedy decoding can loop (倫倫倫倫…, おいおいおい…): keep two repeats.
    .replace(/([^\p{P}\p{S}]{1,3}?)\1{2,}/gu, '$1$1')
  return { text, conf: avg(probs) }
}

const avg = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)

// 2b. English: PaddleOCR line detection (DB map → connected components) + CTC recognition
async function readEnglish(block: NativeImage): Promise<{ text: string; conf: number }> {
  const s = await loadSessions()
  const o = await ort()
  const src = pixels(block)
  const pad = 8
  const tw = Math.ceil((src.w + pad * 2) / 32) * 32
  const th = Math.ceil((src.h + pad * 2) / 32) * 32
  const mean = [0.485, 0.456, 0.406]
  const std = [0.229, 0.224, 0.225]
  const x = new Float32Array(3 * tw * th)
  for (let c = 0; c < 3; c++) x.fill((1 - mean[c]) / std[c], c * tw * th, (c + 1) * tw * th) // white pad
  for (let yy = 0; yy < src.h; yy++)
    for (let xx = 0; xx < src.w; xx++) {
      const i = yy * src.w + xx
      const j = (yy + pad) * tw + xx + pad
      x[j] = (R(src, i) / 255 - mean[0]) / std[0]
      x[tw * th + j] = (G(src, i) / 255 - mean[1]) / std[1]
      x[2 * tw * th + j] = (B(src, i) / 255 - mean[2]) / std[2]
    }
  const map = (await s.enDet.run({ x: new o.Tensor('float32', x, [1, 3, th, tw]) }))[s.enDet.outputNames[0]]
    .data as Float32Array
  const seen = new Uint8Array(tw * th)
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (let i = 0; i < tw * th; i++) {
    if (seen[i] || map[i] < 0.3) continue
    let x1 = tw, y1 = th, x2 = 0, y2 = 0, n = 0
    const st = [i]
    seen[i] = 1
    while (st.length) {
      const q = st.pop()!
      const qx = q % tw
      const qy = (q / tw) | 0
      n++
      if (qx < x1) x1 = qx
      if (qx > x2) x2 = qx
      if (qy < y1) y1 = qy
      if (qy > y2) y2 = qy
      for (const r of [q - 1, q + 1, q - tw, q + tw])
        if (r >= 0 && r < tw * th && !seen[r] && map[r] >= 0.3 && Math.abs((r % tw) - qx) <= 1) {
          seen[r] = 1
          st.push(r)
        }
    }
    if (n < 20) continue
    const ex = Math.round((y2 - y1 + 1) * 0.6) // DB shrinks text regions — expand back
    lines.push({
      x1: Math.max(0, x1 - ex - pad),
      y1: Math.max(0, y1 - ex - pad),
      x2: Math.min(src.w, x2 + ex - pad),
      y2: Math.min(src.h, y2 + ex - pad)
    })
  }
  lines.sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1)
  const out: string[] = []
  const probs: number[] = [] // CTC output is already softmaxed
  for (const l of lines) {
    if (l.x2 - l.x1 < 2 || l.y2 - l.y1 < 2) continue
    const H = 48
    const line = crop(block, l)
    const { width, height } = line.getSize()
    const W = Math.max(16, Math.min(960, Math.round((width / height) * H)))
    const p = pixels(line.resize({ width: W, height: H, quality: 'best' }))
    const t = new Float32Array(3 * H * W)
    for (let i = 0; i < H * W; i++) {
      t[i] = (R(p, i) / 255 - 0.5) / 0.5
      t[H * W + i] = (G(p, i) / 255 - 0.5) / 0.5
      t[2 * H * W + i] = (B(p, i) / 255 - 0.5) / 0.5
    }
    const r = (await s.enRec.run({ x: new o.Tensor('float32', t, [1, 3, H, W]) }))[s.enRec.outputNames[0]]
    const T = r.dims[1] as number
    const C = r.dims[2] as number
    const P = r.data as Float32Array
    let str = ''
    let prev = 0
    for (let k = 0; k < T; k++) {
      let best = 0
      let bv = -1
      for (let c = 0; c < C; c++) if (P[k * C + c] > bv) ((bv = P[k * C + c]), (best = c))
      if (best !== 0 && best !== prev) {
        str += s.enDict[best] ?? ''
        probs.push(bv)
      }
      prev = best
    }
    if (str.trim()) out.push(str.trim())
  }
  let text = out.join(' ')
  // Comic lettering is all-caps; the recognizer sometimes mixes in lowercase.
  const letters = text.replace(/[^a-z]/gi, '')
  if (letters && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7) text = text.toUpperCase()
  return { text, conf: avg(probs) }
}

// Misreads (sound effects, hand lettering, art) come out as low-confidence or
// nonsense strings; translating them prints garbage, so leave those bubbles as
// they are. Thresholds measured on real pages: genuine dialogue scored ≥0.83
// (JP) / ≥0.86 (EN) on average, misreads 0.47–0.77.
function isJunk(text: string, conf: number, english: boolean): boolean {
  const core = text.replace(/[\s\p{P}\p{S}ー〜~♥♡…・]/gu, '')
  if (!core) return true
  if (english) return conf < 0.7 || core.replace(/[^a-z]/gi, '').length < 2
  if (conf < 0.7) return true
  if (core.length <= 3 && conf < 0.85) return true // short + unsure: almost always an SFX misread
  return core.length >= 3 && new Set(core).size === 1 // ああああ / ドドドド
}

// One block → text. Japanese multi-line horizontal blocks (profiles, captions)
// are read line by line: manga-ocr squashes a whole paragraph into 224×224 and
// garbles it, while single lines read cleanly. Unsure lines are dropped.
async function readBlock(img: NativeImage, b: Box, lines: Line[], english: boolean): Promise<{ text: string; conf: number }> {
  if (english) return readEnglish(crop(img, b))
  const hl = lines.filter((l) => !l.vert && holds(b, l)).sort((p, q) => p.y1 - q.y1)
  if (b.x2 - b.x1 < (b.y2 - b.y1) * 1.2 || hl.length < 2) return readJapanese(crop(img, b))
  const parts: { text: string; conf: number }[] = []
  for (const l of hl) {
    const r = await readJapanese(crop(img, { x1: Math.max(l.x1, b.x1), y1: l.y1, x2: Math.min(l.x2, b.x2), y2: l.y2 }))
    if (r.text && r.conf >= 0.6) parts.push(r)
  }
  const n = parts.reduce((a, p) => a + p.text.length, 0)
  if (!n) return readJapanese(crop(img, b))
  return {
    text: parts.map((p) => p.text).join(' '),
    conf: n ? parts.reduce((a, p) => a + p.conf * p.text.length, 0) / n : 0
  }
}

// Whole page → blocks with recognized text (tr filled in later by translation).
// langHint 'english' → PaddleOCR, anything else → manga-ocr.
export async function ocrPage(jpeg: Buffer, langHint?: string): Promise<{ w: number; h: number; blocks: TransBlock[] }> {
  const img = nativeImage.createFromBuffer(jpeg)
  const { width: w, height: h } = img.getSize()
  if (!w || !h) throw new Error('이미지를 읽지 못했습니다')
  const english = (langHint ?? '').toLowerCase().startsWith('en')
  const blocks: TransBlock[] = []
  const det = await detectBlocks(img)
  for (const b of det.blocks) {
    const { text, conf } = await readBlock(img, b, det.lines, english)
    if (isJunk(text, conf, english)) continue
    blocks.push({ x: b.x1, y: b.y1, w: b.x2 - b.x1, h: b.y2 - b.y1, text, tr: '' })
  }
  return { w, h, blocks }
}

// User-picked region (translation editor's 영역 번역) → its text. No junk
// filter: the user chose it on purpose. Lines are found by running the
// detector on the region itself.
export async function ocrRegion(
  jpeg: Buffer,
  r: { x: number; y: number; w: number; h: number },
  langHint?: string
): Promise<string> {
  const img = nativeImage.createFromBuffer(jpeg)
  const { width, height } = img.getSize()
  const x1 = Math.max(0, Math.round(r.x))
  const y1 = Math.max(0, Math.round(r.y))
  const x2 = Math.min(width, Math.round(r.x + r.w))
  const y2 = Math.min(height, Math.round(r.y + r.h))
  if (x2 - x1 < 4 || y2 - y1 < 4) return ''
  const part = crop(img, { x1, y1, x2, y2 })
  const english = (langHint ?? '').toLowerCase().startsWith('en')
  const { lines } = english ? { lines: [] } : await detectBlocks(part)
  const whole: Box = { x1: 0, y1: 0, x2: x2 - x1, y2: y2 - y1, conf: 1 }
  return (await readBlock(part, whole, lines, english)).text
}
