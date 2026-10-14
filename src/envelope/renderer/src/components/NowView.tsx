import { useEffect, useMemo, useRef } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { Cue, SubMode, SubtitleText } from '../../../shared/types'
import { attachVideo, seek } from '../player'
import { cueAt, linesFor, setSubOffset } from '../subs'
import SubEditor from './SubEditor'
import MobileNow from './MobileNow'
import { useNarrow } from './ui'
import {
  KeyboardArrowLeftIcon,
  KeyboardArrowRightIcon,
  EditIcon,
  FullscreenIcon,
  LibraryMusicIcon,
  RightPanelCloseIcon,
  RightPanelOpenIcon,
  SubtitlesIcon,
  SubtitlesOffIcon,
  TextDecreaseIcon,
  TextIncreaseIcon, UpdateDisabledIcon, UpdateIcon } from './icons'

const MODES: [SubMode, string][] = [
  ['both', '둘 다'],
  ['original', '원문'],
  ['translation', '번역']
]

// Translation lines that overlap an original cue (shown under it).
function pairUp(main: Cue[], second: Cue[] | undefined): string[] {
  if (!second) return main.map(() => '')
  return main.map((c) =>
    second
      .filter((s) => s.start < c.end && s.end > c.start)
      .map((s) => s.text)
      .join(' ')
  )
}

export function Stage(): JSX.Element {
  const narrow = useNarrow()
  const now = useStore((s) => s.now)!
  const imgIndex = useStore((s) => s.imgIndex)
  const subs = useStore((s) => s.subs)
  const mode = useStore((s) => s.settings?.subMode ?? 'both')
  const size = useStore((s) => s.settings?.subSize ?? 22)
  const time = useStore((s) => s.time)
  const ref = useRef<HTMLDivElement>(null)
  const vref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    attachVideo(vref.current)
    return () => attachVideo(null)
  }, [])
  const w = now.work
  const g = w.groups.find((x) => x.key === now.groupKey)
  const video = g?.versions.find((v) => v.id === now.trackId)?.kind === 'video'
  const images = w.images.length ? w.images : w.cover ? [w.cover] : []
  const img = images.length ? images[((imgIndex % images.length) + images.length) % images.length] : null
  const step = (d: number): void => useStore.setState({ imgIndex: imgIndex + d })
  const visible = useStore((s) => s.settings?.subsVisible ?? true)
  const { main, second } = linesFor(visible ? subs : null, mode)
  const t = time - (g?.subOffset ?? 0)
  const line = (s: SubtitleText | null): string => {
    if (!s) return ''
    const i = cueAt(s.cues, t)
    return i >= 0 ? s.cues[i].text : ''
  }
  const l1 = line(main)
  const l2 = line(second)
  return (
    <div className="stage" ref={ref} onDoubleClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void ref.current?.requestFullscreen())}>
      {img && !video && (
        <>
          <div className="stage-blur" style={{ backgroundImage: `url("${window.api.thumbUrl(img)}")` }} />
          <img className="stage-img" src={window.api.mediaUrl(img)} alt="" draggable={false} />
        </>
      )}
      {!img && !video && <LibraryMusicIcon className="stage-ph" />}
      <video ref={vref} className="stage-video" style={{ display: video ? 'block' : 'none' }} playsInline />
      {(l1 || l2) && (
        <div className="overlay-sub" style={{ fontSize: narrow ? Math.round((size * 16) / 22) : size }}>
          {l1 && <div className="l1">{l1}</div>}
          {l2 && <div className="l2">{l2}</div>}
        </div>
      )}
      <div className="stage-tools flat-group">
        {images.length > 1 && !video && (
          <>
            <button className="mini icon" title="이전 이미지" onClick={() => step(-1)}>
              <KeyboardArrowLeftIcon />
            </button>
            <span className="img-count">
              {((imgIndex % images.length) + images.length) % images.length + 1} / {images.length}
            </span>
            <button className="mini icon" title="다음 이미지" onClick={() => step(1)}>
              <KeyboardArrowRightIcon />
            </button>
          </>
        )}
        <button className="mini icon" title="전체 화면 (더블클릭)" onClick={() => void ref.current?.requestFullscreen()}>
          <FullscreenIcon />
        </button>
      </div>
    </div>
  )
}

