// 자막 편집기 (CLAUDE.md §5.3): fix text and timing, split / merge / delete /
// add lines, stamp the playing position. Saves "<audio>.<lang>.vtt" next to
// the audio; Ctrl+Z / Ctrl+Y inside the editor, and the save itself is one
// undo step in the app log.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { Cue, SubLang } from '../../../shared/types'
import { media, seek } from '../player'
import { cueAt, loadSubs } from '../subs'
import { AddIcon, CloseIcon, ContentCutIcon, DeleteIcon, FirstPageIcon, LastPageIcon, MergeIcon, PlayArrowIcon, RedoIcon, SaveIcon, UndoIcon } from './icons'
import { Confirm, Dropdown } from './ui'

export function fmtTime(s: number): string {
  const ms = Math.max(0, Math.round(s * 1000))
  const m = Math.floor(ms / 60000)
  const sec = Math.floor((ms % 60000) / 1000)
  return `${m}:${String(sec).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
}

export function parseTime(v: string): number | null {
  const p = v.trim().replace(',', '.').split(':')
  if (!p.length || p.length > 3 || p.some((x) => x === '' || isNaN(Number(x)))) return null
  return p.map(Number).reduce((a, x) => a * 60 + x, 0)
}

function TimeInput({ value, onChange }: { value: number; onChange: (v: number) => void }): JSX.Element {
  const [text, setText] = useState(fmtTime(value))
  useEffect(() => setText(fmtTime(value)), [value])
  const commit = (): void => {
    const v = parseTime(text)
    if (v === null) setText(fmtTime(value))
    else if (v !== value) onChange(v)
  }
  return (
    <input
      className="time-input"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      spellCheck={false}
    />
  )
}

const LANG_NAME: Record<SubLang, string> = { ja: '일본어', ko: '한국어', other: '자막' }

export default function SubEditor(): JSX.Element {
  const now = useStore((s) => s.now)!
  const subs = useStore((s) => s.subs)
  const time = useStore((s) => s.time)
  const showToast = useStore((s) => s.showToast)
  const g = now.work.groups.find((x) => x.key === now.groupKey)
  const offset = g?.subOffset ?? 0

  // Which file: the existing ones, or a new Korean one (on the original's timing).
  const sources = useMemo(() => {
    const out: { lang: SubLang; label: string; cues: Cue[] }[] = []
    for (const s of [subs?.ja, subs?.ko, subs?.other]) if (s) out.push({ lang: s.lang, label: LANG_NAME[s.lang], cues: s.cues })
    if (!subs?.ko) {
      const base = subs?.ja ?? subs?.other
      out.push({ lang: 'ko', label: base ? '새 한국어 (원문 시간 사용)' : '새 한국어', cues: base ? base.cues.map((c) => ({ ...c, text: '' })) : [] })
    }
    return out
  }, [subs])
  const [src, setSrc] = useState(0)
  const [cues, setCues] = useState<Cue[]>(sources[0]?.cues ?? [])
  const [past, setPast] = useState<Cue[][]>([])
  const [future, setFuture] = useState<Cue[][]>([])
  const [dirty, setDirty] = useState(false)
  const [ask, setAsk] = useState<null | 'close'>(null)
  const ref = useRef<HTMLDivElement>(null)
  const lang = sources[src]?.lang ?? 'ko'
  const reference = lang === 'ko' ? (subs?.ja ?? subs?.other) : subs?.ko // shown under each line

  const change = (next: Cue[]): void => {
    setPast([...past.slice(-100), cues])
    setFuture([])
    setCues(next)
    setDirty(true)
  }
  const undo = (): void => {
    const p = past[past.length - 1]
    if (!p) return
    setFuture([cues, ...future])
    setPast(past.slice(0, -1))
    setCues(p)
  }
  const redo = (): void => {
    const f = future[0]
    if (!f) return
    setPast([...past, cues])
    setFuture(future.slice(1))
    setCues(f)
  }
  const pick = (i: number): void => {
    setSrc(i)
    setCues(sources[i].cues)
    setPast([])
    setFuture([])
    setDirty(false)
  }
  // fixing a line's time clears its "unsure" mark (script alignment)
  const edit = (i: number, p: Partial<Cue>): void =>
    change(cues.map((c, j) => (j === i ? { ...c, ...p, ...('start' in p || 'end' in p ? { low: undefined } : {}) } : c)))
  const pos = (): number => Math.max(0, media().currentTime - offset)
  const sorted = (l: Cue[]): Cue[] => [...l].sort((a, b) => a.start - b.start)

  const split = (i: number): void => {
    const c = cues[i]
    const mid = (c.start + c.end) / 2
    const at = c.text.indexOf('\n') > 0 ? c.text.indexOf('\n') : Math.ceil(c.text.length / 2)
    change([...cues.slice(0, i), { start: c.start, end: mid, text: c.text.slice(0, at).trim() }, { start: mid, end: c.end, text: c.text.slice(at).trim() }, ...cues.slice(i + 1)])
  }
  const merge = (i: number): void => {
    const a = cues[i]
    const b = cues[i + 1]
    if (!b) return
    change([...cues.slice(0, i), { start: a.start, end: Math.max(a.end, b.end), text: `${a.text} ${b.text}`.trim() }, ...cues.slice(i + 2)])
  }
  const add = (): void => {
    const t = pos()
    change(sorted([...cues, { start: t, end: t + 3, text: '' }]))
  }

  // kept in the program; into the folder only via 파일 정리 › 자막 › 폴더 변경
  const doSave = async (): Promise<void> => {
    const clean = sorted(cues.filter((c) => c.text.trim() && c.end > c.start))
    await window.api.saveSubtitle(now.trackId, lang, clean, false)
    setDirty(false)
    showToast({ ok: true, message: `${LANG_NAME[lang]} 자막을 프로그램 안에 저장했습니다` })
    await useStore.getState().refreshWork(now.work.id)
    const n = useStore.getState().now
    if (n) await loadSubs(n.work, n.groupKey, n.trackId)
    useStore.setState({ editing: false })
  }
  const close = (): void => (dirty ? setAsk('close') : useStore.setState({ editing: false }))

  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === 'z' && !e.shiftKey) undo()
      else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) redo()
      else if (e.key === 's') void doSave()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  })

  const active = cueAt(cues, time - offset)
  useEffect(() => {
    if (active >= 0 && !ref.current?.contains(document.activeElement)) ref.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, ref])

  return (
    <div className="subedit">
      <div className="se-bar">
        <Dropdown<number> kind="mini" value={src} options={sources.map((s, i) => [i, s.label] as const)} onChange={pick} title="편집할 자막" />
        <div className="flat-group">
          <button className="mini icon" title="되돌리기 (Ctrl+Z)" disabled={!past.length} onClick={undo}>
            <UndoIcon />
          </button>
          <button className="mini icon" title="다시 실행 (Ctrl+Y)" disabled={!future.length} onClick={redo}>
            <RedoIcon />
          </button>
          <button className="mini icon" title="지금 위치에 줄 추가" onClick={add}>
            <AddIcon />
          </button>
        </div>
        <span className="grow" />
        <div className="flat-group">
          <button className="mini icon" title="닫기" onClick={close}>
            <CloseIcon />
          </button>
          <button className="mini on" disabled={!dirty} onClick={() => void doSave()} title="음성 파일 옆에 vtt로 저장 (Ctrl+S)">
            <SaveIcon /> 저장
          </button>
        </div>
      </div>
      <div className="se-list" ref={ref}>
        {!cues.length && <div className="hint empty small">줄이 없습니다. 재생하면서 "줄 추가"로 만들 수 있습니다.</div>}
        {cues.map((c, i) => {
          const refLine = reference ? reference.cues.filter((r) => r.start < c.end && r.end > c.start).map((r) => r.text).join(' ') : ''
          return (
            <div
              key={i}
              data-i={i}
              className={`se-row ${i === active ? 'on' : ''} ${c.low ? 'low' : ''}`}
              title={c.low ? '대본 맞추기에서 위치가 확실하지 않은 줄입니다. 시간을 고치면 표시가 사라집니다.' : undefined}
            >
              <div className="se-times">
                <button className="mini icon" title="여기서 재생" onClick={() => (seek(c.start + offset), void media().play())}>
                  <PlayArrowIcon />
                </button>
                <TimeInput value={c.start} onChange={(v) => edit(i, { start: v })} />
                <button className="mini icon" title="시작을 지금 위치로" onClick={() => edit(i, { start: pos() })}>
                  <FirstPageIcon />
                </button>
                <TimeInput value={c.end} onChange={(v) => edit(i, { end: v })} />
                <button className="mini icon" title="끝을 지금 위치로" onClick={() => edit(i, { end: pos() })}>
                  <LastPageIcon />
                </button>
              </div>
              <div className="se-text">
                <textarea value={c.text} rows={Math.max(1, c.text.split('\n').length)} onChange={(e) => edit(i, { text: e.target.value })} />
                {refLine && <div className="se-ref hint">{refLine}</div>}
              </div>
              <div className="se-actions flat-group">
                <button className="mini icon" title="둘로 나누기" onClick={() => split(i)}>
                  <ContentCutIcon />
                </button>
                <button className="mini icon" title="다음 줄과 합치기" disabled={i === cues.length - 1} onClick={() => merge(i)}>
                  <MergeIcon />
                </button>
                <button className="mini icon danger" title="줄 삭제" onClick={() => change(cues.filter((_, j) => j !== i))}>
                  <DeleteIcon />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {ask === 'close' && (
        <Confirm
          title="저장하지 않은 변경이 있습니다"
          body="닫으면 이번에 고친 내용이 사라집니다."
          ok="저장하지 않고 닫기"
          onCancel={() => setAsk(null)}
          onOk={() => useStore.setState({ editing: false })}
        />
      )}
    </div>
  )
}
