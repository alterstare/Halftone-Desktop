import type { Api } from '../shared/ipc'

declare global {
  // Injected by electron.vite.config (renderer `define`).
  const __APP_VERSION__: string
  interface Window {
    api: Api
  }
}

export {}
