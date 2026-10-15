import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { EnvStatus } from '../../shared/ipc'
import type { ProgressEvent } from '../../shared/types'
import { embedded, followHostTheme, hosted, onHostMessage, postJob, remote } from './embed'
import { followRemote, serveRemote } from './remote'
import { useStore } from './store'
import type { View } from './store'
import { media, next, prev, setRate, setVolume, skip, toggle } from './player'
import { loadSubs, nudgeSubOffset } from './subs'
import { serveDecoding } from './decode'
import { toggleBookmarkHere } from './components/Bookmarks'
import { comboFromEvent, shortcutCombos } from '../../shared/shortcuts'
import type { ShortcutId } from '../../shared/shortcuts'
import LpTabs from './components/LpTabs'
import SubStrip from './components/SubStrip'
import Library from './components/Library'
import WorkPage from './components/WorkPage'
import NowView from './components/NowView'
import NowBar from './components/NowBar'
import SettingsView from './components/SettingsView'
import { CleaningServicesIcon, CloseIcon, LibraryMusicIcon, PauseIcon, PlayArrowIcon, SettingsIcon } from './components/icons'
import ToolsView from './components/ToolsView'
import MiniMode from './components/MiniMode'
import TitleStrip from './components/TitleStrip'
import logo from './assets/logo.png'
import { NARROW, SHEET_MS, useExit, useNarrow } from './components/ui'

// The data folder is shared with the other app (standalone Env / Halftone):
// while that one has it open, show who and offer a retry.
export default function App(): JSX.Element | null {
  const [st, setSt] = useState<EnvStatus | null>(null)
  useEffect(() => {
    void window.api.status().then(setSt)
  }, [])
  if (!st) return null
  if (st.newerData)
    return (
      <div className="locked">
        <h2>더 새 버전의 Envelope에서 만든 데이터입니다</h2>
        <p>
          Envelope 독립 앱과 Halftone은 같은 데이터를 함께 씁니다. 다른 쪽이 더 새 버전이라 이 버전에서는 데이터를 열지 않습니다.{' '}
          {embedded ? 'Halftone을 업데이트한 뒤 다시 여세요.' : 'Envelope를 업데이트한 뒤 다시 여세요.'}
        </p>
      </div>
    )
  if (!st.ready)
    return (
      <div className="locked">
        <h2>{st.lockedBy ?? '다른 앱'}에서 Envelope 데이터를 쓰고 있습니다</h2>
        <p>Envelope 독립 앱과 Halftone은 같은 데이터를 함께 씁니다. {st.lockedBy === 'Envelope' ? 'Envelope를' : `${st.lockedBy ?? '다른 앱'}을`} 닫은 뒤 다시 시도하세요.</p>
        <button className="btn primary" onClick={() => void window.api.retryLock().then(setSt)}>
          다시 시도
        </button>
      </div>
    )
  return <Main />
}

// Top bar: flat buttons with icon + label on the left (after the name),
// 설정 icon-only on the right.
const NAV_LEFT: [View, string, string, typeof SettingsIcon][] = [
  ['library', '라이브러리', 'Ctrl+1', LibraryMusicIcon],
  ['now', '지금 재생', 'Ctrl+2', PlayArrowIcon],
  ['tools', '파일 정리', 'Ctrl+E', CleaningServicesIcon]
]

// The background job running now (not the library scan), with a stop button.
// The newest state of each job; finished ones stay (the last few) so the job
// list shows what ran. A running job keeps its title when it reports steps.
const KEEP_FINISHED = 30
function keepJob(list: ProgressEvent[], e: ProgressEvent): ProgressEvent[] {
  const prev = list.find((j) => j.jobId === e.jobId)
  const next = { ...e, title: e.title ?? prev?.title ?? e.label, startedAt: prev?.startedAt ?? Date.now() }
  const rest = list.filter((j) => j.jobId !== e.jobId)
  const out = [next, ...rest].sort((a, b) => b.jobId - a.jobId)
  let finished = 0
  return out.filter((j) => j.state === 'queued' || j.state === 'running' || ++finished <= KEEP_FINISHED)
}

