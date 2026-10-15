import type { HostMode } from './embed'
import { create } from 'zustand'
import type { JobSummary, WindowState } from '../../shared/ipc'
import type { Group, ProgressEvent, Settings, SubtitleText, WorkDetail, WorkSummary } from '../../shared/types'
import type { ContentKey } from './workInfo'

// library → work page → now playing (full player with subtitles)
export type View = 'library' | 'work' | 'now' | 'tools' | 'settings'
export type ToolTab = 'rename' | 'dlsite' | 'subs' | 'cover' | 'wav' | 'jobs'
// 파일 정리 changes either only what the program keeps (names shown, DLsite
// info, subtitles, the cover shown) or the library's folders and files
export type ToolsMode = 'app' | 'folder'
export type SleepMode = 'off' | 'time' | 'track' | 'work'
export type ListenState = 'new' | 'listening' | 'done'

export interface NowPlaying {
  work: WorkDetail
  groupKey: string
  trackId: number
}

// Subtitles of the track playing: the Japanese original and the Korean
// translation when both exist, else whichever there is.
export interface Subs {
  trackId: number
  ja: SubtitleText | null
  ko: SubtitleText | null
  other: SubtitleText | null
  borrowed: boolean // taken from another version of the track (SE 포함 ↔ 제외)
}

export interface LibFilter {
  favorites: boolean
  listen: Record<ListenState, boolean>
  content: Record<ContentKey, boolean> // 언어 분류
  age: Record<'r18' | 'general' | 'unknown', boolean> // 연령 분류
  groups: number[] | null // null = all; [] + ungrouped
  ungrouped: boolean
}

export const ALL_FILTER: LibFilter = {
  favorites: false,
  listen: { new: true, listening: true, done: true },
  content: { none: true, 'ja-script': true, 'ko-script': true, 'ja-sub': true, 'ko-sub': true },
  age: { r18: true, general: true, unknown: true },
  groups: null,
  ungrouped: true
}

export interface State {
  view: View
  settings: Settings | null
  works: WorkSummary[]
  groups: Group[]
  query: string
  libPage: { key: string; page: number } // page of the library list (key = what the list is)
  filter: LibFilter
  shown: WorkDetail | null // work open on the work page
  now: NowPlaying | null // what the player holds
  playing: boolean
  time: number
  duration: number
  sleep: { mode: SleepMode; endsAt: number | null; minutes: number }
  imgIndex: number
  subs: Subs | null
  editing: boolean // subtitle editor open
  scan: ProgressEvent | null
  job: ProgressEvent | null // other background work (file tools)
  jobs: ProgressEvent[] // every job of this session, newest first (파일 정리 › 작업)
  win: WindowState // standalone window: maximized / 최소화 모드 / 항상 위
  hostMode: HostMode // inside Halftone: right panel / bottom bar / hidden (big window open)
  toolsScope: number[] | null // works the file tools look at; null = all
  toolsTab: ToolTab
  toolsMode: ToolsMode
  toast: JobSummary | null
  // LP tabs: open works, top to bottom
  tabs: number[]
  closedTabs: number[]
  // back / forward (mouse side buttons, Alt+←/→)
  history: { view: View; workId: number | null }[]
  historyAt: number

  setView: (v: View) => void
  setQuery: (q: string) => void
  setFilter: (f: Partial<LibFilter>) => void
  loadSettings: () => Promise<void>
  saveSettings: (p: Partial<Settings>) => Promise<void>
  loadWorks: () => Promise<void>
  loadGroups: () => Promise<void>
  openWork: (id: number) => Promise<void>
  refreshWork: (id?: number) => Promise<void>
  patchWork: (id: number, p: Partial<WorkSummary & WorkDetail>) => void
  showToast: (t: JobSummary) => void
  closeTab: (id: number) => void
  reopenTab: () => void
  moveTab: (id: number, to: number) => void
  navBack: () => void
  navForward: () => void
}

