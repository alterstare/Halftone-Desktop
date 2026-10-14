// Copy Envelope (the voice-work player, ../doujin_player) into src/envelope so
// Halftone can show it as the 음성 플레이어 panel. Envelope stays the source
// of truth: change it there, then run `npm run sync-envelope` here. Copies the
// engine (core), shared types, the embeddable main-process host and its wav
// encoder worker, the renderer API and the renderer itself; Envelope's own app
// shell (window, updater, mini-mode window) stays out.
//   node scripts/sync-envelope.mjs [path-to-envelope]
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = resolve(process.argv[2] ?? join(root, '../doujin_player'))
const to = join(root, 'src/envelope')
if (!existsSync(join(from, 'src/core'))) {
  console.error(`Envelope not found at ${from}`)
  process.exit(1)
}

rmSync(to, { recursive: true, force: true })
const copy = (rel, dest = rel) => {
  mkdirSync(dirname(join(to, dest)), { recursive: true })
  cpSync(join(from, 'src', rel), join(to, dest), { recursive: true })
}
copy('core')
copy('shared')
copy('main/host.ts')
copy('main/encodeWorker.ts')
copy('preload/api.ts')
copy('preload/index.d.ts') // window.api typing for the Envelope renderer (tsconfig.envelope.json)
copy('renderer/src')

const pkg = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8'))
writeFileSync(
  join(to, 'README.md'),
  `# src/envelope — generated, do not edit\n\nCopied from Envelope ${pkg.version} by \`npm run sync-envelope\`. Edit Envelope (https://github.com/alterstare/Envelope) and sync again.\n`
)
writeFileSync(join(to, 'version.ts'), `// Envelope version this copy was synced from.\nexport const ENVELOPE_VERSION = '${pkg.version}'\n`)
console.log(`synced Envelope ${pkg.version} → src/envelope`)
