import type { AppInfo, CoverItem, Cue, Group, HistoryEntry, ProgressEvent, RenameItem, SePref, Settings, SubLang, SubtitleText, ToolResult, UndoResult, WavItem, WorkDetail, WorkSummary, AutoSubOptions, EngineStatus, GlossaryEntry, ScriptPreview, ScriptSource, ScriptSubOptions, WhisperModelId, NameStatus } from './types'

export const IPC = {
  appInfo: 'env:app:info',
  getSettings: 'env:settings:get',
  saveSettings: 'env:settings:save',
  progress: 'env:queue:progress',
  cancelJob: 'env:queue:cancel',
  pickFolder: 'env:dialog:pickFolder',
  addLibraryDir: 'env:library:addDir',
  removeLibraryDir: 'env:library:removeDir',
  scan: 'env:library:scan',
  works: 'env:library:works',
  work: 'env:library:work',
  setWorkPrefs: 'env:library:workPrefs',
  saveProgress: 'env:library:progress',
  resetProgress: 'env:library:resetProgress',
  addBookmark: 'env:bookmark:add',
  renameBookmark: 'env:bookmark:rename',
  deleteBookmark: 'env:bookmark:delete',
  setFavorite: 'env:collect:favorite',
  setRank: 'env:collect:rank',
  groups: 'env:collect:groups',
  createGroup: 'env:collect:createGroup',
  renameGroup: 'env:collect:renameGroup',
  deleteGroup: 'env:collect:deleteGroup',
  setGroupMembership: 'env:collect:membership',
  readSubtitle: 'env:sub:read',
  saveSubtitle: 'env:sub:save',
  setSubOffset: 'env:sub:offset',
  planWav: 'env:tools:planWav',
  runWav: 'env:tools:runWav',
  planCover: 'env:tools:planCover',
  runCover: 'env:tools:runCover',
  planRename: 'env:tools:planRename',
  runRename: 'env:tools:runRename',
  history: 'env:tools:history',
  fetchDlsite: 'env:dlsite:fetch',
  libraryChanged: 'env:library:changed',
  showInFolder: 'env:file:show',
  undo: 'env:log:undo',
  redo: 'env:log:redo',
  toast: 'env:app:toast',
  navBack: 'env:nav:back',
  navForward: 'env:nav:forward',
  setCompact: 'env:window:compact',
  winControl: 'env:window:control', // minimize / maximize ⇄ restore / close
  setMini: 'env:window:mini', // 최소화 모드: the window shrinks to one bar
  setOnTop: 'env:window:onTop',
  windowState: 'env:window:state', // main → renderer
  volPop: 'env:window:volPop', // 최소화 모드 volume pop-up: show / leave / value / hide
  // inside Halftone: the separate big window asks the host app (bar / panel …)
  hostRequest: 'env:host:request',
  // the big window shows the panel's player: state down, commands up
  mirror: 'env:mirror', // panel → main
  mirrorIn: 'env:mirror:in', // main → big window
  remoteCmd: 'env:remote:cmd', // big window → main
  remoteCmdIn: 'env:remote:cmd:in', // main → panel
  volPopInput: 'env:window:volPopInput', // main → renderer: the pop-up's slider moved
  autoSub: 'env:autosub:run',
  engineStatus: 'env:asr:status',
  installEngine: 'env:asr:installEngine',
  installModel: 'env:asr:installModel',
  removeModel: 'env:asr:removeModel',
  importVulkanEngine: 'env:asr:importVulkan',
  testTranslator: 'env:translate:test',
  translateNames: 'env:translate:names',
  translateNamesOf: 'env:translate:namesOf',
  nameStatus: 'env:translate:nameStatus',
  findScripts: 'env:script:find',
  previewScript: 'env:script:preview',
  scriptSub: 'env:script:run',
  getGlossary: 'env:glossary:get',
  setGlossary: 'env:glossary:set',
  decodeRequest: 'env:decode:request', // main → renderer: decode a track to 16 kHz
  decodeReply: 'env:decode:reply',
  updateStatus: 'env:update:status',
  checkUpdate: 'env:update:check',
  installUpdate: 'env:update:install',
  // embedding: the renderer asks whether the data folder is free (another app
  // may hold it) and starts background work once it shows
  status: 'env:status',
  retryLock: 'env:retryLock',
  start: 'env:start'
} as const

