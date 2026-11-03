// Electron main for scripts/inpaint-debug.mjs: runs the real local OCR (detector
// + manga-ocr, models from Halftone's userData) on one image, then the real
// renderer inpaint in a hidden window, and writes:
//   result.png — what the reader would show
//   debug.png  — OCR boxes (red), bubbles (striped per lobe), owned parts (tinted)
//   doc.png    — the same page as the editor's layers draw it (debug.json docDiff:
//                pixels that differ from result.png)
//   debug.json — blocks, the page's bubbles and the parts each block owns
// The translation is a placeholder (or --tr "line1|line2"), no network.
import { app, BrowserWindow, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import { extname, join } from 'path'
import { ocrPage } from '../../src/main/lib/localOcr'
import { lamaPatch } from '../../src/main/lib/lama'

const [imgPath, outDir, rendererJs, trArg] = process.argv.slice(-4)

app.setPath('userData', join(app.getPath('appData'), 'Halftone')) // read-only: the OCR models

app.whenReady().then(async () => {
  try {
    // As the app does it: the page itself (any format Chromium decodes), sent to
    // the OCR as src/renderer/src/translate.ts's toJpegInfo makes it (canvas
    // downscale to ≤ 1920, JPEG 0.9), drawn on from the page itself.
    const ext = extname(imgPath).slice(1).toLowerCase()
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
    const page0 = `data:${mime};base64,${(await fs.readFile(imgPath)).toString('base64')}`
    // A normal (GPU-composited) window like the app's — offscreen rendering is
    // software, and its canvas downscale / readback differ slightly.
    // IP_LAMA=<lama.onnx>: erase on the art with the inpainting model, as the app
    // does once it's downloaded (the page reaches it through ipc, like the app's).
    const lama = !!process.env.IP_LAMA
    if (lama) {
      ipcMain.handle('lama:status', () => ({ installed: true, sizeMB: 0 }))
      ipcMain.handle('lama:patch', (_e, rgb: Uint8Array, mask: Uint8Array) => lamaPatch(rgb, mask))
    }
    const win = new BrowserWindow({ show: false, webPreferences: lama ? { nodeIntegration: true, contextIsolation: false } : {} })
    win.webContents.on('console-message', (_e, _l, m) => m.startsWith('DBG') && console.error(m))
    await win.loadURL('data:text/html,<html><body></body></html>')
    const b64: string = await win.webContents.executeJavaScript(`new Promise((ok, no) => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, 1920 / Math.max(img.naturalWidth, img.naturalHeight))
        const c = document.createElement('canvas')
        c.width = Math.round(img.naturalWidth * scale)
        c.height = Math.round(img.naturalHeight * scale)
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
        const url = c.toDataURL('image/jpeg', 0.9)
        ok(url.slice(url.indexOf(',') + 1))
      }
      img.onerror = () => no(new Error('image load failed'))
      img.src = ${JSON.stringify(page0)}
    })`)
    const page = await ocrPage(Buffer.from(b64, 'base64'), 'ja')
    // IP_ERODE=n: the text mask shrunk n cells — a weaker mask, as another run of the
    // OCR can return (robustness check).
    for (let k = 0; k < Number(process.env.IP_ERODE || 0) && page.mask; k++) {
      const { w, h, bits } = page.mask
      const on = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && (bits[(y * w + x) >> 3] & (1 << ((y * w + x) & 7))) !== 0
      const keep: number[] = []
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y) && on(x - 1, y) && on(x + 1, y) && on(x, y - 1) && on(x, y + 1)) keep.push(y * w + x)
      bits.fill(0)
      for (const i of keep) bits[i >> 3] |= 1 << (i & 7)
    }
    const given = trArg && trArg !== '-' ? trArg.split('|') : []
    const blocks = page.blocks.map((b, i) => ({
      ...b,
      tr: given[i] ?? '번역 자리 '.repeat(Math.max(1, Math.round([...b.text].length / 4))).trim()
    }))

    await win.webContents.executeJavaScript(await fs.readFile(rendererJs, 'utf8'))
    const res = { ok: true, w: page.w, h: page.h, blocks, mask: process.env.IP_NOMASK ? undefined : page.mask && { ...page.mask, bits: [...page.mask.bits] } }
    const out = await win.webContents.executeJavaScript(`IP.debugRun(${JSON.stringify(page0)}, ${JSON.stringify(res)})`)
    await fs.mkdir(outDir, { recursive: true })
    const save = (name: string, url: string): Promise<void> =>
      fs.writeFile(join(outDir, name), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))
    await save('result.png', out.result)
    await save('debug.png', out.debug)
    await save('doc.png', out.doc)
    await fs.writeFile(join(outDir, 'debug.json'), JSON.stringify(out.info, null, 2))
    // mask.txt: the OCR text mask as rows of '#' / '.' (mask resolution).
    if (page.mask) {
      const { w, h, bits, scale } = page.mask
      const rows = [`scale ${scale}`]
      for (let y = 0; y < h; y++) {
        let r = ''
        for (let x = 0; x < w; x++) r += bits[(y * w + x) >> 3] & (1 << ((y * w + x) & 7)) ? '#' : '.'
        rows.push(r)
      }
      await fs.writeFile(join(outDir, 'mask.txt'), rows.join('\n'))
    }
    console.log(JSON.stringify(out.info, null, 2))
  } catch (e) {
    console.error(e)
    process.exitCode = 1
  }
  app.quit()
})