function JobPill(): JSX.Element | null {
  const job = useStore((s) => s.job)
  const paused = useStore((s) => s.jobs.some((j) => j.state === 'queued' && j.paused))
  if (!job || (job.state !== 'running' && job.state !== 'queued')) return null
  const pct = job.total ? Math.floor((job.done / job.total) * 100) : null
  return (
    <div className={`job-pill ${paused ? 'paused' : ''}`} title={job.label}>
      <span className="job-label">{paused ? `중지됨 · ${job.title ?? job.label}` : job.label}</span>
      {pct !== null && <span className="job-pct">{pct}%</span>}
      <div className="job-bar">
        <div style={{ width: pct === null ? '30%' : `${pct}%` }} className={pct === null ? 'busy' : ''} />
      </div>
      {paused ? (
        <button className="mini icon" title="작업 모두 재개" onClick={() => void window.api.resumeJobs()}>
          <PlayArrowIcon />
        </button>
      ) : (
        <button className="mini icon" title="작업 모두 중지 (재개하면 이어서)" onClick={() => void window.api.pauseJobs()}>
          <PauseIcon />
        </button>
      )}
      <button className="mini icon" title="이 작업 취소" onClick={() => void window.api.cancelJob(job.jobId)}>
        <CloseIcon />
      </button>
    </div>
  )
}

