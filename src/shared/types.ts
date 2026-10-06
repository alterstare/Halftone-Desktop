// Shared data models used by both main (Node) and renderer (React).

export type SortMode = 'random' | 'recent' | 'viewed' | 'rank' | 'views' | 'title' | 'artist' | 'popular'

// How a page is sized in the reader: fit width / fit height / fit whole page
// (contain) / fill the pane (cover, cropping overflow).
export type FitMode = 'width' | 'height' | 'contain' | 'cover'

export interface Work {
  id: string // stable id derived from folder path
  path: string // absolute path to the work folder
  title: string
  artist: string | null
  code: string | null // the site gallery id, when present in folder name
  language: string | null
  pageCount: number
  tags: string[] // tags parsed from metadata (doujin / rules)
  manualTags: string[] // tags the user added by hand
  favorite: boolean
  homePath: string | null // original location, set when moved into favorites dir
  rank: number // 0 = unranked, 1-5
  favoritedAt?: number // when it was last favorited (unified favorites "recent" order)
  viewCount: number
  lastViewedAt: number | null
  addedAt: number
  mtime: number // folder modified time, for "recent" sort
  source: 'local' | 'doujin'
  // Which library this work belongs to: 'doujin' (coded/tagged galleries) or
  // 'normal' (general manga, manual tags, chapter folders). Stamped by the
  // scanner from the root the folder was found under. Missing = 'doujin' (legacy).
  library?: 'doujin' | 'normal'
  coverHash?: string // dHash of the cover page, for duplicate detection
  coverW?: number // cover pixel width (quality signal for keeper pick)
  coverH?: number
  groups?: string[] // ids of user-defined collections this work belongs to
  // When set, this work is a "collection": its pages are the images of every
  // folder listed here, concatenated in order (folders NOT merged on disk).
  // Built by the scanner from the page-count threshold or a manual merge.
  // See settings.flattenCollectThreshold / settings.manualCollections.
  sources?: string[]
}

// When a general-manga chapter was last opened (store.readProgress).
// A work in the 번역 편집기 list (translation-work mode). Kept after export;
// `done` hides it from the "작업 중만" view.
export interface TransProject {
  workId: string
  addedAt: number
  updatedAt: number // last time the editor was used on it
  lastPage: number // page index to reopen at
  done: boolean
  exportedAt?: number
}

export interface ReadProgress {
  at: number // ms timestamp
}

// A user-defined merge: several work folders shown as one "collection" work.
// Survives rescans because it lives in settings (works.json is rebuilt on scan).
export interface ManualCollection {
  title: string
  artist: string | null
  library: 'doujin' | 'normal'
  dirs: string[] // absolute paths of the folders whose images are concatenated
}

export interface WorkGroup {
  id: string
  name: string
  // Which library the group belongs to; groups are scoped per mode so doujin
  // group names don't appear in the general-manga view. Missing = 'doujin'.
  mode?: 'doujin' | 'normal'
}

export interface GenreRule {
  genre: string
  keywords: string[]
  // Optional destination folder: when autoMoveByGenre is on, works tagged with
  // `genre` are moved here.
  moveDir?: string | null
}

export interface DoujinMeta {
  code: string
  title: string
  japaneseTitle: string | null
  artists: string[]
  tags: string[] // formatted tags incl. type/language/parody/character/gendered tags
  language: string | null
  type: string | null
  pageCount: number
  fetchedAt: number
}

