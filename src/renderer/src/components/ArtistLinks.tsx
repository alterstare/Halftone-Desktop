import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX, MouseEvent, ReactNode } from 'react'
import { splitArtists } from '../util'

// One clickable link per artist, so "A, B" searches A or B — not the whole string.
export function ArtistLinks({
  artist,
  onPick,
  onMenu
}: {
  artist: string
  onPick: (a: string) => void
  onMenu: (a: string, e: MouseEvent) => void
}): JSX.Element {
  const list = splitArtists(artist)
  return (
    <>
      {list.map((a, i) => (
        <span key={a + i}>
          {i > 0 && ', '}
          <ArtistLink a={a} onPick={onPick} onMenu={onMenu} />
        </span>
      ))}
    </>
  )
}

function ArtistLink({
  a,
  onPick,
  onMenu
}: {
  a: string
  onPick: (a: string) => void
  onMenu?: (a: string, e: MouseEvent) => void
}): JSX.Element {
  return (
    <span
      className="artist-link"
      onClick={(e) => {
        e.stopPropagation()
        onPick(a)
      }}
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault()
              e.stopPropagation()
              onMenu(a, e)
            }
          : undefined
      }
    >
      {a}
    </span>
  )
}


// Grid-tile artist line: always ONE line (fixed tile height). Shows the whole
// artists that fit; the rest hide behind a "+N" chip right after them (click to
// expand onto more lines, "접기" to collapse) — like TagList. A first artist too
// long for the line alone is ellipsized. `prefix` (e.g. "전체 12화 · ") leads the line.
export function ArtistLine({
  artist,
  prefix,
  onPick,
  onMenu
}: {
  artist: string
  prefix?: ReactNode
  onPick: (a: string) => void
  onMenu?: (a: string, e: MouseEvent) => void
}): JSX.Element {
  const list = splitArtists(artist)
  const [expanded, setExpanded] = useState(false)
  const [visible, setVisible] = useState(list.length)
  const [width, setWidth] = useState(0)
  const [tick, setTick] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)))
    ro.observe(el)
    // Re-measure when the web font arrives (fallback-font widths are wrong) and
    // when an off-screen tile (content-visibility: auto) gets rendered — while
    // skipped, its text measures 0 wide.
    const remeasure = (): void => setTick((n) => n + 1)
    const tile = el.closest('.gtile, .gcard')
    document.fonts.addEventListener('loadingdone', remeasure)
    tile?.addEventListener('contentvisibilityautostatechange', remeasure)
    return () => {
      ro.disconnect()
      document.fonts.removeEventListener('loadingdone', remeasure)
      tile?.removeEventListener('contentvisibilityautostatechange', remeasure)
    }
  }, [])

  useLayoutEffect(() => {
    if (expanded) return
    const el = ref.current
    if (!el) return
    el.classList.add('measuring')
    // Fractional widths: rounded ones can add up a pixel short and squeeze the lead.
    const w = (x: Element | null): number => (x ? x.getBoundingClientRect().width : 0)
    const cs = getComputedStyle(el)
    const cw = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    const prefixW = w(el.querySelector('.artist-prefix'))
    const itemW = Array.from(el.querySelectorAll('.artist-item')).map(w)
    const moreW = w(el.querySelector('.artist-measure')) // incl. its 6px left padding
    el.classList.remove('measuring')
    if (itemW.some((x) => x === 0)) return // not rendered yet
    let used = prefixW
    let n = 0
    for (const iw of itemW) {
      const reserve = n + 1 < itemW.length ? moreW : 0 // "+N" needed if more remain
      if (used + iw + reserve > cw) break
      used += iw
      n++
    }
    setVisible(Math.max(1, n)) // the first artist always shows (ellipsized)
  }, [artist, expanded, width, tick])

  const hidden = list.length - visible
  const toggle = (e: MouseEvent): void => {
    e.stopPropagation()
    setExpanded(!expanded)
  }

  return (
    <div ref={ref} className={`gtile-meta gtile-artist ${expanded ? 'expanded' : ''}`}>
      {prefix != null && <span className="artist-prefix">{prefix}</span>}
      {list.map((a, i) => (
        <span key={a + i} className={`artist-item ${i === 0 ? 'lead' : ''} ${!expanded && i >= visible ? 'clipped' : ''}`}>
          {i > 0 && ', '}
          <ArtistLink a={a} onPick={onPick} onMenu={onMenu} />
        </span>
      ))}
      {!expanded && hidden > 0 && (
        <span className="artist-more">
          <span className="tag add-tag" onClick={toggle}>
            +{hidden}
          </span>
        </span>
      )}
      {expanded && (
        <span className="artist-more">
          <span className="tag add-tag" onClick={toggle}>
            접기
          </span>
        </span>
      )}
      <span className="artist-more artist-measure" aria-hidden="true">
        <span className="tag add-tag">+00</span>
      </span>
    </div>
  )
}
