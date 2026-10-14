// Playback engine: one <audio> that lives for the whole session (so playback
// survives screen changes) and a <video> the player screen lends for video
// tracks. Saves the position every few seconds, resumes where a track was
// left, follows repeat / shuffle / the sleep timer, and talks to the OS media
// controls (Media Session).
import { useStore } from './store'
import { loadSubs } from './subs'
import type { TrackGroup, TrackVersion, WorkDetail } from '../../shared/types'
import { remote } from './embed'

const SAVE_EVERY_MS = 5000
const RESUME_MIN = 3 // s: earlier positions start from the top
const FADE_S = 10 // sleep timer fades out over this long
const RESTART_AFTER = 3 // "previous" restarts the track past this point

const audio = new Audio()
audio.preload = 'auto'
let video: HTMLVideoElement | null = null
let el: HTMLMediaElement = audio
let pendingSeek: number | null = null
let lastSave = 0
let fadeBase: number | null = null

const st = useStore.getState
const set = useStore.setState

// The big window (inside Halftone) has no player of its own: actions go to
// the panel frame's player, and "the media element" reads its mirrored state.
const fwd = (fn: string, ...args: unknown[]): void => window.api.remoteCmd({ fn, args })
const remoteMedia = {
  get currentTime() {
    return st().time
  },
  get paused() {
    return !st().playing
  },
  get volume() {
    return st().settings?.volume ?? 1
  },
  get duration() {
    return st().duration
  },
  play: () => (fwd('resume'), Promise.resolve()),
  pause: () => fwd('pause')
} as unknown as HTMLMediaElement

export const media = (): HTMLMediaElement => (remote ? remoteMedia : el)

// The player screen hands over its <video> (null when it unmounts: a video
// track then stops).
export function attachVideo(v: HTMLVideoElement | null): void {
  if (remote) return
  if (video && el === video && !v) {
    save()
    video.pause()
    set({ playing: false })
  }
  video = v
  if (v) wire(v)
}

function groupOf(w: WorkDetail, key: string): TrackGroup | undefined {
  return w.groups.find((g) => g.key === key)
}

function versionOf(g: TrackGroup, id?: number): TrackVersion {
  return g.versions.find((v) => v.id === (id ?? g.chosen)) ?? g.versions[0]
}

// Start a track of a work (its chosen version unless `versionId`), resuming
// where it was left; `at` overrides the start point.
export async function play(work: WorkDetail, groupKey: string, opts: { versionId?: number; at?: number; autoplay?: boolean } = {}): Promise<void> {
  if (remote) return fwd('play', work, groupKey, opts)
  const g = groupOf(work, groupKey)
  if (!g) return
  const v = versionOf(g, opts.versionId)
  save()
  el.pause()
  const next = v.kind === 'video' && video ? video : audio
  if (next !== el) el.removeAttribute('src')
  el = next
  const s = st().settings
  el.volume = s?.volume ?? 1
  el.playbackRate = s?.rate ?? 1
  el.src = window.api.mediaUrl(v.path)
  pendingSeek = opts.at ?? (resumeOn() && g.position > RESUME_MIN && !g.finished ? g.position : null)
  set({ now: { work, groupKey, trackId: v.id }, time: pendingSeek ?? 0, duration: v.duration ?? g.duration ?? 0, subs: null })
  void loadSubs(work, groupKey, v.id)
  updateSession(work, g)
  if (opts.autoplay !== false) await el.play().catch(() => set({ playing: false }))
}

// 설정 › 재생 › 이어 듣기 (off: every track from the top, every work from its first track)
export const resumeOn = (): boolean => st().settings?.resume ?? true

// Where "play" on a work starts: the last track if it wasn't heard to the end,
// else the next main track after it (wrapping to the first). 이어 듣기 off:
// the first main track.
export function resumeTarget(w: WorkDetail): TrackGroup | undefined {
  if (!resumeOn()) return w.groups.find((g) => g.role === 'main') ?? w.groups[0]
  const last = w.lastGroup ? groupOf(w, w.lastGroup) : undefined
  if (last && !last.finished) return last
  const main = w.groups.filter((g) => g.role === 'main')
  if (!last) return main[0] ?? w.groups[0]
  const i = main.findIndex((g) => g.key === last.key)
  return main[i + 1] ?? main[0] ?? w.groups[0]
}

