import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { Api } from '../shared/ipc'

const api: Api = {
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  smbConnect: (opts) => ipcRenderer.invoke(IPC.smbConnect, opts),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (s) => ipcRenderer.invoke(IPC.saveSettings, s),
  scanLibrary: () => ipcRenderer.invoke(IPC.scanLibrary),
  scanFolder: (root) => ipcRenderer.invoke(IPC.scanFolder, root),
  onScanProgress: (cb) => {
    const listener = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on(IPC.scanProgress, listener)
    return () => ipcRenderer.removeListener(IPC.scanProgress, listener)
  },
  organizeLanguages: () => ipcRenderer.invoke(IPC.organizeLanguages),
  organizeByGenre: () => ipcRenderer.invoke(IPC.organizeByGenre),
  onOrganizeProgress: (cb) => {
    const listener = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on(IPC.organizeProgress, listener)
    return () => ipcRenderer.removeListener(IPC.organizeProgress, listener)
  },
  getWorks: () => ipcRenderer.invoke(IPC.getWorks),
  getWorkImages: (id) => ipcRenderer.invoke(IPC.getWorkImages, id),
  setFavorite: (id, fav) => ipcRenderer.invoke(IPC.setFavorite, id, fav),
  setNormalFav: (kind, key, fav) => ipcRenderer.invoke(IPC.setNormalFav, kind, key, fav),
  setRank: (id, rank) => ipcRenderer.invoke(IPC.setRank, id, rank),
  setCoverHash: (id, hash, w, h) => ipcRenderer.invoke(IPC.setCoverHash, id, hash, w, h),
  setWorkGroups: (id, groupIds) => ipcRenderer.invoke(IPC.setWorkGroups, id, groupIds),
  deleteGroup: (groupId) => ipcRenderer.invoke(IPC.deleteGroup, groupId),
  renameGroup: (groupId, name) => ipcRenderer.invoke(IPC.renameGroup, groupId, name),
  doujinFindKorean: (payload) => ipcRenderer.invoke(IPC.doujinFindKorean, payload),
  doujinFindEditions: (payload) => ipcRenderer.invoke(IPC.doujinFindEditions, payload),
  exportFavorites: () => ipcRenderer.invoke(IPC.exportFavorites),
  importFavorites: () => ipcRenderer.invoke(IPC.importFavorites),
  importOnlineFavList: () => ipcRenderer.invoke(IPC.importOnlineFavList),
  removeOnlineFavList: (name: string) => ipcRenderer.invoke(IPC.removeOnlineFavList, name),
  doujinSummaries: (codes: string[]) => ipcRenderer.invoke(IPC.doujinSummaries, codes),
  preloadOnlineFavLists: () => ipcRenderer.invoke(IPC.preloadOnlineFavLists),
  onOnlineFavPreload: (cb: (p: { done: number; total: number }) => void) => {
    const listener = (_e: unknown, p: any): void => cb(p)
    ipcRenderer.on(IPC.onlineFavPreloadProgress, listener)
    return () => ipcRenderer.removeListener(IPC.onlineFavPreloadProgress, listener)
  },
  mergeFavorites: () => ipcRenderer.invoke(IPC.mergeFavorites),
  exportRatings: (lib) => ipcRenderer.invoke(IPC.exportRatings, lib),
  importRatings: (lib) => ipcRenderer.invoke(IPC.importRatings, lib),
  mergeRatings: (lib) => ipcRenderer.invoke(IPC.mergeRatings, lib),
  getOnlineFavs: () => ipcRenderer.invoke(IPC.getOnlineFavs),
  getReadProgress: () => ipcRenderer.invoke(IPC.getReadProgress),
  markRead: (key) => ipcRenderer.invoke(IPC.markRead, key),
  setOnlineFav: (code, patch, meta) => ipcRenderer.invoke(IPC.setOnlineFav, code, patch, meta),
  setFavoriteByCode: (code, fav, meta) => ipcRenderer.invoke(IPC.setFavoriteByCode, code, fav, meta),
  translateRegion: (imageBase64, rect, langHint, ctx) => ipcRenderer.invoke(IPC.translateRegion, imageBase64, rect, langHint, ctx),
  transDraftMemo: (lines, langHint) => ipcRenderer.invoke(IPC.transDraftMemo, lines, langHint),
  ocrPageTexts: (imageBase64, langHint) => ipcRenderer.invoke(IPC.ocrPageTexts, imageBase64, langHint),
  translateImage: (imageBase64, langHint, w, h, ctx) =>
    ipcRenderer.invoke(IPC.translateImage, imageBase64, langHint, w, h, ctx),
  translateTexts: (texts, langHint) => ipcRenderer.invoke(IPC.translateTexts, texts, langHint),
  ocrModelsStatus: () => ipcRenderer.invoke(IPC.ocrModelsStatus),
  ocrModelsDownload: () => ipcRenderer.invoke(IPC.ocrModelsDownload),
  ocrModelsDelete: () => ipcRenderer.invoke(IPC.ocrModelsDelete),
  onOcrModelsProgress: (cb) => {
    const listener = (_e: unknown, p: { done: number; total: number }): void => cb(p)
    ipcRenderer.on(IPC.ocrModelsProgress, listener)
    return () => ipcRenderer.removeListener(IPC.ocrModelsProgress, listener)
  },
  getTransEdits: () => ipcRenderer.invoke(IPC.getTransEdits),
  saveTransEdit: (src, blocks) => ipcRenderer.invoke(IPC.saveTransEdit, src, blocks),
  exportText: (title, content) => ipcRenderer.invoke(IPC.exportText, title, content),
  exportImageDir: (title) => ipcRenderer.invoke(IPC.exportImageDir, title),
  writeImageFile: (dir, name, base64) => ipcRenderer.invoke(IPC.writeImageFile, dir, name, base64),
  addManualTag: (id, tag) => ipcRenderer.invoke(IPC.addManualTag, id, tag),
  removeManualTag: (id, tag) => ipcRenderer.invoke(IPC.removeManualTag, id, tag),
  incrementView: (id) => ipcRenderer.invoke(IPC.incrementView, id),
  openInExplorer: (id) => ipcRenderer.invoke(IPC.openInExplorer, id),
  clipboardReadText: () => ipcRenderer.invoke(IPC.clipboardReadText),
  clipboardWriteText: (text) => ipcRenderer.invoke(IPC.clipboardWriteText, text),
  deleteWork: (id) => ipcRenderer.invoke(IPC.deleteWork, id),
  mergeSeries: (title, ids) => ipcRenderer.invoke(IPC.mergeSeries, title, ids),
  renameNormalChapters: (items) => ipcRenderer.invoke(IPC.renameNormalChapters, items),
  classifyDeleted: () => ipcRenderer.invoke(IPC.classifyDeleted),
  onClassifyProgress: (cb) => {
    const listener = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on(IPC.classifyProgress, listener)
    return () => ipcRenderer.removeListener(IPC.classifyProgress, listener)
  },
  getSession: () => ipcRenderer.invoke(IPC.getSession),
  saveSession: (s) => ipcRenderer.invoke(IPC.saveSession, s),
  parseName: (name) => ipcRenderer.invoke(IPC.parseName, name),
  doujinFetchMeta: (code) => ipcRenderer.invoke(IPC.doujinFetchMeta, code),
  doujinEnrich: (id) => ipcRenderer.invoke(IPC.doujinEnrich, id),
  doujinEnrichAll: () => ipcRenderer.invoke(IPC.doujinEnrichAll),
  doujinCancelEnrich: () => ipcRenderer.invoke(IPC.doujinCancelEnrich),
  doujinDownload: (input) => ipcRenderer.invoke(IPC.doujinDownload, input),
  downloadStop: (code) => ipcRenderer.invoke(IPC.downloadStop, code),
  onDoujinProgress: (cb) => {
    const listener = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on(IPC.doujinProgress, listener)
    return () => ipcRenderer.removeListener(IPC.doujinProgress, listener)
  },
  doujinList: (source, page) => ipcRenderer.invoke(IPC.doujinList, source, page),
  doujinSuggest: (query) => ipcRenderer.invoke(IPC.doujinSuggest, query),
  listAvifPaths: (workId) => ipcRenderer.invoke(IPC.listAvifPaths, workId),
  replaceAvifWithWebp: (avifPath, webpBase64) =>
    ipcRenderer.invoke(IPC.replaceAvifWithWebp, avifPath, webpBase64),
  doujinReadUrls: (code) => ipcRenderer.invoke(IPC.doujinReadUrls, code),
  doujinRegenCover: (workId, code) => ipcRenderer.invoke(IPC.doujinRegenCover, workId, code),
  comicList: (source, page) => ipcRenderer.invoke(IPC.comicList, source, page),
  comicChapters: (seriesUrl) => ipcRenderer.invoke(IPC.comicChapters, seriesUrl),
  comicReadUrls: (chapterUrl) => ipcRenderer.invoke(IPC.comicReadUrls, chapterUrl),
  comicDownload: (seriesUrl, title) => ipcRenderer.invoke(IPC.comicDownload, seriesUrl, title),
  comicDownloadChapters: (seriesUrl, title, chapterUrls) =>
    ipcRenderer.invoke(IPC.comicDownloadChapters, seriesUrl, title, chapterUrls),
  comicRegenCover: (workIds, title) => ipcRenderer.invoke(IPC.comicRegenCover, workIds, title),
  comicSeriesAuthor: (seriesUrl) => ipcRenderer.invoke(IPC.comicSeriesAuthor, seriesUrl),
  comicSeriesTitle: (seriesUrl) => ipcRenderer.invoke(IPC.comicSeriesTitle, seriesUrl),
  comicFillArtist: (workIds, title) => ipcRenderer.invoke(IPC.comicFillArtist, workIds, title),
  comicScrapeList: () => ipcRenderer.invoke(IPC.comicScrapeList),
  comicDownloadGeneric: (title, chapters, only) =>
    ipcRenderer.invoke(IPC.comicDownloadGeneric, title, chapters, only),
  comicOpenSite: (url) => ipcRenderer.invoke(IPC.comicOpenSite, url),
  saveThumb: (id, dataUrl) => ipcRenderer.invoke(IPC.saveThumb, id, dataUrl),
  getThumb: (id) => ipcRenderer.invoke(IPC.getThumb, id),
  pickImage: () => ipcRenderer.invoke(IPC.pickImage),
  doujinPing: () => ipcRenderer.invoke(IPC.doujinPing),
  doujinPopularRanks: (codes) => ipcRenderer.invoke(IPC.doujinPopularRanks, codes),
  openFolder: (path) => ipcRenderer.invoke(IPC.openFolder, path),
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
  resetApp: (deleteWorkFolders) => ipcRenderer.invoke(IPC.resetApp, deleteWorkFolders),
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
  closeWindow: (decision, session) => ipcRenderer.invoke(IPC.closeWindow, decision, session)
}

contextBridge.exposeInMainWorld('api', api)
