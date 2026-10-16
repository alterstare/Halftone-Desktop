import type { IpcRenderer } from 'electron'
import { IPC, MEDIA_SCHEME } from '../shared/ipc'
import type { Api, JobSummary, RemoteCommand, UpdateStatus, WindowState } from '../shared/ipc'
import type { ProgressEvent } from '../shared/types'

// The renderer API over IPC — shared by Env's own preload and Halftone's
// (which exposes it in the Env frame).
export function createApi(ipcRenderer: IpcRenderer): Api {
  const on = <T>(ch: string, cb: (v: T) => void): (() => void) => {
    const h = (_e: unknown, v: T): void => cb(v)
    ipcRenderer.on(ch, h)
    return () => ipcRenderer.removeListener(ch, h)
  }

  // A main-process error reaches the page as "Error invoking remote method
  // 'x': Error: …". Keep only the message, so toasts show what went wrong.
  const invoke = (channel: string, ...args: unknown[]): Promise<any> =>
    ipcRenderer.invoke(channel, ...args).catch((e: unknown) => {
      throw new Error(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    })

  return {
    appInfo: () => invoke(IPC.appInfo),
    getSettings: () => invoke(IPC.getSettings),
    saveSettings: (patch) => invoke(IPC.saveSettings, patch),
    onProgress: (cb) => on<ProgressEvent>(IPC.progress, cb),
    cancelJob: (id) => invoke(IPC.cancelJob, id),
    pauseJobs: () => invoke(IPC.pauseJobs),
    resumeJobs: () => invoke(IPC.resumeJobs),
    cancelAllJobs: () => invoke(IPC.cancelAllJobs),
    pickFolder: () => invoke(IPC.pickFolder),
    addLibraryDir: (p) => invoke(IPC.addLibraryDir, p),
    removeLibraryDir: (p) => invoke(IPC.removeLibraryDir, p),
    scan: () => invoke(IPC.scan),
    works: () => invoke(IPC.works),
    work: (id) => invoke(IPC.work, id),
    setWorkPrefs: (id, p) => invoke(IPC.setWorkPrefs, id, p),
    saveProgress: (p) => invoke(IPC.saveProgress, p),
    resetProgress: (id) => invoke(IPC.resetProgress, id),
    addBookmark: (w, k, p, n) => invoke(IPC.addBookmark, w, k, p, n),
    renameBookmark: (id, n) => invoke(IPC.renameBookmark, id, n),
    deleteBookmark: (id) => invoke(IPC.deleteBookmark, id),
    setFavorite: (ids, on) => invoke(IPC.setFavorite, ids, on),
    setRank: (ids, r) => invoke(IPC.setRank, ids, r),
    groups: () => invoke(IPC.groups),
    createGroup: (n, ids) => invoke(IPC.createGroup, n, ids),
    renameGroup: (id, n) => invoke(IPC.renameGroup, id, n),
    deleteGroup: (id) => invoke(IPC.deleteGroup, id),
    setGroupMembership: (ids, g, on) => invoke(IPC.setGroupMembership, ids, g, on),
    readSubtitle: (p) => invoke(IPC.readSubtitle, p),
    saveSubtitle: (id, lang, cues, ow) => invoke(IPC.saveSubtitle, id, lang, cues, ow),
    setSubOffset: (w, k, o) => invoke(IPC.setSubOffset, w, k, o),
    planWav: (ids) => invoke(IPC.planWav, ids),
    planSubExport: (ids) => invoke(IPC.planSubExport, ids),
    runSubExport: (items) => invoke(IPC.runSubExport, items),
    planCoverSave: (ids) => invoke(IPC.planCoverSave, ids),
    restoreSubs: (ids) => invoke(IPC.restoreSubs, ids),
    coverColour: (path) => invoke(IPC.coverColour, path),
    runCoverSave: (items) => invoke(IPC.runCoverSave, items),
    runWav: (items) => invoke(IPC.runWav, items),
    planCover: (ids) => invoke(IPC.planCover, ids),
    runCover: (items) => invoke(IPC.runCover, items),
    planRename: (ids, mode) => invoke(IPC.planRename, ids, mode),
    runRename: (items) => invoke(IPC.runRename, items),
    history: () => invoke(IPC.history),
    fetchDlsite: (ids) => invoke(IPC.fetchDlsite, ids),
    onLibraryChanged: (cb) => on<void>(IPC.libraryChanged, cb),
    showInFolder: (p) => invoke(IPC.showInFolder, p),
    mediaUrl: (p) => `${MEDIA_SCHEME}://f/${Buffer.from(p, 'utf-8').toString('base64url')}`,
    thumbUrl: (p) => `${MEDIA_SCHEME}://t/${Buffer.from(p, 'utf-8').toString('base64url')}`,
    undo: () => invoke(IPC.undo),
    redo: () => invoke(IPC.redo),
    onToast: (cb) => on<JobSummary>(IPC.toast, cb),
    onNavBack: (cb) => on<void>(IPC.navBack, cb),
    onNavForward: (cb) => on<void>(IPC.navForward, cb),
    setCompact: (on) => invoke(IPC.setCompact, on),
    winControl: (a) => ipcRenderer.send(IPC.winControl, a),
    setMini: (on) => invoke(IPC.setMini, on),
    setOnTop: (on) => invoke(IPC.setOnTop, on),
    onWindowState: (cb) => on<WindowState>(IPC.windowState, cb),
    volPop: (c) => ipcRenderer.send(IPC.volPop, c),
    hostRequest: (r) => ipcRenderer.send(IPC.hostRequest, r),
    mirror: (s) => ipcRenderer.send(IPC.mirror, s),
    onMirror: (cb) => on<unknown>(IPC.mirrorIn, cb),
    remoteCmd: (c) => ipcRenderer.send(IPC.remoteCmd, c),
    onRemoteCmd: (cb) => on<RemoteCommand>(IPC.remoteCmdIn, cb),
    onVolPopInput: (cb) => on<number>(IPC.volPopInput, cb),
    autoSub: (id, o) => invoke(IPC.autoSub, id, o),
    engineStatus: () => invoke(IPC.engineStatus),
    installEngine: () => invoke(IPC.installEngine),
    installModel: (m) => invoke(IPC.installModel, m),
    removeModel: (m) => invoke(IPC.removeModel, m),
    importVulkanEngine: () => invoke(IPC.importVulkanEngine),
    testTranslator: () => invoke(IPC.testTranslator),
    translateNames: (id) => invoke(IPC.translateNames, id),
    translateNamesOf: (ids, only) => invoke(IPC.translateNamesOf, ids, only),
    nameStatus: (ids) => invoke(IPC.nameStatus, ids),
    findScripts: (id) => invoke(IPC.findScripts, id),
    pickScript: (id) => invoke(IPC.pickScript, id),
    previewScript: (id, src) => invoke(IPC.previewScript, id, src),
    scriptSub: (id, o) => invoke(IPC.scriptSub, id, o),
    getGlossary: (id) => invoke(IPC.getGlossary, id),
    setGlossary: (id, e) => invoke(IPC.setGlossary, id, e),
    importGlossary: (id) => invoke(IPC.importGlossary, id),
    onDecodeRequest: (cb) => on<{ id: number; url: string }>(IPC.decodeRequest, cb),
    decodeReply: (id, pcm, error) => ipcRenderer.send(IPC.decodeReply, { id, pcm, error }),
    onUpdateStatus: (cb) => on<UpdateStatus>(IPC.updateStatus, cb),
    checkUpdate: () => invoke(IPC.checkUpdate),
    installUpdate: () => ipcRenderer.send(IPC.installUpdate),
    status: () => invoke(IPC.status),
    retryLock: () => invoke(IPC.retryLock),
    start: () => invoke(IPC.start)
  }
}
