// Env's main-process side, embeddable: the standalone app (./index.ts) and
// Halftone both call initEnv() with a small host (how to reach the window).
// Owns the core, the IPC handlers and the background jobs. The data folder is
// shared between the two apps, so it is locked while one of them uses it.
import { BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import type { CustomScheme, OpenDialogOptions } from 'electron'
import { createReadStream, mkdirSync, promises as fsp, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { Readable } from 'stream'
import { Worker } from 'worker_threads'
import type { EncodeFn } from '../core/tools'
import { CancelledError, EnvCore } from '../core'
import type { ProgressUpdate } from '../core'
import { NewerDataError } from '../core/db'
import { isInside, mimeOf, parseRange } from '../core/media'
import { thumbnail, dominantColour } from '../core/thumbs'
import { IPC, MEDIA_SCHEME } from '../shared/ipc'
import type { EnvStatus, HostRequest, JobSummary, RemoteCommand } from '../shared/ipc'
import type { AutoSubOptions, ScriptSubOptions, CoverItem, CoverSaveItem, SubExportItem, Cue, GlossaryEntry, RenameItem, SePref, Settings, SubLang, ToolResult, WavItem, WhisperModelId } from '../shared/types'

export interface EnvHostOptions {
  dataDir: string
  appName: string // shown to the other app while this one holds the data folder
  appVersion: string
  embedded?: boolean
  // Open the data folder only when the Env screen first asks (Halftone: the
  // standalone app stays usable until Env is opened inside Halftone).
  lazy?: boolean
  window: () => BrowserWindow | null // parent for dialogs
  send: (channel: string, payload: unknown) => void // to the Env renderer
  onTheme?: (theme: Settings['theme']) => void
  onSettingsSaved?: (patch: Partial<Settings>, s: Settings) => void
  encodeWorker?: string // built encodeWorker.js (default: next to this file)
  // Halftone: its separate big window (shows the panel's player) and what the
  // screens ask of it (big window / panel / bar / close)
  remote?: () => Electron.WebContents | null
  onHostRequest?: (r: HostRequest, from: 'panel' | 'window') => void
}

let opts: EnvHostOptions
let core: EnvCore
let status: EnvStatus = { ready: false }

const send = (channel: string, payload?: unknown): void => opts.send(channel, payload)
const dlgOpen = (o: OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> => {
  const w = opts.window()
  return w ? dialog.showOpenDialog(w, o) : dialog.showOpenDialog(o)
}

// env-media://f/<base64url path> — library files for <audio>/<video>/<img>,
// with Range support (without it the player can't seek); env-media://t/… — a
// cached small JPEG of an image. Only files inside a library folder. Register
// before app ready.
export const ENV_SCHEME: CustomScheme = {
  scheme: MEDIA_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
}

function handleMedia(): void {
  protocol.handle(MEDIA_SCHEME, async (req) => {
    if (!status.ready) return new Response('not ready', { status: 503 })
    let path: string
    let thumb = false
    try {
      const u = new URL(req.url)
      thumb = u.hostname === 't'
      path = Buffer.from(u.pathname.replace(/^\//, ''), 'base64url').toString('utf-8')
    } catch {
      return new Response('bad request', { status: 400 })
    }
    const allowed = [...core.settings().libraryDirs, core.paths.coversDir].filter(Boolean)
    if (!allowed.some((r) => isInside(path, r))) return new Response('forbidden', { status: 403 })
    if (thumb) {
      try {
        path = await thumbnail(path, core.paths.thumbsDir)
      } catch {
        return new Response('not an image', { status: 415 })
      }
    }
    let size: number
    try {
      size = (await fsp.stat(path)).size
    } catch {
      return new Response('not found', { status: 404 })
    }
    const header = req.headers.get('range')
    const range = parseRange(header, size)
    if (header && !range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    const start = range?.start ?? 0
    const end = range?.end ?? size - 1
    const type = mimeOf(path)
    const headers: Record<string, string> = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(size ? end - start + 1 : 0),
      'Cache-Control': type.startsWith('image/') ? 'public, max-age=86400' : 'no-cache'
    }
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    const body = size ? (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream) : null
    return new Response(body, { status: range ? 206 : 200, headers })
  })
}

const changed = (): void => send(IPC.libraryChanged)

async function dlsiteJob(ids: number[] | null, background = false): Promise<JobSummary> {
  try {
    const r = await core.runDlsite(ids, background).done
    changed()
    const parts = [`DLsite 작품 정보 ${r.found}개`]
    if (r.missing) parts.push(`찾지 못한 작품 ${r.missing}개`)
    if (r.failed) parts.push(`연결 실패 ${r.failed}개`)
    return { ok: !r.failed, message: parts.join(', ') }
  } catch (e) {
    if (e instanceof CancelledError) return { ok: false, message: '취소했습니다.' }
    return { ok: false, message: String((e as Error)?.message ?? e) }
  }
}

async function scanJob(background = false): Promise<JobSummary> {
  try {
    const r = await core.runScan(background).done
    changed()
    // folders named only by their code: ask DLsite for a title
    const codeOnly = core.codeOnlyWorks()
    if (codeOnly.length) void dlsiteJob(codeOnly, true)
    const parts = [`작품 ${r.works}개`]
    if (r.removed) parts.push(`없어진 작품 ${r.removed}개 정리`)
    if (r.failed.length) parts.push(`${r.failed.length}개 실패`)
    return { ok: !r.failed.length, message: parts.join(', ') }
  } catch (e) {
    changed()
    if (e instanceof CancelledError) return { ok: false, message: '취소했습니다.' }
    return { ok: false, message: String((e as Error)?.message ?? e) }
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.addLibraryDir, (_e, dir: string) => {
    const dirs = core.settings().libraryDirs
    if (!dirs.some((d) => isInside(dir, d))) core.saveSettings({ libraryDirs: [...dirs.filter((d) => !isInside(d, dir)), dir] })
    return scanJob()
  })
  ipcMain.handle(IPC.removeLibraryDir, (_e, dir: string) => {
    core.saveSettings({ libraryDirs: core.settings().libraryDirs.filter((d) => d !== dir) })
    return scanJob()
  })
  ipcMain.handle(IPC.scan, () => scanJob())
  ipcMain.handle(IPC.works, () => core.works())
  ipcMain.handle(IPC.work, (_e, id: number) => core.work(id))
  ipcMain.handle(IPC.setWorkPrefs, (_e, id: number, p: { sePref?: SePref; edition?: string }) => core.setWorkPrefs(id, p))
  ipcMain.handle(IPC.saveProgress, (_e, p: ProgressUpdate) => core.saveProgress(p))
  ipcMain.handle(IPC.resetProgress, (_e, id: number) => core.resetProgress(id))
  ipcMain.handle(IPC.addBookmark, (_e, w: number, k: string, p: number, n: string) => core.addBookmark(w, k, p, n))
  ipcMain.handle(IPC.renameBookmark, (_e, id: number, n: string) => core.renameBookmark(id, n))
  ipcMain.handle(IPC.deleteBookmark, (_e, id: number) => core.deleteBookmark(id))
  ipcMain.handle(IPC.setFavorite, (_e, ids: number[], on: boolean) => core.setFavorite(ids, on))
  ipcMain.handle(IPC.setRank, (_e, ids: number[], r: number) => core.setRank(ids, r))
  ipcMain.handle(IPC.groups, () => core.groups())
  ipcMain.handle(IPC.createGroup, (_e, n: string, ids?: number[]) => core.createGroup(n, ids))
  ipcMain.handle(IPC.renameGroup, (_e, id: number, n: string) => core.renameGroup(id, n))
  ipcMain.handle(IPC.deleteGroup, (_e, id: number) => core.deleteGroup(id))
  ipcMain.handle(IPC.setGroupMembership, (_e, ids: number[], g: number, on: boolean) => core.setGroupMembership(ids, g, on))
  const inLibrary = (p: string): boolean => core.settings().libraryDirs.some((r) => isInside(p, r))
  ipcMain.handle(IPC.readSubtitle, (_e, p: string) => {
    const app = p.startsWith('envsub:') ? p.slice(p.indexOf(':', 7) + 1) : null
    if (!inLibrary(app ?? p)) throw new Error('라이브러리 밖의 파일입니다')
    return core.readSubtitle(p)
  })
  ipcMain.handle(IPC.saveSubtitle, (_e, id: number, lang: SubLang, cues: Cue[], ow?: boolean) => core.saveSubtitle(id, lang, cues, ow))
  ipcMain.handle(IPC.setSubOffset, (_e, w: number, k: string, o: number) => core.setSubOffset(w, k, o))

  // 파일 정리: files changed → rescan so the library follows.
  const tool = async (p: Promise<ToolResult>): Promise<ToolResult> => {
    try {
      const r = await p
      await scanJob()
      return r
    } catch (e) {
      if (e instanceof CancelledError) return { ok: false, message: '취소했습니다.', done: 0, failed: [] }
      return { ok: false, message: String((e as Error)?.message ?? e), done: 0, failed: [] }
    }
  }
  const trash = (p: string): Promise<void> => shell.trashItem(p)
  ipcMain.handle(IPC.planWav, (_e, ids: number[] | null) => core.planWav(ids).done)
  ipcMain.handle(IPC.runWav, (_e, items: WavItem[]) => tool(core.runWav(items, trash).done))
  ipcMain.handle(IPC.planCover, (_e, ids: number[] | null) => core.planCover(ids).done)
  ipcMain.handle(IPC.runCover, (_e, items: CoverItem[]) => tool(core.runCover(items).done))
  ipcMain.handle(IPC.planRename, (_e, ids: number[] | null, mode?: 'repair' | 'translate' | 'original') => core.planRename(ids, mode).done)
  // a cover's main colour: only pictures of the library or DLsite covers
  ipcMain.handle(IPC.coverColour, (_e, p: string) =>
    inLibrary(p) || (core.paths.coversDir && isInside(p, core.paths.coversDir)) ? dominantColour(p) : null
  )
  ipcMain.handle(IPC.restoreSubs, async (_e, ids: number[] | null) => {
    const r = await core.restoreSubs(ids).done
    changed()
    return r
  })
  ipcMain.handle(IPC.planSubExport, (_e, ids: number[] | null) => core.planSubExport(ids).done)
  ipcMain.handle(IPC.runSubExport, (_e, items: SubExportItem[]) => tool(core.runSubExport(items).done))
  ipcMain.handle(IPC.planCoverSave, (_e, ids: number[] | null) => core.planCoverSave(ids).done)
  ipcMain.handle(IPC.runCoverSave, (_e, items: CoverSaveItem[]) => tool(core.runCoverSave(items).done))
  ipcMain.handle(IPC.runRename, (_e, items: RenameItem[]) => tool(core.runRename(items).done))
  ipcMain.handle(IPC.history, () => core.history())
  ipcMain.handle(IPC.fetchDlsite, (_e, ids: number[] | null) => dlsiteJob(ids))
  ipcMain.handle(IPC.showInFolder, (_e, p: string) => {
    if (core.settings().libraryDirs.some((r) => isInside(p, r))) shell.showItemInFolder(p)
  })
  ipcMain.handle(IPC.openFolder, async (_e, p: string) => {
    if (core.settings().libraryDirs.some((r) => isInside(p, r))) await shell.openPath(p)
  })
  ipcMain.handle(IPC.appInfo, () => ({
    version: opts.appVersion,
    embedded: !!opts.embedded,
    dataDir: core.paths.dataDir,
    dbPath: core.paths.dbPath,
    schemaVersion: core.schemaVersion
  }))
  ipcMain.handle(IPC.getSettings, () => core.settings())
  ipcMain.handle(IPC.saveSettings, (_e, patch: Partial<Settings>) => {
    const s = core.saveSettings(patch)
    if (patch.theme) opts.onTheme?.(patch.theme)
    opts.onSettingsSaved?.(patch, s)
    return s
  })
  ipcMain.handle(IPC.cancelJob, (_e, id: number) => core.queue.cancel(id))
  ipcMain.handle(IPC.pauseJobs, () => core.queue.pauseAll())
  ipcMain.handle(IPC.resumeJobs, () => core.queue.resumeAll())
  ipcMain.handle(IPC.cancelAllJobs, () => core.queue.cancelAll())

  // 자동 자막 · 번역
  ipcMain.handle(IPC.autoSub, async (_e, workId: number, o: AutoSubOptions): Promise<JobSummary> => {
    try {
      const r = await core.autoSub(workId, o).done
      const parts = [`자막 ${r.made}개를 만들었습니다`]
      if (r.skipped.length) parts.push(`제외 ${r.skipped.length}`)
      if (r.failed.length) parts.push(`실패 ${r.failed.length} — ${r.failed[0]}`)
      changed()
      return { ok: !r.failed.length, message: parts.join(' · ') }
    } catch (e) {
      if (e instanceof CancelledError) return { ok: false, message: '취소했습니다.' }
      return { ok: false, message: String((e as Error)?.message ?? e) }
    }
  })
  const job = async (p: Promise<unknown>, okMsg: string | ((result: unknown) => string)): Promise<JobSummary> => {
    try {
      const result = await p
      return { ok: true, message: typeof okMsg === 'string' ? okMsg : okMsg(result) }
    } catch (e) {
      if (e instanceof CancelledError) return { ok: false, message: '취소했습니다.' }
      return { ok: false, message: String((e as Error)?.message ?? e) }
    }
  }
  ipcMain.handle(IPC.engineStatus, () => core.engineStatus())
  ipcMain.handle(IPC.installEngine, () => job(core.installEngine().done, (msg) => msg as string))
  ipcMain.handle(IPC.installModel, (_e, m: WhisperModelId) => job(core.installModel(m).done, '모델을 받았습니다'))
  ipcMain.handle(IPC.removeModel, (_e, m: WhisperModelId) => core.removeModel(m))
  ipcMain.handle(IPC.importVulkanEngine, async (): Promise<JobSummary> => {
    const r = await dlgOpen({
      title: 'Vulkan으로 빌드한 whisper-cli 고르기',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'whisper-cli', extensions: ['exe'] }] : []
    })
    const file = r.canceled ? null : r.filePaths[0]
    if (!file) return { ok: false, message: '취소했습니다.' }
    try {
      await core.importEngine('vulkan', file)
      return { ok: true, message: 'Vulkan 엔진을 넣었습니다' }
    } catch (e) {
      return { ok: false, message: String((e as Error)?.message ?? e) }
    }
  })
  ipcMain.handle(IPC.testTranslator, async (): Promise<JobSummary> => {
    try {
      return { ok: true, message: `번역 확인: お兄ちゃん、おかえりなさい。 → ${await core.testTranslator()}` }
    } catch (e) {
      return { ok: false, message: String((e as Error)?.message ?? e) }
    }
  })
  ipcMain.handle(IPC.translateNames, async (_e, id: number): Promise<JobSummary> => {
    try {
      const n = await core.translateWorkNames(id).done
      changed()
      return { ok: true, message: n ? `이름 ${n}개를 번역했습니다` : '번역할 일본어 이름이 없습니다' }
    } catch (e) {
      if (e instanceof CancelledError) return { ok: false, message: '취소했습니다.' }
      return { ok: false, message: String((e as Error)?.message ?? e) }
    }
  })
  ipcMain.handle(IPC.translateNamesOf, async (_e, ids: number[], onlyMissing: boolean, foldersOnly?: boolean): Promise<JobSummary> => {
    try {
      const r = await core.translateNamesOf(ids, onlyMissing, !!foldersOnly).done
      changed()
      const parts = [r.names ? `이름 ${r.names}개를 번역했습니다` : '번역할 일본어 이름이 없습니다']
      if (r.failed.length) parts.push(`실패 ${r.failed.length} — ${r.failed[0]}`)
      return { ok: !r.failed.length, message: parts.join(' · ') }
    } catch (e) {
      return { ok: false, message: String((e as Error)?.message ?? e) }
    }
  })
  ipcMain.handle(IPC.nameStatus, (_e, ids: number[] | null, foldersOnly?: boolean) => core.nameStatus(ids, !!foldersOnly).done)
  ipcMain.handle(IPC.setCoverPref, (_e, ids: number[], pref: 'folder' | 'dlsite' | null) => (core.setCoverPref(ids, pref), changed()))
  ipcMain.handle(IPC.findScripts, (_e, id: number) => core.findScripts(id))
  ipcMain.handle(IPC.pickScript, async (_e, id: number) => {
    const r = await dlgOpen({
      title: '대본 파일 고르기',
      defaultPath: core.work(id)?.path,
      properties: ['openFile'],
      filters: [{ name: '대본 (txt · pdf · docx)', extensions: ['txt', 'pdf', 'docx'] }]
    })
    return r.canceled || !r.filePaths[0] ? null : core.scriptFromFile(r.filePaths[0])
  })
  ipcMain.handle(IPC.previewScript, (_e, id: number, src: string) => core.previewScript(id, src))
  ipcMain.handle(IPC.scriptSub, async (_e, id: number, o: ScriptSubOptions): Promise<JobSummary> => {
    try {
      const r = await core.scriptSub(id, o).done
      const parts = [`자막 ${r.made}개를 만들었습니다`]
      if (r.skipped.length) parts.push(`제외 ${r.skipped.length}`)
      if (r.failed.length) parts.push(`실패 ${r.failed.length} — ${r.failed[0]}`)
      changed()
      return { ok: !r.failed.length, message: parts.join(' · ') }
    } catch (e) {
      if (e instanceof CancelledError) return { ok: false, message: '취소했습니다.' }
      return { ok: false, message: String((e as Error)?.message ?? e) }
    }
  })
  ipcMain.handle(IPC.getGlossary, (_e, id: number | null) => core.glossaryOwn(id))
  ipcMain.handle(IPC.setGlossary, (_e, id: number | null, entries: GlossaryEntry[]) => core.setGlossary(id, entries))
  ipcMain.handle(IPC.importGlossary, async (_e, id: number | null) => {
    const r = await dlgOpen({
      title: '용어집 가져오기',
      properties: ['openFile'],
      filters: [
        { name: '텍스트 문서', extensions: ['txt', 'md', 'csv', 'tsv'] },
        { name: '모든 파일', extensions: ['*'] }
      ]
    })
    return r.canceled || !r.filePaths[0] ? null : core.importGlossary(id, r.filePaths[0])
  })
  ipcMain.on(IPC.decodeReply, (_e, r: { id: number; pcm: Int16Array | null; error?: string }) => {
    const p = decoding.get(r.id)
    if (!p) return
    decoding.delete(r.id)
    if (r.pcm) p.resolve(r.pcm instanceof Int16Array ? r.pcm : new Int16Array(r.pcm as unknown as ArrayBuffer))
    else p.reject(new Error(r.error || '음성을 읽지 못했습니다'))
  })
  ipcMain.handle(IPC.pickFolder, async () => {
    const r = await dlgOpen({ properties: ['openDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC.undo, async () => {
    const a = await core.log.undo()
    return { ok: true, label: a ? ((a.payload as { label?: string })?.label ?? a.type) : null }
  })
  ipcMain.handle(IPC.redo, async () => {
    const label = await core.log.redo()
    return { ok: true, label }
  })
  core.queue.onProgress((e) => send(IPC.progress, e))
}

// ---- data-folder lock (one app at a time) ----

const lockFile = (): string => join(opts.dataDir, 'env.lock')
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}
function takeLock(): EnvStatus {
  mkdirSync(opts.dataDir, { recursive: true })
  try {
    const l = JSON.parse(readFileSync(lockFile(), 'utf8')) as { pid: number; app: string }
    if (l.pid !== process.pid && alive(l.pid)) return { ready: false, lockedBy: l.app }
  } catch {
    // no lock / unreadable → free
  }
  writeFileSync(lockFile(), JSON.stringify({ pid: process.pid, app: opts.appName }))
  return { ready: true }
}
function releaseLock(): void {
  try {
    const l = JSON.parse(readFileSync(lockFile(), 'utf8')) as { pid: number }
    if (l.pid === process.pid) unlinkSync(lockFile())
  } catch {
    // already gone
  }
}

// Set up the IPC; open the data folder unless another app holds it (the
// renderer then shows "used by …" with a retry). Call once, after app ready.
export function initEnv(o: EnvHostOptions): EnvStatus {
  opts = o
  ipcMain.handle(IPC.status, () => (status.ready ? status : open()))
  ipcMain.handle(IPC.retryLock, () => (status.ready ? status : open()))
  ipcMain.handle(IPC.start, () => startEnv())
  // big window ⇄ panel player (Halftone)
  ipcMain.removeAllListeners(IPC.mirror)
  ipcMain.on(IPC.mirror, (_e, s: unknown) => {
    const r = o.remote?.()
    if (r && !r.isDestroyed()) r.send(IPC.mirrorIn, s)
  })
  ipcMain.removeAllListeners(IPC.remoteCmd)
  ipcMain.on(IPC.remoteCmd, (_e, c: RemoteCommand) => send(IPC.remoteCmdIn, c))
  ipcMain.removeAllListeners(IPC.hostRequest)
  ipcMain.on(IPC.hostRequest, (e, r: HostRequest) => o.onHostRequest?.(r, o.remote?.() === e.sender ? 'window' : 'panel'))
  // The media protocol is there from the start (a handler added only once the
  // data folder opens would miss the first requests in an embedding frame).
  handleMedia()
  return o.lazy ? status : open()
}

// wav → mp3 in a worker thread; cancelling terminates it.
const workerEncode: EncodeFn = (src, dst, o, signal, onProgress) =>
  new Promise((resolve, reject) => {
    const w = new Worker(opts.encodeWorker ?? join(__dirname, 'encodeWorker.js'), { workerData: { src, dst, opts: o } })
    const abort = (): void => {
      void w.terminate()
      reject(new CancelledError())
    }
    signal.addEventListener('abort', abort, { once: true })
    w.on('message', (m: { type: string; p?: number; message?: string }) => {
      if (m.type === 'progress') onProgress(m.p ?? 0)
      else {
        signal.removeEventListener('abort', abort)
        void w.terminate()
        if (m.type === 'done') resolve()
        else reject(new Error(m.message))
      }
    })
    w.on('error', (e) => {
      signal.removeEventListener('abort', abort)
      reject(e)
    })
  })

// Tracks are decoded by the screen (Web Audio reads every format Chromium
// plays): ask it, wait for the 16 kHz PCM.
const decoding = new Map<number, { resolve: (p: Int16Array) => void; reject: (e: Error) => void }>()
let decodeSeq = 0
function decodeInRenderer(path: string, signal?: AbortSignal): Promise<Int16Array> {
  return new Promise((resolve, reject) => {
    const id = ++decodeSeq
    decoding.set(id, { resolve, reject })
    signal?.addEventListener('abort', () => (decoding.delete(id), reject(new CancelledError())), { once: true })
    send(IPC.decodeRequest, { id, url: `${MEDIA_SCHEME}://f/${Buffer.from(path, 'utf-8').toString('base64url')}` })
  })
}

let opened = false
function open(): EnvStatus {
  status = takeLock()
  if (!status.ready || opened) return status
  try {
    core = new EnvCore(opts.dataDir, {
      encode: workerEncode,
      decode: decodeInRenderer,
      // Google's free endpoint answers Chromium's network stack (not Node's)
      chromiumFetch: (url, init) => net.fetch(url, init as RequestInit)
    })
  } catch (e) {
    releaseLock()
    // A newer Env (standalone or in Halftone) made this data: don't touch it.
    if (e instanceof NewerDataError) return (status = { ready: false, newerData: true })
    throw e
  }
  opened = true
  registerIpc()
  return status
}

export const envCore = (): EnvCore | null => (status.ready ? core : null)

// Background work once the Env screen is shown (idempotent): pick up works
// added or removed while the app was closed.
let started = false
export function startEnv(): void {
  if (!status.ready || started) return
  started = true
  // No scan at launch: the library is what the DB holds until the user scans
  // (설정 › 다시 스캔, F5, or adding a folder).
}

export function closeEnv(): void {
  if (opened) core.close()
  opened = false
  releaseLock()
}
