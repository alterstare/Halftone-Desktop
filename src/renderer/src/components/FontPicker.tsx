import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { KeyboardArrowDownIcon, StarIcon, StarOutlineIcon } from './icons'

// Font picker for the translation editor's 번역문 stage. Favourites are pinned at
// the top (kept across sessions), recently used fonts come next (kept by the
// caller, per work), then every font. Names are in the UI font (a symbol font
// or one without Hangul would show its own name as boxes / blanks) with a
// sample in the font itself beside it; hovering one previews it on the text (`onPreview`, null = back to as it was).
// The list is portalled to <body>, fixed-positioned: inside the reader the
// editor sits in a page element (line-height 0, transformed ancestors) that
// clipped the names and moved the list off its button. It closes on any press outside it — caught in the capture phase, as
// the editor stops mousedown from bubbling.
export default function FontPicker({
  value,
  fonts,
  favs,
  recents,
  disabled,
  onToggleFav,
  onPreview,
  onPick
}: {
  value: string // '' = the default font
  fonts: string[]
  favs: string[]
  recents: string[]
  disabled?: boolean
  onToggleFav: (font: string) => void
  onPreview: (font: string | null) => void
  onPick: (font: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const previewing = useRef(false)
  const close = (): void => {
    setOpen(false)
    if (previewing.current) {
      previewing.current = false
      onPreview(null)
    }
  }
  const closeRef = useRef(close)
  closeRef.current = close

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ left: r.left, top: r.bottom + 4, maxH: Math.max(160, window.innerHeight - r.bottom - 16) })
  }, [open])
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      const t = e.target
      if (t instanceof Node && (popRef.current?.contains(t) || btnRef.current?.contains(t))) return
      closeRef.current()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      closeRef.current()
    }
    const onResize = (): void => closeRef.current()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])
  // The list scrolls itself; the wheel never reaches the reader or the canvas.
  useEffect(() => {
    const el = popRef.current
    if (!el) return
    const stop = (e: WheelEvent): void => e.stopPropagation()
    el.addEventListener('wheel', stop, { passive: true })
    return () => el.removeEventListener('wheel', stop)
  }, [open, pos])

  const fav = new Set(favs)
  const recent = recents.filter((f) => !fav.has(f))
  const row = (f: string, key: string): JSX.Element => (
    <div
      key={key}
      className={`ted-fontrow${f === value ? ' on' : ''}`}
      onMouseEnter={() => {
        previewing.current = true
        onPreview(f)
      }}
      onMouseDown={(e) => e.preventDefault()} // keep the textarea's selection
      onClick={() => {
        previewing.current = false
        setOpen(false)
        onPick(f)
      }}
    >
      <span className="ted-fontname">{f || '기본 글꼴'}</span>
      {f && (
        <span className="ted-fontsample" style={{ fontFamily: `"${f}"` }}>
          가나 Aa
        </span>
      )}
      {f && (
        <button
          className={`ted-fontfav${fav.has(f) ? ' on' : ''}`}
          title={fav.has(f) ? '즐겨찾기 해제' : '즐겨찾기'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation()
            onToggleFav(f)
          }}
        >
          {fav.has(f) ? <StarIcon /> : <StarOutlineIcon />}
        </button>
      )}
    </div>
  )
  return (
    <>
      <button
        ref={btnRef}
        className={`mini ted-font${open ? ' on' : ''}`}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? close() : setOpen(true))}
        title={value || '기본 글꼴'}
      >
        <span className="ted-fontname">{value || '기본 글꼴'}</span>
        <KeyboardArrowDownIcon />
      </button>
      {open &&
        pos &&
        createPortal(
        <div
          ref={popRef}
          className="ted-fontpop"
          style={{ left: pos.left, top: pos.top, maxHeight: Math.min(420, pos.maxH) }}
          onMouseLeave={() => {
            if (!previewing.current) return
            previewing.current = false
            onPreview(null)
          }}
        >
          {row('', 'default')}
          {favs.length > 0 && <div className="ted-fontsec">즐겨찾기</div>}
          {favs.map((f) => row(f, `fav-${f}`))}
          {recent.length > 0 && <div className="ted-fontsec">최근 사용</div>}
          {recent.map((f) => row(f, `recent-${f}`))}
          <div className="ted-fontsec">모든 글꼴</div>
          {fonts.map((f) => row(f, `all-${f}`))}
        </div>,
          document.body
        )}
    </>
  )
}
