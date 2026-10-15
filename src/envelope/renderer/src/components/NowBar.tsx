import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { SleepMode } from '../store'
import { next, prev, seek, setRate, setSleep, setVolume, skip, toggle } from '../player'
import { clock } from '../format'
import {
  AddIcon,
  BedtimeIcon,
  Forward5Icon,
  RemoveIcon,
  PauseIcon,
  PlayArrowIcon,
  RepeatIcon,
  RepeatOneIcon,
  Replay5Icon,
  ShuffleIcon,
  SkipNextIcon,
  SkipPreviousIcon,
  SpeedIcon,
  VolumeOffIcon,
  VolumeUpIcon
} from './icons'
import { Cover, FavButton, GroupButton, useNarrow, usePopover } from './ui'
import { BookmarkButton, SeekMarks } from './Bookmarks'
import { SubsToggle, ResumeToggle } from './NowView'

export const RATES = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 2]
export const SLEEP: [string, SleepMode, number?][] = [
  ['15분', 'time', 15],
  ['30분', 'time', 30],
  ['45분', 'time', 45],
  ['60분', 'time', 60],
  ['90분', 'time', 90],
  ['이 트랙이 끝나면', 'track'],
  ['작품이 끝나면', 'work']
]

export function SeekBar(): JSX.Element {
  const time = useStore((s) => s.time)
  const duration = useStore((s) => s.duration)
  return (
    <div className="seekbar">
      <span className="t">{clock(time)}</span>
      <div className="seek-track">
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={Math.min(time, duration || 0)}
        onChange={(e) => seek(Number(e.target.value))}
        style={{ '--p': `${duration ? (time / duration) * 100 : 0}%` } as React.CSSProperties}
      />
      <SeekMarks />
      </div>
      <span className="t">{clock(duration)}</span>
    </div>
  )
}