export interface Settings {
  libraryRoots: string[]
  // Doujin favorites folder. With favoriteMoveToFolder, hearting a work moves its
  // folder in here (and back on unheart). A work newly found in this folder by a
  // scan is added to the favorites. The heart itself is NOT derived from the
  // location — see the favorites model in main/lib/favoriteSync.ts.
  favoritesDir: string | null
  favoriteMoveToFolder: boolean
  downloadDir: string | null
  // Preferred image encoding when downloading doujin galleries. webp is more
  // widely supported by other viewers; avif is smaller. Falls back per-page when
  // the preferred encoding isn't offered for a file.
  downloadImageFormat: 'avif' | 'webp'
  // General-manga ("normal") library: separate folders scanned as the normal
  // library. Works found here are stamped library:'normal' (no doujin metadata).
  normalRoots: string[]
  // "Artist folder" roots: each immediate child folder of one of these names an
  // artist. Every work found beneath that child folder is stamped with that
  // artist name (folders are NOT merged; each work stays separate).
  flattenRoots: string[]
  // Under an artist folder, work folders with pageCount <= this are auto-merged
  // into one "<artist> collection" work (small teaser folders are consolidated).
  // 0 = disabled. Only applies to works found under flattenRoots.
  flattenCollectThreshold: number
  // Manual merges the user made in the collection manager (survive rescans).
  manualCollections: ManualCollection[]
  // Where general-manga online downloads land. Kept separate from the doujin
  // downloadDir so online manga/webtoon don't leak into the doujin library.
  // Falls back to the first normalRoot when unset.
  normalDownloadDir: string | null
  // Where extracted-text (.txt) exports are written. When unset, exporting errors
  // and asks the user to pick a folder in Settings.
  textExportDir: string | null
  // Where doujin-coded works that no longer exist on doujin (deleted) are swept to
  // when the user runs "삭제된 작품 분류". Unset → the classify action errors.
  deletedDir: string | null
  // General-manga online source (manga-site-family mirror). The site
  // bot-blocks raw requests, so we scrape it through a hidden BrowserWindow. The
  // domain rotates, so it is configurable; selectors live in main/lib/comic.ts.
  comicBaseUrl: string
  organizeByLanguage: boolean
  // Target folders for language-based auto move. Korean = default, stays put.
  langDirs: { english: string | null; japanese: string | null; other: string | null }
  autoOrganizeOnScan: boolean // run language organize after each library scan
  excludeLeadingPages: number // skip N leading pages for thumbnail/reader start
  genreRules: GenreRule[]
  autoMoveByGenre: boolean // move works into a rule's folder by its genre tag
  favoriteTags: string[]
  ignoreBracketTagsInSort: boolean
  marginWidth: number
  defaultSort: SortMode
  autoEnrichOnScan: boolean // fetch doujin metadata for coded works after a scan
  listPaneWidth: number // px width of the left list pane in reader view
  normalListPaneWidth: number // px width of the left list pane in general-manga mode
  readerPageGap: boolean // scroll mode: leave a gap between pages
  pagedWheelFlip: boolean // click-paging mode: allow the wheel to flip pages
  // How chapter numbers are read from general-manga folder names:
  //  'auto'  = per series, prefer the X화 token if every chapter has one, else
  //            the leading sequence number;
  //  'token' = always the X화 / X-Y화 token;
  //  'index' = always the leading number (a zero-padded sort index).
  normalChapterScheme: 'auto' | 'token' | 'index'
  // Series-level manual tags (separate from each chapter's tags), keyed by the
  // series identity key.
  seriesTags: Record<string, string[]>
  excludedImageHashes: string[] // perceptual hashes of sample images to filter out
  pageSize: number // works per page — home, online browse, and favorites all share this
  dnsMode: 'system' | 'doh' // 'system' lets tools like Unicorn HTTPS intercept DNS
  dohServer: string // DNS-over-HTTPS endpoint when dnsMode = 'doh'
  proxyServer: string // optional proxy rules (e.g. 'socks5://127.0.0.1:1080'), '' = direct
  // Route the general-manga site through the built-in green-tunnel proxy
  // (ClientHello fragmentation + DoH) to get past SNI-based blocking.
  bypassTunnel: boolean
  // 이어보기: clicking a general-manga series opens its last-read chapter
  // (store.readProgress) instead of the first.
  resumeReading: boolean
  // General-manga online: genres hidden from browse/search results (client-side;
  // the site has no exclude filter). Matched against each card's genre list.
  comicExcludeGenres: string[]
  // Keyboard shortcut overrides (설정 › 단축키): action id → combos. Missing =
  // the defaults in shared/shortcuts.ts; an empty list = disabled.
  shortcuts: Partial<Record<string, string[]>>
  doujinBaseUrl: string // doujin site or content/CDN host; '' = online disabled
  readerMode: 'scroll' | 'paged' | 'spread'
  // Last-used reader mode, remembered separately per library so doujin and
  // general-manga keep their own preferred view across restarts. Falls back to
  // readerMode when unset.
  lastReaderMode: { doujin: 'scroll' | 'paged' | 'spread'; normal: 'scroll' | 'paged' | 'spread' }
  // Last-used fit mode + free zoom factor, also per library. fit sizes the page
  // (width/height/contain/cover); zoom is the extra multiplier from Ctrl+wheel
  // (1 = pure fit). Both survive restarts.
  lastFit: { doujin: FitMode; normal: FitMode }
  lastZoom: { doujin: number; normal: number }
  // Two-page (spread) view: which side the NEXT page sits on. 'left' = manga
  // right-to-left (current page on the right), 'right' = left-to-right.
  spreadNextSide: 'left' | 'right'
  // Click-paging (paged + spread): which half of the page advances to the next
  // page. 'right' = click the right half to go forward (default), 'left' = click
  // the left half to go forward.
  pagedFlipSide: 'left' | 'right'
  homeLayout: 'list' | 'grid'
  // Hover a thumbnail to pop a large preview (wheel pages it). Toggleable.
  thumbHoverPreview: boolean
  // UI color theme. 'light' = Kraken light (default), 'dark' = dark variant.
  theme: 'light' | 'dark'
  // Favorite lists imported from files: { name, gallery codes }. The online
  // favorites view shows every code; the library view shows the downloaded ones.
  onlineFavLists: { name: string; codes: string[] }[]
  // Tags auto-excluded from every online SEARCH. Stored as tokens (`female:x`,
  // `tag:y`, …, spaces→'_'). Applied silently as negative (-) tokens — they are
  // NOT shown in the search box. Only affects searches (needs a positive anchor).
  onlineExcludeTags: string[]
  // Online search history (most-recent-first). Shown as a dropdown when the search
  // box is focused. Toggle off to stop recording; capped at searchHistoryMax.
  searchHistoryEnabled: boolean
  searchHistoryMax: number
  searchHistory: string[]
  // Saved online searches — each entry is a full query (a single tag OR a
  // multi-tag combo, comma-separated tokens). Shown at the top of the search-box
  // dropdown so the user can pick a saved tag/combo to run.
  favoriteSearches: string[]
  // When set (doujin setting), the other mode's tabs are also shown in the tab
  // bar, bundled into a collapsible cluster (like a tab group).
  unifyTabsAcrossModes: boolean
  groups: WorkGroup[] // user-defined collections
  // Translation (in-place) — pluggable engine.
  translateProvider: 'cloud' | 'localServer'
  // Which engine drives translation:
  //  'papago' = Papago Image(Text): paid, accurate OCR+translate in one call.
  //  'free'   = local Tesseract OCR + a free translator (google/deepl).
  //  'gemini' = Gemini Flash multimodal: OCR + translate + boxes in one call,
  //             generous free tier (Google AI Studio).
  //  'llm'    = any OpenAI-compatible vision API (Groq / OpenRouter / Mistral /
  //             custom). Same one-call OCR+translate+boxes; most have a no-card
  //             free tier.
  //  'local'  = OCR in the app (comic-text-detector + manga-ocr / PaddleOCR,
  //             models downloaded once) + text-only translation of the whole
  //             page in one request (localTranslator). Free.
  translateEngine: 'papago' | 'free' | 'gemini' | 'llm' | 'local'
  // Translator for the 'local' engine: 'auto' = Gemini if a key is set, else the
  // OpenAI-compatible LLM if set, else the free translator (freeTranslator).
  localTranslator: 'auto' | 'gemini' | 'llm' | 'free'
  freeTranslator: 'google' | 'deepl' // used when translateEngine === 'free'
  deeplApiKey: string // DeepL Free API key (api-free.deepl.com), for freeTranslator 'deepl'
  geminiApiKey: string // Google AI Studio key, for translateEngine 'gemini'
  geminiModel: string // e.g. 'gemini-2.5-flash'
  // Generic OpenAI-compatible vision engine (translateEngine === 'llm').
  llmProvider: 'groq' | 'openrouter' | 'mistral' | 'ollama' | 'custom'
  llmBaseUrl: string // e.g. 'https://api.groq.com/openai/v1'
  llmModel: string // e.g. 'qwen/qwen3.8-27b'
  llmApiKey: string
  papagoClientId: string // Naver Cloud Papago (OCR+translate via Image Translation)
  papagoClientSecret: string
  papagoImageEndpoint: string // Papago Image Translation(Text) endpoint
  translateServerUrl: string // local manga-image-translator server (provider B)
  // Per-mode overrides for the "split" keys (SPLIT_SETTING_KEYS) so doujin and
  // general-manga keep independent display/reader/sort preferences even when the
  // setting name is shared. The active mode's overlay is merged over the base.
  perMode?: Partial<Record<'doujin' | 'normal', Partial<Settings>>>
  // General-manga (normal) favorites are managed IN-APP as lists (no folder move,
  // which used to break series grouping). A series favorite stores the series key;
  // a single-chapter favorite stores the work id (opens that chapter directly).
  normalFavSeries: string[]
  normalFavChapters: string[]
  transProjects: TransProject[] // 번역 편집기 work list
  // Extra instructions appended to every LLM translation prompt (settings › 번역).
  translatePrompt: string
  // Screen shown when the app starts. 'last' = restore the last open tab (else
  // the doujin library); the others always open that screen (tabs still restored).
  // 동인지 잠금: PIN to enter doujin mode; decoy PIN opens an empty library.
  // Salted SHA-256 hashes only (never the PIN itself).
  doujinLock: { enabled: boolean; pinHash: string; decoyHash: string; salt: string }
  // Check GitHub releases and install updates automatically (packaged app).
  autoUpdate: boolean
  startScreen: 'last' | 'doujin-home' | 'doujin-online' | 'normal-home' | 'normal-online'
  // Per-work character notes (names, who speaks how) fed to the translator.
  transMemos: Record<string, string>
  // When each general-manga favorite (series key / chapter work id) was added.
  normalFavAt?: Record<string, number>
  // One-time flag: existing folder-moved normal favorites were un-favorited and
  // moved back to their origin when migrating to the in-app list system.
  normalFavMigrated: boolean
  // One-time flag: local hearts were copied into the favorites list, favlist:
  // tags converted to code lists and the old general-manga favorites folder
  // setting dropped (main/lib/favoriteSync.ts migrateFavorites).
  favoritesUnified: boolean
  // User-defined doujin folder-name patterns for locating the gallery id. Tokens:
  //   -id-     gallery id (digits) — REQUIRED; a pattern without it is ignored
  //   -title-  work title   -artist- artist   -group- circle/group
  // A folder is a doujin work only if it matches one of these AND the -id- slot
  // holds digits — so an incidental 7-digit number in the title no longer looks
  // like a code. Patterns are tried in order (first match wins). Empty = defaults.
  doujinNamePatterns: string[]
  // Index into doujinNamePatterns of the pattern used to name downloaded folders.
  doujinDownloadPatternIdx: number
  // Max number of online works (doujin galleries / manga-site series) downloading at
  // once. Extra downloads queue until a slot frees. 0 = unlimited.
  maxConcurrentDownloads: number
}

