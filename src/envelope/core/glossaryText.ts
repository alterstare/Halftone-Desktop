// 용어집 from a text document (txt / md / csv / tsv): one pair per line —
// "원문 → 번역", "원문 -> 번역", "원문 = 번역", "원문: 번역", "원문<tab>번역",
// "원문, 번역", a markdown table row "| 원문 | 번역 |" or a list item
// "- 원문 → 번역". Headers, table rules, comments (#, //) and blank lines are
// skipped.
import type { GlossaryEntry } from '../shared/types'

const HEADER = /^(원문|원어|source|src|일본어|japanese|from)$/i
const SEPS = ['→', '⇒', '->', '=>', '\t', '＝', '=', '：', ':', '，', ',']

export function parseGlossaryText(text: string): GlossaryEntry[] {
  const out: GlossaryEntry[] = []
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    let line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue
    line = line.replace(/^(?:[-*+•]|\d+[.)])\s+/, '') // list bullets
    let pair: [string, string] | null = null
    if (line.startsWith('|')) {
      const cells = line.split('|').map((c) => c.trim()).filter((c, i, a) => !(c === '' && (i === 0 || i === a.length - 1)))
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue // | --- | --- |
      if (cells.length >= 2) pair = [cells[0], cells[1]]
    } else {
      for (const sep of SEPS) {
        const at = line.indexOf(sep)
        if (at > 0) {
          pair = [line.slice(0, at), line.slice(at + sep.length)]
          break
        }
      }
    }
    if (!pair) continue
    const [source, target] = pair.map((x) => x.trim().replace(/^["'「『](.*)["'」』]$/, '$1').trim())
    if (!source || !target || HEADER.test(source)) continue
    out.push({ source, target })
  }
  return out
}

// The list with the new pairs in: the same 원문 takes the new 번역.
export function mergeGlossary(own: GlossaryEntry[], add: GlossaryEntry[]): { entries: GlossaryEntry[]; added: number; changed: number } {
  const entries = own.map((e) => ({ ...e }))
  let added = 0
  let changed = 0
  for (const a of add) {
    const hit = entries.find((e) => e.source === a.source)
    if (!hit) {
      entries.push(a)
      added++
    } else if (hit.target !== a.target) {
      hit.target = a.target
      changed++
    }
  }
  return { entries, added, changed }
}
