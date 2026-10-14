// Helpers for serving library files to the player (env-media:// in main).
import { extname, resolve, sep } from 'path'

const TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif'
}

export function mimeOf(path: string): string {
  return TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

// "bytes=start-end" / "bytes=start-" / "bytes=-suffix" → inclusive range,
// null when absent or unsatisfiable. Only the first range is honored.
export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const m = header?.match(/^bytes=(\d*)-(\d*)/)
  if (!m || (!m[1] && !m[2]) || size === 0) return null
  let start: number
  let end: number
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
  }
  return start <= end && start < size ? { start, end } : null
}

// Path comparison is case-insensitive on Windows only.
const norm = (p: string): string => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p))
export function isInside(child: string, parent: string): boolean {
  const c = norm(child)
  const p = norm(parent)
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep)
}
