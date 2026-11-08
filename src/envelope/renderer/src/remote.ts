// Inside Halftone the player lives in the panel frame. While the separate big
// window is open (the frame is hidden then, still playing), the frame sends
// its player state down to it and runs the actions it sends up.
import { useStore } from './store'
import type { State } from './store'
import { media, next, play, playWork, prev, seek, setRate, setSleep, setVolume, skip, stop, toggle } from './player'

// what the big window shows of the panel's player
const KEYS = ['now', 'playing', 'time', 'duration', 'subs', 'sleep'] as const
type Mirrored = Pick<State, (typeof KEYS)[number]>
const TIME_MS = 200 // the clock goes down at most this often

const slice = (s: State): Mirrored => ({ now: s.now, playing: s.playing, time: s.time, duration: s.duration, subs: s.subs, sleep: s.sleep })

// Where the user is (screen, album, the library's search / filter / page):
// the big window opens where the panel was, and the panel follows the big
// window while it is open — switching keeps the place.
interface Place {
  view: State['view']
  workId: number | null
  query: string
  filter: State['filter']
  libPage: State['libPage']
}
const placeOf = (s: State): Place => ({
  view: s.view,
  workId: s.view === 'work' ? (s.shown?.id ?? null) : null,
  query: s.query,
  filter: s.filter,
  libPage: s.libPage
})
function goPlace(p: Place): void {
  const st = useStore.getState()
  useStore.setState({ query: p.query, filter: p.filter, libPage: p.libPage })
  if (p.view === 'work' && p.workId !== null) {
    if (st.view !== 'work' || st.shown?.id !== p.workId) void st.openWork(p.workId)
  } else if (st.view !== p.view) st.setView(p.view === 'work' ? 'library' : p.view)
}

// Frame side: send the state while the big window is open; run its actions.
export function serveRemote(): () => void {
  let lastTime = 0
  const offState = useStore.subscribe((s, p) => {
    if (s.hostMode !== 'hidden') return
    const onlyTime = KEYS.every((k) => k === 'time' || s[k] === p[k])
    if (onlyTime && Date.now() - lastTime < TIME_MS) return
    lastTime = Date.now()
    window.api.mirror(onlyTime ? { time: s.time } : slice(s))
  })
  const run: Record<string, (...a: never[]) => unknown> = {
    hello: () => window.api.mirror({ ...slice(useStore.getState()), place: placeOf(useStore.getState()) }),
    place: (p: Place) => goPlace(p),
    play,
    playWork,
    toggle,
    resume: () => media().paused && void media().play(),
    pause: () => media().pause(),
    stop,
    seek,
    skip,
    next: () => next(),
    prev,
    setVolume,
    setRate,
    setSleep,
    // the big window changed the work (bookmarks …): read it again
    refresh: () => void useStore.getState().refreshWork(),
    // settings saved there (repeat, shuffle, 이어 듣기 …) count here too
    settings: () => void useStore.getState().loadSettings()
  }
  const offCmd = window.api.onRemoteCmd(({ fn, args }) => (run[fn] as (...a: unknown[]) => unknown)?.(...args))
  return () => {
    offState()
    offCmd()
  }
}

// Big-window side: take the frame's state as it comes.
export function followRemote(): () => void {
  let placed = false
  const off = window.api.onMirror((m) => {
    const { place, ...s } = m as Partial<Mirrored> & { place?: Place }
    useStore.setState(s)
    if (place && !placed) {
      placed = true
      goPlace(place)
    }
  })
  // once there, every move goes down to the panel (it shows it when back)
  const offPlace = useStore.subscribe((s, p) => {
    if (!placed) return
    if (s.view === p.view && s.shown?.id === p.shown?.id && s.query === p.query && s.filter === p.filter && s.libPage === p.libPage) return
    window.api.remoteCmd({ fn: 'place', args: [placeOf(s)] })
  })
  window.api.remoteCmd({ fn: 'hello', args: [] })
  return () => {
    off()
    offPlace()
  }
}

export const remoteRefresh = (): void => window.api.remoteCmd({ fn: 'refresh', args: [] })
