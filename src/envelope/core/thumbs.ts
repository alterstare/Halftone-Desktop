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
