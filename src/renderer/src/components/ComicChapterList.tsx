import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { useStore, lastReadKey } from '../store'
import { getComicChapters } from '../comic'
import type { ComicChapter } from '../../../shared/ipc'
import type { OnlineFav } from '../../../shared/types'
import Stars from './Stars'
import { SearchIcon, FavoriteIcon, AutoStoriesIcon } from './icons'
import { useComicStatus } from './useComicStatus'
import SearchClear from './SearchClear'
import { useTabState } from './useTabState'
import { useEntryProgress } from './useEntryProgress'
import { groupSeries, seriesRoots, titleKey, isOnlineTitleFav } from '../util'

// Left list shown while reading a manga-site chapter: the sibling chapters of the active
// tab's series. Mirrors the local general-manga left list (LibraryList) so the
// reader chrome is identical between local and online in general-manga mode.
export default function ComicChapterList(): JSX.Element {
  const comicStatus = useComicStatus()
  const replaceTabOnline = useStore((s) => s.replaceTabOnline)
  const onlineFavs = useStore((s) => s.onlineFavs)
  const toggleOnlineFav = useStore((s) => s.toggleOnlineFav)
  const toggleNormalUnifiedFav = useStore((s) => s.toggleNormalUnifiedFav)
  const works = useStore((s) => s.works)
  const normalRoots = useStore((s) => s.settings.normalRoots)
  const favSeries = useStore((s) => s.settings.normalFavSeries)
  const setOnlineRank = useStore((s) => s.setOnlineRank)
  const active = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const online = active?.online
  const seriesUrl = online?.seriesUrl

  // Per-chapter online favorite/rank stored in onlineFavs, keyed by chapter url —
  // gives the online reader the same 평점/즐겨찾기 controls as the local one.
  const chapterMeta = (c: ComicChapter): Partial<OnlineFav> => ({
    title: c.title,
    artist: online?.artist ?? null,
    thumbUrl: online?.thumb,
    language: null,
    pageCount: 0
  })

  const [chapters, setChapters] = useState<ComicChapter[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useTabState('input', '')
  const [applied, setApplied] = useTabState('applied', '')

  useEffect(() => {
    if (!seriesUrl) {
      setChapters([])
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    getComicChapters(seriesUrl)
      .then((c) => alive && setChapters(c))
      .catch((e) => alive && setError(String(e?.message ?? e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [seriesUrl])

  const apply = (): void => setApplied(input.trim())
  const q = applied.toLowerCase()
  const list = q ? chapters.filter((c) => c.title.toLowerCase().includes(q)) : chapters
  // Snapshot from entering the series: the chapter you had stopped at stays marked.
  const readProgress = useEntryProgress(seriesUrl)
  // Series favorite, unified with a downloaded local series of the same title —
  // same heart as the home card and the local series header.
  const seriesTitle = online?.title ?? ''
  const seriesFav = useMemo(() => {
    if (!seriesTitle) return false
    if ((seriesUrl && onlineFavs[seriesUrl]?.favorite) || isOnlineTitleFav(onlineFavs, seriesTitle)) return true
    const k = titleKey(seriesTitle)
    const fav = new Set(favSeries ?? [])
    return groupSeries(
      works.filter((w) => (w.library ?? 'doujin') === 'normal'),
      seriesRoots({ normalRoots })
    ).some((g) => fav.has(g.key) && titleKey(g.title) === k)
  }, [seriesTitle, seriesUrl, onlineFavs, favSeries, works, normalRoots])
  const lastUrl = useMemo(() => lastReadKey(readProgress, chapters.map((c) => c.url)), [readProgress, chapters])

  return (
    <div className="lib-list">
      <div className="lib-list-head">
        <span className="lib-series-label wide">
          <AutoStoriesIcon /> 시리즈 · {chapters.length}화
          {seriesUrl && seriesTitle && (
            <span className="lib-series-actions">
              <span className="seg" onClick={(e) => e.stopPropagation()}>
                <span
                  className={`seg-heart ${seriesFav ? 'on' : ''}`}
                  title="즐겨찾기"
                  onClick={() =>
                    void toggleNormalUnifiedFav({
                      title: seriesTitle,
                      url: seriesUrl,
                      meta: { title: seriesTitle, artist: online?.artist ?? null, thumbUrl: online?.thumb, language: null, pageCount: 0 }
                    })
                  }
                >
                  <FavoriteIcon filled={seriesFav} />
                </span>
              </span>
            </span>
          )}
        </span>
      </div>
      <div className="lib-search-row">
        <div className="search-ac">
          <input
            className="search sm"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && apply()}
            placeholder="검색 후 Enter"
          />
          <SearchClear value={input} onClear={() => setInput('')} />
        </div>
        <button className="mini" onClick={apply} title="검색">
          <SearchIcon />
        </button>
      </div>
      {applied && (
        <div className="applied-row">
          <span className="applied-q">“{applied}”</span>
          <span
            className="mini"
            onClick={() => {
              setInput('')
              setApplied('')
            }}
          >
            초기화
          </span>
        </div>
      )}
      <div className="lib-list-scroll compact">
        {error && <div className="warn err">{error}</div>}
        {loading && <div className="reader-loading">{comicStatus ?? '불러오는 중…'}</div>}
        {list.map((c) => {
          const fav = onlineFavs[c.url]
          return (
            <div
              key={c.url}
              className={`chapter-row ${c.url === online?.code ? 'active' : ''} ${c.url === lastUrl ? 'last-read' : ''}`}
              onClick={() =>
                active &&
                replaceTabOnline(active.id, {
                  code: c.url,
                  title: online?.title ?? c.title,
                  artist: online?.artist ?? null,
                  kind: 'comic',
                  seriesUrl,
                  chapterLabel: c.title,
                  thumb: online?.thumb
                })
              }
              title={c.title}
            >
              <div className="chapter-line">
                <span className="ch-label">{c.title}</span>
                <span className="ch-spacer" />
                <Stars rank={fav?.rank ?? 0} onChange={(r) => setOnlineRank(c.url, r, chapterMeta(c))} size={13} />
                <span
                  className={`ch-heart ${fav?.favorite ? 'on' : ''}`}
                  title="즐겨찾기"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleOnlineFav(c.url, chapterMeta(c))
                  }}
                >
                  <FavoriteIcon filled={!!fav?.favorite} />
                </span>
              </div>
            </div>
          )
        })}
        {!loading && !error && chapters.length === 0 && <div className="hint">화 목록이 없습니다.</div>}
        {chapters.length > 0 && <div className="result-count">{chapters.length}개</div>}
      </div>
    </div>
  )
}
