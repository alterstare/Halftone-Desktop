// 파일 정리 (CLAUDE.md §5.6, §5.7, §5.8): mp3 썸네일 · wav 정리 · 이름 정리
// (복구한 이름 / 번역한 이름으로 실제 바꾸기, 작품 이름 한꺼번에 번역) · 작업.
// 확인하기 builds a plan (nothing changes) → the user unticks what to keep →
// 실행 asks once more → results, history, 되돌리기.
import { useEffect, useMemo, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { useStore } from '../store'
import type { ToolTab } from '../store'
import type { CoverItem, HistoryEntry, NameStatus, ProgressEvent, RenameItem, ToolResult, WavItem } from '../../../shared/types'
import { clock } from '../format'
import { KeyboardArrowLeftIcon, AudioFileIcon, CloseIcon, DriveFileRenameOutlineIcon, EditIcon, ImageIcon, ScheduleIcon, SearchIcon, TranslateIcon, UndoIcon } from './icons'
import { Confirm } from './ui'

type Item = CoverItem | WavItem | RenameItem
const TABS: [ToolTab, string, typeof ImageIcon][] = [
  ['cover', 'mp3 썸네일', ImageIcon],
  ['wav', 'wav 정리', AudioFileIcon],
  ['rename', '이름 정리', DriveFileRenameOutlineIcon],
  ['jobs', '작업', ScheduleIcon]
]
const ABOUT: Record<ToolTab, string> = {
  cover:
    '폴더 이미지(트랙 번호가 같은 그림, 없으면 작품 표지)를 mp3 안에 앨범 커버로 넣습니다. 파일 날짜는 그대로이고, 원래 태그를 보관해 되돌릴 수 있습니다.',
  wav: '같은 폴더에서 확장자만 다른 같은 이름의 파일이 대상입니다. mp3와 길이가 같은 wav는 휴지통으로 보내고, wav만 있으면 mp3로 바꾼 뒤 길이를 확인하고 wav를 휴지통으로 보냅니다. 휴지통에서 복원할 수 있습니다.',
  rename:
    '작품 폴더와 그 안의 폴더 · 파일 이름을 실제로 바꿉니다. 복구한 이름: 압축 해제 때 깨진 일본어 이름(뷁어)을 원래 이름으로(사라진 글자는 작품 제목 · 다른 이름 · 단어 사전으로 채움). 번역한 이름: 이름 번역으로 만든 한국어 이름으로(자막 등 짝 파일도 같은 이름). 줄마다 새 이름을 고칠 수 있고, 이어 듣기 · 북마크는 그대로 남으며, 되돌릴 수 있습니다.',
  jobs: '받아쓰기 · 대본 자막 · 번역 · 이름 번역 · 파일 정리 같은 작업의 진행 상황입니다. 진행 중이거나 기다리는 작업은 멈출 수 있습니다.'
}

const mb = (n: number): string => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)}GB` : `${Math.round(n / (1 << 20))}MB`)
const name = (p: string): string => p.split(/[\\/]/).pop() ?? p
const rel = (p: string, root: string): string => (p.toLowerCase().startsWith(root.toLowerCase()) ? p.slice(root.length + 1) : p)

function defaultOn(tab: ToolTab, it: Item): boolean {
  if (tab === 'wav') return (it as WavItem).kind === 'convert' || (it as WavItem).kind === 'delete'
  if (tab === 'cover') return !!(it as CoverItem).image && !(it as CoverItem).hasCover
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
          <span className="tr-sub hint">{c.image ? rel(c.image, root) : '쓸 이미지가 없습니다'}</span>
        </span>
        <span className="tr-side">{c.hasCover && <Tag kind="warn">커버 있음 · 바꾸기</Tag>}</span>
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
        {r.filled > 0 && <Tag>글자 {r.filled}개 채움</Tag>}
        {r.unfilled > 0 && <Tag kind="warn">_ {r.unfilled}개 남음</Tag>}
        {r.problem === 'conflict' && <Tag kind="warn">같은 이름이 있어 번호 붙임</Tag>}
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

const JOB_STATE: Record<ProgressEvent['state'], string> = { queued: '기다리는 중', running: '진행 중', done: '완료', failed: '실패', cancelled: '멈춤' }

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
    <div className={`job-row ${j.state}`}>
      <span className="job-main">
        <span className="job-what">
          <Tag kind={j.state === 'failed' ? 'bad' : j.state === 'cancelled' ? 'mute' : j.state === 'done' ? 'ok' : 'warn'}>{JOB_STATE[j.state]}</Tag>
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
          <button className="mini icon" title="멈추기" onClick={() => void window.api.cancelJob(j.jobId)}>
            <CloseIcon />
          </button>
        </div>
      )}
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
      {live.length > 0 && <h2>진행 중 · {live.length}</h2>}
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

// 이름 번역 for many works at once: which works still have Japanese names
// without a translation, then one job per picked work.
function NameTranslate({ scope, onDone }: { scope: number[] | null; onDone: () => void }): JSX.Element {
  const [status, setStatus] = useState<NameStatus[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [onlyMissing, setOnlyMissing] = useState(true)
  const [busy, setBusy] = useState<'check' | 'run' | null>(null)
  useEffect(() => setStatus(null), [scope])
  const check = async (): Promise<void> => {
    setBusy('check')
    try {
      const got = await window.api.nameStatus(scope)
      setStatus(got)
      setPicked(new Set(got.filter((x) => x.missing > 0).map((x) => x.workId)))
    } finally {
      setBusy(null)
    }
  }
  const run = async (): Promise<void> => {
    setBusy('run')
    try {
      const r = await window.api.translateNamesOf([...picked], onlyMissing)
      useStore.getState().showToast(r)
    } finally {
      setBusy(null)
    }
    void useStore.getState().loadWorks()
    onDone()
    await check()
  }
  const shown = (status ?? []).filter((x) => x.total > 0)
  const all = shown.length > 0 && shown.every((x) => picked.has(x.workId))
  return (
    <section className="name-tr">
      <div className="tools-actions">
        <div className="flat-group">
          <button className="mini" disabled={!!busy} onClick={() => void check()}>
            <TranslateIcon /> {status ? '번역 상태 다시 보기' : '번역 상태 보기'}
          </button>
        </div>
        <div className="flat-group" title="번역할 이름">
          <button className={`mini ${onlyMissing ? 'on' : ''}`} onClick={() => setOnlyMissing(true)}>
            번역 안 된 이름만
          </button>
          <button className={`mini ${onlyMissing ? '' : 'on'}`} onClick={() => setOnlyMissing(false)}>
            모두 다시 번역
          </button>
        </div>
      </div>
      {status && (
        <>
          <div className="tools-summary">
            <span>
              {shown.length
                ? `일본어 이름이 있는 작품 ${shown.length}개 · 번역 안 된 이름 ${shown.reduce((n, x) => n + x.missing, 0)}개`
                : '번역할 일본어 이름이 없습니다.'}
            </span>
            <span className="grow" />
            {shown.length > 0 && (
              <button className="btn primary" disabled={!picked.size || !!busy} onClick={() => void run()}>
                선택한 작품 {picked.size}개 번역
              </button>
            )}
          </div>
          {shown.length > 0 && (
            <section className="tgroup">
              <label className="tgroup-head check">
                <input type="checkbox" checked={all} onChange={(e) => setPicked(new Set(e.target.checked ? shown.map((x) => x.workId) : []))} />
                <span className="tgroup-title">전체 선택</span>
                <span className="hint">{shown.length}</span>
              </label>
              {shown.map((x) => (
                <label key={x.workId} className="trow-tool">
                  <input
                    type="checkbox"
                    checked={picked.has(x.workId)}
                    onChange={(e) => {
                      const next = new Set(picked)
                      if (e.target.checked) next.add(x.workId)
                      else next.delete(x.workId)
                      setPicked(next)
                    }}
                  />
                  <span className="tr-main">
                    <span className="tr-name">{x.title}</span>
                  </span>
                  <span className="tr-side">
                    {x.missing ? <Tag kind="warn">번역 안 됨 {x.missing}</Tag> : <Tag kind="ok">번역 완료</Tag>}
                    <span className="hint">일본어 이름 {x.total}</span>
                  </span>
                </label>
              ))}
            </section>
          )}
          {busy === 'run' && <p className="hint">진행 상황은 작업 탭에서 작품별로 볼 수 있습니다.</p>}
        </>
      )}
    </section>
  )
}

export default function ToolsView(): JSX.Element {
  const tab = useStore((s) => s.toolsTab)
  const scope = useStore((s) => s.toolsScope)
  const works = useStore((s) => s.works)
  const job = useStore((s) => s.job)
  const settings = useStore((s) => s.settings)
  const save = useStore((s) => s.saveSettings)
  // results belong to the tab that made them: right after switching tabs the
  // old ones must not be drawn with the new tab's rows
  const [planned, setPlanned] = useState<{ tab: typeof tab; items: Item[] } | null>(null)
  const items = planned && planned.tab === tab ? planned.items : null
  // 이름 정리: repaired names, or the translated ones (이름 번역)
  const [renameMode, setRenameMode] = useState<'repair' | 'translate'>('repair')
  const [on, setOn] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'plan' | 'run' | null>(null)
  const [ask, setAsk] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const reloadHistory = (): void => void window.api.history().then(setHistory)

  useEffect(() => {
    setPlanned(null)
    reloadHistory()
  }, [tab, scope])

  const plan = async (): Promise<void> => {
    if (tab === 'jobs') return
    setBusy('plan')
    try {
      const got: Item[] = tab === 'wav' ? await window.api.planWav(scope) : tab === 'cover' ? await window.api.planCover(scope) : await window.api.planRename(scope, renameMode)
      setPlanned({ tab, items: got })
      setOn(new Set(got.filter((x) => defaultOn(tab, x)).map((x) => x.id)))
    } finally {
      setBusy(null)
    }
  }

  // a new name typed in a row (same folder; forbidden characters → full-width)
  const editName = (it: RenameItem, n: string): void => {
    const safe = n.replace(/[\\/:*?"<>|]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).replace(/[. ]+$/, '') || '_'
    const to = it.from.replace(/[^\\/]*$/, () => safe)
    setPlanned((p) => p && { ...p, items: p.items.map((x) => (x.id === it.id ? { ...(x as RenameItem), to, problem: to.length > 259 ? 'too-long' : undefined } : x)) })
    setOn((o) => new Set(o).add(it.id))
  }

  const chosen = useMemo(() => (items ?? []).filter((x) => on.has(x.id)), [items, on])
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
    for (const it of items ?? []) {
      const g = m.get(it.workId) ?? { title: it.workTitle, list: [] }
      g.list.push(it)
      m.set(it.workId, g)
    }
    return [...m.entries()]
  }, [items])
  const rootOf = (id: number): string => works.find((w) => w.id === id)?.path ?? ''
  const toggle = (ids: string[], v: boolean): void => {
    const next = new Set(on)
    ids.forEach((id) => (v ? next.add(id) : next.delete(id)))
    setOn(next)
  }
  const selectable = (it: Item): boolean => !(tab === 'wav' && (it as WavItem).kind === 'skip') && !(tab === 'cover' && !(it as CoverItem).image)

  const summary = (): string => {
    if (tab === 'wav') {
      const w = chosen as WavItem[]
      const conv = w.filter((x) => x.kind === 'convert').length
      const freed = w.reduce((n, x) => n + x.bytes, 0)
      return `mp3 변환 ${conv}개 · wav 삭제 ${w.length}개 (휴지통) · 약 ${mb(freed)} 확보${conv ? ` (변환한 mp3 크기 제외)` : ''}`
    }
    if (tab === 'cover') return `mp3 ${chosen.length}개에 썸네일 넣기`
    return `이름 ${chosen.length}개 바꾸기`
  }
  const scopeTitle = scope ? works.find((w) => w.id === scope[0])?.title ?? '선택한 작품' : '전체 라이브러리'
  const running = busy && job && job.state === 'running'

  return (
    <div className="home tools">
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
        <div className="chips">
          {TABS.map(([k, label, Icon]) => (
            <button key={k} className={`chip ${tab === k ? 'active' : ''}`} onClick={() => useStore.setState({ toolsTab: k })}>
              <Icon /> {label}
            </button>
          ))}
        </div>
        <p className="hint tools-about">{ABOUT[tab]}</p>
        {/* 확인하기, then each set of options as its own group (groups wrap
            to the next line as a whole on a narrow window) */}
        {tab !== 'jobs' && (
        <div className="tools-actions">
          <div className="flat-group">
            <button className="mini" disabled={!!busy} onClick={() => void plan()}>
              <SearchIcon /> {items ? '다시 확인' : '확인하기'}
            </button>
          </div>
          {tab === 'wav' && (
            <div className="flat-group" title="만들 mp3의 음질">
              {([192, 256, 320] as const).map((b) => (
                <button key={b} className={`mini ${settings?.mp3Bitrate === b ? 'on' : ''}`} onClick={() => void save({ mp3Bitrate: b })}>
                  {b}kbps
                </button>
              ))}
            </div>
          )}
          {tab === 'rename' && (
            <div className="flat-group" title="번역한 이름: 이름 번역으로 만든 한국어 이름(번역이 없는 이름은 복구한 이름)">
              {(
                [
                  ['repair', '복구한 이름'],
                  ['translate', '번역한 이름']
                ] as const
              ).map(([m, l]) => (
                <button key={m} className={`mini ${renameMode === m ? 'on' : ''}`} onClick={() => (setRenameMode(m), setPlanned(null))}>
                  {l}
                </button>
              ))}
            </div>
          )}
          {tab === 'cover' && (
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

      {tab === 'rename' && renameMode === 'translate' && <NameTranslate scope={scope} onDone={() => setPlanned(null)} />}
      {tab === 'jobs' && <Jobs />}
      {items && (
        <>
          <div className="tools-summary">
            <span>{items.length ? summary() : '바꿀 파일이 없습니다.'}</span>
            <span className="grow" />
            {items.length > 0 && (
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
                  <span className="hint">{g.list.length}</span>
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
