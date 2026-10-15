// 지금 재생 on a narrow window (Halftone side panel): Spotify mobile's full
// player. Collapse ▾ · "작품에서 재생 중" · ⋯ on top, the art (with the
// subtitle over it), title + ♥, seek bar with the times under it, the big
// round play in the middle of the transport, a utility row, then cards:
// 자막 (expands to the whole panel), 북마크, 작품.
import { useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import { next, prev, skip, toggle } from '../player'
import { Lyrics, Stage, SubBar, SubsToggle } from './NowView'
import { RateControl, SeekBar, SleepControl, Volume } from './NowBar'
import SubEditor from './SubEditor'
import { BookmarkButton } from './Bookmarks'
import { FavButton, GroupButton, Popover, SHEET_MS, useAnchor, useExit } from './ui'
import {
  BedtimeIcon,
  EditIcon,
  Forward5Icon,
  FullscreenIcon,
  KeyboardArrowDownIcon,
  LibraryMusicIcon,
  LyricsIcon,
  MoreHorizIcon,
  PauseIcon,
  PlayArrowIcon,
  RepeatIcon,
  RepeatOneIcon,
  Replay5Icon,
  ShuffleIcon,
  SkipNextIcon,
  SkipPreviousIcon,
  SpeedIcon, UpdateDisabledIcon, UpdateIcon } from './icons'

function collapse(): void {
  const st = useStore.getState()
  if (st.historyAt > 0) st.navBack()
  else st.setView('library')
}

function PlayBig(): JSX.Element {
  const playing = useStore((s) => s.playing)
  return (
    <button className="mn-play" title="재생 / 일시정지 (Space)" onClick={toggle}>
      {playing ? <PauseIcon /> : <PlayArrowIcon />}
    </button>
  )
}

function Transport(): JSX.Element {
  const step = useStore((s) => s.settings?.seekStep ?? 5)
  return (
    <div className="mn-transport">
      <button className="mini icon mn-tb" title="이전 트랙" onClick={prev}>
        <SkipPreviousIcon />
      </button>
      <button className="mini icon mn-tb" title={`${step}초 뒤로`} onClick={() => skip(-step)}>
        <Replay5Icon />
      </button>
      <PlayBig />
      <button className="mini icon mn-tb" title={`${step}초 앞으로`} onClick={() => skip(step)}>
        <Forward5Icon />
      </button>
      <button className="mini icon mn-tb" title="다음 트랙" onClick={() => next()}>
        <SkipNextIcon />
      </button>
    </div>
  )
}

function Utility({ lyr, setLyr }: { lyr: boolean; setLyr: (b: boolean) => void }): JSX.Element {
  const s = useStore((x) => x.settings)
  const save = useStore((x) => x.saveSettings)
  const repeat = s?.repeat ?? 'off'
  return (
    <div className="mn-util">
      <div className="flat-group">
        <button className={`mini icon tb ${s?.shuffle ? 'on' : ''}`} title="무작위 재생" onClick={() => void save({ shuffle: !s?.shuffle })}>
          <ShuffleIcon />
        </button>
        <button
          className={`mini icon tb ${repeat !== 'off' ? 'on' : ''}`}
          title={repeat === 'off' ? '반복 사용 안 하기' : repeat === 'all' ? '작품 전체 반복' : '한 트랙 반복'}
          onClick={() => void save({ repeat: repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off' })}
        >
          {repeat === 'one' ? <RepeatOneIcon /> : <RepeatIcon />}
        </button>
      </div>
      <div className="flat-group">
        <BookmarkButton className="tb" />
        <SubsToggle />
        <button className={`mini icon tb ${lyr ? 'on' : ''}`} title={lyr ? '전체 자막 닫기' : '전체 자막 열기'} onClick={() => setLyr(!lyr)}>
          <LyricsIcon />
        </button>
        <Volume />
      </div>
    </div>
  )
}

function MoreMenu(): JSX.Element {
  const now = useStore((s) => s.now)!
  const resume = useStore((s) => s.settings?.resume ?? true)
  const pop = useAnchor()
  const close = pop.close
  return (
    <>
      <button className={`mini icon ${pop.open ? 'on' : ''}`} title="더 보기" onClick={(e) => pop.toggle(e.currentTarget)}>
        <MoreHorizIcon />
      </button>
      {pop.anchor && (
        <Popover anchor={pop.anchor} closing={pop.closing} onClose={close}>
          <div className="menu">
            <button className="menu-item" onClick={() => (close(), void useStore.getState().openWork(now.work.id))}>
              <LibraryMusicIcon /> 작품 화면 열기
            </button>
            <button className="menu-item" onClick={() => (close(), useStore.setState({ editing: true }))}>
              <EditIcon /> 자막 편집
            </button>
            <button className="menu-item" onClick={() => (close(), void document.querySelector<HTMLElement>('.stage')?.requestFullscreen())}>
              <FullscreenIcon /> 전체 화면
            </button>
            <div className="menu-sep" />
            <div className="menu-title">
              {resume ? <UpdateIcon /> : <UpdateDisabledIcon />} 이어 듣기
            </div>
            <div className="menu-opts">
              <button className={`mini ${resume ? 'on' : ''}`} onClick={() => void useStore.getState().saveSettings({ resume: true })}>
                켜기
              </button>
              <button className={`mini ${resume ? '' : 'on'}`} onClick={() => void useStore.getState().saveSettings({ resume: false })}>
                끄기
              </button>
            </div>
            <div className="menu-sep" />
            <div className="menu-title">
              <SpeedIcon /> 재생 속도
            </div>
            <RateControl />
            <div className="menu-sep" />
            <div className="menu-title">
              <BedtimeIcon /> 수면 타이머
            </div>
            <SleepControl />
          </div>
        </Popover>
      )}
    </>
  )
}

// The whole panel for one thing (full subtitles / the editor), with a small
// player at the bottom like Spotify's expanded lyrics.
// ▾ puts the sheet away; the editor adds its own ✕ (close without saving) at
// the header's right end
function Sheet({ title, onClose, leaving, children }: { title: string; onClose: () => void; leaving?: boolean; children: React.ReactNode }): JSX.Element {
  const now = useStore((s) => s.now)!
  const g = now.work.groups.find((x) => x.key === now.groupKey)
  return (
    <div className={`mn-sheet ${leaving ? 'leaving' : ''}`}>
      <header className="mn-head">
        <button className="mini icon" title="잠시 나가기" onClick={onClose}>
          <KeyboardArrowDownIcon />
        </button>
        <div className="mn-from">
          <span>{title}</span>
          <b>{g?.title}</b>
        </div>
        <span className="mn-head-gap" />
      </header>
      <div className="mn-sheet-body">{children}</div>
      <footer className="mn-sheet-foot">
        <SeekBar />
        <PlayBig />
      </footer>
    </div>
  )
}

export default function MobileNow(): JSX.Element {
  const now = useStore((s) => s.now)!
  const works = useStore((s) => s.works)
  const editing = useStore((s) => s.editing)
  const [lyr, setLyr] = useState(false) // 전체 자막 in place of the picture
  const lyrEx = useExit(lyr, SHEET_MS) // slides up in / down out
  const editEx = useExit(editing, SHEET_MS)
  const w = now.work
  const g = w.groups.find((x) => x.key === now.groupKey)
  const fav = works.find((x) => x.id === w.id)?.favorite ?? w.favorite
  const groupIds = works.find((x) => x.id === w.id)?.groupIds ?? w.groupIds
  return (
    <div className="mnow">
      {w.cover && <div className="mn-bg" style={{ backgroundImage: `url("${window.api.thumbUrl(w.cover)}")` }} />}
      <div className="mn-scroll">
        <header className="mn-head">
          <button className="mini icon" title="접기" onClick={collapse}>
            <KeyboardArrowDownIcon />
          </button>
          <div className="mn-from">
            <span>작품에서 재생 중</span>
            <button onClick={() => void useStore.getState().openWork(w.id)}>{w.title}</button>
          </div>
          <MoreMenu />
        </header>

        {/* the picture, or the full subtitles in its place; ♥ shows on hover */}
        <div className={`mn-art ${lyr ? 'lyr' : ''}`}>
          <Stage />
          {!lyr && (
            <div className={`art-tools flat-group ${fav || groupIds.length ? 'keep' : ''}`}>
              <GroupButton id={w.id} groupIds={groupIds} />
              <FavButton id={w.id} on={fav} />
            </div>
          )}
          {lyrEx.mounted && (
            <div className={`mn-art-lyrics ${lyrEx.leaving ? 'leaving' : ''}`}>
              <SubBar />
              <Lyrics />
            </div>
          )}
        </div>

        <div className="mn-meta">
          <div className="mn-titles">
            <div className="mn-title">{g?.title}</div>
            <button className="mn-work" onClick={() => void useStore.getState().openWork(w.id)}>
              {w.title}
            </button>
          </div>
        </div>

        {/* the player's "bottom bar": under the line, a click anywhere that isn't a
            control closes 지금 재생 (like the bottom bar does on other screens) */}
        <div
          className="mn-bar"
          title="지금 재생 닫기"
          onClick={(e) => (e.target as HTMLElement).closest('button, input, a, .cat-wrap, .dropdown, .volume') || collapse()}
        >
          <div className="mn-seek">
            <SeekBar />
          </div>
          <Transport />
          <Utility lyr={lyr} setLyr={setLyr} />
        </div>

      </div>

      {editEx.mounted && (
        <Sheet title="자막 편집" leaving={editEx.leaving} onClose={() => useStore.setState({ editing: false })}>
          <SubEditor sheet />
        </Sheet>
      )}
    </div>
  )
}