export function Lyrics(): JSX.Element {
  const now = useStore((s) => s.now)!
  const subs = useStore((s) => s.subs)
  const mode = useStore((s) => s.settings?.subMode ?? 'both')
  const time = useStore((s) => s.time)
  const g = now.work.groups.find((x) => x.key === now.groupKey)
  const offset = g?.subOffset ?? 0
  const { main, second } = linesFor(subs, mode === 'off' ? 'both' : mode)
  const pairs = useMemo(() => (main ? pairUp(main.cues, second?.cues) : []), [main, second])
  const active = main ? cueAt(main.cues, time - offset) : -1
  const box = useRef<HTMLDivElement>(null)
  const userScroll = useRef(0)
  useEffect(() => {
    if (active < 0 || Date.now() - userScroll.current < 4000) return
    // scroll only the list itself (it can sit inside a scrolling page)
    const b = box.current
    const el = b?.querySelector<HTMLElement>(`[data-i="${active}"]`)
    if (b && el) b.scrollTo({ top: el.offsetTop - b.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' })
  }, [active])

  if (!subs || !main)
    return (
      <div className="lyrics empty-lyrics">
        <SubtitlesOffIcon className="hero-icon muted" />
        <p>{subs ? '이 트랙에는 자막 파일이 없습니다.' : '자막을 확인하는 중입니다…'}</p>
        {subs && <p className="hint">음성 파일과 같은 이름의 vtt · srt · lrc 파일이 있으면 자동으로 연결됩니다.</p>}
      </div>
    )
  return (
    <div className="lyrics" ref={box} onWheel={() => (userScroll.current = Date.now())} onTouchMove={() => (userScroll.current = Date.now())}>
      {subs.borrowed && <div className="hint lyrics-note">같은 트랙의 다른 버전에 있는 자막입니다.</div>}
      {main.cues.map((c, i) => (
        <button key={i} data-i={i} className={`lline ${i === active ? 'on' : i < active ? 'past' : ''}`} onClick={() => seek(c.start + offset)}>
          <span className="lt">{c.text}</span>
          {pairs[i] && <span className="ls">{pairs[i]}</span>}
        </button>
      ))}
    </div>
  )
}

export function SubBar(): JSX.Element {
  const now = useStore((s) => s.now)!
  const subs = useStore((s) => s.subs)
  const settings = useStore((s) => s.settings)
  const save = useStore((s) => s.saveSettings)
  const g = now.work.groups.find((x) => x.key === now.groupKey)
  const offset = g?.subOffset ?? 0
  const both = !!(subs?.ja || subs?.other) && !!subs?.ko
  const setOffset = setSubOffset
  return (
    <div className="subbar">
      {both && (
        <div className="flat-group" title="원문(일본어)과 번역(한국어) 중 보여줄 줄">
          {MODES.map(([m, label]) => (
            <button key={m} className={`mini ${settings?.subMode === m ? 'on' : ''}`} onClick={() => void save({ subMode: m })}>
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="flat-group">
        <button className="mini icon" title="글자 작게" onClick={() => void save({ subSize: Math.max(14, (settings?.subSize ?? 22) - 2) })}>
          <TextDecreaseIcon />
        </button>
        <button className="mini icon" title="글자 크게" onClick={() => void save({ subSize: Math.min(48, (settings?.subSize ?? 22) + 2) })}>
          <TextIncreaseIcon />
        </button>
      </div>
      <div className="flat-group offset" title="자막 싱크 (이 트랙만, 파일은 바꾸지 않습니다)">
        <button className="mini" onClick={() => setOffset(offset - 0.1)}>
          -0.1
        </button>
        <button className="mini" onClick={() => setOffset(0)} title="싱크 초기화">
          {offset > 0 ? '+' : ''}
          {offset.toFixed(1)}초
        </button>
        <button className="mini" onClick={() => setOffset(offset + 0.1)}>
          +0.1
        </button>
      </div>
      <span className="grow" />
      <div className="flat-group">
        <button className="mini icon" title="자막 편집" onClick={() => useStore.setState({ editing: true })}>
          <EditIcon />
        </button>
      </div>
    </div>
  )
}

// 이어 듣기 켜기 / 끄기 (설정 › 재생 › 이어 듣기)
export function ResumeToggle({ className }: { className?: string }): JSX.Element {
  const on = useStore((s) => s.settings?.resume ?? true)
  return (
    <button
      className={`mini icon ${className ?? ''} ${on ? 'on' : ''}`}
      title={on ? '이어 듣기 끄기 (처음부터 재생)' : '이어 듣기 켜기 (듣던 곳부터 재생)'}
      onClick={() => void useStore.getState().saveSettings({ resume: !on })}
    >
      {on ? <UpdateIcon /> : <UpdateDisabledIcon />}
    </button>
  )
}

export function SubsToggle(): JSX.Element {
  const on = useStore((s) => s.settings?.subsVisible ?? true)
  return (
    <button
      className={`mini icon ${on ? 'on' : ''}`}
      title={on ? '자막 끄기 (C)' : '자막 켜기 (C)'}
      onClick={() => void useStore.getState().saveSettings({ subsVisible: !on })}
    >
      {on ? <SubtitlesIcon /> : <SubtitlesOffIcon />}
    </button>
  )
}

export default function NowView(): JSX.Element {
  const narrow = useNarrow()
  const now = useStore((s) => s.now)
  const editing = useStore((s) => s.editing)
  const panel = useStore((s) => s.settings?.lyricsPanel ?? true)
  const open = panel || editing
  if (!now)
    return (
      <div className="empty">
        <LibraryMusicIcon className="hero-icon" />
        <h2>재생 중인 작품이 없습니다</h2>
        <p className="muted">라이브러리에서 작품을 골라 재생하세요.</p>
        <button className="btn primary" onClick={() => useStore.getState().setView('library')}>
          라이브러리로
        </button>
      </div>
    )
  if (narrow) return <MobileNow />
  const g = now.work.groups.find((x) => x.key === now.groupKey)
  return (
    <div className={`nowview ${editing ? 'editing' : ''} ${open ? '' : 'no-panel'}`}>
      <div className="nv-left">
        <Stage />
        <div className="nv-info">
          <div className="nv-head">
            <div className="nv-titles">
              <div className="nv-title">{g?.title}</div>
              <button className="nv-work" onClick={() => void useStore.getState().openWork(now.work.id)}>
                {now.work.title}
              </button>
            </div>
            <div className="flat-group">
              <SubsToggle />
              <button
                className={`mini icon ${open ? 'on' : ''}`}
                title={open ? '전체 자막 창 닫기' : '전체 자막 창 열기'}
                disabled={editing}
                onClick={() => void useStore.getState().saveSettings({ lyricsPanel: !panel })}
              >
                {open ? <RightPanelCloseIcon /> : <RightPanelOpenIcon />}
              </button>
            </div>
          </div>
        </div>
      </div>
      {/* kept mounted (closed = zero width) so it slides in and out */}
      <div className="nv-right" aria-hidden={!open}>
        <div className="nv-panel">
          {editing ? (
            <SubEditor />
          ) : (
            <>
              <SubBar />
              <Lyrics />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
