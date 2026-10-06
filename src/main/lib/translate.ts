import { net } from 'electron'
import type { Settings } from '../../shared/types'
import type { TransResult, TransBlock, TransContext } from '../../shared/ipc'
import { ocrPage, ocrRegion, ocrModelsInstalled } from './localOcr'

// Translation engine. Provider A (cloud) = Papago Image Translation(Text): one
// Naver Papago call does OCR + translation. Provider B (localServer) = a local
// manga-image-translator HTTP server (added later).

// Papago supports ja/en/zh-CN/zh-TW (+ko). Map our language names / hints.
function papagoSource(hint?: string): string {
  const h = (hint ?? '').toLowerCase()
  if (h.startsWith('ja') || h === 'japanese') return 'ja'
  if (h.startsWith('en') || h === 'english') return 'en'
  if (h === 'zh-tw' || h === 'chinese_traditional') return 'zh-TW'
  if (h.startsWith('zh') || h === 'chinese') return 'zh-CN'
  return 'ja' // default for manga
}

function toNum(v: any): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// Collect the LT/LB/RT/RB corner points from an object (Papago vertex format).
function cornersOf(o: any, into: { x: number; y: number }[]): void {
  for (const k of ['LT', 'LB', 'RT', 'RB']) {
    const c = o?.[k]
    if (c && (c.x !== undefined || c.y !== undefined)) into.push({ x: toNum(c.x), y: toNum(c.y) })
  }
}

// Papago Image Translation(Text): data.blocks[] each {sourceText, targetText,
// lines[]}, lines/words carry LT/LB/RT/RB corner coords. One block ≈ one bubble.
function blocksFromPapago(data: any): TransBlock[] {
  const out: TransBlock[] = []
  for (const blk of data?.blocks ?? []) {
    const pts: { x: number; y: number }[] = []
    for (const line of blk.lines ?? []) {
      cornersOf(line, pts)
      for (const word of line.words ?? []) cornersOf(word, pts)
    }
    const text = String(blk.sourceText ?? '')
    const tr = String(blk.targetText ?? '')
    if (!text && !tr) continue
    let x = 0
    let y = 0
    let w = 0
    let h = 0
    if (pts.length) {
      const xs = pts.map((p) => p.x)
      const ys = pts.map((p) => p.y)
      x = Math.min(...xs)
      y = Math.min(...ys)
      w = Math.max(...xs) - x
      h = Math.max(...ys) - y
    }
    out.push({ x, y, w, h, text, tr })
  }
  return out.filter((b) => b.w > 0 && b.h > 0)
}

async function cloudTranslate(buf: Buffer, settings: Settings, langHint?: string): Promise<TransResult> {
  if (!settings.papagoClientId || !settings.papagoClientSecret)
    throw new Error('Papago Client ID/Secret이 설정되지 않았습니다')

  const form = new FormData()
  form.append('source', papagoSource(langHint))
  form.append('target', 'ko')
  form.append('image', new Blob([new Uint8Array(buf)]), 'page.png')

  const res = await fetch(settings.papagoImageEndpoint, {
    method: 'POST',
    headers: {
      'X-NCP-APIGW-API-KEY-ID': settings.papagoClientId,
      'X-NCP-APIGW-API-KEY': settings.papagoClientSecret
    },
    body: form
  })
  const bodyText = await res.text()
  let json: any = {}
  try {
    json = JSON.parse(bodyText)
  } catch {
    /* non-JSON body (e.g. gateway HTML) */
  }
  if (!res.ok || json.error || json.errorCode) {
    const msg =
      json.error?.message ?? json.errorMessage ?? json.message ?? (bodyText.slice(0, 300) || res.statusText)
    throw new Error(`Papago 실패 HTTP ${res.status}: ${msg}`)
  }
  const data = json.data ?? json

  const blocks = blocksFromPapago(data)
  if (blocks.length) {
    // Image dims from the document-level corners (data.LT/RB), else block extent.
    const corners: { x: number; y: number }[] = []
    cornersOf(data, corners)
    let w = corners.length ? Math.max(...corners.map((c) => c.x)) : 0
    let h = corners.length ? Math.max(...corners.map((c) => c.y)) : 0
    if (!w || !h) {
      for (const b of blocks) {
        w = Math.max(w, b.x + b.w)
        h = Math.max(h, b.y + b.h)
      }
    }
    return { ok: true, w, h, blocks }
  }
  // No per-box coordinates → fall back to a single readable panel of text.
  const t = data.targetText ?? data.translatedText ?? data.result?.targetText ?? ''
  const panelText = Array.isArray(t) ? t.join('\n') : String(t || '')
  return { ok: true, w: 0, h: 0, blocks: [], panelText }
}

