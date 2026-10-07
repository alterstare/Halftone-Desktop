// Build build/icon.ico from build/icon.png with every size Windows asks for
// (16–256). electron-builder's own PNG→ICO conversion leaves the small sizes to
// Windows' coarse downscaler, which turns the halftone dots into blotches on the
// taskbar / desktop. Here each size is pre-rendered with an area-average
// (box) filter in premultiplied alpha, so dots blend into smooth tone and the
// transparent edge stays clean.
//   node scripts/make-ico.cjs
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'build/icon.png')
const OUT = path.join(ROOT, 'build/icon.ico')
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]

const src = PNG.sync.read(fs.readFileSync(SRC))

// Area-average resize: each target pixel = coverage-weighted mean of the source
// pixels under it (color premultiplied by alpha, so transparent pixels don't
// darken the edge).
function resize(img, n) {
  const { width: w, height: h, data } = img
  const out = new PNG({ width: n, height: n })
  const sx = w / n
  const sy = h / n
  for (let ty = 0; ty < n; ty++) {
    const y0 = ty * sy
    const y1 = y0 + sy
    for (let tx = 0; tx < n; tx++) {
      const x0 = tx * sx
      const x1 = x0 + sx
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let wsum = 0
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0)
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const wt = wy * (Math.min(x + 1, x1) - Math.max(x, x0))
          const i = (y * w + x) * 4
          const al = data[i + 3] / 255
          r += data[i] * al * wt
          g += data[i + 1] * al * wt
          b += data[i + 2] * al * wt
          a += al * wt
          wsum += wt
        }
      }
      const o = (ty * n + tx) * 4
      const A = a / wsum
      out.data[o] = A ? Math.round(r / a) : 0
      out.data[o + 1] = A ? Math.round(g / a) : 0
      out.data[o + 2] = A ? Math.round(b / a) : 0
      out.data[o + 3] = Math.round(A * 255)
    }
  }
  return out
}

// ICO container with PNG-encoded entries (supported since Vista).
const images = SIZES.map((n) => PNG.sync.write(resize(src, n)))
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(images.length, 4)
const dir = Buffer.alloc(16 * images.length)
let offset = 6 + dir.length
images.forEach((buf, k) => {
  const n = SIZES[k]
  const e = k * 16
  dir.writeUInt8(n >= 256 ? 0 : n, e)
  dir.writeUInt8(n >= 256 ? 0 : n, e + 1)
  dir.writeUInt8(0, e + 2)
  dir.writeUInt8(0, e + 3)
  dir.writeUInt16LE(1, e + 4)
  dir.writeUInt16LE(32, e + 6)
  dir.writeUInt32LE(buf.length, e + 8)
  dir.writeUInt32LE(offset, e + 12)
  offset += buf.length
})
fs.writeFileSync(OUT, Buffer.concat([header, dir, ...images]))
console.log(`wrote ${path.relative(ROOT, OUT)} (${SIZES.join(', ')})`)
