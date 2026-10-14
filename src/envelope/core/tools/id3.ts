// ID3v2 tag region of an mp3: read without loading the whole file, back it up,
// put a backed-up region back (undo of 썸네일 넣기).
import { promises as fs } from 'fs'

async function head(path: string, n: number): Promise<Buffer> {
  const fh = await fs.open(path, 'r')
  try {
    const b = Buffer.alloc(n)
    const { bytesRead } = await fh.read(b, 0, n, 0)
    return b.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

// Length of the ID3v2 tag at the start of the file (0 = none).
export async function tagLength(path: string): Promise<number> {
  const h = await head(path, 10)
  if (h.length < 10 || h.toString('ascii', 0, 3) !== 'ID3') return 0
  return 10 + ((h[6] << 21) | (h[7] << 14) | (h[8] << 7) | h[9]) + (h[5] & 0x10 ? 10 : 0)
}

export async function readTag(path: string): Promise<Buffer> {
  const n = await tagLength(path)
  return n ? head(path, n) : Buffer.alloc(0)
}

// Does the tag have a picture frame (APIC, or PIC in v2.2)?
export async function hasCover(path: string): Promise<boolean> {
  const tag = await readTag(path)
  if (!tag.length) return false
  const v = tag[3]
  let p = 10
  if (tag[5] & 0x40) p += v === 4 ? ((tag[10] << 21) | (tag[11] << 14) | (tag[12] << 7) | tag[13]) : 4 + tag.readUInt32BE(10) // extended header
  const idLen = v === 2 ? 3 : 4
  const hdr = v === 2 ? 6 : 10
  while (p + hdr <= tag.length) {
    const id = tag.toString('ascii', p, p + idLen)
    if (!/^[A-Z0-9]+$/.test(id)) break // padding
    if (id === 'APIC' || id === 'PIC') return true
    const size =
      v === 2
        ? (tag[p + 3] << 16) | (tag[p + 4] << 8) | tag[p + 5]
        : v === 4
          ? (tag[p + 4] << 21) | (tag[p + 5] << 14) | (tag[p + 6] << 7) | tag[p + 7]
          : tag.readUInt32BE(p + 4)
    p += hdr + size
  }
  return false
}

// Replace the file's current tag with `tag` (empty = no tag). Written to a
// temporary file first, then swapped in.
export async function replaceTag(path: string, tag: Buffer): Promise<void> {
  const cur = await tagLength(path)
  const st = await fs.stat(path)
  const data = await fs.readFile(path)
  const tmp = `${path}.env-tmp`
  await fs.writeFile(tmp, Buffer.concat([tag, data.subarray(cur)]))
  await fs.rename(tmp, path)
  await fs.utimes(path, st.atime, st.mtime)
}
