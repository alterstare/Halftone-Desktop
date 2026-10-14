// wav → mp3 off the main thread (the main process also serves the audio the
// player is streaming). One worker per file; terminated to cancel.
import { parentPort, workerData } from 'worker_threads'
import { encodeWavToMp3 } from '../core/tools/wav'
import type { EncodeOptions } from '../core/tools/wav'

const { src, dst, opts } = workerData as { src: string; dst: string; opts: EncodeOptions }
let last = 0
encodeWavToMp3(src, dst, opts, undefined, (p) => {
  if (p - last < 0.01 && p < 1) return
  last = p
  parentPort!.postMessage({ type: 'progress', p })
})
  .then(() => parentPort!.postMessage({ type: 'done' }))
  .catch((e) => parentPort!.postMessage({ type: 'error', message: String((e as Error)?.message ?? e) }))
