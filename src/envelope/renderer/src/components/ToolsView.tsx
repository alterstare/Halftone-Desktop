// 파일 정리 (CLAUDE.md §5.6–5.8). A toggle at the top says what changes:
//   프로그램 내 변경 — only what the program keeps (names shown, DLsite info,
//     subtitles, the cover shown), many works at once;
//   폴더 변경 — the library's folders and files: 라이브러리 스캔 reads the
//     folders and builds a plan (nothing changes) → the user unticks what to
//     keep → 실행 asks once more → results, history, 되돌리기.
// Every list puts the works the tab can act on first and the others last
// (greyed), each with a button that opens the work's folder.
// Everywhere outside this screen only the program's own data changes.
import { useEffect, useMemo, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { useStore } from '../store'
import type { ToolTab, ToolsMode } from '../store'
import type { CoverItem, CoverSaveItem, HistoryEntry, NameStatus, ProgressEvent, RenameItem, ScriptSource, SubExportItem, ToolResult, WavItem, WorkSummary } from '../../../shared/types'
import { clock } from '../format'
import {
  KeyboardArrowLeftIcon,
  AudioFileIcon,
  CancelIcon,
  CloseIcon,
  CloudDownloadIcon,
  DriveFileRenameOutlineIcon,
  EditIcon,
  FileOpenIcon,
  FolderOpenIcon,
  ImageIcon,
  LibraryMusicIcon,
  PauseIcon,
  PlayArrowIcon,
  ScheduleIcon,
  SearchIcon,
  SubtitlesIcon,
  UndoIcon
} from './icons'
import { Confirm, Dropdown } from './ui'

type Item = CoverItem | WavItem | RenameItem | CoverSaveItem | SubExportItem
const TABS: [ToolTab, string, typeof ImageIcon][] = [
  ['rename', '이름', DriveFileRenameOutlineIcon],
  ['dlsite', 'DLsite 정보', CloudDownloadIcon],
  ['subs', '자막', SubtitlesIcon],
  ['cover', '썸네일', ImageIcon],
  ['wav', '용량 최적화', AudioFileIcon],
  ['jobs', '작업', ScheduleIcon]
]
// what each tab does in each mode
const ABOUT: Record<ToolsMode, Record<ToolTab, string>> = {
  app: {
    rename: '깨진 이름 복구: 압축 해제 때 깨진 일본어 이름(뷁어)을 프로그램 안에서는 언제나 복구해서 보여 줍니다. 일본어 이름 번역: 작품 · 폴더 · 파일 이름을 번역해 프로그램 안에서만 보여 줍니다(설정 › 이름 표시 › 번역한 이름). 폴더 · 파일 이름은 바뀌지 않습니다.',
    dlsite: '작품 코드로 DLsite에서 제목 · 서클 · 성우 · 표지를 가져와 프로그램 안에 저장합니다(1초에 한 작품). 폴더에는 아무것도 쓰지 않습니다.',
    subs: '자막을 번역하거나 만들어 프로그램 안에 저장합니다. 음성 파일 옆에는 쓰지 않습니다(폴더에 넣으려면 폴더 변경 › 자막).',
    cover: '프로그램에서 보여 줄 작품 표지를 고릅니다. mp3 파일은 바뀌지 않습니다.',
    wav: '용량 최적화는 파일을 바꾸는 작업이라 폴더 변경에서만 할 수 있습니다.',
    jobs: '받아쓰기 · 대본 자막 · 번역 · 이름 번역 · 파일 정리 같은 작업의 진행 상황입니다. 작업마다 취소하거나, 모두 중지(재개하면 멈춘 곳부터 이어서) · 모두 취소할 수 있습니다.'
  },
  folder: {
    rename:
      '작품 폴더와 그 안의 폴더 · 파일 이름을 실제로 바꿉니다. 깨진 이름 복구: 압축 해제 때 깨진 일본어 이름(뷁어)을 원래 이름으로(사라진 글자는 작품 제목 · 다른 이름 · 단어 사전으로 채웁니다). 일본어 이름 번역: 프로그램 내 변경 › 이름에서 번역해 둔 한국어 이름으로(자막 등 짝 파일도 같은 이름). 기록한 원래 이름: 처음 스캔했을 때 기록해 둔 일본어 이름으로(번역 · 다른 프로그램으로 바꾼 이름도). 줄마다 새 이름을 고칠 수 있고, 이어 듣기 · 북마크는 그대로 남으며, 되돌릴 수 있습니다.',
    dlsite: 'DLsite에서 가져온 표지 그림을 작품 폴더에 cover.jpg로 저장합니다(이미 있으면 cover (DLsite).jpg). 되돌릴 수 있습니다.',
    subs: '프로그램 안에 저장된 자막을 음성 파일 옆에 "이름.ja.vtt" · "이름.ko.vtt"로 저장합니다. 다른 프로그램이 만든 같은 이름의 파일은 체크해야만 바꿉니다. 되돌릴 수 있습니다.',
    cover:
      '폴더 이미지(트랙 번호가 같은 그림, 없으면 작품 표지)를 mp3 안에 앨범 커버로 넣습니다. 파일 날짜는 그대로이고, 원래 태그를 보관해 되돌릴 수 있습니다.',
    wav: '같은 폴더에서 확장자만 다른 같은 이름의 파일이 대상입니다. mp3와 길이가 같은 wav는 휴지통으로 보내고, wav만 있으면 mp3로 바꾼 뒤 길이를 확인하고 wav를 휴지통으로 보냅니다. 휴지통에서 복원할 수 있습니다.',
    jobs: '받아쓰기 · 대본 자막 · 번역 · 이름 번역 · 파일 정리 같은 작업의 진행 상황입니다. 작업마다 취소하거나, 모두 중지(재개하면 멈춘 곳부터 이어서) · 모두 취소할 수 있습니다.'
  }
}
const LANG_NAME: Record<string, string> = { ja: '일본어', ko: '한국어', other: '기타' }

const mb = (n: number): string => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)}GB` : `${Math.round(n / (1 << 20))}MB`)
const name = (p: string): string => p.split(/[\\/]/).pop() ?? p
const rel = (p: string, root: string): string => (p.toLowerCase().startsWith(root.toLowerCase()) ? p.slice(root.length + 1) : p)

function defaultOn(tab: ToolTab, it: Item): boolean {
  if (tab === 'wav') return (it as WavItem).kind === 'convert' || (it as WavItem).kind === 'delete'
  if (tab === 'cover') return !!(it as CoverItem).image && !(it as CoverItem).hasCover
  if (tab === 'dlsite') return true
  if (tab === 'subs') return (it as SubExportItem).state !== 'conflict'
  return (it as RenameItem).problem !== 'too-long'
}

function Tag({ kind, children }: { kind?: 'ok' | 'warn' | 'bad' | 'mute'; children: ReactNode }): JSX.Element {
  return <span className={`ttag ${kind ?? ''}`}>{children}</span>
}

function Row({ tab, it, root, onEdit }: { tab: ToolTab; it: Item; root: string; onEdit?: (name: string) => void }): JSX.Element {
  if (tab === 'wav') {
    const w = it as WavItem
    const label = { convert: 'mp3로 변환', delete: 'wav 삭제', check: '확인 필요', skip: '건너뛰기' }[w.kind]
    return (
      <>
        <Tag kind={w.kind === 'skip' ? 'mute' : w.kind === 'check' ? 'warn' : 'ok'}>{label}</Tag>
        <span className="tr-main">
          <span className="tr-name">{rel(w.wav, root)}</span>
          <span className="tr-sub hint">
            {w.kind === 'convert' && `→ ${name(w.mp3)} · ${clock(w.wavSeconds)}`}
            {(w.kind === 'delete' || w.kind === 'check') && `mp3: ${name(w.mp3)} · ${clock(w.wavSeconds)} / ${clock(w.mp3Seconds)}`}
            {w.kind === 'skip' && w.reason}
          </span>
        </span>
        <span className="tr-side hint">{mb(w.bytes)}</span>
      </>
    )
  }
  if (tab === 'cover') {
    const c = it as CoverItem
    return (
      <>
        {c.image ? <img className="tr-thumb" src={window.api.thumbUrl(c.image)} alt="" /> : <span className="tr-thumb empty" />}
        <span className="tr-main">
          <span className="tr-name">{rel(c.track, root)}</span>
          <span className="tr-sub hint">{!c.image ? '쓸 이미지가 없습니다' : rel(c.image, root) === c.image ? 'DLsite 표지' : rel(c.image, root)}</span>
        </span>
        <span className="tr-side">{c.hasCover && <Tag kind="warn">기존 커버 바꾸기</Tag>}</span>
      </>
    )
  }
  if (tab === 'dlsite') {
    const c = it as CoverSaveItem
    return (
      <>
        <img className="tr-thumb" src={window.api.thumbUrl(c.from)} alt="" />
        <span className="tr-main">
          <span className="tr-name">{rel(c.to, root)}</span>
          <span className="tr-sub hint">DLsite 표지를 작품 폴더에 저장</span>
        </span>
        <span className="tr-side" />
      </>
    )
  }
  if (tab === 'subs') {
    const x = it as SubExportItem
    return (
      <>
        <Tag>{LANG_NAME[x.lang] ?? x.lang}</Tag>
        <span className="tr-main">
          <span className="tr-name">{rel(x.to, root)}</span>
          <span className="tr-sub hint">{name(x.trackPath)}</span>
        </span>
        <span className="tr-side">
          {x.state === 'update' && <Tag>Envelope가 만든 파일 바꾸기</Tag>}
          {x.state === 'conflict' && <Tag kind="warn">다른 프로그램의 파일 · 체크하면 바꾸기</Tag>}
        </span>
      </>
    )
  }
  return <RenameRow r={it as RenameItem} root={root} onEdit={onEdit} />
}

function RenameRow({ r, root, onEdit }: { r: RenameItem; root: string; onEdit?: (name: string) => void }): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const done = (save: boolean): void => {
    setEditing(false)
    if (save && draft.trim() && draft.trim() !== name(r.to)) onEdit?.(draft.trim())
  }
  return (
    <>
      <Tag kind={r.problem === 'too-long' ? 'bad' : 'ok'}>{r.work ? '작품 폴더' : r.dir ? '폴더' : '파일'}</Tag>
      <span className="tr-main">
        {editing ? (
          <input
            className="tr-edit"
            autoFocus
            value={draft}
            onClick={(e) => e.preventDefault()}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') done(true)
              if (e.key === 'Escape') done(false)
              e.stopPropagation()
            }}
            onBlur={() => done(true)}
          />
        ) : (
          <span className="tr-name">
            {name(r.to)}
            {onEdit && (
              <button
                className="mini icon tr-edit-btn"
                title="새 이름 고치기"
                onClick={(e) => {
                  e.preventDefault()
                  setDraft(name(r.to))
                  setEditing(true)
                }}
              >
                <EditIcon />
              </button>
            )}
          </span>
        )}
        <span className="tr-sub hint">
          {name(r.from)} {rel(r.from, root).includes('\\') || rel(r.from, root).includes('/') ? `· ${rel(r.from, root).replace(/[\\/][^\\/]*$/, '')}` : ''}
        </span>
      </span>
      <span className="tr-side">
        {r.translated && <Tag>번역</Tag>}
        {r.filled > 0 && <Tag>채운 글자 {r.filled}</Tag>}
        {r.unfilled > 0 && <Tag kind="warn">남은 _ {r.unfilled}</Tag>}
        {r.problem === 'conflict' && <Tag kind="warn">같은 이름이 있어 번호 붙이기</Tag>}
        {r.problem === 'too-long' && <Tag kind="bad">경로가 너무 깁니다</Tag>}
      </span>
    </>
  )
}

function History({ list, reload }: { list: HistoryEntry[]; reload: () => void }): JSX.Element | null {
  if (!list.length) return null
  return (
    <section className="tools-history">
      <h2>기록</h2>
      {list.map((h) => (
        <div key={h.id} className="hist">
          <span className="hint">{new Date(h.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          <span className="grow">{h.summary}</span>
          {h.undoable && (
            <div className="flat-group">
              <button
                className="mini"
                onClick={async () => {
                  const r = await window.api.undo()
                  useStore.getState().showToast({ ok: true, message: r.label ? `되돌렸습니다: ${r.label}` : '되돌릴 작업이 없습니다.' })
                  await window.api.scan()
                  reload()
                }}
              >
                <UndoIcon /> 되돌리기
              </button>
            </div>
          )}
          {h.kind === 'wav' && <span className="hint">휴지통에서 복원</span>}
        </div>
      ))}
    </section>
  )
}

const JOB_STATE: Record<ProgressEvent['state'], string> = { queued: '기다리는 중', running: '진행 중', done: '완료', failed: '실패', cancelled: '취소' }

function JobRow({ j }: { j: ProgressEvent }): JSX.Element {
  const live = j.state === 'queued' || j.state === 'running'
  const pct = j.total ? Math.min(100, Math.floor((j.done / j.total) * 100)) : null
  const title = j.title ?? j.label
  // "대본 자막 · 작품" → what, and which work
  const at = title.indexOf(' · ')
  const what = at < 0 ? title : title.slice(0, at)
  const work = at < 0 ? '' : title.slice(at + 3)
  const step = j.label !== title ? j.label : ''
  const count = j.total ? (j.unit === 'bytes' ? `${mb(j.done)} / ${mb(j.total)}` : `${Math.floor(j.done)} / ${j.total}`) : ''
  return (
    <div className={`job-row ${j.state} ${j.paused ? 'paused' : ''}`}>
      <span className="job-main">
        <span className="job-what">
          <Tag kind={j.state === 'failed' ? 'bad' : j.state === 'cancelled' || j.paused ? 'mute' : j.state === 'done' ? 'ok' : 'warn'}>{j.state === 'queued' && j.paused ? '중지' : JOB_STATE[j.state]}</Tag>
          <span className="job-kind">{what}</span>
          {work && <span className="job-work">{work}</span>}
        </span>
        {(step || j.error) && <span className="hint job-step">{j.error ?? step}</span>}
      </span>
      {live && (
        <div className="job-progress">
          <span className="hint">{[count, pct !== null && j.state === 'running' ? `${pct}%` : ''].filter(Boolean).join(' · ')}</span>
          <div className="bar">
            <div className={pct === null ? 'busy' : ''} style={{ width: pct === null ? '30%' : `${pct}%` }} />
          </div>
        </div>
      )}
      {!live && j.startedAt && <span className="hint">{new Date(j.startedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>}
      {live && (
        <div className="flat-group">
          <button className="mini icon" title="이 작업 취소" onClick={() => void window.api.cancelJob(j.jobId)}>
            <CloseIcon />
          </button>
        </div>
      )}
    </div>
  )
}

// 모두 중지 (stopped jobs wait, 재개 carries on from where they were — engine
// results are cached) / 모두 재개 / 모두 취소. A job that changes files is
// not cut off by 중지: it finishes, then nothing new starts.
export function JobControls({ live }: { live: ProgressEvent[] }): JSX.Element {
  const paused = live.some((j) => j.paused)
  return (
    <div className="flat-group job-controls">
      {paused ? (
        <button className="mini" onClick={() => void window.api.resumeJobs()}>
          <PlayArrowIcon /> 모두 재개
        </button>
      ) : (
        <button className="mini" title="진행 중인 작업을 멈추고 기다리게 합니다(파일을 바꾸는 작업은 끝까지). 재개하면 멈춘 곳부터 이어서 합니다." onClick={() => void window.api.pauseJobs()}>
          <PauseIcon /> 모두 중지
        </button>
      )}
      <button className="mini" title="진행 중 · 기다리는 작업을 모두 취소합니다" onClick={() => void window.api.cancelAllJobs()}>
        <CancelIcon /> 모두 취소
      </button>
    </div>
  )
}

function Jobs(): JSX.Element {
  const jobs = useStore((s) => s.jobs)
  const live = jobs.filter((j) => j.state === 'queued' || j.state === 'running')
  const ended = jobs.filter((j) => !live.includes(j))
  if (!jobs.length) return <p className="hint tools-empty">앱을 켠 뒤로 실행한 작업이 없습니다.</p>
  return (
    <section className="jobs">
      {live.length > 0 && (
        <div className="jobs-head">
          <h2>{live.some((j) => j.paused) ? '중지' : '진행 중'} · {live.length}</h2>
          <JobControls live={live} />
        </div>
      )}
      {live.map((j) => (
        <JobRow key={j.jobId} j={j} />
      ))}
      {ended.length > 0 && <h2>끝난 작업</h2>}
      {ended.map((j) => (
        <JobRow key={j.jobId} j={j} />
      ))}
    </section>
  )
}


// ---- shared pieces of the lists ----

const total = (n: number, verb = ''): string => `총 ${n}개${verb ? ` ${verb}` : ''}`

// The work's folder, opened as it is (to look at the files before deciding).
function FolderButton({ path }: { path: string }): JSX.Element {
  return (
    <button
      className="mini icon tr-folder"
      title="작품 폴더 열기"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void window.api.openFolder(path)
      }}
    >
      <FolderOpenIcon />
    </button>
  )
}

// 라이브러리 스캔: reads the folders again, then this tab's check.
function ScanButton({ busy, onClick }: { busy: boolean; onClick: () => void }): JSX.Element {
  return (
    <button className="btn primary tools-scan" disabled={busy} onClick={onClick}>
      <SearchIcon /> 라이브러리 스캔
    </button>
  )
}

interface WorkRef {
  id: number
  title: string
  path: string
}

// One work in a list: tick · title · what it has · folder.
function WorkLine({
  w,
  checked,
  disabled,
  onCheck,
  side,
  off
}: {
  w: WorkRef
  checked?: boolean
  disabled?: boolean
  onCheck?: (v: boolean) => void
  side?: ReactNode
  off?: boolean
}): JSX.Element {
  return (
    <label className={`trow-work ${off ? 'off' : ''}`}>
      {onCheck ? <input type="checkbox" checked={!!checked && !disabled} disabled={disabled} onChange={(e) => onCheck(e.target.checked)} /> : <span />}
      <span className="tr-main">
        <span className="tr-name" title={w.title}>
          {w.title}
        </span>
      </span>
      {/* the controls here don't tick the row */}
      <span className="tr-side" onClick={(e) => (e.target as HTMLElement).closest('button, .dd') && e.preventDefault()}>
        {side}
      </span>
      <FolderButton path={w.path} />
    </label>
  )
}

// A titled block of works; `all` puts a 전체 선택 tick on its head.
function WorkBlock({
  title,
  count,
  all,
  children
}: {
  title: string
  count: number
  all?: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }
  children: ReactNode
}): JSX.Element | null {
  if (!count) return null
  return (
    <section className="tgroup">
      {all ? (
        <label className="tgroup-head check">
          <input type="checkbox" checked={all.checked} disabled={all.disabled} onChange={(e) => all.onChange(e.target.checked)} />
          <span className="tgroup-title">{title}</span>
          <span className="hint">{total(count)}</span>
        </label>
      ) : (
        <div className="tgroup-head check">
          <span className="tgroup-title">{title}</span>
          <span className="hint">{total(count)}</span>
        </div>
      )}
      {children}
    </section>
  )
}

// Works that this tab has nothing to do for: always last, greyed.
function OtherWorks({ list, why, title = '대상이 아닌 작품' }: { list: WorkRef[]; why: (w: WorkRef) => string; title?: string }): JSX.Element | null {
  return (
    <WorkBlock title={title} count={list.length}>
      {list.map((w) => (
        <WorkLine key={w.id} w={w} off side={<Tag kind="mute">{why(w)}</Tag>} />
      ))}
    </WorkBlock>
  )
}

// a set of ticked work ids, with helpers
function usePicked(): [Set<number>, (s: Set<number>) => void, (ids: number[], v: boolean) => void] {
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const toggle = (ids: number[], v: boolean): void =>
    setPicked((p) => {
      const next = new Set(p)
      ids.forEach((id) => (v ? next.add(id) : next.delete(id)))
      return next
    })
  return [picked, setPicked, toggle]
}

// ---- 프로그램 내 변경 panels (nothing in the library folders changes) ----

// 이름: 깨진 이름 복구 (뷁어) — shown repaired in the program already, so this
// lists what was repaired; 일본어 이름 번역 — the names still in Japanese, then
// one job per ticked work.
function NamesApp({
  scope,
  kind,
  foldersOnly,
  tick
}: {
  scope: number[] | null
  kind: 'repair' | 'translate'
  foldersOnly: boolean
  tick: number
}): JSX.Element {
  const works = useStore((s) => s.works)
  const inScope = works.filter((w) => !scope || scope.includes(w.id))
  const [status, setStatus] = useState<NameStatus[] | null>(null)
  const [repairs, setRepairs] = useState<RenameItem[] | null>(null)
  const [picked, setPicked, toggle] = usePicked()
  const [onlyMissing, setOnlyMissing] = useState(true)
  const [busy, setBusy] = useState(false)
  // 라이브러리 스캔 (tick) · the option · the name range → look again
  const check = async (): Promise<void> => {
    setBusy(true)
    try {
      if (kind === 'repair') setRepairs(await window.api.planRename(scope, 'repair'))
      else {
        const got = await window.api.nameStatus(scope, foldersOnly)
        setStatus(got)
        setPicked(new Set(got.filter((x) => x.missing > 0).map((x) => x.workId)))
      }
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    setStatus(null)
    setRepairs(null)
    if (tick) void check()
  }, [tick, kind, foldersOnly, String(scope)]) // eslint-disable-line react-hooks/exhaustive-deps

  if (busy && !status && !repairs) return <p className="hint tools-empty">이름을 읽는 중…</p>
  if (kind === 'repair') {
    if (!repairs) return <p className="hint tools-empty">라이브러리 스캔을 누르면 작품마다 복구한 이름을 보여 줍니다.</p>
    const shown = repairs.filter((r) => !foldersOnly || r.work || r.dir)
    const by = new Map<number, RenameItem[]>()
    for (const r of shown) by.set(r.workId, [...(by.get(r.workId) ?? []), r])
    const target = inScope.filter((w) => by.has(w.id))
    return (
      <section className="app-panel">
        <div className="tools-summary">
          <span>{shown.length ? `작품 ${target.length}개 · ${total(shown.length, '복구')}` : '깨진 이름이 없습니다.'}</span>
        </div>
        {shown.length > 0 && <p className="hint">프로그램 안에서는 이미 복구한 이름으로 보입니다. 폴더 · 파일 이름까지 바꾸려면 폴더 변경 › 이름.</p>}
        {target.map((w) => (
          <section key={w.id} className="tgroup">
            <div className="tgroup-head check">
              <span className="tgroup-title">{w.title}</span>
              <span className="hint">{total(by.get(w.id)!.length, '복구')}</span>
              <FolderButton path={w.path} />
            </div>
            {by.get(w.id)!.map((r) => (
              <div key={r.id} className="trow-tool">
                <span />
                <Row tab="rename" it={r} root={w.path} />
              </div>
            ))}
          </section>
        ))}
        <OtherWorks list={inScope.filter((w) => !by.has(w.id))} why={() => '깨진 이름 없음'} />
      </section>
    )
  }

  if (!status) return <p className="hint tools-empty">라이브러리 스캔을 누르면 작품마다 번역할 일본어 이름을 셉니다.</p>
  const n = (x: NameStatus): number => (onlyMissing ? x.missing : x.total)
  const byId = new Map(status.map((x) => [x.workId, x]))
  const target = inScope.filter((w) => (byId.get(w.id) ? n(byId.get(w.id)!) > 0 : false))
  const done = inScope.filter((w) => byId.get(w.id) && byId.get(w.id)!.total > 0 && n(byId.get(w.id)!) === 0)
  const other = inScope.filter((w) => !target.includes(w) && !done.includes(w))
  const ids = target.map((w) => w.id)
  const count = ids.filter((id) => picked.has(id)).length
  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      useStore.getState().showToast(await window.api.translateNamesOf(ids.filter((id) => picked.has(id)), onlyMissing, foldersOnly))
    } finally {
      setBusy(false)
    }
    void useStore.getState().loadWorks()
    await check()
  }
  return (
    <section className="app-panel">
      <div className="tools-actions">
        <div className="flat-group" title="번역할 이름">
          <button className={`mini ${onlyMissing ? 'on' : ''}`} onClick={() => setOnlyMissing(true)}>
            번역 안 된 이름만
          </button>
          <button className={`mini ${onlyMissing ? '' : 'on'}`} onClick={() => setOnlyMissing(false)}>
            모두 다시 번역
          </button>
        </div>
      </div>
      <div className="tools-summary">
        <span>{target.length ? `작품 ${count}개 선택 · ${total(target.filter((w) => picked.has(w.id)).reduce((s, w) => s + n(byId.get(w.id)!), 0), '번역')}` : '번역할 일본어 이름이 없습니다.'}</span>
        <span className="grow" />
        {target.length > 0 && (
          <button className="btn primary" disabled={!count || busy} onClick={() => void run()}>
            선택한 작품 {count}개 번역
          </button>
        )}
      </div>
      <WorkBlock title="번역할 이름이 있는 작품" count={target.length} all={{ checked: count === ids.length, onChange: (v) => toggle(ids, v) }}>
        {target.map((w) => (
          <WorkLine key={w.id} w={w} checked={picked.has(w.id)} onCheck={(v) => toggle([w.id], v)} side={<Tag kind="warn">{total(n(byId.get(w.id)!), '번역')}</Tag>} />
        ))}
      </WorkBlock>
      <OtherWorks title="번역을 마친 작품" list={done} why={() => '번역 완료'} />
      <OtherWorks list={other} why={() => '일본어 이름 없음'} />
      {busy && <p className="hint">진행 상황은 작업 탭에서 작품별로 볼 수 있습니다.</p>}
    </section>
  )
}

// DLsite 정보: fetch into the program, many works at once.
function DlsiteApp({ scope }: { scope: number[] | null }): JSX.Element {
  const works = useStore((s) => s.works)
  const [busy, setBusy] = useState(false)
  const inScope = works.filter((w) => !scope || scope.includes(w.id))
  const coded = inScope.filter((w) => w.code)
  const run = async (ids: number[] | null): Promise<void> => {
    setBusy(true)
    try {
      useStore.getState().showToast(await window.api.fetchDlsite(ids))
    } finally {
      setBusy(false)
    }
    void useStore.getState().loadWorks()
  }
  return (
    <section className="app-panel">
      <div className="tools-summary">
        <span>작품 코드가 있는 작품 {coded.length}개</span>
        <span className="grow" />
        <div className="flat-group">
          <button className="mini" disabled={busy || !coded.length} onClick={() => void run(scope ? coded.map((w) => w.id) : null)}>
            <CloudDownloadIcon /> {scope ? '이 작품 가져오기' : '아직 안 가져온 작품 가져오기'}
          </button>
          {!scope && (
            <button className="mini" disabled={busy || !coded.length} onClick={() => void run(coded.map((w) => w.id))}>
              모두 다시 가져오기
            </button>
          )}
        </div>
      </div>
      {busy && <p className="hint">진행 상황은 작업 탭에서 볼 수 있습니다.</p>}
      <WorkBlock title="아직 가져오지 않은 작품" count={coded.filter((w) => !w.dlFetched).length}>
        {coded
          .filter((w) => !w.dlFetched)
          .map((w) => (
            <WorkLine key={w.id} w={w} side={<Tag kind="warn">{w.code}</Tag>} />
          ))}
      </WorkBlock>
      <WorkBlock title="가져온 작품" count={coded.filter((w) => w.dlFetched).length}>
        {coded
          .filter((w) => w.dlFetched)
          .map((w) => (
            <WorkLine key={w.id} w={w} side={<Tag kind={w.circle ? 'ok' : 'mute'}>{w.circle ? '가져옴' : 'DLsite에 없음'}</Tag>} />
          ))}
      </WorkBlock>
      <OtherWorks list={inScope.filter((w) => !w.code)} why={() => '작품 코드 없음'} />
    </section>
  )
}

// 자막: the subtitles kept in the program, for many works —
//   자막 번역            Japanese subtitles → Korean
//   자막 생성 및 번역    speech → Japanese subtitles (→ Korean)
//   대본으로 자막 생성   Japanese script → subtitles (→ Korean); Korean script →
//                        the Japanese speech places the script's lines
type SubKind = 'translate' | 'make' | 'script'
const SCRIPT_LANG: Record<string, string> = { ja: '일본어', ko: '한국어', other: '언어 미확인' }
const SUB_ABOUT: Record<SubKind, string> = {
  translate: '일본어 자막을 한국어로 번역해 프로그램 안에 저장합니다. 한국어 자막이 이미 있는 작품은 "다시 만들기"를 켜야 바뀝니다.',
  make: '음성을 받아써 일본어 자막을 만듭니다. "번역까지"를 고르면 한국어 자막도 만듭니다.',
  script:
    '작품 폴더의 대본(txt · pdf · docx)으로 자막을 만듭니다. 일본어 대본은 대사 위치를 맞춰 일본어 자막을 만들고 한국어로 번역합니다. 한국어 대본은 일본어 음성으로 위치를 잡아 한국어 대본을 넣습니다. 대본을 찾지 못한 작품은 파일을 직접 고를 수 있습니다.'
}
function SubsApp({ scope, tick }: { scope: number[] | null; tick: number }): JSX.Element {
  const works = useStore((s) => s.works)
  const inScope = works.filter((w) => !scope || scope.includes(w.id))
  const [kind, setKind] = useState<SubKind>('make')
  const [andTranslate, setAndTranslate] = useState(true)
  const [redo, setRedo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [picked, setPicked, toggle] = usePicked()
  // 대본: each work's scripts (looked up once that option is chosen) and the chosen one
  const [scripts, setScripts] = useState<Map<number, ScriptSource[]> | null>(null)
  const [chosen, setChosen] = useState<Map<number, string>>(new Map())
  useEffect(() => {
    if (kind !== 'script') return undefined
    let alive = true
    setScripts(null)
    void (async () => {
      const found = new Map<number, ScriptSource[]>()
      for (const w of inScope) found.set(w.id, await window.api.findScripts(w.id).catch(() => []))
      if (alive) setScripts(found)
    })()
    return () => {
      alive = false
    }
  }, [kind, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasSubs = (w: WorkSummary): boolean => w.subtitled > 0
  const subNote = (w: WorkSummary): string => {
    const l = [w.content.subs.ja && '일본어', w.content.subs.ko && '한국어'].filter(Boolean)
    return l.length ? `${l.join(' · ')} 자막 있음` : '자막 있음'
  }
  // a work's script language: Japanese first (the script is the subtitle), then Korean
  const scriptLang = (id: number): 'ja' | 'ko' | null => {
    const l = scripts?.get(id) ?? []
    if (!l.length) return null
    return l.some((x) => x.lang !== 'ko') ? 'ja' : 'ko'
  }

  // the blocks of this option: [title, works, ticked by default, reason when greyed]
  const blocks = useMemo((): { title: string; list: WorkSummary[]; on: boolean; other?: string }[] => {
    if (kind === 'translate') {
      const can = inScope.filter((w) => w.lang !== 'ko-voice' && w.content.subs.ja)
      return [
        { title: '한국어 자막이 없는 작품', list: can.filter((w) => !w.content.subs.ko), on: true },
        { title: '한국어 자막도 있는 작품', list: can.filter((w) => w.content.subs.ko), on: false },
        { title: '대상이 아닌 작품', list: inScope.filter((w) => !can.includes(w)), on: false, other: '' }
      ]
    }
    if (kind === 'make') {
      const audio = inScope.filter((w) => w.tracks > 0)
      return [
        { title: '자막 없는 트랙이 있는 작품', list: audio.filter((w) => w.subtitled < w.tracks), on: true },
        { title: '모든 트랙에 자막이 있는 작품', list: audio.filter((w) => w.subtitled >= w.tracks), on: false },
        { title: '대상이 아닌 작품', list: inScope.filter((w) => !w.tracks), on: false, other: '음성 트랙 없음' }
      ]
    }
    if (!scripts) return []
    const withScript = inScope.filter((w) => scriptLang(w.id))
    return [
      { title: '일본어 대본이 있는 작품', list: withScript.filter((w) => scriptLang(w.id) === 'ja' && !hasSubs(w)), on: true },
      { title: '한국어 대본이 있는 작품', list: withScript.filter((w) => scriptLang(w.id) === 'ko' && !hasSubs(w)), on: true },
      { title: '대본과 자막이 같이 있는 작품', list: withScript.filter((w) => hasSubs(w)), on: false },
      { title: '대본을 찾지 못한 작품', list: inScope.filter((w) => !withScript.includes(w)), on: false }
    ]
  }, [kind, works, scripts, String(scope)]) // eslint-disable-line react-hooks/exhaustive-deps

  // the default ticks and scripts, again for each option / scan
  useEffect(() => {
    setPicked(new Set(blocks.filter((b) => b.on).flatMap((b) => b.list.map((w) => w.id))))
    if (kind === 'script' && scripts) {
      const pick = new Map<number, string>()
      for (const [id, l] of scripts) {
        const lang = scriptLang(id)
        const first = l.find((x) => (lang === 'ko' ? x.lang === 'ko' : x.lang !== 'ko')) ?? l[0]
        if (first) pick.set(id, first.id)
      }
      setChosen(pick)
    }
  }, [blocks]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickFile = async (id: number): Promise<void> => {
    const f = await window.api.pickScript(id)
    if (!f) return
    setScripts((s) => s && new Map(s).set(id, [...(s.get(id) ?? []).filter((x) => x.id !== f.id), f]))
    setChosen((c) => new Map(c).set(id, f.id))
    toggle([id], true)
  }
  const usable = (w: WorkSummary): boolean => (kind === 'script' ? !!chosen.get(w.id) : kind === 'translate' ? w.lang !== 'ko-voice' && !!w.content.subs.ja : w.tracks > 0)
  const ticked = inScope.filter((w) => picked.has(w.id) && usable(w))
  const run = async (): Promise<void> => {
    setBusy(true)
    let made = 0
    const failed: string[] = []
    try {
      for (const w of ticked) {
        const r =
          kind === 'script'
            ? await window.api.scriptSub(w.id, { sourceId: chosen.get(w.id)!, translate: true, redo })
            : await window.api.autoSub(w.id, { transcribe: kind === 'make', translate: kind === 'translate' || andTranslate, extras: false, redo })
        if (r.ok) made++
        else failed.push(r.message)
      }
    } finally {
      setBusy(false)
    }
    useStore.getState().showToast({ ok: !failed.length, message: failed.length ? `작품 ${made}개 끝 · ${failed.length}개 실패 — ${failed[0]}` : `작품 ${made}개의 자막을 프로그램 안에 저장했습니다` })
    void useStore.getState().loadWorks()
  }

  const side = (w: WorkSummary): ReactNode => {
    if (kind === 'translate') return w.content.subs.ko ? <Tag kind="ok">한국어 자막 있음</Tag> : <Tag kind="warn">일본어 자막만</Tag>
    if (kind === 'make') return w.subtitled >= w.tracks ? <Tag kind="ok">모든 트랙 자막</Tag> : <Tag kind="warn">자막 없는 트랙 {w.tracks - w.subtitled}</Tag>
    const list = scripts?.get(w.id) ?? []
    const sel = chosen.get(w.id)
    return (
      <>
        {hasSubs(w) && <Tag kind="ok">{subNote(w)}</Tag>}
        {list.length > 1 && sel ? (
          <Dropdown<string>
            kind="mini"
            title="대본"
            value={sel}
            options={list.map((x) => [x.id, `${x.label} · ${SCRIPT_LANG[x.lang]}${x.kind === 'perTrack' ? ' · 트랙별' : ''}`] as const)}
            onChange={(v) => setChosen(new Map(chosen).set(w.id, v))}
          />
        ) : list.length === 1 ? (
          <Tag kind="ok">
            <span className="ttag-text">
              {list[0].label} · {SCRIPT_LANG[list[0].lang]}
            </span>
          </Tag>
        ) : (
          <Tag kind="mute">대본 없음</Tag>
        )}
        <button className="mini icon" title="파일 고르기… (txt · pdf · docx)" onClick={() => void pickFile(w.id)}>
          <FileOpenIcon />
        </button>
      </>
    )
  }

  return (
    <section className="app-panel">
      <div className="tools-actions">
        <div className="flat-group">
          {(
            [
              ['translate', '자막 번역'],
              ['make', '자막 생성 및 번역'],
              ['script', '대본으로 자막 생성']
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={`mini ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
              {l}
            </button>
          ))}
        </div>
        {kind === 'make' && (
          <div className="flat-group">
            <button className={`mini ${andTranslate ? '' : 'on'}`} onClick={() => setAndTranslate(false)}>
              자막 생성만
            </button>
            <button className={`mini ${andTranslate ? 'on' : ''}`} onClick={() => setAndTranslate(true)}>
              번역까지
            </button>
          </div>
        )}
        <div className="flat-group">
          <button className={`mini ${redo ? 'on' : ''}`} title="이미 있는 자막도 새로 만들기 (프로그램 안의 것만 바뀝니다)" onClick={() => setRedo(!redo)}>
            다시 만들기
          </button>
        </div>
      </div>
      <p className="hint">{SUB_ABOUT[kind]}</p>
      <div className="tools-summary">
        <span>작품 {ticked.length}개 선택</span>
        <span className="grow" />
        <button className="btn primary" disabled={busy || !ticked.length} onClick={() => void run()}>
          {kind === 'translate' ? '선택한 작품 자막 번역' : '선택한 작품 자막 만들기'}
        </button>
      </div>
      {kind === 'script' && !scripts ? (
        <p className="hint">작품마다 대본을 찾는 중…</p>
      ) : (
        blocks.map((b) => {
          const ids = b.list.filter(usable).map((w) => w.id)
          return (
            <WorkBlock
              key={b.title}
              title={b.title}
              count={b.list.length}
              all={ids.length ? { checked: ids.every((id) => picked.has(id)), onChange: (v) => toggle(ids, v) } : undefined}
            >
              {b.list.map((w) =>
                b.other !== undefined && !(kind === 'script') ? (
                  <WorkLine key={w.id} w={w} off side={<Tag kind="mute">{b.other || (w.lang === 'ko-voice' ? '한국어 음성' : '일본어 자막 없음')}</Tag>} />
                ) : (
                  <WorkLine key={w.id} w={w} checked={picked.has(w.id)} disabled={!usable(w)} onCheck={(v) => toggle([w.id], v)} side={side(w)} />
                )
              )}
            </WorkBlock>
          )
        })
      )}
      {busy && <p className="hint">진행 상황은 작업 탭에서 작품별로 볼 수 있습니다.</p>}
    </section>
  )
}

