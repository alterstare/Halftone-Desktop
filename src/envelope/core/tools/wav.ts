// wav → mp3 (CLAUDE.md §5.6). Reads RIFF / RF64 / BW64 wav (PCM 8/16/24/32,
// float 32/64, WAVE_FORMAT_EXTENSIBLE) in chunks and encodes with LAME
// (wasm-media-encoders: MIT, LAME built to WASM, ~80× realtime). Pure Node:
// the app runs encodeWavToMp3 in a worker thread, tests call it directly.
import { promises as fs } from 'fs'

export interface WavInfo {
  format: number // 1 = PCM, 3 = float
  channels: number
  sampleRate: number
  bits: number
  blockAlign: number
  dataOffset: number
  dataSize: number
  duration: number
  tags: { title?: string; artist?: string; album?: string; comment?: string }
}

const LIST_TAGS: Record<string, keyof WavInfo['tags']> = { INAM: 'title', IART: 'artist', IPRD: 'album', ICMT: 'comment' }

export async function readWavInfo(path: string): Promise<WavInfo> {
  const fh = await fs.open(path, 'r')
  try {
    const size = (await fh.stat()).size
    const head = Buffer.alloc(Math.min(size, 256 * 1024))
    await fh.read(head, 0, head.length, 0)
    const id = head.toString('ascii', 0, 4)
    if (!['RIFF', 'RF64', 'BW64'].includes(id) || head.toString('ascii', 8, 12) !== 'WAVE') throw new Error('wav 파일이 아닙니다')
    let pos = 12
    let ds64Data = 0
    let fmt: Omit<WavInfo, 'dataOffset' | 'dataSize' | 'duration' | 'tags'> | null = null
    const tags: WavInfo['tags'] = {}
    while (pos + 8 <= head.length) {
      const cid = head.toString('ascii', pos, pos + 4)
      const len = head.readUInt32LE(pos + 4)
      const body = pos + 8
      if (cid === 'ds64' && body + 16 <= head.length) ds64Data = Number(head.readBigUInt64LE(body + 8))
      else if (cid === 'fmt ') {
        let format = head.readUInt16LE(body)
        if (format === 0xfffe && len >= 26) format = head.readUInt16LE(body + 24) // extensible → sub-format
        fmt = {
          format,
          channels: head.readUInt16LE(body + 2),
          sampleRate: head.readUInt32LE(body + 4),
          blockAlign: head.readUInt16LE(body + 12),
          bits: head.readUInt16LE(body + 14)
        }
      } else if (cid === 'LIST' && head.toString('ascii', body, body + 4) === 'INFO') {
        for (let p = body + 4; p + 8 <= Math.min(body + len, head.length); ) {
          const t = head.toString('ascii', p, p + 4)
          const l = head.readUInt32LE(p + 4)
          const key = LIST_TAGS[t]
          if (key) tags[key] = head.toString('utf8', p + 8, p + 8 + l).replace(/\0+$/, '').trim() || undefined
          p += 8 + l + (l & 1)
        }
      } else if (cid === 'data') {
        if (!fmt) throw new Error('wav 형식 정보가 없습니다')
        if (fmt.format !== 1 && fmt.format !== 3) throw new Error(`지원하지 않는 wav 형식입니다 (${fmt.format})`)
        let dataSize = len === 0xffffffff || id !== 'RIFF' ? ds64Data || size - body : len
        dataSize = Math.min(dataSize, size - body)
        dataSize -= dataSize % fmt.blockAlign
        return { ...fmt, dataOffset: body, dataSize, duration: dataSize / fmt.blockAlign / fmt.sampleRate, tags }
      }
      pos = body + len + (len & 1)
    }
    throw new Error('wav 데이터를 찾지 못했습니다')
  } finally {
    await fh.close()
  }
}

// Samples of one block of frames as float channels (more than 2 channels →
// the first two).
function toFloat(buf: Buffer, frames: number, w: WavInfo, out: Float32Array[]): void {
  const bytes = w.bits / 8
  const chans = Math.min(2, w.channels)
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < chans; c++) {
      const o = f * w.blockAlign + c * bytes
      let v: number
      if (w.format === 3) v = w.bits === 64 ? buf.readDoubleLE(o) : buf.readFloatLE(o)
      else if (w.bits === 16) v = buf.readInt16LE(o) / 32768
      else if (w.bits === 24) v = buf.readIntLE(o, 3) / 8388608
      else if (w.bits === 32) v = buf.readInt32LE(o) / 2147483648
      else v = (buf[o] - 128) / 128 // 8-bit unsigned
      out[c][f] = v
    }
  }
}

const LAME_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]

export interface EncodeOptions {
  bitrate: 192 | 256 | 320
}

// Encode `src` into `dst` (overwritten). `onProgress(0..1)`; stops on abort.
export async function encodeWavToMp3(
  src: string,
  dst: string,
  opts: EncodeOptions,
  signal?: AbortSignal,
  onProgress?: (p: number) => void
): Promise<WavInfo> {
  const w = await readWavInfo(src)
  const { createMp3Encoder } = await import('wasm-media-encoders')
  const enc = await createMp3Encoder()
  const channels = Math.min(2, w.channels) as 1 | 2
  // LAME takes 8–48 kHz: higher rates are resampled (96 → 48, 88.2 → 44.1)
  const outRate = LAME_RATES.includes(w.sampleRate) ? undefined : w.sampleRate % 44100 === 0 ? 44100 : 48000
  enc.configure({ sampleRate: w.sampleRate, channels, bitrate: opts.bitrate, ...(outRate ? { outputSampleRate: outRate as 44100 } : {}) })
  const fin = await fs.open(src, 'r')
  const fout = await fs.open(dst, 'w')
  try {
    const framesPer = 1152 * 64
    const buf = Buffer.alloc(framesPer * w.blockAlign)
    const ch = [new Float32Array(framesPer), new Float32Array(framesPer)]
    let done = 0
    const total = w.dataSize / w.blockAlign
    while (done < total) {
      if (signal?.aborted) throw new Error('cancelled')
      const frames = Math.min(framesPer, total - done)
      const { bytesRead } = await fin.read(buf, 0, frames * w.blockAlign, w.dataOffset + done * w.blockAlign)
      const got = Math.floor(bytesRead / w.blockAlign)
      if (!got) break
      toFloat(buf, got, w, ch)
      const out = enc.encode(ch.slice(0, channels).map((c) => c.subarray(0, got)))
      if (out.length) await fout.write(out)
      done += got
      onProgress?.(done / total)
    }
    const tail = enc.finalize()
    if (tail.length) await fout.write(tail)
  } finally {
    await fin.close()
    await fout.close()
  }
  return w
}
