// IPC: favorites (doujin) — the hearts themselves, favorite files and lists.
//  • Hearts: setFavoriteByCode / setOnlineFav keep the favorites list and the
//    local copies in sync (lib/favoriteSync.ts). Manga-site (general-manga online)
//    favorites, keyed by url, also live in the list but have no local copy.
//  • Files: ONE favorites file format (Pupil-compatible JSON + our ranks) for
//    export / merge-import / merging several files.
//  • Lists: a file imported as a named list of codes (browse them online, or
//    the downloaded ones in the library).
import { ipcMain, dialog } from 'electron'
import { basename, dirname } from 'path'
import { promises as fs } from 'fs'
import type { OnlineFav } from '../../shared/types'
import { IPC, type GallerySummary } from '../../shared/ipc'
import { store, sendToRenderer } from '../context'
import { parseIds, tagToEntry, parseFavoriteTags, listNameFromFile } from '../lib/favfile'
import { ensureSummaries, queueSummaries, setSummaryArrivedHandler, setSummaryFailedHandler, allCachedSummaries, cachedSummariesNow } from '../lib/summaries'
import { doujinExists } from '../lib/doujin'
import { isGalleryCode, setFavoriteByCode, setFavoritesByCodes, setWorkFavorite } from '../lib/favoriteSync'

const JSON_FILTER = [{ name: 'JSON', extensions: ['json'] }]

async function pickJson(title: string): Promise<string | null> {
  const r = await dialog.showOpenDialog({ title, properties: ['openFile'], filters: JSON_FILTER })
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
}

async function pickJsons(title: string): Promise<string[]> {
  const r = await dialog.showOpenDialog({ title, properties: ['openFile', 'multiSelections'], filters: JSON_FILTER })
  return r.canceled ? [] : r.filePaths
}

async function saveJsonAs(title: string, defaultPath: string): Promise<string | null> {
  const r = await dialog.showSaveDialog({ title, defaultPath, filters: JSON_FILTER })
  return r.canceled || !r.filePath ? null : r.filePath
}

const readJson = async (path: string): Promise<any> => JSON.parse(await fs.readFile(path, 'utf-8'))
const writeJson = (path: string, data: unknown): Promise<void> => fs.writeFile(path, JSON.stringify(data), 'utf-8')

// Favorites imported from a file hold only the code (title = code, no
// thumbnail). Once its summary is fetched, store title / artist / thumbnail /
// language / pages on the entry, so every favorites view and the exported file
// show them. Saved in one debounced write.
let favMetaTimer: ReturnType<typeof setTimeout> | null = null
function fillFavMeta(g: GallerySummary): boolean {
  const f = store.onlineFavs.get(g.code)
  if (!f || (f.title && f.title !== f.code && f.thumbUrl)) return false
  store.setOnlineFav(
    g.code,
    {},
    {
      title: f.title && f.title !== f.code ? f.title : g.title,
      artist: f.artist ?? (g.artists.length ? g.artists.join(', ') : null),
      language: f.language ?? g.language,
      pageCount: f.pageCount || g.pageCount,
      thumbUrl: f.thumbUrl ?? g.thumbUrl
    },
    false
  )
  return true
}
function saveFavMetaSoon(): void {
  if (!favMetaTimer)
    favMetaTimer = setTimeout(() => {
      favMetaTimer = null
      void store.saveOnline()
    }, 2000)
}
// A favorite whose gallery is gone from the site (404) and that was never
// downloaded is dropped from the favorites (its rating, if any, is kept).
// 'removed' | 'kept' | 'uncertain' — network errors are never read as deleted.
async function pruneIfDeleted(code: string): Promise<'removed' | 'kept' | 'uncertain'> {
  const f = store.onlineFavs.get(code)
  if (!f?.favorite || !/^\d+$/.test(code)) return 'kept'
  for (const w of store.works.values()) if (w.code === code && (w.library ?? 'doujin') !== 'normal') return 'kept'
  const exists = await doujinExists(code)
  if (exists === null) return 'uncertain'
  if (exists) return 'kept'
  store.setOnlineFav(code, { favorite: false }, undefined, false)
  saveFavMetaSoon()
  return 'removed'
}

