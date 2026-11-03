// IPC channel names + the shape of the API exposed to the renderer via preload.
import type { Work, Settings, SessionState, ParsedName, DoujinMeta, OnlineFav, ScanProgress, ReadProgress } from './types'

export type OnlineSort = 'date' | 'today' | 'week' | 'month' | 'year' | 'random'

// Ordering for search results. 'date' = nozomi order (newest first);
// 'popular' = reorder by site popularity (year).
export type SearchSort = 'date' | 'popular'

export type DoujinListSource =
  | { kind: 'index'; language: string | null; sort?: OnlineSort }
  | { kind: 'search'; query: string; language: string | null; sort?: SearchSort }

// --- General-manga online (manga-site-family mirror) ---
export type ComicSort = 'date' | 'new' | 'bookmark' | 'view' | 'rating' | 'chapter'
export type ComicType = 'manga' | 'webtoon'
export interface ComicListSource {
  // Picked genre chip labels (dynamic per site); [] = 전체. Several = all of them
  // (the site ANDs genres).
  genres: string[]
  sort: ComicSort
  type: ComicType
  query?: string // free-text search; overrides genre/sort when present
  field?: 'title' | 'author' // which field `query` searches (default title)
  // Other filter rows of the list page (webtoon: 분류 / 요일 / 플랫폼), row label →
  // chip label. Missing = the site's default for that row.
  filters?: Record<string, string>
}
// One filter row on a list page (장르 / 분류 / 요일 / 플랫폼) and its chips.
export interface ComicFilterRow {
  label: string
  chips: { label: string; icon?: string }[]
}
// One series card on a manga-site list page.
export interface ComicSummary {
  url: string // series page url (unique id)
  title: string
  thumb: string | null // wrapped mangaimg://comic url
  artist: string | null // author — only known once the series page is scraped
  genre: string | null // genre label shown on the list card
  chapter: string | null // latest chapter label, when shown
}
// One chapter within a series.
export interface ComicChapter {
  url: string // chapter viewer url (unique id)
  title: string
  num: number // detected chapter number (for ordering)
}
export interface ComicListResult {
  items: ComicSummary[]
  page: number
  hasNext: boolean
  genres: string[] // genre chips scraped from the live page (for the filter UI)
  rows?: ComicFilterRow[] // every filter row, in page order
}

