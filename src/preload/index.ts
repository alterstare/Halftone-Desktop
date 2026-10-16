import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { Api } from '../shared/ipc'
import { createApi as createSortaApi } from '../sorta/preload/api'
import { createApi as createEnvelopeApi } from '../envelope/preload/api'

// A main-process error reaches the page as "Error invoking remote method 'x':
// Error: …". Keep only the message, so alerts / banners show what went wrong.
const invoke = (channel: string, ...args: unknown[]): Promise<any> =>
  ipcRenderer.invoke(channel, ...args).catch((e: unknown) => {
    throw new Error(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
  })

const api: Api = {
  pickFolder: () => invoke(IPC.pickFolder),
  smbConnect: (opts) => invoke(IPC.smbConnect, opts),
  getSettings: () => invoke(IPC.getSettings),
  saveSettings: (s) => invoke(IPC.saveSettings, s),
  scanLibrary: () => invoke(IPC.scanLibrary),
  scanFolder: (root) => invoke(IPC.scanFolder, root),
  setCollections: (collections, dirs) => invoke(IPC.setCollections, collections, dirs),
  onScanProgress: (cb) => {
    const listener = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on(IPC.scanProgress, listener)
    return () => ipcRenderer.removeListener(IPC.scanProgress, listener)
  },
  organizeLanguages: () => invoke(IPC.organizeLanguages),
  organizeByGenre: () => invoke(IPC.organizeByGenre),
  onOrganizeProgress: (cb) => {
    const listener = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on(IPC.organizeProgress, listener)
    return () => ipcRenderer.removeListener(IPC.organizeProgress, listener)
  },
  getWorks: () => invoke(IPC.getWorks),
  getWorkImages: (id) => invoke(IPC.getWorkImages, id),
  setFavorite: (id, fav) => invoke(IPC.setFavorite, id, fav),
  setNormalFav: (kind, key, fav) => invoke(IPC.setNormalFav, kind, key, fav),
  setRank: (id, rank) => invoke(IPC.setRank, id, rank),
  setCoverHash: (id, hash, w, h) => invoke(IPC.setCoverHash, id, hash, w, h),
  setWorkGroups: (id, groupIds) => invoke(IPC.setWorkGroups, id, groupIds),
  deleteGroup: (groupId) => invoke(IPC.deleteGroup, groupId),
  renameGroup: (groupId, name) => invoke(IPC.renameGroup, groupId, name),
  doujinFindKorean: (payload) => invoke(IPC.doujinFindKorean, payload),
  doujinFindEditions: (payload) => invoke(IPC.doujinFindEditions, payload),
  exportFavorites: () => invoke(IPC.exportFavorites),
  importFavorites: () => invoke(IPC.importFavorites),
  importOnlineFavList: () => invoke(IPC.importOnlineFavList),
  removeOnlineFavList: (name: string) => invoke(IPC.removeOnlineFavList, name),
  doujinSummaries: (codes: string[]) => invoke(IPC.doujinSummaries, codes),
  resetFavorites: () => invoke(IPC.resetFavorites),
  favLanguages: (codes: string[]) => invoke(IPC.favLanguages, codes),
  pruneDeletedFavorites: () => invoke(IPC.pruneDeletedFavorites),
  onPruneDeletedProgress: (cb: (p: { done: number; total: number }) => void) => {
    const listener = (_e: unknown, p: any): void => cb(p)
    ipcRenderer.on(IPC.pruneDeletedProgress, listener)
    return () => ipcRenderer.removeListener(IPC.pruneDeletedProgress, listener)
  },
  onSummaryArrived: (cb: (list: any[]) => void) => {
    const listener = (_e: unknown, list: any[]): void => cb(list)
    ipcRenderer.on(IPC.summaryArrived, listener)
    return () => ipcRenderer.removeListener(IPC.summaryArrived, listener)
  },
  onSummarySync: (cb: (p: { done: number; total: number; running: boolean }) => void) => {
    const listener = (_e: unknown, p: any): void => cb(p)
    ipcRenderer.on(IPC.summarySyncProgress, listener)
    return () => ipcRenderer.removeListener(IPC.summarySyncProgress, listener)
  },
  preloadOnlineFavLists: () => invoke(IPC.preloadOnlineFavLists),
  onOnlineFavPreload: (cb: (p: { done: number; total: number }) => void) => {
    const listener = (_e: unknown, p: any): void => cb(p)
    ipcRenderer.on(IPC.onlineFavPreloadProgress, listener)
    return () => ipcRenderer.removeListener(IPC.onlineFavPreloadProgress, listener)
  },
  mergeFavorites: () => invoke(IPC.mergeFavorites),
  exportRatings: (lib) => invoke(IPC.exportRatings, lib),
  importRatings: (lib) => invoke(IPC.importRatings, lib),
  mergeRatings: (lib) => invoke(IPC.mergeRatings, lib),
  getOnlineFavs: () => invoke(IPC.getOnlineFavs),
  getReadProgress: () => invoke(IPC.getReadProgress),
  markRead: (key) => invoke(IPC.markRead, key),
  setOnlineFav: (code, patch, meta) => invoke(IPC.setOnlineFav, code, patch, meta),
  setFavoriteByCode: (code, fav, meta) => invoke(IPC.setFavoriteByCode, code, fav, meta),
  translateRegion: (imageBase64, rect, langHint, ctx) => invoke(IPC.translateRegion, imageBase64, rect, langHint, ctx),
  transDraftMemo: (lines, langHint) => invoke(IPC.transDraftMemo, lines, langHint),
  ocrPageTexts: (imageBase64, langHint) => invoke(IPC.ocrPageTexts, imageBase64, langHint),
  translateImage: (imageBase64, langHint, w, h, ctx) =>
    invoke(IPC.translateImage, imageBase64, langHint, w, h, ctx),
  translateTexts: (texts, langHint) => invoke(IPC.translateTexts, texts, langHint),
  ocrModelsStatus: () => invoke(IPC.ocrModelsStatus),
  ocrModelsDownload: () => invoke(IPC.ocrModelsDownload),
  ocrModelsDelete: () => invoke(IPC.ocrModelsDelete),
  onOcrModelsProgress: (cb) => {
    const listener = (_e: unknown, p: { done: number; total: number }): void => cb(p)
    ipcRenderer.on(IPC.ocrModelsProgress, listener)
    return () => ipcRenderer.removeListener(IPC.ocrModelsProgress, listener)
  },
  getTransEdits: () => invoke(IPC.getTransEdits),
  saveTransEdit: (src, blocks) => invoke(IPC.saveTransEdit, src, blocks),
  exportText: (title, content) => invoke(IPC.exportText, title, content),
  exportImageDir: (title) => invoke(IPC.exportImageDir, title),
  writeImageFile: (dir, name, base64) => invoke(IPC.writeImageFile, dir, name, base64),
  addManualTag: (id, tag) => invoke(IPC.addManualTag, id, tag),
  removeManualTag: (id, tag) => invoke(IPC.removeManualTag, id, tag),
  incrementView: (id) => invoke(IPC.incrementView, id),
  openInExplorer: (id) => invoke(IPC.openInExplorer, id),
  clipboardReadText: () => invoke(IPC.clipboardReadText),
  clipboardWriteText: (text) => invoke(IPC.clipboardWriteText, text),
  deleteWork: (id) => invoke(IPC.deleteWork, id),
  mergeSeries: (title, ids) => invoke(IPC.mergeSeries, title, ids),
  renameNormalChapters: (items) => invoke(IPC.renameNormalChapters, items),
  classifyDeleted: () => invoke(IPC.classifyDeleted),
  onClassifyProgress: (cb) => {
    const listener = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on(IPC.classifyProgress, listener)
    return () => ipcRenderer.removeListener(IPC.classifyProgress, listener)
  },
  getSession: () => invoke(IPC.getSession),
  saveSession: (s) => invoke(IPC.saveSession, s),
  parseName: (name) => invoke(IPC.parseName, name),
  doujinFetchMeta: (code) => invoke(IPC.doujinFetchMeta, code),
  doujinEnrich: (id) => invoke(IPC.doujinEnrich, id),
  doujinEnrichAll: () => invoke(IPC.doujinEnrichAll),
  doujinCancelEnrich: () => invoke(IPC.doujinCancelEnrich),
  doujinDownload: (input) => invoke(IPC.doujinDownload, input),
  downloadStop: (code) => invoke(IPC.downloadStop, code),
  onDoujinProgress: (cb) => {
    const listener = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on(IPC.doujinProgress, listener)
    return () => ipcRenderer.removeListener(IPC.doujinProgress, listener)
  },
  doujinList: (source, page) => invoke(IPC.doujinList, source, page),
  doujinSuggest: (query) => invoke(IPC.doujinSuggest, query),
  listAvifPaths: (workId) => invoke(IPC.listAvifPaths, workId),
  replaceAvifWithWebp: (avifPath, webpBase64) =>
    invoke(IPC.replaceAvifWithWebp, avifPath, webpBase64),
  doujinReadUrls: (code) => invoke(IPC.doujinReadUrls, code),
  doujinRegenCover: (workId, code) => invoke(IPC.doujinRegenCover, workId, code),
  comicList: (source, page) => invoke(IPC.comicList, source, page),
  comicChapters: (seriesUrl) => invoke(IPC.comicChapters, seriesUrl),
  comicReadUrls: (chapterUrl, fresh, view) => invoke(IPC.comicReadUrls, chapterUrl, fresh, view),
  comicReadCancel: (view) => invoke(IPC.comicReadCancel, view),
  onComicReadPartial: (cb) => {
    const listener = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on(IPC.comicReadPartial, listener)
    return () => ipcRenderer.removeListener(IPC.comicReadPartial, listener)
  },
  comicDownload: (seriesUrl, title) => invoke(IPC.comicDownload, seriesUrl, title),
  comicDownloadChapters: (seriesUrl, title, chapterUrls) =>
    invoke(IPC.comicDownloadChapters, seriesUrl, title, chapterUrls),
  comicRegenCover: (workIds, title) => invoke(IPC.comicRegenCover, workIds, title),
  comicSeriesAuthor: (seriesUrl) => invoke(IPC.comicSeriesAuthor, seriesUrl),
  comicSeriesTitle: (seriesUrl) => invoke(IPC.comicSeriesTitle, seriesUrl),
  comicFillArtist: (workIds, title) => invoke(IPC.comicFillArtist, workIds, title),
  comicScrapeList: () => invoke(IPC.comicScrapeList),
  comicDownloadGeneric: (title, chapters, only) =>
    invoke(IPC.comicDownloadGeneric, title, chapters, only),
  comicOpenSite: (url) => invoke(IPC.comicOpenSite, url),
  comicChallengeAction: (action) => invoke(IPC.comicChallengeAction, action),
  saveThumb: (id, dataUrl) => invoke(IPC.saveThumb, id, dataUrl),
  getThumb: (id) => invoke(IPC.getThumb, id),
  pickImage: () => invoke(IPC.pickImage),
  doujinPing: () => invoke(IPC.doujinPing),
  doujinPopularRanks: (codes) => invoke(IPC.doujinPopularRanks, codes),
  openFolder: (path) => invoke(IPC.openFolder, path),
  onRequestClose: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.requestClose, listener)
    return () => ipcRenderer.removeListener(IPC.requestClose, listener)
  },
  onComicChallenge: (cb) => {
    const listener = (_e: unknown, active: boolean): void => cb(active)
    ipcRenderer.on(IPC.comicChallenge, listener)
    return () => ipcRenderer.removeListener(IPC.comicChallenge, listener)
  },
  onComicStatus: (cb) => {
    const listener = (_e: unknown, msg: string | null): void => cb(msg)
    ipcRenderer.on(IPC.comicStatus, listener)
    return () => ipcRenderer.removeListener(IPC.comicStatus, listener)
  },
  onUpdateStatus: (cb) => {
    const listener = (_e: unknown, s: import('../shared/ipc').UpdateStatus): void => cb(s)
    ipcRenderer.on(IPC.updateStatus, listener)
    return () => ipcRenderer.removeListener(IPC.updateStatus, listener)
  },
  installUpdate: () => ipcRenderer.send(IPC.installUpdate),
  resetApp: (deleteWorkFolders) => invoke(IPC.resetApp, deleteWorkFolders),
  onNavBack: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.navBack, listener)
    return () => ipcRenderer.removeListener(IPC.navBack, listener)
  },
  onNavForward: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.navForward, listener)
    return () => ipcRenderer.removeListener(IPC.navForward, listener)
  },
  closeWindow: (decision, session) => invoke(IPC.closeWindow, decision, session),
  envelopeBig: (open) => invoke(IPC.envelopeBig, open),
  onEnvelopeShape: (cb) => {
    const listener = (_e: unknown, s: 'panel' | 'bar' | 'close'): void => cb(s)
    ipcRenderer.on(IPC.envelopeShape, listener)
    return () => ipcRenderer.removeListener(IPC.envelopeShape, listener)
  }
}

