import type { Work } from '../../shared/types'
import { langCategory } from '../../shared/lang'
import { titleNorm, titleSim as sim } from '../../shared/title'

export { titleNorm }
// Strict similarity: auto-detected pairs must be clearly the same work.
export const titleSim = (a: string, b: string): number => sim(a, b, 'strict')

// Duplicate detection (#2) + already-downloaded translation pairing (#4).

// Artist values that mean "unknown" — treated as empty so they never match.
const NA_ARTIST = new Set(['', 'na', 'n/a', 'nan', '없음', 'unknown', 'anonymous', '?'])
function realArtist(a: string | null): string {
  const v = (a ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  return NA_ARTIST.has(v) ? '' : v
}

function hamming(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b)
  let n = 0
  while (x) {
    n += Number(x & 1n)
    x >>= 1n
  }
  return n
}

// dHash distance under this many bits (of 64) = same cover image.
const COVER_THRESHOLD = 8

// Artist taken from the FOLDER NAME (text before the [code] bracket), not from
// online tags — so duplicate detection works for doujin-deleted works too.
// Both 중복 작품 and 번역본 정리 use it.
function folderArtist(w: Work): string {
  const base = w.path.split(/[\\/]/).pop() ?? ''
  const m = base.match(/[[(]\s*\d{4,}\s*[\])]/)
  const head = m && m.index ? base.slice(0, m.index) : ''
  return head.toLowerCase().replace(/\s+/g, ' ').trim()
}
const artistKey = (w: Work): string => folderArtist(w)

// The folder artist split into names ("a, b & c" → a / b / c), unknowns dropped.
function artistNames(w: Work): Set<string> {
  return new Set(
    folderArtist(w)
      .split(/\s*[,、&]\s*/)
      .map(realArtist)
      .filter(Boolean)
  )
}

// Keeper priority for a duplicate group: 1) Korean, 2) higher cover resolution,
// 3) newer. Returned as a comparable tuple (higher is better).
function keeperScore(w: Work): [number, number, number] {
  return [
    langCategory(w.language) === 'korean' ? 1 : 0,
    (w.coverW ?? 0) * (w.coverH ?? 0),
    w.mtime
  ]
}
export function pickKeeper(group: Work[]): Work {
  return [...group].sort((a, b) => {
    const sa = keeperScore(a)
    const sb = keeperScore(b)
    return sb[0] - sa[0] || sb[1] - sa[1] || sb[2] - sa[2]
  })[0]
}

// Union-find for grouping.
class DSU {
  parent: number[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]]
      i = this.parent[i]
    }
    return i
  }
  union(a: number, b: number): void {
    this.parent[this.find(a)] = this.find(b)
  }
}

// Policy: works are duplicates only if SAME ARTIST and (exact normalized title
// OR near-identical cover dHash corroborated by title similarity). The title
// check on cover matches stops a series (same artist, similar art) from being
// collapsed into one group, and stops style-similar different works.
// Bits set in a 32-bit int.
function popcount32(x: number): number {
  x -= (x >>> 1) & 0x55555555
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}
const nextFrame = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

// Runs in slices of ~12 ms that hand the thread back between them, so the
// screen keeps drawing (a library of ~5000 works with empty folder artists —
// pixiv folders — has millions of cover pairs in one artist). `onProgress`
// gets 0..1; a true `cancelled()` stops it (returns null).
export async function findDuplicateGroups(
  works: Work[],
  onProgress?: (f: number) => void,
  cancelled?: () => boolean
): Promise<Work[][] | null> {
  const n = works.length
  const dsu = new DSU(n)
  const norms = works.map((w) => titleNorm(w.title))
  const akeys = works.map(artistKey)

  // Same artist + exact normalized title.
  const byKey = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    if (!norms[i]) continue
    const key = akeys[i] + '\u0000' + norms[i]
    const prev = byKey.get(key)
    if (prev !== undefined) dsu.union(prev, i)
    else byKey.set(key, i)
  }
  // Same artist + similar cover + similar title: pairs within each artist's
  // hashed works; the 64-bit dHash as two 32-bit halves.
  const buckets = new Map<string, { i: number; hi: number; lo: number }[]>()
  for (let i = 0; i < n; i++) {
    const h = works[i].coverHash
    if (!h || h.length !== 16) continue
    const arr = buckets.get(akeys[i]) ?? []
    arr.push({ i, hi: parseInt(h.slice(0, 8), 16) | 0, lo: parseInt(h.slice(8), 16) | 0 })
    buckets.set(akeys[i], arr)
  }
  let total = 0
  for (const b of buckets.values()) total += (b.length * (b.length - 1)) / 2
  let done = 0
  let t0 = performance.now()
  for (const b of buckets.values()) {
    for (let x = 0; x < b.length; x++) {
      const p = b[x]
      for (let y = x + 1; y < b.length; y++) {
        const q = b[y]
        if (popcount32(p.hi ^ q.hi) + popcount32(p.lo ^ q.lo) > COVER_THRESHOLD) continue
        if (titleSim(works[p.i].title, works[q.i].title) < 0.6) continue
        dsu.union(p.i, q.i)
      }
      done += b.length - 1 - x
      if (performance.now() - t0 > 12) {
        onProgress?.(total ? done / total : 1)
        await nextFrame()
        if (cancelled?.()) return null
        t0 = performance.now()
      }
    }
  }

  const groups = new Map<number, Work[]>()
  for (let i = 0; i < n; i++) {
    const r = dsu.find(i)
    ;(groups.get(r) ?? groups.set(r, []).get(r)!).push(works[i])
  }
  onProgress?.(1)
  return [...groups.values()].filter((g) => g.length >= 2)
}

// #4: within the library, pair a non-Korean work with its Korean translation(s).
// Match = a folder-artist name in common AND (similar title OR same cover).
export interface TranslationPair {
  source: Work // the non-Korean work
  matches: Work[] // Korean works that look like its translation
}
export function findTranslationPairs(works: Work[]): TranslationPair[] {
  const korean = works.filter((w) => langCategory(w.language) === 'korean')
  if (!korean.length) return []
  const out: TranslationPair[] = []
  for (const w of works) {
    const cat = langCategory(w.language)
    if (cat === null || cat === 'korean') continue // need a known non-Korean source
    const wa = artistNames(w)
    if (!wa.size) continue // require a real artist (NA/empty never matches)
    const matches = korean.filter((k) => {
      // same artist = a whole name in common (an anthology's list matched any
      // of its artists' works when compared as text)
      if (![...artistNames(k)].some((a) => wa.has(a))) return false
      const titleOk = titleSim(w.title, k.title) >= 0.6
      const coverOk =
        !!w.coverHash && !!k.coverHash && hamming(w.coverHash, k.coverHash) <= COVER_THRESHOLD
      return titleOk || coverOk
    })
    if (matches.length) out.push({ source: w, matches })
  }
  return out
}
