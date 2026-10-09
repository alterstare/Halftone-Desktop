// One reader pane (a tab, or one side of a split tab) for a local work or an
// online gallery/chapter. Three modes:
//   scroll — virtualized vertical strip (only a window of pages is mounted;
//            spacers use measured / estimated page heights)
//   paged  — one page, click/keys/wheel to flip
//   spread — two pages side by side
// plus fit modes and Ctrl+wheel zoom (anchored at the cursor), page
// translation overlay, chapter navigation (general manga, local + manga-site) and
// continuous reading into the next/previous work of the left list.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore, useSeriesRoots } from '../store'
import { getImages, getOnlineImages, reloadOnlineImages } from '../images'
import { getComicChapters } from '../comic'
import { analyzeSeries, seriesOf, splitArtists, workLanguage } from '../util'
import type { ComicChapter } from '../../../shared/ipc'
import type { FitMode } from '../../../shared/types'
import { filterExcluded, getExcluded, hasExclusions } from '../exclude'
import { langCategory } from '../../../shared/lang'
import TranslatedImage from './TranslatedImage'
import { FIT_TEXT, FIT_ICON, FIT_ORDER, SCROLL_FIT_ORDER, fitStyle, fitHeight } from './reader/fit'
import { prefetchOrdered } from './reader/prefetch'
import PageSlot from './reader/PageSlot'
import { useComicStatus } from './useComicStatus'
import { comboFromEvent, shortcutCombos } from '../../../shared/shortcuts'
import { DownloadIcon, ScrollModeIcon, PageModeIcon, SpreadModeIcon, TranslateIcon, ArrowBackIcon, FolderOpenIcon, CheckMarkIcon, KeyboardArrowLeftIcon, KeyboardArrowRightIcon, RefreshIcon, ArrowUpIcon, PageGapIcon, CoverSingleIcon, WheelFlipOnIcon, WheelFlipOffIcon, ClickLeftIcon, ClickRightIcon, NextRightIcon, NextLeftIcon, FocusLevelIcon } from './icons'

// (tab, pane, work) combos whose view was already counted this session, so a
// re-render / remount of the same open work doesn't bump viewCount again.
const counted = new Set<string>()


// One button in the reader's option row: icon over the name. The current value
// shows through the icon / accent colour; on hover the icon steps aside and the
// value appears next to it in words.
function OptBtn(props: {
  icon: JSX.Element
  label: string
  state: string
  on?: boolean
  title: string
  onClick: () => void
}): JSX.Element {
  return (
    <button className={`mini opt-btn ${props.on ? 'on' : ''}`} onClick={props.onClick} title={props.title}>
      <span className="opt-top">
        {props.icon}
        <span className="opt-state">{props.state}</span>
      </span>
      <span className="btn-label">{props.label}</span>
    </button>
  )
}

// 포커스 모드: the reader was actually used (wheel / click / page key) → hide
// the chrome. Module-level so it's one stable listener reference.
function startReading(): void {
  const st = useStore.getState()
  if ((st.settings.focusMode ?? 0) > 0 && st.view === 'reader') st.setFocusHidden(true)
}

// First page of the two-page spread that contains `idx`. With the cover shown on
// its own, spreads are [0], [1,2], [3,4], …; otherwise pairs start wherever the
// reader is (unchanged behaviour: the slider can still shift the pairing).
function spreadStart(idx: number, coverSingle: boolean): number {
  if (!coverSingle) return idx
  return idx <= 0 ? 0 : idx - ((idx - 1) % 2)
}

// Page index one flip forward/back from `idx` in the given mode.
function flipTarget(idx: number, dir: 1 | -1, mode: string, coverSingle: boolean): number {
  if (mode !== 'spread') return idx + dir
  if (!coverSingle) return idx + 2 * dir
  const st = spreadStart(idx, true)
  if (dir > 0) return st === 0 ? 1 : st + 2
  return st <= 1 ? st - 1 : st - 2 // [1,2] → cover; cover → previous work
}