// Finished job summary (shown as a toast / status line).
// Inside Halftone the player lives in the panel frame (kept alive, even
// hidden); the separate big window and the bottom bar only show it. What the
// screen asks of the host app:
//   window = open the big window · panel = back to the right panel ·
//   bar = the bar at Halftone's bottom · close = close the player ·
//   lift = the bar needs this much room above it for a moment (volume)
export type HostRequest = { what: 'window' | 'panel' | 'bar' | 'close' } | { what: 'lift'; px: number }
export interface RemoteCommand {
  fn: string
  args: unknown[]
}

export type VolPopCommand =
  | { action: 'show'; rect: { x: number; y: number; w: number; h: number }; value: number; colors: Record<string, string> }
  | { action: 'leave' }
  | { action: 'value'; value: number }
  | { action: 'hide' }

export interface WindowState {
  maximized: boolean
  mini: boolean
  onTop: boolean
}

export interface JobSummary {
  ok: boolean
  message: string
}

export interface ProgressSave {
  workId: number
  groupKey: string
  position: number
  trackId?: number
  duration?: number
}

// What the renderer sees as `window.api`. Halftone provides the same shape
// when it embeds the Env screens.
export interface Api {
  appInfo: () => Promise<AppInfo>
  getSettings: () => Promise<Settings>
  saveSettings: (patch: Partial<Settings>) => Promise<Settings>
  onProgress: (cb: (e: ProgressEvent) => void) => () => void
  cancelJob: (id: number) => Promise<boolean>
  pickFolder: () => Promise<string | null>
  // library
  addLibraryDir: (path: string) => Promise<JobSummary> // adds, then scans
  removeLibraryDir: (path: string) => Promise<JobSummary>
  scan: () => Promise<JobSummary>
  works: () => Promise<WorkSummary[]>
  work: (id: number) => Promise<WorkDetail | null>
  setWorkPrefs: (id: number, p: { sePref?: SePref; edition?: string }) => Promise<void>
  saveProgress: (p: ProgressSave) => Promise<void>
  resetProgress: (workId: number) => Promise<void> // 처음부터
  // 북마크
  addBookmark: (workId: number, groupKey: string, position: number, name: string) => Promise<number>
  renameBookmark: (id: number, name: string) => Promise<void>
  deleteBookmark: (id: number) => Promise<void>
  // 즐겨찾기 · 별점 · 그룹
  setFavorite: (ids: number[], on: boolean) => Promise<void>
  setRank: (ids: number[], rank: number) => Promise<void>
  groups: () => Promise<Group[]>
  createGroup: (name: string, ids?: number[]) => Promise<number>
  renameGroup: (id: number, name: string) => Promise<void>
  deleteGroup: (id: number) => Promise<void>
  setGroupMembership: (ids: number[], groupId: number, on: boolean) => Promise<void>
  // 자막 (Phase 2)
  readSubtitle: (path: string) => Promise<SubtitleText>
  // conflict: another program's file has that name (call again with overwrite)
  saveSubtitle: (trackId: number, lang: SubLang, cues: Cue[], overwrite?: boolean) => Promise<{ path: string; conflict: boolean }>
  setSubOffset: (workId: number, groupKey: string, offset: number) => Promise<void>
  // 파일 정리 (Phase 3): plan (nothing changes) → run the kept items.
  // ids = works to look at, null = the whole library.
  planWav: (ids: number[] | null) => Promise<WavItem[]>
  runWav: (items: WavItem[]) => Promise<ToolResult>
  planCover: (ids: number[] | null) => Promise<CoverItem[]>
  runCover: (items: CoverItem[]) => Promise<ToolResult>
  planRename: (ids: number[] | null, mode?: 'repair' | 'translate') => Promise<RenameItem[]>
  runRename: (items: RenameItem[]) => Promise<ToolResult>
  history: () => Promise<HistoryEntry[]>
  // 작품 정보 from DLsite by work code (ids null = works not asked yet)
  fetchDlsite: (ids: number[] | null) => Promise<JobSummary>
  onLibraryChanged: (cb: () => void) => () => void
  showInFolder: (path: string) => Promise<void>
  mediaUrl: (path: string) => string // env-media:// for <audio>/<img>
  thumbUrl: (path: string) => string // small cached JPEG of an image
  undo: () => Promise<UndoResult>
  redo: () => Promise<UndoResult>
  onToast: (cb: (t: JobSummary) => void) => () => void
  // mouse side buttons (Windows app-command; standalone app only)
  onNavBack: (cb: () => void) => () => void
  onNavForward: (cb: () => void) => () => void
  // 작은 창 ⇄ 큰 창 (standalone window only)
  setCompact: (on: boolean) => Promise<void>
  // standalone window (no native title bar: the top bar draws the buttons)
  winControl: (action: 'minimize' | 'maximize' | 'close') => void
  setMini: (on: boolean) => Promise<void>
  setOnTop: (on: boolean) => Promise<void>
  onWindowState: (cb: (s: WindowState) => void) => () => void
  volPop: (c: VolPopCommand) => void
  // inside Halftone
  hostRequest: (r: HostRequest) => void
  mirror: (state: unknown) => void
  onMirror: (cb: (state: unknown) => void) => () => void
  remoteCmd: (c: RemoteCommand) => void
  onRemoteCmd: (cb: (c: RemoteCommand) => void) => () => void
  onVolPopInput: (cb: (v: number) => void) => () => void
  // 자동 자막 · 번역 (Phase 5)
  autoSub: (workId: number, opts: AutoSubOptions) => Promise<JobSummary>
  engineStatus: () => Promise<EngineStatus>
  installEngine: () => Promise<JobSummary>
  installModel: (m: WhisperModelId) => Promise<JobSummary>
  removeModel: (m: WhisperModelId) => Promise<void>
  importVulkanEngine: () => Promise<JobSummary> // pick a whisper-cli built with Vulkan
  testTranslator: () => Promise<JobSummary>
  translateNames: (workId: number) => Promise<JobSummary> // shown when 이름 표시 = 번역한 이름
  translateNamesOf: (workIds: number[], onlyMissing: boolean) => Promise<JobSummary> // one job per work
  nameStatus: (workIds: number[] | null) => Promise<NameStatus[]>
  // 대본 기반 자막 (Phase 6)
  findScripts: (workId: number) => Promise<ScriptSource[]>
  previewScript: (workId: number, sourceId: string) => Promise<ScriptPreview[]>
  scriptSub: (workId: number, opts: ScriptSubOptions) => Promise<JobSummary>
  getGlossary: (workId: number | null) => Promise<GlossaryEntry[]>
  setGlossary: (workId: number | null, entries: GlossaryEntry[]) => Promise<void>
  // the main process asks the screen to decode audio (Web Audio)
  onDecodeRequest: (cb: (r: { id: number; url: string }) => void) => () => void
  decodeReply: (id: number, pcm: Int16Array | null, error?: string) => void
  // 자동 업데이트 (packaged standalone builds; GitHub Releases)
  onUpdateStatus: (cb: (s: UpdateStatus) => void) => () => void
  checkUpdate: () => Promise<UpdateStatus>
  installUpdate: () => void // quit + install the downloaded update
  // embedding (Halftone): is the shared data folder free? start background work.
  status: () => Promise<EnvStatus>
  retryLock: () => Promise<EnvStatus>
  start: () => Promise<void>
}

export interface UpdateStatus {
  state: 'idle' | 'dev' | 'checking' | 'none' | 'available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  error?: string
}

// The data folder is shared by the standalone app and Halftone; only one may
// use it at a time.
export interface EnvStatus {
  ready: boolean
  lockedBy?: string // app holding the data folder ("Envelope" / "Halftone")
  newerData?: boolean // the data was made by a newer Env → update this app
}

export const MEDIA_SCHEME = 'env-media'