// The preload runs in every frame of the main window (nodeIntegrationInSubFrames):
// the 캐릭터 분류 frame (sorta.html) gets Sorta's API, the 음성 플레이어 page
// (envelope.html — the frame, and its separate big window) Envelope's; the top
// page gets Halftone's; any other frame gets nothing.
if (/\/envelope\.html$/.test(location.pathname)) {
  contextBridge.exposeInMainWorld('api', createEnvelopeApi(ipcRenderer))
  // the frame (and its big window) start in Halftone's theme — before the
  // first paint, so the panel doesn't flash light
  applyInitialTheme()
} else if (/\/sorta\.html$/.test(location.pathname)) {
  contextBridge.exposeInMainWorld('api', createSortaApi(ipcRenderer))
  applyInitialTheme() // the Sorta frame follows Halftone's theme from its first paint
} else if (window.top === window) {
  contextBridge.exposeInMainWorld('api', api)
  applyInitialTheme()
}

// Stamp the saved theme on <html> before the page's first paint — settings load
// asynchronously, so without this a dark-theme start flashes the light tokens.
// The renderer store reads it back as its initial theme.
function applyInitialTheme(): void {
  let theme = 'light'
  try {
    theme = ipcRenderer.sendSync(IPC.themeSync) === 'dark' ? 'dark' : 'light'
  } catch {
    return
  }
  const set = (): boolean => {
    const el = document.documentElement
    if (!el) return false
    el.setAttribute('data-theme', theme)
    return true
  }
  if (set()) return
  const mo = new MutationObserver(() => {
    if (set()) mo.disconnect()
  })
  mo.observe(document, { childList: true })
}
