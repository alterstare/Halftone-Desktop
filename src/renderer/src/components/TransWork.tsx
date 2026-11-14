import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, RefObject } from 'react'
import type { TransProject, Work } from '../../../shared/types'
import { useStore } from '../store'
import { useLock } from '../lock'
import { workLanguage } from '../util'
import { langCategory } from '../../../shared/lang'
import { getImages } from '../images'
import { editedSrcs, resetWorkEdits } from '../translate'
import Thumb from './Thumb'
import Dropdown from './Dropdown'
import Caret from './Caret'
import ConfirmModal from './ConfirmModal'
import WorkTransEditor from './WorkTransEditor'
import CharacterMemo from './CharacterMemo'
import FavDlToggle from './FavDlToggle'
import { AddIcon, CheckMarkIcon, CloseIcon, EditIcon, SearchIcon, SortIcon } from './icons'

// 번역 편집기 mode: the list of works brought into the translation editor, with
// their progress (pages edited), resume page and save / export. A work is done
// once every page is edited; "작업 중" hides the done ones. Works are added from
// a library picker (the + under the list).

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

// Close a popup on a press outside its wrapper.
function useOutside(open: boolean, close: () => void): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open, close])
  return ref
}

// Language bucket used by both filters.
type Lang = 'english' | 'japanese' | 'other'
const langOf = (w: Work | undefined): Lang => {
  const c = langCategory(w ? workLanguage(w) : null)
  return c === 'english' || c === 'japanese' ? c : 'other'
}

type SaveKind = 'copy' | 'overwrite' | 'image' | 'text'
const SAVE_OPTS: readonly (readonly [SaveKind, string])[] = [
  ['copy', '사본으로 저장'],
  ['overwrite', '원본 덮어쓰기'],
  ['image', '이미지 내보내기'],
  ['text', '텍스트 내보내기']
]