// Play a work from the library (card / shelf play button).
export async function playWork(id: number): Promise<void> {
  if (remote) return fwd('playWork', id)
  const w = await window.api.work(id)
  const g = w && resumeTarget(w)
  if (w && g) await play(w, g.key)
}

export function toggle(): void {
  if (remote) return fwd('toggle')
  if (!st().now) {
    const w = st().shown
    const g = w && resumeTarget(w)
    if (w && g) void play(w, g.key)
    return
  }
  if (el.paused) void el.play()
  else el.pause()
}

// End playback altogether: nothing loaded, the bottom bar disappears.
export function stop(): void {
  if (remote) return fwd('stop')
  if (!st().now) return
  save()
  el.pause()
  el.removeAttribute('src')
  el.load()
  pendingSeek = null
  if (fadeBase !== null) el.volume = fadeBase
  fadeBase = null
  set({ now: null, playing: false, time: 0, duration: 0, subs: null, editing: false, sleep: { ...st().sleep, mode: 'off', endsAt: null } })
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = null
    navigator.mediaSession.playbackState = 'none'
  }
}

// Closing the LP tab of the work that is playing stops it.
useStore.subscribe((s, prev) => {
  const id = s.now?.work.id
  if (id !== undefined && prev.tabs.includes(id) && !s.tabs.includes(id)) stop()
})

export function seek(t: number): void {
  if (remote) return fwd('seek', t)
  if (!st().now) return
  el.currentTime = Math.max(0, Math.min(t, isFinite(el.duration) ? el.duration : t))
  set({ time: el.currentTime })
}

export const skip = (d: number): void => seek(media().currentTime + d)

// Main tracks in order — or, while an extra/sample plays, just that one.
function queue(): string[] {
  const n = st().now
  if (!n) return []
  const g = groupOf(n.work, n.groupKey)
  if (g && g.role !== 'main') return [g.key]
  return n.work.groups.filter((x) => x.role === 'main').map((x) => x.key)
}

export function next(auto = false): void {
  if (remote) return fwd('next')
  const n = st().now
  const s = st().settings
  if (!n) return
  const q = queue()
  const i = q.indexOf(n.groupKey)
  if (auto && s?.repeat === 'one') return void play(n.work, n.groupKey, { at: 0 })
  let k: string | undefined
  if (s?.shuffle && q.length > 1) {
    const rest = q.filter((x) => x !== n.groupKey)
    k = rest[Math.floor(Math.random() * rest.length)]
  } else k = q[i + 1] ?? (s?.repeat === 'all' ? q[0] : undefined)
  if (k) void play(n.work, k, { at: 0 })
  else if (auto) set({ playing: false })
}

export function prev(): void {
  if (remote) return fwd('prev')
  const n = st().now
  if (!n) return
  if (el.currentTime > RESTART_AFTER) return seek(0)
  const q = queue()
  const k = q[q.indexOf(n.groupKey) - 1]
  if (k) void play(n.work, k, { at: 0 })
  else seek(0)
}

// The slider moves with the pointer: the value shows at once and is saved
// once the dragging pauses (saving every step let late replies from earlier
// steps pull the knob back — it moved in jerks).
let volumeSave: ReturnType<typeof setTimeout> | null = null
export function setVolume(v: number): void {
  const cur = st().settings
  if (cur) set({ settings: { ...cur, volume: v } })
  if (remote) return fwd('setVolume', v)
  el.volume = v
  fadeBase = null
  if (volumeSave) clearTimeout(volumeSave)
  volumeSave = setTimeout(() => void window.api.saveSettings({ volume: v }), 300)
}

export function setRate(r: number): void {
  if (remote) return (void st().saveSettings({ rate: r }), fwd('setRate', r))
  el.playbackRate = r
  void st().saveSettings({ rate: r })
}

