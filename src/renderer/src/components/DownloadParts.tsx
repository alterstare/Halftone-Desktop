// Shared pieces of the general-manga download modals (ComicDownloadModal for the
// main online site, ComicBackupModal for backup sites).
import { useEffect, useRef } from 'react'
import type { Dispatch, JSX, SetStateAction } from 'react'
import type { ComicChapter } from '../../../shared/ipc'

// Checkbox list of chapters with 전체 선택 / 전체 해제 / 선택 반전 and a
// cancel / confirm footer. `selected` holds chapter urls.
export function ChapterPicker({
  chapters,
  selected,
  setSelected,
  onCancel,
  onConfirm,
  confirmLabel
}: {
  chapters: ComicChapter[]
  selected: Set<string>
  setSelected: Dispatch<SetStateAction<Set<string>>>
  onCancel: () => void
  onConfirm: () => void
  confirmLabel: string
}): JSX.Element {
  const invert = (): void => setSelected((s) => new Set(chapters.filter((c) => !s.has(c.url)).map((c) => c.url)))
  // Drag to (de)select: the first row decides the mode (select if it was off,
  // deselect if it was on); every row the pointer passes gets that state.
  const drag = useRef<boolean | null>(null)
  const setOne = (url: string, on: boolean): void =>
    setSelected((s) => {
      if (s.has(url) === on) return s
      const n = new Set(s)
      if (on) n.add(url)
      else n.delete(url)
      return n
    })
  useEffect(() => {
    const end = (): void => {
      drag.current = null
    }
    window.addEventListener('mouseup', end)
    return () => window.removeEventListener('mouseup', end)
  }, [])
  return (
    <>
      <div className="dl-select-bar">
        <div className="flat-group">
        <button className="mini" onClick={() => setSelected(new Set(chapters.map((c) => c.url)))}>
          전체 선택
        </button>
        <button className="mini" onClick={() => setSelected(new Set())}>
          전체 해제
        </button>
        <button className="mini" onClick={invert}>
          선택 반전
        </button>
        </div>
        <span className="hint" style={{ margin: 0 }}>
          {selected.size}/{chapters.length} 선택
        </span>
      </div>
      <div className="dl-chapter-list">
        {chapters.map((c) => (
          <div
            key={c.url}
            className={`dl-chapter ${selected.has(c.url) ? 'sel' : ''}`}
            onMouseDown={(e) => {
              if (e.button !== 0) return
              e.preventDefault() // no text selection while dragging
              const on = !selected.has(c.url)
              drag.current = on
              setOne(c.url, on)
            }}
            onMouseEnter={() => drag.current !== null && setOne(c.url, drag.current)}
          >
            <input type="checkbox" checked={selected.has(c.url)} readOnly tabIndex={-1} />
            <span className="dl-chapter-title">{c.title || c.url}</span>
          </div>
        ))}
      </div>
      <div className="dl-select-foot flat-group">
        <button className="mini" onClick={onCancel}>
          취소
        </button>
        <button className="mini on" disabled={!selected.size} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </>
  )
}

export type DownloadProg = { done: number; total: number; label: string }

// Progress / done / error box shown after a download starts. Renders nothing
// for other phases.
export function DownloadStatus({
  phase,
  prog,
  err,
  note,
  onClose,
  onBack
}: {
  phase: string
  prog: DownloadProg | null
  err: string | null
  note: string // reassurance under the progress bar
  onClose: () => void
  onBack: () => void
}): JSX.Element | null {
  if (phase === 'downloading')
    return (
      <div className="dl-progress-box">
        <div className="dl-bar">
          <div className="dl-bar-fill" style={{ width: prog?.total ? `${(prog.done / prog.total) * 100}%` : '10%' }} />
        </div>
        <p className="hint">
          다운로드 중… {prog ? `${prog.done}/${prog.total}` : ''} {prog?.label ?? ''}
        </p>
        <p className="hint">{note}</p>
      </div>
    )
  if (phase === 'done')
    return (
      <div className="dl-progress-box">
        <p className="dl-done-msg">다운로드 완료</p>
        <div className="flat-group">
          <button className="mini on" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    )
  if (phase === 'error')
    return (
      <div className="dl-progress-box">
        <div className="warn err">{err}</div>
        <div className="flat-group">
          <button className="mini" onClick={onBack}>
            돌아가기
          </button>
        </div>
      </div>
    )
  return null
}
