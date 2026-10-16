// Small shared pieces, same look as Halftone / Sorta.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX, ReactNode } from 'react'
import { useStore } from '../store'
import {
  AddIcon,
  FavoriteIcon,
  FavoriteOutlineIcon,
  KeyboardArrowDownIcon,
  KeyboardArrowLeftIcon,
  KeyboardArrowRightIcon,
  KeyboardArrowUpIcon,
  LabelIcon,
  LibraryMusicIcon,
  StarIcon
} from './icons'

// Prev / [editable current] / total / Next (Halftone). Type a page, Enter jumps.
export function Pager({ page, lastPage, onPage }: { page: number; lastPage: number; onPage: (p: number) => void }): JSX.Element {
  const [val, setVal] = useState(String(page + 1))
  useEffect(() => setVal(String(page + 1)), [page])
  const go = (): void => {
    const n = parseInt(val, 10)
    if (isNaN(n)) return setVal(String(page + 1))
    onPage(Math.max(0, Math.min(lastPage, n - 1)))
  }
  return (
    <div className="pager">
      <button className="pager-arrow" title="이전 페이지" disabled={page <= 0} onClick={() => onPage(page - 1)}>
        <KeyboardArrowLeftIcon />
      </button>
      <span className="pager-pos">
        <input
          className="page-input"
          value={val}
          onChange={(e) => setVal(e.target.value.replace(/[^0-9]/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          onBlur={go}
        />
        <span> / {lastPage + 1}</span>
      </span>
      <button className="pager-arrow" title="다음 페이지" disabled={page >= lastPage} onClick={() => onPage(page + 1)}>
        <KeyboardArrowRightIcon />
      </button>
    </div>
  )
}

// Number field with ▲ / ▼ (Halftone's Stepper).
export function Stepper({ value, onChange, min = 1, max, step = 1 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }): JSX.Element {
  const clamp = (v: number): number => Math.max(min, max != null ? Math.min(max, v) : v)
  const [val, setVal] = useState(String(value))
  useEffect(() => setVal(String(value)), [value])
  const commit = (): void => {
    const n = parseInt(val, 10)
    if (isNaN(n)) return setVal(String(value))
    onChange(clamp(n))
  }
  return (
    <span className="stepper">
      <input
        className="stepper-val"
        value={val}
        onChange={(e) => setVal(e.target.value.replace(/[^0-9]/g, ''))}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        onBlur={commit}
      />
      <span className="stepper-arrows">
        <button type="button" className="stepper-btn" title="올리기" disabled={max != null && value >= max} onClick={() => onChange(clamp(value + step))}>
          <KeyboardArrowUpIcon />
        </button>
        <button type="button" className="stepper-btn" title="내리기" disabled={value <= min} onClick={() => onChange(clamp(value - step))}>
          <KeyboardArrowDownIcon />
        </button>
      </span>
    </span>
  )
}

// The one arrow for every drop-down / drawer: Material keyboard-arrow-down,
// flipped (animated) while open.
export function Caret({ up }: { up?: boolean }): JSX.Element {
  return <KeyboardArrowDownIcon className={`caret ${up ? 'up' : ''}`} />
}

export function Cover({ path, className, full }: { path: string | null; className?: string; full?: boolean }): JSX.Element {
  return (
    <div className={`cover ${className ?? ''}`}>
      {path ? (
        <img src={full ? window.api.mediaUrl(path) : window.api.thumbUrl(path)} loading="lazy" decoding="async" alt="" draggable={false} />
      ) : (
        <LibraryMusicIcon className="cover-ph" />
      )}
    </div>
  )
}

// 별점: click a star to set, the same star again to clear.
export function Stars({ id, rank }: { id: number; rank: number }): JSX.Element {
  const [hover, setHover] = useState(0)
  const set = (n: number): void => {
    const r = n === rank ? 0 : n
    void window.api.setRank([id], r)
    useStore.getState().patchWork(id, { rank: r })
  }
  return (
    <span className="stars" onMouseLeave={() => setHover(0)} onClick={(e) => e.stopPropagation()}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={`star ${n <= (hover || rank) ? 'on' : ''}`} onMouseEnter={() => setHover(n)} onClick={() => set(n)} title={`별점 ${n}`}>
          <StarIcon />
        </button>
      ))}
    </span>
  )
}

