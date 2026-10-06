import type { JSX } from 'react'
import { ArrowUpIcon, ArrowDownIcon } from './icons'

// Compact number stepper: a toggle-sized value pill with ▲/▼ stacked on its
// right. Replaces the raw number spinner so number settings look consistent
// (Settings, auto-merge, per-artist merge).
export default function Stepper({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  width,
  title
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  width?: number // px width of the value field (wider for big numbers)
  title?: string
}): JSX.Element {
  const clamp = (v: number): number => Math.max(min, max != null ? Math.min(max, v) : v)
  return (
    <span className="stepper" title={title}>
      <input
        className="stepper-val"
        type="number"
        min={min}
        step={step}
        value={value}
        style={width ? { width } : undefined}
        onChange={(e) => onChange(clamp(Number(e.target.value) || 0))}
      />
      <span className="stepper-arrows">
        <button
          type="button"
          className="stepper-btn"
          disabled={max != null && value >= max}
          onClick={() => onChange(clamp(value + step))}
          aria-label="올리기"
        >
          <ArrowUpIcon />
        </button>
        <button
          type="button"
          className="stepper-btn"
          disabled={value <= min}
          onClick={() => onChange(clamp(value - step))}
          aria-label="내리기"
        >
          <ArrowDownIcon />
        </button>
      </span>
    </span>
  )
}