export function Transport({ big }: { big?: boolean }): JSX.Element {
  const playing = useStore((s) => s.playing)
  const s = useStore((x) => x.settings)
  const save = useStore((x) => x.saveSettings)
  const step = s?.seekStep ?? 5
  const repeat = s?.repeat ?? 'off'
  return (
    <div className={`transport flat-group ${big ? 'big' : ''}`}>
      <button className={`mini icon tb ${s?.shuffle ? 'on' : ''}`} title="무작위 재생" onClick={() => void save({ shuffle: !s?.shuffle })}>
        <ShuffleIcon />
      </button>
      <button className="mini icon tb" title={`${step}초 뒤로 (←)`} onClick={() => skip(-step)}>
        <Replay5Icon />
      </button>
      <button className="mini icon tb" title="이전 트랙 (Shift+←)" onClick={prev}>
        <SkipPreviousIcon />
      </button>
      <button className="mini icon on tb play" title="재생 / 일시정지 (Space)" onClick={toggle}>
        {playing ? <PauseIcon /> : <PlayArrowIcon />}
      </button>
      <button className="mini icon tb" title="다음 트랙 (Shift+→)" onClick={() => next()}>
        <SkipNextIcon />
      </button>
      <button className="mini icon tb" title={`${step}초 앞으로 (→)`} onClick={() => skip(step)}>
        <Forward5Icon />
      </button>
      <button
        className={`mini icon tb ${repeat !== 'off' ? 'on' : ''}`}
        title={repeat === 'off' ? '반복 사용 안 하기' : repeat === 'all' ? '작품 전체 반복' : '한 트랙 반복'}
        onClick={() => void save({ repeat: repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off' })}
      >
        {repeat === 'one' ? <RepeatOneIcon /> : <RepeatIcon />}
      </button>
    </div>
  )
}

// A small dial (재생 속도 · 수면 타이머, big window popover and the small
// window's ⋯ menu alike): the value on top, [−] slider [+], four presets.
function Dial({
  value,
  label,
  min,
  max,
  step,
  presets,
  onSet,
  stepTitles
}: {
  value: number
  label: string
  min: number
  max: number
  step: number
  presets: { label: string; on: boolean; set: () => void }[]
  onSet: (v: number) => void
  stepTitles: [string, string]
}): JSX.Element {
  // while dragging the slider shows where the pointer is (saving catches up)
  const [drag, setDrag] = useState<number | null>(null)
  const v = drag ?? value
  const clamp = (x: number): number => Math.min(max, Math.max(min, Math.round(x / step) * step))
  return (
    <div className="dial">
      <div className="dial-value">{label}</div>
      <div className="dial-row">
        <button className="mini icon dial-step" title={stepTitles[0]} onClick={() => onSet(clamp(v - step))}>
          <RemoveIcon />
        </button>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={v}
          style={{ '--p': `${((v - min) / (max - min)) * 100}%` } as React.CSSProperties}
          onChange={(e) => {
            const x = clamp(Number(e.target.value))
            setDrag(x)
            onSet(x)
          }}
          onPointerUp={() => setDrag(null)}
          onBlur={() => setDrag(null)}
        />
        <button className="mini icon dial-step" title={stepTitles[1]} onClick={() => onSet(clamp(v + step))}>
          <AddIcon />
        </button>
      </div>
      <div className="dial-presets">
        {presets.map((p) => (
          <button key={p.label} className={`mini ${p.on ? 'on' : ''}`} onClick={p.set}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function RateControl(): JSX.Element {
  const rate = useStore((s) => s.settings?.rate ?? 1)
  const set = (r: number): void => setRate(Math.round(r * 100) / 100)
  return (
    <Dial
      value={rate}
      label={`${rate.toFixed(2)}x`}
      min={0.5}
      max={2}
      step={0.05}
      stepTitles={['0.05 느리게', '0.05 빠르게']}
      onSet={set}
      presets={[0.5, 1, 1.5, 2].map((r) => ({ label: r.toFixed(1), on: Math.abs(rate - r) < 0.001, set: () => set(r) }))}
    />
  )
}

// 수면 타이머: minutes on the slider (0 = off), or to the end of the track / work
export function SleepControl(): JSX.Element {
  const sleep = useStore((s) => s.sleep)
  useStore((s) => s.time) // count down with playback
  const minutes = sleep.mode === 'time' ? sleep.minutes : 0
  const left = sleep.mode === 'time' && sleep.endsAt ? clock(Math.max(0, (sleep.endsAt - Date.now()) / 1000)) : null
  const label = sleep.mode === 'off' ? '꺼짐' : sleep.mode === 'track' ? '이 트랙이 끝나면' : sleep.mode === 'work' ? '작품이 끝나면' : `${left} 남음`
  const setMin = (m: number): void => (m <= 0 ? setSleep('off') : setSleep('time', m))
  return (
    <Dial
      value={minutes}
      label={label}
      min={0}
      max={120}
      step={5}
      stepTitles={['5분 줄이기', '5분 늘리기']}
      onSet={setMin}
      presets={[
        { label: '30분', on: sleep.mode === 'time' && sleep.minutes === 30, set: () => setSleep('time', 30) },
        { label: '60분', on: sleep.mode === 'time' && sleep.minutes === 60, set: () => setSleep('time', 60) },
        { label: '트랙 끝', on: sleep.mode === 'track', set: () => setSleep(sleep.mode === 'track' ? 'off' : 'track') },
        { label: '작품 끝', on: sleep.mode === 'work', set: () => setSleep(sleep.mode === 'work' ? 'off' : 'work') }
      ]}
    />
  )
}

export function SpeedMenu(): JSX.Element {
  const p = usePopover()
  const rate = useStore((s) => s.settings?.rate ?? 1)
  return (
    <div className="cat-wrap" ref={p.ref}>
      <button className={`mini icon tb ${rate !== 1 ? 'on' : ''}`} title="재생 속도" onClick={() => p.setOpen(!p.open)}>
        {rate !== 1 ? <span className="rate">{rate}x</span> : <SpeedIcon />}
      </button>
      {p.mounted && (
        <div className={`cat-panel up right dial-panel ${p.closing ? 'closing' : ''}`}>
          <RateControl />
        </div>
      )}
    </div>
  )
}

export function SleepMenu(): JSX.Element {
  const p = usePopover()
  const sleep = useStore((s) => s.sleep)
  useStore((s) => s.time) // count down with playback
  const left = sleep.mode === 'time' && sleep.endsAt ? clock(Math.max(0, (sleep.endsAt - Date.now()) / 1000)) : null
  return (
    <div className="cat-wrap" ref={p.ref}>
      <button className={`mini icon tb ${sleep.mode !== 'off' ? 'on' : ''}`} title="수면 타이머" onClick={() => p.setOpen(!p.open)}>
        <BedtimeIcon />
        {left && <span className="rate">{left}</span>}
      </button>
      {p.mounted && (
        <div className={`cat-panel up right dial-panel ${p.closing ? 'closing' : ''}`}>
          <SleepControl />
        </div>
      )}
    </div>
  )
}

export function Volume(): JSX.Element {
  const vol = useStore((s) => s.settings?.volume ?? 1)
  return (
    // where the bar has no room for the slider beside the button, it opens
    // upward as a vertical bar while the pointer is over the button (CSS)
    <div className="volume">
      <button className="mini icon tb" title="음소거" onClick={() => setVolume(vol > 0 ? 0 : 1)}>
        {vol > 0 ? <VolumeUpIcon /> : <VolumeOffIcon />}
      </button>
      <div className="vol-pop">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={vol}
          aria-label="음량"
          onChange={(e) => setVolume(Number(e.target.value))}
          style={{ '--p': `${vol * 100}%` } as React.CSSProperties}
        />
      </div>
    </div>
  )
}

// 지금 재생 ⇄ the screen before it (a click anywhere on the bar that isn't a control)
function toggleNowView(): void {
  const st = useStore.getState()
  if (st.view !== 'now') return st.setView('now')
  if (st.historyAt > 0) st.navBack()
  else st.setView('library')
}
const onBar = (e: React.MouseEvent): void => {
  if ((e.target as HTMLElement).closest('button, input, a, .cat-wrap, .dropdown, .volume')) return
  toggleNowView()
}

// Small bar (narrow window, or when the full bar would overlap itself): a
// seekable line on top, then cover · titles · [이전] [재생] [다음].
function MiniPlayer(): JSX.Element {
  const now = useStore((s) => s.now)!
  const playing = useStore((s) => s.playing)
  const time = useStore((s) => s.time)
  const duration = useStore((s) => s.duration)
  const g = now.work.groups.find((x) => x.key === now.groupKey)
  return (
    <footer className="miniplayer" onClick={onBar} title="지금 재생 화면 열기 / 닫기">
      <div className="mp-seek">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(time, duration || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          style={{ '--p': `${duration ? (time / duration) * 100 : 0}%` } as React.CSSProperties}
        />
      </div>
      <div className="mp-row">
        <div className="mp-cover">
          <Cover path={now.work.cover} />
        </div>
        <div className="mp-text">
          <div className="mp-title">{g?.title}</div>
          <div className="mp-work">{now.work.title}</div>
        </div>
        <div className="mp-controls">
          <button className="mini icon mp-skip" title="이전 트랙" onClick={prev}>
            <SkipPreviousIcon />
          </button>
          <button className="mini icon play-solid mp-play" title="재생 / 일시정지" onClick={toggle}>
            {playing ? <PauseIcon /> : <PlayArrowIcon />}
          </button>
          <button className="mini icon mp-skip" title="다음 트랙" onClick={() => next()}>
            <SkipNextIcon />
          </button>
          <Volume />
        </div>
      </div>
    </footer>
  )
}

export default function NowBar(): JSX.Element | null {
  const narrow = useNarrow()
  const now = useStore((s) => s.now)
  const view = useStore((s) => s.view)
  const works = useStore((s) => s.works)
  // the full bar gives way to the small one where its right group (북마크
  // first) runs into the seek bar. Measured at every width: while the small
  // bar shows, the full one stays laid out out of sight (same width) and
  // keeps being measured, so it comes back as soon as it fits again.
  const [, setWinW] = useState(window.innerWidth)
  const [overlap, setOverlap] = useState(false)
  const bar = useRef<HTMLElement>(null)
  const right = useRef<HTMLDivElement>(null)
  const center = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const on = (): void => setWinW(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  useLayoutEffect(() => {
    const f = bar.current
    if (narrow || !f || !right.current || !center.current) return
    // side columns at least as wide as the right group: the seek bar
    // (centre) shrinks first, down to its minimum
    f.style.setProperty('--nb-side', `${right.current.scrollWidth}px`)
    const seekEnd = center.current.querySelector('.seekbar')?.getBoundingClientRect().right ?? 0
    const r = right.current.getBoundingClientRect()
    const o = r.left < seekEnd || r.right > f.getBoundingClientRect().right + 1
    if (o !== overlap) setOverlap(o)
  })
  if (!now) return null
  if (narrow) return view === 'now' ? null : <MiniPlayer />
  const g = now.work.groups.find((x) => x.key === now.groupKey)
  const fav = works.find((w) => w.id === now.work.id)?.favorite ?? now.work.favorite
  const groupIds = works.find((w) => w.id === now.work.id)?.groupIds ?? now.work.groupIds
  const goWork = (): void => void useStore.getState().openWork(now.work.id)
  const full = (
    <footer className={`nowbar ${overlap ? 'nb-measure' : ''}`} ref={bar} onClick={onBar} aria-hidden={overlap || undefined}>
      <div className="nb-left">
        <button className="nb-cover" onClick={toggleNowView} title="지금 재생 화면">
          <Cover path={now.work.cover} />
        </button>
        <div className="nb-text">
          <button className="nb-title" onClick={toggleNowView}>
            {g?.title}
          </button>
          <button className="nb-work" onClick={goWork}>
            {now.work.title}
          </button>
        </div>
        <div className="flat-group">
          <GroupButton id={now.work.id} groupIds={groupIds} />
          <FavButton id={now.work.id} on={fav} />
        </div>
      </div>
      <div className="nb-center" ref={center}>
        <Transport />
        <SeekBar />
      </div>
      <div className="nb-right flat-group" ref={right}>
        <BookmarkButton className="tb" />
        {/* 지금 재생 has its own (head of the screen) */}
        {view !== 'now' ? <SubsToggle /> : <ResumeToggle className="tb" />}
        <SpeedMenu />
        <SleepMenu />
        <Volume />
      </div>
    </footer>
  )
  return overlap ? (
    <>
      <MiniPlayer />
      {full}
    </>
  ) : (
    full
  )
}
