// Translation of subtitle / script / name lines into Korean — the same engine
// choices as Halftone: free (Google's unofficial endpoint, or DeepL Free),
// Gemini, or any OpenAI-compatible LLM (Groq / OpenRouter / Mistral / Ollama /
// custom). LLMs get numbered lines as JSON with a few lines of context around
// and answer {id, ko} — ids and count are checked, a batch that comes back
// wrong is asked again, then split, so lines can never shift.
import type { GlossaryEntry, Settings } from '../../shared/types'
import type { Fetch } from '../asr/engines'

export type TranslatorId = Settings['translator']

export type { GlossaryEntry }

export interface TranslateCtx {
  kind: 'subtitle' | 'script' | 'name' | 'align'
  glossary: GlossaryEntry[]
  prompt?: string // the user's extra instructions
  signal?: AbortSignal
  onWait?: (seconds: number) => void // waiting for a rate limit (0 = going again)
}

// One engine call: lines in, the same number of Korean lines out ('' = failed).
export interface Translator {
  readonly id: string
  readonly llm: boolean // understands context / glossary / JSON ids
  readonly batch?: number // lines per call (default: 40 for LLMs, 50 otherwise)
  translate(lines: string[], before: string[], after: string[], ctx: TranslateCtx): Promise<string[]>
}

export const TRANSLATE = {
  batch: 40, // lines per LLM request
  context: 3, // lines of context on each side
  retries: 2,
  waitS: 20, // a 429 that says nothing about how long
  maxWaitS: 180, // longer than this (a daily limit): stop instead of waiting
  maxWaits: 20, // 429s in a row for one request
  minTokensLeft: 2500, // fewer left this minute: wait for the reset first
  maxAnswerTokens: 4096,
  groqGapMs: 2100, // between Groq requests (free: 30 a minute, not in its headers)
  googleGapMs: 1500, // between Google requests
  googleChars: 4000 // URL-encoded characters per Google request
}

export const LLM_BASE: Record<Settings['llmProvider'], string> = {
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  mistral: 'https://api.mistral.ai/v1',
  ollama: 'http://127.0.0.1:11434/v1',
  custom: ''
}

const KIND_TEXT: Record<TranslateCtx['kind'], string> = {
  subtitle: 'subtitles of a Japanese voice drama / ASMR work (one speaker talking to the listener)',
  script: 'lines of a Japanese voice drama / ASMR script',
  align: 'pieces of Japanese speech written down by a speech engine (may be noisy), only to find where they are in a Korean script. A plain literal translation is enough',
  name: 'file and folder names of a Japanese voice drama work. Keep codes like RJ01234567, track numbers, brackets 【】「」 and SE/format words as they are'
}

export function llmPrompt(items: { id: number; text: string }[], before: string[], after: string[], ctx: TranslateCtx): string {
  return [
    `You translate ${KIND_TEXT[ctx.kind]} into natural Korean.`,
    "Keep each line's meaning, tone and speech level (반말/존댓말) natural for Korean; keep names consistent;",
    'keep moans and sound words short and natural in Korean; never add explanations or notes.',
    ...(ctx.glossary.length ? ['', 'Glossary (always use these):', ...ctx.glossary.map((g) => `${g.source} → ${g.target}`)] : []),
    ...(ctx.prompt ? ['', ctx.prompt] : []),
    ...(before.length ? ['', 'Context before (do not translate):', ...before] : []),
    ...(after.length ? ['', 'Context after (do not translate):', ...after] : []),
    '',
    `Return ONLY a JSON array of exactly ${items.length} objects {"id": number, "ko": string}, same ids, same order.`,
    JSON.stringify(items)
  ].join('\n')
}

// Pull {id, ko} objects out of an answer (code fences / chatter tolerated).
export function parseIdAnswer(answer: string): Map<number, string> {
  const out = new Map<number, string>()
  // reasoning models (Qwen3, DeepSeek-R1 …) may put their thinking first
  const text = answer.replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
  const s = text.indexOf('[')
  const e = text.lastIndexOf(']')
  const tryParse = (t: string): unknown => {
    try {
      return JSON.parse(t)
    } catch {
      return null
    }
  }
  let arr = s >= 0 && e > s ? tryParse(text.slice(s, e + 1)) : null
  if (!Array.isArray(arr)) {
    // salvage objects one by one
    arr = [...text.matchAll(/\{[^{}]*\}/g)].map((m) => tryParse(m[0])).filter(Boolean)
  }
  for (const o of arr as { id?: unknown; ko?: unknown }[]) {
    if (o && typeof o.id === 'number' && typeof o.ko === 'string') out.set(o.id, o.ko)
  }
  return out
}

