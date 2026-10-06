// IPC: general-manga online (manga-site-family mirror + backup gnuboard sites) —
// lists, chapters, image urls, author/title/cover lookups and downloads into
// the general-manga library. Scraping itself lives in lib/comic.ts.
import { ipcMain } from 'electron'
import { promises as fs } from 'fs'
import type { Work } from '../../shared/types'
import type { ComicListSource, ComicChapter } from '../../shared/ipc'
import { IPC } from '../../shared/ipc'
import { store } from '../context'
import { scanRoot, normalRoots } from '../lib/scanner'
import {
  comicList,
  comicChapters,
  comicReadUrls,
  fetchComicBuffer,
  comicDownloadSeries,
  comicOpenSite,
  comicCoverForTitle,
  comicSeriesAuthor,
  comicSeriesTitle,
  comicAuthorForTitle,
  comicScrapeList,
  downloadGenericChapters
} from '../lib/comic'
import { encodeComic, thumbFile } from '../lib/media'
import { runDownload } from '../downloads'

// Where general-manga downloads go — never the doujin library.
function normalDestRoot(): string {
  const s = store.settings
  const dest = s.normalDownloadDir ?? normalRoots(s)[0]
  if (!dest) throw new Error('일반 만화 다운로드 폴더(설정 · 일반 만화)를 먼저 지정하세요')
  return dest
}

// Register a freshly downloaded series folder as general-manga works (the
// 'normal' stamp is forced regardless of where the folder sits).
async function importDownloaded(dir: string, artist?: string | null): Promise<Work[]> {
  const scanned = await scanRoot(dir, store.settings, 'normal')
  const merged = store.mergeScanPartial(scanned)
  // The artist belongs to THIS series only. mergeScanPartial returns the whole
  // library, so stamping its result overwrote every work's artist (doujin
  // included) with the downloaded series' author.
  if (artist) for (const w of scanned) store.update(w.id, { artist })
  await store.flushWorks()
  return artist ? [...store.works.values()] : merged
}

// Download a manga-site series (all chapters, or only `chapterUrls`).
function runComicDownload(seriesUrl: string, title: string, chapterUrls?: string[]): Promise<Work[]> {
  const destRoot = normalDestRoot()
  return runDownload(seriesUrl, title, async (signal, report) => {
    // Grab the author from the series page so downloaded chapters carry it.
    const artist = await comicSeriesAuthor(store.settings.comicBaseUrl, seriesUrl).catch(() => null)
    const dir = await comicDownloadSeries(
      store.settings.comicBaseUrl,
      seriesUrl,
      title,
      destRoot,
      (done, total, label) => report('downloading', done, total, label),
      chapterUrls,
      signal
    )
    const merged = await importDownloaded(dir, artist)
    report('done', merged.length, merged.length)
    return merged
  })
}

export function registerComicIpc(): void {
  // ---------- browse ----------

  ipcMain.handle(IPC.comicList, async (_e, source: ComicListSource, page: number) => {
    const r = await comicList(store.settings.comicBaseUrl, source, page)
    // Wrap card thumbs so they load through our protocol with the site referer.
    return { ...r, items: r.items.map((it) => ({ ...it, thumb: it.thumb ? encodeComic(it.thumb) : null })) }
  })
  ipcMain.handle(IPC.comicChapters, (_e, seriesUrl: string) => comicChapters(store.settings.comicBaseUrl, seriesUrl))
  ipcMain.handle(IPC.comicReadUrls, async (_e, chapterUrl: string) => (await comicReadUrls(store.settings.comicBaseUrl, chapterUrl)).map(encodeComic))
  ipcMain.handle(IPC.comicSeriesAuthor, (_e, seriesUrl: string) => comicSeriesAuthor(store.settings.comicBaseUrl, seriesUrl))
  ipcMain.handle(IPC.comicSeriesTitle, (_e, seriesUrl: string) => comicSeriesTitle(store.settings.comicBaseUrl, seriesUrl))

  // Show the scraper window (Cloudflare check / backup site browsing by hand).
  ipcMain.handle(IPC.comicOpenSite, (_e, url?: string) => comicOpenSite(store.settings.comicBaseUrl, url))
  // Backup site: read the chapter list of whatever page the user navigated to.
  ipcMain.handle(IPC.comicScrapeList, () => comicScrapeList())

  // ---------- downloads (progress on doujinProgress, code = seriesUrl) ----------

  ipcMain.handle(IPC.comicDownload, (_e, seriesUrl: string, title: string) => runComicDownload(seriesUrl, title))
  ipcMain.handle(IPC.comicDownloadChapters, (_e, seriesUrl: string, title: string, chapterUrls: string[]) =>
    runComicDownload(seriesUrl, title, chapterUrls)
  )

  // Backup site: download already-scraped chapters in the background
  // (progress code = "backup:<title>").
  ipcMain.handle(IPC.comicDownloadGeneric, (_e, title: string, chapters: ComicChapter[], only?: string[]) => {
    const destRoot = normalDestRoot()
    return runDownload('backup:' + title, title, async (signal, report) => {
      const dir = await downloadGenericChapters(
        chapters,
        title,
        destRoot,
        (done, total, label) => report('downloading', done, total, label),
        only,
        signal
      )
      const merged = await importDownloaded(dir)
      report('done', merged.length, merged.length)
      return merged
    })
  })

  // ---------- metadata for local works ----------

  // Fill the artist of local works from the online source (search by title).
  ipcMain.handle(IPC.comicFillArtist, async (_e, workIds: string[], title: string) => {
    const artist = await comicAuthorForTitle(store.settings.comicBaseUrl, title).catch(() => null)
    if (!artist) return []
    const out = workIds.map((id) => store.update(id, { artist })).filter(Boolean) as Work[]
    await store.flushWorks()
    return out
  })

  // Regenerate a series' cover from the online source (search by title, take the
  // first result's cover) into every given chapter's thumb. Written raw; the
  // renderer shrinks it on load.
  ipcMain.handle(IPC.comicRegenCover, async (_e, workIds: string[], title: string) => {
    try {
      const cover = await comicCoverForTitle(store.settings.comicBaseUrl, title)
      if (!cover) return { ok: false }
      const buf = await fetchComicBuffer(store.settings.comicBaseUrl, cover)
      for (const id of workIds) await fs.writeFile(thumbFile(id), buf).catch(() => {})
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  })
}
