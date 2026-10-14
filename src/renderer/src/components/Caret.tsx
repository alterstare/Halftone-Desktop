import type { JSX } from 'react'
import { KeyboardArrowDownIcon } from './icons'

// Drop-down / drawer / sort-direction indicator: the Material keyboard arrow,
// turning to point up while open (rotation animated in CSS, same as Env).
export default function Caret({ up }: { up?: boolean }): JSX.Element {
  return <KeyboardArrowDownIcon className={`caret ${up ? 'up' : ''}`} />
}