export function FavButton({ id, on }: { id: number; on: boolean }): JSX.Element {
  return (
    <button
      className={`mini icon fav ${on ? 'faved' : ''}`}
      title={on ? '즐겨찾기 해제' : '즐겨찾기'}
      onClick={(e) => {
        e.stopPropagation()
        void window.api.setFavorite([id], !on)
        useStore.getState().patchWork(id, { favorite: !on })
      }}
    >
      {on ? <FavoriteIcon /> : <FavoriteOutlineIcon />}
    </button>
  )
}

// small window = where the library grid drops from 3 columns to 2 (846px+ fits 3)
export const NARROW = '(max-width: 845px)'
export function useMedia(q: string): boolean {
  const [n, setN] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = (): void => setN(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [q])
  return n
}
export const useNarrow = (): boolean => useMedia(NARROW)

// Keeps something on screen for `ms` after it is switched off, so it can
// play its closing animation: mounted = draw it, leaving = closing now.
export const CLOSE_MS = 120 // panels / menus (--t-fast)
export const SHEET_MS = 320 // sheets that slide up / down (--t-slow)
export function useExit(on: boolean, ms = CLOSE_MS): { mounted: boolean; leaving: boolean } {
  // the switch to "leaving" happens in the same render as `on` turning off —
  // noticed only in an effect, one frame went by unmounted (the thing
  // vanished, then came back to play its closing animation: a blink)
  const [leaving, setLeaving] = useState(false)
  const [was, setWas] = useState(on)
  if (was !== on) {
    setWas(on)
    setLeaving(!on)
  }
  useEffect(() => {
    if (!leaving) return undefined
    const t = setTimeout(() => setLeaving(false), ms)
    return () => clearTimeout(t)
  }, [leaving, ms])
  return { mounted: on || leaving, leaving: leaving && !on }
}

// A panel under its button: open state, the closing animation, and closing
// on an outside click / Escape.
// A popup goes away at anything done outside it — a click (either button),
// the wheel, a scroll, a key pressed outside it, the window losing focus.
// `inside(node)` = part of the popup (or its own button). Returns the cleanup.
function closeOnOutside(inside: (n: Node | null) => boolean, close: () => void): () => void {
  const out = (e: Event): void => {
    if (!inside(e.target as Node | null)) close()
  }
  const key = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' || !inside(document.activeElement)) close()
  }
  const opts = { capture: true, passive: true }
  window.addEventListener('pointerdown', out, true)
  window.addEventListener('wheel', out, opts)
  window.addEventListener('scroll', out, true)
  window.addEventListener('keydown', key, true)
  window.addEventListener('blur', close)
  window.addEventListener('resize', close)
  return () => {
    window.removeEventListener('pointerdown', out, true)
    window.removeEventListener('wheel', out, opts)
    window.removeEventListener('scroll', out, true)
    window.removeEventListener('keydown', key, true)
    window.removeEventListener('blur', close)
    window.removeEventListener('resize', close)
  }
}

export function usePopover(): {
  open: boolean
  mounted: boolean
  closing: boolean
  setOpen: (b: boolean) => void
  ref: React.RefObject<HTMLDivElement | null>
} {
  const [open, setOpen] = useState(false)
  const ex = useExit(open)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    return closeOnOutside((n) => !!n && !!ref.current?.contains(n), () => setOpen(false))
  }, [open])
  return { open, mounted: ex.mounted, closing: ex.leaving, setOpen, ref }
}

// For <Popover>: the anchor stays set while the panel plays its closing
// animation; toggle(el) opens on el or closes.
export function useAnchor(): {
  anchor: HTMLElement | null
  open: boolean
  closing: boolean
  toggle: (el: HTMLElement) => void
  close: () => void
} {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const last = useRef<HTMLElement | null>(null)
  if (anchor) last.current = anchor
  const ex = useExit(!!anchor)
  return {
    anchor: ex.mounted ? last.current : null,
    open: !!anchor,
    closing: ex.leaving,
    toggle: (el) => setAnchor(anchor ? null : el),
    close: () => setAnchor(null)
  }
}