// Stops the whole job (not just one batch): the engine refused us — Google
// blocked the address, or a daily quota is used up. Retrying only makes it worse.
export class TranslateStop extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TranslateStop'
  }
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((res, rej) => {
    if (signal?.aborted) return rej(new Error('cancelled'))
    const t = setTimeout(res, ms)
    signal?.addEventListener('abort', () => (clearTimeout(t), rej(new Error('cancelled'))), { once: true })
  })

// "12", "7.66s", "1m2.5s", "2h3m", "250ms" → seconds
export function parseWait(v: string | null | undefined): number | null {
  if (!v) return null
  if (/^\d+(\.\d+)?$/.test(v.trim())) return Number(v)
  let s = 0
  for (const [, n, u] of v.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) s += Number(n) * (u === 'h' ? 3600 : u === 'm' ? 60 : u === 'ms' ? 0.001 : 1)
  return s || null
}

// Per engine: don't send before this time (the minute's tokens are spent).
const nextAt = new Map<string, number>()
// Per engine: the plain gap between requests (not shown as a wait).
const gapAt = new Map<string, number>()

// An LLM request that keeps to the provider's limits: before sending, waits
// out a spent minute; on 429 waits what the provider says and sends again;
// a wait too long (a daily limit) stops the job.
async function limited(name: string, send: () => Promise<Response>, ctx: TranslateCtx, gapMs = 0): Promise<string> {
  for (let tries = 0; ; tries++) {
    const hold = (nextAt.get(name) ?? 0) - Date.now()
    if (hold > 0) {
      ctx.onWait?.(Math.ceil(hold / 1000))
      await sleep(hold, ctx.signal)
      ctx.onWait?.(0)
    }
    const gap = (gapAt.get(name) ?? 0) - Date.now()
    if (gap > 0) await sleep(gap, ctx.signal)
    if (gapMs) gapAt.set(name, Date.now() + gapMs)
    const res = await send()
    const txt = await res.text()
    const h = (k: string): string | null => res.headers?.get?.(k) ?? null
    if (res.status !== 429) {
      if (!res.ok) throw new Error(`${name} HTTP ${res.status}: ${txt.slice(0, 200)}`)
      const left = Number(h('x-ratelimit-remaining-tokens') ?? NaN)
      const reset = parseWait(h('x-ratelimit-reset-tokens'))
      if (left < TRANSLATE.minTokensLeft && reset) nextAt.set(name, Date.now() + reset * 1000 + 300)
      return txt
    }
    const said =
      parseWait(h('retry-after')) ??
      parseWait(txt.match(/try again in ([\dhms.]+)/i)?.[1]) ??
      parseWait(txt.match(/"retryDelay":\s*"([\d.]+s)"/)?.[1]) ??
      parseWait(h('x-ratelimit-reset-tokens')) ??
      TRANSLATE.waitS
    const daily = /per day|daily|PerDay|TPD|RPD/i.test(txt)
    if (said > TRANSLATE.maxWaitS || tries >= TRANSLATE.maxWaits)
      throw new TranslateStop(
        `${name}: ${daily ? '하루 사용 한도' : '사용 한도'}를 다 썼습니다. 약 ${Math.ceil(said / 60)}분 뒤에 다시 하거나 다른 번역 엔진을 쓰세요.`
      )
    nextAt.set(name, Date.now() + said * 1000 + 300)
  }
}

// Room for the answer: about the length of the lines (Korean ≈ Japanese in
// tokens) plus the JSON around them. Asking for far more than needed counts
// against per-minute token limits on some providers (Groq: 8 K a minute free).
export function answerTokens(lines: string[], thinking = false): number {
  const chars = lines.reduce((n, l) => n + l.length, 0)
  return Math.min(TRANSLATE.maxAnswerTokens, 200 + lines.length * 16 + chars * 2 + (thinking ? 1024 : 0))
}

class LlmTranslator implements Translator {
  readonly llm = true
  constructor(
    readonly id: string,
    private call: (prompt: string, ctx: TranslateCtx, maxTokens: number) => Promise<string>,
    private thinking = false
  ) {}
  async translate(lines: string[], before: string[], after: string[], ctx: TranslateCtx): Promise<string[]> {
    const items = lines.map((text, i) => ({ id: i + 1, text }))
    const got = parseIdAnswer(await this.call(llmPrompt(items, before, after, ctx), ctx, answerTokens(lines, this.thinking)))
    return items.map((it) => got.get(it.id) ?? '')
  }
}