// --- provider B (local server) ---------------------------------------------
async function localServerTranslate(_buf: Buffer, _settings: Settings): Promise<TransResult> {
  throw new Error('로컬 서버 번역(B안)은 아직 준비 중입니다')
}

// --- Gemini Flash: OCR + translate + boxes in one multimodal call ----------

// Resolve the source language name from a hint, or null when unknown (→ the model
// should auto-detect the page's language instead of being told a wrong one).
function sourceName(hint?: string): string | null {
  const h = (hint ?? '').toLowerCase()
  if (h.startsWith('en') || h === 'english') return 'English'
  if (h.startsWith('zh') || h === 'chinese' || h === 'chinese_traditional') return 'Chinese'
  if (h.startsWith('ja') || h === 'japanese') return 'Japanese'
  if (h.startsWith('ko') || h === 'korean') return 'Korean'
  return null
}

const GEMINI_PROMPT = (hint?: string, extra = ''): string => {
  const src = sourceName(hint)
  // Known language → tell the model exactly what it's reading (restricts OCR to that
  // script, cutting handwriting misreads). Unknown → let it detect per page.
  const lead = src
    ? `The image is one ${src} comic page. Recognize only the ${src} text.`
    : `The image is one comic page; detect the language of each text region (Japanese, Chinese or English) and recognize it in that language.`
  return (
    `You are a professional manga/comic translator. ${lead} ` +
    `Find the DIALOGUE and NARRATION text only — speech bubbles and caption/narration boxes. ` +
    `IGNORE sound effects, onomatopoeia and mimetic words (the large stylised text drawn into ` +
    `the artwork/background); do NOT return an object for those. ` +
    `Skip any region whose text is already Korean. ` +
    `For each separate dialogue/narration region return one object with:\n` +
    `- "box_2d": [ymin, xmin, ymax, xmax] as integers normalized to 0-1000 (tight around the text)\n` +
    `- "text": the original text (in its own language)\n` +
    `- "tr": a natural Korean translation\n` +
    `Group text that belongs to the same bubble into ONE region. Read vertical text correctly. ` +
    `Respond ONLY with a JSON array of these objects, no extra prose.` +
    (extra ? `\n\n${extra}` : '')
  )
}

// Readable error for an OpenAI-compatible call. 404 almost always means the
// provider dropped / renamed the model (free tiers change often).
function llmError(status: number, body: string, model: string): string {
  if (status === 404) return `LLM 모델 '${model}'을(를) 찾을 수 없습니다. 설정 › 번역에서 모델 이름을 확인하세요.`
  if (status === 401 || status === 403) return 'LLM API 키가 올바르지 않습니다 (설정 › 번역)'
  if (status === 429) return 'LLM 무료 사용 한도를 넘었습니다. 잠시 뒤 다시 시도하세요.'
  return `LLM HTTP ${status}: ${body.slice(0, 200)}`
}

