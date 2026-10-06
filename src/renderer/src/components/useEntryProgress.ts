import { useStore } from '../store'
import type { ReadProgress } from '../../../shared/types'

// Read progress as it was when this tab ENTERED a series. Opening a chapter
// marks it read at once, so the live "last read" would always be the chapter
// on screen; the reader sidebar shows this snapshot instead — the chapter you
// had stopped at stays highlighted until you leave (the new spot is already
// saved for next time). Captured on the list's first render for the series,
// which happens before the reader's mark-read effect.
const snaps = new Map<string, Record<string, ReadProgress>>()

export function useEntryProgress(seriesKey: string | null | undefined): Record<string, ReadProgress> {
  const tabId = useStore((s) => s.activeTabId) ?? ''
  const live = useStore((s) => s.readProgress)
  if (!seriesKey) return live
  const k = `${tabId}|${seriesKey}`
  let snap = snaps.get(k)
  if (!snap) {
    snap = live
    snaps.set(k, snap)
  }
  return snap
}
