// Types shared by core, main and the renderer.

export type SePref = 'on' | 'off'
export type FormatPref = 'lossless' | 'mp3' // wav/flac first, or mp3 first
export type Repeat = 'off' | 'all' | 'one'
export type LibSort = 'recent' | 'title' | 'added' | 'code' | 'length' | 'rank'
export type SubMode = 'both' | 'original' | 'translation' | 'off'

export interface Settings {
  libraryDirs: string[] // 라이브러리 폴더
  sePref: SePref // default version to play (per work it can be changed)
  formatPref: FormatPref
  seekStep: number // seconds for ±
  volume: number // 0–1
  rate: number // playback speed
  repeat: Repeat
  shuffle: boolean
  libSort: LibSort
  libDir: 'asc' | 'desc'
  libLayout: 'grid' | 'list'
  subMode: SubMode // which subtitle lines to show
  subSize: number // subtitle font size (px)
  subsVisible: boolean // subtitles on screen (stage, or the strip over the bottom bar)
  lyricsPanel: boolean // 지금 재생: the full-subtitle panel open
  mp3Bitrate: 192 | 256 | 320 // wav → mp3
  coverSquare: boolean // ID3 cover cropped square (else whole picture)
  coverSkipExisting: boolean // leave mp3s that already have a cover
  shortcuts: Partial<Record<string, string[]>> // user overrides (shared/shortcuts.ts)
  tabSide: 'left' | 'right' // LP tab bar
  miniOnTop: boolean // 최소화 모드 stays over other windows
  resume: boolean // 이어 듣기: start where it was left (off = always from the top; positions are still recorded)
  tabs: number[] // open work tabs (restored on start)
  titleSource: 'folder' | 'dlsite' // which title the library shows
  coverSource: 'folder' | 'dlsite' // which cover (a missing one is always filled from DLsite)
  theme: 'light' | 'dark'
  autoUpdate: boolean
  pageSize: number // works per library page
  // ---- 자동 자막 · 번역 (Phase 5) ----
  asrEngine: 'groq' | 'local' // 받아쓰기: Groq API or local whisper.cpp
  groqApiKey: string
  localModel: 'large-v3-turbo-q5_0' | 'small' | 'base' | 'tiny' // local transcription model
  localDevice: 'auto' | 'cpu' // auto = Vulkan (GPU) first, CPU when it fails
  translator: 'google' | 'deepl' | 'gemini' | 'llm' // Halftone's choices
  deeplApiKey: string
  geminiApiKey: string
  geminiModel: string
  llmProvider: 'groq' | 'openrouter' | 'mistral' | 'ollama' | 'custom' // OpenAI-compatible
  llmBaseUrl: string // custom provider
  llmModel: string
  llmApiKey: string // empty + Groq = the 받아쓰기 key
  translatePrompt: string // extra instructions for LLM translation
  allowAudioUpload: boolean // 음성을 밖으로 보내기 (Groq 받아쓰기)
  allowTextUpload: boolean // 글자를 밖으로 보내기 (번역)
  nameDisplay: 'original' | 'translated' // library / player names
}

export interface ProgressEvent {
  jobId: number
  label: string // what it is doing now
  title?: string // the job itself (label when it was added)
  startedAt?: number // screen side: when it was first seen
  done: number
  total: number // 0 = indeterminate
  unit?: 'bytes' // done/total are bytes (shown as MB)
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  error?: string
  background?: boolean // never blocks other actions; yields to any other job
  paused?: boolean // queued while the queue is paused (모두 일시정지)
}

export interface AppInfo {
  version: string
  embedded: boolean // running inside Halftone (no own updater / window chrome)
  dataDir: string
  dbPath: string
  schemaVersion: number
}

export interface UndoResult {
  ok: boolean
  label: string | null // what was undone; null = nothing left
}

// ---- library ----

export type Se = 'on' | 'off' | 'unknown'
// ja = Japanese original, ko-sub = Korean subtitled release, ko-voice = Korean voice
export type WorkLang = 'ja' | 'ko-sub' | 'ko-voice'

export interface Cue {
  start: number // seconds
  end: number
  text: string // may contain line breaks
  low?: boolean // script alignment wasn't sure of this line's timing (vtt cue id "low")
}
export type SubLang = 'ja' | 'ko' | 'other'
export interface SubFile {
  path: string
  lang: SubLang | null // from the file name; null = tell from the text
}
export type TrackRole = 'main' | 'extra' | 'sample'

export interface WorkSummary {
  id: number
  path: string
  code: string | null // RJ01234567
  title: string // repaired
  cover: string | null
  tracks: number // main tracks of the shown edition
  duration: number | null // seconds, sum of those tracks
  played: number // tracks started
  finished: number // tracks heard to the end
  addedAt: number
  lastPlayedAt: number | null
  mojibake: boolean // some names in it were 뷁어 (shown repaired)
  favorite: boolean
  rank: number // 0–5 stars
  groupIds: number[] // 그룹
  lang: WorkLang
  subtitled: number // main tracks with a subtitle file
  folderTitle: string // from the folder name (title may be DLsite's)
  circle: string | null // DLsite
  voices: string[] // DLsite
}

export interface Group {
  id: number
  name: string
  count: number
}