export function geminiTranslator(s: Settings, fetchFn: Fetch = fetch): Translator {
  const model = s.geminiModel || 'gemini-2.5-flash'
  return new LlmTranslator(`gemini:${model}`, async (prompt, ctx, maxTokens) => {
    if (!s.geminiApiKey) throw new Error('Gemini API 키가 설정되지 않았습니다')
    const txt = await limited(
      'Gemini',
      () =>
        fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(s.geminiApiKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctx.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: 'application/json',
              maxOutputTokens: maxTokens,
              ...(/flash/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {})
            }
          })
        }),
      ctx
    )
    const data = JSON.parse(txt) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  })
}

export function llmTranslator(s: Settings, fetchFn: Fetch = fetch): Translator {
  const base = (s.llmProvider === 'custom' ? s.llmBaseUrl : LLM_BASE[s.llmProvider] || s.llmBaseUrl).replace(/\/$/, '')
  const key = s.llmApiKey || (s.llmProvider === 'groq' ? s.groqApiKey : '')
  // reasoning models: Qwen3 can switch thinking off; gpt-oss only down to "low"
  const qwen = /qwen3/i.test(s.llmModel)
  const gptOss = /gpt-oss/i.test(s.llmModel)
  const name = { groq: 'Groq', openrouter: 'OpenRouter', mistral: 'Mistral', ollama: 'Ollama', custom: 'LLM' }[s.llmProvider]
  return new LlmTranslator(
    `llm:${s.llmProvider}:${s.llmModel}`,
    async (prompt, ctx, maxTokens) => {
      if (!base) throw new Error('LLM 주소가 설정되지 않았습니다')
      if (!key && s.llmProvider !== 'ollama') throw new Error('LLM API 키가 설정되지 않았습니다')
      const txt = await limited(
        name,
        () =>
          fetchFn(`${base}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://localhost/env', 'X-Title': 'Envelope' },
            signal: ctx.signal,
            body: JSON.stringify({
              model: s.llmModel,
              temperature: 0.2,
              max_tokens: maxTokens,
              messages: [{ role: 'user', content: prompt }],
              ...(s.llmProvider === 'groq' && qwen ? { reasoning_effort: 'none' } : {}),
              ...(s.llmProvider === 'groq' && gptOss ? { reasoning_effort: 'low' } : {})
            })
          }),
        ctx,
        s.llmProvider === 'groq' ? TRANSLATE.groqGapMs : 0
      )
      const data = JSON.parse(txt) as { choices?: { message?: { content?: string } }[] }
      return String(data.choices?.[0]?.message?.content ?? '')
    },
    gptOss
  )
}

// Google's key-less endpoint (free, unofficial). It flags an address that
// sends too much (then even the browser gets captchas), so: many lines in one
// request (joined by newlines), one request at a time with a gap, and on any
// sign of a block the job stops — no second endpoint, no retries.
let googleNext = 0
export function googleTranslator(fetchFn: Fetch = fetch): Translator {
  const ask = async (text: string, signal?: AbortSignal): Promise<string> => {
    const wait = googleNext - Date.now()
    if (wait > 0) await sleep(wait, signal)
    googleNext = Date.now() + TRANSLATE.googleGapMs
    const res = await fetchFn(`https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=ja&tl=ko&q=${encodeURIComponent(text)}`, { signal })
    const body = await res.text()
    let data: unknown = null
    try {
      data = res.ok ? JSON.parse(body) : null
    } catch {
      data = null
    }
    if (!Array.isArray(data)) {
      if ([403, 429, 503].includes(res.status) || /sorry|captcha|unusual traffic/i.test(body))
        throw new TranslateStop('짧은 시간에 요청이 많아 Google이 요청을 막았습니다. 한동안 기다리거나 다른 번역 엔진(Gemini · DeepL · LLM)을 쓰세요.')
      throw new Error(`Google 번역 HTTP ${res.status}`)
    }
    const chunks = Array.isArray(data[0]) ? (data[0] as unknown[]) : []
    return chunks.map((c) => (Array.isArray(c) ? String(c[0] ?? '') : '')).join('')
  }
  return {
    id: 'google',
    llm: false,
    batch: 400,
    async translate(lines, _b, _a, ctx) {
      const out: string[] = new Array(lines.length).fill('')
      // packs of non-empty lines that fit one request
      const packs: number[][] = []
      let cur: number[] = []
      let size = 0
      lines.forEach((l, i) => {
        if (!l.trim()) return
        const n = encodeURIComponent(l).length + 3
        if (cur.length && size + n > TRANSLATE.googleChars) {
          packs.push(cur)
          cur = []
          size = 0
        }
        cur.push(i)
        size += n
      })
      if (cur.length) packs.push(cur)
      for (const pack of packs) {
        const got = (await ask(pack.map((i) => lines[i].replace(/\n/g, ' ')).join('\n'), ctx.signal)).split('\n')
        if (got.length === pack.length) pack.forEach((i, k) => (out[i] = got[k].trim()))
        else for (const i of pack) out[i] = (await ask(lines[i], ctx.signal)).trim() // lines merged: one by one
      }
      return out
    }
  }
}

export function deeplTranslator(s: Settings, fetchFn: Fetch = fetch): Translator {
  return {
    id: 'deepl',
    llm: false,
    async translate(lines, _b, _a, ctx) {
      if (!s.deeplApiKey) throw new Error('DeepL API 키가 설정되지 않았습니다')
      const body = new URLSearchParams()
      body.set('source_lang', 'JA')
      body.set('target_lang', 'KO')
      for (const t of lines) body.append('text', t)
      const res = await fetchFn('https://api-free.deepl.com/v2/translate', {
        method: 'POST',
        headers: { Authorization: `DeepL-Auth-Key ${s.deeplApiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: ctx.signal
      })
      const txt = await res.text()
      if (!res.ok) throw new Error(`DeepL HTTP ${res.status}: ${txt.slice(0, 200)}`)
      const arr = (JSON.parse(txt) as { translations?: { text?: string }[] }).translations ?? []
      return lines.map((_, i) => String(arr[i]?.text ?? ''))
    }
  }
}

export function makeTranslator(s: Settings, fetchFn: Fetch = fetch, chromiumFetch: Fetch = fetchFn, which: Settings['translator'] = s.translator): Translator {
  switch (which) {
    case 'deepl':
      return deeplTranslator(s, fetchFn)
    case 'gemini':
      return geminiTranslator(s, fetchFn)
    case 'llm':
      return llmTranslator(s, fetchFn)
    default:
      return googleTranslator(chromiumFetch)
  }
}

// Glossary sources replaced before a non-LLM engine sees the line (the LLMs
// get the glossary in the prompt instead).
function applyGlossary(line: string, glossary: GlossaryEntry[]): string {
  let out = line
  for (const g of glossary) if (g.source) out = out.split(g.source).join(g.target)
  return out
}

// 같은 줄 빼기: a line said again in the same work is sent once and its
// translation copied — only lines whose meaning doesn't hang on the scene
// (measured on the sample library: −24% lines): sound words / moans, whole
// stage directions "(泣)" "(息を吐く音)", and lines of 8+ characters (a long
// line repeated word for word is the same line). Short words like はい / いいよ
// / ほら still go line by line — their translation depends on the context.
export function dedupeKey(line: string): string {
  return line
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(\.{2,}|・{2,}|‥|…)+/g, '…')
    .replace(/[～〜~]+/g, '〜')
    .replace(/!+/g, '!')
    .replace(/\?+/g, '?')
}
export function isSoundWord(key: string): boolean {
  const core = key.replace(/[…、。!?〜♡♥・\s「」『』()（）]/g, '')
  if (!core || core.length > 10 || !/^[ぁ-ゖァ-ヺー]+$/.test(core)) return false
  return /[ぁぃぅぇぉァィゥェォー]|[っッ]$|(.)\1\1/.test(core)
}
export const dedupable = (key: string): boolean => key.length >= 8 || /^\(.*\)$/.test(key) || isSoundWord(key)