// 저장 ▾: the save / export choices in a drop-down.
function SaveMenu({ onPick }: { onPick: (k: SaveKind) => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useOutside(open, () => setOpen(false))
  return (
    <div className="dropdown tw-save" ref={ref}>
      <button className={`mini ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)}>
        저장 <Caret up={open} />
      </button>
      {open && (
        <div className="dropdown-panel">
          {SAVE_OPTS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className="dropdown-opt"
              onClick={() => {
                setOpen(false)
                onPick(k)
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
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
  const saveCopyJob = useStore((s) => s.saveCopyJob)
  const overwriteJob = useStore((s) => s.overwriteJob)
  const prog = useProgress(p.workId, token)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [resetToo, setResetToo] = useState(false)
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)
  const [memoOpen, setMemoOpen] = useState(false)

  // Done = every page edited (kept in the project so 작업 중 can filter on it).
  const done = prog ? prog.total > 0 && prog.edited === prog.total : p.done
  useEffect(() => {
    if (prog && done !== p.done) update(p.workId, { done })
  }, [prog, done, p.done, p.workId, update])

  const save = (k: SaveKind): void => {
    if (k === 'copy') void saveCopyJob(p.workId)
    else if (k === 'overwrite') setConfirmOverwrite(true)
    else onExport(k)
  }

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
            <span className={`tw-status ${done ? 'done' : ''}`}>{done ? '완료' : '작업 중'}</span>
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
            {p.exportedAt ? ` · 내보내기 ${fmt(p.exportedAt)}` : ''}
          </div>
          <div className="work-actions" onClick={(e) => e.stopPropagation()}>
            <button className="mini" onClick={() => setMemoOpen(true)}>
              인물 메모
            </button>
            <button className="mini" onClick={() => void window.api.openInExplorer(work.id)}>
              폴더 열기
            </button>
            <button className="mini danger" onClick={() => setConfirmRemove(true)}>
              삭제
            </button>
            <SaveMenu onPick={save} />
          </div>
        </div>
      </div>
      {memoOpen && <CharacterMemo work={work} onClose={() => setMemoOpen(false)} />}
      {confirmOverwrite && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmModal
            title="원본을 덮어쓸까요?"
            desc="번역이 들어간 페이지의 원본 이미지를 휴지통으로 옮기고, 그 자리에 번역 이미지를 저장합니다. 편집 내용은 이미지에 합쳐지고 바뀐 페이지의 편집 기록은 지워집니다."
            confirmLabel="덮어쓰기"
            cancelLabel="취소"
            danger
            onConfirm={() => {
              setConfirmOverwrite(false)
              void overwriteJob(p.workId)
            }}
            onCancel={() => setConfirmOverwrite(false)}
          />
        </div>
      )}
      {confirmRemove && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmModal
            title="목록에서만 제거할까요?"
            desc={
              <label className="tw-check">
                <input type="checkbox" checked={resetToo} onChange={(e) => setResetToo(e.target.checked)} />
                번역 진행도 초기화
              </label>
            }
            confirmLabel="제거"
            cancelLabel="취소"
            danger
            onConfirm={() => {
              setConfirmRemove(false)
              if (resetToo) void resetWorkEdits(p.workId)
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
  artist: (a, b) => (a.artist ?? '￿').localeCompare(b.artist ?? '￿', 'ko'),
  rank: (a, b) => a.rank - b.rank,
  views: (a, b) => a.viewCount - b.viewCount,
  pages: (a, b) => a.pageCount - b.pageCount
}
const defaultDir = (s: PickSort): 'asc' | 'desc' => (s === 'title' || s === 'artist' ? 'asc' : 'desc')
const PICK_LANGS: readonly (readonly [Lang, string])[] = [
  ['english', '영어'],
  ['japanese', '일본어'],
  ['other', '기타 언어']
]
let lastPick: { sort: PickSort; dir: 'asc' | 'desc'; langs: Lang[] } = {
  sort: 'viewed',
  dir: 'desc',
  langs: ['english', 'japanese', 'other']
}

// "영어, 일본어" for the picked languages (all of them: 모든 언어).
const langSummary = (langs: readonly Lang[]): string =>
  langs.length === PICK_LANGS.length
    ? '모든 언어'
    : langs.length
      ? PICK_LANGS.filter(([v]) => langs.includes(v))
          .map(([, l]) => l)
          .join(', ')
      : '언어 없음'

// General-manga chapters are titled just "14화" — prefix the series folder so
// the picker / list says which work it is.
export function workLabel(w: Work): string {
  if ((w.library ?? 'doujin') !== 'normal') return w.title
  const parent = w.path.split(/[\\/]/).filter(Boolean).slice(-2)[0]
  return parent && parent !== w.title ? `${parent} › ${w.title}` : w.title
}

// Library picker: search every local work and add it to the list. The button at
// the search box's end (sort icon) opens the order (오름/내림차순) and language
// choices.
function Picker({ onClose }: { onClose: () => void }): JSX.Element {
  const works = useStore((s) => s.works)
  const projects = useStore((s) => s.settings.transProjects ?? [])
  const add = useStore((s) => s.addTransProjects)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<PickSort>(lastPick.sort)
  const [dir, setDir] = useState<'asc' | 'desc'>(lastPick.dir)
  const [langs, setLangs] = useState<Lang[]>(lastPick.langs)
  const [optOpen, setOptOpen] = useState(false)
  const optRef = useOutside(optOpen, () => setOptOpen(false))
  lastPick = { sort, dir, langs }
  const listed = useMemo(() => new Set(projects.map((p) => p.workId)), [projects])
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase()
    const pool = works.filter((w) => {
      const wl = workLanguage(w)
      // General manga has no scanned language: only works the user tagged with one.
      if ((w.library ?? 'doujin') === 'normal' && !wl) return false
      if (langCategory(wl) === 'korean') return false // already Korean: nothing to translate
      return langs.includes(langOf(w))
    })
    const all = t
      ? pool.filter((w) =>
          [workLabel(w), w.code, w.artist, workLanguage(w)].some((v) => (v ?? '').toString().toLowerCase().includes(t))
        )
      : pool
    const cmp = PICK_CMP[sort]
    return [...all].sort((a, b) => (dir === 'asc' ? cmp(a, b) : cmp(b, a)))
  }, [works, q, sort, dir, langs])

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
          <div className="tw-search" ref={optRef}>
            <SearchIcon />
            <input
              autoFocus
              value={q}
              placeholder="제목·코드·작가로 검색"
              onChange={(e) => setQ(e.target.value)}
            />
            <button
              className={`tw-opt-btn ${optOpen ? 'open' : ''}`}
              onClick={() => setOptOpen((o) => !o)}
              title="정렬 · 언어"
            >
              <SortIcon />
            </button>
            {optOpen && (
              <div className="cat-panel tw-opt-panel">
                <span className="tw-opt-label">정렬</span>
                <label>
                  <input type="checkbox" checked={dir === 'asc'} onChange={() => setDir('asc')} />
                  오름차순
                </label>
                <label>
                  <input type="checkbox" checked={dir === 'desc'} onChange={() => setDir('desc')} />
                  내림차순
                </label>
                <span className="tw-opt-label">언어</span>
                {PICK_LANGS.map(([v, label]) => (
                  <label key={v}>
                    <input
                      type="checkbox"
                      checked={langs.includes(v)}
                      onChange={(e) => setLangs((ls) => (e.target.checked ? [...ls, v] : ls.filter((l) => l !== v)))}
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}
          </div>
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
                <span className="tw-pick-state">{on ? <CheckMarkIcon /> : <AddIcon />}</span>
              </button>
            )
          })}
        </div>
        <div className="tw-pick-bar">
          총 {hits.length}개 작품 · {langSummary(langs)} · {dir === 'asc' ? '오름차순' : '내림차순'}
        </div>
      </div>
    </div>
  )
}

// Work-list order, direction, 작업 중 / 전체 and language (remembered while the
// app runs).
type ListSort = 'title' | 'updated' | 'added' | 'pages'
const LIST_SORTS: readonly (readonly [ListSort, string])[] = [
  ['title', '이름순'],
  ['updated', '최근 수정순'],
  ['added', '최근 추가순'],
  ['pages', '페이지순']
]
const LIST_LANGS: readonly (readonly ['all' | Lang, string])[] = [['all', '전체'], ...PICK_LANGS]
const listDefaultDir = (s: ListSort): 'asc' | 'desc' => (s === 'title' ? 'asc' : 'desc')
let lastList: { sort: ListSort; dir: 'asc' | 'desc'; workingOnly: boolean; lang: 'all' | Lang } = {
  sort: 'updated',
  dir: 'desc',
  workingOnly: false,
  lang: 'all'
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
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<ListSort>(lastList.sort)
  const [dir, setDir] = useState<'asc' | 'desc'>(lastList.dir)
  const [workingOnly, setWorkingOnly] = useState(lastList.workingOnly)
  const [lang, setLang] = useState<'all' | Lang>(lastList.lang)
  lastList = { sort, dir, workingOnly, lang }
  const [editing, setEditing] = useState<Work | null>(null)
  const [noFolder, setNoFolder] = useState(false)
  // Bumped when the editor closes so the progress counts refresh.
  const [token, setToken] = useState(0)

  const byId = useMemo(() => new Map(works.map((w) => [w.id, w])), [works])
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    const list = projects.filter((p) => {
      if (workingOnly && p.done) return false
      const w = byId.get(p.workId)
      if (lang !== 'all' && langOf(w) !== lang) return false
      if (!t) return true
      return !!w && [workLabel(w), w.code, w.artist].some((v) => (v ?? '').toString().toLowerCase().includes(t))
    })
    // Ascending comparators; 'desc' reverses.
    const label = (p: TransProject): string => {
      const w = byId.get(p.workId)
      return w ? workLabel(w) : ''
    }
    const cmp = (a: TransProject, b: TransProject): number => {
      if (sort === 'title') return label(a).localeCompare(label(b), 'ko', { numeric: true })
      if (sort === 'added') return a.addedAt - b.addedAt
      if (sort === 'pages') return (byId.get(a.workId)?.pageCount ?? 0) - (byId.get(b.workId)?.pageCount ?? 0)
      return a.updatedAt - b.updatedAt
    }
    return list.sort((a, b) => (dir === 'asc' ? cmp(a, b) : cmp(b, a)))
  }, [projects, byId, q, sort, dir, workingOnly, lang])
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
      <div className="tw-search-row">
        <Dropdown<ListSort>
          className="field"
          value={sort}
          options={LIST_SORTS}
          onChange={(s) => {
            setSort(s)
            setDir(listDefaultDir(s))
          }}
        />
        <div className="tw-search">
          <SearchIcon />
          <input value={q} placeholder="제목·코드·작가로 검색" onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {/* Same row as the library's (.chips): toggle · order · language chips. */}
      <div className="chips tw-toolbar">
        {/* 작업 중 ⇄ 전체 보기: the pill switch of the online toolbars (GreenTunnel). */}
        <FavDlToggle
          checked={workingOnly}
          onChange={setWorkingOnly}
          icon={<EditIcon />}
          onTitle="작업 중인 작품만 보는 중"
          offTitle="모든 작품 보는 중"
        />
        <button
          className="chip layout-toggle"
          onClick={() => setDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          title={dir === 'asc' ? '오름차순' : '내림차순'}
        >
          <Caret up={dir === 'asc'} />
        </button>
        {LIST_LANGS.map(([v, label]) => (
          <button key={v} className={`chip ${lang === v ? 'active' : ''}`} onClick={() => setLang(v)}>
            {label}
          </button>
        ))}
        <span className="tw-count">
          작품 {projects.length} · 작업 중 {projects.length - doneCount} · 완료 {doneCount}
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="tw-empty">
          {projects.length === 0
            ? '아직 불러온 작품이 없습니다. 아래 + 버튼으로 라이브러리에서 번역할 작품을 고르세요.'
            : '조건에 맞는 작품이 없습니다.'}
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
      <button className="tw-add" onClick={() => setPicking(true)} title="작품 추가">
        <AddIcon />
      </button>

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
