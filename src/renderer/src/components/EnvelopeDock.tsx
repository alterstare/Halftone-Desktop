// 음성 플레이어: Envelope's screen (envelope.html) in ONE frame that never moves
// in the page — moving a frame reloads it and would stop the sound. Only its
// box changes: the right panel (under the tab bar, above the activity bar,
// widened by dragging its left edge), the bar along Halftone's bottom (as wide
// as Halftone), or hidden while its separate big window shows it (it keeps
// playing). The frame asks for those shapes with postMessage; keys Halftone
// doesn't use itself go down to it.
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import { comboFromEvent, SHORTCUTS, shortcutCombos } from '../../../shared/shortcuts'

const MIN_W = 360 // Envelope's narrowest window
const MAX_W = 845 // still its small-window layout
const BAR_H = 76 // its mini-mode bar
const WIDTH_KEY = 'envelopeWidth'
// keys the reader, lists and scrolling use without being shortcuts
const RESERVED = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter', 'Escape', 'Tab', 'Home', 'End', 'PageUp', 'PageDown', 'Backspace', 'Delete'])

const savedWidth = (): number => {
  try {
    const w = Number(localStorage.getItem(WIDTH_KEY))
    return w >= MIN_W && w <= MAX_W ? w : MIN_W
  } catch {
    return MIN_W
  }
}

export default function EnvelopeDock(): JSX.Element | null {
  const { open, shape, lift } = useStore((s) => s.envelope)
  const frame = useRef<HTMLIFrameElement>(null)
  const [width, setWidth] = useState(savedWidth)
  const [dragging, setDragging] = useState(false)
  const [box, setBox] = useState({ top: 0, bottom: 0 })

  // tell the frame its shape — only once its page has loaded: touching the
  // frame's window before that (its first, empty page) keeps Electron from
  // giving the real page its API
  const loaded = useRef(false)
  const sendShape = (): void => {
    if (loaded.current) frame.current?.contentWindow?.postMessage({ type: 'env-mode', mode: shape }, '*')
  }
  useEffect(sendShape, [shape, open])
  useEffect(() => {
    if (!open) loaded.current = false
  }, [open])

  // the panel sits between the tab bar and the activity bar: follow the page body
  useEffect(() => {
    if (!open) return
    const body = document.querySelector('.app > .body') as HTMLElement | null
    const app = document.querySelector('.app') as HTMLElement | null
    if (!body || !app) return
    const measure = (): void => {
      const b = body.getBoundingClientRect()
      const a = app.getBoundingClientRect()
      setBox({ top: b.top - a.top, bottom: a.bottom - b.bottom })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(body)
    ro.observe(app)
    return () => ro.disconnect()
  }, [open, shape])

  // the page makes room for it
  useEffect(() => {
    const app = document.querySelector('.app') as HTMLElement | null
    if (!app) return
    app.classList.toggle('env-panel', open && shape === 'panel')
    app.classList.toggle('env-bar', open && shape === 'bar')
    app.style.setProperty('--env-w', `${width}px`)
    app.style.setProperty('--env-bar-h', `${BAR_H}px`)
  }, [open, shape, width])

  // what the frame asks for
  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      if (!frame.current || e.source !== frame.current.contentWindow) return
      const st = useStore.getState()
      if (e.data?.type === 'env-job') st.envelopeJob(e.data.event)
      if (e.data?.type !== 'env-request') return
      const r = e.data.request as { what: string; px?: number }
      if (r.what === 'window') {
        st.setEnvelopeShape('hidden')
        void window.api.envelopeBig(true)
      } else if (r.what === 'panel' || r.what === 'bar') st.setEnvelopeShape(r.what)
      else if (r.what === 'close') st.closeEnvelope()
      else if (r.what === 'lift') useStore.setState({ envelope: { ...st.envelope, lift: Math.max(0, r.px ?? 0) } })
    }
    window.addEventListener('message', onMsg)
    const offShape = window.api.onEnvelopeShape((s) => (s === 'close' ? useStore.getState().closeEnvelope() : useStore.getState().setEnvelopeShape(s)))
    return () => {
      window.removeEventListener('message', onMsg)
      offShape()
    }
  }, [])

  // keys Halftone doesn't use (and none while typing) work the player
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.repeat) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      const combo = comboFromEvent(e)
      if (!combo) return
      const key = combo.split('+').pop()!
      if (RESERVED.has(key)) return
      const overrides = useStore.getState().settings.shortcuts
      if (SHORTCUTS.some((s) => shortcutCombos(overrides, s.id).includes(combo))) return
      e.preventDefault()
      frame.current?.contentWindow?.postMessage(
        { type: 'env-key', init: { key: e.key, code: e.code, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, bubbles: true } },
        '*'
      )
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  // drag the panel's left edge to widen it
  const startDrag = (e: React.PointerEvent): void => {
    e.preventDefault()
    const right = (document.querySelector('.app') as HTMLElement).getBoundingClientRect().right
    setDragging(true)
    let w = width
    const move = (ev: PointerEvent): void => {
      w = Math.round(Math.min(MAX_W, Math.max(MIN_W, right - ev.clientX)))
      setWidth(w)
    }
    const up = (): void => {
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      try {
        localStorage.setItem(WIDTH_KEY, String(w))
      } catch {
        /* the width just isn't remembered */
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const style: React.CSSProperties =
    shape === 'panel'
      ? { top: box.top, bottom: box.bottom, right: 0, width }
      : shape === 'bar'
        ? { left: 0, right: 0, bottom: 0, height: BAR_H + lift }
        : { right: 0, bottom: 0, width: 1, height: 1 }
  return (
    <div className={`envelope-dock ${shape} ${dragging ? 'dragging' : ''}`} style={style}>
      {shape === 'panel' && <div className="envelope-resize" title="끌어서 폭 조절" onPointerDown={startDrag} />}
      <iframe ref={frame} className="envelope-frame" src="envelope.html" aria-label="음성 플레이어" onLoad={() => ((loaded.current = true), sendShape())} />
    </div>
  )
}
