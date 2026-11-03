import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { KeyboardArrowDownIcon } from './icons'
import { usePopover } from './usePopover'

// A colour split button (the translation editor's 글자색 / 브러시 색): the left
// half applies the colour (as a document editor's font colour button), the
// arrow opens its options — the colour and its opacity, previewed while
// dragged and committed on release.
export default function ColorButton({
  color,
  opacity,
  look,
  title,
  disabled,
  onApply,
  onPreview,
  onCommit
}: {
  color: string
  opacity: number
  // text: an A over a bar of the colour; swatch: a dot of it
  look: 'text' | 'swatch'
  title: string
  disabled?: boolean
  onApply: () => void
  onPreview: (patch: { color?: string; opacity?: number }) => void
  onCommit: (patch: { color?: string; opacity?: number }) => void
}): JSX.Element {
  const { open, setOpen, pos, boxRef, popRef } = usePopover()
  const [c, setC] = useState(color)
  const [a, setA] = useState(opacity)
  useEffect(() => setC(color), [color])
  useEffect(() => setA(opacity), [opacity])
  // The palette commits once, when it closes (the native change event).
  const colRef = useRef<HTMLInputElement>(null)
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit
  useEffect(() => {
    const el = colRef.current
    if (!el) return
    const h = (): void => commitRef.current({ color: el.value })
    el.addEventListener('change', h)
    return () => el.removeEventListener('change', h)
  }, [open, pos])
  // keep the textarea's selection — but not on the menu's inputs: that would stop a slider's drag
  const keep = (e: React.MouseEvent): void => {
    if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
  }
  const rgba = (() => {
    const n = parseInt(c.slice(1), 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
  })()
  return (
    <div ref={boxRef} className="ted-split">
      <button className="ted-split-main" disabled={disabled} onMouseDown={keep} onClick={onApply} title={title}>
        {look === 'text' ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M5.5 17l5.25-14h2.5l5.25 14h-2.4l-1.25-3.6H9.2L7.9 17zm4.4-5.6h4.2l-2.05-5.8h-.1z" />
            <rect x="3" y="19.5" width="18" height="3.5" rx="1" fill={rgba} stroke="rgba(128,128,128,.6)" strokeWidth=".6" />
          </svg>
        ) : (
          <span className="ted-swatch ted-check">
            <span style={{ background: rgba }} />
          </span>
        )}
      </button>
      <span className="ted-split-sep" />
      <button className="ted-split-arrow" disabled={disabled} onMouseDown={keep} onClick={() => setOpen((v) => !v)} title={`${title} · 투명도`}>
        <KeyboardArrowDownIcon />
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={popRef} className="ted-outpop" style={{ left: pos.left, top: pos.top }} onMouseDown={keep}>
            <label className="ted-outrow">
              <span>색</span>
              <input
                ref={colRef}
                type="color"
                defaultValue={c}
                onInput={(e) => {
                  setC(e.currentTarget.value)
                  onPreview({ color: e.currentTarget.value })
                }}
              />
              <span className="ted-tool-val">{c}</span>
            </label>
            <label className="ted-outrow">
              <span>투명도</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((1 - a) * 100)}
                onChange={(e) => {
                  const v = 1 - Number(e.target.value) / 100
                  setA(v)
                  onPreview({ opacity: v })
                }}
                onPointerUp={(e) => onCommit({ opacity: 1 - Number(e.currentTarget.value) / 100 })}
                onKeyUp={(e) => onCommit({ opacity: 1 - Number(e.currentTarget.value) / 100 })}
              />
              <span className="ted-tool-val">{Math.round((1 - a) * 100)}%</span>
            </label>
          </div>,
          document.body
        )}
    </div>
  )
}
