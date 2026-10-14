// The title strip of the standalone window (no native title bar, so that
// 최소화 모드 can be just one bar): app icon and name on the left, the window
// buttons on the right — Windows' own caption glyphs from its icon font
// (Segoe Fluent Icons / MDL2 Assets, as the native title bar draws them),
// VS Code's codicons where that font isn't there. The strip moves the window.
import type { JSX } from 'react'
import { useStore } from '../store'
import appIcon from '../assets/app-icon.png'
import { ChromeCloseIcon, ChromeMaximizeIcon, ChromeMinimizeIcon, ChromeRestoreIcon } from './captionIcons'

const WINDOWS = /Windows/.test(navigator.userAgent)
// Segoe glyphs: ChromeMinimize, ChromeMaximize, ChromeRestore, ChromeClose
const GLYPH = { minimize: '', maximize: '', restore: '', close: '' }

function Glyph({ k }: { k: keyof typeof GLYPH }): JSX.Element {
  if (WINDOWS) return <span className="cap-glyph">{GLYPH[k]}</span>
  const Icon = { minimize: ChromeMinimizeIcon, maximize: ChromeMaximizeIcon, restore: ChromeRestoreIcon, close: ChromeCloseIcon }[k]
  return <Icon />
}

export default function TitleStrip(): JSX.Element {
  const max = useStore((s) => s.win.maximized)
  return (
    <div className="titlestrip" onDoubleClick={(e) => e.target === e.currentTarget && window.api.winControl('maximize')}>
      <img className="ts-icon" src={appIcon} alt="" />
      <span className="ts-name">Envelope</span>
      <div className="caption-buttons">
        <button className="cap" title="최소화" onClick={() => window.api.winControl('minimize')}>
          <Glyph k="minimize" />
        </button>
        <button className="cap" title={max ? '이전 크기로 복원' : '최대화'} onClick={() => window.api.winControl('maximize')}>
          <Glyph k={max ? 'restore' : 'maximize'} />
        </button>
        <button className="cap close" title="닫기" onClick={() => window.api.winControl('close')}>
          <Glyph k="close" />
        </button>
      </div>
    </div>
  )
}
