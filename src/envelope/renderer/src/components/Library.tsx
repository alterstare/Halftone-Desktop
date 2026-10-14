import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { ALL_FILTER, listenState, useStore } from '../store'
import type { LibFilter } from '../store'
import type { LibSort, WorkLang, WorkSummary } from '../../../shared/types'
import { playWork } from '../player'
import { length } from '../format'
import {
  CheckIcon,
  FavoriteIcon,
  FilterAltIcon,
  FolderOpenIcon,
  GridViewIcon,
  LibraryMusicIcon,
  PlayArrowIcon,
  SearchIcon,
  SubtitlesIcon,
  ViewListIcon
} from './icons'
import { Caret, Check, ChipMenu, Cover, Dropdown, FavButton, GroupButton, Pager, Popover, Stars, useAnchor, useNarrow } from './ui'

const CHIP_GAP = 17 // px between chips (the divider sits in the middle)
const SORTS: [LibSort, string][] = [
  ['recent', '최근 재생'],
  ['added', '추가한 날짜'],
  ['title', '제목'],
  ['code', '작품 코드'],
  ['length', '재생 시간'],
  ['rank', '별점']
]
const LANGS: [WorkLang, string][] = [
  ['ja', '일본어 원본'],
  ['ko-sub', '한국어 자막판'],
  ['ko-voice', '한국어 음성']
]

export async function addLibraryFolder(): Promise<void> {
  const dir = await window.api.pickFolder()
  if (!dir) return
  const st = useStore.getState()
  const r = await window.api.addLibraryDir(dir)
  await st.loadSettings()
  await st.loadWorks()
  st.showToast(r)
}

function passes(w: WorkSummary, f: LibFilter): boolean {
  if (f.favorites && !w.favorite) return false
  if (!f.listen[listenState(w)]) return false
  if (!f.lang[w.lang]) return false
  if (!(w.subtitled ? f.subs.with : f.subs.without)) return false
  if (f.groups) {
    const inGroup = w.groupIds.some((g) => f.groups!.includes(g))
    if (!inGroup && !(f.ungrouped && !w.groupIds.length)) return false
  }
  return true
}

// Picture shown whole (contain) over a blurred copy of itself, so covers of any
// shape fit the 4:3 frame without cropping.
export function Art({ path, children }: { path: string | null; children?: React.ReactNode }): JSX.Element {
  const url = path ? window.api.thumbUrl(path) : null
  return (
    <div className="art">
      {url ? (
        <>
          <div className="art-fill" style={{ backgroundImage: `url("${url}")` }} />
          <img src={url} loading="lazy" decoding="async" alt="" draggable={false} />
        </>
      ) : (
        <LibraryMusicIcon className="cover-ph" />
      )}
      {children}
    </div>
  )
}

function PlayButton({ w }: { w: WorkSummary }): JSX.Element {
  return (
    <button
      className="mini icon play-solid"
      title={listenState(w) === 'listening' && (useStore.getState().settings?.resume ?? true) ? '이어 듣기' : '재생'}
      onClick={(e) => {
        e.stopPropagation()
        void playWork(w.id)
      }}
    >
      <PlayArrowIcon />
    </button>
  )
}

// Code (may be cut short) · then "N트랙 · 길이" with the 자막 mark right after
// the length, kept together on one line.
function Meta({ w }: { w: WorkSummary }): JSX.Element {
  const tail = [`${w.tracks}트랙`, length(w.duration)].filter(Boolean).join(' · ')
  return (
    <>
      {w.code && <span className="meta-code">{w.code} ·&nbsp;</span>}
      <span className="meta-tail">
        {tail}
        {w.subtitled > 0 && (
          <span className="sub-badge" title={`자막 ${w.subtitled}트랙`}>
            <SubtitlesIcon />
          </span>
        )}
      </span>
    </>
  )
}

