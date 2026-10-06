// F5 (새로고침): reload the window to re-read data, but come back to the same
// screen — tabs, active tab, mode, list/online position, search and filters.
// The state rides across the reload in sessionStorage (cleared on read).
import { useStore } from './store'
import { useLock, decoyHiddenTabs, restoreLockState } from './lock'

const KEY = 'mm-soft-reload'

const KEEP = [
  'view',
  'activeTabId',
  'libraryMode',
  'manageMode',
  'homeScroll',
  'homePage',
  'tabs',
  'tabGroups',
  'search',
  'sort',
  'sortDir',
  'favSort',
  'filter',
  'randomSeed',
  'showCoded',
  'showUncoded',
  'langFilter',
  'groupFilter',
  'showUngrouped',
  'listCollapsed',
  'readerMode',
  'homeLayout',
  'browseSource',
  'browsePage',
  'onlineProgress',
  'sideState',
  'navStack',
  'navPos'
] as const

export function softReload(): void {
  try {
    const st = useStore.getState() as unknown as Record<string, unknown>
    const snap: Record<string, unknown> = Object.fromEntries(KEEP.map((k) => [k, st[k]]))
    // Tabs the decoy library is hiding are still real tabs.
    snap.tabs = [...(st.tabs as unknown[]), ...decoyHiddenTabs()]
    const lock = useLock.getState()
    snap.__lock = { unlocked: lock.unlocked, decoy: lock.decoy }
    sessionStorage.setItem(KEY, JSON.stringify(snap))
  } catch {
    /* storage unavailable → plain reload */
  }
  window.location.reload()
}

// Boot: re-apply the pre-reload screen (after settings, works and the saved
// session are loaded). Returns true when there was one.
export function restoreSoftReload(): boolean {
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
  } catch {
    return false
  }
  if (!raw) return false
  try {
    const { __lock, ...snap } = JSON.parse(raw) as Record<string, unknown> & {
      __lock?: { unlocked: boolean; decoy: boolean }
    }
    // A reload doesn't re-lock an already unlocked doujin session.
    if (__lock?.unlocked) restoreLockState(__lock.decoy)
    useStore.setState(snap as never)
    if (__lock?.decoy) restoreLockState(true) // hide again what the state just brought back
    return true
  } catch {
    return false
  }
}
