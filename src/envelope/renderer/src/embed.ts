// Inside Halftone Envelope runs in a frame of Halftone's window (the right
// panel, or the bar at its bottom), and in a separate big window that shows
// that frame's player. The host app owns the look and the activity bar:
// Envelope follows the host's theme and hands its job progress up.
import type { ProgressEvent } from '../../shared/types'

export const embedded = window.parent !== window
// mark it before the first paint: styles for the frame (its top bar as tall as
// Halftone's) apply from the start instead of after a message
if (embedded) document.documentElement.classList.add('env-embedded')

// The host page (same origin), or null when standalone / not reachable.
function hostDocument(): Document | null {
  try {
    return embedded ? window.parent.document : null
  } catch {
    return null
  }
}

// Mirror the host's <html data-theme> now and whenever it changes.
export function followHostTheme(apply: (theme: string) => void): () => void {
  const doc = hostDocument()
  if (!doc) return () => {}
  const read = (): void => apply(doc.documentElement.dataset.theme || 'light')
  read()
  const mo = new MutationObserver(read)
  mo.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => mo.disconnect()
}

// Message the host's activity bar listens for.
export interface EnvJobMessage {
  type: 'env-job'
  event: ProgressEvent
}
export function postJob(event: ProgressEvent): void {
  if (embedded) window.parent.postMessage({ type: 'env-job', event } satisfies EnvJobMessage, '*')
}

// Halftone's separate big window: shows the panel's player (?remote).
export const remote = new URLSearchParams(location.search).has('remote')
// Inside Halftone at all (the panel frame or its big window).
export const hosted = embedded || remote

// How Halftone shows the panel frame: the right panel, the bar at its
// bottom, or hidden (the big window is open — the frame keeps playing).
export type HostMode = 'panel' | 'bar' | 'hidden'

// Ask Halftone for another shape (see HostRequest).
export function requestHost(r: import('../../shared/ipc').HostRequest): void {
  if (embedded) window.parent.postMessage({ type: 'env-request', request: r }, '*')
  else if (remote) window.api.hostRequest(r)
}

// Messages from Halftone to the frame: its shape, and keys pressed in
// Halftone that Halftone itself doesn't use.
export function onHostMessage(cb: (m: { type: 'env-mode'; mode: HostMode; topH?: number } | { type: 'env-key'; init: KeyboardEventInit }) => void): () => void {
  if (!embedded) return () => {}
  const h = (e: MessageEvent): void => {
    if (e.source !== window.parent) return
    if (e.data?.type === 'env-mode' || e.data?.type === 'env-key') cb(e.data)
  }
  window.addEventListener('message', h)
  return () => window.removeEventListener('message', h)
}
