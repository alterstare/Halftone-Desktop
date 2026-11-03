import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { KeyboardArrowDownIcon } from './icons'
import { usePopover } from './usePopover'

// Text outline for the translation editor's 번역문 stage: a split button — the
// left half turns the outline on / off, the arrow opens a menu for its width
// and colour (both previewed while dragged, committed on release). The menu:
// usePopover.
export default function OutlineButton({
  on,
  width,
  color,
  disabled,
  onToggle,
  onPreview,
  onCommit
}: {
  on: boolean
  width: number
  color: string
  disabled?: boolean
  onToggle: () => void
  onPreview: (patch: { outlineWidth?: number; outlineColor?: string }) => void
  onCommit: (patch: { outlineWidth?: number; outlineColor?: string }) => void
}): JSX.Element {
  const { open, setOpen, pos, boxRef, popRef } = usePopover()
  const [w, setW] = useState(width)
  const [c, setC] = useState(color)
  useEffect(() => setW(width), [width])
  useEffect(() => setC(color), [color])
  // The palette commits once, when it closes (the native change event).
  const colRef = useRef<HTMLInputElement>(null)
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit
  useEffect(() => {
    const el = colRef.current
    if (!el) return
    const h = (): void => commitRef.current({ outlineColor: el.value })
    el.addEventListener('change', h)
    return () => el.removeEventListener('change', h)
  }, [open, pos])
  // keep the textarea's selection — but not on the menu's inputs: that would stop a slider's drag
  const keep = (e: React.MouseEvent): void => {
    if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
  }
  return (
    <div ref={boxRef} className={`ted-split${on ? ' on' : ''}`}>
      <button className="ted-split-main" disabled={disabled} onMouseDown={keep} onClick={onToggle} title="글자 외곽선">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M5.5 19l5.25-14h2.5l5.25 14h-2.4l-1.25-3.6H9.2L7.9 19zm4.4-5.6h4.2l-2.05-5.8h-.1z"
            fill={on ? c : 'none'}
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <span className="ted-split-sep" />
      <button className="ted-split-arrow" disabled={disabled} onMouseDown={keep} onClick={() => setOpen((v) => !v)} title="외곽선 두께 · 색">
        <KeyboardArrowDownIcon />
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={popRef} className="ted-outpop" style={{ left: pos.left, top: pos.top }} onMouseDown={keep}>
            <label className="ted-outrow">
              <span>두께</span>
              <input
                type="range"
                min={1}
                max={12}
                value={w}
                onChange={(e) => {
                  setW(Number(e.target.value))
                  onPreview({ outlineWidth: Number(e.target.value) })
                }}
                onPointerUp={(e) => onCommit({ outlineWidth: Number(e.currentTarget.value) })}
                onKeyUp={(e) => onCommit({ outlineWidth: Number(e.currentTarget.value) })}
              />
              <span className="ted-tool-val">{w}px</span>
            </label>
            <label className="ted-outrow">
              <span>색</span>
              <input
                ref={colRef}
                type="color"
                defaultValue={c}
                onInput={(e) => {
                  setC(e.currentTarget.value)
                  onPreview({ outlineColor: e.currentTarget.value })
                }}
              />
              <span className="ted-tool-val">{c}</span>
            </label>
          </div>,
          document.body
        )}
    </div>
  )
}