export const IPC = {
  pickFolder: 'dialog:pickFolder',
  smbConnect: 'smb:connect',
  getSettings: 'settings:get',
  // Sync (sendSync) theme read for the preload, so the first paint is already themed.
  themeSync: 'settings:themeSync',
  saveSettings: 'settings:save',
  scanLibrary: 'library:scan',
  scanFolder: 'library:scanFolder', // rescan one folder, infer favorite/group from location
  setCollections: 'library:setCollections',
  scanProgress: 'library:scanProgress', // main -> renderer event
  organizeLanguages: 'library:organizeLanguages',
  organizeByGenre: 'library:organizeByGenre',
  organizeProgress: 'library:organizeProgress', // main -> renderer event
  getWorks: 'works:getAll',
  getWorkImages: 'works:getImages',
  imageUrl: 'works:imageUrl',
  setFavorite: 'works:setFavorite',
  setNormalFav: 'works:setNormalFav',
  setRank: 'works:setRank',
  setCoverHash: 'works:setCoverHash',
  setWorkGroups: 'works:setGroups',
  deleteGroup: 'works:deleteGroup',
  renameGroup: 'works:renameGroup',
  doujinFindKorean: 'doujin:findKorean',
  doujinFindEditions: 'doujin:findEditions',
  exportFavorites: 'fav:export',
  importFavorites: 'fav:import',
  importOnlineFavList: 'fav:importOnlineList',
  removeOnlineFavList: 'fav:removeOnlineList',
  doujinSummaries: 'doujin:summaries',
  resetFavorites: 'fav:reset',
  favLanguages: 'fav:languages',
  pruneDeletedFavorites: 'fav:pruneDeleted',
  pruneDeletedProgress: 'fav:pruneProgress', // main -> renderer: {done, total}
  preloadOnlineFavLists: 'fav:preloadOnline',
  onlineFavPreloadProgress: 'fav:preloadProgress',
  summarySyncProgress: 'doujin:summarySync', // main -> renderer: {done, total, running} of the summary queue
  summaryArrived: 'doujin:summaryArrived', // main -> renderer: GallerySummary[] fetched since the last push
  mergeFavorites: 'fav:merge',
  exportRatings: 'ratings:export',
  importRatings: 'ratings:import',
  mergeRatings: 'ratings:merge',
  getOnlineFavs: 'online:getFavs',
  getReadProgress: 'progress:get',
  markRead: 'progress:markRead',
  setOnlineFav: 'online:setFav',
  setFavoriteByCode: 'fav:setByCode',
  translateImage: 'translate:image',
  translateRegion: 'translate:region',
  transDraftMemo: 'translate:draftMemo',
  ocrPageTexts: 'ocr:pageTexts',
  translateTexts: 'translate:texts', // free engine: renderer OCRs, main translates strings
  translateLines: 'translate:lines', // editor: re-translate lines with the page engine's translator
  ocrModelsStatus: 'ocr:modelsStatus',
  ocrModelsDownload: 'ocr:modelsDownload',
  ocrModelsDelete: 'ocr:modelsDelete',
  ocrModelsProgress: 'ocr:modelsProgress', // main -> renderer: { done, total } bytes
  lamaStatus: 'lama:status',
  lamaDownload: 'lama:download',
  lamaDelete: 'lama:delete',
  lamaProgress: 'lama:progress', // main -> renderer: { done, total } bytes
  lamaPatch: 'lama:patch', // one 512×512 patch painted by the inpainting model
  getTransEdits: 'translate:getEdits', // load all persisted manual edits (bubble box/color/text)
  saveTransEdit: 'translate:saveEdit', // persist one page's edited blocks (keyed by image src)
  getTransPaint: 'translate:getPaint', // a page's painted layer (editor's inpaint tools), data URL or null
  saveTransPaint: 'translate:savePaint', // persist / clear that layer
  getTransMask: 'translate:getMask', // an edited page's OCR text mask, or null
  getTransDoc: 'translate:getDoc', // an edited page's editor document + layer images, or null
  saveTransDoc: 'translate:saveDoc', // persist / clear it
  saveTransMask: 'translate:saveMask', // persist / clear it (edits replace the OCR run)
  exportText: 'text:export', // OCR/translation → .txt in the export folder
  exportImageDir: 'text:exportImageDir', // create/return a fresh per-work image folder
  writeImageFile: 'text:writeImageFile', // write one rendered page image into that folder
  addManualTag: 'works:addManualTag',
  removeManualTag: 'works:removeManualTag',
  incrementView: 'works:incrementView',
  openInExplorer: 'works:openInExplorer',
  clipboardReadText: 'app:clipboardReadText',
  clipboardWriteText: 'app:clipboardWriteText',
  deleteWork: 'works:delete',
  mergeSeries: 'works:mergeSeries',
  renameNormalChapters: 'works:renameNormalChapters',
  classifyDeleted: 'works:classifyDeleted',
  classifyProgress: 'works:classifyProgress',
  getSession: 'session:get',
  saveSession: 'session:save',
  parseName: 'util:parseName',
  doujinFetchMeta: 'doujin:fetchMeta',
  doujinEnrich: 'doujin:enrich',
  doujinEnrichAll: 'doujin:enrichAll',
  doujinCancelEnrich: 'doujin:cancelEnrich',
  doujinDownload: 'doujin:download',
  watchCheck: 'watch:check', // 감시 다운로드: new galleries for the watched tokens
  doujinProgress: 'doujin:progress', // main -> renderer event
  downloadStop: 'download:stop', // abort a running/queued download by code
  doujinList: 'doujin:list',
  doujinSuggest: 'doujin:suggest', // online search autocomplete (artists + seen tags)
  listAvifPaths: 'convert:listAvif', // a work's .avif files (path + mangaimg url)
  replaceAvifWithWebp: 'convert:replaceWebp', // write .webp, delete the .avif
  doujinReadUrls: 'doujin:readUrls',
  doujinRegenCover: 'doujin:regenCover',
  comicList: 'comic:list',
  comicChapters: 'comic:chapters',
  comicReadUrls: 'comic:readUrls',
  comicReadCancel: 'comic:readCancel',
  comicReadPartial: 'comic:readPartial', // main -> renderer event
  comicDownload: 'comic:download',
  comicDownloadChapters: 'comic:downloadChapters',
  comicRegenCover: 'comic:regenCover',
  comicSeriesAuthor: 'comic:seriesAuthor',
  comicSeriesTitle: 'comic:seriesTitle',
  comicFillArtist: 'comic:fillArtist',
  comicScrapeList: 'comic:scrapeList',
  comicDownloadGeneric: 'comic:downloadGeneric',
  comicOpenSite: 'comic:openSite',
  comicChallengeAction: 'comic:challengeAction',
  comicChallenge: 'comic:challenge', // main -> renderer: Cloudflare auth window shown/cleared
  comicStatus: 'comic:status', // main -> renderer: what the manga-site scraper is doing (null = idle)
  saveThumb: 'thumb:save',
  getThumb: 'thumb:get',
  pickImage: 'dialog:pickImage',
  doujinPing: 'doujin:ping',
  doujinPopularRanks: 'doujin:popularRanks',
  openFolder: 'util:openFolder',
  requestClose: 'app:requestClose', // main -> renderer: show exit modal
  closeWindow: 'app:closeWindow', // renderer -> main: exit decision
  navBack: 'app:navBack', // main -> renderer: mouse/back-command → go back
  navForward: 'app:navForward', // main -> renderer: mouse/forward-command → go forward
  updateStatus: 'update:status', // main -> renderer: auto-update progress/state
  installUpdate: 'update:install', // renderer -> main: quit and install the downloaded update
  resetApp: 'app:reset', // renderer -> main: wipe settings/library data (+ optionally work folders), relaunch
  // 음성 플레이어 (Envelope): open / close its separate big window; the shape
  // the big window asks for (panel / bar / close) when it closes itself
  envelopeBig: 'envelope:big', // renderer -> main
  envelopeShape: 'envelope:shape' // main -> renderer
} as const

