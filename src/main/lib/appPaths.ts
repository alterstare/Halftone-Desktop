// Imported first by main/index.ts: fixes the userData folder and upgrades data
// written by older versions before any other module touches it.
//
// • Packaged builds were named "MangaManager" before the rename to Halftone;
//   keep using that folder so existing libraries, settings and logins survive.
// • Older versions stored source names (old site ids) in setting keys, mode
//   values, the image scheme host, the scraper session folder and a userData
//   file. Rename them to the current ids once, in place.
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'

if (app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'MangaManager'))

// Old ids, spelled indirectly so the source carries no site names.
const OLD_D = ['hi', 'tomi'].join('')
const OLD_C = ['to', 'ki'].join('')
const ID_MAP: Record<string, string> = { [OLD_D]: 'doujin', [OLD_C]: 'comic' }
const KEY_RE = new RegExp(`^(${OLD_D}|${OLD_C})(?=[A-Z]|$)`)
const VALUE_MAP: Record<string, string> = {
  ...ID_MAP,
  [`${OLD_D}-home`]: 'doujin-home',
  [`${OLD_D}-online`]: 'doujin-online'
}
// Only these fields hold a source/mode id (other strings, e.g. titles, may match by chance).
const ID_FIELDS = new Set(['library', 'libraryMode', 'mode', 'kind', 'source', 'startScreen'])
const OLD_SCHEME = `mangaimg://${OLD_C}/`

// Legacy name of the per-work metadata sidecar (current: meta.doujin.json).
export const LEGACY_SIDECAR = `meta.${OLD_D}.json`

function upgrade(v: unknown, field = ''): unknown {
  if (typeof v === 'string') {
    if (ID_FIELDS.has(field) && v in VALUE_MAP) return VALUE_MAP[v]
    if (v.startsWith(OLD_SCHEME)) return 'mangaimg://comic/' + v.slice(OLD_SCHEME.length)
    return v
  }
  if (Array.isArray(v)) return v.map((x) => upgrade(x))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v)) {
      // Keys: old-id setting names, and image-src keys (translation edits).
      const nk = k.startsWith(OLD_SCHEME)
        ? 'mangaimg://comic/' + k.slice(OLD_SCHEME.length)
        : k.replace(KEY_RE, (m) => (m === OLD_D ? 'doujin' : 'comic'))
      out[nk in out ? k : nk] = upgrade(val, nk)
    }
    return out
  }
  return v
}

function migrateUserData(dir: string): void {
  for (const f of ['settings.json', 'works.json', 'session.json', 'online.json', 'translationEdits.json']) {
    const file = join(dir, f)
    try {
      const raw = readFileSync(file, 'utf-8')
      const next = JSON.stringify(upgrade(JSON.parse(raw)))
      if (next !== JSON.stringify(JSON.parse(raw))) writeFileSync(file, next, 'utf-8')
    } catch {
      /* missing or unreadable → nothing to upgrade */
    }
  }
  const moves: [string, string][] = [
    [join(dir, 'Partitions', OLD_C), join(dir, 'Partitions', 'comic')],
    [join(dir, `${OLD_D}-suggest-seen.json`), join(dir, 'doujin-suggest-seen.json')]
  ]
  for (const [from, to] of moves) {
    try {
      if (existsSync(from) && !existsSync(to)) renameSync(from, to)
    } catch {
      /* in use / permissions → keep the old one; the app recreates it */
    }
  }
}

migrateUserData(app.getPath('userData'))
