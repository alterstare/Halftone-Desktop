// 이름 번역: a work's title and track names go to the translator together (one
// context: character names and terms stay consistent). Work codes and track
// numbers are cut off first and put back, so only words are translated.
// Results live in the `names` table by path — shown instead of the original
// when the user picks it; files change only through the rename tool.
import type { Db } from '../db'
import type { GlossaryEntry, Translator } from '../translate'
import { translateLines } from '../translate'

// "RJ01234567 ", "01_", "1.", "0-1.", "トラック１_", "Track 2 ", "Tr03-" …
const PREFIX = /^(?:(?:RJ|VJ|BJ)\d{6,8}[\s_\-]*|[0-9０-９]+(?:[-.][0-9０-９]+)*[._\-)）\s]+|(?:トラック|track|tr\.?)\s*[0-9０-９]+[._\-\s]*)/i

export function splitName(name: string): { prefix: string; body: string } {
  let prefix = ''
  let rest = name
  for (let m = rest.match(PREFIX); m && m[0]; m = rest.match(PREFIX)) {
    prefix += m[0]
    rest = rest.slice(m[0].length)
  }
  return { prefix, body: rest }
}

const hasJapanese = (s: string): boolean => /[぀-ヿ㐀-鿿]/.test(s)

// A name worth translating: Japanese left after the code / track number.
export const needsTranslation = (name: string): boolean => hasJapanese(splitName(name).body)

export interface NameItem {
  path: string
  name: string // repaired name without extension
}

// Translate the names (only those with Japanese in them) and store them.
export async function translateNames(
  db: Db,
  items: NameItem[],
  tr: Translator,
  glossary: GlossaryEntry[],
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
  onWait?: (seconds: number) => void
): Promise<number> {
  const parts = items.map((it) => ({ ...it, ...splitName(it.name) })).filter((p) => p.body.trim() && hasJapanese(p.body))
  const bodies = [...new Set(parts.map((p) => p.body))]
  if (!bodies.length) return 0
  const out = await translateLines(bodies, tr, { kind: 'name', glossary, signal, onWait }, onProgress)
  const map = new Map(bodies.map((b, i) => [b, out[i].trim()]))
  const put = db.prepare(
    'INSERT INTO names (path, translated, engine, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET translated = excluded.translated, engine = excluded.engine, updated_at = excluded.updated_at'
  )
  let n = 0
  db.transaction(() => {
    for (const p of parts) {
      const t = map.get(p.body)
      if (!t) continue
      put.run(p.path, (p.prefix + t).trim(), tr.id, Date.now())
      n++
    }
  })()
  return n
}

export function namesMap(db: Db): Map<string, string> {
  const rows = db.prepare('SELECT path, translated FROM names').all() as { path: string; translated: string }[]
  return new Map(rows.map((r) => [r.path, r.translated]))
}
