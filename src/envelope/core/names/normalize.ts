// Name normalization for matching (CLAUDE.md §5.1): the same track shows up
// under slightly different names in each version folder.
import { SE_PATTERNS } from '../library/roles'

export const nfkc = (s: string): string => s.normalize('NFKC')

// Strip every extension, including double ones (`x.mp3.vtt` → `x`).
const MEDIA_EXT = /\.(mp3|wav|flac|m4a|aac|ogg|opus|mp4|m4v|webm|vtt|srt|lrc|ass|ssa|txt)$/i
export function stem(name: string): string {
  let s = name
  while (MEDIA_EXT.test(s)) s = s.replace(MEDIA_EXT, '')
  return s
}

// Key that is equal for versions of one track: no SE markers, no spacing or
// punctuation differences, no width/case differences.
export function trackKey(fileStem: string): string {
  let s = nfkc(fileStem).toLowerCase()
  for (const re of SE_PATTERNS) s = s.replace(re, ' ')
  const key = s.replace(/[^\p{L}\p{N}]/gu, '')
  return key || nfkc(fileStem).toLowerCase()
}

// First number in the name ("トラック１" → 1, "Tr01_" → 1); dates and other
// long numbers are not track numbers.
export function trackNumber(fileStem: string): number | null {
  const m = nfkc(fileStem).match(/\d+/)
  if (!m) return null
  const n = Number(m[0])
  return n < 1000 ? n : null
}

const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' })
export function naturalCompare(a: string, b: string): number {
  return collator.compare(nfkc(a), nfkc(b))
}
