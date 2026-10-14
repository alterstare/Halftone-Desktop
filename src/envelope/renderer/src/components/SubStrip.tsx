// 자막 켜기: the current line(s) over the bottom bar while another screen is
// open (지금 재생 shows them on its picture instead).
import type { JSX } from 'react'
import { useStore } from '../store'
import { cueAt, linesFor } from '../subs'
import type { SubtitleText } from '../../../shared/types'

export default function SubStrip(): JSX.Element | null {
  const now = useStore((s) => s.now)
  const view = useStore((s) => s.view)
  const subs = useStore((s) => s.subs)
  const time = useStore((s) => s.time)
  const visible = useStore((s) => s.settings?.subsVisible ?? true)
  const mode = useStore((s) => s.settings?.subMode ?? 'both')
  const size = useStore((s) => s.settings?.subSize ?? 22)
  if (!now || !visible || view === 'now') return null
  const g = now.work.groups.find((x) => x.key === now.groupKey)
  const t = time - (g?.subOffset ?? 0)
  const { main, second } = linesFor(subs, mode)
  const line = (s: SubtitleText | null): string => {
    if (!s) return ''
    const i = cueAt(s.cues, t)
    return i >= 0 ? s.cues[i].text : ''
  }
  const l1 = line(main)
  const l2 = line(second)
  if (!l1 && !l2) return null
  return (
    <div className="sub-strip" style={{ fontSize: Math.round(size * 0.72) }} onClick={() => useStore.getState().setView('now')} title="지금 재생 열기">
      {l1 && <div className="l1">{l1}</div>}
      {l2 && <div className="l2">{l2}</div>}
    </div>
  )
}