// Auto-update lifecycle surfaced in the activity bar.
export interface UpdateStatus {
  state: 'available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number // 0-100 while downloading
  error?: string
}

// User's choice in the exit modal.
export type CloseDecision = 'keep' | 'clear' | 'cancel'

// One detected+translated text region. Coords are in original-image pixels.
export interface TransBlock {
  x: number
  y: number
  w: number
  h: number
  text: string // recognized source text
  tr: string // Korean translation
  bg?: string // manual bubble-fill colour override (hex); auto-sampled when unset
  ink?: string // manual text colour override (hex); read off the source when unset
  // Paragraphs of the source text, [x, y, w, h] each, when the block holds several
  // (local OCR: joined balloons boxed as one block) — the translation is split
  // over them.
  paras?: number[][]
  // Source glyph size in px (local OCR: character pitch along its lines) — the
  // translation is typeset at about this size, smaller only when it won't fit.
  size?: number
  // The source text's lines (columns / rows), [x, y, w, h] each (local OCR): where
  // text stood off a balloon, the room its translation may take without hiding art.
  cols?: number[][]
  // Touched in the editor (text / colour): its translation is final (empty = erase
  // the source, never show it) and it's drawn even if it looks like a sound effect.
  edited?: boolean
  // The room its translation is typeset in, [x, y, w, h], when the editor's box was
  // moved / resized — the source text is still erased where it is (x, y, w, h).
  room?: number[]
  // The text turned by this many degrees (clockwise) round its box's centre.
  rot?: number
  // Editor document (TransDoc) only:
  id?: string // stable id the bubble regions point at
  style?: TextStyle // the whole translation's style
  runs?: TextRun[] // styles of parts of it (offsets into tr), over `style`
  // Its colours as the auto pass read them: text, outline, the fill under it
  // (hex), and whether it stands on the art (no balloon).
  look?: { ink?: string; halo?: string; fill: string; art?: boolean; paints?: { ink?: string; halo?: string }[] }
}