// 원래 이름 기록: the Japanese subtitles recorded when the work was first
// scanned, back into the program (only where they differ from now).
function SubsRestore({ scope }: { scope: number[] | null }): JSX.Element {
  const [busy, setBusy] = useState(false)
  return (
    <section className="app-panel">
      <div className="tools-summary">
        <span>처음 스캔했을 때 기록해 둔 일본어 자막</span>
        <span className="grow" />
        <button
          className="mini"
          disabled={busy}
          title="기록한 일본어 자막을 프로그램 안으로 되살립니다(지금 자막과 같으면 건너뜁니다). 기록에서 되돌릴 수 있습니다."
          onClick={async () => {
            setBusy(true)
            try {
              useStore.getState().showToast(await window.api.restoreSubs(scope))
            } finally {
              setBusy(false)
            }
          }}
        >
          <UndoIcon /> 기록한 일본어 자막 되살리기
        </button>
      </div>
    </section>
  )
}

// 썸네일: works with both a folder picture and a DLsite cover — each one's
// choice (shown in the program, and put into its mp3s in 폴더 변경).
function CoverChoices({ scope, onChange }: { scope: number[] | null; onChange?: () => void }): JSX.Element | null {
  const works = useStore((s) => s.works)
  const settings = useStore((s) => s.settings)
  const both = works.filter((w) => (!scope || scope.includes(w.id)) && w.covers.folder && w.covers.dlsite)
  if (!both.length) return null
  const set = async (id: number, pref: 'folder' | 'dlsite'): Promise<void> => {
    await window.api.setCoverPref([id], pref)
    await useStore.getState().loadWorks()
    onChange?.()
  }
  return (
    <WorkBlock title="폴더 표지와 DLsite 표지가 둘 다 있는 작품" count={both.length}>
      {both.map((w) => {
        const cur = w.covers.pref ?? settings?.coverSource ?? 'folder'
        return (
          <div key={w.id} className="trow-work cover-choice">
            <span />
            <span className="tr-main">
              <span className="tr-name" title={w.title}>
                {w.title}
              </span>
              <span className="tr-sub hint">{w.covers.pref ? '이 작품에서 고른 표지' : '설정의 기본 표지'}</span>
            </span>
            <span className="tr-side">
              {(
                [
                  ['folder', '폴더 표지', w.covers.folder!],
                  ['dlsite', 'DLsite 표지', w.covers.dlsite!]
                ] as const
              ).map(([k, l, img]) => (
                <button key={k} className={`cover-pick ${cur === k ? 'on' : ''}`} title={`${l} 쓰기`} onClick={() => void set(w.id, k)}>
                  <img src={window.api.thumbUrl(img)} alt="" draggable={false} />
                  <span>{l}</span>
                </button>
              ))}
            </span>
            <FolderButton path={w.path} />
          </div>
        )
      })}
    </WorkBlock>
  )
}