// One file of a track (SE on/off × format folder).
export interface TrackVersion {
  id: number
  path: string
  title: string
  ext: string // '.mp3'
  kind: 'audio' | 'video'
  se: Se
  formatDir: string // folder it sits in by format ("wav"), '' if none
  relDir: string // folder inside the work
  bitrate: number | null
  duration: number | null
  subs: SubFile[]
}

export interface TrackGroup {
  key: string
  title: string // of the chosen version
  role: TrackRole
  versions: TrackVersion[]
  chosen: number // TrackVersion id to play by default
  position: number // resume point (s)
  duration: number | null
  finished: boolean
  subOffset: number // s, added to subtitle times
  originalTitle?: string // when a translated name is shown
}

export interface Edition {
  key: string
  label: string
}

export interface WorkDetail {
  id: number
  path: string
  code: string | null
  title: string
  cover: string | null
  images: string[] // background order
  editions: Edition[] // empty: only one
  edition: string // chosen edition key
  sePref: SePref
  hasSeChoice: boolean // some track has both SE versions
  groups: TrackGroup[] // main tracks of the edition, then 덤, then 샘플
  lastGroup: string | null
  mojibake: boolean
  favorite: boolean
  rank: number
  groupIds: number[]
  lang: WorkLang
  folderTitle: string
  dlTitle: string | null
  circle: string | null
  voices: string[]
  bookmarks: Bookmark[] // in track order, then time
}

export interface Bookmark {
  id: number
  workId: number
  groupKey: string
  position: number // s
  name: string
  createdAt: number
}

export interface SubtitleText {
  path: string
  lang: SubLang
  cues: Cue[]
  envMade: boolean // written by Env (may be updated without asking)
}

// ---- file tools (Phase 3) ----

// wav 정리: convert = wav only → make mp3, delete = an mp3 of the same name
// and length exists, check = an mp3 with a nearly equal name (needs a tick),
// skip = left alone (reason says why).
export interface WavItem {
  id: string
  workId: number
  workTitle: string
  kind: 'convert' | 'delete' | 'check' | 'skip'
  wav: string
  mp3: string
  wavSeconds: number | null
  mp3Seconds: number | null
  bytes: number // wav size
  reason?: string
}

// mp3 썸네일: the picture each mp3 gets as its ID3 cover.
export interface CoverItem {
  id: string
  workId: number
  workTitle: string
  track: string
  image: string | null
  hasCover: boolean // it already has one
}

// 이름 복구: a 뷁어 name and what it becomes.
export interface RenameItem {
  id: string
  workId: number
  workTitle: string
  from: string
  to: string
  dir: boolean
  work?: boolean // the work folder itself
  translated?: boolean // the new name is the translation (이름 번역)
  filled: number // lost characters filled in
  unfilled: number // "_" still left
  problem?: 'conflict' | 'too-long'
}

// 파일 정리 › DLsite 정보 › 폴더 변경: the DLsite cover saved into the work
// folder (a name that's free: cover.jpg, else "cover (DLsite).jpg").
export interface CoverSaveItem {
  id: string
  workId: number
  workTitle: string
  from: string // the cover the program keeps
  to: string
}

// 파일 정리 › 자막 › 폴더 변경: a program subtitle written next to its audio.
// new = no file there · update = a file Envelope made · conflict = another
// program's file (replaced only when ticked)
export interface SubExportItem {
  id: string
  workId: number
  workTitle: string
  trackPath: string
  lang: SubLang
  to: string
  state: 'new' | 'update' | 'conflict'
}

// 이름 번역 status of a work: names with Japanese in them, and how many of
// those have no translation yet.
export interface NameStatus {
  workId: number
  title: string
  total: number
  missing: number
}

export interface ToolResult {
  ok: boolean
  message: string
  done: number
  failed: string[]
}

export interface HistoryEntry {
  id: string
  kind: 'wav' | 'cover' | 'rename' | 'subtitle'
  summary: string
  createdAt: number
  undoable: boolean // the newest undoable entry can be undone
}

// ---- 자동 자막 · 번역 (Phase 5) ----
export type WhisperModelId = 'large-v3-turbo-q5_0' | 'small' | 'base' | 'tiny'

export interface GlossaryEntry {
  source: string
  target: string
}

export interface AutoSubOptions {
  transcribe: boolean // make the original-language subtitles
  translate: boolean // make Korean subtitles from the original ones
  extras: boolean // also 부록 tracks (samples never)
  redo: boolean // replace subtitles Env made before (others are never touched)
  groupKeys?: string[] // only these tracks
}

export interface AutoSubResult {
  made: number // subtitle files written
  skipped: string[] // "track: reason"
  failed: string[]
}

export interface EngineStatus {
  vulkan: boolean // engines/whisper-vulkan
  cpu: boolean // engines/whisper-cpu
  models: Record<WhisperModelId, boolean>
}

// ---- 대본 기반 자막 (Phase 6) ----
export interface ScriptSource {
  id: string
  kind: 'whole' | 'perTrack' // one script for the work, or one file per track
  path: string // the file, or the folder of per-track files
  label: string // path inside the work
  lang: SubLang
  files?: { groupKey: string; path: string }[] // perTrack
}

export interface ScriptPreview {
  groupKey: string
  title: string
  lines: number
  first: string // first line, to check the split
}

export interface ScriptSubOptions {
  sourceId: string
  translate: boolean // Japanese script → also Korean subtitles
  redo: boolean
}
