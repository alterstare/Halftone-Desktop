// Env engine entry. Pure Node (no Electron imports) so the standalone app,
// Halftone and the tests all drive the same code.
import { mkdirSync, promises as fsp, readFileSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import type { CoverItem, CoverSaveItem, Cue, Group, HistoryEntry, RenameItem, SePref, Settings, SubExportItem, SubLang, SubtitleText, ToolResult, WavItem, WorkDetail, WorkSummary } from '../shared/types'
import * as tools from './tools'
import type { EncodeFn, TrashFn } from './tools'
import { encodeWavToMp3 } from './tools/wav'
import { fetchBytes, fetchDlsite } from './dlsite'
import type { BytesFetch, JsonFetch } from './dlsite'
import { decodeText, isEnvMade, langOfName, langOfText, parseSubtitle, toVtt } from './subtitle'
import { openDb, schemaVersion } from './db'
import type { Db } from './db'
import { loadSettings, saveSettings } from './settings'
import { CancelledError, JobQueue } from './queue'
import { ActionLog } from './actionLog'
import { findWorks, scanWork, workTitle } from './library/scan'
import * as library from './library'
import type { ProgressUpdate } from './library'
import type { AsrEngine, Fetch, WhisperModel } from './asr/engines'
import { GROQ, GroqAsr, WhisperCppAsr, modelPath } from './asr/engines'
import { pcm16FromWav } from './asr/audio'
import type { EngineStatus } from './asr/install'
import { engineStatus, installCpuEngine, installModel, removeModel } from './asr/install'
import type { GlossaryEntry, Translator } from './translate'
import { TranslateStop, makeTranslator, translateLines } from './translate'
import type { AutoSubOptions, AutoSubResult, DecodeFn } from './autosub'
import { autoSubWork } from './autosub'
import { namesMap, needsTranslation, translateNames } from './names/translate'
import { findScripts, previewScript, scriptSubWork } from './script'
import type { NameStatus, ScriptPreview, ScriptSource, ScriptSubOptions, WorkContent } from '../shared/types'
import { existsSync } from 'fs'
import * as originals from './originals'

export interface CorePaths {
  dataDir: string
  dbPath: string
  modelsDir: string // whisper models (Phase 5)
  enginesDir: string // whisper.cpp binaries (Phase 5)
  backupsDir: string // original ID3 tags kept for undo (Phase 3)
  thumbsDir: string // cover thumbnails
  coversDir: string // covers from DLsite
}

export interface ScanResult {
  works: number
  removed: number
  failed: string[]
}

export class EnvCore {
  readonly db: Db
  readonly queue = new JobQueue(1)
  readonly log: ActionLog
  readonly paths: CorePaths

  // How wav → mp3 runs: the app hands over a worker-thread encoder.
  private encode: EncodeFn

  // dataDir ':memory:' → in-memory DB, no folders (tests).
  // DLsite requests (tests answer them)
  private dlGet?: JsonFetch
  private dlBytes?: BytesFetch
  // 자동 자막: how tracks become 16 kHz PCM (the app decodes in the renderer;
  // the default reads wav files only), network for engines (the app passes
  // Chromium's for Google, which answers it), engines for tests.
  private decode: DecodeFn
  private fetchFn: Fetch
  private chromiumFetch: Fetch
  private asrOverride?: AsrEngine
  private translatorOverride?: Translator

  constructor(
    dataDir: string,
    opts: {
      encode?: EncodeFn
      dlsiteGet?: JsonFetch
      dlsiteBytes?: BytesFetch
      decode?: DecodeFn
      fetch?: Fetch
      chromiumFetch?: Fetch
      asr?: AsrEngine
      translator?: Translator
    } = {}
  ) {
    this.dlGet = opts.dlsiteGet
    this.dlBytes = opts.dlsiteBytes
    this.decode = opts.decode ?? (async (p) => pcm16FromWav(await fsp.readFile(p)))
    this.fetchFn = opts.fetch ?? fetch
    this.chromiumFetch = opts.chromiumFetch ?? this.fetchFn
    this.asrOverride = opts.asr
    this.translatorOverride = opts.translator
    this.encode = opts.encode ?? ((src, dst, o, signal, onProgress) => encodeWavToMp3(src, dst, o, signal, onProgress).then(() => undefined))
    const mem = dataDir === ':memory:'
    this.paths = {
      dataDir,
      dbPath: mem ? ':memory:' : join(dataDir, 'env.db'),
      modelsDir: mem ? '' : join(dataDir, 'models'),
      enginesDir: mem ? '' : join(dataDir, 'engines'),
      backupsDir: mem ? '' : join(dataDir, 'backups'),
      thumbsDir: mem ? '' : join(dataDir, 'thumbs'),
      coversDir: mem ? '' : join(dataDir, 'covers')
    }
    if (!mem) {
      for (const d of [dataDir, this.paths.modelsDir, this.paths.enginesDir, this.paths.backupsDir, this.paths.thumbsDir, this.paths.coversDir]) mkdirSync(d, { recursive: true })
    }
    this.db = openDb(this.paths.dbPath)
    this.log = new ActionLog(this.db)
    tools.registerCoverUndo(this.log)
    tools.registerRenameUndo(this.log, (pairs) => this.relocate(pairs))
    // 자막 저장 (in the program): the previous text back, or none.
    this.log.register<{ trackPath: string; lang: SubLang; prev: string | null; label: string }>(
      'subtitle.app',
      async (p) => this.putAppSub(p.trackPath, p.lang, p.prev),
      (p) => ({
        ...p,
        prev: (this.db.prepare('SELECT vtt FROM app_subs WHERE track_path = ? AND lang = ?').get(p.trackPath, p.lang) as { vtt: string } | undefined)?.vtt ?? null
      })
    )
    // 기록한 자막 되살리기: each track's Japanese subtitle as it was before.
    this.log.register<{ label: string; items: { trackPath: string; prev: string | null }[] }>('subtitle.restore', async (p) => {
      for (const it of p.items) this.putAppSub(it.trackPath, 'ja', it.prev)
    })
    // 표지 저장: the cover files it added go again.
    this.log.register<{ label: string; items: string[] }>('tools.coversave', async (p) => {
      for (const f of p.items) await fsp.rm(f, { force: true })
    })
    // 자막 내보내기: each written file back as it was, byte for byte (another
    // program's file may be Shift-JIS / UTF-16), or gone.
    this.log.register<{ label: string; items: { to: string; prev: string | null }[] }>('tools.subexport', async (p) => {
      for (const it of p.items) {
        if (it.prev === null) await fsp.rm(it.to, { force: true })
        else await fsp.writeFile(it.to, Buffer.from(it.prev, 'base64'))
      }
    })
    // 자막 저장 (before 0.2, files next to the audio): put the old file back (or remove the new one).
    this.log.register<{ path: string; prev: string | null; trackId: number; lang: SubLang; label: string }>(
      'subtitle.save',
      async (p) => {
        if (p.prev === null) {
          await fsp.rm(p.path, { force: true })
          library.removeTrackSub(this.db, p.path)
        } else {
          await fsp.writeFile(p.path, p.prev, 'utf8')
          library.addTrackSub(this.db, p.trackId, { path: p.path, lang: p.lang })
        }
      },
      (p) => {
        let now: string | null = null
        try {
          now = readFileSync(p.path, 'utf8')
        } catch {
          now = null
        }
        return { ...p, prev: now }
      }
    )
  }

  get schemaVersion(): number {
    return schemaVersion(this.db)
  }

  settings(): Settings {
    return loadSettings(this.db)
  }

  saveSettings(patch: Partial<Settings>): Settings {
    return saveSettings(this.db, patch)
  }

  // ---- library ----

  // Scan every library folder (unchanged files keep their probed lengths) and
  // drop works that are gone.
  runScan(background = false): { id: number; done: Promise<ScanResult> } {
    return this.queue.add(
      '라이브러리 스캔',
      async (ctx) => {
        const roots = this.settings().libraryDirs
        const found = new Set<string>()
        const failed: string[] = []
        const all: { root: string; dir: string }[] = []
        for (const root of roots) for (const dir of await findWorks(root)) all.push({ root, dir })
        for (let i = 0; i < all.length; i++) {
          if (ctx.signal.aborted) throw new Error('cancelled')
          const { root, dir } = all[i]
          ctx.report(i, all.length)
          try {
            const id = library.saveWork(this.db, root, await scanWork(dir, library.knownProbes(this.db, dir)))
            found.add(dir)
            // 원래 이름 기록: names / Japanese subtitles not seen before
            await originals.recordWork(this.db, id).catch(() => false)
            await this.scanContent(id).catch(() => undefined)
          } catch (e) {
            failed.push(`${dir}: ${String((e as Error)?.message ?? e)}`)
          }
        }
        ctx.report(all.length, all.length)
        // A failed work keeps its old entry.
        for (const f of failed) found.add(f.slice(0, f.indexOf(': ')))
        return { works: found.size, removed: library.pruneWorks(this.db, roots, found), failed }
      },
      { background }
    )
  }

  // 언어 분류: the scripts (by language) and the subtitle files next to the
  // audio (by language; Envelope's own are marked) — the program's own
  // subtitles are added when listing.
  private async scanContent(id: number): Promise<void> {
    const d = this.work(id)
    if (!d) return
    const scripts = [...new Set((await findScripts(d)).map((s) => s.lang))].filter((l): l is 'ja' | 'ko' => l === 'ja' || l === 'ko')
    const subs: WorkContent['subs'] = {}
    const seen = new Set<string>()
    for (const g of d.groups)
      for (const v of g.versions)
        for (const f of v.subs) {
          if (f.path.startsWith(library.APP_SUB) || seen.has(f.path)) continue
          seen.add(f.path)
          let text = ''
          try {
            text = decodeText(await fsp.readFile(f.path))
          } catch {
            continue
          }
          const lang = f.lang === 'ja' || f.lang === 'ko' ? f.lang : langOfText(parseSubtitle(text, extname(f.path)).map((c) => c.text).join(' '))
          if (lang !== 'ja' && lang !== 'ko') continue
          subs[lang] = subs[lang] === 'user' || !isEnvMade(text) ? 'user' : 'app'
        }
    this.db.prepare('UPDATE works SET content_json = ? WHERE id = ?').run(JSON.stringify({ scripts, subs }), id)
  }

  works(): WorkSummary[] {
    return library.listWorks(this.db, this.settings())
  }

  work(id: number): WorkDetail | null {
    return library.workDetail(this.db, id, this.settings())
  }

  setWorkPrefs(id: number, p: { sePref?: SePref; edition?: string }): void {
    library.setWorkPrefs(this.db, id, p)
  }

  saveProgress(p: ProgressUpdate): void {
    library.saveProgress(this.db, p)
  }

  resetProgress(workId: number): void {
    library.resetProgress(this.db, workId)
  }

  // ---- 북마크 ----

  addBookmark(workId: number, groupKey: string, position: number, name: string): number {
    return library.addBookmark(this.db, workId, groupKey, position, name)
  }
  renameBookmark(id: number, name: string): void {
    library.renameBookmark(this.db, id, name)
  }
  deleteBookmark(id: number): void {
    library.deleteBookmark(this.db, id)
  }

  // ---- 자동 자막 · 번역 (Phase 5) ----

  // The speech engine the settings ask for (Groq only when sending audio out
  // is allowed).
  asrEngine(): AsrEngine {
    if (this.asrOverride) return this.asrOverride
    const s = this.settings()
    if (s.asrEngine === 'groq') {
      if (!s.allowAudioUpload) throw new Error('설정에서 "음성을 밖으로 보내기"를 켜야 Groq로 받아쓸 수 있습니다')
      return new GroqAsr(s.groqApiKey, this.fetchFn)
    }
    return new WhisperCppAsr(this.paths.enginesDir, modelPath(this.paths.modelsDir, s.localModel), s.localDevice)
  }

  translator(): Translator {
    if (this.translatorOverride) return this.translatorOverride
    const s = this.settings()
    if (!s.allowTextUpload) throw new Error('설정에서 "글자를 밖으로 보내기"를 켜야 번역할 수 있습니다')
    return makeTranslator(s, this.fetchFn, this.chromiumFetch)
  }

  // Common entries (work_id NULL) + the work's own; the work's win.
  glossary(workId: number | null): GlossaryEntry[] {
    const rows = this.db
      .prepare('SELECT work_id, source, target FROM glossary WHERE work_id IS NULL OR work_id = ? ORDER BY work_id IS NOT NULL, id')
      .all(workId ?? -1) as { work_id: number | null; source: string; target: string }[]
    const m = new Map<string, string>()
    for (const r of rows) m.set(r.source, r.target)
    return [...m].map(([source, target]) => ({ source, target }))
  }
  glossaryOwn(workId: number | null): GlossaryEntry[] {
    return this.db
      .prepare(`SELECT source, target FROM glossary WHERE ${workId === null ? 'work_id IS NULL' : 'work_id = ?'} ORDER BY id`)
      .all(...(workId === null ? [] : [workId])) as GlossaryEntry[]
  }
  setGlossary(workId: number | null, entries: GlossaryEntry[]): void {
    this.db.transaction(() => {
      if (workId === null) this.db.prepare('DELETE FROM glossary WHERE work_id IS NULL').run()
      else this.db.prepare('DELETE FROM glossary WHERE work_id = ?').run(workId)
      const put = this.db.prepare('INSERT INTO glossary (work_id, source, target) VALUES (?, ?, ?)')
      for (const e of entries) if (e.source.trim() && e.target.trim()) put.run(workId, e.source.trim(), e.target.trim())
    })()
  }

  // One job per work: transcribe and/or translate its tracks.
  autoSub(workId: number, opts: AutoSubOptions): { id: number; done: Promise<AutoSubResult> } {
    const w = this.work(workId)
    if (!w) throw new Error('작품을 찾지 못했습니다')
    const asr = opts.transcribe ? this.asrEngine() : null
    const translator = opts.translate && w.lang !== 'ko-voice' ? this.translator() : null
    const s = this.settings()
    return this.queue.add(`자동 자막 · ${w.title}`, (ctx) =>
      autoSubWork(
        this.db,
        w,
        {
          decode: this.decode,
          asr,
          maxChunkS: s.asrEngine === 'groq' ? GROQ.maxChunkS : 1800,
          translator,
          glossary: this.glossary(workId),
          prompt: s.translatePrompt,
          readSub: (p) => this.readSubtitle(p),
          saveSub: (id, lang, cues, overwrite) => this.saveSubtitle(id, lang, cues, overwrite)
        },
        opts,
        ctx
      )
    )
  }

  // 이름 번역: the work's title and every folder / file name under it, one
  // batch (one context: character names and terms stay consistent).
  // onlyMissing: just the names not translated yet.
  translateWorkNames(workId: number, onlyMissing = false): { id: number; done: Promise<number> } {
    const w = this.workRow(workId)
    const tr = this.translator()
    return this.queue.add(`이름 번역 · ${w.title}`, async (ctx) => {
      ctx.report(0, 0, `이름 번역 · ${w.title} · 이름 읽기`)
      let items = await tools.nameItemsOf(w)
      if (onlyMissing) {
        const have = namesMap(this.db)
        items = items.filter((x) => !have.has(x.path))
      }
      let last = { d: 0, t: 0 }
      return translateNames(
        this.db,
        items,
        tr,
        this.glossary(workId),
        ctx.signal,
        (d, t) => ((last = { d, t }), ctx.report(d, t, `이름 번역 · ${w.title}`)),
        (s) => ctx.report(last.d, last.t, s ? `이름 번역 · ${w.title} · 사용 한도 대기 ${s}초` : `이름 번역 · ${w.title}`)
      )
    })
  }

  // Several works, one job each (so the job list shows which one is going).
  translateNamesOf(ids: number[], onlyMissing = true): { ids: number[]; done: Promise<{ names: number; failed: string[] }> } {
    const jobs = ids.map((id) => ({ id, job: this.translateWorkNames(id, onlyMissing) }))
    // the engine refused (blocked / daily limit): the works still waiting
    // would only be refused too
    for (const j of jobs) j.job.done.catch((e) => e instanceof TranslateStop && jobs.forEach((o) => o !== j && this.queue.cancel(o.job.id)))
    const done = Promise.allSettled(jobs.map((j) => j.job.done)).then((rs) => {
      let names = 0
      const failed: string[] = []
      rs.forEach((r, i) => {
        if (r.status === 'fulfilled') names += r.value
        else if (!(r.reason instanceof CancelledError)) failed.push(`${this.workRow(jobs[i].id).title}: ${String((r.reason as Error)?.message ?? r.reason)}`)
      })
      return { names, failed }
    })
    return { ids: jobs.map((j) => j.job.id), done }
  }

  // Per work: names with Japanese in them, and how many have no translation.
  nameStatus(ids: number[] | null): { id: number; done: Promise<NameStatus[]> } {
    return this.queue.add('이름 번역 확인', async (ctx) => {
      const rows = (this.db.prepare('SELECT id FROM works ORDER BY title').all() as { id: number }[]).filter((w) => !ids || ids.includes(w.id)).map((w) => this.workRow(w.id))
      const have = namesMap(this.db)
      const out: NameStatus[] = []
      for (let i = 0; i < rows.length; i++) {
        if (ctx.signal.aborted) throw new CancelledError()
        ctx.report(i, rows.length)
        const w = rows[i]
        let items: { path: string; name: string }[]
        try {
          items = (await tools.nameItemsOf(w)).filter((x) => needsTranslation(x.name))
        } catch {
          continue
        }
        out.push({ workId: w.id, title: this.work(w.id)?.title ?? w.title, total: items.length, missing: items.filter((x) => !have.has(x.path)).length })
      }
      return out
    })
  }

  // A work's folder and the title 이름 번역 works on (see titleToTranslate).
  private workRow(id: number): { id: number; path: string; title: string } {
    const w = this.db.prepare('SELECT id, path, title, code, dl_title FROM works WHERE id = ?').get(id) as
      | { id: number; path: string; title: string; code: string | null; dl_title: string | null }
      | undefined
    if (!w) throw new Error('작품을 찾지 못했습니다')
    return { id: w.id, path: w.path, title: library.titleToTranslate(w) }
  }

  // ---- 대본 기반 자막 (Phase 6) ----

  async findScripts(workId: number): Promise<ScriptSource[]> {
    const w = this.work(workId)
    return w ? findScripts(w) : []
  }
  async previewScript(workId: number, sourceId: string): Promise<ScriptPreview[]> {
    const w = this.work(workId)
    const src = w && (await findScripts(w)).find((s) => s.id === sourceId)
    if (!w || !src) throw new Error('대본을 찾지 못했습니다')
    return previewScript(w, src)
  }

  // Engines for script timings: Groq when it is the speech engine; with the
  // GPU build and the big model just that one (it hears far better — the
  // small ones turn moans into endless "ううう…" — so retrying with them
  // only costs time); otherwise the small models, tiny first (fetched when
  // missing; base / small / large join the retries once downloaded).
  private async alignEngines(ctx: { signal: AbortSignal; report: (d: number, t: number, l?: string, u?: 'bytes') => void }): Promise<AsrEngine[]> {
    if (this.asrOverride) return [this.asrOverride]
    const s = this.settings()
    if (s.asrEngine === 'groq') return [this.asrEngine()]
    const make = (m: WhisperModel): AsrEngine => new WhisperCppAsr(this.paths.enginesDir, modelPath(this.paths.modelsDir, m), s.localDevice)
    const gpu = s.localDevice === 'auto' && this.engineStatus().vulkan
    if (gpu && existsSync(modelPath(this.paths.modelsDir, 'large-v3-turbo-q5_0'))) return [make('large-v3-turbo-q5_0')]
    if (!existsSync(modelPath(this.paths.modelsDir, 'tiny')))
      await installModel(this.paths.modelsDir, 'tiny', this.fetchFn, (d, t) => ctx.report(d, t, '모델 받기 · tiny', 'bytes'), ctx.signal)
    return (['tiny', 'base', 'small', 'large-v3-turbo-q5_0'] as WhisperModel[]).filter((m) => existsSync(modelPath(this.paths.modelsDir, m))).map(make)
  }

  scriptSub(workId: number, opts: ScriptSubOptions): { id: number; done: Promise<AutoSubResult> } {
    const w = this.work(workId)
    if (!w) throw new Error('작품을 찾지 못했습니다')
    const s = this.settings()
    return this.queue.add(`대본 자막 · ${w.title}`, async (ctx) => {
      const src = (await findScripts(w)).find((x) => x.id === opts.sourceId)
      if (!src) throw new Error('대본을 찾지 못했습니다')
      const translator = src.lang !== 'ko' && opts.translate ? this.translator() : null
      return scriptSubWork(
        this.db,
        w,
        src,
        {
          decode: this.decode,
          alignEngines: () => this.alignEngines(ctx),
          asr: async () => this.asrEngine(),
          maxChunkS: s.asrEngine === 'groq' ? GROQ.maxChunkS : 1800,
          translator,
          glossary: this.glossary(workId),
          prompt: s.translatePrompt,
          readSub: (p) => this.readSubtitle(p),
          saveSub: (id, lang, cues, overwrite) => this.saveSubtitle(id, lang, cues, overwrite)
        },
        opts,
        ctx
      )
    })
  }

  // A one-line check that the translation engine and its key work.
  async testTranslator(): Promise<string> {
    const out = await translateLines(['お兄ちゃん、おかえりなさい。'], this.translator(), { kind: 'subtitle', glossary: [], prompt: '' })
    if (!out[0]) throw new Error('번역 결과가 비어 있습니다')
    return out[0]
  }

  engineStatus(): EngineStatus {
    return engineStatus(this.paths.enginesDir, this.paths.modelsDir)
  }
  installEngine(): { id: number; done: Promise<string> } {
    return this.queue.add('whisper.cpp 엔진 받기', (ctx) =>
      installCpuEngine(this.paths.enginesDir, this.fetchFn, (d, t) => ctx.report(d, t, 'whisper.cpp 엔진 받기', 'bytes'), ctx.signal)
    )
  }
  installModel(m: WhisperModel): { id: number; done: Promise<void> } {
    return this.queue.add(`모델 받기 · ${m}`, (ctx) =>
      installModel(this.paths.modelsDir, m, this.fetchFn, (d, t) => ctx.report(d, t, `모델 받기 · ${m}`, 'bytes'), ctx.signal)
    )
  }
  removeModel(m: WhisperModel): Promise<void> {
    return removeModel(this.paths.modelsDir, m)
  }
  // A whisper-cli the user built (+ the dlls next to it) → engines/whisper-<build>.
  async importEngine(build: 'vulkan' | 'cpu', file: string): Promise<void> {
    const dest = join(this.paths.enginesDir, `whisper-${build}`)
    await fsp.rm(dest, { recursive: true, force: true })
    await fsp.mkdir(dest, { recursive: true })
    const dir = dirname(file)
    for (const n of await fsp.readdir(dir)) {
      if (n === basename(file) || /\.(dll|so|dylib)$/i.test(n)) await fsp.copyFile(join(dir, n), join(dest, n === basename(file) ? (process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli') : n))
    }
  }

  // ---- 즐겨찾기 · 별점 · 그룹 ----

  setFavorite(ids: number[], on: boolean): void {
    library.setFavorite(this.db, ids, on)
  }
  setRank(ids: number[], rank: number): void {
    library.setRank(this.db, ids, rank)
  }
  groups(): Group[] {
    return library.listGroups(this.db)
  }
  createGroup(name: string, ids?: number[]): number {
    return library.createGroup(this.db, name, ids)
  }
  renameGroup(id: number, name: string): void {
    library.renameGroup(this.db, id, name)
  }
  deleteGroup(id: number): void {
    library.deleteGroup(this.db, id)
  }
  setGroupMembership(ids: number[], groupId: number, on: boolean): void {
    library.setGroupMembership(this.db, ids, groupId, on)
  }

  // ---- subtitles (Phase 2) ----

  async readSubtitle(path: string): Promise<SubtitleText> {
    const app = library.parseAppSubPath(path)
    if (app) {
      const row = this.db.prepare('SELECT vtt FROM app_subs WHERE track_path = ? AND lang = ?').get(app.trackPath, app.lang) as { vtt: string } | undefined
      if (!row) throw new Error('자막을 찾지 못했습니다')
      return { path, cues: parseSubtitle(row.vtt, '.vtt'), lang: app.lang, envMade: true }
    }
    const text = decodeText(await fsp.readFile(path))
    const cues = parseSubtitle(text, extname(path))
    return { path, cues, lang: langOfName(basename(path)) ?? langOfText(cues.map((c) => c.text).join(' ')), envMade: isEnvMade(text) }
  }

  // Save a track's subtitle INSIDE the program (outside 파일 정리 nothing in
  // the library folders changes); 파일 정리 › 자막 › 폴더 변경 writes them
  // next to the audio. One undo step. `overwrite` is kept for callers.
  async saveSubtitle(trackId: number, lang: SubLang, cues: Cue[], _overwrite = false): Promise<{ path: string; conflict: boolean }> {
    const t = library.trackById(this.db, trackId)
    if (!t) throw new Error('트랙을 찾지 못했습니다')
    const prev = (this.db.prepare('SELECT vtt FROM app_subs WHERE track_path = ? AND lang = ?').get(t.path, lang) as { vtt: string } | undefined)?.vtt ?? null
    this.putAppSub(t.path, lang, toVtt(cues))
    this.log.record('subtitle.app', { trackPath: t.path, lang, prev, label: '자막 저장' })
    return { path: library.appSubPath(lang, t.path), conflict: false }
  }

  private putAppSub(trackPath: string, lang: string, vtt: string | null): void {
    if (vtt === null) this.db.prepare('DELETE FROM app_subs WHERE track_path = ? AND lang = ?').run(trackPath, lang)
    else
      this.db
        .prepare('INSERT INTO app_subs (track_path, lang, vtt, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(track_path, lang) DO UPDATE SET vtt = excluded.vtt, updated_at = excluded.updated_at')
        .run(trackPath, lang, vtt, Date.now())
  }

  // 파일 정리 › DLsite 정보 › 폴더 변경: the fetched cover into the work folder.
  planCoverSave(ids: number[] | null): { id: number; done: Promise<CoverSaveItem[]> } {
    return this.queue.add('표지 저장 확인', async () => {
      const rows = this.db.prepare('SELECT id, path, title, dl_cover FROM works WHERE dl_cover IS NOT NULL ORDER BY title').all() as {
        id: number
        path: string
        title: string
        dl_cover: string
      }[]
      const out: CoverSaveItem[] = []
      for (const w of rows) {
        if (ids && !ids.includes(w.id)) continue
        if (!existsSync(w.dl_cover)) continue
        const ext = extname(w.dl_cover) || '.jpg'
        const to = [join(w.path, `cover${ext}`), join(w.path, `cover (DLsite)${ext}`)].find((p) => !existsSync(p))
        if (to) out.push({ id: String(w.id), workId: w.id, workTitle: this.work(w.id)?.title ?? w.title, from: w.dl_cover, to })
      }
      return out
    })
  }
  // A folder change (파일 정리 › 폴더 변경) for these works: their 원래 이름
  // 기록 is brought up to date first, and left in each work folder after
  // (envelope-original.json, unless turned off in 설정).
  private async folderChange<T>(workIds: number[], run: () => Promise<T>): Promise<T> {
    const ids = [...new Set(workIds)]
    for (const id of ids) await originals.recordWork(this.db, id).catch(() => false)
    try {
      return await run()
    } finally {
      await this.leaveRecords(ids)
    }
  }
  private async leaveRecords(ids: number[]): Promise<void> {
    if (!this.settings().originalsInFolder) return
    for (const id of ids) await originals.writeFolderRecord(this.db, id).catch(() => undefined)
  }

  runCoverSave(items: CoverSaveItem[]): { id: number; done: Promise<ToolResult> } {
    return this.queue.add('표지 저장', (ctx) => this.folderChange(items.map((x) => x.workId), async () => {
      const undo: { label: string; items: string[] } = { label: '표지 저장', items: [] }
      const failed: string[] = []
      for (let i = 0; i < items.length; i++) {
        if (ctx.signal.aborted) break
        const it = items[i]
        ctx.report(i, items.length, `표지 저장 · ${it.workTitle}`)
        try {
          if (existsSync(it.to)) throw new Error('같은 이름의 파일이 이미 있습니다')
          await fsp.copyFile(it.from, it.to)
          undo.items.push(it.to)
        } catch (e) {
          failed.push(`${it.workTitle}: ${String((e as Error)?.message ?? e)}`)
        }
      }
      if (undo.items.length) this.log.record('tools.coversave', undo)
      ctx.report(items.length, items.length)
      return { ok: !failed.length, message: `표지 ${undo.items.length}개를 작품 폴더에 저장했습니다${failed.length ? `, ${failed.length}개 실패` : ''}`, done: undo.items.length, failed }
    }), { resumable: false })
  }

  // 파일 정리 › 자막 › 폴더 변경: the program's subtitles as "<audio>.<lang>.vtt"
  // next to the audio. Another program's file of that name is listed but not
  // chosen by default (replacing it needs a tick).
  planSubExport(ids: number[] | null): { id: number; done: Promise<SubExportItem[]> } {
    return this.queue.add('자막 내보내기 확인', async () => {
      const rows = this.db
        .prepare('SELECT a.track_path, a.lang, t.work_id, w.title FROM app_subs a JOIN tracks t ON t.path = a.track_path JOIN works w ON w.id = t.work_id ORDER BY w.title, a.track_path')
        .all() as { track_path: string; lang: string; work_id: number; title: string }[]
      const out: SubExportItem[] = []
      for (const r of rows) {
        if (ids && !ids.includes(r.work_id)) continue
        const to = join(dirname(r.track_path), `${basename(r.track_path, extname(r.track_path))}.${r.lang === 'other' ? 'sub' : r.lang}.vtt`)
        let state: SubExportItem['state'] = 'new'
        try {
          state = isEnvMade(decodeText(await fsp.readFile(to))) ? 'update' : 'conflict'
        } catch {
          state = 'new'
        }
        out.push({ id: `${r.track_path}|${r.lang}`, workId: r.work_id, workTitle: r.title, trackPath: r.track_path, lang: r.lang as SubLang, to, state })
      }
      return out
    })
  }
  runSubExport(items: SubExportItem[]): { id: number; done: Promise<ToolResult> } {
    return this.queue.add('자막 내보내기', (ctx) => this.folderChange(items.map((x) => x.workId), async () => {
      const undo: { label: string; items: { to: string; prev: string | null }[] } = { label: '자막 내보내기', items: [] }
      const failed: string[] = []
      for (let i = 0; i < items.length; i++) {
        if (ctx.signal.aborted) break
        const it = items[i]
        ctx.report(i, items.length, `자막 내보내기 · ${basename(it.to)}`)
        try {
          const row = this.db.prepare('SELECT vtt FROM app_subs WHERE track_path = ? AND lang = ?').get(it.trackPath, it.lang) as { vtt: string } | undefined
          if (!row) throw new Error('자막이 없습니다')
          let prev: string | null = null // base64 of the file it replaces
          try {
            prev = (await fsp.readFile(it.to)).toString('base64')
          } catch {
            prev = null
          }
          await fsp.writeFile(it.to, row.vtt, 'utf8')
          undo.items.push({ to: it.to, prev })
        } catch (e) {
          failed.push(`${basename(it.to)}: ${String((e as Error)?.message ?? e)}`)
        }
      }
      if (undo.items.length) this.log.record('tools.subexport', undo)
      ctx.report(items.length, items.length)
      return { ok: !failed.length, message: `자막 ${undo.items.length}개를 폴더에 저장했습니다${failed.length ? `, ${failed.length}개 실패` : ''}`, done: undo.items.length, failed }
    }), { resumable: false })
  }

  setSubOffset(workId: number, groupKey: string, offset: number): void {
    library.setSubOffset(this.db, workId, groupKey, offset)
  }

  // ---- file tools (Phase 3): plan (nothing changes), then run ----
  // ids = works to look at; null = the whole library.

  planWav(ids: number[] | null): { id: number; done: Promise<WavItem[]> } {
    return this.queue.add('wav 정리 확인', (ctx) => tools.planWav(this.db, ids, ctx))
  }
  runWav(items: WavItem[], trash: TrashFn): { id: number; done: Promise<ToolResult> } {
    return this.queue.add(
      'wav 정리',
      (ctx) =>
        this.folderChange(
          items.map((x) => x.workId),
          async () => {
            try {
              return await tools.runWav(this.db, items, { encode: this.encode, trash, bitrate: this.settings().mp3Bitrate }, ctx)
            } finally {
              this.moveAppSubs(items.filter((x) => x.kind === 'convert' || x.kind === 'delete').map((x) => [x.wav, x.mp3]))
            }
          }
        ),
      { resumable: false }
    )
  }

  // The program's subtitles of a wav that went (converted / a same mp3 kept)
  // go to the mp3 — unless the mp3 has its own in that language.
  private moveAppSubs(pairs: [string, string][]): void {
    const move = this.db.prepare('UPDATE OR IGNORE app_subs SET track_path = ? WHERE track_path = ?')
    const drop = this.db.prepare('DELETE FROM app_subs WHERE track_path = ?')
    this.db.transaction(() => {
      for (const [from, to] of pairs) {
        if (existsSync(from) || !existsSync(to)) continue
        move.run(to, from)
        drop.run(from)
      }
    })()
    // the 원래 이름 기록 follows too (the wav's name, the mp3's extension)
    const gone = new Map(pairs.filter(([from, to]) => !existsSync(from) && existsSync(to)))
    originals.moveRecords(this.db, (p) => gone.get(p) ?? p)
  }
  planCover(ids: number[] | null): { id: number; done: Promise<CoverItem[]> } {
    return this.queue.add('썸네일 확인', (ctx) => tools.planCover(this.db, ids, this.settings().coverSkipExisting, ctx))
  }
  runCover(items: CoverItem[]): { id: number; done: Promise<ToolResult> } {
    return this.queue.add(
      'mp3 썸네일 넣기',
      (ctx) =>
        this.folderChange(
          items.map((x) => x.workId),
          () => tools.runCover(this.log, items, { square: this.settings().coverSquare, backupsDir: this.paths.backupsDir || this.paths.dataDir }, ctx)
        ),
      { resumable: false }
    )
  }
  planRename(ids: number[] | null, mode: 'repair' | 'translate' | 'original' = 'repair'): { id: number; done: Promise<RenameItem[]> } {
    const label = mode === 'translate' ? '이름 바꾸기 확인' : mode === 'original' ? '원래 이름 확인' : '이름 복구 확인'
    return this.queue.add(label, async (ctx) => {
      if (mode === 'original')
        for (const w of this.db.prepare('SELECT id FROM works').all() as { id: number }[])
          if (!ids || ids.includes(w.id)) await originals.recordWork(this.db, w.id).catch(() => false)
      return tools.planRename(this.db, ids, ctx, mode, (w) => originals.originalNames(this.db, w))
    })
  }
  runRename(items: RenameItem[]): { id: number; done: Promise<ToolResult> } {
    const label = items.some((x) => x.original) ? '원래 이름으로 되돌리기' : items.some((x) => x.translated) ? '이름 바꾸기' : '이름 복구'
    return this.queue.add(
      label,
      (ctx) => this.folderChange(items.map((x) => x.workId), () => tools.runRename(this.log, items, ctx, (pairs, its) => this.relocate(pairs, its))),
      { resumable: false }
    )
  }

  // 파일 정리 › 자막 › 프로그램 내 변경: the Japanese subtitles in the 원래 이름
  // 기록 back into the program (where a track's Japanese subtitle now differs).
  // One undo step.
  restoreSubs(ids: number[] | null): { id: number; done: Promise<ToolResult> } {
    return this.queue.add('기록한 자막 되살리기', async (ctx) => {
      const undo: { label: string; items: { trackPath: string; prev: string | null }[] } = { label: '기록한 일본어 자막 되살리기', items: [] }
      const ws = this.db.prepare('SELECT id, path FROM works').all() as { id: number; path: string }[]
      const todo = ws.filter((w) => !ids || ids.includes(w.id))
      for (let i = 0; i < todo.length; i++) {
        ctx.report(i, todo.length)
        for (const s of await originals.recordedSubs(this.db, todo[i])) {
          if (!this.db.prepare('SELECT 1 FROM tracks WHERE path = ?').get(s.trackPath)) continue
          const prev = (this.db.prepare("SELECT vtt FROM app_subs WHERE track_path = ? AND lang = 'ja'").get(s.trackPath) as { vtt: string } | undefined)?.vtt ?? null
          if (prev === s.vtt) continue
          if (prev === null && (await this.currentJa(s.trackPath)) === s.vtt) continue // the file next to it is that subtitle
          this.putAppSub(s.trackPath, 'ja', s.vtt)
          undo.items.push({ trackPath: s.trackPath, prev })
        }
      }
      if (undo.items.length) this.log.record('subtitle.restore', undo)
      ctx.report(todo.length, todo.length)
      return { ok: true, message: undo.items.length ? `일본어 자막 ${undo.items.length}개를 되살렸습니다` : '되살릴 자막이 없습니다 (기록이 없거나 지금 자막과 같습니다)', done: undo.items.length, failed: [] }
    })
  }
  // A track's Japanese subtitle file next to it, as vtt (null: none).
  private async currentJa(trackPath: string): Promise<string | null> {
    const t = this.db.prepare('SELECT subs_json FROM tracks WHERE path = ?').get(trackPath) as { subs_json: string } | undefined
    const f = t && (JSON.parse(t.subs_json) as { path: string; lang: string }[]).find((x) => x.lang === 'ja')
    if (!f) return null
    try {
      return toVtt(parseSubtitle(decodeText(await fsp.readFile(f.path)), extname(f.path)))
    } catch {
      return null
    }
  }

  // After folders / files were renamed (or a rename undone): the works and
  // tracks follow their new paths, so listening progress, bookmarks, sync
  // offsets and name translations stay with them (a renamed track gets a new
  // group key — those rows move to it).
  private async relocate(pairs: { from: string; to: string }[], items?: RenameItem[]): Promise<void> {
    const under = (p: string, dir: string): boolean => p === dir || p.startsWith(dir + '\\') || p.startsWith(dir + '/')
    const map = (p: string): string => {
      let q = p
      for (const { from, to } of pairs) if (under(q, from)) q = to + q.slice(from.length)
      return q
    }
    originals.moveRecords(this.db, map)
    const works = this.db.prepare('SELECT id, path, root FROM works').all() as { id: number; path: string; root: string }[]
    const touched = works.filter((w) => pairs.some((x) => under(x.from, w.path) || under(w.path, x.from))).map((w) => w.id)
    for (const w of works) {
      if (!pairs.some((x) => under(x.from, w.path) || under(w.path, x.from))) continue
      const old = this.db.prepare('SELECT path, group_key AS gk FROM tracks WHERE work_id = ?').all(w.id) as { path: string; gk: string }[]
      const known = new Map([...library.knownProbes(this.db, w.path)].map(([p, v]) => [map(p), { ...v, path: map(p) }]))
      const path = map(w.path)
      this.db.prepare('UPDATE works SET path = ? WHERE id = ?').run(path, w.id)
      try {
        library.saveWork(this.db, w.root, await scanWork(path, known))
      } catch {
        continue // gone or unreadable: the next scan sorts it out
      }
      const now = new Map(
        (this.db.prepare('SELECT path, group_key AS gk FROM tracks WHERE work_id = ?').all(w.id) as { path: string; gk: string }[]).map((t) => [t.path, t.gk])
      )
      const keys = new Map<string, string>()
      for (const t of old) {
        const gk = now.get(map(t.path))
        if (gk && gk !== t.gk && !keys.has(t.gk)) keys.set(t.gk, gk)
      }
      if (!keys.size) continue
      this.db.transaction(() => {
        // through a temporary key, so a → b and b → c don't run into each other
        for (const pass of [0, 1])
          for (const [a, b] of keys) {
            const from = pass ? `\u0001${b}` : a
            const to = pass ? b : `\u0001${b}`
            this.db.prepare('UPDATE OR IGNORE progress SET group_key = ? WHERE work_id = ? AND group_key = ?').run(to, w.id, from)
            this.db.prepare('UPDATE OR IGNORE track_prefs SET group_key = ? WHERE work_id = ? AND group_key = ?').run(to, w.id, from)
            this.db.prepare('UPDATE bookmarks SET group_key = ? WHERE work_id = ? AND group_key = ?').run(to, w.id, from)
            this.db.prepare('UPDATE works SET last_group = ? WHERE id = ? AND last_group = ?').run(to, w.id, from)
          }
        this.db.prepare("DELETE FROM progress WHERE work_id = ? AND substr(group_key, 1, 1) = char(1)").run(w.id)
        this.db.prepare("DELETE FROM track_prefs WHERE work_id = ? AND substr(group_key, 1, 1) = char(1)").run(w.id)
      })()
    }
    // program subtitles follow their audio
    for (const r of this.db.prepare('SELECT track_path, lang FROM app_subs').all() as { track_path: string; lang: string }[]) {
      const q = map(r.track_path)
      if (q !== r.track_path) this.db.prepare('UPDATE OR REPLACE app_subs SET track_path = ? WHERE track_path = ? AND lang = ?').run(q, r.track_path, r.lang)
    }
    // name translations move with their files; a name renamed to its
    // translation now shows what it was renamed to
    const renamed = new Map((items ?? []).filter((x) => x.translated).map((x) => [x.to, x]))
    const rows = this.db.prepare('SELECT path, translated FROM names').all() as { path: string; translated: string }[]
    this.db.transaction(() => {
      for (const r of rows) {
        const q = map(r.path)
        const it = renamed.get(q)
        const shown = it ? (it.work ? workTitle(basename(q)).title : tools.splitSuffix(basename(q), it.dir).stem) : r.translated
        if (q !== r.path || shown !== r.translated) {
          if (q !== r.path) this.db.prepare('DELETE FROM names WHERE path = ?').run(q)
          this.db.prepare('UPDATE names SET path = ?, translated = ? WHERE path = ?').run(q, shown, r.path)
        }
      }
    })()
    // a rename (or its undo) is a folder change: the record goes with it
    await this.leaveRecords(touched)
  }

  // ---- 작품 정보 (DLsite) ----

  // ids = works to ask about (null = every work with a code not asked yet).
  // One request a second.
  runDlsite(ids: number[] | null, background = false): { id: number; done: Promise<{ found: number; missing: number; failed: number }> } {
    return this.queue.add(
      'DLsite 작품 정보',
      async (ctx) => {
        const rows = (
          ids
            ? this.db.prepare(`SELECT id, code FROM works WHERE code IS NOT NULL AND id IN (${ids.map(() => '?').join(',')})`).all(...ids)
            : // not asked yet — or asked before tags were kept (found, no tags)
              this.db.prepare('SELECT id, code FROM works WHERE code IS NOT NULL AND (dl_at IS NULL OR (dl_title IS NOT NULL AND (dl_tags IS NULL OR dl_lang IS NULL OR dl_age IS NULL)))').all()
        ) as { id: number; code: string }[]
        let found = 0
        let missing = 0
        let failed = 0
        const put = this.db.prepare('UPDATE works SET dl_title = ?, dl_circle = ?, dl_voices = ?, dl_tags = ?, dl_lang = ?, dl_age = ?, dl_at = ? WHERE id = ?')
        const putCover = this.db.prepare('UPDATE works SET dl_cover = ? WHERE id = ?')
        for (let i = 0; i < rows.length; i++) {
          if (ctx.signal.aborted) break
          ctx.report(i, rows.length)
          try {
            const info = await fetchDlsite(rows[i].code, this.dlGet, ctx.signal)
            if (info) found++
            else missing++
            put.run(info?.title ?? null, info?.circle ?? null, info ? JSON.stringify(info.voices) : null, info ? JSON.stringify(info.tags) : null, info ? (info.lang ?? '') : null, info ? (info.age ?? '') : null, Date.now(), rows[i].id)
            if (info?.image && this.paths.coversDir) {
              // cover kept in the data folder — the work's own folder is not touched
              const file = join(this.paths.coversDir, `${info.code}${extname(new URL(info.image).pathname) || '.jpg'}`)
              await fsp.writeFile(file, await (this.dlBytes ?? fetchBytes)(info.image, ctx.signal))
              putCover.run(file, rows[i].id)
            }
          } catch {
            failed++ // network: ask again next time
          }
          if (i < rows.length - 1 && !this.dlGet) await new Promise((r) => setTimeout(r, 1000))
        }
        ctx.report(rows.length, rows.length)
        return { found, missing, failed }
      },
      { background }
    )
  }

  // Works DLsite should fill in on its own: named only by their code, or
  // without any picture (not asked before).
  codeOnlyWorks(): number[] {
    return (
      this.db
        .prepare("SELECT id FROM works WHERE code IS NOT NULL AND dl_at IS NULL AND (title = code OR title = '' OR cover_path IS NULL)")
        .all() as { id: number }[]
    ).map((r) => r.id)
  }

  // Changes made to files, newest first. Only the newest undoable one can be
  // undone (the log goes back one step at a time).
  history(limit = 30): HistoryEntry[] {
    const kinds: Record<string, HistoryEntry['kind']> = {
      'subtitle.save': 'subtitle',
      'subtitle.app': 'subtitle',
      'tools.subexport': 'subtitle',
      'subtitle.restore': 'subtitle',
      'tools.coversave': 'cover',
      'tools.cover': 'cover',
      'tools.rename': 'rename'
    }
    const logged = this.log.recent(limit).filter((a) => a.type in kinds)
    const newest = this.log.recent(1)[0]
    const out: HistoryEntry[] = logged.map((a) => {
      const p = a.payload as { label?: string; items?: unknown[]; path?: string; trackPath?: string; lang?: string }
      const n = p.items?.length
      const LANG: Record<string, string> = { ja: '일본어', ko: '한국어', other: '기타' }
      const summary =
        a.type === 'subtitle.save'
          ? `자막 저장 · ${(p.path ?? '').split(/[\\/]/).pop()}`
          : a.type === 'subtitle.app'
            ? `자막 저장 · ${(p.trackPath ?? '').split(/[\\/]/).pop()} (${LANG[p.lang ?? ''] ?? p.lang})`
            : `${p.label ?? a.type}${n ? ` · ${n}개` : ''}`
      return { id: `log:${a.id}`, kind: kinds[a.type], summary, createdAt: a.createdAt, undoable: newest?.id === a.id }
    })
    const files = this.db.prepare('SELECT id, kind, summary, created_at FROM file_history ORDER BY id DESC LIMIT ?').all(limit) as {
      id: number
      kind: string
      summary: string
      created_at: number
    }[]
    for (const r of files) out.push({ id: `file:${r.id}`, kind: r.kind as HistoryEntry['kind'], summary: r.summary, createdAt: r.created_at, undoable: false })
    return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
  }

  close(): void {
    this.db.close()
  }
}

export { DEFAULT_SETTINGS } from './settings'
export { JobQueue, CancelledError } from './queue'
export { ActionLog } from './actionLog'
export type { ProgressUpdate } from './library'
