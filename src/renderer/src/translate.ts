import type { TransResult, TransBlock, TransContext, TransDoc } from '../../shared/ipc'
import type { Settings } from '../../shared/types'
import { getImages, pageOf } from './images'
import { useStore } from './store'
import { loadImage } from './inpaint'
import { ocrBlocks } from './ocr'

// Caches per-image translation so toggling / re-viewing a page is instant and
// (importantly) doesn't re-spend OCR/Papago quota on the same page.
const cache = new Map<string, Promise<TransResult>>()
// Settled results (same keys) — read synchronously to give the next page context.
const resolved = new Map<string, TransResult>()

// LLM context for one page: the work's character notes plus the previous page's
// lines if that page is already translated (never waits for it — pages in a
// scroll view translate in parallel).
function pageContext(src: string): TransContext | undefined {
  const at = pageOf(src)
  if (!at) return undefined
  const memo = useStore.getState().settings.transMemos?.[at.workId]?.trim() || undefined
  const prev: { text: string; tr: string }[] = []
  for (let i = Math.max(0, at.idx - 2); i < at.idx; i++) {
    const r = resolved.get(at.srcs[i])
    if (r?.ok) for (const b of r.blocks) if (b.text && b.tr) prev.push({ text: b.text, tr: b.tr })
  }
  return memo || prev.length ? { memo, prev: prev.slice(-20) } : undefined
}

// Manual edits (bubble box/colour/text) persisted across sessions, keyed by image
// src. Loaded once; an override short-circuits OCR/translation entirely.
let editsPromise: Promise<Record<string, TransBlock[]>> | null = null
function ensureEdits(): Promise<Record<string, TransBlock[]>> {
  if (!editsPromise) editsPromise = window.api.getTransEdits().catch(() => ({}))
  return editsPromise
}

const MAX_SIDE = 1920 // Papago rejects images with any side > 1960px

// Papago Image Translation only accepts JPG/PNG/TIFF — but manga pages are
// often webp/avif. Chromium's canvas decodes those, so we re-encode to JPEG in
// the renderer and send the bytes to main. crossOrigin=anonymous keeps the
// canvas untainted (our mangaimg:// protocol sends Access-Control-Allow-Origin).
function toJpegInfo(src: string): Promise<{ b64: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      let { naturalWidth: w, naturalHeight: h } = img
      const scale = Math.min(1, MAX_SIDE / Math.max(w, h))
      w = Math.round(w * scale)
      h = Math.round(h * scale)
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      if (!ctx) return reject(new Error('canvas 컨텍스트 실패'))
      ctx.drawImage(img, 0, 0, w, h)
      const url = c.toDataURL('image/jpeg', 0.9)
      resolve({ b64: url.slice(url.indexOf(',') + 1), w, h })
    }
    img.onerror = () => reject(new Error('이미지 로드 실패'))
    img.src = src
  })
}

// Image engines (Papago / Gemini): main does OCR + translation, returns boxes.
// We send the downscaled image + its size; Gemini needs the size to turn its
// normalized boxes into pixels, Papago ignores it.
function imageTranslate(src: string, langHint?: string): Promise<TransResult> {
  return toJpegInfo(src).then(({ b64, w, h }) => window.api.translateImage(b64, langHint, w, h, pageContext(src)))
}

// Translation editor's 영역 번역 — rect is in the same downscaled space as the
// page's blocks (canvasSize / MAX_SIDE), which is exactly the JPEG we send.
export function translateRegion(
  src: string,
  rect: { x: number; y: number; w: number; h: number },
  langHint?: string
): Promise<{ ok: boolean; text: string; tr: string; error?: string }> {
  return toJpegInfo(src).then(({ b64 }) => window.api.translateRegion(b64, rect, langHint, pageContext(src)))
}

// Translation editor's 다시 번역: source lines through the page engine's translator.
export function translateLines(src: string, texts: string[], langHint?: string): Promise<{ ok: boolean; texts: string[]; error?: string }> {
  return window.api.translateLines(texts, langHint, pageContext(src))
}

// The model the current settings translate with, as the editor shows it.
export function transModelLabel(st: Settings): string {
  const gemini = st.geminiModel || 'gemini-2.5-flash'
  const free = st.freeTranslator === 'deepl' ? 'DeepL' : 'Google 번역'
  switch (st.translateEngine) {
    case 'papago':
      return st.translateProvider === 'localServer' ? '로컬 서버' : 'Papago'
    case 'free':
      return `Tesseract · ${free}`
    case 'gemini':
      return gemini
    case 'llm':
      return st.llmModel || 'LLM'
    case 'local': {
      // Same choice as main's localLines.
      const want = st.localTranslator ?? 'auto'
      const useGemini = want === 'gemini' || (want === 'auto' && !!st.geminiApiKey)
      const useLlm =
        !useGemini && (want === 'llm' || (want === 'auto' && (!!st.llmApiKey || st.llmProvider === 'ollama') && !!st.llmModel && !!st.llmBaseUrl))
      return `로컬 OCR · ${useGemini ? gemini : useLlm ? st.llmModel : free}`
    }
  }
  return st.translateEngine
}

