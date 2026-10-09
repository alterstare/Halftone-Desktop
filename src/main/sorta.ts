// 캐릭터 분류 mode: Sorta (../sorta/, synced by `npm run sync-sorta`) embedded.
// Its screen is the renderer page sorta.html, shown in a frame of the main
// window; its main-process side (core, IPC on `sorta:*` channels, image
// protocol) is Sorta's own host module. The data folder is shared with the
// standalone Sorta app (%APPDATA%/Sorta) and only opened when the 캐릭터 분류
// mode is first shown, so the standalone app stays usable until then.
import { app } from 'electron'
import { join } from 'path'
import { closeSorta, initSorta, SORTA_SCHEME } from '../sorta/main/host'
import { SORTA_VERSION } from '../sorta/version'
import { getMainWindow } from './context'

export { SORTA_SCHEME, closeSorta }

// The Sorta frame inside the main window (events go there, not to Halftone's page).
function sortaFrame(): Electron.WebFrameMain | undefined {
  return getMainWindow()?.webContents.mainFrame.framesInSubtree.find((f) => /\/sorta\.html(\?|#|$)/.test(f.url))
}

export function setupSorta(): void {
  initSorta({
    // SORTA_DATA_DIR: point at a copy when testing
    dataDir: process.env['SORTA_DATA_DIR'] || join(app.getPath('appData'), 'Sorta'),
    appName: 'Halftone',
    appVersion: SORTA_VERSION,
    embedded: true,
    lazy: true,
    window: getMainWindow,
    send: (channel, payload) => {
      const f = sortaFrame()
      if (f && !f.isDestroyed()) f.send(channel, payload)
    }
  })
}
