// Small cached JPEGs of cover / background images for the library grid and
// the mini player (originals are often several MB). Cached by path + size +
// mtime, so an edited image gets a new thumbnail.
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { join } from 'path'

export const THUMB_SIZE = 480

const pending = new Map<string, Promise<string>>()

export async function thumbnail(src: string, dir: string, size = THUMB_SIZE): Promise<string> {
  const st = await fs.stat(src)
  const key = createHash('sha1').update(`${src}|${st.size}|${Math.floor(st.mtimeMs)}|${size}|inside`).digest('hex')
  const out = join(dir, `${key}.jpg`)
  try {
    await fs.access(out)
    return out
  } catch {
    // not made yet
  }
  let p = pending.get(out)
  if (!p) {
    p = (async () => {
      const sharp = (await import('sharp')).default
      sharp.cache(false) // an open cache keeps library files locked on Windows
      const tmp = `${out}.${process.pid}.tmp`
      await sharp(src, { failOn: 'none' })
        .rotate()
        .resize(size, size, { fit: 'inside', withoutEnlargement: true }) // whole picture, never cropped
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(tmp)
      await fs.rename(tmp, out)
      return out
    })().finally(() => pending.delete(out))
    pending.set(out, p)
  }
  return p
}

// The picture's colour as "#rrggbb" (null: unreadable): the hue most of its
// coloured pixels share (weighted by how vivid they are — black lettering,
// white and grey don't count), averaged; a grey picture gives its mean colour.
// Remembered per path + size + date.
const colours = new Map<string, string | null>()
export async function dominantColour(src: string): Promise<string | null> {
  try {
    const st = await fs.stat(src)
    const key = `${src}|${st.size}|${Math.floor(st.mtimeMs)}`
    if (colours.has(key)) return colours.get(key)!
    const sharp = (await import('sharp')).default
    sharp.cache(false)
    const { data, info } = await sharp(src, { failOn: 'none' }).resize(48, 48, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const bins = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }))
    const mean = { r: 0, g: 0, b: 0, n: 0 }
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i], g = data[i + 1], b = data[i + 2]
      mean.r += r; mean.g += g; mean.b += b; mean.n++
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      const v = max / 255
      const sat = max ? (max - min) / max : 0
      if (sat < 0.25 || v < 0.2 || v > 0.97) continue // grey, black, white
      const d = max - min
      const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
      const bin = bins[Math.floor(h * 2) % 12]
      const w = sat * v
      bin.w += w; bin.r += r * w; bin.g += g * w; bin.b += b * w
    }
    const top = bins.reduce((a, b) => (b.w > a.w ? b : a))
    const [r, g, b] = top.w > 0.5 ? [top.r / top.w, top.g / top.w, top.b / top.w] : [mean.r / mean.n, mean.g / mean.n, mean.b / mean.n]
    const hex = '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
    colours.set(key, hex)
    return hex
  } catch {
    return null
  }
}
