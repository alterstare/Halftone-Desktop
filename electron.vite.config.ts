import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // envelopeEncodeWorker = 음성 플레이어's wav → mp3 worker thread
        input: { index: resolve(__dirname, 'src/main/index.ts'), envelopeEncodeWorker: resolve(__dirname, 'src/envelope/main/encodeWorker.ts') },
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
        // envelope.html = the 음성 플레이어 (Envelope's screen, in a frame and its big window)
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          sorta: resolve(__dirname, 'src/renderer/sorta.html'),
          envelope: resolve(__dirname, 'src/renderer/envelope.html')
        }
      }
    },
    // App version, shown at the bottom of Settings.
    define: {
      __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')).version)
    },
    plugins: [react()]
  }
})
