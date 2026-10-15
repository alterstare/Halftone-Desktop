// LP 탭: open works as vinyl records along a side of the window, half of each
// record tucked under the page, stacked top to bottom (1번, 2번, 3번 …). The work
// on screen slides out; the one playing spins in place. Clicking a record
// opens the work and readies the player at its resume point (paused).
import { useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import { play, resumeTarget } from '../player'
import { AlbumIcon, CloseFullscreenIcon, CloseIcon, CloseSmallIcon, OpenInFullIcon, PictureInPictureAltIcon } from './icons'
import { hosted, remote, requestHost } from '../embed'
import { useNarrow } from './ui'
import { enterMini } from '../miniMode'

async function openLp(id: number): Promise<void> {
  const st = useStore.getState()
  await st.openWork(id)
  if (st.now?.work.id === id) return // already in the player: leave it be
  const w = await window.api.work(id)
  const g = w && resumeTarget(w)
  if (w && g) await play(w, g.key, { autoplay: false })
}

function Lp({ id, n }: { id: number; n: number }): JSX.Element | null {
  const w = useStore((s) => s.works.find((x) => x.id === id))
  const active = useStore((s) => s.view === 'work' && s.shown?.id === id)
  const nowHere = useStore((s) => s.now?.work.id === id)
  const playing = useStore((s) => s.playing)
  const [drag, setDrag] = useState(false)
  if (!w) return null
  const st = useStore.getState
  return (
    <div
      className={`lp ${active ? 'active' : ''} ${nowHere ? 'now' : ''} ${nowHere && playing ? 'spin' : ''} ${drag ? 'drag' : ''}`}
      style={{ zIndex: n }}
      title={`${n}번 · ${w.title}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/env-tab', String(id))
        setDrag(true)
      }}
      onDragEnd={() => setDrag(false)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const from = Number(e.dataTransfer.getData('text/env-tab'))
        if (from && from !== id) st().moveTab(from, st().tabs.indexOf(id))
      }}
      onClick={() => void openLp(id)}
      onAuxClick={(e) => e.button === 1 && st().closeTab(id)}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
    >
      {/* .lp-disc slides; .lp-vinyl only turns (kept apart so it can't orbit) */}
      <div className="lp-disc">
        <div className="lp-vinyl">
          <div className="lp-label" style={w.cover ? { backgroundImage: `url("${window.api.thumbUrl(w.cover)}")` } : undefined}>
            {!w.cover && <AlbumIcon />}
          </div>
          <span className="lp-hole" />
        </div>
      </div>
      <span className="lp-num">{n}</span>
      <button
        className="lp-close"
        title="탭 닫기 (Ctrl+W, 가운데 클릭)"
        onClick={(e) => {
          e.stopPropagation()
          st().closeTab(id)
        }}
      >
        <CloseSmallIcon />
      </button>
    </div>
  )
}

// 최소화 모드 and 작은 창 ⇄ 큰 창. Inside Halftone: 음성 플레이어 닫기 on top,
// then the bar at Halftone's bottom, and the separate big window (from the
// panel) / back to the panel (from the big window).
function SizeToggle(): JSX.Element | null {
  const narrow = useNarrow()
  if (hosted)
    return (
      <div className="lp-foot">
        <button className="mini icon" title="음성 플레이어 닫기" onClick={() => requestHost({ what: 'close' })}>
          <CloseIcon />
        </button>
        <button className="mini icon" title="최소화 모드 (Halftone 아래 재생 바)" onClick={() => requestHost({ what: 'bar' })}>
          <PictureInPictureAltIcon />
        </button>
        {remote ? (
          <button className="mini icon" title="패널로 보기" onClick={() => requestHost({ what: 'panel' })}>
            <CloseFullscreenIcon />
          </button>
        ) : (
          <button className="mini icon" title="큰 창으로 보기 (별도 창)" onClick={() => requestHost({ what: 'window' })}>
            <OpenInFullIcon />
          </button>
        )}
      </div>
    )
  return (
    <div className="lp-foot">
      <button className="mini icon" title="최소화 모드 (재생 바만 남기기)" onClick={() => void enterMini()}>
        <PictureInPictureAltIcon />
      </button>
      <button className="mini icon" title={narrow ? '큰 창으로 전환' : '작은 창으로 전환'} onClick={() => void window.api.setCompact(!narrow)}>
        {narrow ? <OpenInFullIcon /> : <CloseFullscreenIcon />}
      </button>
    </div>
  )
}

export default function LpTabs(): JSX.Element {
  const tabs = useStore((s) => s.tabs)
  const side = useStore((s) => s.settings?.tabSide ?? 'right')
  return (
    <aside className={`lp-bar ${side}`}>
      {tabs.length === 0 ? (
        <div className="lp-empty" title="작품을 열면 여기에 LP로 쌓입니다">
          <AlbumIcon />
        </div>
      ) : (
        tabs.map((id, i) => <Lp key={id} id={id} n={i + 1} />)
      )}
      <SizeToggle />
    </aside>
  )
}
