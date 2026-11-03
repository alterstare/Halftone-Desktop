import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import type { TextGradient } from '../../../shared/ipc'
import { gradientAt, gradientCss } from '../gradient'
import { DeleteIcon, KeyboardArrowDownIcon } from './icons'
import { usePopover } from './usePopover'

// Text gradient for the translation editor's 번역문 stage: a split button — the
// left half puts the recognised gradient (인페인팅 › 그라데이션 인식) on the
// text, or takes the gradient off; the arrow opens its settings: the stops on
// a bar (drag to move, click the bar to add one), the picked stop's colour,
// the angle and the whole text's opacity. Previewed while dragged, committed
// on release.
export default function GradientButton({
  value,
  saved,
  fallback,
  opacity,
  disabled,
  onToggle,
  onPreview,
  onCommit
}: {
  value?: TextGradient
  saved: TextGradient | null
  // the text's colour: a new gradient runs from it to white
  fallback: string
  // the text's opacity (the gradient as a whole)
  opacity: number
  disabled?: boolean
  onToggle: () => void
  onPreview: (g: TextGradient, opacity: number) => void
  onCommit: (g: TextGradient, opacity: number) => void
}): JSX.Element {
  const { open, setOpen, pos, boxRef, popRef } = usePopover()
  const start = (): TextGradient =>
    value ??
    saved ?? {
      angle: 90,
      stops: [
        { pos: 0, color: fallback, alpha: 1 },
        { pos: 1, color: '#ffffff', alpha: 1 }
      ]
    }
  const [g, setG] = useState<TextGradient>(start)
  const [pick, setPick] = useState(0)
  const [a, setA] = useState(opacity)
  // A fresh copy each time it opens (or the text's gradient changes outside).
  useEffect(() => {
    if (open) {
      setG(start())
      setA(opacity)
      setPick(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value])
  const gRef = useRef(g)
  gRef.current = g
  const aRef = useRef(a)
  aRef.current = a
  const preview = (next: TextGradient, na = aRef.current): void => {
    setG(next)
    setA(na)
    onPreview(next, na)
  }
  const commit = (next: TextGradient = gRef.current, na = aRef.current): void => {
    setG(next)
    setA(na)
    onCommit(next, na)
  }
  const setStop = (k: number, patch: Partial<TextGradient['stops'][number]>): TextGradient => ({
    ...gRef.current,
    stops: gRef.current.stops.map((s, i) => (i === k ? { ...s, ...patch } : s))
  })
  // The picked stop's colour commits once, when the palette closes.
  const colRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = colRef.current
    if (!el) return
    const h = (): void => commit()
    el.addEventListener('change', h)
    return () => el.removeEventListener('change', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos, pick])

  const barRef = useRef<HTMLDivElement>(null)
  const tAt = (clientX: number): number => {
    const r = barRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)))
  }
  // Drag a stop along the bar.
  const dragStop = (e: React.PointerEvent, k: number): void => {
    e.preventDefault()
    e.stopPropagation()
    setPick(k)
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent): void => preview(setStop(k, { pos: tAt(ev.clientX) }))
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      commit()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  // A click on the bar: a new stop there, in the colour the gradient has there.
  const addStop = (e: React.PointerEvent): void => {
    const t = tAt(e.clientX)
    const at = gradientAt(gRef.current, t)
    const next = { ...gRef.current, stops: [...gRef.current.stops, { pos: t, ...at }] }
    setPick(next.stops.length - 1)
    commit(next)
  }
  const delStop = (): void => {
    if (gRef.current.stops.length <= 2) return
    const next = { ...gRef.current, stops: gRef.current.stops.filter((_, i) => i !== pick) }
    setPick(0)
    commit(next)
  }
  // keep the textarea's selection — but not on the menu's inputs: that would stop a slider's drag
  const keep = (e: React.MouseEvent): void => {
    if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
  }
  const on = !!value
  const icon = value ?? saved
  const s = g.stops[pick] ?? g.stops[0]
  return (
    <div ref={boxRef} className={`ted-split${on ? ' on' : ''}`}>
      <button
        className="ted-split-main"
        disabled={disabled}
        onMouseDown={keep}
        onClick={onToggle}
        title={on ? '그라데이션 끄기' : saved ? '인식한 그라데이션 적용' : '그라데이션 적용'}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <defs>
            <linearGradient id="ted-grad-ico" x1="0" y1="0" x2="1" y2="0">
              {(icon?.stops ?? [
                { pos: 0, color: '#7132f5', alpha: 1 },
                { pos: 1, color: '#ffcc4d', alpha: 1 }
              ])
                .slice()
                .sort((a, b) => a.pos - b.pos)
                .map((st, i) => (
                  <stop key={i} offset={st.pos} stopColor={st.color} stopOpacity={st.alpha} />
                ))}
            </linearGradient>
          </defs>
          <path fill="currentColor" d="M5.5 17l5.25-14h2.5l5.25 14h-2.4l-1.25-3.6H9.2L7.9 17zm4.4-5.6h4.2l-2.05-5.8h-.1z" />
          <rect x="3" y="19.5" width="18" height="3.5" rx="1" fill="url(#ted-grad-ico)" stroke="rgba(128,128,128,.6)" strokeWidth=".6" />
        </svg>
      </button>
      <span className="ted-split-sep" />
      <button className="ted-split-arrow" disabled={disabled} onMouseDown={keep} onClick={() => setOpen((v) => !v)} title="그라데이션 설정">
        <KeyboardArrowDownIcon />
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={popRef} className="ted-outpop ted-gradpop" style={{ left: pos.left, top: pos.top }} onMouseDown={keep}>
            <div className="ted-gradbar ted-check" ref={barRef} onPointerDown={addStop} title="클릭해서 중지점 추가">
              <span style={{ background: gradientCss(g) }} />
              {g.stops.map((st, k) => (
                <button
                  key={k}
                  className={`ted-gradstop${k === pick ? ' on' : ''}`}
                  style={{ left: `${st.pos * 100}%` }}
                  onPointerDown={(e) => dragStop(e, k)}
                  title="끌어서 이동"
                >
                  <i style={{ background: st.color }} />
                </button>
              ))}
            </div>
            <div className="ted-outrow">
              <span>색</span>
              <input
                key={pick}
                ref={colRef}
                type="color"
                defaultValue={s.color}
                onInput={(e) => preview(setStop(pick, { color: e.currentTarget.value }))}
              />
              <span className="ted-tool-val">{s.color}</span>
              <span className="ted-spacer" />
              <button className="mini icon" onClick={delStop} disabled={g.stops.length <= 2} title="중지점 삭제">
                <DeleteIcon />
              </button>
            </div>
            <label className="ted-outrow">
              <span>투명도</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((1 - a) * 100)}
                onChange={(e) => preview(gRef.current, 1 - Number(e.target.value) / 100)}
                onPointerUp={() => commit()}
                onKeyUp={() => commit()}
              />
              <span className="ted-tool-val">{Math.round((1 - a) * 100)}%</span>
            </label>
            <label className="ted-outrow">
              <span>각도</span>
              <input
                type="range"
                min={0}
                max={359}
                value={g.angle}
                onChange={(e) => preview({ ...gRef.current, angle: Number(e.target.value) })}
                onPointerUp={() => commit()}
                onKeyUp={() => commit()}
              />
              <span className="ted-tool-val">{g.angle}°</span>
            </label>
            {saved && (
              <button className="mini" onClick={() => commit(saved)} title="인페인팅 단계에서 인식한 그라데이션으로">
                인식한 그라데이션 불러오기
              </button>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}