// Text formatting in the editor's 번역문 stage. Unset = the auto look.
export interface TextStyle {
  font?: string // font family
  size?: number // px, page (canvas) space
  color?: string // hex
  align?: 'justify' | 'left' | 'center' | 'right'
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  // true = a set outline (its width in px and colour; colour unset = the
  // opposite shade of the text), false = none at all, unset = the auto halo.
  outline?: boolean
  outlineWidth?: number
  outlineColor?: string
  opacity?: number // the fill's, 0–1 (unset = 1)
  gradient?: TextGradient // fills the text instead of `color`
}
// A linear gradient over a block's text: `angle` in degrees (0 = left → right,
// 90 = top → bottom), stops at 0–1 along it with their colour (hex) and alpha.
export interface GradStop {
  pos: number
  color: string
  alpha: number
}
export interface TextGradient {
  angle: number
  stops: GradStop[]
}
export interface TextRun extends TextStyle {
  start: number
  end: number
}

// A bubble region (the editor's 말풍선 stage): where the translation of its
// blocks goes (several = one speech, joined in reading order). Mask bit-packed
// row-major over its rect (bit i&7 of byte i>>3), base64.
export interface TransRegion {
  id: string
  layer: string // the bubble layer it's on
  blocks: string[]
  x: number
  y: number
  w: number
  h: number
  bits: string
  ink?: number // source text pixels in it (splits a block's text between regions)
  fill?: string // hex: the balloon's fill
  room?: boolean // text on the art, no balloon
}
// One editor layer, over the page itself. bubbles: regions (a guide, never drawn
// on the page); pixels: a painted layer (PNG); text: the translations.
export interface TransLayer {
  id: string
  name: string
  kind: 'bubbles' | 'pixels' | 'text'
  visible: boolean
  auto?: boolean // made by an auto step (re-running it replaces this layer)
}
// A page's editor document — what the viewer and export draw for an edited page.
export interface TransDoc {
  v: 1
  W: number
  H: number
  blocks: TransBlock[]
  regions: TransRegion[]
  layers: TransLayer[] // top first; the page itself is under them all
  // The recognition the document was built from (the editor's 초기화 rebuilds
  // from it); missing on documents saved before it was kept.
  orig?: TransBlock[]
}
// Extra context for LLM translation of one page: the work's character notes
// and the previous page(s) already translated (keeps speech levels, names and
// tone consistent from page to page).
export interface TransContext {
  memo?: string
  prev?: { text: string; tr: string }[]
}

export interface TransResult {
  ok: boolean
  w: number // original image width (for scaling the overlay)
  h: number
  blocks: TransBlock[]
  panelText?: string // used when the engine returns text without per-box coords
  error?: string
  mask?: TextMask // text pixels, from the local OCR engine only
}

// Text-pixel mask from the local OCR's detector (comic-text-detector `seg`),
// bit-packed row-major (bit i&7 of byte i>>3), 1 = text. Mask pixel (x, y) covers
// page pixel (x / scale, y / scale); page = the downscaled image sent for OCR.
export interface TextMask {
  w: number
  h: number
  scale: number
  bits: Uint8Array
}

export interface WatchHit {
  code: string
  title: string
}

export interface DoujinProgress {
  code: string
  title: string
  done: number
  total: number
  phase:
    | 'queued'
    | 'fetching'
    | 'downloading'
    | 'enriching'
    | 'converting'
    | 'done'
    | 'error'
    | 'stopped'
  message?: string
}

export interface GallerySummary {
  code: string
  title: string
  artists: string[]
  tags: string[]
  language: string | null
  type: string | null
  pageCount: number
  thumbUrl: string | null
}

export interface DoujinListResult {
  items: GallerySummary[]
  total: number
  page: number
  pageSize: number
}

