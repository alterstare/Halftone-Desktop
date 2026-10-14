// 최소화 모드: the whole window is one bar (standalone only).
//   [‹] 표지 [›]  |  자막 (원문 위 · 번역 아래) / 진행 막대  |  이전 · 재생 · 다음 · 음량 · 항상 위 · 원래 크기 · 닫기
// ‹ › go through the works on the LP bar (in its order): the next one is
// loaded at its 이어 듣기 point — playing on if something was playing.
// The bar itself moves the window (drag area); controls don't.
import type { JSX } from 'react'
import { useStore } from '../store'
import { cueAt, linesFor } from '../subs'
import { next, play, prev, resumeTarget, toggle } from '../player'
import type { SubtitleText } from '../../../shared/types'
import { SeekBar } from './NowBar'
import { setVolume } from '../player'
import { useEffect, useRef } from 'react'
import { VolumeOffIcon, VolumeUpIcon } from './icons'
import { Cover } from './ui'
import { leaveMini } from '../miniMode'
import { hosted, requestHost } from '../embed'
import { Volume } from './NowBar'
import {
  AlbumIcon,
  CloseIcon,
  KeepIcon,
  KeyboardArrowLeftIcon,
  KeyboardArrowRightIcon,
  OpenInFullIcon,
  PauseIcon,
  PlayArrowIcon,
  SkipNextIcon,
  SkipPreviousIcon
} from './icons'

async function switchWork(id: number): Promise<void> {
  const st = useStore.getState()
  const wasPlaying = st.playing
  const w = await window.api.work(id)
  const g = w && resumeTarget(w)
  if (!w || !g) return
  await play(w, g.key, { autoplay: wasPlaying })
  void st.openWork(id) // back in the big window, its page is the one shown
}

function MiniSubs(): JSX.Element {
  const now = useStore((s) => s.now)
  const subs = useStore((s) => s.subs)
  const time = useStore((s) => s.time)
  const visible = useStore((s) => s.settings?.subsVisible ?? true)
  const mode = useStore((s) => s.settings?.subMode ?? 'both')
  const g = now?.work.groups.find((x) => x.key === now.groupKey)
  const t = time - (g?.subOffset ?? 0)
  const { main, second } = linesFor(subs, mode)
  const line = (s: SubtitleText | null): string => {
    if (!s) return ''
    const i = cueAt(s.cues, t)
    return i >= 0 ? s.cues[i].text.replace(/\n/g, ' ') : ''
  }
  const l1 = visible ? line(main) : ''
  const l2 = visible ? line(second) : ''
  if (!now)
    return (
      <div className="mm-subs">
        <div className="mm-l2">재생 중인 작품이 없습니다</div>
      </div>
    )
  return (
    <div className={`mm-subs ${l2 ? 'two' : ''}`}>
      {l1 && (
        <div className="mm-l1" title={l1}>
          {l1}
        </div>
      )}
      {l2 && (
        <div className="mm-l2" title={l2}>
          {l2}
        </div>
      )}
    </div>
  )
}

// 음량: hover opens the bar above the button — in its own small window (main),
// since this one is only as tall as the bar; click mutes.
const POP_COLORS = { bg: '--bg-2', line: '--line', accent: '--accent', track: '--bg-3', text: '--text' }
function MiniVolume(): JSX.Element {
  const vol = useStore((s) => s.settings?.volume ?? 1)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => window.api.onVolPopInput((v) => setVolume(v)), [])
  useEffect(() => window.api.volPop({ action: 'value', value: vol }), [vol])
  useEffect(() => () => window.api.volPop({ action: 'hide' }), [])
  const show = (): void => {
    const r = btn.current!.getBoundingClientRect()
    const css = getComputedStyle(document.documentElement)
    const colors = Object.fromEntries(Object.entries(POP_COLORS).map(([k, v]) => [k, css.getPropertyValue(v).trim()]))
    window.api.volPop({ action: 'show', rect: { x: r.x, y: r.y, w: r.width, h: r.height }, value: vol, colors })
  }
  return (
    <button
      ref={btn}
      className="mini icon tb"
      title="음소거"
      onMouseEnter={show}
      onMouseLeave={() => window.api.volPop({ action: 'leave' })}
      onClick={() => setVolume(vol > 0 ? 0 : 1)}
    >
      {vol > 0 ? <VolumeUpIcon /> : <VolumeOffIcon />}
    </button>
  )
}