function CoverApp({ scope }: { scope: number[] | null }): JSX.Element {
  const works = useStore((s) => s.works)
  const settings = useStore((s) => s.settings)
  const save = useStore((s) => s.saveSettings)
  return (
    <section className="app-panel">
      <div className="tools-summary">
        <span>프로그램에서 보여 줄 표지</span>
        <span className="grow" />
        <div className="flat-group">
          <button className={`mini ${settings?.coverSource !== 'dlsite' ? 'on' : ''}`} onClick={() => void save({ coverSource: 'folder' }).then(() => useStore.getState().loadWorks())}>
            폴더 이미지
          </button>
          <button className={`mini ${settings?.coverSource === 'dlsite' ? 'on' : ''}`} onClick={() => void save({ coverSource: 'dlsite' }).then(() => useStore.getState().loadWorks())}>
            DLsite 표지
          </button>
        </div>
      </div>
      <p className="hint">그림이 없는 작품은 언제나 DLsite 표지를 씁니다(DLsite 정보 탭에서 가져오기). 아래 작품은 하나씩 고를 수 있습니다.</p>
      <CoverChoices scope={scope} />
      <OtherWorks
        list={works.filter((w) => (!scope || scope.includes(w.id)) && !(w.covers.folder && w.covers.dlsite))}
        why={(w) => {
          const c = works.find((x) => x.id === w.id)!.covers
          return c.folder ? '폴더 표지만 있음' : c.dlsite ? 'DLsite 표지만 있음' : '표지 없음'
        }}
      />
    </section>
  )
}