export interface Api {
  pickFolder: () => Promise<string | null>
  // NAS (SMB, Windows): save the login in Windows and check the folder; returns its UNC path.
  smbConnect: (opts: { address: string; user?: string; password?: string }) => Promise<{ ok: boolean; path?: string; error?: string }>
  getSettings: () => Promise<Settings>
  saveSettings: (s: Settings) => Promise<Settings>
  scanLibrary: () => Promise<Work[]>
  // Rescan a single folder; works get favorite/group inferred from their path.
  scanFolder: (root: string) => Promise<Work[]>
  // 작품 통합 / 해제: save settings.manualCollections and rebuild only the
  // works of `dirs` (the folders whose grouping changes).
  setCollections: (collections: Settings['manualCollections'], dirs: string[]) => Promise<{ settings: Settings; works: Work[] }>
  onScanProgress: (cb: (p: ScanProgress) => void) => () => void
  organizeLanguages: () => Promise<Work[]>
  organizeByGenre: () => Promise<{ works: Work[]; moved: number }>
  onOrganizeProgress: (cb: (p: { moved: number; current: string; done: boolean }) => void) => () => void
  getWorks: () => Promise<Work[]>
  getWorkImages: (workId: string) => Promise<string[]> // file:// urls in page order
  setFavorite: (workId: string, fav: boolean) => Promise<Work>
  // General-manga in-app favorite: toggle a series (by key) or a single chapter
  // (by work id). Returns the updated settings (holding the fav lists).
  setNormalFav: (kind: 'series' | 'chapter', key: string, fav: boolean) => Promise<Settings>
  setRank: (workId: string, rank: number) => Promise<Work>
  setCoverHash: (workId: string, hash: string, w?: number, h?: number) => Promise<Work>
  setWorkGroups: (workId: string, groupIds: string[]) => Promise<Work>
  // Delete a group: drops it from settings, moves its works out of the group
  // folder, and strips the group id from those works. Returns fresh state.
  deleteGroup: (groupId: string) => Promise<{ settings: Settings; works: Work[] }>
  renameGroup: (groupId: string, name: string) => Promise<{ settings: Settings; works: Work[] }>
  doujinFindKorean: (payload: {
    code: string | null
    artist: string | null
    title: string
  }) => Promise<GallerySummary[]>           // Korean editions of a work
  doujinFindEditions: (payload: {
    code: string | null
    artist: string | null
    title: string
    language?: string | null
  }) => Promise<Record<'korean' | 'japanese' | 'english', (GallerySummary & { similar?: boolean })[]>>
  // Favorites ⇄ Pupil-compatible JSON ({favorites, favorite_tags, ranks}).
  // Export = every favorited gallery code; import merges (hearts the codes,
  // syncing downloaded works) and returns how many were already downloaded.
  exportFavorites: () => Promise<{ ok: boolean; count: number; path?: string }>
  importFavorites: () => Promise<{ ok: boolean; matched: number; total: number }>
  // Favorite lists: import a file as a named list of codes, remove one, and
  // fetch gallery summaries for a set of codes (to render a list).
  importOnlineFavList: () => Promise<{ ok: boolean; name: string; total: number }>
  removeOnlineFavList: (name: string) => Promise<{ ok: boolean }>
  doujinSummaries: (codes: string[]) => Promise<GallerySummary[]>
  // 즐겨찾기 초기화: unheart every doujin favorite (ratings kept). Returns how many.
  resetFavorites: () => Promise<{ count: number }>
  // code → language of the cached summaries among `codes` (missing = not fetched yet).
  favLanguages: (codes: string[]) => Promise<Record<string, string | null>>
  // Check favorites with no summary; drop the ones deleted from the site (404)
  // that have no downloaded copy. uncertain = couldn't tell (network).
  pruneDeletedFavorites: () => Promise<{ checked: number; removed: number; uncertain: number }>
  onPruneDeletedProgress: (cb: (p: { done: number; total: number }) => void) => () => void
  // Background summary queue (favorites' title/thumb/tags) → activity bar.
  onSummarySync: (cb: (p: { done: number; total: number; running: boolean }) => void) => () => void
  onSummaryArrived: (cb: (list: GallerySummary[]) => void) => () => void
  preloadOnlineFavLists: () => Promise<{ ok: boolean; total: number; cached: number }>
  onOnlineFavPreload: (cb: (p: { done: number; total: number }) => void) => () => void
  // Merge 2+ favorite files into one new file (union); no library change.
  mergeFavorites: () => Promise<{ ok: boolean; count: number; files: number; path?: string }>
  // Rating files, per library mode (동인지 / 일반 만화 kept separate).
  exportRatings: (lib: 'doujin' | 'normal') => Promise<{ ok: boolean; count: number; path?: string }>
  importRatings: (lib: 'doujin' | 'normal') => Promise<{ ok: boolean; applied: number; total: number }>
  mergeRatings: (lib: 'doujin' | 'normal') => Promise<{ ok: boolean; count: number; files: number; path?: string }>
  // Online (doujin) favorites + ranks, keyed by gallery code.
  getOnlineFavs: () => Promise<OnlineFav[]>
  getReadProgress: () => Promise<Record<string, ReadProgress>>
  markRead: (key: string) => Promise<void>
  setOnlineFav: (
    code: string,
    patch: { favorite?: boolean; rank?: number },
    meta?: Partial<OnlineFav>
  ) => Promise<OnlineFav>
  // Heart / unheart a doujin gallery by code: updates the favorites list and
  // every local work with that code (moving folders per favoriteMoveToFolder).
  setFavoriteByCode: (
    code: string,
    fav: boolean,
    meta?: Partial<OnlineFav>
  ) => Promise<{ fav: OnlineFav; works: Work[] }>
  // OCR + translate one page. imageBase64 = JPEG/PNG bytes (base64, no prefix);
  // the renderer re-encodes webp/avif via canvas first. langHint = ja/en/zh.
  // w/h = the sent (downscaled) image pixel size, so engines returning
  // normalized boxes (Gemini) can convert to pixels. Papago ignores them.
  translateImage: (imageBase64: string, langHint?: string, w?: number, h?: number, ctx?: TransContext) => Promise<TransResult>
  // AI draft of a work's character notes from its recognized lines (page-ordered).
  transDraftMemo: (lines: string[], langHint?: string) => Promise<{ ok: boolean; memo: string; error?: string }>
  // Local OCR only (no translation): a page's recognized lines in reading order.
  ocrPageTexts: (imageBase64: string, langHint?: string) => Promise<{ ok: boolean; texts: string[]; error?: string }>
  // Translation editor: OCR + translate one rectangle (image px) of the page.
  translateRegion: (
    imageBase64: string,
    rect: { x: number; y: number; w: number; h: number },
    langHint?: string,
    ctx?: TransContext
  ) => Promise<{ ok: boolean; text: string; tr: string; error?: string }>
  // Free engine: translate already-OCR'd strings (Google unofficial / DeepL).
  // Returns translations aligned to the input order ('' on per-item failure).
  translateTexts: (texts: string[], langHint?: string) => Promise<{ ok: boolean; texts: string[]; error?: string }>
  // Translation editor: re-translate source lines with the page engine's translator.
  translateLines: (texts: string[], langHint?: string, ctx?: TransContext) => Promise<{ ok: boolean; texts: string[]; error?: string }>
  // 로컬 OCR models (local translate engine): installed?, download all (one go), delete.
  ocrModelsStatus: () => Promise<{ installed: boolean; sizeMB: number }>
  ocrModelsDownload: () => Promise<{ ok: boolean; error?: string }>
  ocrModelsDelete: () => Promise<void>
  onOcrModelsProgress: (cb: (p: { done: number; total: number }) => void) => () => void
  // 인페인팅 모델 (optional LaMa): installed?, download, delete; lamaPatch paints
  // one 512×512 patch (rgb 3 bytes/px, mask 1 = paint) and returns its rgb.
  lamaStatus: () => Promise<{ installed: boolean; sizeMB: number }>
  lamaDownload: () => Promise<{ ok: boolean; error?: string }>
  lamaDelete: () => Promise<void>
  onLamaProgress: (cb: (p: { done: number; total: number }) => void) => () => void
  lamaPatch: (rgb: Uint8Array, mask: Uint8Array) => Promise<Uint8Array | null>
  // Manual translation edits: map of image src → edited blocks. Loaded once at boot.
  getTransEdits: () => Promise<Record<string, TransBlock[]>>
  saveTransEdit: (src: string, blocks: TransBlock[]) => Promise<void>
  // The editor's painted layer for a page (PNG data URL, page canvas size), drawn
  // over the erased page under the translation; null = none.
  getTransPaint: (src: string) => Promise<string | null>
  saveTransPaint: (src: string, dataUrl: string | null) => Promise<void>
  getTransMask: (src: string) => Promise<TextMask | null>
  getTransDoc: (src: string) => Promise<{ doc: TransDoc; images: Record<string, string> } | null>
  // images: layer id → PNG data URL (null = none); layers left out keep theirs.
  saveTransDoc: (src: string, doc: TransDoc | null, images: Record<string, string | null>) => Promise<void>
  saveTransMask: (src: string, mask: TextMask | null) => Promise<void>
  // Write extracted text to <textExportDir>/<title>.txt; returns the written path.
  exportText: (title: string, content: string) => Promise<string>
  // Create a fresh <textExportDir>/<title>[ (n)] folder for image export; returns its path.
  exportImageDir: (title: string) => Promise<string>
  // Write one rendered page image (base64, webp) into a folder from exportImageDir.
  writeImageFile: (dir: string, name: string, base64: string) => Promise<void>
  addManualTag: (workId: string, tag: string) => Promise<Work>
  removeManualTag: (workId: string, tag: string) => Promise<Work>
  incrementView: (workId: string) => Promise<Work>
  openInExplorer: (workId: string) => Promise<void>
  clipboardReadText: () => Promise<string> // for the text-field 붙여넣기 menu
  clipboardWriteText: (text: string) => Promise<void> // 복사 menus (works even when the window isn't focused)
  deleteWork: (workId: string) => Promise<void>
  // Merge several general-manga works into one series folder (chapters become
  // subfolders of a single <root>/<title> folder). Returns the moved works.
  mergeSeries: (title: string, workIds: string[]) => Promise<Work[]>
  // Rename general-manga chapter folders in place to the given names (the caller
  // computes "<n>화 <subtitle>" per work). Returns the updated works.
  renameNormalChapters: (items: { id: string; name: string }[]) => Promise<Work[]>
  // Sweep doujin-coded works that 404 on doujin (deleted) into settings.deletedDir.
  // Returns a summary + the refreshed works. Progress via onClassifyProgress.
  classifyDeleted: () => Promise<{ moved: number; checked: number; uncertain: number; works: Work[] }>
  onClassifyProgress: (
    cb: (p: { done: number; total: number; moved: number; current: string; finished: boolean }) => void
  ) => () => void
  getSession: () => Promise<SessionState>
  saveSession: (s: SessionState) => Promise<void>
  parseName: (folderName: string) => Promise<ParsedName>
  doujinFetchMeta: (code: string) => Promise<DoujinMeta>
  doujinEnrich: (workId: string) => Promise<Work>
  doujinEnrichAll: () => Promise<Work[]>
  doujinCancelEnrich: () => Promise<void>
  doujinDownload: (input: string) => Promise<Work> // input = code or doujin url
  // 감시 다운로드: galleries uploaded since the last check for settings.watchTokens
  // (language-filtered, not yet in the library). The caller queues the downloads.
  watchCheck: () => Promise<WatchHit[]>
  // Abort a running/queued download by its progress code (doujin code, manga-site
  // seriesUrl, or "backup:<title>"). No-op if that code isn't downloading.
  downloadStop: (code: string) => Promise<boolean>
  onDoujinProgress: (cb: (p: DoujinProgress) => void) => () => void
  doujinList: (source: DoujinListSource, page: number) => Promise<DoujinListResult>
  doujinSuggest: (query: string) => Promise<string[]>
  // avif→webp conversion (Pupil compatibility). List a work's avif files, then
  // replace each with a webp (encoded by the renderer's canvas).
  listAvifPaths: (workId: string) => Promise<{ path: string; url: string }[]>
  replaceAvifWithWebp: (avifPath: string, webpBase64: string) => Promise<void>
  doujinReadUrls: (code: string) => Promise<string[]>
  doujinRegenCover: (workId: string, code: string) => Promise<{ ok: boolean; error?: string }>
  // General-manga online (manga-site-family). Scraped via a hidden BrowserWindow.
  comicList: (source: ComicListSource, page: number) => Promise<ComicListResult>
  comicChapters: (seriesUrl: string) => Promise<ComicChapter[]>
  // wrapped image urls; fresh = reload the page; view = reader pane key — an
  // older request from the same pane still waiting in the queue is dropped
  comicReadUrls: (chapterUrl: string, fresh?: boolean, view?: string) => Promise<string[]>
  comicReadCancel: (view: string) => Promise<void> // drop that reader pane's chapter load
  // Leading pages of a chapter still being collected (comicReadUrls with `view`).
  onComicReadPartial: (cb: (p: { view: string; code: string; urls: string[] }) => void) => () => void
  // Download every chapter of a series into the general-manga library. Progress
  // is reported on the doujinProgress channel (code = seriesUrl). Returns the
  // newly scanned chapter works.
  comicDownload: (seriesUrl: string, title: string) => Promise<Work[]>
  // Download only the given chapter urls of a series (선택 화 / 이어서 다운로드).
  comicDownloadChapters: (seriesUrl: string, title: string, chapterUrls: string[]) => Promise<Work[]>
  // Regenerate the cover thumbnail for the given works from the online source,
  // searching by series title. Writes to each work's thumb file.
  comicRegenCover: (workIds: string[], title: string) => Promise<{ ok: boolean; error?: string }>
  // Scrape the author(s) of a series from its page (comma-joined, or null).
  comicSeriesAuthor: (seriesUrl: string) => Promise<string | null>
  comicSeriesTitle: (seriesUrl: string) => Promise<string | null>
  // Fill the artist field on the given works by searching the online source for
  // `title`, taking the first result's author. Returns the updated works.
  comicFillArtist: (workIds: string[], title: string) => Promise<Work[]>
  // Backup (gnuboard) sites: scrape the chapter list from the page currently
  // loaded in the site window (the user navigates there by hand).
  comicScrapeList: () => Promise<ComicChapter[]>
  // Download the given scraped chapters in the background (site window not
  // needed open). `only` limits to those chapter urls. Returns new works.
  comicDownloadGeneric: (
    title: string,
    chapters: ComicChapter[],
    only?: string[]
  ) => Promise<Work[]>
  // Open a site in a visible window so the user can clear Cloudflare / log in, or
  // navigate a backup site. Pass `url` to open a specific address.
  comicOpenSite: (url?: string) => Promise<void>
  comicChallengeAction: (action: 'show' | 'retry' | 'cancel') => Promise<void>
  saveThumb: (workId: string, dataUrl: string) => Promise<string>
  getThumb: (workId: string) => Promise<string | null>
  pickImage: () => Promise<string | null> // returns a mangaimg:// url for the chosen image
  doujinPing: () => Promise<{ dohIp: string | null; ltnOk: boolean; error: string | null }>
  doujinPopularRanks: (codes: string[]) => Promise<Record<string, number>>
  openFolder: (path: string) => Promise<void>
  // Main asks the renderer to show the styled exit modal.
  onRequestClose: (cb: () => void) => () => void
  // Auto-update state pushed from main (available → downloading → downloaded).
  onUpdateStatus: (cb: (s: UpdateStatus) => void) => () => void
  // User clicked "지금 재시작" on the downloaded-update row → quit + install.
  installUpdate: () => void
  // Wipe all app data (settings/library/session). deleteWorkFolders also removes
  // every scanned work's folder from disk. Relaunches the app. Never resolves.
  resetApp: (deleteWorkFolders: boolean) => Promise<void>
  // Cloudflare auth window shown (true) / cleared (false) — show a banner.
  onComicChallenge: (cb: (active: boolean) => void) => () => void
  onComicStatus: (cb: (msg: string | null) => void) => () => void
  // Mouse "back" side button / browser-backward app command → go back.
  onNavBack: (cb: () => void) => () => void
  // Mouse "forward" side button / browser-forward app command → go forward.
  onNavForward: (cb: () => void) => () => void
  // Renderer reports the exit decision. For 'keep', pass the live tab session.
  closeWindow: (decision: CloseDecision, session?: SessionState) => Promise<void>
  // 음성 플레이어 (Envelope)
  envelopeBig: (open: boolean) => Promise<void>
  onEnvelopeShape: (cb: (shape: 'panel' | 'bar' | 'close') => void) => () => void
}

declare global {
  interface Window {
    api: Api
  }
}