// Built-in fallback patterns (used when doujinNamePatterns is empty). Bracketed
// forms only, so a stray number in a title is never mistaken for an id.
export const DEFAULT_DOUJIN_PATTERNS = [
  '-artist- [-id-] -title-',
  '[-id-] -title-',
  '-title- (-id-)'
]

// Settings whose value is tracked independently per library mode. Everything else
// is shared. The active-mode overlay in Settings.perMode wins over the base value.
// Provider defaults (base URL + model) filled in when a provider is picked.
// Models the providers retired from their free tiers are migrated on load.
export const LLM_PRESETS: Record<string, { llmBaseUrl: string; llmModel: string } | null> = {
  groq: { llmBaseUrl: 'https://api.groq.com/openai/v1', llmModel: 'qwen/qwen3.8-27b' },
  openrouter: { llmBaseUrl: 'https://openrouter.ai/api/v1', llmModel: 'google/gemma-4-31b-it:free' },
  mistral: { llmBaseUrl: 'https://api.mistral.ai/v1', llmModel: 'mistral-large-latest' },
  ollama: { llmBaseUrl: 'http://localhost:11434/v1', llmModel: 'gemma3:12b' },
  custom: null
}
export const RETIRED_LLM_MODELS = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick:free',
  'pixtral-12b-2409',
  'qwen/qwen3.6-27b'
]
export const RETIRED_GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-2.0-flash-lite', 'gemini-1.5-flash']