// Inside Halftone the bar is a frame only as tall as the bar: while the
// pointer is on 음량, Halftone lifts the frame (its top see-through) so the
// pop-up bar fits above.
const LIFT_PX = 150
function LiftedVolume(): JSX.Element {
  const drop = useRef<ReturnType<typeof setTimeout> | null>(null)
  return (
    <div
      className="mm-lift"
      onMouseEnter={() => {
        if (drop.current) clearTimeout(drop.current)
        requestHost({ what: 'lift', px: LIFT_PX })
      }}
      onMouseLeave={() => (drop.current = setTimeout(() => requestHost({ what: 'lift', px: 0 }), 220))}
    >
      <Volume />
    </div>
  )
}

export default function MiniMode(): JSX.Element {
  const now = useStore((s) => s.now)
  const playing = useStore((s) => s.playing)
  // the LP bar's works that are in the library (a tab can outlive its work)
  const allTabs = useStore((s) => s.tabs)
  const works = useStore((s) => s.works)
  const tabs = allTabs.filter((id) => works.some((w) => w.id === id))
  const onTop = useStore((s) => s.win.onTop)
  const g = now?.work.groups.find((x) => x.key === now.groupKey)
  const at = now ? tabs.indexOf(now.work.id) : -1
  const step = (d: number): void => {
    if (!tabs.length) return
    const i = at < 0 ? (d > 0 ? 0 : tabs.length - 1) : (at + d + tabs.length) % tabs.length
    if (tabs[i] !== now?.work.id) void switchWork(tabs[i])
  }
  const canStep = tabs.length > (at < 0 ? 0 : 1)
  return (
    <div className={`minimode ${now ? '' : 'empty'}`}>
      <div className="mm-left">
        <button className="mini icon mm-arrow" title="LP의 이전 작품" disabled={!canStep} onClick={() => step(-1)}>
          <KeyboardArrowLeftIcon />
        </button>
        <div className="mm-cover" title={now ? `${g?.title ?? ''} · ${now.work.title}` : undefined}>
          {now ? <Cover path={now.work.cover} /> : <AlbumIcon />}
        </div>
        <button className="mini icon mm-arrow" title="LP의 다음 작품" disabled={!canStep} onClick={() => step(1)}>
          <KeyboardArrowRightIcon />
        </button>
      </div>
      <div className="mm-center">
        <MiniSubs />
        {now && <SeekBar />}
      </div>
      <div className="mm-right">
        <div className="mm-transport">
          <button className="mini icon mm-skip" title="이전 트랙" disabled={!now} onClick={prev}>
            <SkipPreviousIcon />
          </button>
          <button className="mini icon play-solid mm-play" title="재생 / 일시정지" disabled={!now && !tabs.length} onClick={() => (now ? toggle() : step(1))}>
            {playing ? <PauseIcon /> : <PlayArrowIcon />}
          </button>
          <button className="mini icon mm-skip" title="다음 트랙" disabled={!now} onClick={() => next()}>
            <SkipNextIcon />
          </button>
        </div>
        {hosted ? (
          <div className="flat-group mm-tools">
            <LiftedVolume />
            <button className="mini icon tb" title="패널로 보기" onClick={() => requestHost({ what: 'panel' })}>
              <OpenInFullIcon />
            </button>
            <button className="mini icon tb" title="음성 플레이어 닫기" onClick={() => requestHost({ what: 'close' })}>
              <CloseIcon />
            </button>
          </div>
        ) : (
          <div className="flat-group mm-tools">
            <MiniVolume />
            <button className={`mini icon tb ${onTop ? 'on' : ''}`} title={onTop ? '항상 위에 두기 끄기' : '항상 위에 두기'} onClick={() => void window.api.setOnTop(!onTop)}>
              <KeepIcon />
            </button>
            <button className="mini icon tb" title="원래 크기로" onClick={() => void leaveMini()}>
              <OpenInFullIcon />
            </button>
            <button className="mini icon tb" title="닫기" onClick={() => window.api.winControl('close')}>
              <CloseIcon />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