// Free engine: OCR locally (Tesseract), translate the strings via main
// (Google unofficial / DeepL), then assemble the same box+translation shape.
async function freeTranslate(src: string, langHint?: string): Promise<TransResult> {
  const img = await loadImage(src)
  const ocr = await ocrBlocks(img, langHint)
  if (!ocr.blocks.length) return { ok: true, w: ocr.w, h: ocr.h, blocks: [] }
  const r = await window.api.translateTexts(
    ocr.blocks.map((b) => b.text),
    langHint
  )
  if (!r.ok) return { ok: false, w: ocr.w, h: ocr.h, blocks: [], error: r.error ?? '번역 실패' }
  const blocks = ocr.blocks.map((b, i) => ({
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    text: b.text,
    tr: r.texts[i] || ''
  }))
  return { ok: true, w: ocr.w, h: ocr.h, blocks }
}

export function getTranslation(src: string, langHint?: string): Promise<TransResult> {
  let p = cache.get(src)
  if (!p) {
    p = (async () => {
      const edits = await ensureEdits()
      // A saved manual edit wins — no OCR/API call, just replay the edited blocks
      // (with the OCR's text mask kept at save, so it erases as it did before).
      if (edits[src]) return { ok: true, w: 0, h: 0, blocks: edits[src], mask: (await window.api.getTransMask(src).catch(() => null)) ?? undefined }
      const engine = useStore.getState().settings?.translateEngine ?? 'papago'
      return engine === 'free' ? freeTranslate(src, langHint) : imageTranslate(src, langHint)
    })()
    cache.set(src, p)
    // Don't cache failures permanently — let the user retry after fixing keys.
    p.then((r) => {
      if (!r.ok) cache.delete(src)
      else if (cache.get(src) === p) resolved.set(src, r)
    }).catch(() => cache.delete(src))
  }
  return p
}

// The translation editor's 전체 다시 번역: the page through the engine again,
// past any saved edit. Becomes the page's cached run (its mask goes with the
// edit when the editor saves).
export async function retranslatePage(src: string, langHint?: string): Promise<TransResult> {
  const engine = useStore.getState().settings?.translateEngine ?? 'papago'
  const r = await (engine === 'free' ? freeTranslate(src, langHint) : imageTranslate(src, langHint))
  if (r.ok) {
    cache.set(src, Promise.resolve(r))
    resolved.set(src, r)
  }
  return r
}

// Persist a page's manually edited blocks and make them the live translation so the
// viewer/export pick them up immediately. Empty list clears the override (and the
// painted layer). `paint`: the editor's painted layer (data URL; null = none;
// left out = unchanged).
export async function saveTranslationEdit(src: string, blocks: TransBlock[], paint?: string | null): Promise<void> {
  const edits = await ensureEdits()
  // The page's text mask (the OCR run this edit replaces): kept with the edit.
  const mask = blocks.length ? (await cache.get(src)?.catch(() => null))?.mask : undefined
  if (blocks.length) edits[src] = blocks
  else delete edits[src]
  cache.delete(src) // force re-resolve (override if present, else fresh translation)
  resolved.set(src, { ok: true, w: 0, h: 0, blocks, mask }) // edited lines are the best context
  if (!blocks.length || mask) await window.api.saveTransMask(src, mask ?? null)
  if (!blocks.length) paint = null
  if (paint !== undefined) {
    paints.set(src, Promise.resolve(paint ? await loadImage(paint) : null))
    await window.api.saveTransPaint(src, paint)
  }
  await window.api.saveTransEdit(src, blocks)
}

// A page's painted layer (the editor's inpaint tools), loaded once per page.
const paints = new Map<string, Promise<HTMLImageElement | null>>()
export function getTransPaint(src: string): Promise<HTMLImageElement | null> {
  let p = paints.get(src)
  if (!p) {
    p = window.api
      .getTransPaint(src)
      .then((url) => (url ? loadImage(url) : null))
      .catch(() => null)
    paints.set(src, p)
  }
  return p
}