// 용량 최적화 changes files: only in 폴더 변경.
function FolderOnly(): JSX.Element {
  return (
    <section className="app-panel">
      <div className="tools-summary">
        <span>용량 최적화는 파일을 바꾸는 작업입니다.</span>
        <span className="grow" />
        <button className="btn" onClick={() => useStore.setState({ toolsMode: 'folder' })}>
          <FolderOpenIcon /> 폴더 변경으로 바꾸기
        </button>
      </div>
    </section>
  )
}

// per tab: what a work's count means, and why a work isn't in the list
const COUNT_VERB: Partial<Record<ToolTab, string>> = {}
const NOTHING: Record<ToolTab, string> = {
  rename: '바꿀 이름 없음',
  dlsite: '저장할 DLsite 표지 없음',
  subs: '내보낼 자막 없음',
  cover: '넣을 mp3 없음',
  wav: '최적화할 파일 없음',
  jobs: ''
}

export default function ToolsView(): JSX.Element {
  const tab = useStore((s) => s.toolsTab)
  const mode = useStore((s) => s.toolsMode)
  const scope = useStore((s) => s.toolsScope)
  const works = useStore((s) => s.works)
  const job = useStore((s) => s.job)
  const settings = useStore((s) => s.settings)
  const save = useStore((s) => s.saveSettings)
  // results belong to the tab that made them: right after switching tabs the
  // old ones must not be drawn with the new tab's rows
  const [planned, setPlanned] = useState<{ tab: typeof tab; items: Item[] } | null>(null)
  const items = planned && planned.tab === tab ? planned.items : null
  // 이름: 깨진 이름 복구 / 일본어 이름 번역 (/ 기록한 원래 이름, 폴더 변경), and how far
  const [nameKind, setNameKind] = useState<'repair' | 'translate' | 'original'>('repair')
  const [foldersOnly, setFoldersOnly] = useState(false)
  const [on, setOn] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'scan' | 'plan' | 'run' | null>(null)
  const [ask, setAsk] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  // 라이브러리 스캔 in a 프로그램 내 변경 panel: they look again on each tick
  const [tick, setTick] = useState(0)
  const reloadHistory = (): void => void window.api.history().then(setHistory)
  const appNameKind = nameKind === 'original' ? 'repair' : nameKind

  useEffect(() => {
    setPlanned(null)
    reloadHistory()
  }, [tab, scope, mode])

  const plan = async (): Promise<void> => {
    if (tab === 'jobs' || mode !== 'folder') return
    setBusy('plan')
    try {
      const got: Item[] =
        tab === 'wav'
          ? await window.api.planWav(scope)
          : tab === 'cover'
            ? await window.api.planCover(scope)
            : tab === 'dlsite'
              ? await window.api.planCoverSave(scope)
              : tab === 'subs'
                ? await window.api.planSubExport(scope)
                : await window.api.planRename(scope, nameKind)
      setPlanned({ tab, items: got })
      setOn(new Set(got.filter((x) => defaultOn(tab, x)).map((x) => x.id)))
    } finally {
      setBusy(null)
    }
  }
  // the folders read again first (files changed outside the app show up), then this tab's check
  const scanLibrary = async (): Promise<void> => {
    setBusy('scan')
    try {
      await window.api.scan()
      await useStore.getState().loadWorks()
    } finally {
      setBusy(null)
    }
    if (mode === 'folder') await plan()
    else setTick((t) => t + 1)
  }

  // a new name typed in a row (same folder; forbidden characters → full-width)
  const editName = (it: RenameItem, n: string): void => {
    const safe = n.replace(/[\\/:*?"<>|]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).replace(/[. ]+$/, '') || '_'
    const to = it.from.replace(/[^\\/]*$/, () => safe)
    setPlanned((p) => p && { ...p, items: p.items.map((x) => (x.id === it.id ? { ...(x as RenameItem), to, problem: to.length > 259 ? 'too-long' : undefined } : x)) })
    setOn((o) => new Set(o).add(it.id))
  }

  // 이름: folder names only, or every name
  const shown = useMemo(
    () => (items ?? []).filter((x) => tab !== 'rename' || !foldersOnly || (x as RenameItem).work || (x as RenameItem).dir),
    [items, tab, foldersOnly]
  )
  const chosen = useMemo(() => shown.filter((x) => on.has(x.id)), [shown, on])
  const run = async (): Promise<void> => {
    setAsk(false)
    setBusy('run')
    let r: ToolResult
    try {
      r =
        tab === 'wav'
          ? await window.api.runWav(chosen as WavItem[])
          : tab === 'cover'
            ? await window.api.runCover(chosen as CoverItem[])
            : tab === 'dlsite'
              ? await window.api.runCoverSave(chosen as CoverSaveItem[])
              : tab === 'subs'
                ? await window.api.runSubExport(chosen as SubExportItem[])
                : await window.api.runRename(chosen as RenameItem[])
    } finally {
      setBusy(null)
    }
    useStore.getState().showToast({ ok: r.ok, message: r.failed.length ? `${r.message} — ${r.failed[0]}` : r.message })
    void useStore.getState().loadWorks()
    reloadHistory()
    await plan()
  }

  const byWork = useMemo(() => {
    const m = new Map<number, { title: string; list: Item[] }>()
    for (const it of shown) {
      const g = m.get(it.workId) ?? { title: it.workTitle, list: [] }
      g.list.push(it)
      m.set(it.workId, g)
    }
    return [...m.entries()]
  }, [shown])
  const inScope = works.filter((w) => !scope || scope.includes(w.id))
  const rootOf = (id: number): string => works.find((w) => w.id === id)?.path ?? ''
  const toggle = (ids: string[], v: boolean): void => {
    const next = new Set(on)
    ids.forEach((id) => (v ? next.add(id) : next.delete(id)))
    setOn(next)
  }
  const selectable = (it: Item): boolean => !(tab === 'wav' && (it as WavItem).kind === 'skip') && !(tab === 'cover' && !(it as CoverItem).image)
  // a work's count: 총 n개 복구 / 번역 / 되돌리기, or just 총 n개
  const verb = tab === 'rename' ? { repair: '복구', translate: '번역', original: '되돌리기' }[nameKind] : COUNT_VERB[tab]

  const summary = (): string => {
    if (tab === 'wav') {
      const w = chosen as WavItem[]
      const conv = w.filter((x) => x.kind === 'convert').length
      const freed = w.reduce((n, x) => n + x.bytes, 0)
      return `mp3 변환 ${conv}개 · wav 삭제 ${w.length}개 (휴지통) · 약 ${mb(freed)} 확보${conv ? ` (변환한 mp3 크기 제외)` : ''}`
    }
    if (tab === 'cover') return `mp3 ${chosen.length}개에 썸네일 넣기`
    if (tab === 'dlsite') return `표지 ${chosen.length}개를 작품 폴더에 저장`
    if (tab === 'subs') return `자막 ${chosen.length}개를 음성 옆에 .vtt로 저장`
    return `이름 ${chosen.length}개 바꾸기`
  }
  const scopeTitle = scope ? works.find((w) => w.id === scope[0])?.title ?? '선택한 작품' : '전체 라이브러리'
  const running = busy && job && job.state === 'running'
  const nameOptions = (
    [
      ['repair', '깨진 이름 복구 (뷁어)'],
      ['translate', '일본어 이름 번역'],
      ...(mode === 'folder' ? ([['original', '기록한 원래 이름']] as const) : [])
    ] as const
  ).map(([k, l]) => (
    <button
      key={k}
      className={`mini ${(mode === 'folder' ? nameKind : appNameKind) === k ? 'on' : ''}`}
      onClick={() => (setNameKind(k), setPlanned(null))}
    >
      {l}
    </button>
  ))

  return (
    <div className={`home tools mode-${mode}`}>
      <div className="home-head">
        <div className="badge">Tools</div>
        <h1>파일 정리</h1>
        <div className="tools-scope">
          <span className="hint">범위</span>
          <span className="scope-name">{scopeTitle}</span>
          {scope && (
            <div className="flat-group">
              <button className="mini" onClick={() => useStore.setState({ toolsScope: null })}>
                전체 라이브러리로
              </button>
              <button className="mini" onClick={() => void useStore.getState().openWork(scope[0])}>
                <KeyboardArrowLeftIcon /> 작품으로
              </button>
            </div>
          )}
        </div>
        {/* what this screen changes — always in sight */}
        <div className={`tools-mode is-${mode}`}>
          <div className="flat-group">
            <button className={`mini ${mode === 'app' ? 'on' : ''}`} onClick={() => useStore.setState({ toolsMode: 'app' })}>
              <LibraryMusicIcon /> 프로그램 내 변경
            </button>
            <button className={`mini ${mode === 'folder' ? 'on' : ''}`} onClick={() => useStore.setState({ toolsMode: 'folder' })}>
              <FolderOpenIcon /> 폴더 변경
            </button>
          </div>
          <span className="tools-mode-say">
            {mode === 'app' ? '프로그램 안의 정보만 바뀝니다. 라이브러리 폴더의 폴더 · 파일은 그대로입니다.' : '라이브러리 폴더의 폴더 · 파일이 실제로 바뀝니다. 실행 전에 확인하고, 되돌릴 수 있습니다.'}
          </span>
        </div>
        <div className="chips">
          {TABS.map(([k, label, Icon]) => (
            <button key={k} className={`chip ${tab === k ? 'active' : ''}`} onClick={() => useStore.setState({ toolsTab: k })}>
              <Icon /> {label}
            </button>
          ))}
        </div>
        <p className="hint tools-about">{ABOUT[mode][tab]}</p>
        {/* 라이브러리 스캔, then each set of options as its own group (groups
            wrap to the next line as a whole on a narrow window) */}
        {tab !== 'jobs' && !(mode === 'app' && tab === 'wav') && (
          <div className="tools-actions">
            <ScanButton busy={!!busy} onClick={() => void scanLibrary()} />
            {tab === 'rename' && <div className="flat-group">{nameOptions}</div>}
            {tab === 'rename' && (
              <div className="flat-group" title="바꿀 이름">
                <button className={`mini ${foldersOnly ? 'on' : ''}`} onClick={() => setFoldersOnly(true)}>
                  폴더 이름만
                </button>
                <button className={`mini ${foldersOnly ? '' : 'on'}`} onClick={() => setFoldersOnly(false)}>
                  트랙 및 모든 파일 이름
                </button>
              </div>
            )}
            {mode === 'folder' && tab === 'wav' && (
              <div className="flat-group" title="만들 mp3의 음질">
                {([192, 256, 320] as const).map((b) => (
                  <button key={b} className={`mini ${settings?.mp3Bitrate === b ? 'on' : ''}`} onClick={() => void save({ mp3Bitrate: b })}>
                    {b}kbps
                  </button>
                ))}
              </div>
            )}
            {mode === 'folder' && tab === 'cover' && (
              <>
                <div className="flat-group">
                  <button className={`mini ${settings?.coverSquare ? '' : 'on'}`} onClick={() => void save({ coverSquare: false })}>
                    그림 전체
                  </button>
                  <button className={`mini ${settings?.coverSquare ? 'on' : ''}`} onClick={() => void save({ coverSquare: true })}>
                    정사각형 자르기
                  </button>
                </div>
                <div className="flat-group">
                  <button
                    className={`mini ${settings?.coverSkipExisting ? 'on' : ''}`}
                    title="이미 커버가 있는 mp3는 목록에서 빼기"
                    onClick={() => void save({ coverSkipExisting: !settings?.coverSkipExisting }).then(() => items && plan())}
                  >
                    커버 있는 파일 제외
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {running && tab !== 'jobs' && (
          <div className="scan-line">
            <span>
              {job.label} {job.total ? `${Math.floor(job.done)} / ${job.total}` : ''}
            </span>
            <div className="bar">
              <div style={{ width: job.total ? `${(job.done / job.total) * 100}%` : '30%' }} />
            </div>
          </div>
        )}
      </div>

      {tab === 'jobs' && <Jobs />}
      {mode === 'app' && tab === 'rename' && <NamesApp scope={scope} kind={appNameKind} foldersOnly={foldersOnly} tick={tick} />}
      {mode === 'app' && tab === 'dlsite' && <DlsiteApp scope={scope} />}
      {mode === 'app' && tab === 'subs' && <SubsApp key={String(scope)} scope={scope} tick={tick} />}
      {mode === 'app' && tab === 'subs' && <SubsRestore scope={scope} />}
      {mode === 'app' && tab === 'cover' && <CoverApp scope={scope} />}
      {mode === 'app' && tab === 'wav' && <FolderOnly />}
      {mode === 'folder' && tab !== 'jobs' && !items && busy !== 'plan' && busy !== 'scan' && (
        <p className="hint tools-empty">라이브러리 스캔을 누르면 바꿀 것을 작품별로 보여 줍니다. 아무것도 바뀌지 않습니다.</p>
      )}
      {mode === 'folder' && items && (
        <>
          <div className="tools-summary">
            <span>{shown.length ? summary() : '바꿀 파일이 없습니다.'}</span>
            <span className="grow" />
            {shown.length > 0 && (
              <button className="btn primary" disabled={!chosen.length || !!busy} onClick={() => setAsk(true)}>
                선택한 {chosen.length}개 실행
              </button>
            )}
          </div>
          {byWork.map(([id, g]) => {
            const ids = g.list.filter(selectable).map((x) => x.id)
            const all = ids.length > 0 && ids.every((x) => on.has(x))
            return (
              <section key={id} className="tgroup">
                <label className="tgroup-head check">
                  <input type="checkbox" checked={all} disabled={!ids.length} onChange={(e) => toggle(ids, e.target.checked)} />
                  <span className="tgroup-title">{g.title}</span>
                  <span className="hint">{total(g.list.length, verb)}</span>
                  <FolderButton path={rootOf(id)} />
                </label>
                {g.list.map((it) => (
                  <label key={it.id} className={`trow-tool ${selectable(it) ? '' : 'off'}`}>
                    <input type="checkbox" checked={on.has(it.id)} disabled={!selectable(it)} onChange={(e) => toggle([it.id], e.target.checked)} />
                    <Row tab={tab} it={it} root={rootOf(id)} onEdit={tab === 'rename' ? (n) => editName(it as RenameItem, n) : undefined} />
                  </label>
                ))}
              </section>
            )
          })}
          {tab === 'cover' && <CoverChoices scope={scope} onChange={() => void plan()} />}
          <OtherWorks list={inScope.filter((w) => !byWork.some(([id]) => id === w.id) && !(tab === 'cover' && w.covers.folder && w.covers.dlsite))} why={() => NOTHING[tab]} />
        </>
      )}
      {tab !== 'jobs' && <History list={history} reload={reloadHistory} />}
      {ask && (
        <Confirm
          title="파일을 바꿀까요?"
          body={
            <>
              {summary()}
              <br />
              {tab === 'wav' ? 'wav 파일은 휴지통으로 갑니다.' : '실행 후 기록에서 되돌릴 수 있습니다.'}
            </>
          }
          ok="실행"
          onCancel={() => setAsk(false)}
          onOk={() => void run()}
        />
      )}
    </div>
  )
}
