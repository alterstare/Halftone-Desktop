// 동인지 잠금: doujin mode asks for a PIN every time it is entered. A decoy PIN
// opens doujin mode with an empty library instead (doujin works and tabs are
// hidden until doujin mode is left again).
//
// One guard watches the store, so every way into doujin mode is covered
// (menu, Ctrl+G, tab bar, back/forward, start screen, boot): the switch is
// undone, the PIN prompt shows, and the original destination is replayed once
// the right PIN is entered. PINs are stored only as salted SHA-256 hashes.
import { create } from 'zustand'
import type { OnlineFav, Work } from '../../shared/types'
import { isComicCode } from './util'
import { useStore, effectiveSettings } from './store'
import type { Tab } from './store'

type Target = { view: ReturnType<typeof useStore.getState>['view']; activeTabId: string | null }

export const useLock = create<{
  prompt: Target | null // PIN prompt open (where the user was heading)
  unlocked: boolean // doujin mode entered with the real or decoy PIN
  decoy: boolean // entered with the decoy PIN → empty doujin library
}>(() => ({ prompt: null, unlocked: false, decoy: false }))

const isDoujin = (w: Work): boolean => (w.library ?? 'doujin') !== 'normal'
const isDoujinTab = (t: Tab): boolean => (t.mode ?? 'doujin') !== 'normal'

// Decoy mode hides these; they come back when doujin mode is left.
let hiddenWorks: Work[] = []
let hiddenTabs: Tab[] = []
let hiddenFavs: Record<string, OnlineFav> = {} // doujin online favorites/ranks
export const decoyHiddenTabs = (): Tab[] => hiddenTabs

export function lockEnabled(): boolean {
  const l = useStore.getState().settings.doujinLock
  return !!(l?.enabled && l.pinHash)
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function newSalt(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Set once boot (settings + session restore) is done: after that, turning the
// lock on while already inside doujin mode keeps the current session open.
let ready = false
export function markLockReady(): void {
  ready = true
}

let applying = false
// Store writes made by the guard itself must not re-trigger it.
function quietSet(fn: () => void): void {
  applying = true
  try {
    fn()
  } finally {
    applying = false
  }
}

// Back to general-manga home (same resets as setLibraryMode, minus the
// settings-unsaved guard — the lock must always win).
function toNormalHome(): void {
  const st = useStore.getState()
  const settings = effectiveSettings(st.settings, 'normal')
  useStore.setState({
    libraryMode: 'normal',
    view: 'home',
    activeTabId: null,
    filter: { kind: 'all' },
    search: '',
    settings,
    sort: settings.defaultSort,
    readerMode: settings.readerMode,
    homeLayout: settings.homeLayout
  })
}

function hideDoujin(): void {
  const st = useStore.getState()
  hiddenWorks = [...hiddenWorks, ...st.works.filter(isDoujin)]
  hiddenTabs = [...hiddenTabs, ...st.tabs.filter(isDoujinTab)]
  const favs = Object.entries(st.onlineFavs)
  hiddenFavs = { ...hiddenFavs, ...Object.fromEntries(favs.filter(([c]) => !isComicCode(c))) }
  useStore.setState({
    works: st.works.filter((w) => !isDoujin(w)),
    tabs: st.tabs.filter((t) => !isDoujinTab(t)),
    onlineFavs: Object.fromEntries(favs.filter(([c]) => isComicCode(c)))
  })
}

function restoreDoujin(): void {
  if (!hiddenWorks.length && !hiddenTabs.length && !Object.keys(hiddenFavs).length) return
  const st = useStore.getState()
  const ids = new Set(st.works.map((w) => w.id))
  const tabIds = new Set(st.tabs.map((t) => t.id))
  useStore.setState({
    works: [...st.works, ...hiddenWorks.filter((w) => !ids.has(w.id))],
    tabs: [...st.tabs, ...hiddenTabs.filter((t) => !tabIds.has(t.id))],
    onlineFavs: { ...hiddenFavs, ...st.onlineFavs }
  })
  hiddenWorks = []
  hiddenTabs = []
  hiddenFavs = {}
}

export function startLockGuard(): () => void {
  return useStore.subscribe((st, prev) => {
    if (applying) return
    const lock = useLock.getState()
    // Leaving doujin mode → lock again (and bring back what the decoy hid).
    if (prev.libraryMode !== 'normal' && st.libraryMode === 'normal' && lock.unlocked) {
      quietSet(restoreDoujin)
      useLock.setState({ unlocked: false, decoy: false })
      return
    }
    if (lock.decoy && st.view === 'browse' && st.libraryMode !== 'normal') {
      quietSet(() => useStore.setState({ view: 'home' }))
      return
    }
    // Lock just switched on (settings saved) while inside doujin mode → this
    // session counts as unlocked; it locks on the next entry.
    const was = !!(prev.settings.doujinLock?.enabled && prev.settings.doujinLock.pinHash)
    if (ready && !was && lockEnabled() && st.libraryMode !== 'normal' && prev.libraryMode !== 'normal') {
      useLock.setState({ unlocked: true })
      return
    }
    // In decoy mode, keep doujin works/tabs out even if a rescan brings them back.
    if (
      lock.decoy &&
      (st.works.some(isDoujin) || st.tabs.some(isDoujinTab) || Object.keys(st.onlineFavs).some((c) => !isComicCode(c)))
    ) {
      quietSet(hideDoujin)
      return
    }
    // Entering (or booting into) doujin mode while locked → prompt instead.
    if (st.libraryMode !== 'normal' && !lock.unlocked && lockEnabled()) {
      useLock.setState({ prompt: lock.prompt ?? { view: st.view, activeTabId: st.activeTabId } })
      quietSet(toNormalHome)
    }
  })
}

// F5 soft reload: keep an unlocked (or decoy) doujin session open.
export function restoreLockState(decoy: boolean): void {
  useLock.setState({ unlocked: true, decoy, prompt: null })
  if (decoy) quietSet(hideDoujin)
}

export type PinResult = 'ok' | 'decoy' | 'wrong'

export async function tryPin(pin: string): Promise<PinResult> {
  const l = useStore.getState().settings.doujinLock
  if (!l?.pinHash) return 'wrong'
  const h = await hashPin(pin, l.salt)
  const real = h === l.pinHash
  const decoy = !real && !!l.decoyHash && h === l.decoyHash
  if (!real && !decoy) return 'wrong'
  const target = useLock.getState().prompt
  useLock.setState({ prompt: null, unlocked: true, decoy })
  quietSet(() => {
    if (decoy) hideDoujin()
    useStore.getState().setLibraryMode('doujin')
    // Real PIN: replay where the user was heading (a reader tab / online).
    if (!decoy && target && target.view !== 'home')
      useStore.setState({ view: target.view, activeTabId: target.activeTabId })
  })
  return decoy ? 'decoy' : 'ok'
}

export function cancelPin(): void {
  useLock.setState({ prompt: null })
}
