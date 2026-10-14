// 작품 통합: several local works read as ONE work while their folders stay as
// they are — a manual collection (settings.manualCollections; the scanner
// folds the folders into one Work whose `sources` = the folders, pages
// concatenated). 통합 해제 drops the entry. Both rebuild only the works of the
// folders involved (window.api.setCollections), as an activity-bar job.
// Same model as the mobile app (MangaManagerMobile src/renderer/src/merge.ts).
import type { Work } from '../../shared/types'
import { useStore } from './store'

const key = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()
const dirsOf = (w: Work): string[] => (w.sources?.length ? w.sources : [w.path])

// Save the collections and rebuild the works of `dirs` in the background
// (activity bar: `title`).
async function applyCollections(
  manualCollections: ReturnType<typeof useStore.getState>['settings']['manualCollections'],
  dirs: string[],
  title: string
): Promise<void> {
  const st = useStore.getState()
  const jobId = st.startJob('organize', st.libraryMode, title)
  try {
    const r = await window.api.setCollections(manualCollections, dirs)
    const now = useStore.getState()
    now.setSettings(r.settings)
    now.setWorks(r.works)
    now.endJob(jobId, { status: 'done' })
  } catch (e: any) {
    useStore.getState().endJob(jobId, { status: 'error', error: String(e?.message ?? e) })
    alert(`작품 통합에 실패했습니다.\n\n${String(e?.message ?? e)}`)
  }
}

// Why `works` can't be merged, or null when they can.
export function mergeBlocker(works: Work[]): string | null {
  const dirs = new Set(works.flatMap(dirsOf))
  if (works.length < 2 || dirs.size < 2) return '통합하려면 작품을 2개 이상 선택하세요.'
  const lib = works[0].library ?? 'doujin'
  if (works.some((w) => (w.library ?? 'doujin') !== lib)) return '같은 라이브러리의 작품만 통합할 수 있습니다.'
  return null
}

// Merge `works` under `title` (the artist = the first one's). Works that are
// already merged bring their folders along (their old entry is replaced).
// Returns at once (false = can't merge); the merge runs as a job.
export function mergeWorks(works: Work[], title: string): boolean {
  if (mergeBlocker(works)) return false
  const dirs = [...new Set(works.flatMap(dirsOf))]
  const set = new Set(dirs.map(key))
  const old = useStore.getState().settings.manualCollections ?? []
  const keep = old.filter((c) => !c.dirs.some((d) => set.has(key(d))))
  // Folders of replaced collections are rebuilt too (they fall apart or move).
  const touched = [...new Set([...dirs, ...old.filter((c) => !keep.includes(c)).flatMap((c) => c.dirs)])]
  const first = works[0]
  const name = title.trim() || first.title
  void applyCollections(
    [...keep, { title: name, artist: first.artist, library: first.library ?? 'doujin', dirs }],
    touched,
    `작품 통합 · ${name}`
  )
  return true
}

// The manual-collection entry behind a merged work (-1 = none / automatic).
export function mergedIndex(w: Work): number {
  if (!w.sources?.length) return -1
  const src = new Set(w.sources.map(key))
  return (useStore.getState().settings.manualCollections ?? []).findIndex(
    (c) => c.dirs.length > 0 && c.dirs.every((d) => src.has(key(d)))
  )
}

export function unmergeWork(w: Work): void {
  const i = mergedIndex(w)
  if (i < 0) return
  const all = useStore.getState().settings.manualCollections ?? []
  void applyCollections(
    all.filter((_, j) => j !== i),
    all[i].dirs,
    `통합 해제 · ${w.title}`
  )
}