// Chip with a drop-down panel (Halftone "… 분류 ▾").
export function ChipMenu({ label, active, children, align }: { label: ReactNode; active?: boolean; children: ReactNode; align?: 'right' }): JSX.Element {
  const p = usePopover()
  return (
    <div className="cat-wrap" ref={p.ref}>
      <button className={`chip ${active ? 'active' : ''} ${p.open ? 'open' : ''}`} onClick={() => p.setOpen(!p.open)}>
        {label} <Caret up={p.open} />
      </button>
      {p.mounted && <div className={`cat-panel ${align === 'right' ? 'right' : ''} ${p.closing ? 'closing' : ''}`}>{children}</div>}
    </div>
  )
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (b: boolean) => void; children: ReactNode }): JSX.Element {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

// 그룹: tick the groups a work belongs to, or make a new one.
// A panel placed on the page itself (portal, fixed position) under its
// button, kept inside the window — so a card's overflow can't cut it off.
export function Popover({
  anchor,
  onClose,
  closing,
  children
}: {
  anchor: HTMLElement
  onClose: () => void
  closing?: boolean
  children: ReactNode
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 })
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect()
    const el = ref.current
    const w = el?.offsetWidth ?? 220
    const h = el?.offsetHeight ?? 160
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))
    const below = r.bottom + 6
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below
    setPos({ left, top })
  }, [anchor])
  useEffect(() => {
    if (closing) return undefined
    return closeOnOutside((n) => !!n && (!!ref.current?.contains(n) || anchor.contains(n)), onClose)
  }, [anchor, onClose, closing])
  return createPortal(
    <div className={`popover ${closing ? 'closing' : ''}`} ref={ref} style={pos} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body
  )
}

// 그룹: tick the groups a work belongs to, or make a new one.
export function GroupButton({ id, groupIds }: { id: number; groupIds: number[] }): JSX.Element {
  const groups = useStore((s) => s.groups)
  const pop = useAnchor()
  const [name, setName] = useState('')
  const toggle = async (g: number, on: boolean): Promise<void> => {
    await window.api.setGroupMembership([id], g, on)
    useStore.getState().patchWork(id, { groupIds: on ? [...groupIds, g] : groupIds.filter((x) => x !== g) })
    void useStore.getState().loadGroups()
  }
  const create = async (): Promise<void> => {
    if (!name.trim()) return
    const g = await window.api.createGroup(name, [id])
    setName('')
    useStore.getState().patchWork(id, { groupIds: [...groupIds, g] })
    void useStore.getState().loadGroups()
  }
  return (
    <>
      <button
        className={`mini icon grp-btn ${groupIds.length ? 'grouped' : ''}`}
        title="그룹"
        onClick={(e) => {
          e.stopPropagation()
          pop.toggle(e.currentTarget)
        }}
      >
        <LabelIcon />
      </button>
      {pop.anchor && (
        <Popover anchor={pop.anchor} closing={pop.closing} onClose={pop.close}>
          {groups.length === 0 && <div className="hint panel-hint">아직 그룹이 없습니다. 이름을 넣어 만들어 보세요.</div>}
          {groups.map((g) => (
            <Check key={g.id} checked={groupIds.includes(g.id)} onChange={(on) => void toggle(g.id, on)}>
              {g.name}
            </Check>
          ))}
          <div className="grp-new">
            <input value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} placeholder="새 그룹 이름" />
            <button className="mini icon" title="그룹 만들기" onClick={() => void create()}>
              <AddIcon />
            </button>
          </div>
        </Popover>
      )}
    </>
  )
}

// Halftone's confirm dialog: title, text, [action][취소] — Enter / Escape.
// An on/off switch (Halftone's look) with the state it's in written on its
// right — a two-way choice that two buttons side by side would blur.
export function Toggle({ on, onChange, labels, title }: { on: boolean; onChange: (v: boolean) => void; labels: [off: string, on: string]; title?: string }): JSX.Element {
  return (
    <label className="tswitch" title={title}>
      <button type="button" role="switch" aria-checked={on} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
        <span className="toggle-knob" />
      </button>
      <span className="tswitch-say">
        {on ? labels[1] : labels[0]}
      </span>
    </label>
  )
}

export function Confirm({
  title,
  body,
  ok,
  danger = false,
  onOk,
  onCancel
}: {
  title: string
  body?: ReactNode
  ok: string
  danger?: boolean // the action loses something (red)
  onOk: () => void
  onCancel: () => void
}): JSX.Element {
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
      else if (e.key === 'Enter') onOk()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [onCancel, onOk])
  return (
    <div className="cfm-back" onMouseDown={onCancel}>
      <div className="cfm" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="cfm-title">{title}</h3>
        {body && <div className="cfm-desc">{body}</div>}
        <div className="cfm-actions">
          <button className={`cfm-btn ${danger ? 'danger' : 'primary'}`} onClick={onOk}>
            {ok}
          </button>
          <button className="cfm-btn ghost" onClick={onCancel}>
            취소
          </button>
        </div>
      </div>
    </div>
  )
}