function Main(): JSX.Element {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const settings = useStore((s) => s.settings)
  const now = useStore((s) => s.now)
  const toast = useStore((s) => s.toast)
  const shownId = useStore((s) => s.shown?.id)
  const mini = useStore((s) => s.win.mini)
  const hostMode = useStore((s) => s.hostMode)
  // narrow: 지금 재생 is a sheet — it slides up in (CSS) and, when another
  // screen takes over, a copy slides down out over it
  const narrow = useNarrow()
  const nowEx = useExit(narrow && view === 'now' && !!now, SHEET_MS)
  // 파일 정리 is for the big window only: leave it when the window gets narrow
  useEffect(() => {
    if (narrow && view === 'tools') setView('library')
  }, [narrow, view, setView])

  useEffect(() => {
    const s = useStore.getState()
    void s.loadSettings()
    void s.loadWorks()
    void s.loadGroups()
    void window.api.start()
    const offs = [
      window.api.onProgress((e) => {
        if (e.label === '라이브러리 스캔') useStore.setState({ scan: e })
        else useStore.setState({ job: e })
        useStore.setState((s) => ({ jobs: keepJob(s.jobs, e) }))
        postJob(e)
      }),
      // after a scan / undo: the lists, the work shown, and the playing
      // track's subtitles (a saved or undone subtitle shows at once)
      window.api.onLibraryChanged(async () => {
        const st = useStore.getState()
        void st.loadWorks()
        await st.refreshWork()
        if (st.now && st.now.work.id !== st.shown?.id) await st.refreshWork(st.now.work.id)
        const n = useStore.getState().now
        if (n) void loadSubs(n.work, n.groupKey, n.trackId)
      }),
      window.api.onToast((t) => useStore.getState().showToast(t)),
      ...(hosted ? [] : [window.api.onWindowState((w) => useStore.setState({ win: w }))]),
      // inside Halftone: its shape for this frame (panel / bar / hidden) and
      // the keys it doesn't use itself; the big window shows the frame's player
      ...(embedded
        ? [
            onHostMessage((m) => {
              if (m.type === 'env-mode') {
                useStore.setState({ hostMode: m.mode })
                document.documentElement.classList.toggle('env-bar', m.mode === 'bar')
                // the panel stands beside Halftone: its top bar as tall as Halftone's
                document.documentElement.classList.toggle('env-panel', m.mode === 'panel')
                if (m.topH) document.documentElement.style.setProperty('--host-top-h', `${m.topH}px`)
              } else window.dispatchEvent(new KeyboardEvent('keydown', m.init))
            }),
            serveRemote()
          ]
        : []),
      // listening now: Halftone sends this frame its shape (a message sent
      // before this point would be lost)
      ...(embedded ? [(window.parent.postMessage({ type: 'env-ready' }, '*'), () => {})] : []),
      ...(remote ? [followRemote()] : []),
      serveDecoding()
    ]
    return () => offs.forEach((f) => f())
  }, [])

  // Theme: the host's when embedded, otherwise our own setting.
  useEffect(() => {
    if (embedded) return followHostTheme((t) => (document.documentElement.dataset.theme = t))
    // the big window inside Halftone: Halftone's theme (passed when it opened it)
    const hostTheme = remote && new URLSearchParams(location.search).get('theme')
    if (hostTheme) {
      document.documentElement.dataset.theme = hostTheme
      return undefined
    }
    if (settings) document.documentElement.dataset.theme = settings.theme
    return undefined
  }, [settings?.theme]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mouse side buttons (main's app-command on Windows + DOM buttons 3/4 —
  // one press fires both, so they are deduped) and the keyboard shortcuts
  // (shared/shortcuts.ts, editable in 설정 › 단축키).
  useEffect(() => {
    const last = { back: 0, forward: 0 }
    const step = (dir: 'back' | 'forward'): void => {
      const t = Date.now()
      if (t - last[dir] < 250) return
      last[dir] = t
      if (dir === 'back') useStore.getState().navBack()
      else useStore.getState().navForward()
    }
    const onMouse = (e: MouseEvent): void => {
      if (e.button === 3) {
        e.preventDefault()
        step('back')
      } else if (e.button === 4) {
        e.preventDefault()
        step('forward')
      }
    }
    const offB = window.api.onNavBack(() => step('back'))
    const offF = window.api.onNavForward(() => step('forward'))
    const RATES = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
    const onKey = (e: KeyboardEvent): void => {
      const combo = comboFromEvent(e)
      if (!combo) return
      const t = e.target as HTMLElement
      const typing = (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range') || t.tagName === 'TEXTAREA' || t.isContentEditable
      if (typing && !combo.startsWith('Ctrl+') && !combo.startsWith('Alt+')) return
      const st = useStore.getState()
      if (st.editing && ['Ctrl+Z', 'Ctrl+Y', 'Ctrl+S', 'Ctrl+Shift+Z'].includes(combo)) return // the subtitle editor's own keys
      const s = st.settings
      const is = (id: ShortcutId): boolean => shortcutCombos(s?.shortcuts, id).includes(combo)
      const seek = s?.seekStep ?? 5
      const vol = (d: number): void => setVolume(Math.max(0, Math.min(1, Math.round((media().volume + d) * 100) / 100)))
      const rate = (d: 1 | -1): void => {
        const i = RATES.findIndex((r) => r >= (s?.rate ?? 1) - 0.001)
        setRate(RATES[Math.max(0, Math.min(RATES.length - 1, (i < 0 ? 3 : i) + d))])
      }
      const goTab = (i: number): void => {
        const id = i < 0 ? st.tabs[st.tabs.length - 1] : st.tabs[i]
        if (id !== undefined) void st.openWork(id)
      }
      const cycleTab = (d: 1 | -1): void => {
        if (!st.tabs.length) return
        const i = st.shown && st.view === 'work' ? st.tabs.indexOf(st.shown.id) : -1
        goTab((i + d + st.tabs.length) % st.tabs.length)
      }
      const actions: [ShortcutId, () => void][] = [
        ['focusSearch', () => (st.setView('library'), setTimeout(() => document.getElementById('lib-search')?.focus(), 30))],
        ['goLibrary', () => st.setView('library')],
        ['goNow', () => st.now && st.setView('now')],
        ['goTools', () => window.matchMedia(NARROW).matches || (useStore.setState({ toolsScope: null }), st.setView('tools'))],
        ['goSettings', () => st.setView('settings')],
        ['navBack', () => step('back')],
        ['navForward', () => step('forward')],
        ['rescan', () => void window.api.scan().then((r) => (st.showToast(r), void st.loadWorks()))],
        ['closeTab', () => st.view === 'work' && st.shown && st.closeTab(st.shown.id)],
        ['reopenTab', () => st.reopenTab()],
        ['nextTab', () => cycleTab(1)],
        ['prevTab', () => cycleTab(-1)],
        ['tab1', () => goTab(0)],
        ['tab2', () => goTab(1)],
        ['tab3', () => goTab(2)],
        ['tab4', () => goTab(3)],
        ['tab5', () => goTab(4)],
        ['tab6', () => goTab(5)],
        ['tabLast', () => goTab(-1)],
        ['playPause', toggle],
        ['seekBack', () => skip(-seek)],
        ['seekForward', () => skip(seek)],
        ['prevTrack', prev],
        ['nextTrack', () => next()],
        ['volumeUp', () => vol(0.05)],
        ['volumeDown', () => vol(-0.05)],
        ['mute', () => setVolume(media().volume > 0 ? 0 : 1)],
        ['shuffle', () => void st.saveSettings({ shuffle: !s?.shuffle })],
        ['repeat', () => void st.saveSettings({ repeat: s?.repeat === 'off' ? 'all' : s?.repeat === 'all' ? 'one' : 'off' })],
        ['slower', () => rate(-1)],
        ['faster', () => rate(1)],
        [
          'favorite',
          () => {
            const n = st.now
            if (!n) return
            const on = !(st.works.find((w) => w.id === n.work.id)?.favorite ?? n.work.favorite)
            void window.api.setFavorite([n.work.id], on)
            st.patchWork(n.work.id, { favorite: on })
          }
        ],
        ['bookmark', () => void toggleBookmarkHere()],
        ['subMode', () => void st.saveSettings({ subsVisible: !(s?.subsVisible ?? true) })],
        ['subOffsetDown', () => nudgeSubOffset(-0.1)],
        ['subOffsetUp', () => nudgeSubOffset(0.1)],
        [
          'fullscreen',
          () => {
            if (document.fullscreenElement) return void document.exitFullscreen()
            if (!st.now) return
            if (st.view !== 'now') st.setView('now')
            setTimeout(() => void document.querySelector<HTMLElement>('.stage')?.requestFullscreen(), 60)
          }
        ]
      ]
      for (const [id, run] of actions) {
        if (!is(id)) continue
        e.preventDefault()
        run()
        return
      }
    }
    window.addEventListener('mouseup', onMouse)
    window.addEventListener('keydown', onKey)
    return () => {
      offB()
      offF()
      window.removeEventListener('mouseup', onMouse)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const navView = view === 'work' ? 'library' : view
  if (mini) return <MiniMode />
  // inside Halftone: the bar at its bottom, or nothing while the big window
  // shows this frame's player (it keeps playing here)
  if (embedded && hostMode === 'bar') return <MiniMode />
  if (embedded && hostMode === 'hidden') return <div className="env-hidden" />
  return (
    <div className={`app view-${view} ${now ? 'has-now' : ''} ${hosted ? '' : 'framed'}`}>
      {!hosted && <TitleStrip />}
      <nav className="topbar">
        <div className="topbar-left">
          <span className="brand">
            <img className="brand-logo" src={logo} alt="" draggable={false} />
            <span className="brand-name">Env/</span>
          </span>
          <div className="flat-group">
            {NAV_LEFT.filter(([k]) => !(narrow && k === 'tools')).map(([k, label, key, Icon]) => (
              <button
                key={k}
                className={`mini ${navView === k ? 'on' : ''}`}
                title={`${label} (${key})`}
                disabled={k === 'now' && !now}
                onClick={() => (k === 'tools' && useStore.setState({ toolsScope: null }), setView(k))}
              >
                <Icon /> <span className="nav-label">{label}</span>
              </button>
            ))}
          </div>
        </div>
        <JobPill />
        <div className="flat-group">
          <button className={`mini icon topbar-settings ${navView === 'settings' ? 'on' : ''}`} title="설정 (Ctrl+,)" onClick={() => setView('settings')}>
            <SettingsIcon />
          </button>
        </div>
      </nav>
      <div className={`middle tabs-${settings?.tabSide ?? 'right'}`}>
        <main className="content" key={view === 'work' ? `work-${shownId}` : view}>
          {view === 'library' && <Library />}
          {view === 'work' && <WorkPage />}
          {view === 'now' && <NowView />}
          {view === 'tools' && <ToolsView />}
          {view === 'settings' && <SettingsView />}
        </main>
        {nowEx.leaving && view !== 'now' && (
          <div className="now-leave">
            <NowView />
          </div>
        )}
        <LpTabs />
        <SubStrip />
      </div>
      <NowBar />
      {toast && <div className={`toast ${toast.ok ? '' : 'bad'}`}>{toast.message}</div>}
    </div>
  )
}
