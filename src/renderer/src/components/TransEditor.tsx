import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX, MutableRefObject, ReactNode } from 'react'
import type { TransBlock } from '../../../shared/ipc'
import { loadImage, drawTranslation, canvasSize, autoBgHex } from '../inpaint'
import { comboFromEvent, shortcutCombos } from '../../../shared/shortcuts'
import { useStore } from '../store'
import { translateRegion } from '../translate'
import { FIT_ICON, FIT_TEXT } from './reader/fit'
import { AddIcon, CloseIcon, RedoIcon, RestartIcon, SelectIcon, UndoIcon } from './icons'

// Photoshop-lite bubble editor for one translated page. Two jobs only:
//   1) resize/move each translation bubble box (corner + body drag) and recolour
//      its background fill,
//   2) edit the translated text in a side list,
//   3) 영역 번역: drag a rectangle over text the auto pass missed (captions,
//      narration, SFX) → local OCR + translate just that region → new bubble.
// Everything re-renders onto the same canvas the viewer uses (drawTranslation), so
// what you see here is exactly what the page becomes once saved.

// Handle the work-wide editor uses to auto-save a page before switching away.
export interface TransEditorApi {
  dirty: () => boolean
  snapshot: () => TransBlock[]
}

type Corner = 'nw' | 'ne' | 'sw' | 'se'

// View size: a fit mode (same as the reader's fit button) times a Ctrl+wheel
// zoom. Kept module-wide so it carries over between pages / editor openings.
type EdFit = 'contain' | 'width' | 'height'
const ED_FITS: EdFit[] = ['contain', 'width', 'height']
let lastView: { fit: EdFit; zoom: number } = { fit: 'contain', zoom: 1 }
interface Drag {
  i: number
  mode: 'move' | Corner
  sx: number
  sy: number
  orig: { x: number; y: number; w: number; h: number }
}

