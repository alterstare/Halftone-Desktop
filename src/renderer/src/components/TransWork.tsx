import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { TransProject, Work } from '../../../shared/types'
import { useStore } from '../store'
import { useLock } from '../lock'
import { workLanguage } from '../util'
import { langCategory } from '../../../shared/lang'
import { getImages } from '../images'
import { editedSrcs } from '../translate'
import Thumb from './Thumb'
import Dropdown from './Dropdown'
import Caret from './Caret'
import ConfirmModal from './ConfirmModal'
import WorkTransEditor from './WorkTransEditor'
import CharacterMemo from './CharacterMemo'
import { AddIcon, CloseIcon, SearchIcon } from './icons'

// 번역 편집기 mode: the list of works brought into the translation editor, with
// their progress (pages edited), resume page, export and done state. Works are
// added from a library picker; exporting keeps them on the list, and "작업 중만"
// hides the ones marked done.

const fmt = (t?: number): string => {
  if (!t) return ''
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Edited pages / total pages for one work (edits are keyed by page src).
function useProgress(workId: string, token: number): { edited: number; total: number } | null {
  const [p, setP] = useState<{ edited: number; total: number } | null>(null)
  useEffect(() => {
    let alive = true
    void Promise.all([getImages(workId), editedSrcs()]).then(([srcs, ed]) => {
      if (alive) setP({ edited: srcs.filter((s) => ed.has(s)).length, total: srcs.length })
    })
    return () => {
      alive = false
    }
  }, [workId, token])
  return p
}

function ProjectRow({
  p,
  work,
  token,
  onOpen,
  onExport
}: {
  p: TransProject
  work: Work | undefined
  token: number
  onOpen: () => void
  onExport: (kind: 'image' | 'text') => void
}): JSX.Element {
  const update = useStore((s) => s.updateTransProject)
  const remove = useStore((s) => s.removeTransProject)
  const prog = useProgress(p.workId, token)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [memoOpen, setMemoOpen] = useState(false)
  const hasMemo = useStore((s) => !!s.settings.transMemos?.[p.workId])

  if (!work)
    return (
      <div className="work-card tw-card missing">
        <div className="work-info">
          <span className="work-title">라이브러리에서 찾을 수 없는 작품</span>
          <div className="work-actions">
            <button className="mini danger" onClick={() => remove(p.workId)}>
              목록에서 제거
            </button>
          </div>
        </div>
      </div>
    )

  return (
    <div className="work-card-wrap">
      <div className="work-card tw-card" onClick={onOpen}>
        <Thumb workId={work.id} />
        <div className="work-info">
          <div className="work-title-row">
            <span className={`tw-status ${p.done ? 'done' : ''}`}>{p.done ? '완료' : '작업 중'}</span>
            <span className="work-title">{workLabel(work)}</span>
          </div>
          <div className="work-meta">
            {work.pageCount}p{work.code ? ` · [${work.code}]` : ''}
            {workLanguage(work) ? ` · ${workLanguage(work)}` : ''}
            {` · ${(work.library ?? 'doujin') === 'normal' ? '일반 만화' : '동인지'}`}
          </div>
          <div className="work-meta tw-progress">
            {prog ? (
              <>
                편집한 페이지 <b>{prog.edited}</b> / {prog.total}
                <span className="tw-bar">
                  <span style={{ width: `${prog.total ? (prog.edited / prog.total) * 100 : 0}%` }} />
                </span>
              </>
            ) : (
              '…'
            )}
            {` · 마지막 작업 ${fmt(p.updatedAt)}`}
            {p.exportedAt ? ` · 내보냄 ${fmt(p.exportedAt)}` : ''}
          </div>
          <div className="work-actions" onClick={(e) => e.stopPropagation()}>
            <button className="mini" onClick={onOpen}>
              {p.lastPage > 0 ? `이어서 편집 (${p.lastPage + 1}쪽)` : '편집'}
            </button>
            <button className="mini" onClick={() => setMemoOpen(true)}>
              {hasMemo ? '인물 메모 (작성됨)' : '인물 메모'}
            </button>
            <button className="mini" onClick={() => onExport('image')}>
              이미지 내보내기
            </button>
            <button className="mini" onClick={() => onExport('text')}>
              텍스트 내보내기
            </button>
            <button className="mini" onClick={() => update(p.workId, { done: !p.done })}>
              {p.done ? '작업 중으로 표시' : '완료로 표시'}
            </button>
            <button className="mini danger" onClick={() => setConfirmRemove(true)}>
              목록에서 제거
            </button>
          </div>
        </div>
      </div>
      {memoOpen && <CharacterMemo work={work} onClose={() => setMemoOpen(false)} />}
      {confirmRemove && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmModal
            title="목록에서 제거할까요?"
            desc="번역 편집기 목록에서만 빠집니다. 편집한 번역 내용과 작품은 그대로 남습니다."
            confirmLabel="제거"
            cancelLabel="취소"
            onConfirm={() => {
              setConfirmRemove(false)
              remove(p.workId)
            }}
            onCancel={() => setConfirmRemove(false)}
          />
        </div>
      )}
    </div>
  )
}

