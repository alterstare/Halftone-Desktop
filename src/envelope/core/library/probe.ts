// Duration and bitrate from file headers only (mp3: Xing/Info/VBRI or CBR,
// wav: fmt + data chunks), so scanning a big library stays fast. Other formats
// return nulls; the player fills in the duration on first play.
import { promises as fs } from 'fs'

export interface Probe {
  duration: number | null // seconds
  bitrate: number | null // kbps
}

const NONE: Probe = { duration: null, bitrate: null }

async function readAt(path: string, pos: number, len: number): Promise<Buffer> {
  const fh = await fs.open(path, 'r')
  try {
    const buf = Buffer.alloc(len)
    const { bytesRead } = await fh.read(buf, 0, len, pos)
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

// `ext` overrides the file's own (e.g. checking "x.mp3.part").
export async function probe(path: string, size: number, ext?: string): Promise<Probe> {
  ext = (ext ?? path.slice(path.lastIndexOf('.') + 1)).replace(/^\./, '').toLowerCase()
  try {
    if (ext === 'mp3') return await probeMp3(path, size)
    if (ext === 'wav') return parseWav(await readAt(path, 0, 64 * 1024), size)
  } catch {
    // unreadable / truncated → unknown
  }
  return NONE
}

// ---- wav ----

export function parseWav(b: Buffer, size: number): Probe {
  // RF64 / BW64: 64-bit wav (data size 0xFFFFFFFF, real size in ds64) — the
  // file size fallback below covers it.
  if (b.length < 12 || !/^(RIFF|RF64|BW64)$/.test(b.toString('ascii', 0, 4)) || b.toString('ascii', 8, 12) !== 'WAVE') return NONE
  let byteRate = 0
  let pos = 12
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4)
    const len = b.readUInt32LE(pos + 4)
    if (id === 'fmt ' && pos + 16 <= b.length) byteRate = b.readUInt32LE(pos + 16)
    if (id === 'data') {
      if (!byteRate) return NONE
      // Streams written without a final size say 0 / 0xFFFFFFFF: use the file.
      const data = len === 0 || len === 0xffffffff || pos + 8 + len > size ? size - pos - 8 : len
      return { duration: data / byteRate, bitrate: Math.round((byteRate * 8) / 1000) }
    }
    pos += 8 + len + (len & 1)
  }
  return NONE
}

// ---- mp3 ----

const BITRATES: Record<string, number[]> = {
  // [version][layer] tables, kbps; index 0 = free, 15 = bad
  'v1l1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  'v1l2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  'v1l3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  'v2l1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  'v2l2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  'v2l3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
}
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }

export interface FrameHeader {
  version: 3 | 2 | 0 // MPEG 1 / 2 / 2.5 (header bits)
  layer: 1 | 2 | 3
  bitrate: number // kbps
  sampleRate: number
  mono: boolean
  samples: number // per frame
}

export function parseFrameHeader(b: Buffer, at: number): FrameHeader | null {
  if (at + 4 > b.length || b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) return null
  const v = (b[at + 1] >> 3) & 3
  const l = (b[at + 1] >> 1) & 3
  const bi = b[at + 2] >> 4
  const si = (b[at + 2] >> 2) & 3
  if (v === 1 || l === 0 || bi === 15 || si === 3) return null
  const version = v as 3 | 2 | 0
  const layer = (4 - l) as 1 | 2 | 3
  const bitrate = BITRATES[`${version === 3 ? 'v1' : 'v2'}l${layer}`][bi]
  const sampleRate = RATES[version][si]
  const mono = b[at + 3] >> 6 === 3
  const samples = layer === 1 ? 384 : layer === 2 || version === 3 ? 1152 : 576
  return { version, layer, bitrate, sampleRate, mono, samples }
}

async function probeMp3(path: string, size: number): Promise<Probe> {
  const head = await readAt(path, 0, 10)
  let start = 0
  if (head.length === 10 && head.toString('ascii', 0, 3) === 'ID3') {
    // syncsafe tag size (+ footer)
    start = 10 + ((head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9]) + (head[5] & 0x10 ? 10 : 0)
  }
  return parseMp3(await readAt(path, start, 64 * 1024), start, size)
}

// `b` = file bytes from `start` (after any ID3v2 tag).
export function parseMp3(b: Buffer, start: number, size: number): Probe {
  let at = 0
  let h: FrameHeader | null = null
  for (; at + 4 <= b.length; at++) if ((h = parseFrameHeader(b, at))) break
  if (!h) return NONE
  const audio = size - start - at
  // Xing / Info: after the side info.
  const side = h.version === 3 ? (h.mono ? 17 : 32) : h.mono ? 9 : 17
  const x = at + 4 + side
  const tag = b.toString('ascii', x, x + 4)
  let frames = 0
  if ((tag === 'Xing' || tag === 'Info') && x + 12 <= b.length && b.readUInt32BE(x + 4) & 1) frames = b.readUInt32BE(x + 8)
  // VBRI: "VBRI", version, delay, quality (2 each), bytes, frames (4 each)
  else if (b.toString('ascii', at + 36, at + 40) === 'VBRI' && at + 54 <= b.length) frames = b.readUInt32BE(at + 50)
  if (frames) {
    const duration = (frames * h.samples) / h.sampleRate
    return { duration, bitrate: Math.round((audio * 8) / duration / 1000) }
  }
  if (!h.bitrate) return NONE
  return { duration: (audio * 8) / (h.bitrate * 1000), bitrate: h.bitrate }
}