export interface TranslateLinesOptions {
  dedupe?: boolean // 같은 줄 빼기 (above)
  breaks?: number[] // indices where a new track starts: context never crosses them
  // after each request: lines before `upTo` are final in `out` (to save
  // finished tracks right away, so a stop loses only the track in progress)
  onDone?: (upTo: number, out: string[]) => void | Promise<void>
}

// Lines handed in track by track while earlier ones are being translated: a
// request goes out as soon as a batch is full (40 lines to send), the rest
// waits for the next tracks; after end() the last, smaller batch goes too.
export interface LineStream {
  push(lines: string[]): number // one track (context stays inside it); its first index
  end(): void // no more tracks
  done: Promise<string[]> // every translation; rejects on a stop / failure
}

// Translate every line: batches with context, checked and re-asked; a batch
// that keeps failing is split down to single lines. Batches may span tracks,
// so several short tracks share a request. onProgress(done, total) counts the
// lines actually sent (total grows while tracks come in).
export function translateStream(
  tr: Translator,
  ctx: TranslateCtx,
  onProgress?: (done: number, total: number) => void,
  opts: Omit<TranslateLinesOptions, 'breaks'> = {}
): LineStream {
  const lines: string[] = []
  const out: string[] = []
  const breaks: number[] = []
  // which lines go out; the others copy the line they repeat
  const send: number[] = []
  const copyOf = new Map<number, number>()
  const first = new Map<string, number>()
  let ended = false
  let wake: (() => void) | null = null
  const nudge = (): void => {
    wake?.()
    wake = null
  }
  // context: neighbours in the original lines, within the same track (a
  // track is pushed whole, so its lines are all there)
  ctx.signal?.addEventListener('abort', nudge, { once: true })
  const trackStart = (i: number): number => Math.max(0, ...breaks.filter((b) => b <= i))
  const trackEnd = (i: number): number => Math.min(lines.length, ...breaks.filter((b) => b > i))
  const size = tr.batch ?? (tr.llm ? TRANSLATE.batch : 50)
  let done = 0
  const run = async (from: number, to: number, depth: number): Promise<void> => {
    ctx.signal?.throwIfAborted()
    const idx = send.slice(from, to)
    const part = idx.map((i) => lines[i])
    const lo = idx[0]
    const hi = idx[idx.length - 1]
    const ctxOn = tr.llm && ctx.kind !== 'align' // finding places needs no context: fewer tokens
    const before = ctxOn ? lines.slice(Math.max(trackStart(lo), lo - TRANSLATE.context), lo) : []
    const after = ctxOn ? lines.slice(hi + 1, Math.min(trackEnd(hi), hi + 1 + TRANSLATE.context)) : []
    let got: string[] = []
    let lastErr: unknown = null
    for (let a = 0; a <= TRANSLATE.retries; a++) {
      try {
        got = await tr.translate(tr.llm ? part : part.map((l) => applyGlossary(l, ctx.glossary)), before, after, ctx)
        if (got.length === part.length && got.every((g, i) => g.trim() || !part[i].trim())) break
      } catch (e) {
        if (ctx.signal?.aborted || e instanceof TranslateStop) throw e
        lastErr = e
      }
    }
    const bad = got.length !== part.length || got.some((g, i) => !g.trim() && part[i].trim())
    if (bad && part.length > 1 && depth < 6) {
      const mid = from + Math.ceil(part.length / 2)
      await run(from, mid, depth + 1)
      await run(mid, to, depth + 1)
      return
    }
    if (bad && !got.length && lastErr) throw lastErr
    idx.forEach((li, i) => (out[li] = got[i] ?? ''))
    done += part.length
    onProgress?.(done, send.length)
  }
  // a repeat always copies an earlier line, so everything before the next
  // line to send is final once its copies are filled in
  const fill = (upTo: number): void => {
    for (const [i, f] of copyOf) if (i < upTo) out[i] = out[f]
  }
  const loop = async (): Promise<string[]> => {
    let sent = 0
    for (;;) {
      // a full batch, or whatever is left once no more tracks come
      while (send.length - sent < size && !ended) {
        ctx.signal?.throwIfAborted()
        await new Promise<void>((r) => (wake = r))
      }
      if (sent >= send.length) break
      const to = Math.min(send.length, sent + size)
      await run(sent, to, 0)
      sent = to
      if (opts.onDone) {
        const upTo = sent < send.length ? send[sent] : lines.length
        fill(upTo)
        await opts.onDone(upTo, out)
      }
    }
    fill(lines.length)
    return out
  }
  return {
    push(track) {
      const at = lines.length
      breaks.push(at)
      track.forEach((l, j) => {
        const i = at + j
        lines.push(l)
        out.push('')
        const k = opts.dedupe ? dedupeKey(l) : ''
        if (k && dedupable(k)) {
          const f = first.get(k)
          if (f !== undefined) return void copyOf.set(i, f)
          first.set(k, i)
        }
        send.push(i)
      })
      nudge()
      return at
    },
    end() {
      ended = true
      nudge()
    },
    done: loop()
  }
}

// All lines at once (`breaks` = where each track starts).
export async function translateLines(
  lines: string[],
  tr: Translator,
  ctx: TranslateCtx,
  onProgress?: (done: number, total: number) => void,
  opts: TranslateLinesOptions = {}
): Promise<string[]> {
  const s = translateStream(tr, ctx, onProgress, opts)
  const cuts = [...new Set([0, ...(opts.breaks ?? []), lines.length])].sort((a, b) => a - b)
  for (let k = 0; k + 1 < cuts.length; k++) s.push(lines.slice(cuts[k], cuts[k + 1]))
  s.end()
  return s.done
}
