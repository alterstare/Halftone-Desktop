// Image plumbing between main and renderer:
//  • the custom `mangaimg://` protocol that serves local files and proxies
//    remote doujin / manga-site images (which need a Referer the renderer can't set),
//  • url encoders for each source,
//  • the on-disk thumbnail cache (one small webp per work).
//
// URL forms (path segment = base64url of the target):
//   mangaimg://img/<abs path>     local file
//   mangaimg://web/<https url>    doujin image (fetched via the DNS-bypass path)
//   mangaimg://comic/<https url>   general-manga online image (manga-site session)
import { app, net, protocol } from 'electron'
import type { CustomScheme } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { promises as fs } from 'fs'
import { fetchDoujinBuffer } from './doujin'
import { fetchComicBuffer } from './comic'
import { cachedImage } from './imgCache'
import { store } from '../context'

// Must run before app 'ready' (Electron requirement for privileged schemes).
// Electron takes the privileged-scheme list once: other modules' schemes
// (Sorta's sorta-img) come in through `extra`.
export function registerImageScheme(extra: CustomScheme[] = []): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'mangaimg', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
    ...extra
  ])
}

const b64 = (s: string): string => Buffer.from(s, 'utf-8').toString('base64url')

export function encodeImg(path: string): string {
  return 'mangaimg://img/' + b64(path)
}

// Remote doujin image → loads through our protocol (main attaches the Referer;
// a bare <img> would get a 403).
export function encodeWeb(url: string): string {
  return 'mangaimg://web/' + b64(url)
}

// Manga-site image → fetched through the manga-site session with the site referer.
export function encodeComic(url: string): string {
  return 'mangaimg://comic/' + b64(url)
}

function decodeB64Path(url: string): string {
  const seg = new URL(url).pathname.replace(/^\//, '')
  return Buffer.from(seg, 'base64url').toString('utf-8')
}

// Serve the scheme. Image bytes are immutable per URL (doujin hash / manga-site path /
// local file), so responses are marked cacheable: Chromium then caches them,
// which lets the reader's up-front prefetch (new Image()) warm the cache so the
// rendered <img> paints instantly instead of re-invoking this handler.
export function handleImageProtocol(): void {
  const IMG_CACHE = 'public, max-age=604800, immutable'
const MIME: Record<string, string> = {
  webp: 'image/webp',
  avif: 'image/avif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp'
}
  const bytes = (buf: Buffer): Response =>
    new Response(new Uint8Array(buf), {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': IMG_CACHE }
    })
  protocol.handle('mangaimg', async (req) => {
    try {
      const host = new URL(req.url).host
      const target = decodeB64Path(req.url)
      // Remote images go through the disk cache (lib/imgCache) so a restart
      // doesn't download every thumbnail / page again.
      if (host === 'web') return bytes(await cachedImage(target, () => fetchDoujinBuffer(target)))
      if (host === 'comic')
        return bytes(await cachedImage(target, () => fetchComicBuffer(store.settings.comicBaseUrl, target)))
      // NAS (SMB) UNC paths become file://host/... URLs that net.fetch refuses —
      // read those directly.
      if (/^[\\/]{2}[^\\/]/.test(target)) {
        const ext = target.slice(target.lastIndexOf('.') + 1).toLowerCase()
        const type = MIME[ext] ?? 'application/octet-stream'
        return new Response(new Uint8Array(await fs.readFile(target)), {
          status: 200,
          headers: { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': IMG_CACHE }
        })
      }
      const res = await net.fetch(pathToFileURL(target).toString())
      const headers = new Headers(res.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      headers.set('Cache-Control', IMG_CACHE)
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
    } catch {
      return new Response('bad request', { status: 400 })
    }
  })
}

// --- thumbnail cache (userData/thumbs) ---

let thumbDir = ''

export async function initThumbDir(): Promise<void> {
  thumbDir = join(app.getPath('userData'), 'thumbs')
  await fs.mkdir(thumbDir, { recursive: true })
}

// A work id can contain characters illegal in Windows filenames (e.g. the "u:"
// namespace prefix → colon), so map it to a safe, deterministic thumb path.
// Any char outside [A-Za-z0-9._-] becomes "_". The ".v2" suffix versions the
// format (bump it to invalidate every cached thumb).
export function thumbFile(workId: string): string {
  return join(thumbDir, `${workId.replace(/[^A-Za-z0-9._-]/g, '_')}.v2.webp`)
}

// Is this thumb file a raw, full-size cover (online cover regen writes the source
// image as-is: AVIF/JPEG up to ~3000px) rather than our ≤480px webp? Reads only
// the header. Raw thumbs make every scroll re-decode megapixel images (stutter),
// so getThumb flags them and the renderer shrinks them once.
export async function isRawThumb(file: string): Promise<boolean> {
  const fh = await fs.open(file, 'r')
  try {
    const b = Buffer.alloc(30)
    await fh.read(b, 0, 30, 0)
    if (b.toString('latin1', 8, 12) !== 'WEBP') return true
    const chunk = b.toString('latin1', 12, 16)
    let w = 0
    let h = 0
    if (chunk === 'VP8X') {
      w = 1 + b.readUIntLE(24, 3)
      h = 1 + b.readUIntLE(27, 3)
    } else if (chunk === 'VP8 ') {
      w = b.readUInt16LE(26) & 0x3fff
      h = b.readUInt16LE(28) & 0x3fff
    } else if (chunk === 'VP8L') {
      const v = b.readUInt32LE(21)
      w = (v & 0x3fff) + 1
      h = ((v >> 14) & 0x3fff) + 1
    }
    return Math.max(w, h) > 640
  } finally {
    await fh.close()
  }
}
