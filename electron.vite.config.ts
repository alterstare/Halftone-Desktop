import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        // Native addon (local OCR) — loaded from node_modules at runtime, never bundled.
        // Sorta (캐릭터 분류) native modules likewise.
        external: ['onnxruntime-node', 'better-sqlite3', 'sharp']
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: { '@': resolve(__dirname, 'src/renderer/src') }
    },
    build: {
      rollupOptions: {
        // sorta.html = the 캐릭터 분류 mode (Sorta's screen, shown in a frame)
        input: { index: resolve(__dirname, 'src/renderer/index.html'), sorta: resolve(__dirname, 'src/renderer/sorta.html') }
      }
    },
    // App version, shown at the bottom of Settings.
    define: {
      __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')).version)
    },
    plugins: [react()]
  }
})