// Card: picture (with 즐겨찾기 / 그룹 on its top edge) → title → meta → 별점 · 재생.
function Tile({ w, nowId }: { w: WorkSummary; nowId?: number }): JSX.Element {
  const open = useStore((s) => s.openWork)
  const done = listenState(w) === 'done'
  return (
    <div className={`tile ${nowId === w.id ? 'now' : ''}`} onClick={() => void open(w.id)} title={w.folderTitle && w.folderTitle !== w.title ? `${w.title}\n${w.folderTitle}` : w.title}>
      <Art path={w.cover}>
        {done && (
          <span className="badge-done">
            <CheckIcon /> 완료
          </span>
        )}
        <div className={`art-tools flat-group ${w.favorite || w.groupIds.length ? 'keep' : ''}`} onClick={(e) => e.stopPropagation()}>
          <GroupButton id={w.id} groupIds={w.groupIds} />
          <FavButton id={w.id} on={w.favorite} />
        </div>
      </Art>
      <div className="tile-body">
        <div className="tile-title">{w.title}</div>
        <div className="tile-meta">
          <Meta w={w} />
        </div>
      </div>
      <div className="tile-foot">
        <Stars id={w.id} rank={w.rank} />
        <div className="flat-group" onClick={(e) => e.stopPropagation()}>
          <PlayButton w={w} />
        </div>
      </div>
    </div>
  )
}

function Row({ w, nowId }: { w: WorkSummary; nowId?: number }): JSX.Element {
  const open = useStore((s) => s.openWork)
  const st = listenState(w)
  return (
    <div className={`lrow ${nowId === w.id ? 'now' : ''}`} onClick={() => void open(w.id)}>
      <div className="lrow-cover">
        <Cover path={w.cover} />
      </div>
      <div className="lrow-main">
        <div className="lrow-title">{w.title}</div>
        <div className="lrow-meta">
          <Meta w={w} />
        </div>
      </div>
      <span className="lrow-state">
        {st === 'done' ? (
          <span className="accent">
            <CheckIcon /> 완료
          </span>
        ) : st === 'listening' ? (
          `${w.finished} / ${w.tracks}트랙`
        ) : (
          ''
        )}
      </span>
      <Stars id={w.id} rank={w.rank} />
      <div className="flat-group lrow-tools" onClick={(e) => e.stopPropagation()}>
        <span className="lrow-collect">
          <GroupButton id={w.id} groupIds={w.groupIds} />
        </span>
        <span className="lrow-collect">
          <FavButton id={w.id} on={w.favorite} />
        </span>
        <PlayButton w={w} />
      </div>
    </div>
  )
}

