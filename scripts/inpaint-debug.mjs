// Inpaint debugger: run the real local OCR + in-place translation drawing on one
// image and see why each block did / didn't get bubble layout.
//   node scripts/inpaint-debug.mjs <image> [outDir] [--tr "line1|line2"] [--nomask]
// Needs the local OCR models (설정 › 번역) in %APPDATA%/Halftone/ocr-models.
// Writes result.png / debug.png / debug.json to outDir (default .inpaint-debug/).
// Env IP_LAMA=<lama.onnx>: erase text on the art with the inpainting model.
import { build } from 'esbuild'
import { spawnSync } from 'child_process'
import { promises as fs } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const here = join(root, 'scripts', 'inpaint-debug')
const args = process.argv.slice(2)
const trAt = args.indexOf('--tr')
const tr = trAt >= 0 ? args.splice(trAt, 2)[1] : '-'
// --nomask: draw without the OCR text mask, as the translation editor and saved edits do.
const nmAt = args.indexOf('--nomask')
if (nmAt >= 0) args.splice(nmAt, 1)
process.env.IP_NOMASK = nmAt >= 0 ? '1' : ''
const [image, outArg] = args
if (!image) {
  console.error('usage: node scripts/inpaint-debug.mjs <image> [outDir] [--tr "line1|line2"]')
  process.exit(1)
}
const outDir = resolve(outArg ?? join(root, '.inpaint-debug'))
const gen = join(here, '.gen')
await fs.mkdir(gen, { recursive: true })

// inpaint.ts with its internals exported, for the renderer half.
const src = await fs.readFile(join(root, 'src/renderer/src/inpaint.ts'), 'utf8')
await fs.writeFile(
  join(gen, 'inpaint.ts'),
  src.replaceAll("'../../shared/ipc'", "'../../../src/shared/ipc'") +
    '\nexport { planJobs, layoutFor, layoutAll, targetFont }\n'
)
await build({
  entryPoints: [join(here, 'renderer.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'IP',
  outfile: join(gen, 'renderer.js'),
  logLevel: 'error'
})
await build({
  entryPoints: [join(here, 'main.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron', 'onnxruntime-node'],
  outfile: join(gen, 'main.cjs'),
  logLevel: 'error'
})

const electron = join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
const r = spawnSync(electron, [join(gen, 'main.cjs'), resolve(image), outDir, join(gen, 'renderer.js'), tr], {
  stdio: 'inherit',
  cwd: root
})
console.log(`→ ${outDir}`)
process.exit(r.status ?? 1)