const MAX_HISTORY = 50
let navigating = false // set while back/forward moves, so it isn't recorded again
let tabSave: ReturnType<typeof setTimeout> | null = null

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<State>((set, get) => ({
  view: 'library',
  settings: null,
  works: [],
  groups: [],
  query: '',
  libPage: { key: '', page: 0 },
  filter: ALL_FILTER,
  shown: null,
  now: null,
  playing: false,
  time: 0,
  duration: 0,
  sleep: { mode: 'off', endsAt: null, minutes: 30 },
  imgIndex: 0,
  subs: null,
  editing: false,
  scan: null,
  job: null,
  jobs: [],
  win: { maximized: false, mini: false, onTop: true },
  hostMode: 'panel',

  toolsScope: null,
  toolsTab: 'rename',
  toolsMode: 'app',
  toast: null,
  tabs: [],
  closedTabs: [],
  history: [{ view: 'library', workId: null }],
  historyAt: 0,

  setView: (view) => {
    set({ view, editing: false })
    record(view, view === 'work' ? (get().shown?.id ?? null) : null)
  },
  setQuery: (query) => set({ query }),
  setFilter: (f) => set({ filter: { ...get().filter, ...f } }),
  loadSettings: async () => {
    const settings = await window.api.getSettings()
    set({ settings, tabs: get().tabs.length ? get().tabs : settings.tabs })
  },
  saveSettings: async (p) => {
    const cur = get().settings
    if (cur) set({ settings: { ...cur, ...p } }) // instant; the saved copy follows
    set({ settings: await window.api.saveSettings(p) })
    // the big window inside Halftone: the panel's player reads them again
    if (new URLSearchParams(location.search).has('remote')) window.api.remoteCmd({ fn: 'settings', args: [] })
  },
  loadWorks: async () => set({ works: await window.api.works() }),
  loadGroups: async () => set({ groups: await window.api.groups() }),
  // Opens (and adds) the work's LP tab.
  openWork: async (id) => {
    const w = await window.api.work(id)
    if (!w) return
    const { tabs, shown } = get()
    if (!tabs.includes(id)) {
      const at = shown ? tabs.indexOf(shown.id) : -1
      const next = at < 0 ? [...tabs, id] : [...tabs.slice(0, at + 1), id, ...tabs.slice(at + 1)]
      set({ tabs: next })
      saveTabs()
    }
    set({ shown: w, view: 'work', editing: false })
    record('work', id)
  },
  // Reload a work (default: the one shown) and the copy the player holds.
  refreshWork: async (id) => {
    const target = id ?? get().shown?.id
    if (target === undefined) return
    const w = await window.api.work(target)
    if (!w) return
    if (get().shown?.id === w.id) set({ shown: w })
    const now = get().now
    if (now?.work.id === w.id) set({ now: { ...now, work: w } })
  },
  // Local update after a change the main process has already saved.
  patchWork: (id, p) => {
    const { works, shown, now } = get()
    set({
      works: works.map((w) => (w.id === id ? { ...w, ...p } : w)),
      shown: shown?.id === id ? { ...shown, ...p } : shown,
      now: now?.work.id === id ? { ...now, work: { ...now.work, ...p } } : now
    })
  },
  showToast: (t) => {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast: t })
    toastTimer = setTimeout(() => set({ toast: null }), 4000)
  },
  closeTab: (id) => {
    const { tabs, shown, view } = get()
    const i = tabs.indexOf(id)
    if (i < 0) return
    const next = tabs.filter((x) => x !== id)
    set({ tabs: next, closedTabs: [...get().closedTabs.slice(-20), id] })
    saveTabs()
    if (shown?.id === id && view === 'work') {
      const n = next[Math.min(i, next.length - 1)]
      if (n !== undefined) void get().openWork(n)
      else get().setView('library')
    }
  },
  reopenTab: () => {
    const c = get().closedTabs
    const id = c[c.length - 1]
    if (id === undefined) return
    set({ closedTabs: c.slice(0, -1) })
    void get().openWork(id)
  },
  moveTab: (id, to) => {
    const rest = get().tabs.filter((x) => x !== id)
    rest.splice(Math.max(0, Math.min(to, rest.length)), 0, id)
    set({ tabs: rest })
    saveTabs()
  },
  navBack: () => go(-1),
  navForward: () => go(1)
}))

function saveTabs(): void {
  if (tabSave) clearTimeout(tabSave)
  tabSave = setTimeout(() => void useStore.getState().saveSettings({ tabs: useStore.getState().tabs }), 400)
}

function record(view: View, workId: number | null): void {
  if (navigating) return
  const { history, historyAt } = useStore.getState()
  const cur = history[historyAt]
  if (cur && cur.view === view && cur.workId === workId) return
  const next = [...history.slice(0, historyAt + 1), { view, workId }].slice(-MAX_HISTORY)
  useStore.setState({ history: next, historyAt: next.length - 1 })
}

async function go(dir: -1 | 1): Promise<void> {
  const st = useStore.getState()
  const at = st.historyAt + dir
  const h = st.history[at]
  if (!h) return
  navigating = true
  try {
    useStore.setState({ historyAt: at })
    if (h.view === 'work' && h.workId !== null) {
      const w = await window.api.work(h.workId)
      if (w) useStore.setState({ shown: w, view: 'work', editing: false })
    } else if (h.view !== 'now' || st.now) useStore.setState({ view: h.view, editing: false })
  } finally {
    navigating = false
  }
}

export function listenState(w: WorkSummary): ListenState {
  if (w.tracks && w.finished === w.tracks) return 'done'
  return w.played > 0 ? 'listening' : 'new'
}