// "이어 듣기": works started but not finished, latest first — one row, as
// many cards as the grid fits (counted from the laid-out columns; hiding the
// rest in zero-height rows left their borders showing as a line).
function Shelf({ works, nowId }: { works: WorkSummary[]; nowId?: number }): JSX.Element | null {
  const row = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(12)
  useLayoutEffect(() => {
    const el = row.current
    if (!el) return
    const count = (): void => setCols(Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').length))
    count()
    const ro = new ResizeObserver(count)
    ro.observe(el)
    return () => ro.disconnect()
  })
  const list = works
    .filter((w) => listenState(w) === 'listening' && w.lastPlayedAt)
    .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
    .slice(0, cols)
  if (!list.length) return null
  return (
    <section className="shelf">
      <h2>이어 듣기</h2>
      <div className="shelf-row" ref={row}>
        {list.map((w) => (
          <Tile key={w.id} w={w} nowId={nowId} />
        ))}
      </div>
    </section>
  )
}

export default function Library(): JSX.Element {
  const works = useStore((s) => s.works)
  const groups = useStore((s) => s.groups)
  const query = useStore((s) => s.query)
  const setQuery = useStore((s) => s.setQuery)
  const filter = useStore((s) => s.filter)
  const setFilter = useStore((s) => s.setFilter)
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)
  const loadWorks = useStore((s) => s.loadWorks)
  const scan = useStore((s) => s.scan)
  const nowId = useStore((s) => s.now?.work.id)
  const narrow = useNarrow()
  // narrow grid: 2 columns while every card's meta line fits beside its play
  // button; once one doesn't, 1 column (until the page is wider than that)
  const homeRef = useRef<HTMLDivElement>(null)
  const [homeW, setHomeW] = useState(0)
  const [oneColBelow, setOneColBelow] = useState(0)
  useLayoutEffect(() => {
    const el = homeRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setHomeW(el.clientWidth))
    ro.observe(el)
    setHomeW(el.clientWidth)
    return () => ro.disconnect()
  })
  // columns of the grid as laid out: 2 or fewer → compact cards
  const [cols, setCols] = useState(4)
  useLayoutEffect(() => {
    const g = homeRef.current?.querySelector<HTMLElement>('.tiles, .shelf-row')
    const n = g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 4
    if (n !== cols) setCols(n)
  })
  const compactCards = cols <= 2
  const oneCol = compactCards && homeW > 0 && homeW <= oneColBelow
  useLayoutEffect(() => {
    const el = homeRef.current
    if (!el || !compactCards || oneCol) return
    // judge only the layout really on screen: compact cards in 2 columns
    const g = el.querySelector<HTMLElement>('.tiles, .shelf-row')
    if (!el.classList.contains('compact-cards') || !g || getComputedStyle(g).gridTemplateColumns.split(' ').length !== 2) return
    const cut = [...el.querySelectorAll<HTMLElement>('.tile-meta')].some((m) => {
      const code = m.querySelector<HTMLElement>('.meta-code')
      return m.scrollWidth > m.clientWidth + 1 || (!!code && code.scrollWidth > code.clientWidth + 1)
    })
    if (cut) setOneColBelow(el.clientWidth)
  })
  const filterPop = useAnchor()
  const chipsRef = useRef<HTMLDivElement>(null)
  const need = useRef(0) // width of the full chip row
  const [tight, setTight] = useState(false)
  useLayoutEffect(() => {
    const el = chipsRef.current
    if (!el) return
    const check = (): void => {
      el.style.zoom = '1'
      const kids = [...el.children] as HTMLElement[]
      const total = kids.reduce((n, k) => n + k.offsetWidth, 0) + CHIP_GAP * Math.max(0, kids.length - 1) + 4
      if (!tight) need.current = total
      // the 분류 menus fold into Filter Alt exactly when the window is small (grid ≤ 2 columns);
      // until then the full row shrinks (down to 90%) to stay on one line
      const t = narrow
      if (t !== tight) return setTight(t)
      el.style.zoom = String(Math.max(0.9, Math.min(1, el.clientWidth / total)))
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [tight, narrow])
  // typed text; the list follows on Enter / the search button (Halftone)
  const [draft, setDraft] = useState(query)
  useEffect(() => setDraft(query), [query])

  useEffect(() => {
    void loadWorks()
  }, [loadWorks, settings?.libSort, settings?.libDir, settings?.formatPref, settings?.sePref])

  const list = useMemo(() => {
    const q = query.trim().normalize('NFKC').toLowerCase()
    const text = (w: WorkSummary): string =>
      [w.code, w.title, w.folderTitle, w.circle, ...w.voices].filter(Boolean).join(' ').normalize('NFKC').toLowerCase()
    return works.filter((w) => passes(w, filter) && (!q || text(w).includes(q)))
  }, [works, query, filter])
  // pages of pageSize (Halftone); the page is kept while the list stays the
  // same (search / filters / sort / size), and goes back to 1 when it changes
  const pageSize = Math.max(1, settings?.pageSize ?? 50)
  const libPage = useStore((s) => s.libPage)
  const pageKey = JSON.stringify([query, filter, settings?.libSort, settings?.libDir, pageSize])
  const lastPage = Math.max(0, Math.ceil(list.length / pageSize) - 1)
  const page = libPage.key === pageKey ? Math.min(libPage.page, lastPage) : 0
  const shown = list.slice(page * pageSize, page * pageSize + pageSize)
  const setPage = (p: number): void => {
    useStore.setState({ libPage: { key: pageKey, page: p } })
    if (homeRef.current) homeRef.current.scrollTop = 0
  }
  const favCount = works.filter((w) => w.favorite).length
  const filtered = !!query.trim() || JSON.stringify(filter) !== JSON.stringify(ALL_FILTER)

  if (settings && !settings.libraryDirs.length)
    return (
      <div className="empty">
        <LibraryMusicIcon className="hero-icon" />
        <h2>라이브러리 폴더를 추가하세요</h2>
        <p className="hint">
          작품 폴더들이 들어 있는 폴더를 고르면 작품마다 트랙·버전·자막·이미지를 정리해서 보여줍니다. 파일은 바꾸지 않습니다.
        </p>
        <button className="btn primary" onClick={() => void addLibraryFolder()}>
          <FolderOpenIcon /> 폴더 고르기
        </button>
      </div>
    )

  const scanning = scan && (scan.state === 'running' || scan.state === 'queued')
  const layout = settings?.libLayout ?? 'grid'
  const groupActive = filter.groups !== null
  const listenChecks = (
    <>
      {(
        [
          ['new', '아직 듣지 않은 작품'],
          ['listening', '듣는 중인 작품'],
          ['done', '다 들은 작품']
        ] as const
      ).map(([k, label]) => (
        <Check key={k} checked={filter.listen[k]} onChange={(b) => setFilter({ listen: { ...filter.listen, [k]: b } })}>
          {label}
        </Check>
      ))}
    </>
  )
  const langChecks = (
    <>
      {LANGS.map(([k, label]) => (
        <Check key={k} checked={filter.lang[k]} onChange={(b) => setFilter({ lang: { ...filter.lang, [k]: b } })}>
          {label}
        </Check>
      ))}
    </>
  )
  const subsChecks = (
    <>
      <Check checked={filter.subs.with} onChange={(b) => setFilter({ subs: { ...filter.subs, with: b } })}>
        자막 있는 작품
      </Check>
      <Check checked={filter.subs.without} onChange={(b) => setFilter({ subs: { ...filter.subs, without: b } })}>
        자막 없는 작품
      </Check>
    </>
  )
  const groupChecks = (
    <>
      {groups.length === 0 && <div className="hint panel-hint">작품의 그룹 버튼으로 그룹을 만들 수 있습니다.</div>}
      {groups.map((g) => (
        <Check
          key={g.id}
          checked={filter.groups === null || filter.groups.includes(g.id)}
          onChange={(b) => {
            const cur = filter.groups ?? groups.map((x) => x.id)
            const next = b ? [...cur, g.id] : cur.filter((x) => x !== g.id)
            setFilter({ groups: next.length === groups.length && filter.ungrouped ? null : next })
          }}
        >
          {g.name} <span className="hint">{g.count}</span>
        </Check>
      ))}
      {groups.length > 0 && (
        <Check checked={filter.ungrouped} onChange={(b) => setFilter({ ungrouped: b, groups: filter.groups ?? groups.map((x) => x.id) })}>
          그룹 없는 작품
        </Check>
      )}
    </>
  )
  const listenActive = !Object.values(filter.listen).every(Boolean)
  const langActive = !Object.values(filter.lang).every(Boolean)
  const subsActive = !(filter.subs.with && filter.subs.without)
  const filterChips = (
    <>
      <ChipMenu label="듣기 상태" active={listenActive}>
        {listenChecks}
      </ChipMenu>
      <ChipMenu label="언어 분류" active={langActive}>
        {langChecks}
      </ChipMenu>
      <ChipMenu label="자막" active={subsActive}>
        {subsChecks}
      </ChipMenu>
      <ChipMenu label="그룹 분류" active={groupActive}>
        {groupChecks}
      </ChipMenu>
    </>
  )
  const anyFilter = listenActive || langActive || subsActive || groupActive
  return (
    <div className={`home ${oneCol ? 'one-col' : ''} ${compactCards ? 'compact-cards' : ''}`} ref={homeRef}>
      <div className="home-head">
        <div className="badge">Voice</div>
        <h1>라이브러리</h1>
        <div className="search-row">
          {!tight && (
            <Dropdown<LibSort>
              value={settings?.libSort ?? 'recent'}
              options={SORTS}
              onChange={(v) => void saveSettings({ libSort: v })}
              title="정렬"
            />
          )}
          {/* htmlFor: the input is the label's control (not the filter button) */}
          <label className="search" htmlFor="lib-search">
            {tight ? (
              <button
                className={`search-filter ${anyFilter ? 'on' : ''} ${filterPop.open ? 'open' : ''}`}
                title="분류 (듣기 상태 · 언어 · 자막 · 그룹)"
                onClick={(e) => (e.preventDefault(), filterPop.toggle(e.currentTarget))}
              >
                <FilterAltIcon />
              </button>
            ) : (
              <SearchIcon />
            )}
            <input
              id="lib-search"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                if (!e.target.value) setQuery('')
              }}
              onKeyDown={(e) => e.key === 'Enter' && setQuery(draft.trim())}
              placeholder="검색 후 Enter"
              spellCheck={false}
            />
          </label>
          <button className="search-go" title="검색 (Enter)" onClick={() => setQuery(draft.trim())}>
            <SearchIcon />
          </button>
        </div>
        <div className="chips" ref={chipsRef}>
          <button
            className="chip icon"
            title={layout === 'grid' ? '격자형' : '목록형'}
            onClick={() => void saveSettings({ libLayout: layout === 'grid' ? 'list' : 'grid' })}
          >
            {layout === 'grid' ? <GridViewIcon /> : <ViewListIcon />}
          </button>
          <button
            className="chip icon chip-arrow"
            title={settings?.libDir === 'asc' ? '오름차순' : '내림차순'}
            onClick={() => void saveSettings({ libDir: settings?.libDir === 'asc' ? 'desc' : 'asc' })}
          >
            <Caret up={settings?.libDir === 'asc'} />
          </button>
          <button className={`chip ${!filtered ? 'active' : ''}`} onClick={() => (setFilter(ALL_FILTER), setQuery(''), setDraft(''))}>
            전체 {works.length}
          </button>
          <button className={`chip ${filter.favorites ? 'active' : ''}`} onClick={() => setFilter({ favorites: !filter.favorites })}>
            <FavoriteIcon className="fav-ico" /> 즐겨찾기 {favCount}
          </button>
          {!tight && filterChips}
        </div>
        {tight && filterPop.anchor && (
          <Popover anchor={filterPop.anchor} closing={filterPop.closing} onClose={filterPop.close}>
            <div className="filter-pop">
              {tight && (
                <section>
                  <h4>정렬</h4>
                  {SORTS.map(([v, l]) => (
                    <button
                      key={v}
                      className={`dd-opt ${(settings?.libSort ?? 'recent') === v ? 'on' : ''}`}
                      onClick={() => void saveSettings({ libSort: v })}
                    >
                      {l}
                    </button>
                  ))}
                </section>
              )}
              <section>
                <h4>듣기 상태</h4>
                {listenChecks}
              </section>
              <section>
                <h4>언어 분류</h4>
                {langChecks}
              </section>
              <section>
                <h4>자막</h4>
                {subsChecks}
              </section>
              <section>
                <h4>그룹 분류</h4>
                {groupChecks}
              </section>
            </div>
          </Popover>
        )}
      </div>
      {scanning && (
        <div className="scan-line">
          <span>라이브러리 스캔 {scan.total ? `${scan.done} / ${scan.total}` : ''}</span>
          <div className="bar">
            <div style={{ width: scan.total ? `${(scan.done / scan.total) * 100}%` : '30%' }} />
          </div>
        </div>
      )}
      {!filtered && <Shelf works={works} nowId={nowId} />}
      {filtered || works.some((w) => listenState(w) === 'listening') ? (
        <h2 className="list-head">{filtered ? `작품 ${list.length}` : '모든 작품'}</h2>
      ) : null}
      {list.length ? (
        layout === 'grid' ? (
          <div className="tiles">
            {shown.map((w) => (
              <Tile key={w.id} w={w} nowId={nowId} />
            ))}
          </div>
        ) : (
          <div className="lrows">
            {shown.map((w) => (
              <Row key={w.id} w={w} nowId={nowId} />
            ))}
          </div>
        )
      ) : (
        <div className="empty small hint">
          {filtered ? '조건에 맞는 작품이 없습니다.' : scanning ? '작품을 찾는 중입니다…' : '작품이 없습니다.'}
        </div>
      )}
      {list.length > pageSize && <Pager page={page} lastPage={lastPage} onPage={setPage} />}
      {list.length > 0 && (
        <div className="result-count">
          작품 {list.length}개 · {pageSize}개씩
        </div>
      )}
    </div>
  )
}