// Picker sort: field + direction (remembered while the app runs).
type PickSort = 'viewed' | 'recent' | 'title' | 'artist' | 'rank' | 'views' | 'pages'
const PICK_SORTS: readonly (readonly [PickSort, string])[] = [
  ['viewed', '최근 본'],
  ['recent', '최신순'],
  ['title', '이름순'],
  ['artist', '작가순'],
  ['rank', '평점순'],
  ['views', '감상 횟수순'],
  ['pages', '페이지 수']
]
// Ascending comparators; 'desc' reverses. Text sorts default to A→Z, the rest
// to biggest / newest first.
const PICK_CMP: Record<PickSort, (a: Work, b: Work) => number> = {
  viewed: (a, b) => (a.lastViewedAt ?? 0) - (b.lastViewedAt ?? 0),
  recent: (a, b) => (a.addedAt || a.mtime) - (b.addedAt || b.mtime),
  title: (a, b) => workLabel(a).localeCompare(workLabel(b), 'ko', { numeric: true }),
  artist: (a, b) => (a.artist ?? '\uffff').localeCompare(b.artist ?? '\uffff', 'ko'),
  rank: (a, b) => a.rank - b.rank,
  views: (a, b) => a.viewCount - b.viewCount,
  pages: (a, b) => a.pageCount - b.pageCount
}
const defaultDir = (s: PickSort): 'asc' | 'desc' => (s === 'title' || s === 'artist' ? 'asc' : 'desc')
type PickLang = 'all' | 'english' | 'japanese' | 'other'
const PICK_LANGS: readonly (readonly [PickLang, string])[] = [
  ['all', '전체'],
  ['english', '영어'],
  ['japanese', '일본어'],
  ['other', '기타 언어']
]
let lastPick: { sort: PickSort; dir: 'asc' | 'desc'; lang: PickLang } = { sort: 'viewed', dir: 'desc', lang: 'all' }

// General-manga chapters are titled just "14화" — prefix the series folder so
// the picker / list says which work it is.
export function workLabel(w: Work): string {
  if ((w.library ?? 'doujin') !== 'normal') return w.title
  const parent = w.path.split(/[\\/]/).filter(Boolean).slice(-2)[0]
  return parent && parent !== w.title ? `${parent} › ${w.title}` : w.title
}