export const SPLIT_SETTING_KEYS = [
  'marginWidth',
  'pageSize',
  'thumbHoverPreview',
  'readerPageGap',
  'pagedWheelFlip',
  'spreadNextSide',
  'pagedFlipSide',
  'defaultSort',
  'ignoreBracketTagsInSort'
] as const

// Persisted favorite/rank for an online (doujin) gallery, keyed by code. Display
// meta is cached so the favorites list renders without re-fetching.
export interface OnlineFav {
  code: string
  favorite: boolean
  rank: number // 0-5
  title: string
  artist: string | null
  language: string | null
  pageCount: number
  thumbUrl: string | null // wrapped mangaimg://web url (or null)
  addedAt: number
}

export interface SessionTab {
  id: string
  workId: string
  scrollTop: number
}

export interface SessionState {
  tabs: SessionTab[]
  activeTabId: string | null
}

export interface ScanProgress {
  scanned: number
  total: number
  current: string
  done: boolean
}

export interface ParsedName {
  artist: string | null
  code: string | null
  title: string
}

export const DEFAULT_SETTINGS: Settings = {
  libraryRoots: [],
  favoritesDir: null,
  favoriteMoveToFolder: true,
  downloadDir: null,
  downloadImageFormat: 'avif',
  normalRoots: [],
  flattenRoots: [],
  flattenCollectThreshold: 1,
  manualCollections: [],
  normalDownloadDir: null,
  textExportDir: null,
  deletedDir: null,
  comicBaseUrl: '', // '' = online disabled until the user enters the current site address
  organizeByLanguage: false,
  langDirs: { english: null, japanese: null, other: null },
  autoOrganizeOnScan: false,
  excludeLeadingPages: 0,
  genreRules: [],
  autoMoveByGenre: false,
  favoriteTags: [],
  ignoreBracketTagsInSort: true,
  marginWidth: 1120,
  defaultSort: 'random',
  autoEnrichOnScan: true,
  listPaneWidth: 340,
  normalListPaneWidth: 320,
  readerPageGap: false,
  pagedWheelFlip: true,
  normalChapterScheme: 'auto',
  seriesTags: {},
  excludedImageHashes: [],
  pageSize: 50,
  dnsMode: 'system',
  dohServer: 'https://cloudflare-dns.com/dns-query',
  proxyServer: '',
  bypassTunnel: false,
  resumeReading: true,
  comicExcludeGenres: [],
  shortcuts: {},
  doujinBaseUrl: '',
  readerMode: 'scroll',
  lastReaderMode: { doujin: 'scroll', normal: 'scroll' },
  lastFit: { doujin: 'contain', normal: 'width' },
  lastZoom: { doujin: 1, normal: 1 },
  spreadNextSide: 'left',
  pagedFlipSide: 'right',
  homeLayout: 'grid',
  thumbHoverPreview: true,
  theme: 'light',
  onlineFavLists: [],
  onlineExcludeTags: [],
  searchHistoryEnabled: true,
  searchHistoryMax: 20,
  searchHistory: [],
  favoriteSearches: [],
  unifyTabsAcrossModes: false,
  groups: [],
  translateProvider: 'cloud',
  translateEngine: 'papago',
  localTranslator: 'auto',
  freeTranslator: 'google',
  deeplApiKey: '',
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  llmProvider: 'groq',
  llmBaseUrl: 'https://api.groq.com/openai/v1',
  llmModel: 'qwen/qwen3.8-27b',
  llmApiKey: '',
  papagoClientId: '',
  papagoClientSecret: '',
  papagoImageEndpoint: 'https://papago.apigw.ntruss.com/image-to-text/v1/translate',
  translateServerUrl: 'http://127.0.0.1:5003',
  perMode: {},
  normalFavSeries: [],
  normalFavChapters: [],
  transProjects: [],
  translatePrompt: '',
  startScreen: 'last',
  autoUpdate: true,
  doujinLock: { enabled: false, pinHash: '', decoyHash: '', salt: '' },
  transMemos: {},
  normalFavMigrated: false,
  favoritesUnified: false,
  doujinNamePatterns: [...DEFAULT_DOUJIN_PATTERNS],
  doujinDownloadPatternIdx: 0,
  maxConcurrentDownloads: 2
}

export const IMAGE_EXTS = ['.webp', '.jpg', '.jpeg', '.png', '.gif', '.avif', '.bmp']