// Startup: fill entries whose summary was cached earlier.
export async function backfillFavMeta(): Promise<void> {
  const cache = await allCachedSummaries()
  let changed = false
  for (const f of store.onlineFavs.values()) {
    const g = cache[f.code]
    if (g && fillFavMeta(g)) changed = true
  }
  if (changed) await store.saveOnline()
}

// Rating of a gallery: the better of the list entry and any local copy.
function rankOf(code: string): number {
  let r = store.onlineFavs.get(code)?.rank ?? 0
  for (const w of store.works.values()) if (w.code === code) r = Math.max(r, w.rank)
  return r
}

// ---------- rating files ----------
// Ratings are exported per library mode — 동인지 and 일반 만화 never mix:
//   동인지:   { library: 'doujin', ratings: { doujin: {code: n}, local: {...} }, ranks: {code: n} }
//   일반 만화: { library: 'manga',  ratings: { online: {url: n}, local: {...} } }
// `ranks` repeats the doujin ratings at top level (same as the favorites file).
// Local works without a code are keyed by their last two path segments
// (series/chapter or group/work) so the file works on another PC too.
type Lib = 'doujin' | 'normal'
type RatingFile = { doujin: Record<string, number>; online: Record<string, number>; local: Record<string, number> }
const localKey = (path: string): string => `${basename(dirname(path))}/${basename(path)}`.toLowerCase()
const libOf = (w: { library?: Lib }): Lib => w.library ?? 'doujin'

function collectRatings(lib: Lib): RatingFile {
  const out: RatingFile = { doujin: {}, online: {}, local: {} }
  for (const f of store.onlineFavs.values()) {
    if (!(f.rank > 0)) continue
    if (lib === 'doujin' && isGalleryCode(f.code)) out.doujin[f.code] = Math.max(out.doujin[f.code] ?? 0, f.rank)
    if (lib === 'normal' && !isGalleryCode(f.code)) out.online[f.code] = f.rank
  }
  for (const w of store.works.values()) {
    if (!(w.rank > 0) || libOf(w) !== lib) continue
    if (w.code && lib === 'doujin') out.doujin[w.code] = Math.max(out.doujin[w.code] ?? 0, w.rank)
    else if (!w.code) out.local[localKey(w.path)] = w.rank
  }
  return out
}

function parseRatings(raw: any, lib: Lib): RatingFile {
  const r = raw?.ratings ?? {}
  const num = (o: any): Record<string, number> => {
    const m: Record<string, number> = {}
    for (const [k, v] of Object.entries(o ?? {})) {
      const n = Math.round(Number(v))
      if (n > 0) m[k] = Math.min(5, n)
    }
    return m
  }
  // A file from the other mode contributes nothing here.
  const fileLib: Lib | null = raw?.library === 'manga' ? 'normal' : raw?.library === 'doujin' ? 'doujin' : null
  if (fileLib && fileLib !== lib) return { doujin: {}, online: {}, local: {} }
  return lib === 'doujin'
    ? // Plain favorites files carry ranks at top level — accept them too.
      { doujin: { ...num(raw?.ranks), ...num(r.doujin) }, online: {}, local: num(r.local) }
    : { doujin: {}, online: num(r.online), local: num(r.local) }
}

const countRatings = (r: RatingFile): number =>
  Object.keys(r.doujin).length + Object.keys(r.online).length + Object.keys(r.local).length

const fileOf = (lib: Lib, r: RatingFile): unknown =>
  lib === 'doujin'
    ? { library: 'doujin', ratings: { doujin: r.doujin, local: r.local }, ranks: r.doujin }
    : { library: 'manga', ratings: { online: r.online, local: r.local } }

