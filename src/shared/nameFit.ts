// Folder-name length rules, shared with the mobile app (its src/backend/lib/nameFit.ts).
//
// One folder name is at most NAME_MAX_CHARS characters AND NAME_MAX_BYTES UTF-8
// bytes, whichever is hit first: 80 Latin chars, or 60 Korean/Japanese/CJK chars
// (3 bytes each). Why: a phone's ext4 allows 255 bytes per name, and Windows'
// 260-char path limit — e.g. "C:\Users\…\Downloads\MangaManager\doujin\" (~45)
// + group (≤80) + work (≤80) + "0001.webp" ≈ 220 — so libraries copied to a PC
// or NAS still fit.
//
// Doujin names shrink the title first (ending in …), then the artist, then the
// group; the gallery code is never cut. Every other folder (general-manga
// series/chapter, group) is cut from the end.

export const NAME_MAX_CHARS = 80
export const NAME_MAX_BYTES = 180

const BAD = /[\\/:*?"<>|\x00-\x1f]/g
const ELLIPSIS = '…'

const chars = (s: string): string[] => Array.from(s) // code points: never split a surrogate pair
const byteLen = (s: string): number => new TextEncoder().encode(s).length

export function nameFits(s: string): boolean {
  return chars(s).length <= NAME_MAX_CHARS && byteLen(s) <= NAME_MAX_BYTES
}

// Drop forbidden characters (\ / : * ? " < > | and control chars) and collapse
// whitespace. `replacement` keeps the old group-folder behaviour ('_').
export function cleanName(s: string, replacement = ''): string {
  return s.replace(BAD, replacement).replace(/\s+/g, ' ').trim()
}

// Windows strips a trailing '.' or space from a path segment at create time, so
// the folder on disk would no longer match the recorded path. Strip them here
// (after any cut, which can newly expose one).
const trimEnd = (s: string): string => s.replace(/[.\s]+$/, '').trim()

// Longest prefix of `s` (in code points) that keeps `wrap(prefix)` within the limits.
function longestFit(s: string, wrap: (part: string) => string): string | null {
  const cs = chars(s)
  let lo = 0
  let hi = cs.length
  if (!nameFits(wrap(''))) return null
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (nameFits(wrap(cs.slice(0, mid).join('')))) lo = mid
    else hi = mid - 1
  }
  return cs.slice(0, lo).join('')
}

// Cut from the end to fit. Used for general-manga series/chapter folders and groups.
export function fitName(s: string, fallback = 'untitled', replacement = ''): string {
  const clean = cleanName(s, replacement)
  const cut = nameFits(clean) ? clean : (longestFit(clean, (p) => p) ?? '')
  return trimEnd(cut) || fallback
}

export interface DoujinNameParts {
  title: string
  artist: string
  group: string
}

// Fit a doujin folder name built by `build(parts)`: shorten the title (ending
// in …), then the artist, then the group, until it fits. Fields the pattern
// doesn't use have no effect, and the code is part of the pattern text so it
// is never shortened. If it still doesn't fit (e.g. a very long literal in the
// pattern), the result is cut from the end.
export function fitDoujinName(build: (p: DoujinNameParts) => string, parts: DoujinNameParts, fallback = 'untitled'): string {
  const make = (p: DoujinNameParts): string => trimEnd(cleanName(build(p)))
  let cur = { ...parts }
  if (nameFits(make(cur))) return make(cur) || fallback
  for (const key of ['title', 'artist', 'group'] as const) {
    const full = cleanName(cur[key])
    if (!full) continue
    const withPart = (p: string): string => make({ ...cur, [key]: p ? p + ELLIPSIS : '' })
    const keep = longestFit(full, withPart)
    if (keep !== null) {
      cur = { ...cur, [key]: keep ? keep + ELLIPSIS : '' }
      return make(cur) || fallback
    }
    cur = { ...cur, [key]: '' } // even dropping this field doesn't fit → shrink the next one too
  }
  return fitName(make(cur), fallback)
}