// Consistency context shared by every LLM prompt: speech-level rule, the work's
// character notes, the previous page for continuity, and the user's global
// instructions (settings › 번역 › 전역 번역 프롬프트).
function contextBlock(settings: Settings, ctx?: TransContext): string {
  const out = [
    'Speech level (Korean 존댓말/반말): mirror the source. Polite source (です/ます, 敬語, polite address) → 존댓말; ' +
      'plain/casual source → 반말. Never invent politeness the source does not have, and keep each character\'s ' +
      'speech level and way of talking the same across lines and pages.'
  ]
  const memo = ctx?.memo?.trim()
  if (memo) out.push('Character notes for this work (follow them for names, address terms and speech levels):\n' + memo)
  const prev = (ctx?.prev ?? []).filter((p) => p.text && p.tr).slice(-20)
  if (prev.length)
    out.push(
      'Previous page, already translated — context only, do NOT include it in the output:\n' +
        prev.map((p) => `- ${p.text} => ${p.tr}`).join('\n')
    )
  const user = settings.translatePrompt?.trim()
  if (user) out.push("User's instructions (always follow):\n" + user)
  return out.join('\n\n')
}

// Pull every balanced {...} object out of a string and parse each on its own,
// skipping any that don't parse. This salvages a usable result when the model
// returns slightly malformed JSON or a truncated array (a single bad object no
// longer kills the whole page).
function salvageObjects(t: string): any[] {
  const out: any[] = []
  let depth = 0
  let start = -1
  let inStr = false
  let esc = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(t.slice(start, i + 1)))
        } catch {
          /* skip the broken object */
        }
        start = -1
      }
    }
  }
  return out
}

// Strip ```json fences / leading prose and parse the JSON array. Falls back to
// per-object salvage when the array as a whole is malformed or truncated.
// Gemini 2.5 models think by default and the thinking eats the output budget;
// translation needs none, so turn it off there (other models ignore this).
function geminiThinking(model: string): Record<string, unknown> {
  return /gemini-2\.5-flash/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}
}

function parseJsonArray(s: string): any[] {
  let t = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('[')
  const end = t.lastIndexOf(']')
  const sliced = start >= 0 && end > start ? t.slice(start, end + 1) : t
  try {
    const arr = JSON.parse(sliced)
    if (Array.isArray(arr)) return arr
  } catch {
    /* fall through to salvage */
  }
  return salvageObjects(t)
}