export default function Reader({
  tabId,
  side = 'left'
}: {
  tabId: string
  side?: 'left' | 'right'
}): JSX.Element {
  const comicStatus = useComicStatus()
  const tab = useStore((s) => s.tabs.find((t) => t.id === tabId))
  // Which work/online this pane shows depends on the side of the (split) tab.
  const paneWorkId = side === 'right' ? tab?.rightWorkId : tab?.workId
  const paneOnline = side === 'right' ? tab?.rightOnline : tab?.online
  const savedScroll = (side === 'right' ? tab?.rightScrollTop : tab?.scrollTop) ?? 0
  const work = useStore((s) => s.works.find((w) => w.id === paneWorkId))
  const setTabScroll = useStore((s) => s.setTabScroll)
  const setTabRightScroll = useStore((s) => s.setTabRightScroll)
  const upsertWork = useStore((s) => s.upsertWork)
  const startDownload = useStore((s) => s.startDownload)
  // Reading mode + zoom are per-tab (per-pane): each tab keeps its own; a freshly
  // opened tab inherited the last-viewed tab's at creation. Mode reads straight
  // off the tab (reactive); zoom is local but seeded from / synced to the tab.
  const defaultMode = useStore((s) => s.settings.readerMode)
  const lastReaderMode = useStore((s) => s.settings.lastReaderMode)
  const setLastReaderMode = useStore((s) => s.setLastReaderMode)
  const lastFit = useStore((s) => s.settings.lastFit)
  const setLastFit = useStore((s) => s.setLastFit)
  const setLastZoom = useStore((s) => s.setLastZoom)
  const spreadNextSide = useStore((s) => s.settings.spreadNextSide)
  const coverSingle = useStore((s) => s.settings.spreadCoverSingle === true)
  const wheelFlip = useStore((s) => s.settings.pagedWheelFlip === true)
  const focusMode = useStore((s) => s.settings.focusMode ?? 0)
  const patchSettings = useStore((s) => s.patchSettings)
  // Bottom bar's extra option row (keyboard-arrow toggle at its left end).
  const [barOpen, setBarOpen] = useState(false)
  // Click-paging hint arrows: only until the reader is first used (wheel /
  // click / page key) after opening a work; never again for that work.
  const [hintsGone, setHintsGone] = useState(false)
  const pagedFlipSide = useStore((s) => s.settings.pagedFlipSide)
  const setTabReader = useStore((s) => s.setTabReader)
  const markRead = useStore((s) => s.markRead)
  // Which library this pane belongs to (manga-site online = general-manga). Used to
  // restore + remember the reader mode separately for doujin vs general-manga.
  const libMode: 'doujin' | 'normal' = paneOnline
    ? paneOnline.kind === 'comic'
      ? 'normal'
      : 'doujin'
    : ((work?.library ?? 'doujin') as 'doujin' | 'normal')
  // Tab's own mode wins (set while reading); else this library's last-used mode;
  // else the global default.
  const mode =
    (side === 'right' ? tab?.rightReaderMode : tab?.readerMode) ??
    lastReaderMode?.[libMode] ??
    defaultMode
  const setMode = (m: 'scroll' | 'paged' | 'spread'): void => {
    setTabReader(tabId, side, { readerMode: m })
    setLastReaderMode(libMode, m) // persist per-library, survives restart
  }
  // Fit mode (page sizing). Tab's own value wins, else this library's last-used,
  // else contain. Persisted per library, survives restart.
  const storedFit: FitMode = (side === 'right' ? tab?.rightFit : tab?.fit) ?? lastFit?.[libMode] ?? 'contain'
  const fit: FitMode =
    mode === 'scroll' && !SCROLL_FIT_ORDER.includes(storedFit)
      ? storedFit === 'cover'
        ? 'width'
        : 'height'
      : storedFit
  const fitOrder = mode === 'scroll' ? SCROLL_FIT_ORDER : FIT_ORDER
  // Spread + cover: natural aspect (h/w) of the shown pages, to size them by hand.
  const [spreadRatios, setSpreadRatios] = useState<Record<string, number>>({})
  const onlineProgress = useStore((s) => s.onlineProgress)
  const setOnlineProgress = useStore((s) => s.setOnlineProgress)
  const reloadNonce = useStore((s) => s.reloadNonce)
  const pageGap = useStore((s) => s.settings.readerPageGap)
  const works = useStore((s) => s.works)
  const seriesRootList = useSeriesRoots()
  const chapterScheme = useStore((s) => s.settings.normalChapterScheme)
  const replaceTabWork = useStore((s) => s.replaceTabWork)
  const replaceTabOnline = useStore((s) => s.replaceTabOnline)
  const searchComicAuthor = useStore((s) => s.searchComicAuthor)
  const goBack = useStore((s) => s.goBack)
  const continueReading = useStore((s) => s.continueReading)
  const clearStartAtBottom = useStore((s) => s.clearStartAtBottom)
  const readingQueue = useStore((s) => s.readingQueue)

  const contentRef = useRef<HTMLDivElement>(null)
  const edgeAccum = useRef(0) // scroll mode: overscroll past an edge → continue
  const pendingBottomRef = useRef(false) // land on the last page after a backward continue
  // Cursor anchor for the next zoom step: keeps the point under the mouse fixed.
  const pendingZoom = useRef<{ cx: number; cy: number; ratio: number } | null>(null)
  // Virtualized scroll: measured page heights + a tick to re-render spacers.
  const heightsRef = useRef<number[]>([])
  const bumpRaf = useRef(0)
  const pageIdxRef = useRef(0)
  const goToPageRef = useRef<(i: number) => void>(() => {})
  const wheelAccum = useRef(0) // paged mode: accumulated wheel delta → page steps
  const wheelRaf = useRef(0)
  const saveTimer = useRef(0)
  const [, setTick] = useState(0)
  const [images, setImages] = useState<string[]>([])
  const [loadingImgs, setLoadingImgs] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [dlDone, setDlDone] = useState(false)
  const [pageIdx, setPageIdx] = useState(0)
  // Seed zoom from the tab (keyed remount per tab+side guarantees this runs once
  // per tab); else this library's last-used zoom; else 1. prev/next reuse the
  // same instance so zoom carries over.
  const [zoom, setZoom] = useState(() => {
    const st = useStore.getState()
    const t = st.tabs.find((x) => x.id === tabId)
    return (side === 'right' ? t?.rightZoom : t?.zoom) ?? st.settings.lastZoom?.[libMode] ?? 1
  })
  const [pane, setPane] = useState({ w: 800, h: 600 })
  const [translate, setTranslate] = useState(false)

  const online = paneOnline
  const key = online ? `online:${online.code}` : paneWorkId

  // New work → show the click-paging hint arrows again.
  useEffect(() => setHintsGone(false), [key])
  // Reset translation toggle when switching works.
  useEffect(() => setTranslate(false), [key])

  // Translate button shows when the work isn't Korean (online language unknown
  // → also offer). langHint feeds Papago's source language.
  const langHint = online ? undefined : (work && workLanguage(work)) ?? undefined
  const canTranslate = online ? true : langCategory((work && workLanguage(work)) ?? null) !== 'korean'

  // General-manga chapter navigation: prev/next within the same series.
  const isNormalWork = !!work && (work.library ?? 'doujin') === 'normal'
  const chapters = useMemo(() => {
    if (!isNormalWork || !work) return []
    const roots = seriesRootList
    const group = seriesOf(work, works, roots)
    return analyzeSeries(group.chapters, group.title, chapterScheme).map((ci) => ci.work)
  }, [isNormalWork, work, works, seriesRootList, chapterScheme])
  const chIdx = work ? chapters.findIndex((c) => c.id === work.id) : -1
  const goChapter = (delta: number): void => {
    const n = chapters[chIdx + delta]
    if (n) replaceTabWork(tabId, side, n.id)
  }

  // Online (manga-site) chapter navigation: same series' sibling chapters, loaded in
  // place (same tab) via the shared chapter cache. Left pane only.
  const [comicChs, setComicChs] = useState<ComicChapter[]>([])
  useEffect(() => {
    const su = online?.kind === 'comic' ? online.seriesUrl : undefined
    if (!su) {
      setComicChs([])
      return
    }
    let alive = true
    getComicChapters(su)
      .then((c) => alive && setComicChs(c))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [online?.kind, online?.seriesUrl])
  const comicIdx = online ? comicChs.findIndex((c) => c.url === online.code) : -1
  const goComicChapter = (delta: number): boolean => {
    const n = comicChs[comicIdx + delta]
    if (n && online) {
      replaceTabOnline(tabId, {
        code: n.url,
        title: online.title,
        artist: online.artist,
        kind: 'comic',
        seriesUrl: online.seriesUrl,
        chapterLabel: n.title,
        thumb: online.thumb
      })
      return true
    }
    return false
  }
  const goComicChapterRef = useRef(goComicChapter)
  goComicChapterRef.current = goComicChapter

  // Zoom-scaled pane box (px), the basis for every fit-mode size calculation.
  const sw = Math.max(1, Math.round(pane.w * zoom))
  const sh = Math.max(1, Math.round(pane.h * zoom))
  // Page height before a page is measured. Prefer a measured height, else derive
  // it from the decoded aspect ratio (ratioRef) under the current fit mode, else
  // the pane-fit upper bound.
  const estH = Math.max(40, sh)
  const ratioRef = useRef<number[]>([]) // naturalHeight / naturalWidth per page
  const heightOf = useCallback(
    (i: number): number =>
      heightsRef.current[i] ||
      (ratioRef.current[i] ? Math.round(fitHeight(fit, ratioRef.current[i], sw, sh)) : estH),
    [fit, sw, sh, estH]
  )

  // The prefetcher reports each decoded page's natural size; store the aspect
  // ratio (stable across zoom/fit) so the virtualizer's spacers are ~right.
  const onDims = useCallback((i: number, w: number, h: number): void => {
    if (!w) return
    const r = h / w
    if (Math.abs((ratioRef.current[i] || 0) - r) > 0.002) {
      ratioRef.current[i] = r
      cancelAnimationFrame(bumpRaf.current)
      bumpRaf.current = requestAnimationFrame(() => setTick((t) => (t + 1) % 1e9))
    }
  }, [])

  // A rendered page reports its real pixel height; store it and re-render the
  // spacers if it changed meaningfully.
  const measure = useCallback((i: number, h: number): void => {
    if (h <= 0) return
    if (Math.abs((heightsRef.current[i] || 0) - h) > 2) {
      heightsRef.current[i] = h
      cancelAnimationFrame(bumpRaf.current)
      bumpRaf.current = requestAnimationFrame(() => setTick((t) => (t + 1) % 1e9))
    }
  }, [])

  useEffect(() => {
    if (!tab) return
    let alive = true
    setLoadingImgs(true)
    // Clear the previous work's pages immediately so they don't show behind the
    // loading overlay while the new list resolves.
    setImages([])
    heightsRef.current = [] // fresh work → drop measured heights
    ratioRef.current = [] // …and decoded aspect ratios
    // Online galleries remember the page you were on across close/reopen.
    const pp = side === 'right' ? tab.rightPagePos : tab.pagePos
    setPageIdx(online ? onlineProgress[online.code]?.pageIdx ?? 0 : pp && pp.workId === paneWorkId ? pp.idx : 0)
    // NB: zoom is NOT reset here — prev/next-chapter (same tab) keeps the zoom.
    const loader = online ? getOnlineImages(online.code) : work ? getImages(work.id) : Promise.resolve([])
    loader.then((imgs) => {
      if (!alive) return
      // Show the pages right away — the first (visible) page can paint at once.
      setImages(imgs)
      setLoadingImgs(false)
      // Continuing BACKWARD into this work → start at its last page. Consume the
      // one-shot flag HERE (tied to the new work's load) so it can't be eaten by a
      // render that still holds the previous work's pages.
      if (side === 'left' && useStore.getState().startAtBottom[tabId] && imgs.length) {
        pendingBottomRef.current = true
        setPageIdx(imgs.length - 1)
        clearStartAtBottom(tabId)
      }
      // Page exclusion (opt-in) hashes every page, which for a many-page work
      // would block the whole reader if done up front. Run it in the background
      // and drop the excluded pages once it finishes.
      if (!online && hasExclusions()) {
        filterExcluded(imgs, getExcluded()).then((kept) => {
          if (alive && kept.length !== imgs.length) {
            heightsRef.current = []
            ratioRef.current = []
            setImages(kept)
          }
        })
      }
    })
    return () => {
      alive = false
    }
  }, [key, reloadNonce])

  // Sync zoom back onto the tab so switching away and back (or a new tab that
  // inherits it) keeps the same magnification. Also persist it per library
  // (debounced so a Ctrl+wheel burst doesn't spam disk writes).
  useEffect(() => {
    setTabReader(tabId, side, { zoom })
    const h = window.setTimeout(() => setLastZoom(libMode, zoom), 400)
    return () => window.clearTimeout(h)
  }, [zoom, tabId, side, setTabReader, setLastZoom, libMode])

  // Online galleries stream over the network. Prefetch the WHOLE gallery once,
  // but in reading order from the opened page and at low concurrency, so the
  // first pages paint fast and the rest fill in the background (instead of
  // firing every request at once and stalling the start). onDims feeds the
  // virtualizer so spacers are right and scrolling doesn't jump.
  const sinkRef = useRef<HTMLImageElement[]>([])
  useEffect(() => {
    sinkRef.current = []
    if (!online || images.length === 0) return
    const s = pageIdxRef.current
    const order: number[] = []
    for (let i = s; i < images.length; i++) order.push(i)
    for (let i = s - 1; i >= 0; i--) order.push(i)
    return prefetchOrdered(images, order, 4, sinkRef.current, onDims)
  }, [online?.code, images, onDims])

  // Local works load from disk fast, but a fresh <img> still decodes on mount →
  // a black flash as new pages scroll in / paging remounts. Prefetch a bounded
  // window AHEAD of the current page (forward-first, concurrency-limited) so
  // upcoming pages are already decoded before they're viewed — no per-page
  // stutter — while memory stays flat on huge works.
  const warmRef = useRef<HTMLImageElement[]>([])
  useEffect(() => {
    warmRef.current = []
    if (online || images.length === 0) return
    const AHEAD = 40
    const BEHIND = 4
    const hi = Math.min(images.length, pageIdx + AHEAD + 1)
    const order: number[] = []
    for (let i = pageIdx; i < hi; i++) order.push(i)
    for (let i = pageIdx - 1; i >= Math.max(0, pageIdx - BEHIND); i--) order.push(i)
    return prefetchOrdered(images, order, 6, warmRef.current, onDims)
  }, [online, images, pageIdx, onDims])

  // Continuous reading: warm the neighbouring works in the reading queue so that
  // crossing a work boundary is instant (the folder listing is cached and the
  // edge pages are already decoded). Next work's first pages + prev work's last.
  const neighborRef = useRef<HTMLImageElement[]>([])
  useEffect(() => {
    neighborRef.current = []
    if (online || !work) return
    const i = readingQueue.indexOf(work.id)
    if (i < 0) return
    let cancelled = false
    const warm = (id: string | undefined, tail: boolean): void => {
      if (!id) return
      getImages(id)
        .then((imgs) => {
          if (cancelled) return
          for (const src of tail ? imgs.slice(-3) : imgs.slice(0, 3)) {
            const im = new Image()
            im.decoding = 'async'
            im.src = src
            neighborRef.current.push(im)
          }
        })
        .catch(() => {})
    }
    warm(readingQueue[i + 1], false)
    warm(readingQueue[i - 1], true)
    return () => {
      cancelled = true
      neighborRef.current = []
    }
  }, [online, work?.id, readingQueue])

  // Count a view (조회수 / 최근 본) once per opening of a local work.
  useEffect(() => {
    if (!tab || !work || online) return
    const ck = `${tabId}:${side}:${work.id}`
    if (counted.has(ck)) return
    counted.add(ck)
    window.api.incrementView(work.id).then(upsertWork)
  }, [tabId, side, work?.id])

  // Current page from scroll position, computed from the cumulative page-height
  // model (the DOM only holds a window of pages, so rects can't be used).
  const computeCurrentFromScroll = useCallback((): void => {
    const el = contentRef.current
    if (!el) return
    const target = el.scrollTop + el.clientHeight / 3
    let acc = 0
    let idx = 0
    for (let i = 0; i < images.length; i++) {
      const h = heightOf(i)
      if (target < acc + h) {
        idx = i
        break
      }
      acc += h
      idx = i
    }
    pageIdxRef.current = idx
    setPageIdx(idx) // React skips the re-render when idx is unchanged
  }, [images.length, heightOf])

  // --- scroll mode: restore saved scroll, then sync the current page. ---
  useLayoutEffect(() => {
    if (mode !== 'scroll') return
    const el = contentRef.current
    if (!el || !tab) return
    el.scrollTop = online ? onlineProgress[online.code]?.scrollTop ?? 0 : savedScroll
    computeCurrentFromScroll() // center the render window on the restored page
    // Depend on `images` (not images.length): switching to another chapter with the
    // SAME page count must still reset the scroll to that chapter's top/saved spot.
  }, [tabId, side, images, mode])

  // When continuing BACKWARD into the previous work, land on its last page / bottom
  // instead of the top. The flag was set in the load effect (tied to this work).
  // In scroll mode the page heights are still settling as images decode, so a
  // single scroll would drift mid-way — pin to the bottom for a short window until
  // the layout stabilizes, then sync the current page.
  useLayoutEffect(() => {
    if (!pendingBottomRef.current || images.length === 0) return
    pendingBottomRef.current = false
    if (mode !== 'scroll') {
      goToPageRef.current(images.length - 1)
      return
    }
    const deadline = performance.now() + 700
    const pin = (): void => {
      const el = contentRef.current
      if (!el) return
      el.scrollTop = el.scrollHeight
      if (performance.now() < deadline) requestAnimationFrame(pin)
      else computeCurrentFromScroll()
    }
    requestAnimationFrame(pin)
  }, [images, mode, computeCurrentFromScroll])

  // Remember which general-manga chapter was opened last (이어보기 / list mark).
  const progKey = online ? online.code : work?.id
  useEffect(() => {
    if (libMode === 'normal' && progKey) markRead(progKey)
  }, [libMode, progKey, markRead])

  useEffect(() => {
    if (mode !== 'scroll') return
    const el = contentRef.current
    if (!el || !tab) return
    let raf = 0
    // Persist scroll position only after scrolling settles. Writing to the store
    // every frame re-rendered the Reader (window math) + TabBar each frame and
    // capped the framerate; this keeps scrolling render-free.
    const save = (): void => {
      if (online) setOnlineProgress(online.code, { scrollTop: el.scrollTop, pageIdx: pageIdxRef.current })
      else if (side === 'right') setTabRightScroll(tabId, el.scrollTop)
      else setTabScroll(tabId, el.scrollTop)
    }
    const onScroll = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(computeCurrentFromScroll) // cheap; re-renders only on page change
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(save, 250)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
      window.clearTimeout(saveTimer.current)
      save() // flush on tab switch / unmount
    }
  }, [tabId, side, mode, online?.code, computeCurrentFromScroll, setOnlineProgress, setTabScroll, setTabRightScroll])

  const goToPage = useCallback(
    (idx: number): void => {
      // Continuous reading: stepping past the last/first page flows into the next/
      // previous work. Online (manga-site) uses its sibling chapters; local works use the
      // reading queue (the filtered left list). Only when a neighbour exists.
      if (idx > images.length - 1) {
        if (online?.kind === 'comic' ? goComicChapterRef.current(1) : continueReading(tabId, side, 1))
          return
      }
      if (idx < 0) {
        if (online?.kind === 'comic' ? goComicChapterRef.current(-1) : continueReading(tabId, side, -1))
          return
      }
      const clamped = Math.max(0, Math.min(images.length - 1, idx))
      setPageIdx(clamped)
      if (mode === 'scroll') {
        const el = contentRef.current
        if (el) {
          let top = 0
          for (let i = 0; i < clamped; i++) top += heightOf(i)
          el.scrollTo({ top, behavior: 'auto' })
        }
      }
      if (online) setOnlineProgress(online.code, { scrollTop: contentRef.current?.scrollTop ?? 0, pageIdx: clamped })
    },
    [images.length, mode, online, setOnlineProgress, heightOf, continueReading, tabId, side]
  )

  // Keep refs fresh so the wheel handler (paged paging) reads current values
  // without re-subscribing each render.
  goToPageRef.current = goToPage
  pageIdxRef.current = pageIdx

  // Paged / two-page modes: remember the page in the tab (settled, not per flip).
  const setTabPage = useStore((s) => s.setTabPage)
  useEffect(() => {
    if (mode === 'scroll' || online || !paneWorkId) return
    const t = window.setTimeout(() => setTabPage(tabId, side, { workId: paneWorkId, idx: pageIdx }), 300)
    return () => window.clearTimeout(t)
  }, [pageIdx, mode, online, paneWorkId, tabId, side, setTabPage])

  // Changing the fit mode resizes every page, so re-anchor the scroll to the
  // page the reader was on (heights were cleared in applyFit → re-measured).
  const fitRef = useRef(fit)
  useLayoutEffect(() => {
    if (fitRef.current === fit) return
    fitRef.current = fit
    if (mode === 'scroll') goToPageRef.current(pageIdxRef.current)
  }, [fit, mode])

  // Measure the reader pane so a page can be fit whole at 100% (scroll mode).
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const update = (): void => setPane({ w: el.clientWidth - 16, h: el.clientHeight - 8 })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [mode, images.length])

  // Ctrl + wheel zoom (works in both scroll and paged modes). The point under
  // the cursor is recorded so the layout effect below can keep it fixed.
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) {
        // Paged / spread modes: the page fits the pane (no scroll), so use the
        // wheel to flip pages instead (two at a time in spread).
        if (mode !== 'scroll') {
          // Optional: let the wheel flip pages in click-paging / spread modes.
          if (!useStore.getState().settings.pagedWheelFlip) return
          e.preventDefault()
          // Accumulate the wheel delta and flip a page every WHEEL_STEP px, so a
          // longer/faster scroll keeps flipping (proportional to how much you
          // scroll) instead of a fixed one-flip-per-burst. Batched per animation
          // frame so multiple events in one frame read a fresh page index.
          const WHEEL_STEP = 100
          if ((e.deltaY > 0) !== (wheelAccum.current > 0)) wheelAccum.current = 0
          wheelAccum.current += e.deltaY
          if (!wheelRaf.current) {
            wheelRaf.current = requestAnimationFrame(() => {
              wheelRaf.current = 0
              const n = Math.trunc(wheelAccum.current / WHEEL_STEP)
              if (n !== 0) {
                wheelAccum.current -= n * WHEEL_STEP
                const cover = useStore.getState().settings.spreadCoverSingle === true
                let to = pageIdxRef.current
                for (let k = 0; k < Math.abs(n); k++) to = flipTarget(to, n > 0 ? 1 : -1, mode, cover)
                goToPageRef.current(to)
              }
            })
          }
        } else {
          // Scroll mode: keep scrolling past the bottom (or top) to flow into the
          // next (or previous) work in the reading queue — continuous reading.
          const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
          const atTop = el.scrollTop <= 0
          if ((atBottom && e.deltaY > 0) || (atTop && e.deltaY < 0)) {
            if ((e.deltaY > 0) !== (edgeAccum.current > 0)) edgeAccum.current = 0
            edgeAccum.current += e.deltaY
            const EDGE = 240 // extra overscroll needed before jumping works
            if (Math.abs(edgeAccum.current) >= EDGE) {
              const dir: 1 | -1 = edgeAccum.current > 0 ? 1 : -1
              edgeAccum.current = 0
              // Online manga-site continues by sibling chapter; local by reading queue.
              goComicChapterRef.current(dir) || useStore.getState().continueReading(tabId, side, dir)
            }
          } else {
            edgeAccum.current = 0
          }
        }
        return
      }
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const cx = e.clientX - r.left
      const cy = e.clientY - r.top
      setZoom((z) => {
        const nz = Math.max(0.25, Math.min(5, +(z * (e.deltaY < 0 ? 1.1 : 0.9)).toFixed(2)))
        pendingZoom.current = nz === z ? null : { cx, cy, ratio: nz / z }
        return nz
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [mode, images.length])

  // After a cursor-anchored zoom, page sizes scale by `ratio`; shift the scroll
  // so the content point that was under the cursor stays under it.
  useLayoutEffect(() => {
    const p = pendingZoom.current
    if (!p) return
    pendingZoom.current = null
    // Page heights scale with zoom — keep the model in sync.
    heightsRef.current = heightsRef.current.map((h) => (h ? h * p.ratio : 0))
    const el = contentRef.current
    if (!el) return
    el.scrollLeft = (el.scrollLeft + p.cx) * p.ratio - p.cx
    el.scrollTop = (el.scrollTop + p.cy) * p.ratio - p.cy
  }, [zoom])

  // Zoom = 1 means "at fit": the button shows the fit label and cycles the four
  // fit modes. A Ctrl+wheel zoom sets zoom ≠ 1 ("custom"): the button then shows
  // the % and a click reverts to the fit mode.
  const atFit = Math.abs(zoom - 1) < 0.001
  const applyFit = (f: FitMode): void => {
    heightsRef.current = [] // page sizing changed → re-measure
    setZoom(1)
    setTabReader(tabId, side, { fit: f, zoom: 1 })
    setLastFit(libMode, f)
    setLastZoom(libMode, 1)
  }
  const onZoomButton = (): void => {
    if (atFit) applyFit(fitOrder[(fitOrder.indexOf(fit) + 1) % fitOrder.length])
    else {
      heightsRef.current = []
      setZoom(1) // custom → back to the fit mode
    }
  }

  useEffect(() => {
    if (mode !== 'spread' || fit !== 'cover') return
    let alive = true
    const st = spreadStart(pageIdx, coverSingle)
    for (const src of [images[st], images[st + 1]]) {
      if (!src || spreadRatios[src]) continue
      const im = new Image()
      im.onload = () => {
        if (alive && im.naturalWidth)
          setSpreadRatios((m) => ({ ...m, [src]: im.naturalHeight / im.naturalWidth }))
      }
      im.src = src
    }
    return () => {
      alive = false
    }
  }, [mode, fit, images, pageIdx, spreadRatios, coverSingle])

  // keyboard paging
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      const combo = comboFromEvent(e)
      if (!combo) return
      const keys = useStore.getState().settings.shortcuts
      if (shortcutCombos(keys, 'nextPage').includes(combo)) {
        startReading()
        setHintsGone(true)
        goToPage(flipTarget(pageIdx, 1, mode, coverSingle))
      } else if (shortcutCombos(keys, 'prevPage').includes(combo)) {
        startReading()
        setHintsGone(true)
        goToPage(flipTarget(pageIdx, -1, mode, coverSingle))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pageIdx, goToPage, mode, coverSingle])

  // 포커스 모드: the first wheel / click in the page area (scrollbar included)
  // counts as "reading started" and hides the chrome. Only user input — the
  // scroll restore on open must not trigger it.
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const onUse = (): void => {
      startReading()
      setHintsGone(true)
    }
    el.addEventListener('wheel', onUse, { passive: true })
    el.addEventListener('pointerdown', onUse)
    return () => {
      el.removeEventListener('wheel', onUse)
      el.removeEventListener('pointerdown', onUse)
    }
  }, [mode, key, loadingImgs])

  // Cover shown alone: snap the position to the start of its spread so the page
  // label, progress and flips all agree with what's on screen.
  useEffect(() => {
    if (mode !== 'spread' || !coverSingle) return
    const st = spreadStart(pageIdx, true)
    if (st !== pageIdx) setPageIdx(st)
  }, [mode, coverSingle, pageIdx])

  if (!tab) return <div className="reader empty">탭이 없습니다.</div>

  const title = online ? online.title : work?.title ?? '(삭제됨)'
  const artist = online ? online.artist : work?.artist

  const download = async (): Promise<void> => {
    if (!online) return
    setDownloading(true)
    try {
      const works = await startDownload({ kind: 'doujin', input: online.code, title: online.title })
      if (!works) return // stopped
      setDlDone(true)
      setTimeout(() => setDlDone(false), 2500) // briefly flip the button to 완료 ✓
    } catch (e: any) {
      alert(String(e?.message ?? e))
    } finally {
      setDownloading(false)
    }
  }

  // Download the whole manga-site series into the local general-manga library.
  const downloadComic = async (): Promise<void> => {
    if (!online?.seriesUrl) return
    setDownloading(true)
    try {
      const created = await startDownload({
        kind: 'comic',
        seriesUrl: online.seriesUrl,
        title: online.title
      })
      if (!created) return // stopped
      setDlDone(true)
      setTimeout(() => setDlDone(false), 2500)
    } catch (e: any) {
      alert(String(e?.message ?? e))
    } finally {
      setDownloading(false)
    }
  }

  // Click one half to advance (paged/spread mode). Which half advances is a
  // setting (pagedFlipSide); the other half goes back.
  const onPagedClick = (e: React.MouseEvent): void => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const clickedLeft = e.clientX - rect.left < rect.width / 2
    const forward = clickedLeft === (pagedFlipSide === 'left')
    goToPage(flipTarget(pageIdx, forward ? 1 : -1, mode, coverSingle))
  }

  return (
    <div className="reader-wrap">
      {/* Top/bottom bars sit in collapsible slides so 포커스 모드 can hide them. */}
      <div className="chrome-slide reader-chrome">
      <div className="chrome-clip">
      <div className="reader-head">
        {side === 'left' && (
          <button className="mini icon reader-back" onClick={goBack} title="목록">
            <ArrowBackIcon />
          </button>
        )}
        <h2>{title}</h2>
        {artist &&
          (() => {
            // First artist always shows; the rest only in space the title leaves
            // (whole names — ones that don't fit wrap onto a hidden line).
            const [first, ...rest] = splitArtists(artist)
            const one = (a: string): JSX.Element =>
              online?.kind === 'comic' ? (
                <span className="reader-artist link" onClick={() => searchComicAuthor(a)}>
                  {a}
                </span>
              ) : (
                <span className="reader-artist">{a}</span>
              )
            return (
              <>
                {first && one(first)}
                {rest.length > 0 && (
                  <span className="reader-artist-more">
                    {rest.map((a, i) => (
                      <span key={a + i} className="reader-artist-item">
                        ,&nbsp;{one(a)}
                      </span>
                    ))}
                  </span>
                )}
              </>
            )
          })()}
        {online && <span className="online-badge">ONLINE</span>}
        <span className="reader-pages">{images.length}p</span>
        {/* Icon buttons, flat group (default design). Download shows its state
            in the icon: arrow → (busy, dimmed) → check when done. */}
        <span className="flat-group reader-head-btns">
          {online && (
            <button
              className={`mini icon ${loadingImgs ? 'busy' : ''}`}
              onClick={() => {
                // Fetch this chapter's page list again (reloading the site page),
                // then reload the tab with it.
                reloadOnlineImages(online.code)
                useStore.getState().refreshTab(tabId)
              }}
              disabled={loadingImgs}
              title="다시 불러오기"
            >
              <RefreshIcon />
            </button>
          )}
          {online && online.kind !== 'comic' ? (
            <button
              className={`mini icon ${dlDone ? 'dl-ok' : ''} ${downloading ? 'busy' : ''}`}
              onClick={download}
              disabled={downloading || dlDone}
              title={downloading ? '다운로드 중…' : dlDone ? '다운로드 완료' : '다운로드'}
            >
              {dlDone ? <CheckMarkIcon /> : <DownloadIcon />}
            </button>
          ) : online && online.kind === 'comic' && online.seriesUrl ? (
            <button
              className={`mini icon ${dlDone ? 'dl-ok' : ''} ${downloading ? 'busy' : ''}`}
              onClick={downloadComic}
              disabled={downloading || dlDone}
              title={downloading ? '다운로드 중…' : dlDone ? '다운로드 완료' : '전체 다운로드'}
            >
              {dlDone ? <CheckMarkIcon /> : <DownloadIcon />}
            </button>
          ) : (
            work && (
              <button className="mini icon" onClick={() => window.api.openInExplorer(work.id)} title="폴더 열기">
                <FolderOpenIcon />
              </button>
            )
          )}
        </span>
      </div>
      </div>
      </div>

      {loadingImgs && <div className="reader-loading">{(online?.kind === 'comic' && comicStatus) || '이미지 로딩 중…'}</div>}

      {mode === 'scroll' ? (
        (() => {
          // Virtualize both local and online: only render pages near the current
          // one; everything else is a spacer sized from the page-height model
          // (measured height → decoded-aspect estimate → pane-fit fallback). This
          // keeps the number of mounted <img> (and thus concurrent fetches) small,
          // so a large online gallery no longer loads every page up front. The
          // prefetcher decodes upcoming pages ahead of the scroll and fills their
          // height estimates, so spacers stay ~right and scrolling doesn't jump.
          // Online uses a wider window since its pages arrive over the network.
          const WIN = online ? 6 : 2
          const start = Math.max(0, pageIdx - WIN)
          const end = Math.min(images.length, pageIdx + WIN + 1)
          let topPad = 0
          for (let i = 0; i < start; i++) topPad += heightOf(i)
          let botPad = 0
          for (let i = end; i < images.length; i++) botPad += heightOf(i)
          const pageStyle = fitStyle(fit, sw, sh)
          return (
            <div
              className={`reader-content scroll ${pageGap ? 'page-gap' : ''}`}
              ref={contentRef}
              // Allow horizontal scroll when the page can exceed the pane width
              // (zoomed in, or width/cover fit past the viewport).
              style={{ overflowX: zoom > 1 || fit === 'width' || fit === 'cover' ? 'auto' : 'hidden' }}
            >
              <div className="reader-pages-col">
                {topPad > 0 && <div style={{ height: topPad }} aria-hidden />}
                {images.slice(start, end).map((src, k) => {
                  const i = start + k
                  return (
                    <PageSlot key={i} index={i} onMeasure={measure}>
                      <TranslatedImage
                        src={src}
                        translate={translate && i === pageIdx}
                        langHint={langHint}
                        style={pageStyle}
                      />
                    </PageSlot>
                  )
                })}
                {botPad > 0 && <div style={{ height: botPad }} aria-hidden />}
              </div>
            </div>
          )
        })()
      ) : mode === 'spread' ? (
        <div className="reader-content paged spread" ref={contentRef} onClick={onPagedClick}>
          <div className="spread-pages">
            {/* Page order per setting: 'left' = next page on the left (manga
                right-to-left), 'right' = next page on the right (left-to-right). */}
            {(() => {
              const st = spreadStart(pageIdx, coverSingle)
              // Cover on its own: just page 0, centered.
              if (coverSingle && st === 0) return [0]
              return spreadNextSide === 'left' ? [st + 1, st] : [st, st + 1]
            })().map(
              (idx) => {
                if (!images[idx]) return null
                const half = Math.round(sw / 2)
                const img = (style: React.CSSProperties): JSX.Element => (
                  <TranslatedImage
                    key={idx}
                    src={images[idx]}
                    translate={idx === spreadStart(pageIdx, coverSingle) ? translate : false}
                    langHint={langHint}
                    style={style}
                  />
                )
                if (fit !== 'cover') return img(fitStyle(fit, half, sh))
                // Cover without object-fit: size the WHOLE image to cover the cell and
                // clip with the cell. object-fit:cover draws a cropped sub-rect, which
                // skips Chromium's mipmapped downscale → jagged (aliased) lines.
                const r = spreadRatios[images[idx]]
                const style: React.CSSProperties = !r
                  ? fitStyle('contain', half, sh)
                  : r > sh / half
                    ? { width: half, height: Math.round(half * r), maxWidth: 'none', maxHeight: 'none' }
                    : { height: sh, width: Math.round(sh / r), maxWidth: 'none', maxHeight: 'none' }
                return (
                  <div key={idx} className="spread-cell" style={{ width: half, height: sh }}>
                    {img(style)}
                  </div>
                )
              }
            )}
          </div>
          <div className={`paged-hint left ${hintsGone ? 'gone' : ''}`}><KeyboardArrowLeftIcon /></div>
          <div className={`paged-hint right ${hintsGone ? 'gone' : ''}`}><KeyboardArrowRightIcon /></div>
        </div>
      ) : (
        <div className="reader-content paged" ref={contentRef} onClick={onPagedClick}>
          {/* Keep the neighbouring pages mounted (decoded, off-screen) so flipping
              swaps to an already-painted image instead of a fresh <img> that
              decodes on mount → one black frame. Only the current page shows. */}
          {[pageIdx - 1, pageIdx, pageIdx + 1].map((i) =>
            images[i] ? (
              <TranslatedImage
                key={i}
                className={i === pageIdx ? 'paged-cur' : 'paged-off'}
                src={images[i]}
                translate={translate && i === pageIdx}
                langHint={langHint}
                style={fitStyle(fit, sw, sh)}
              />
            ) : null
          )}
          <div className={`paged-hint left ${hintsGone ? 'gone' : ''}`}><KeyboardArrowLeftIcon /></div>
          <div className={`paged-hint right ${hintsGone ? 'gone' : ''}`}><KeyboardArrowRightIcon /></div>
        </div>
      )}

      {images.length > 0 && (
        <div className="chrome-slide reader-chrome">
        <div className="chrome-clip">
        <div className={`reader-bottom-wrap ${barOpen ? 'open' : ''}`}>
        <div className="reader-bottom">
          {/* Option-row toggle at the far left; then mode / fit; 번역 and the
              chapter nav on the right. */}
          <button
            className="mini icon reader-bar-toggle"
            onClick={() => setBarOpen((v) => !v)}
            title={barOpen ? '옵션 닫기' : '옵션 열기'}
            aria-expanded={barOpen}
          >
            <ArrowUpIcon />
          </button>
          <span className="flat-group reader-btns">
            <button
              className="mini mode-toggle"
              onClick={() => setMode(mode === 'scroll' ? 'paged' : mode === 'paged' ? 'spread' : 'scroll')}
            >
              {mode === 'scroll' ? (
                <>
                  <ScrollModeIcon />
                  <span className="btn-label">스크롤</span>
                </>
              ) : mode === 'paged' ? (
                <>
                  <PageModeIcon />
                  <span className="btn-label">한 페이지</span>
                </>
              ) : (
                <>
                  <SpreadModeIcon />
                  <span className="btn-label">두 페이지</span>
                </>
              )}
            </button>
            <button className="mini zoom-btn" onClick={onZoomButton}>
              {atFit ? (
                <>
                  {FIT_ICON[fit]}
                  <span className="btn-label">{FIT_TEXT[fit]}</span>
                </>
              ) : (
                <span className="btn-label">{Math.round(zoom * 100)}%</span>
              )}
            </button>
          </span>
          <input
            type="range"
            className="page-slider"
            min={0}
            max={images.length - 1}
            value={pageIdx}
            onChange={(e) => goToPage(Number(e.target.value))}
          />
          <span className="page-label">
            {pageIdx + 1} / {images.length}
          </span>
          {/* 번역: right end (general manga: just left of the chapter arrows). */}
          {canTranslate && (
            <span className="flat-group reader-btns reader-tr">
              <button className={`mini tr-btn ${translate ? 'on' : ''}`} onClick={() => setTranslate((v) => !v)}>
                <TranslateIcon />
                <span className="btn-label">{translate ? '번역 끄기' : '번역'}</span>
              </button>
            </span>
          )}
          {isNormalWork && chapters.length > 1 && (
            <div className="chapter-nav">
              <button
                className="chapter-arrow"
                disabled={chIdx <= 0}
                onClick={() => goChapter(-1)}
                title="이전화"
                aria-label="이전화"
              >
                <KeyboardArrowLeftIcon />
              </button>
              <span className="chapter-pos">
                {chIdx + 1}/{chapters.length}
              </span>
              <button
                className="chapter-arrow"
                disabled={chIdx < 0 || chIdx >= chapters.length - 1}
                onClick={() => goChapter(1)}
                title="다음화"
                aria-label="다음화"
              >
                <KeyboardArrowRightIcon />
              </button>
            </div>
          )}
          {online?.kind === 'comic' && side === 'left' && comicChs.length > 1 && (
            <div className="chapter-nav">
              <button
                className="chapter-arrow"
                disabled={comicIdx <= 0}
                onClick={() => goComicChapter(-1)}
                title="이전화"
                aria-label="이전화"
              >
                <KeyboardArrowLeftIcon />
              </button>
              <span className="chapter-pos">
                {comicIdx + 1}/{comicChs.length}
              </span>
              <button
                className="chapter-arrow"
                disabled={comicIdx < 0 || comicIdx >= comicChs.length - 1}
                onClick={() => goComicChapter(1)}
                title="다음화"
                aria-label="다음화"
              >
                <KeyboardArrowRightIcon />
              </button>
            </div>
          )}
        </div>
        {/* Extra reader options under the main bar. Always mounted so it can
            animate open/closed (inert while closed); add more groups here. */}
        <div className="reader-options-slide" inert={!barOpen}>
          <div className="reader-options-clip">
          <div className="reader-options">
            {/* Per reading mode: scroll → page gap; click paging → wheel flip +
                click side; two pages → those + next-page side + cover alone.
                포커스 모드 shows in every mode. */}
            <span className="flat-group reader-btns reader-opt-btns">
              {mode === 'scroll' && (
                <OptBtn
                  icon={<PageGapIcon />}
                  label="페이지 간격"
                  state={pageGap ? 'ON' : 'OFF'}
                  on={pageGap}
                  title="스크롤 감상 시 페이지 사이에 간격을 둡니다"
                  onClick={() => patchSettings({ readerPageGap: !pageGap })}
                />
              )}
              {mode !== 'scroll' && (
                <>
                  <OptBtn
                    icon={wheelFlip ? <WheelFlipOnIcon /> : <WheelFlipOffIcon className="opt-ico-pointer" />}
                    label="스크롤 넘김"
                    state={wheelFlip ? 'ON' : 'OFF'}
                    on={wheelFlip}
                    title="휠 스크롤로도 페이지를 넘깁니다"
                    onClick={() => patchSettings({ pagedWheelFlip: !wheelFlip })}
                  />
                  <OptBtn
                    icon={pagedFlipSide === 'left' ? <ClickLeftIcon /> : <ClickRightIcon />}
                    label="넘김 클릭"
                    state={pagedFlipSide === 'left' ? '왼쪽' : '오른쪽'}
                    title="화면의 이쪽 절반을 클릭하면 다음 페이지로 넘어갑니다"
                    onClick={() => patchSettings({ pagedFlipSide: pagedFlipSide === 'left' ? 'right' : 'left' })}
                  />
                </>
              )}
              {mode === 'spread' && (
                <>
                  <OptBtn
                    icon={spreadNextSide === 'right' ? <NextRightIcon /> : <NextLeftIcon />}
                    label="다음 페이지"
                    state={spreadNextSide === 'right' ? '오른쪽' : '왼쪽'}
                    title="두 페이지 보기에서 다음 페이지가 놓이는 쪽"
                    onClick={() => patchSettings({ spreadNextSide: spreadNextSide === 'left' ? 'right' : 'left' })}
                  />
                  <OptBtn
                    icon={<CoverSingleIcon />}
                    label="첫 페이지 단독"
                    state={coverSingle ? 'ON' : 'OFF'}
                    on={coverSingle}
                    title="첫 페이지(표지)를 한 장으로 보여 주고 다음 쪽부터 짝을 맞춥니다"
                    onClick={() => patchSettings({ spreadCoverSingle: !coverSingle })}
                  />
                </>
              )}
              <OptBtn
                icon={<FocusLevelIcon level={focusMode} />}
                label="포커스 모드"
                state={focusMode ? `${focusMode}단계` : 'OFF'}
                on={focusMode > 0}
                title="감상을 시작하면 막대를 숨깁니다 (끔 → 1 → 2 → 3단계). 단계 설명은 설정 > 스타일"
                onClick={() => patchSettings({ focusMode: ((focusMode + 1) % 4) as 0 | 1 | 2 | 3 })}
              />
            </span>
          </div>
          </div>
        </div>
        </div>
        </div>
        </div>
      )}
    </div>
  )
}
