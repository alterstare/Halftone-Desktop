// Copy Sorta (the character image sorter, ../sorta) into src/sorta so Halftone
// can show it as the "캐릭터 분류" mode. Sorta stays the source of truth:
// change it there, then run `npm run sync-sorta` here. Copies the engine
// (core), shared types, the embeddable main-process host, the renderer API
// and the renderer itself; Sorta's own app shell (window, updater) stays out.
//   node scripts/sync-sorta.mjs [path-to-sorta]
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = resolve(process.argv[2] ?? join(root, '../sorta'))
const to = join(root, 'src/sorta')
if (!existsSync(join(from, 'src/core'))) {
  console.error(`Sorta not found at ${from}`)
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
copy('preload/api.ts')
copy('preload/index.d.ts') // window.api typing for the Sorta renderer (tsconfig.sorta.json)
copy('renderer/src')

const pkg = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8'))
writeFileSync(
  join(to, 'README.md'),
  `# src/sorta — generated, do not edit\n\nCopied from Sorta ${pkg.version} by \`npm run sync-sorta\`. Edit Sorta (https://github.com/alterstare/Sorta) and sync again.\n`
)
writeFileSync(join(to, 'version.ts'), `// Sorta version this copy was synced from.\nexport const SORTA_VERSION = '${pkg.version}'\n`)
console.log(`synced Sorta ${pkg.version} → src/sorta`)
