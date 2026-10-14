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
    hello: () => window.api.mirror(slice(useStore.getState())),
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
  const off = window.api.onMirror((s) => useStore.setState(s as Partial<Mirrored>))
  window.api.remoteCmd({ fn: 'hello', args: [] })
  return off
}

export const remoteRefresh = (): void => window.api.remoteCmd({ fn: 'refresh', args: [] })
export const remoteSettings = (): void => window.api.remoteCmd({ fn: 'settings', args: [] })
