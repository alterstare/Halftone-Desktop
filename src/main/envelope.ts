// 음성 플레이어: Envelope (../doujin_player, synced by `npm run sync-envelope`)
// embedded. Its screen is the renderer page envelope.html, in a frame of the
// main window — the right panel, or the bar at Halftone's bottom; that frame
// holds the player and keeps playing in every shape. "큰 창" opens a separate
// window with the same page (?remote): it shows the frame's player (state comes
// down, actions go up — relayed by Envelope's host). The data folder is shared
// with the standalone Envelope app (%APPDATA%/Envelope) and only opened when
// the player is first shown.
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { closeEnv, ENV_SCHEME, initEnv } from '../envelope/main/host'
import { IPC as ENV_IPC } from '../envelope/shared/ipc'
import type { HostRequest } from '../envelope/shared/ipc'
import { ENVELOPE_VERSION } from '../envelope/version'
import { getMainWindow, sendToRenderer, store, themeBg } from './context'
import { IPC } from '../shared/ipc'

export { ENV_SCHEME, closeEnv as closeEnvelope }

const PAGE = /\/envelope\.html(\?|#|$)/

// The player frame inside the main window.
function envelopeFrame(): Electron.WebFrameMain | undefined {
  return getMainWindow()?.webContents.mainFrame.framesInSubtree.find((f) => PAGE.test(f.url))
}

let big: BrowserWindow | null = null

function pageUrl(query: string): string {
  const dev = process.env['ELECTRON_RENDERER_URL']
  return dev ? `${dev}/envelope.html?${query}` : `file://${join(__dirname, '../renderer/envelope.html').replace(/\\/g, '/')}?${query}`
}

// The separate big window: the frame's player, shown big.
function openBig(): void {
  if (big && !big.isDestroyed()) return big.focus()
  const theme = store.settings.theme
  big = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 860,
    minHeight: 560,
    title: 'Envelope',
    backgroundColor: themeBg(theme),
    autoHideMenuBar: true,
    show: false,
    ...(process.env['ELECTRON_RENDERER_URL'] ? { icon: join(__dirname, '../../build/icon.png') } : {}),
    webPreferences: { preload: join(__dirname, '../preload/index.mjs'), sandbox: false }
  })
  big.on('ready-to-show', () => big?.show())
  // closing it brings the panel back
  big.on('closed', () => {
    big = null
    sendToRenderer(IPC.envelopeShape, 'panel')
  })
  void big.loadURL(pageUrl(`remote&theme=${theme}`))
}

function closeBig(): void {
  if (big && !big.isDestroyed()) {
    const w = big
    big = null
    w.removeAllListeners('closed')
    w.close()
  }
}

export function setupEnvelope(): void {
  initEnv({
    // ENVELOPE_DATA_DIR: point at a copy when testing
    dataDir: process.env['ENVELOPE_DATA_DIR'] || join(app.getPath('appData'), 'Envelope'),
    appName: 'Halftone',
    appVersion: ENVELOPE_VERSION,
    embedded: true,
    lazy: true,
    window: () => (big && !big.isDestroyed() ? big : getMainWindow()),
    encodeWorker: join(__dirname, 'envelopeEncodeWorker.js'),
    // to the frame (it decodes audio for the speech engine — only there); the
    // big window hears the rest too (library changes, job progress, toasts)
    send: (channel, payload) => {
      const f = envelopeFrame()
      if (f && !f.isDestroyed()) f.send(channel, payload)
      if (channel !== ENV_IPC.decodeRequest && big && !big.isDestroyed()) big.webContents.send(channel, payload)
    },
    remote: () => (big && !big.isDestroyed() ? big.webContents : null),
    // asks from the big window (the frame asks Halftone's page directly)
    onHostRequest: (r: HostRequest) => {
      if (r.what === 'panel' || r.what === 'bar' || r.what === 'close') {
        closeBig()
        sendToRenderer(IPC.envelopeShape, r.what)
      }
    }
  })
  // the page: open / close the big window
  ipcMain.removeHandler(IPC.envelopeBig)
  ipcMain.handle(IPC.envelopeBig, (_e, open: boolean) => (open ? openBig() : closeBig()))
}

export function closeEnvelopeWindows(): void {
  closeBig()
}
