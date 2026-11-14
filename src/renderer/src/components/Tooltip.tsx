import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { arrowText } from '../arrowText'


// Global themed tooltip. Replaces the browser's white native tooltip: on hover of
// any element with a `title`, we stash+strip the attribute (so the native bubble
// never shows) and render our own styled box, restoring `title` on leave.
// Grid cards carry `data-card-tip` (the full title, clamped to two lines on the
// card): shown by the pointer, in the same look, when hovering the card anywhere
// but its thumbnail (`data-tip-off`, which has the page preview) or an element
// with its own title.
export default function Tooltip(): JSX.Element | null {
  // x = anchor center, y = below the anchor, top = the anchor's top (for flipping up).
  const [tip, setTip] = useState<{ x: number; y: number; top: number; text: string; card?: boolean } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Place the box after it renders at its natural size: centered under the
  // anchor, but shifted to stay inside the window (near an edge it used to be
  // squeezed into a narrow column — "설/명"), and flipped above the anchor when
  // there's no room below.
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!tip || !el) return setPos(null)
    const M = 8
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = Math.max(M, Math.min(tip.x - w / 2, window.innerWidth - w - M))
    const below = tip.y + h + M <= window.innerHeight
    setPos({ left, top: below ? tip.y : Math.max(M, tip.top - 6 - h) })
  }, [tip])

  useEffect(() => {
    let timer: number | undefined
    let cur: HTMLElement | null = null
    // Last pointer position: a card tip shows where the pointer is when it appears.
    let mouse = { x: 0, y: 0 }
    const move = (e: MouseEvent): void => {
      mouse = { x: e.clientX, y: e.clientY }
    }
    // Every element up the tree that has a `title` is stripped too: with only
    // the hovered one stripped, the browser showed the nearest ancestor's
    // title natively next to ours (a button inside a titled row / card).
    let stripped: HTMLElement[] = []

    const restore = (): void => {
      for (const el of stripped)
        if (el.dataset.tip != null) {
          el.setAttribute('title', el.dataset.tip)
          delete el.dataset.tip
        }
      stripped = []
      cur = null
    }

    const over = (e: MouseEvent): void => {
      move(e)
      const el = (e.target as HTMLElement)?.closest?.('[title], [data-card-tip], [data-tip-off]') as HTMLElement | null
      if (el === cur) return
      // A card's thumbnail: no tip (its hover preview is there).
      if (!el || el.hasAttribute('data-tip-off')) {
        if (cur) (window.clearTimeout(timer), restore(), setTip(null))
        return
      }
      const card = !el.hasAttribute('title')
      const text = card ? (el.dataset.cardTip ?? '') : el.getAttribute('title')
      if (!text) return
      restore()
      setTip(null)
      cur = el
      if (!card)
        for (let a: HTMLElement | null = el; a; a = a.parentElement?.closest<HTMLElement>('[title]') ?? null) {
          a.dataset.tip = a.getAttribute('title') ?? ''
          a.removeAttribute('title')
          stripped.push(a)
        }
      window.clearTimeout(timer)
      timer = window.setTimeout(
        () => {
          if (card) return setTip({ x: mouse.x, y: mouse.y + 20, top: mouse.y - 8, text, card: true })
          const r = el.getBoundingClientRect()
          setTip({ x: r.left + r.width / 2, y: r.bottom + 6, top: r.top, text })
        },
        card ? 1000 : 700
      )
    }

    const out = (e: MouseEvent): void => {
      // Ignore moves that stay inside the current element.
      if (cur && e.relatedTarget instanceof Node && cur.contains(e.relatedTarget)) return
      window.clearTimeout(timer)
      restore()
      setTip(null)
    }

    // React re-adds `title` (with a new value) to the element we stripped when its
    // state changes under the cursor (e.g. a sort-dir toggle). Catch that: re-strip
    // and refresh the shown text so the native bubble never reappears and ours
    // isn't stale.
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        const el = m.target as HTMLElement
        if (!stripped.includes(el)) continue
        const t = el.getAttribute('title')
        if (t == null) continue
        el.dataset.tip = t
        el.removeAttribute('title')
        if (el === cur) setTip((prev) => (prev ? { ...prev, text: t } : prev))
      }
    })
    obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['title'] })

    // Anything that changes the screen while a tip is up (or waiting) hides it:
    // a press, a key (shortcuts change screens), the wheel / a scroll, a resize,
    // the window losing focus, or the anchor going away / moving. The titles
    // stay stripped until the pointer leaves the element, so the browser's own
    // bubble doesn't come up in its place.
    const dismiss = (): void => {
      window.clearTimeout(timer)
      setTip(null)
    }
    let anchor: HTMLElement | null = null
    let anchorRect: DOMRect | null = null
    const track = (): void => {
      if (cur === anchor) return
      anchor = cur
      anchorRect = cur ? cur.getBoundingClientRect() : null
    }
    const check = (): void => {
      if (!cur) return
      if (!cur.isConnected || cur.getClientRects().length === 0) {
        window.clearTimeout(timer)
        restore()
        setTip(null)
        return
      }
      const r = cur.getBoundingClientRect()
      if (anchorRect && (Math.abs(r.left - anchorRect.left) > 2 || Math.abs(r.top - anchorRect.top) > 2)) dismiss()
    }
    // checked right away (not on the next frame: frames stop while the window is hidden)
    const changed = new MutationObserver(check)
    changed.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] })
    document.addEventListener('mousedown', dismiss, true)
    document.addEventListener('keydown', dismiss, true)
    document.addEventListener('wheel', dismiss, { capture: true, passive: true })
    document.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('blur', dismiss)
    document.addEventListener('mouseover', over, true)
    document.addEventListener('mouseover', track, true)
    document.addEventListener('mouseout', out, true)
    document.addEventListener('mousemove', move, true)
    return () => {
      document.removeEventListener('mouseover', over, true)
      changed.disconnect()
      document.removeEventListener('mouseover', track, true)
      document.removeEventListener('mousedown', dismiss, true)
      document.removeEventListener('keydown', dismiss, true)
      document.removeEventListener('wheel', dismiss, true)
      document.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('blur', dismiss)
      document.removeEventListener('mouseout', out, true)
      document.removeEventListener('mousemove', move, true)
      obs.disconnect()
      window.clearTimeout(timer)
      restore()
    }
  }, [])

  if (!tip) return null
  return createPortal(
    <div
      ref={boxRef}
      className="tooltip"
      // Measured off-screen first (hidden), then placed by the layout effect.
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {arrowText(tip.text)}
    </div>,
    document.body
  )
}
