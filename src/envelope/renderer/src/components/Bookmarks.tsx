// 북마크: points in a work's tracks. The bookmark button (or B) saves the
// playing position right away — named after the subtitle line being spoken —
// and pressed again on a bookmarked point it removes that bookmark. Shown as
// ticks on the seek bar (click = jump).
import type { JSX } from 'react'
import { useStore } from '../store'
import type { Bookmark } from '../../../shared/types'
import { media, seek } from '../player'
import { remote } from '../embed'
import { remoteRefresh } from '../remote'
import { cueAt, linesFor } from '../subs'
import { clock } from '../format'
import { BookmarkAddIcon, BookmarkIcon } from './icons'

const NEAR = 2 // s: "on a bookmark" within this distance

// The subtitle line being spoken, else empty.
function lineNow(): string {
  const st = useStore.getState()
  const n = st.now
  if (!n) return ''
  const g = n.work.groups.find((x) => x.key === n.groupKey)
  const { main } = linesFor(st.subs, st.settings?.subMode ?? 'both')
  if (!main) return ''
  const i = cueAt(main.cues, media().currentTime - (g?.subOffset ?? 0))
  const t = i >= 0 ? main.cues[i].text.replace(/\s+/g, ' ').trim() : ''
  return t.length > 40 ? `${t.slice(0, 40)}…` : t
}

// The playing track's bookmark at (or right by) the position `t`.
function markAt(t: number): Bookmark | undefined {
  const n = useStore.getState().now
  if (!n) return undefined
  return n.work.bookmarks
    .filter((b) => b.groupKey === n.groupKey && Math.abs(b.position - t) <= NEAR)
    .sort((a, b) => Math.abs(a.position - t) - Math.abs(b.position - t))[0]
}

// Bookmark the playing position, or remove the bookmark it is on.
export async function toggleBookmarkHere(): Promise<void> {
  const st = useStore.getState()
  const n = st.now
  if (!n) return
  const t = media().currentTime
  const on = markAt(t)
  if (on) {
    await window.api.deleteBookmark(on.id)
    await st.refreshWork(n.work.id)
    if (remote) remoteRefresh()
    st.showToast({ ok: true, message: `${clock(on.position)} 북마크를 삭제했습니다.` })
    return
  }
  const name = lineNow() || `북마크 ${n.work.bookmarks.length + 1}`
  await window.api.addBookmark(n.work.id, n.groupKey, t, name)
  await st.refreshWork(n.work.id)
  if (remote) remoteRefresh()
  st.showToast({ ok: true, message: `${clock(t)} 북마크를 추가했습니다.` })
}

// One press = bookmark here; on a bookmarked point (lit) = remove it.
export function BookmarkButton({ className }: { className?: string }): JSX.Element | null {
  const now = useStore((s) => s.now)
  useStore((s) => s.time) // re-check "on a bookmark" as playback moves
  if (!now) return null
  const on = !!markAt(media().currentTime)
  return (
    <button
      className={`mini icon ${className ?? ''} ${on ? 'on' : ''}`}
      title={on ? '이 북마크 삭제 (B)' : '지금 위치 북마크 (B)'}
      onClick={() => void toggleBookmarkHere()}
    >
      {on ? <BookmarkIcon /> : <BookmarkAddIcon />}
    </button>
  )
}

// Ticks on the seek bar for the playing track's bookmarks.
export function SeekMarks(): JSX.Element | null {
  const now = useStore((s) => s.now)
  const duration = useStore((s) => s.duration)
  if (!now || !duration) return null
  const marks = now.work.bookmarks.filter((b) => b.groupKey === now.groupKey && b.position <= duration)
  if (!marks.length) return null
  return (
    <div className="seek-marks">
      {marks.map((b) => (
        <button
          key={b.id}
          className="seek-mark"
          style={{ left: `${(b.position / duration) * 100}%` }}
          title={`${clock(b.position)} · ${b.name}`}
          onClick={() => seek(b.position)}
        />
      ))}
    </div>
  )
}