async function geminiTranslate(
  buf: Buffer,
  settings: Settings,
  langHint: string | undefined,
  dims?: { w: number; h: number },
  ctx?: TransContext
): Promise<TransResult> {
  if (!settings.geminiApiKey) throw new Error('Gemini API 키가 설정되지 않았습니다')
  const W = dims?.w || 0
  const H = dims?.h || 0
  const model = settings.geminiModel || 'gemini-2.5-flash'
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=` +
    encodeURIComponent(settings.geminiApiKey)

  const body = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: buf.toString('base64') } },
          { text: GEMINI_PROMPT(langHint, contextBlock(settings, ctx)) }
        ]
      }
    ],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 8000, ...geminiThinking(model) }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const txt = await res.text()
  if (!res.ok) {
    let msg = txt.slice(0, 300)
    try {
      msg = JSON.parse(txt).error?.message ?? msg
    } catch {
      /* keep raw */
    }
    throw new Error(`Gemini 실패 HTTP ${res.status}: ${msg}`)
  }
  const data: any = JSON.parse(txt)
  const out = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? ''

  const blocks = blocksFromBoxItems(parseJsonArray(out), W, H)
  return { ok: true, w: W, h: H, blocks }
}

// Turn the model's [ymin,xmin,ymax,xmax] (0-1000) items into pixel boxes.
function blocksFromBoxItems(items: any[], W: number, H: number): TransBlock[] {
  const blocks: TransBlock[] = []
  for (const it of items) {
    const box = it?.box_2d ?? it?.box ?? []
    if (!Array.isArray(box) || box.length < 4) continue
    const [ymin, xmin, ymax, xmax] = box.map(toNum)
    const x = (Math.min(xmin, xmax) / 1000) * W
    const y = (Math.min(ymin, ymax) / 1000) * H
    const w = (Math.abs(xmax - xmin) / 1000) * W
    const h = (Math.abs(ymax - ymin) / 1000) * H
    const text = String(it?.text ?? '')
    const tr = String(it?.tr ?? it?.translation ?? '')
    if ((!text && !tr) || w <= 1 || h <= 1) continue
    blocks.push({ x, y, w, h, text, tr })
  }
  return blocks
}

// --- generic OpenAI-compatible vision engine (Groq / OpenRouter / Mistral) --

async function openaiVisionTranslate(
  buf: Buffer,
  settings: Settings,
  langHint: string | undefined,
  dims?: { w: number; h: number },
  ctx?: TransContext
): Promise<TransResult> {
  if (!settings.llmApiKey) throw new Error('LLM API 키가 설정되지 않았습니다')
  if (!settings.llmModel) throw new Error('LLM 모델이 설정되지 않았습니다')
  const W = dims?.w || 0
  const H = dims?.h || 0
  const base = (settings.llmBaseUrl || '').replace(/\/$/, '')
  if (!base) throw new Error('LLM Base URL이 설정되지 않았습니다')

  const body = {
    model: settings.llmModel,
    temperature: 0,
    // Whole-page manga can have many bubbles; a small cap truncates the JSON
    // mid-array and breaks parsing. Give plenty of room.
    max_tokens: 8000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: GEMINI_PROMPT(langHint, contextBlock(settings, ctx)) },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}` }
          }
        ]
      }
    ]
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.llmApiKey}`,
      // OpenRouter wants these (harmless for others).
      'HTTP-Referer': 'https://localhost/halftone',
      'X-Title': 'Halftone'
    },
    body: JSON.stringify(body)
  })
  const txt = await res.text()
  if (!res.ok) {
    let msg = txt.slice(0, 300)
    try {
      msg = JSON.parse(txt).error?.message ?? msg
    } catch {
      /* keep raw */
    }
    throw new Error(`LLM 실패 HTTP ${res.status}: ${msg}`)
  }
  const data: any = JSON.parse(txt)
  const content = data?.choices?.[0]?.message?.content
  const out = Array.isArray(content)
    ? content.map((c: any) => c?.text ?? '').join('')
    : String(content ?? '')
  const blocks = blocksFromBoxItems(parseJsonArray(out), W, H)
  return { ok: true, w: W, h: H, blocks }
}

// --- free engine: translate OCR'd strings (renderer does the OCR) -----------

function googleLang(hint?: string): string {
  const h = (hint ?? '').toLowerCase()
  if (h.startsWith('en') || h === 'english') return 'en'
  if (h === 'zh-tw' || h === 'chinese_traditional') return 'zh-TW'
  if (h.startsWith('zh') || h === 'chinese') return 'zh-CN'
  return 'ja'
}

function deeplLang(hint?: string): string {
  const h = (hint ?? '').toLowerCase()
  if (h.startsWith('en') || h === 'english') return 'EN'
  if (h.startsWith('zh') || h === 'chinese' || h === 'chinese_traditional') return 'ZH'
  return 'JA'
}

// Google's unofficial, key-less endpoints. Free but ToS-gray and may break.
// Sent through Chromium's network stack (net.fetch): Google answers Node's own
// fetch with 429 "Sorry…" while the same request from Chromium goes through.
// gtx first, then the Chrome dictionary extension endpoint as a fallback.
async function googleTranslateOne(text: string, hint?: string): Promise<string> {
  const q = encodeURIComponent(text)
  const sl = googleLang(hint)
  const res = await net.fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${sl}&tl=ko&q=${q}`)
  if (res.ok) {
    const data: any = await res.json().catch(() => null)
    // data[0] = [ [translatedChunk, original, ...], ... ]
    const chunks = Array.isArray(data?.[0]) ? data[0] : []
    const out = chunks.map((c: any) => (Array.isArray(c) ? c[0] : '')).join('')
    if (out) return out
  }
  const alt = await net.fetch(`https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${sl}&tl=ko&q=${q}`)
  if (!alt.ok) throw new Error(`Google 번역 HTTP ${res.status}/${alt.status}`)
  const d: any = await alt.json().catch(() => null)
  // ["번역"] or [["번역", "ja"]]
  const first = Array.isArray(d) ? d[0] : null
  const out = Array.isArray(first) ? String(first[0] ?? '') : String(first ?? '')
  if (!out) throw new Error('Google 번역이 빈 결과를 돌려줬습니다')
  return out
}