export default function TransEditor({
  src,
  blocks: initial,
  langHint,
  onSave,
  onClose,
  embedded,
  apiRef,
  headExtra,
  closeLabel = '취소',
  saveLabel = '저장',
  hint
}: {
  src: string
  blocks: TransBlock[]
  langHint?: string
  // embedded: rendered inside the work-wide editor (no own overlay/backdrop).
  embedded?: boolean
  apiRef?: MutableRefObject<TransEditorApi | null>
  headExtra?: ReactNode
  closeLabel?: string
  saveLabel?: string
  hint?: string
  onSave: (blocks: TransBlock[]) => void
  onClose: () => void
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const defaultsRef = useRef<string[]>([])
  const dragRef = useRef<Drag | null>(null)
  // Stable per-row ids so a row keeps its DOM (and IME/caret) across edits and
  // deletions — index keys would remount textareas and break Korean input.
  const uidsRef = useRef<number[]>(initial.map((_, i) => i))
  // Live textarea DOM nodes (by row uid). Typing NEVER calls setState — that would
  // re-render and cancel an IME composition (worst in an empty box). Instead we read
  // the DOM directly to repaint the canvas, and commit to state only on blur.
  const taRefs = useRef<Record<number, HTMLTextAreaElement | null>>({})
  // Row uids whose text the user has touched → force-drawn (bg stamped) even if the
  // auto pass would treat them as SFX.
  const editedRef = useRef<Set<number>>(new Set())
  // True while a Korean/CJK IME composition is in flight. The canvas repaint does
  // heavy synchronous work (per-block getImageData bg sampling); running it on every
  // keystroke starves the input thread and the browser cancels the composition —
  // worst in an empty box, whose composition has no committed lead char to fall back
  // on. So we NEVER repaint mid-composition, and even outside it we defer the repaint
  // to the next animation frame so typing stays responsive.
  const composingRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  // Next uid to hand out to a newly created bubble (existing rows took 0..len-1).
  const nextUidRef = useRef(initial.length)
  // A just-created row's uid, so an effect can focus+select its textarea once mounted.
  const pendingFocusRef = useRef<number | null>(null)
  // True once a drag actually moved the box, so we push ONE history entry on mouseup
  // (not one per mousemove).
  const draggedRef = useRef(false)
  const [blocks, setBlocks] = useState<TransBlock[]>(() => initial.map((b) => ({ ...b })))
  // Mirror of `blocks` kept in sync synchronously (setBlocks is async), so history
  // capture and the next mutation always read the latest array within the same event.
  const blocksRef = useRef<TransBlock[]>(initial.map((b) => ({ ...b })))
  // Undo/redo stack of full block snapshots; hiRef points at the current entry.
  // histVer just forces a re-render so the toolbar's enabled/disabled state updates.
  const histRef = useRef<TransBlock[][]>([initial.map((b) => ({ ...b }))])
  const hiRef = useRef(0)
  const [, setHistVer] = useState(0)
  const bumpHist = (): void => setHistVer((v) => v + 1)

  // Current blocks merged with LIVE textarea text (read straight from the DOM), so
  // both the canvas and Save reflect unblurred typing — no state round-trip. A block
  // is force-drawn only if the user touched it (bg set, or text edited).
  const snapshot = (): TransBlock[] =>
    blocksRef.current.map((b, i) => {
      const uid = uidsRef.current[i]
      const el = taRefs.current[uid]
      const tr = el ? el.value : b.tr
      const touched = b.bg !== undefined || editedRef.current.has(uid)
      return touched ? { ...b, tr, bg: b.bg ?? defaultsRef.current[i] } : { ...b, tr }
    })

  // Repaint the canvas from live text without touching React state (a re-render
  // would cancel an in-progress IME composition — the empty-box input bug). Skipped
  // during composition and coalesced to one rAF so heavy canvas work never blocks the
  // keystroke that started it.
  const redrawLive = (): void => {
    if (composingRef.current || rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const img = imgRef.current
      const c = canvasRef.current
      if (img && c) drawTranslation(c, img, { ok: true, w: 0, h: 0, blocks: snapshot() })
    })
  }
  // Grow a textarea to fit its content so multi-line translations don't overlap on one
  // row. Pure DOM style change — no setState, safe to call mid-IME-composition.
  const autosize = (el: HTMLTextAreaElement | null): void => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  const [size, setSize] = useState<{ W: number; H: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Room inside the canvas pane (minus its padding), tracked as the window resizes.
  const [avail, setAvail] = useState<{ w: number; h: number } | null>(null)
  const [fit, setFit] = useState<EdFit>(lastView.fit)
  const [zoom, setZoom] = useState(lastView.zoom)
  lastView = { fit, zoom }
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = (): void => setAvail({ w: el.clientWidth - 32, h: el.clientHeight - 32 })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Display scale: canvas px → screen px.
  const dim = useMemo(() => {
    if (!size || !avail) return null
    const sw = Math.max(50, avail.w) / size.W
    const sh = Math.max(50, avail.h) / size.H
    const base = fit === 'width' ? sw : fit === 'height' ? sh : Math.min(sw, sh)
    return { W: size.W, H: size.H, disp: base * zoom }
  }, [size, avail, fit, zoom])
  const atFit = Math.abs(zoom - 1) < 0.001
  const ready = !!dim
  // Ctrl+wheel zoom around the cursor: remember where the cursor sits in the
  // content, then restore that spot after the size changes.
  const anchorRef = useRef<{ fx: number; fy: number; mx: number; my: number } | null>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const mx = e.clientX - r.left
      const my = e.clientY - r.top
      anchorRef.current = {
        fx: (el.scrollLeft + mx) / Math.max(1, el.scrollWidth),
        fy: (el.scrollTop + my) / Math.max(1, el.scrollHeight),
        mx,
        my
      }
      setZoom((z) => Math.min(6, Math.max(0.2, z * Math.exp(-e.deltaY * 0.0015))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  useLayoutEffect(() => {
    const a = anchorRef.current
    const el = scrollRef.current
    if (!a || !el) return
    anchorRef.current = null
    el.scrollLeft = a.fx * el.scrollWidth - a.mx
    el.scrollTop = a.fy * el.scrollHeight - a.my
  }, [zoom])
  // Same as the reader's button: cycle the fit mode, or drop a custom zoom first.
  const onZoomButton = (): void => {
    if (atFit) setFit((f) => ED_FITS[(ED_FITS.indexOf(f) + 1) % ED_FITS.length])
    else setZoom(1)
  }
  const [sel, setSel] = useState<number | null>(null)
  // 영역 번역: picking = drag mode on; band = rectangle being dragged (canvas px);
  // busy = OCR/translation in flight for that rectangle.
  const [picking, setPicking] = useState(false)
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [regionErr, setRegionErr] = useState<string | null>(null)

  // Load the page once; compute the downscaled canvas space (same as the viewer)
  // plus a display scale, and each block's auto fill-colour as the swatch default.
  useEffect(() => {
    let alive = true
    loadImage(src).then((img) => {
      if (!alive) return
      imgRef.current = img
      const { W, H } = canvasSize(img)
      defaultsRef.current = initial.map((b) => autoBgHex(img, b))
      setSize({ W, H })
    })
    return () => {
      alive = false
    }
  }, [src, initial])

  // Repaint the canvas whenever the blocks change.
  useEffect(() => {
    const img = imgRef.current
    const c = canvasRef.current
    if (!img || !c || !size) return
    drawTranslation(c, img, { ok: true, w: 0, h: 0, blocks })
    // Zoom only rescales the canvas via CSS — no repaint needed for it.
  }, [blocks, size, ready])

  // Set the live blocks (ref + state) without recording history — used during a drag.
  const applyBlocks = (next: TransBlock[]): void => {
    blocksRef.current = next
    setBlocks(next)
  }
  // Record the current live state (blocks + DOM text) as a new undo step, dropping any
  // redo tail. Call AFTER applyBlocks so snapshot() sees the new blocks.
  const pushHistory = (): void => {
    const base = histRef.current.slice(0, hiRef.current + 1)
    base.push(snapshot())
    histRef.current = base
    hiRef.current = base.length - 1
    bumpHist()
  }
  // Apply + record in one step (discrete edits: add / delete / colour / text commit).
  const commit = (next: TransBlock[]): void => {
    applyBlocks(next)
    pushHistory()
  }
  // Return blocks with block i patched; any edit stamps a bg so the block is drawn even
  // if the auto pass would treat it as SFX — touching a bubble means "keep this one".
  const patched = (i: number, patch: Partial<TransBlock>): TransBlock[] =>
    blocksRef.current.map((b, idx) =>
      idx === i ? { ...b, ...patch, bg: patch.bg ?? b.bg ?? defaultsRef.current[i] } : b
    )

  const del = (i: number): void => {
    // uidsRef and defaultsRef are position-indexed, so splice them in lockstep with
    // blocks or every row past i would read the wrong uid/default colour.
    uidsRef.current = uidsRef.current.filter((_, idx) => idx !== i)
    defaultsRef.current = defaultsRef.current.filter((_, idx) => idx !== i)
    setSel(null)
    commit(blocksRef.current.filter((_, idx) => idx !== i))
  }

  // Add a fresh bubble at the canvas centre. Seeded with placeholder text (selected
  // on focus) rather than empty on purpose: an empty textarea can't take Korean IME
  // input, so we never leave one empty — deleting all text removes the bubble, and a
  // new bubble starts pre-filled for the user to type over.
  const addBlock = (): void => {
    if (!dim) return
    const { W, H } = dim
    const w = Math.round(W * 0.22)
    const h = Math.round(H * 0.1)
    const x = Math.round((W - w) / 2)
    const y = Math.round((H - h) / 2)
    const bg = '#ffffff'
    const uid = nextUidRef.current++
    uidsRef.current = [...uidsRef.current, uid]
    defaultsRef.current = [...defaultsRef.current, bg]
    editedRef.current.add(uid)
    pendingFocusRef.current = uid
    setSel(blocksRef.current.length)
    commit([...blocksRef.current, { x, y, w, h, text: '', tr: '내용', bg }])
  }

  // 영역 번역: rubber-band a rectangle on the canvas, then OCR + translate it.
  const startBand = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!picking || busy || !dim || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    const sx = (e.clientX - r.left) / dim.disp
    const sy = (e.clientY - r.top) / dim.disp
    const rectAt = (ev: MouseEvent): { x: number; y: number; w: number; h: number } => {
      const cx = Math.max(0, Math.min(dim.W, (ev.clientX - r.left) / dim.disp))
      const cy = Math.max(0, Math.min(dim.H, (ev.clientY - r.top) / dim.disp))
      return { x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) }
    }
    setRegionErr(null)
    setBand({ x: sx, y: sy, w: 0, h: 0 })
    const onMove = (ev: MouseEvent): void => setBand(rectAt(ev))
    const onUp = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const rect = rectAt(ev)
      if (rect.w < 8 || rect.h < 8) {
        setBand(null)
        return
      }
      setBand(rect)
      setBusy(true)
      translateRegion(src, rect, langHint)
        .then((res) => {
          if (!res.ok) return setRegionErr(res.error ?? '번역 실패')
          const b = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) }
          const img = imgRef.current
          const bg = img ? autoBgHex(img, { ...b, text: '', tr: '' }) : '#ffffff'
          const uid = nextUidRef.current++
          uidsRef.current = [...uidsRef.current, uid]
          defaultsRef.current = [...defaultsRef.current, bg]
          editedRef.current.add(uid) // user picked it: always draw, even if it looks like SFX
          setSel(blocksRef.current.length)
          // bg set → drawn even when it looks like an SFX to the auto pass
          commit([...blocksRef.current, { ...b, text: res.text, tr: res.tr || res.text, bg }])
        })
        .catch((err) => setRegionErr(String(err?.message ?? err)))
        .finally(() => {
          setBusy(false)
          setBand(null)
        })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Undo/redo: replay a history snapshot. Textareas are uncontrolled, so we hand every
  // restored row a FRESH uid — that changes its React key, remounting the textarea so
  // its defaultValue picks up the restored text (normal edits keep uids stable, so
  // they never remount and Korean IME is undisturbed).
  const restore = (entry: TransBlock[]): void => {
    const next = entry.map((b) => ({ ...b }))
    uidsRef.current = next.map(() => nextUidRef.current++)
    const img = imgRef.current
    defaultsRef.current = next.map((b) => b.bg ?? (img ? autoBgHex(img, b) : '#ffffff'))
    editedRef.current = new Set()
    setSel(null)
    applyBlocks(next)
  }
  const undo = (): void => {
    if (hiRef.current <= 0) return
    hiRef.current -= 1
    restore(histRef.current[hiRef.current])
    bumpHist()
  }
  const redo = (): void => {
    if (hiRef.current >= histRef.current.length - 1) return
    hiRef.current += 1
    restore(histRef.current[hiRef.current])
    bumpHist()
  }
  if (apiRef)
    apiRef.current = {
      // History moved, or a textarea holds unblurred typing.
      dirty: () =>
        hiRef.current > 0 ||
        blocksRef.current.some((b, i) => {
          const el = taRefs.current[uidsRef.current[i]]
          return !!el && el.value !== b.tr
        }),
      snapshot
    }
  const canUndo = hiRef.current > 0
  const canRedo = hiRef.current < histRef.current.length - 1

  // Focus + select a newly added bubble's textarea so typing replaces the seed text.
  useEffect(() => {
    const uid = pendingFocusRef.current
    if (uid == null) return
    const el = taRefs.current[uid]
    if (el) {
      el.focus()
      el.select()
      pendingFocusRef.current = null
    }
  }, [blocks])

  // The reader's page-flip wheel handler lives on a native (non-passive) listener
  // on an ancestor element, so React's onWheel/stopPropagation can't reach it in
  // time. A native listener on the overlay stops the event before it bubbles up.
  useEffect(() => {
    const el = overlayRef.current
    if (!el) return
    const stop = (e: WheelEvent): void => e.stopPropagation()
    el.addEventListener('wheel', stop, { passive: false })
    return () => el.removeEventListener('wheel', stop)
  }, [])

  // Drop any pending canvas repaint when the editor closes.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl+Y = redo. undo/redo read refs so the
  // stale closure from an empty-deps effect is fine.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const combo = comboFromEvent(e)
      if (!combo) return
      const keys = useStore.getState().settings.shortcuts
      if (shortcutCombos(keys, 'transUndo').includes(combo)) {
        e.preventDefault()
        undo()
      } else if (shortcutCombos(keys, 'transRedo').includes(combo)) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mouse side buttons (3 = back, 4 = forward) → undo/redo only while the editor is
  // open. Captured on window so neither the reader's page-nav nor browser history
  // acts on them; the action runs on mouseup, the others just block the default.
  useEffect(() => {
    const onSide = (e: MouseEvent): void => {
      if (e.button !== 3 && e.button !== 4) return
      e.preventDefault()
      e.stopPropagation()
      if (e.type === 'mouseup') {
        if (e.button === 3) undo()
        else redo()
      }
    }
    window.addEventListener('mousedown', onSide, true)
    window.addEventListener('mouseup', onSide, true)
    window.addEventListener('auxclick', onSide, true)
    return () => {
      window.removeEventListener('mousedown', onSide, true)
      window.removeEventListener('mouseup', onSide, true)
      window.removeEventListener('auxclick', onSide, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Corner/body drag → adjust the selected block's box in canvas-pixel space.
  useEffect(() => {
    if (!dim) return
    const onMove = (e: MouseEvent): void => {
      const d = dragRef.current
      if (!d) return
      const dx = (e.clientX - d.sx) / dim.disp
      const dy = (e.clientY - d.sy) / dim.disp
      const o = d.orig
      let { x, y, w, h } = o
      if (d.mode === 'move') {
        x = o.x + dx
        y = o.y + dy
      } else {
        if (d.mode === 'nw' || d.mode === 'sw') {
          x = o.x + dx
          w = o.w - dx
        }
        if (d.mode === 'ne' || d.mode === 'se') w = o.w + dx
        if (d.mode === 'nw' || d.mode === 'ne') {
          y = o.y + dy
          h = o.h - dy
        }
        if (d.mode === 'sw' || d.mode === 'se') h = o.h + dy
      }
      if (w < 6) w = 6
      if (h < 6) h = 6
      draggedRef.current = true
      applyBlocks(patched(d.i, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }))
    }
    const onUp = (): void => {
      const was = dragRef.current
      dragRef.current = null
      document.body.classList.remove('resizing')
      if (was && draggedRef.current) pushHistory()
      draggedRef.current = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dim])

  const startDrag = (e: React.MouseEvent, i: number, mode: 'move' | Corner): void => {
    e.preventDefault()
    e.stopPropagation()
    setSel(i)
    const b = blocksRef.current[i]
    draggedRef.current = false
    dragRef.current = { i, mode, sx: e.clientX, sy: e.clientY, orig: { x: b.x, y: b.y, w: b.w, h: b.h } }
    document.body.classList.add('resizing')
  }

  const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']

  const panel = (
      <div
        className={`ted${embedded ? ' ted-embedded' : ''}`}
        ref={embedded ? overlayRef : undefined}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ted-head">
          <b>번역 편집</b>
          <span className="ted-hint">
            {picking
              ? '번역할 글자 위를 끌어서 사각형으로 감싸세요'
              : hint ?? '말풍선 모서리를 끌어 크기·위치 조정 · 색/글 우측에서 수정'}
          </span>
          <span className="ted-spacer" />
          <div className="flat-group ted-actions">
            <button className="mini ted-fit" onClick={onZoomButton} title="화면 맞춤 전환 · Ctrl+휠로 확대/축소">
              {atFit ? (
                <>
                  {FIT_ICON[fit]}
                  {FIT_TEXT[fit]}
                </>
              ) : (
                `${Math.round(zoom * 100)}%`
              )}
            </button>
            <button className="mini" onClick={undo} disabled={!canUndo}>
              <UndoIcon />
              실행 취소
            </button>
            <button className="mini" onClick={redo} disabled={!canRedo}>
              <RedoIcon />
              다시 실행
            </button>
            <button className="mini" onClick={() => onSave([])}>
              <RestartIcon />
              자동으로 되돌리기
            </button>
            {headExtra}
            <button className="mini" onClick={onClose}>
              {closeLabel}
            </button>
            <button className="mini on" onClick={() => onSave(snapshot())}>
              {saveLabel}
            </button>
          </div>
        </div>

        <div className="ted-body">
          <div className="ted-canvas-scroll" ref={scrollRef}>
            {dim ? (
              <div
                className={`ted-canvas-wrap${picking ? ' picking' : ''}`}
                style={{ width: dim.W * dim.disp, height: dim.H * dim.disp }}
                onMouseDown={startBand}
              >
                <canvas
                  ref={canvasRef}
                  style={{ width: dim.W * dim.disp, height: dim.H * dim.disp }}
                />
                {blocks.map((b, i) => (
                  <div
                    key={i}
                    className={`ted-box ${sel === i ? 'sel' : ''}`}
                    style={{
                      left: b.x * dim.disp,
                      top: b.y * dim.disp,
                      width: b.w * dim.disp,
                      height: b.h * dim.disp
                    }}
                    onMouseDown={(e) => startDrag(e, i, 'move')}
                  >
                    <span className="ted-box-n">{i + 1}</span>
                    {CORNERS.map((c) => (
                      <span
                        key={c}
                        className={`ted-handle ${c}`}
                        onMouseDown={(e) => startDrag(e, i, c)}
                      />
                    ))}
                  </div>
                ))}
                {band && (
                  <div
                    className={`ted-band${busy ? ' busy' : ''}`}
                    style={{
                      left: band.x * dim.disp,
                      top: band.y * dim.disp,
                      width: band.w * dim.disp,
                      height: band.h * dim.disp
                    }}
                  >
                    {busy && <span>인식 중…</span>}
                  </div>
                )}
              </div>
            ) : (
              <div className="ted-loading">불러오는 중…</div>
            )}
          </div>

          <div className="ted-side">
            <div className="flat-group ted-actions ted-add-row">
              <button className="mini" onClick={addBlock} disabled={!dim}>
                <AddIcon />
                말풍선 추가
              </button>
              <button
                className={`mini${picking ? ' on' : ''}`}
                onClick={() => setPicking((v) => !v)}
                disabled={!dim}
                title="자동 번역이 놓친 글자를 끌어서 선택하면 그 부분만 인식·번역합니다 (로컬 OCR 모델 필요)"
              >
                <SelectIcon />
                {picking ? '영역 번역 끝내기' : '영역 번역'}
              </button>
            </div>
            {regionErr && <div className="ted-err">{regionErr}</div>}
            {blocks.length === 0 && <div className="ted-empty">편집할 말풍선이 없습니다.</div>}
            {blocks.map((b, i) => (
              <div
                key={uidsRef.current[i]}
                className={`ted-row ${sel === i ? 'sel' : ''}`}
                onClick={() => setSel(i)}
              >
                <div className="ted-row-head">
                  <span className="ted-idx">{i + 1}</span>
                  <input
                    type="color"
                    className="ted-color"
                    value={b.bg ?? defaultsRef.current[i] ?? '#ffffff'}
                    // Dragging the palette fires input rapidly; preview live via the
                    // ref + rAF-throttled repaint (no setState, no history — skips the
                    // in-between colours), and only commit ONE history step on change.
                    onInput={(e) => {
                      editedRef.current.add(uidsRef.current[i])
                      blocksRef.current = patched(i, { bg: e.currentTarget.value })
                      redrawLive()
                    }}
                    onChange={(e) => commit(patched(i, { bg: e.currentTarget.value }))}
                  />
                  <span className="ted-spacer" />
                  <div className="flat-group ted-actions">
                    <button className="mini ted-del" onClick={() => del(i)} title="말풍선 삭제">
                      <CloseIcon />
                    </button>
                  </div>
                </div>
                {/* Original next to the translation so a misread or mistranslation is
                    easy to spot; selectable for copying into a dictionary. */}
                {b.text && (
                  <div className="ted-field">
                    <span className="ted-label">원문</span>
                    <div className="ted-src">{b.text}</div>
                  </div>
                )}
                {b.text && <span className="ted-label">번역</span>}
                {/* Uncontrolled + stable key: typing touches only the DOM (no
                    setState), so re-renders never cancel Korean IME even when the
                    box is empty. Canvas updates live from the DOM (onInput); the
                    value is committed to state on blur. */}
                <textarea
                  className="ted-tr"
                  ref={(el) => {
                    taRefs.current[uidsRef.current[i]] = el
                    autosize(el)
                  }}
                  defaultValue={b.tr}
                  rows={2}
                  placeholder="번역 내용"
                  onFocus={() => setSel(i)}
                  onKeyDown={(e) => {
                    // A focused textarea would otherwise eat Ctrl+Z for its own text
                    // undo. Intercept it for the editor's undo/redo — blur first so the
                    // current edit lands in history, then step. stopPropagation avoids
                    // the window listener firing it a second time.
                    if (!(e.ctrlKey || e.metaKey)) return
                    const k = e.key.toLowerCase()
                    if (k !== 'z' && k !== 'y') return
                    e.preventDefault()
                    e.stopPropagation()
                    e.currentTarget.blur()
                    if (k === 'z' && !e.shiftKey) undo()
                    else redo()
                  }}
                  onCompositionStart={() => {
                    composingRef.current = true
                  }}
                  onCompositionEnd={(e) => {
                    composingRef.current = false
                    autosize(e.currentTarget)
                    editedRef.current.add(uidsRef.current[i])
                    redrawLive()
                  }}
                  onInput={(e) => {
                    autosize(e.currentTarget)
                    editedRef.current.add(uidsRef.current[i])
                    redrawLive()
                  }}
                  onBlur={(e) => {
                    // Emptied bubble → remove it (never leave an unusable empty box).
                    const v = e.currentTarget.value
                    if (v.trim() === '') del(i)
                    else if (v !== blocksRef.current[i]?.tr) commit(patched(i, { tr: v }))
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
  )
  if (embedded) return panel
  return (
    <div
      ref={overlayRef}
      className="ted-overlay"
      onMouseDown={onClose}
      // Swallow clicks so a paged/spread reader underneath doesn't flip pages.
      onClick={(e) => e.stopPropagation()}
    >
      {panel}
    </div>
  )
}