export function setSleep(mode: 'off' | 'time' | 'track' | 'work', minutes?: number): void {
  if (remote) return fwd('setSleep', mode, minutes)
  const m = minutes ?? st().sleep.minutes
  if (fadeBase !== null) el.volume = fadeBase
  fadeBase = null
  set({ sleep: { mode, minutes: m, endsAt: mode === 'time' ? Date.now() + m * 60_000 : null } })
}

function stopForSleep(): void {
  el.pause()
  if (fadeBase !== null) el.volume = fadeBase
  fadeBase = null
  set({ sleep: { ...st().sleep, mode: 'off', endsAt: null } })
}

// ---- progress ----

function save(final?: number): void {
  const n = st().now
  if (!n || !el.src) return
  const d = isFinite(el.duration) ? el.duration : undefined
  const position = final ?? el.currentTime
  lastSave = Date.now()
  void window.api.saveProgress({ workId: n.work.id, groupKey: n.groupKey, position, trackId: n.trackId, duration: d })
  // keep the copies on screen in step (resume point, 들음 marks)
  const patch = (w: WorkDetail): WorkDetail => ({
    ...w,
    lastGroup: n.groupKey,
    groups: w.groups.map((g) => (g.key === n.groupKey ? { ...g, position, finished: !!d && position >= d - 10 } : g))
  })
  const shown = st().shown
  set({ now: { ...n, work: patch(n.work) }, shown: shown && shown.id === n.work.id ? patch(shown) : shown })
}

function wire(m: HTMLMediaElement): void {
  m.addEventListener('loadedmetadata', () => {
    if (m !== el) return
    if (pendingSeek !== null) m.currentTime = pendingSeek
    pendingSeek = null
    set({ duration: m.duration })
  })
  m.addEventListener('timeupdate', () => {
    if (m !== el) return
    set({ time: m.currentTime })
    if (Date.now() - lastSave > SAVE_EVERY_MS && !m.paused) save()
    if ('mediaSession' in navigator && isFinite(m.duration))
      navigator.mediaSession.setPositionState({ duration: m.duration, position: Math.min(m.currentTime, m.duration), playbackRate: m.playbackRate })
  })
  m.addEventListener('play', () => m === el && set({ playing: true }))
  m.addEventListener('pause', () => {
    if (m !== el) return
    set({ playing: false })
    save()
  })
  m.addEventListener('ended', () => {
    if (m !== el) return
    save(m.duration)
    const sl = st().sleep.mode
    if (sl === 'track') return stopForSleep()
    const q = queue()
    if (sl === 'work' && q.indexOf(st().now!.groupKey) === q.length - 1) return stopForSleep()
    next(true)
  })
  m.addEventListener('error', () => {
    if (m !== el || !m.src) return
    set({ playing: false })
    st().showToast({ ok: false, message: '이 파일을 재생할 수 없습니다.' })
  })
}
wire(audio)

// Sleep timer: fade over the last seconds, then pause.
setInterval(() => {
  const sl = st().sleep
  if (sl.mode !== 'time' || !sl.endsAt) return
  const left = (sl.endsAt - Date.now()) / 1000
  if (left <= 0) return stopForSleep()
  if (left < FADE_S && !el.paused) {
    if (fadeBase === null) fadeBase = el.volume
    el.volume = fadeBase * (left / FADE_S)
  }
}, 250)

window.addEventListener('beforeunload', () => save())

// ---- OS media controls ----

function updateSession(work: WorkDetail, g: TrackGroup): void {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = new MediaMetadata({
    title: g.title,
    artist: work.title,
    album: work.code ?? '',
    artwork: work.cover ? [{ src: window.api.thumbUrl(work.cover), sizes: '480x480', type: 'image/jpeg' }] : []
  })
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession
  const step = (): number => st().settings?.seekStep ?? 5
  ms.setActionHandler('play', () => void el.play())
  ms.setActionHandler('pause', () => el.pause())
  ms.setActionHandler('previoustrack', () => prev())
  ms.setActionHandler('nexttrack', () => next())
  ms.setActionHandler('seekbackward', (d) => skip(-(d.seekOffset ?? step())))
  ms.setActionHandler('seekforward', (d) => skip(d.seekOffset ?? step()))
  ms.setActionHandler('seekto', (d) => d.seekTime !== undefined && seek(d.seekTime))
}