// DeepL Free API. 500k chars/month free; needs a key. Batches all texts in one
// call (multiple text= params), translations come back in order.
async function deeplTranslate(texts: string[], settings: Settings, hint?: string): Promise<string[]> {
  if (!settings.deeplApiKey) throw new Error('DeepL API 키가 설정되지 않았습니다')
  const body = new URLSearchParams()
  body.set('source_lang', deeplLang(hint))
  body.set('target_lang', 'KO')
  for (const t of texts) body.append('text', t)
  const res = await fetch('https://api-free.deepl.com/v2/translate', {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${settings.deeplApiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`DeepL HTTP ${res.status}: ${txt.slice(0, 200)}`)
  const data: any = JSON.parse(txt)
  const arr = Array.isArray(data?.translations) ? data.translations : []
  return texts.map((_, i) => String(arr[i]?.text ?? ''))
}

export async function translateTexts(
  texts: string[],
  settings: Settings,
  langHint?: string
): Promise<{ ok: boolean; texts: string[]; error?: string }> {
  if (!texts.length) return { ok: true, texts: [] }
  try {
    if (settings.freeTranslator === 'deepl') {
      return { ok: true, texts: await deeplTranslate(texts, settings, langHint) }
    }
    // Google: per-string with limited concurrency (few blocks per page).
    const out: string[] = new Array(texts.length).fill('')
    const limit = 4
    let failed = 0
    let lastErr = ''
    for (let i = 0; i < texts.length; i += limit) {
      const batch = texts.slice(i, i + limit)
      const rs = await Promise.allSettled(batch.map((t) => googleTranslateOne(t, langHint)))
      rs.forEach((r, j) => {
        if (r.status === 'fulfilled') out[i + j] = r.value
        else {
          failed++
          lastErr = String((r.reason as Error)?.message ?? r.reason)
        }
      })
    }
    // Every line failed → say so (empty strings looked like "no text found").
    if (failed === texts.length) return { ok: false, texts: [], error: lastErr || 'Google 번역 실패' }
    return { ok: true, texts: out }
  } catch (err: any) {
    return { ok: false, texts: [], error: String(err?.message ?? err) }
  }
}

// ---------- 'local' engine: in-app OCR + text-only translation ----------

const LANG_NAME: Record<string, string> = { japanese: 'Japanese', english: 'English', chinese: 'Chinese' }

// One request for the whole page: numbered lines in, a JSON array of Korean
// strings out (same count/order). Seeing every bubble together keeps names,
// tone and speech level consistent across the page.
function pagePrompt(texts: string[], langHint?: string, extra = ''): string {
  const src = LANG_NAME[(langHint ?? '').toLowerCase()] ?? 'Japanese or English'
  return [
    `You translate manga/doujinshi speech bubbles from ${src} into natural Korean.`,
    'Rules: keep each line\'s meaning, tone and speech level (casual/polite) natural for Korean comics;',
    'keep names consistent; keep moans/sound words short and natural in Korean; do not add explanations.',
    ...(extra ? ['', extra, ''] : []),
    `Return ONLY a JSON array of exactly ${texts.length} Korean strings, in the same order.`,
    '',
    ...texts.map((t, i) => `${i + 1}. ${t}`)
  ].join('\n')
}

async function geminiTextTranslate(texts: string[], settings: Settings, langHint?: string, extra = ''): Promise<string[]> {
  const model = settings.geminiModel || 'gemini-2.5-flash'
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=` +
      encodeURIComponent(settings.geminiApiKey),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: pagePrompt(texts, langHint, extra) }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 8000, ...geminiThinking(model) }
      })
    }
  )
  const txt = await res.text()
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${txt.slice(0, 200)}`)
  const out = JSON.parse(txt)?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? ''
  return parseJsonArray(out).map((x) => String(x ?? ''))
}

async function llmTextTranslate(texts: string[], settings: Settings, langHint?: string, extra = ''): Promise<string[]> {
  const base = (settings.llmBaseUrl || '').replace(/\/$/, '')
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.llmApiKey}`,
      'HTTP-Referer': 'https://localhost/halftone',
      'X-Title': 'Halftone'
    },
    body: JSON.stringify({
      model: settings.llmModel,
      temperature: 0.2,
      max_tokens: 8000,
      messages: [{ role: 'user', content: pagePrompt(texts, langHint, extra) }]
    })
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(llmError(res.status, txt, settings.llmModel))
  const out = JSON.parse(txt)?.choices?.[0]?.message?.content ?? ''
  return parseJsonArray(String(out)).map((x) => String(x ?? ''))
}

// A translator that can't make sense of garbled kana echoes its reading in
// romaji ("NAKATE NAJA") instead of Korean. Japanese source + no Hangul +
// mostly Latin output → treat as a misread and leave the bubble untouched.
function romanized(src: string, tr: string): boolean {
  if (!/[぀-ヿ一-鿿]/.test(src) || /[가-힣]/.test(tr)) return false
  const chars = tr.replace(/[\s\p{P}\p{S}\d]/gu, '')
  return !chars || chars.replace(/[^a-z]/gi, '').length / chars.length > 0.5
}

// Recognized lines → Korean with the 'local' engine's translator chain.
async function localLines(
  texts: string[],
  settings: Settings,
  langHint?: string,
  ctx?: TransContext
): Promise<{ ok: boolean; texts: string[]; error?: string }> {
  const extra = contextBlock(settings, ctx)
  const want = settings.localTranslator ?? 'auto'
  const useGemini = want === 'gemini' || (want === 'auto' && !!settings.geminiApiKey)
  const useLlm =
    !useGemini && (want === 'llm' || (want === 'auto' && (!!settings.llmApiKey || settings.llmProvider === 'ollama') && !!settings.llmModel && !!settings.llmBaseUrl))
  let tr: string[] = []
  try {
    if (useGemini) tr = await geminiTextTranslate(texts, settings, langHint, extra)
    else if (useLlm) tr = await llmTextTranslate(texts, settings, langHint, extra)
  } catch {
    tr = [] // fall back to the free translator below
  }
  // LLM missing / failed / returned the wrong number of lines → free translator.
  if (tr.length !== texts.length) return translateTexts(texts, settings, langHint)
  return { ok: true, texts: tr }
}

async function localTranslate(buf: Buffer, settings: Settings, langHint?: string, ctx?: TransContext): Promise<TransResult> {
  const page = await ocrPage(buf, langHint)
  if (!page.blocks.length) return { ok: true, w: page.w, h: page.h, blocks: [] }
  const r = await localLines(
    page.blocks.map((b) => b.text),
    settings,
    langHint,
    ctx
  )
  if (!r.ok) return { ok: false, w: page.w, h: page.h, blocks: page.blocks, error: r.error ?? '번역 실패' }
  const tr = r.texts
  const blocks = page.blocks.map((b, i) => ({ ...b, tr: tr[i] || '' })).filter((b) => !romanized(b.text, b.tr))
  return { ok: true, w: page.w, h: page.h, blocks }
}

// Translation editor's 영역 번역: OCR just the region the user dragged, then
// translate it. Works whatever the page engine is (needs the local OCR models).
export async function translateRegion(
  buf: Buffer,
  rect: { x: number; y: number; w: number; h: number },
  settings: Settings,
  langHint?: string,
  ctx?: TransContext
): Promise<{ ok: boolean; text: string; tr: string; error?: string }> {
  if (!(await ocrModelsInstalled())) return { ok: false, text: '', tr: '', error: '설정 › 번역에서 로컬 OCR 모델을 먼저 받아주세요' }
  const text = await ocrRegion(buf, rect, langHint)
  if (!text.trim()) return { ok: false, text: '', tr: '', error: '글자를 찾지 못했습니다' }
  const r = await localLines([text], settings, langHint, ctx)
  return r.ok ? { ok: true, text, tr: r.texts[0] ?? '' } : { ok: false, text, tr: '', error: r.error ?? '번역 실패' }
}

// AI draft of a work's character notes: who appears, how each one talks
// (반말/존댓말, quirks), how they address each other, and Korean name spellings.
// Uses the same LLM as translation (Gemini key first, else the LLM provider).
export async function draftCharacterMemo(lines: string[], settings: Settings, langHint?: string): Promise<string> {
  const src = LANG_NAME[(langHint ?? '').toLowerCase()] ?? 'Japanese or English'
  const prompt = [
    `Below are ${src} dialogue lines from the first pages of one manga/doujinshi, in reading order (OCR, may contain misreads).`,
    'Write short CHARACTER NOTES in Korean that a translator will follow for the whole work:',
    '- one line per character: Korean name spelling (original name), how they talk (반말/존댓말/특유의 말투나 어미), and who they speak politely to',
    '- then a few lines for recurring names/terms and how to render them in Korean',
    'Only state what the lines support; mark guesses with "(추정)". Max 15 lines. Output the notes only, no preamble.',
    '',
    ...lines.slice(0, 160)
  ].join('\n')
  // Same model choice as translation (settings › 번역 › 번역기): Gemini when
  // picked (or 자동 with a Gemini key), otherwise the LLM provider/model.
  const want = settings.localTranslator ?? 'auto'
  const useGemini = !!settings.geminiApiKey && (want === 'gemini' || want !== 'llm')
  if (useGemini) {
    const model = settings.geminiModel || 'gemini-2.5-flash'
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=` + encodeURIComponent(settings.geminiApiKey),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2000, ...geminiThinking(model) }
        })
      }
    )
    const txt = await res.text()
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${txt.slice(0, 200)}`)
    return (JSON.parse(txt)?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '').trim()
  }
  const base = (settings.llmBaseUrl || '').replace(/\/$/, '')
  if (!base || !settings.llmModel || (!settings.llmApiKey && settings.llmProvider !== 'ollama'))
    throw new Error('AI 초안에는 Gemini 또는 LLM API 키가 필요합니다 (설정 › 번역)')
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.llmApiKey}`,
      'HTTP-Referer': 'https://localhost/halftone',
      'X-Title': 'Halftone'
    },
    body: JSON.stringify({ model: settings.llmModel, temperature: 0.3, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] })
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(llmError(res.status, txt, settings.llmModel))
  return String(JSON.parse(txt)?.choices?.[0]?.message?.content ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
}

export async function translateImage(
  buf: Buffer,
  settings: Settings,
  langHint?: string,
  dims?: { w: number; h: number },
  ctx?: TransContext
): Promise<TransResult> {
  if (settings.translateEngine === 'local') return localTranslate(buf, settings, langHint, ctx)
  if (settings.translateEngine === 'gemini') return geminiTranslate(buf, settings, langHint, dims, ctx)
  if (settings.translateEngine === 'llm') return openaiVisionTranslate(buf, settings, langHint, dims, ctx)
  if (settings.translateProvider === 'localServer') return localServerTranslate(buf, settings)
  return cloudTranslate(buf, settings, langHint)
}