// Library picker: search every local work and add it to the list.
function Picker({ onClose }: { onClose: () => void }): JSX.Element {
  const works = useStore((s) => s.works)
  const projects = useStore((s) => s.settings.transProjects ?? [])
  const add = useStore((s) => s.addTransProjects)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<PickSort>(lastPick.sort)
  const [dir, setDir] = useState<'asc' | 'desc'>(lastPick.dir)
  const [lang, setLang] = useState<PickLang>(lastPick.lang)
  lastPick = { sort, dir, lang }
  const listed = useMemo(() => new Set(projects.map((p) => p.workId)), [projects])
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase()
    const pool = works.filter((w) => {
      const wl = workLanguage(w)
      // General manga has no scanned language: only works the user tagged with one.
      if ((w.library ?? 'doujin') === 'normal' && !wl) return false
      const c = langCategory(wl)
      if (c === 'korean') return false // already Korean: nothing to translate
      if (lang === 'all') return true
      return lang === 'other' ? c === 'other' : c === lang
    })
    const all = t
      ? pool.filter((w) =>
          [workLabel(w), w.code, w.artist, workLanguage(w)].some((v) => (v ?? '').toString().toLowerCase().includes(t))
        )
      : pool
    const cmp = PICK_CMP[sort]
    return [...all].sort((a, b) => (dir === 'asc' ? cmp(a, b) : cmp(b, a)))
  }, [works, q, sort, dir, lang])

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal tw-picker" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>번역할 작품 추가</h2>
          <button className="modal-x" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="tw-search-row">
          <Dropdown<PickSort>
            className="field"
            value={sort}
            options={PICK_SORTS}
            onChange={(s) => {
              setSort(s)
              setDir(defaultDir(s))
            }}
          />
          <div className="tw-search">
            <SearchIcon />
            <input
              autoFocus
              value={q}
              placeholder="제목·코드·작가로 검색"
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <button
            className="mini tw-dir"
            onClick={() => setDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            title={dir === 'asc' ? '오름차순' : '내림차순'}
          >
            <Caret up={dir === 'asc'} />
          </button>
        </div>
        <div className="tw-pick-list">
          {hits.length === 0 && <div className="hint">검색 결과가 없습니다.</div>}
          {hits.map((w) => {
            const on = listed.has(w.id)
            return (
              <button key={w.id} className={`tw-pick-row ${on ? 'on' : ''}`} disabled={on} onClick={() => add([w.id])}>
                <Thumb workId={w.id} />
                <span className="tw-pick-info">
                  <span className="tw-pick-title">{workLabel(w)}</span>
                  <span className="tw-pick-meta">
                    {w.pageCount}p{w.code ? ` · [${w.code}]` : ''}
                    {workLanguage(w) ? ` · ${workLanguage(w)}` : ''}
                    {` · ${(w.library ?? 'doujin') === 'normal' ? '일반 만화' : '동인지'}`}
                  </span>
                </span>
                <span className="tw-pick-state">{on ? '추가됨' : '추가'}</span>
              </button>
            )
          })}
        </div>
        <div className="tw-pick-foot">
          <div className="flat-group">
            {PICK_LANGS.map(([v, label]) => (
              <button key={v} className={`mini ${lang === v ? 'on' : ''}`} onClick={() => setLang(v)}>
                {label}
              </button>
            ))}
          </div>
          <span className="hint">{hits.length}개</span>
          <div className="flat-group">
            <button className="mini" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function TransWork(): JSX.Element {
  const works = useStore((s) => s.works)
  const allProjects = useStore((s) => s.settings.transProjects ?? [])
  // Decoy library: only works that are visible (doujin ones are hidden).
  const decoy = useLock((s) => s.decoy)
  const projects = decoy ? allProjects.filter((p) => works.some((w) => w.id === p.workId)) : allProjects
  const marginWidth = useStore((s) => s.settings.marginWidth)
  const update = useStore((s) => s.updateTransProject)
  const exportWorkJob = useStore((s) => s.exportWorkJob)
  const exportImagesJob = useStore((s) => s.exportImagesJob)
  const goSettings = useStore((s) => s.goSettings)
  const [picking, setPicking] = useState(false)
  const [workingOnly, setWorkingOnly] = useState(false)
  const [editing, setEditing] = useState<Work | null>(null)
  const [noFolder, setNoFolder] = useState(false)
  // Bumped when the editor closes so the progress counts refresh.
  const [token, setToken] = useState(0)

  const byId = useMemo(() => new Map(works.map((w) => [w.id, w])), [works])
  const shown = useMemo(
    () => [...projects].filter((p) => !workingOnly || !p.done).sort((a, b) => b.updatedAt - a.updatedAt),
    [projects, workingOnly]
  )
  const doneCount = projects.filter((p) => p.done).length

  const exportWork = (w: Work, kind: 'image' | 'text'): void => {
    if (!useStore.getState().settings.textExportDir) return setNoFolder(true)
    update(w.id, { exportedAt: Date.now() })
    void (kind === 'image' ? exportImagesJob(w.id) : exportWorkJob(w.id, true))
  }

  return (
    <div className="home tw" style={{ ['--mw' as string]: `${marginWidth}px` }}>
      <div className="home-head">
        <div className="badge">Translation</div>
        <h1>번역 편집기</h1>
      </div>
      <div className="tw-toolbar">
        <div className="flat-group">
          <button className="mini" onClick={() => setPicking(true)}>
            <AddIcon />
            작품 추가
          </button>
          <button className={`mini ${workingOnly ? 'on' : ''}`} onClick={() => setWorkingOnly((v) => !v)}>
            작업 중만 보기
          </button>
        </div>
        <span className="tw-count">
          작품 {projects.length} · 작업 중 {projects.length - doneCount} · 완료 {doneCount}
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="tw-empty">
          {projects.length === 0
            ? '아직 불러온 작품이 없습니다. “작품 추가”로 라이브러리에서 번역할 작품을 고르세요.'
            : '작업 중인 작품이 없습니다.'}
        </div>
      ) : (
        <div className="work-list tw-list">
          {shown.map((p) => {
            const w = byId.get(p.workId)
            return (
              <ProjectRow
                key={p.workId}
                p={p}
                work={w}
                token={token}
                onOpen={() => w && setEditing(w)}
                onExport={(kind) => w && exportWork(w, kind)}
              />
            )
          })}
        </div>
      )}

      {picking && <Picker onClose={() => setPicking(false)} />}
      {editing && (
        <WorkTransEditor
          work={editing}
          onClose={() => {
            setEditing(null)
            setToken((t) => t + 1)
          }}
          onExportImages={() => exportWork(editing, 'image')}
        />
      )}
      {noFolder && (
        <ConfirmModal
          title="내보낼 폴더가 없습니다"
          desc="설정에서 내보내기 폴더를 먼저 지정하세요. (텍스트·이미지 내보내기 공통)"
          icon="📁"
          confirmLabel="설정 열기"
          cancelLabel="닫기"
          onConfirm={() => {
            setNoFolder(false)
            goSettings()
          }}
          onCancel={() => setNoFolder(false)}
        />
      )}
    </div>
  )
}