export function registerFavoritesIpc(): void {
  ipcMain.handle(IPC.exportRatings, async (_e, lib: Lib) => {
    const ratings = collectRatings(lib)
    const path = await saveJsonAs('평점 내보내기', lib === 'doujin' ? 'ratings-doujin.json' : 'ratings-manga.json')
    if (!path) return { ok: false, count: 0 }
    await writeJson(path, fileOf(lib, ratings))
    return { ok: true, count: countRatings(ratings), path }
  })

  // Apply a rating file: each rating in it is set (doujin codes on the list
  // entry and any local copy; online urls on the list entry; local works by
  // path key). Ratings not in the file are left alone.
  ipcMain.handle(IPC.importRatings, async (_e, lib: Lib) => {
    const file = await pickJson('평점 불러오기 (병합)')
    if (!file) return { ok: false, applied: 0, total: 0 }
    let r: RatingFile
    try {
      r = parseRatings(await readJson(file), lib)
    } catch {
      return { ok: false, applied: 0, total: 0 }
    }
    let applied = 0
    for (const [code, n] of Object.entries(r.doujin)) {
      store.setOnlineFav(code, { rank: n })
      applied++
      for (const w of store.works.values()) if (w.code === code) store.update(w.id, { rank: n })
    }
    for (const [url, n] of Object.entries(r.online)) {
      store.setOnlineFav(url, { rank: n })
      applied++
    }
    const byKey = new Map<string, string[]>()
    for (const w of store.works.values()) {
      if (w.code || libOf(w) !== lib) continue
      const k = localKey(w.path)
      byKey.set(k, [...(byKey.get(k) ?? []), w.id])
    }
    for (const [k, n] of Object.entries(r.local)) {
      const ids = byKey.get(k.toLowerCase())
      if (!ids) continue
      for (const id of ids) store.update(id, { rank: n })
      applied++
    }
    await store.saveOnline()
    await store.flushWorks()
    return { ok: true, applied, total: countRatings(r) }
  })

  // Merge several rating files into one new file (the higher rating wins).
  ipcMain.handle(IPC.mergeRatings, async (_e, lib: Lib) => {
    const files = await pickJsons('병합할 평점 파일 선택 (2개 이상)')
    if (!files.length) return { ok: false, count: 0, files: 0 }
    const out: RatingFile = { doujin: {}, online: {}, local: {} }
    for (const fp of files) {
      try {
        const r = parseRatings(await readJson(fp), lib)
        for (const part of ['doujin', 'online', 'local'] as const)
          for (const [k, v] of Object.entries(r[part])) out[part][k] = Math.max(out[part][k] ?? 0, v)
      } catch {
        /* skip unreadable file */
      }
    }
    const path = await saveJsonAs('병합 결과 저장', lib === 'doujin' ? 'ratings-doujin-merged.json' : 'ratings-manga-merged.json')
    if (!path) return { ok: false, count: countRatings(out), files: files.length }
    await writeJson(path, fileOf(lib, out))
    return { ok: true, count: countRatings(out), files: files.length, path }
  })

  // ---------- hearts ----------

  ipcMain.handle(IPC.getOnlineFavs, () => [...store.onlineFavs.values()])
  // General-manga last-read chapters (이어보기 / last-read mark).
  ipcMain.handle(IPC.getReadProgress, () => store.readProgress)
  ipcMain.handle(IPC.markRead, (_e, key: string) => store.markRead(key))

  ipcMain.handle(IPC.setFavoriteByCode, (_e, code: string, fav: boolean, meta?: Partial<OnlineFav>) =>
    setFavoriteByCode(code, fav, meta)
  )

  // Rank (and heart, for manga-site urls). A heart change on a gallery code is routed
  // through setFavoriteByCode so local copies follow.
  ipcMain.handle(
    IPC.setOnlineFav,
    async (_e, code: string, patch: { favorite?: boolean; rank?: number }, meta?: Partial<OnlineFav>) => {
      if (patch.favorite !== undefined && isGalleryCode(code)) {
        await setFavoriteByCode(code, patch.favorite, meta)
        if (patch.rank === undefined) return store.onlineFavs.get(code) ?? store.setOnlineFav(code, {}, meta)
        return store.setOnlineFav(code, { rank: patch.rank }, meta)
      }
      return store.setOnlineFav(code, patch, meta)
    }
  )

  // ---------- favorites file ----------

  // Every favorited gallery code (+ favorite tags + ranks) in Pupil's shape;
  // `ranks` is our own extension that Pupil ignores. Uncoded local favorites
  // can't be represented.
  ipcMain.handle(IPC.exportFavorites, async () => {
    const codes = [...store.onlineFavs.values()].filter((f) => f.favorite && isGalleryCode(f.code)).map((f) => f.code)
    const ranks: Record<string, number> = {}
    for (const c of codes) if (rankOf(c) > 0) ranks[c] = rankOf(c)
    const path = await saveJsonAs('즐겨찾기 내보내기', 'favorites.json')
    if (!path) return { ok: false, count: 0 }
    await writeJson(path, {
      favorites: codes.map(Number),
      favorite_tags: store.settings.favoriteTags.map(tagToEntry),
      ranks
    })
    return { ok: true, count: codes.length, path }
  })

  // Merge a file into the favorites (never unhearts): every code is hearted —
  // downloaded copies follow, moved into the favorites folder per the setting —
  // ranks are adopted, and favorite tags are unioned into settings.
  ipcMain.handle(IPC.importFavorites, async () => {
    const file = await pickJson('즐겨찾기 불러오기 (병합)')
    if (!file) return { ok: false, matched: 0, total: 0 }
    let raw: any
    try {
      raw = await readJson(file)
    } catch {
      return { ok: false, matched: 0, total: 0 }
    }
    const ids = parseIds(raw)
    const ranks: Record<string, unknown> = raw?.ranks ?? {}
    // 추가 시각 in file order, 1ms apart (Pupil lists oldest first), so
    // 최근 추가순 follows the file. Applies to entries new to the list, and to
    // existing ones whose time is shared with others — the mark of an earlier
    // bulk import that stamped hundreds with one ms (re-importing the same file
    // repairs that order). Hand-hearted favorites have distinct times; kept.
    const sameTime = new Map<number, number>()
    for (const id of ids) {
      const t = store.onlineFavs.get(id)?.addedAt
      if (t !== undefined) sameTime.set(t, (sameTime.get(t) ?? 0) + 1)
    }
    const restamp = ids.filter((id) => {
      const f = store.onlineFavs.get(id)
      return !f || (sameTime.get(f.addedAt) ?? 0) > 1
    })
    const matched = await setFavoritesByCodes(ids, true)
    const t0 = Date.now() - restamp.length
    restamp.forEach((id, i) => store.setOnlineFav(id, { addedAt: t0 + i }, undefined, false))
    for (const id of ids) {
      const r = Number(ranks[id]) || 0
      if (r > 0) store.setOnlineFav(id, { rank: r }, undefined, false)
    }
    const tags = parseFavoriteTags(raw)
    if (tags.length) {
      await store.saveSettings({ ...store.settings, favoriteTags: [...new Set([...store.settings.favoriteTags, ...tags])] })
    }
    await store.saveOnline()
    // Start fetching their titles / thumbnails / tags now (saved as it goes,
    // resumed on the next start) rather than when the favorites are opened.
    void queueSummaries(ids)
    return { ok: true, matched, total: ids.length }
  })

  // 즐겨찾기 초기화: unheart every doujin favorite — the whole list (online and
  // coded local copies) plus hearted uncoded doujin works. Same as unhearting
  // each by hand: folders moved into the favorites folder go back home (per
  // the setting). Ratings stay. General-manga favorites are separate, untouched.
  // Each summary that lands: fill the favorite entry and push it to the
  // renderer (batched), so screens that asked before it arrived update too.
  let arrived: GallerySummary[] = []
  let pushTimer: ReturnType<typeof setTimeout> | null = null
  setSummaryArrivedHandler((g) => {
    if (fillFavMeta(g)) saveFavMetaSoon()
    arrived.push(g)
    if (!pushTimer)
      pushTimer = setTimeout(() => {
        pushTimer = null
        sendToRenderer(IPC.summaryArrived, arrived)
        arrived = []
      }, 500)
  })
  // Setting on: a summary that failed may mean the gallery was deleted.
  setSummaryFailedHandler((code) => {
    if (store.settings.pruneDeletedFavorites) void pruneIfDeleted(code)
  })

  // 지금 정리: check every favorite that has no summary (the ones the list
  // can't show), 4 at a time, and drop those deleted from the site.
  ipcMain.handle(IPC.pruneDeletedFavorites, async () => {
    const cache = await allCachedSummaries()
    const codes = [...store.onlineFavs.values()]
      .filter((f) => f.favorite && /^\d+$/.test(f.code) && !cache[f.code])
      .map((f) => f.code)
    let done = 0
    let removed = 0
    let uncertain = 0
    const queue = [...codes]
    sendToRenderer(IPC.pruneDeletedProgress, { done, total: codes.length })
    const worker = async (): Promise<void> => {
      for (let code = queue.shift(); code; code = queue.shift()) {
        const r = await pruneIfDeleted(code)
        if (r === 'removed') removed++
        else if (r === 'uncertain') uncertain++
        sendToRenderer(IPC.pruneDeletedProgress, { done: ++done, total: codes.length })
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker))
    await store.saveOnline()
    return { checked: codes.length, removed, uncertain }
  })

  ipcMain.handle(IPC.resetFavorites, async () => {
    const codes = [...store.onlineFavs.values()].filter((f) => f.favorite).map((f) => f.code)
    await setFavoritesByCodes(codes, false)
    let rest = 0
    for (const w of [...store.works.values()]) {
      if (!w.favorite || (w.library ?? 'doujin') === 'normal') continue
      await setWorkFavorite(w.id, false)
      rest++
    }
    return { count: codes.length + rest }
  })

  // Merge several favorite files into one new file (union of ids, tags, ranks
  // — the higher rank wins). Standalone: does not touch the favorites.
  ipcMain.handle(IPC.mergeFavorites, async () => {
    const files = await pickJsons('병합할 즐겨찾기 파일 선택 (2개 이상)')
    if (!files.length) return { ok: false, count: 0, files: 0 }
    const union = new Set<string>()
    const tagUnion = new Set<string>()
    const ranks: Record<string, number> = {}
    for (const fp of files) {
      try {
        const raw = await readJson(fp)
        for (const id of parseIds(raw)) union.add(id)
        for (const t of parseFavoriteTags(raw)) tagUnion.add(t)
        for (const [k, v] of Object.entries(raw?.ranks ?? {})) ranks[k] = Math.max(ranks[k] ?? 0, Number(v) || 0)
      } catch {
        /* skip unreadable file */
      }
    }
    const path = await saveJsonAs('병합 결과 저장', 'favorites-merged.json')
    if (!path) return { ok: false, count: union.size, files: files.length }
    const ids = [...union].map(Number).filter(Number.isFinite)
    await writeJson(path, { favorites: ids, favorite_tags: [...tagUnion].map(tagToEntry), ranks })
    return { ok: true, count: ids.length, files: files.length, path }
  })

  // ---------- favorite lists ----------

  // Import a file as a named list of codes (replacing a same-named list).
  ipcMain.handle(IPC.importOnlineFavList, async () => {
    const file = await pickJson('즐겨찾기 목록 추가 (파일명이 목록 이름)')
    if (!file) return { ok: false, name: '', total: 0 }
    const name = listNameFromFile(basename(file))
    let codes: string[] = []
    try {
      codes = parseIds(await readJson(file))
    } catch {
      return { ok: false, name, total: 0 }
    }
    const lists = (store.settings.onlineFavLists ?? []).filter((l) => l.name !== name)
    lists.push({ name, codes })
    await store.saveSettings({ ...store.settings, onlineFavLists: lists })
    return { ok: true, name, total: codes.length }
  })

  ipcMain.handle(IPC.removeOnlineFavList, async (_e, name: string) => {
    const lists = (store.settings.onlineFavLists ?? []).filter((l) => l.name !== name)
    await store.saveSettings({ ...store.settings, onlineFavLists: lists })
    return { ok: true }
  })

  // Gallery summaries for `codes` (renders favorites / lists). Served from the
  // on-disk cache; only uncached codes are fetched.
  // What's cached, immediately. A screen used to wait here until every missing
  // code in its request had been fetched — one slow / retrying gallery held up
  // the whole batch, leaving cards blank although their data was on disk.
  ipcMain.handle(IPC.doujinSummaries, (_e, codes: string[]) => cachedSummariesNow(codes))

  // code → language for the 언어 분류 filter (cached summaries only; tiny
  // compared with full summaries, so the whole favorites list can be filtered
  // without loading every card's data).
  ipcMain.handle(IPC.favLanguages, async (_e, codes: string[]) => {
    const cache = await allCachedSummaries()
    const out: Record<string, string | null> = {}
    for (const c of codes) if (cache[c]) out[c] = cache[c].language
    return out
  })

  // Cache every list's summaries in one go so viewing a list later is instant.
  // Returns how many of the total codes are now cached.
  ipcMain.handle(IPC.preloadOnlineFavLists, async () => {
    const codes = [...new Set((store.settings.onlineFavLists ?? []).flatMap((l) => l.codes))]
    const cache = await ensureSummaries(codes, (done, total) =>
      sendToRenderer(IPC.onlineFavPreloadProgress, { done, total })
    )
    return { ok: true, total: codes.length, cached: codes.filter((c) => cache[c]).length }
  })
}
