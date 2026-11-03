// 인페인팅 모델 (optional): LaMa (big-lama, Apache-2.0) as ONNX, 512×512 fixed.
// When the user has downloaded it, the renderer sends it the patches of art
// under erased text and pastes back what it paints there — the line art and
// tones carried through, instead of the built-in averaging fill. Not
// downloaded → the renderer keeps its built-in fill.
import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type * as OrtNs from 'onnxruntime-node'
import { fetchFile, ort } from './localOcr'

const URL = 'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx'
export const LAMA_MB = 199
export const LAMA_SIDE = 512

// IP_LAMA: the debugger's model path (scripts/inpaint-debug).
const modelPath = (): string => process.env.IP_LAMA || join(app.getPath('userData'), 'inpaint-models', 'lama.onnx')

export async function lamaInstalled(): Promise<boolean> {
  try {
    return (await fs.stat(modelPath())).size > 0
  } catch {
    return false
  }
}

let downloading: Promise<void> | null = null
export function downloadLama(onProgress: (done: number, total: number) => void): Promise<void> {
  if (downloading) return downloading
  downloading = (async () => {
    await fs.mkdir(join(modelPath(), '..'), { recursive: true })
    let done = 0
    let total = LAMA_MB * 1024 * 1024
    await fetchFile(URL, modelPath(), (n) => {
      done += n
      if (done > total) total = done
      onProgress(done, total)
    })
    onProgress(total, total)
  })().finally(() => {
    downloading = null
  })
  return downloading
}

export async function deleteLama(): Promise<void> {
  session = null
  await fs.rm(modelPath(), { force: true })
}

let session: Promise<OrtNs.InferenceSession> | null = null
let queue: Promise<unknown> = Promise.resolve()

// One 512×512 patch: `rgb` (3 bytes a pixel) and `mask` (1 = paint over), the
// painted patch back as rgb. One patch at a time (each takes the CPU for ~1s).
export function lamaPatch(rgb: Uint8Array, mask: Uint8Array): Promise<Uint8Array> {
  const run = queue.then(async () => {
    const o = await ort()
    if (!session) session = o.InferenceSession.create(modelPath())
    const s = await session
    const n = LAMA_SIDE * LAMA_SIDE
    const image = new Float32Array(3 * n)
    const m = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      m[i] = mask[i] ? 1 : 0
      for (let c = 0; c < 3; c++) image[c * n + i] = m[i] ? 0 : rgb[i * 3 + c] / 255
    }
    const out = await s.run({
      image: new o.Tensor('float32', image, [1, 3, LAMA_SIDE, LAMA_SIDE]),
      mask: new o.Tensor('float32', m, [1, 1, LAMA_SIDE, LAMA_SIDE])
    })
    const d = out.output.data as Float32Array // 0‥255
    const res = new Uint8Array(3 * n)
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) res[i * 3 + c] = Math.max(0, Math.min(255, Math.round(d[c * n + i])))
    return res
  })
  queue = run.catch(() => undefined)
  return run
}
