import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

// A split button's menu (the translation editor's outline / colour / gradient
// buttons): placed under the button, portalled to <body> by the caller, closed
// by a press outside it (capture phase: the editor stops mousedown bubbling),
// Esc or a window resize.
export function usePopover(): {
  open: boolean
  setOpen: (v: boolean | ((o: boolean) => boolean)) => void
  pos: { left: number; top: number } | null
  boxRef: RefObject<HTMLDivElement | null>
  popRef: RefObject<HTMLDivElement | null>
} {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!open || !boxRef.current) return
    const r = boxRef.current.getBoundingClientRect()
    setPos({ left: r.left, top: r.bottom + 4 })
  }, [open])
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      const t = e.target
      if (t instanceof Node && (popRef.current?.contains(t) || boxRef.current?.contains(t))) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    const onResize = (): void => setOpen(false)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])
  return { open, setOpen, pos, boxRef, popRef }
}