// Custom select (Halftone Dropdown): the current label + a caret that flips
// while the option panel is open. kind: 'field' (search row), 'mini' (inside a
// flat group), 'inline' (text-only, e.g. a track's file).
export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  kind = 'field',
  title,
  className
}: {
  value: T
  options: readonly (readonly [T, string])[]
  onChange: (v: T) => void
  kind?: 'field' | 'mini' | 'inline' | 'chip'
  title?: string
  className?: string
}): JSX.Element {
  const p = usePopover()
  const label = options.find(([v]) => v === value)?.[1] ?? String(value)
  return (
    <div className={`dropdown dd-${kind} ${className ?? ''}`} ref={p.ref} onClick={(e) => e.stopPropagation()}>
      <button type="button" className={`dd-btn ${kind === 'mini' ? 'mini' : ''} ${p.open ? 'open' : ''}`} title={title} onClick={() => p.setOpen(!p.open)}>
        <span className="dd-label">{label}</span>
        <Caret up={p.open} />
      </button>
      {p.mounted && (
        <div className={`dd-panel ${p.closing ? 'closing' : ''}`}>
          {options.map(([v, l]) => (
            <button
              key={String(v)}
              type="button"
              className={`dd-opt ${v === value ? 'on' : ''}`}
              onClick={() => {
                onChange(v)
                p.setOpen(false)
              }}
            >
              {l}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// DLsite tags (장르, Korean names) on ONE line at any width: as many as fit,
// the rest as "+n" — not expandable (search still finds every tag).
export function TagLine({ tags, className = '', all = false }: { tags: { ko: string; ja: string }[]; className?: string; all?: boolean }): JSX.Element | null {
  const box = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(tags.length)
  useLayoutEffect(() => {
    const el = box.current
    if (!el || all) return
    const fit = (): void => {
      const widths = [...el.querySelectorAll<HTMLElement>('.tag-measure > .tag')].map((x) => x.offsetWidth)
      const more = el.querySelector<HTMLElement>('.tag-measure > .tag-more')?.offsetWidth ?? 0
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0
      const room = el.clientWidth
      let n = widths.length
      for (; n > 0; n--) {
        const used = widths.slice(0, n).reduce((a, b) => a + b, 0) + gap * (n - 1)
        if (used + (n < widths.length ? gap + more : 0) <= room) break
      }
      setShown(n)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [tags, all])
  if (!tags.length) return null
  // 작품 화면: every tag, wrapping onto more lines
  if (all)
    return (
      <div className={`tag-line all ${className}`}>
        {tags.map((t) => (
          <span key={t.ja || t.ko} className="tag">
            {t.ko || t.ja}
          </span>
        ))}
      </div>
    )
  const rest = tags.length - shown
  return (
    <div ref={box} className={`tag-line ${className}`}>
      {tags.slice(0, shown).map((t) => (
        <span key={t.ja || t.ko} className="tag">
          {t.ko || t.ja}
        </span>
      ))}
      {rest > 0 && <span className="tag tag-more">+{rest}</span>}
      {/* every tag measured once, out of sight */}
      <div className="tag-measure" aria-hidden>
        {tags.map((t) => (
          <span key={t.ja || t.ko} className="tag">
            {t.ko || t.ja}
          </span>
        ))}
        <span className="tag tag-more">+{tags.length}</span>
      </div>
    </div>
  )
}

// A picture's main colour (asked once per path while the app runs)
const colourCache = new Map<string, string | null>()
export function useCoverColour(path: string | null): string | null {
  const [c, setC] = useState<string | null>(path ? (colourCache.get(path) ?? null) : null)
  useEffect(() => {
    if (!path) return setC(null)
    if (colourCache.has(path)) return setC(colourCache.get(path)!)
    let alive = true
    void window.api.coverColour(path).then((x) => {
      colourCache.set(path, x)
      if (alive) setC(x)
    })
    return () => {
      alive = false
    }
  }, [path])
  return c
}