// A page's editor document (layers + text styles), loaded once per page: what
// the viewer and export draw for a page edited in the layered editor.
export interface LoadedDoc {
  doc: TransDoc
  images: Map<string, HTMLImageElement>
}
const docs = new Map<string, Promise<LoadedDoc | null>>()
export function getTransDoc(src: string): Promise<LoadedDoc | null> {
  let p = docs.get(src)
  if (!p) {
    p = window.api
      .getTransDoc(src)
      .then(async (r) => {
        if (!r) return null
        const images = new Map<string, HTMLImageElement>()
        for (const [id, url] of Object.entries(r.images)) images.set(id, await loadImage(url))
        return { doc: r.doc, images }
      })
      .catch(() => null)
    docs.set(src, p)
  }
  return p
}
// Save a page's editor document (null = back to the auto translation: the doc,
// the edit, the painted layer and the kept mask all go). `images`: changed layers'
// PNGs (null = emptied).
export async function saveTransDoc(src: string, doc: TransDoc | null, images: Record<string, string | null>): Promise<void> {
  if (!doc) {
    docs.set(src, Promise.resolve(null))
    await window.api.saveTransDoc(src, null, {})
    await saveTranslationEdit(src, [], null)
    return
  }
  const prev = await getTransDoc(src)
  const next = new Map(prev?.images ?? [])
  for (const [id, url] of Object.entries(images)) {
    if (url) next.set(id, await loadImage(url))
    else next.delete(id)
  }
  for (const id of [...next.keys()]) if (!doc.layers.some((l) => l.id === id)) next.delete(id)
  docs.set(src, Promise.resolve({ doc, images: next }))
  await window.api.saveTransDoc(src, doc, images)
  // The blocks as the page's edit too (the 편집 marks, the next page's context).
  await saveTranslationEdit(src, doc.blocks)
}

// 번역 편집기 목록's 초기화: every page of the work back to the auto translation
// (documents, edits, painted layers, kept masks all go; pages re-translate).
export async function resetWorkEdits(workId: string): Promise<void> {
  for (const src of await getImages(workId)) {
    await saveTransDoc(src, null, {})
    clearTranslation(src)
  }
}

// Pages (image src) that carry a saved manual edit.
export async function editedSrcs(): Promise<Set<string>> {
  return new Set(Object.keys(await ensureEdits()))
}

// AI draft of a work's character notes: collect the first pages' source lines
// (already-translated pages reuse their text; the rest go through local OCR
// only — no translation calls) and send them, in order, to the LLM once.
// Without the local OCR models it falls back to the page translation.
export async function draftWorkMemo(
  workId: string,
  langHint: string | undefined,
  onProgress?: (done: number, total: number) => void
): Promise<{ ok: boolean; memo: string; error?: string }> {
  const st = useStore.getState().settings
  const hasLlm = !!st.llmBaseUrl && !!st.llmModel && (!!st.llmApiKey || st.llmProvider === 'ollama')
  if (!st.geminiApiKey && !hasLlm)
    return { ok: false, memo: '', error: 'AI 초안에는 Gemini 또는 LLM API 키가 필요합니다 (설정 › 번역)' }
  const srcs = (await getImages(workId)).slice(0, 8)
  const lines: string[] = []
  for (let i = 0; i < srcs.length; i++) {
    onProgress?.(i, srcs.length)
    try {
      let texts: string[] | null = null
      const done = resolved.get(srcs[i])
      if (done?.ok && done.blocks.length) texts = done.blocks.map((b) => b.text)
      if (!texts) {
        const o = await toJpegInfo(srcs[i]).then(({ b64 }) => window.api.ocrPageTexts(b64, langHint))
        if (o.ok) texts = o.texts
      }
      if (!texts) {
        const r = await getTranslation(srcs[i], langHint)
        texts = r.ok ? r.blocks.map((b) => b.text) : []
      }
      for (const t of texts) if (t?.trim()) lines.push(`[${i + 1}p] ${t.trim()}`)
    } catch {
      /* skip the page */
    }
  }
  onProgress?.(srcs.length, srcs.length)
  if (!lines.length) return { ok: false, memo: '', error: '앞 페이지에서 대사를 찾지 못했습니다' }
  return window.api.transDraftMemo(lines, langHint)
}

// Changing the engine / translator / keys / models / global prompt mid-work
// must take effect right away: drop the cached pages (manual edits stay — they
// live apart) and bump transNonce so the open pages translate again.
const TRANS_KEYS = [
  'translateEngine',
  'translateProvider',
  'translateServerUrl',
  'localTranslator',
  'freeTranslator',
  'deeplApiKey',
  'geminiApiKey',
  'geminiModel',
  'llmProvider',
  'llmBaseUrl',
  'llmModel',
  'llmApiKey',
  'papagoClientId',
  'papagoClientSecret',
  'papagoImageEndpoint',
  'translatePrompt'
] as const
// Started from App (not at import: translate ⇄ store import each other).
let settingsLoaded = false
export function startTranslationWatch(): () => void {
  return useStore.subscribe((st, prev) => {
    if (st.settings === prev.settings) return
    // The first load (defaults → saved settings) is not a change by the user.
    if (!settingsLoaded) {
      settingsLoaded = true
      return
    }
    if (!TRANS_KEYS.some((k) => st.settings[k] !== prev.settings[k])) return
    clearTranslation()
    useStore.setState({ transNonce: st.transNonce + 1 })
  })
}

export function clearTranslation(src?: string): void {
  if (src) {
    cache.delete(src)
    resolved.delete(src)
  } else {
    cache.clear()
    resolved.clear()
  }
}
