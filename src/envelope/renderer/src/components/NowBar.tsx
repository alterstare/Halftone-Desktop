import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { SleepMode } from '../store'
import { next, prev, seek, setRate, setSleep, setVolume, skip, toggle } from '../player'
import { clock } from '../format'
import {
  BedtimeIcon,
  Forward5Icon,
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

export function SpeedMenu(): JSX.Element {
  const p = usePopover()
  const rate = useStore((s) => s.settings?.rate ?? 1)
  return (
    <div className="cat-wrap" ref={p.ref}>
      <button className={`mini icon tb ${rate !== 1 ? 'on' : ''}`} title="재생 속도" onClick={() => p.setOpen(!p.open)}>
        {rate !== 1 ? <span className="rate">{rate}x</span> : <SpeedIcon />}
      </button>
      {p.mounted && (
        <div className={`cat-panel up right menu ${p.closing ? 'closing' : ''}`}>
          {RATES.map((r) => (
            <button key={r} className={`menu-item ${r === rate ? 'on' : ''}`} onClick={() => (setRate(r), p.setOpen(false))}>
              {r}x
            </button>
          ))}
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
        <div className={`cat-panel up right menu ${p.closing ? 'closing' : ''}`}>
          <div className="menu-title">수면 타이머</div>
          {SLEEP.map(([label, mode, min]) => (
            <button
              key={label}
              className={`menu-item ${sleep.mode === mode && (mode !== 'time' || sleep.minutes === min) ? 'on' : ''}`}
              onClick={() => (setSleep(mode, min), p.setOpen(false))}
            >
              {label}
            </button>
          ))}
          {sleep.mode !== 'off' && (
            <button className="menu-item" onClick={() => (setSleep('off'), p.setOpen(false))}>
              타이머 끄기
            </button>
          )}
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
