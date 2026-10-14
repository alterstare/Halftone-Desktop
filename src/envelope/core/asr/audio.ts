// 16 kHz mono PCM: what every speech engine here takes. The app decodes tracks
// in the renderer (Web Audio handles every format Chromium plays); plain wav
// files can also be read here (tests, and a fallback without a window).

export const ASR_RATE = 16000

// Int16 PCM → a RIFF wav file (16-bit mono).
export function wavFromPcm16(pcm: Int16Array, rate = ASR_RATE): Buffer {
  const data = pcm.length * 2
  const b = Buffer.alloc(44 + data)
  b.write('RIFF', 0, 'ascii')
  b.writeUInt32LE(36 + data, 4)
  b.write('WAVEfmt ', 8, 'ascii')
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate * 2, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36, 'ascii')
  b.writeUInt32LE(data, 40)
  Buffer.from(pcm.buffer, pcm.byteOffset, data).copy(b, 44)
  return b
}

// A PCM wav (8/16/24/32-bit int or 32-bit float, any channels/rate) → 16 kHz
// mono Int16 (channels averaged, linear resampling).
export function pcm16FromWav(buf: Buffer): Int16Array {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' && buf.toString('ascii', 0, 4) !== 'RF64') throw new Error('wav 파일이 아닙니다')
  let off = 12
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null
  let dataOff = -1
  let dataLen = 0
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    let size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') {
      let format = buf.readUInt16LE(off + 8)
      if (format === 0xfffe) format = buf.readUInt16LE(off + 8 + 24) // extensible: sub-format
      fmt = { format, channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) }
    } else if (id === 'data') {
      dataOff = off + 8
      if (size === 0xffffffff || dataOff + size > buf.length) size = buf.length - dataOff
      dataLen = size
      break
    }
    off += 8 + size + (size & 1)
  }
  if (!fmt || dataOff < 0) throw new Error('wav 구조를 읽지 못했습니다')
  const { format, channels, rate, bits } = fmt
  const bytes = bits / 8
  const frames = Math.floor(dataLen / (bytes * channels))
  const read = (i: number): number => {
    const p = dataOff + i * bytes
    if (format === 3 && bits === 32) return buf.readFloatLE(p)
    if (bits === 8) return (buf[p] - 128) / 128
    if (bits === 16) return buf.readInt16LE(p) / 32768
    if (bits === 24) return buf.readIntLE(p, 3) / 8388608
    if (bits === 32) return buf.readInt32LE(p) / 2147483648
    return 0
  }
  const mono = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let s = 0
    for (let c = 0; c < channels; c++) s += read(f * channels + c)
    mono[f] = s / channels
  }
  return toPcm16(resample(mono, rate, ASR_RATE))
}

export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x
  const n = Math.floor((x.length * to) / from)
  const out = new Float32Array(n)
  const k = from / to
  for (let i = 0; i < n; i++) {
    const p = i * k
    const j = Math.floor(p)
    const t = p - j
    out[i] = (x[j] ?? 0) * (1 - t) + (x[j + 1] ?? x[j] ?? 0) * t
  }
  return out
}

export function toPcm16(x: Float32Array): Int16Array {
  const out = new Int16Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767)))
  return out
}
