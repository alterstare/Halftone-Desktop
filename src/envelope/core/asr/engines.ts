// Speech engines behind one interface (tests use the mock):
//  · Groq — whisper-large-v3-turbo over the API (the audio leaves the PC, only
//    when the user picked it and allowed it).
//  · whisper.cpp — a local child process (Vulkan build first, CPU build as the
//    fallback), models in the data folder.
import { spawn } from 'child_process'
import { existsSync, promises as fsp, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ASR_RATE, wavFromPcm16 } from './audio'
import type { AsrSegment, AsrWord } from './clean'

export interface AsrOptions {
  language: string // 'ja'
  words?: boolean // word / token times (script alignment)
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

export interface AsrEngine {
  readonly id: string // goes into cache keys (engine + model)
  transcribe(pcm: Int16Array, opts: AsrOptions): Promise<AsrSegment[]>
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((res, rej) => {
    const t = setTimeout(res, ms)
    signal?.addEventListener('abort', () => (clearTimeout(t), rej(new Error('cancelled'))), { once: true })
  })

export const GROQ = {
  url: 'https://api.groq.com/openai/v1/audio/transcriptions',
  model: 'whisper-large-v3-turbo',
  maxChunkS: 600, // 16 kHz 16-bit mono: ~19 MB per 10 min (the free limit is 25 MB)
  retries: 5,
  waitS: 20 // when a 429 gives no retry-after
}

export class GroqAsr implements AsrEngine {
  readonly id = `groq:${GROQ.model}`
  constructor(
    private key: string,
    private fetchFn: Fetch = fetch
  ) {}

  async transcribe(pcm: Int16Array, opts: AsrOptions): Promise<AsrSegment[]> {
    if (!this.key) throw new Error('Groq API 키가 설정되지 않았습니다')
    for (let attempt = 0; ; attempt++) {
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(wavFromPcm16(pcm))], { type: 'audio/wav' }), 'audio.wav')
      form.append('model', GROQ.model)
      form.append('language', opts.language)
      form.append('response_format', 'verbose_json')
      form.append('temperature', '0')
      form.append('timestamp_granularities[]', 'segment')
      if (opts.words) form.append('timestamp_granularities[]', 'word')
      const res = await this.fetchFn(GROQ.url, { method: 'POST', headers: { Authorization: `Bearer ${this.key}` }, body: form, signal: opts.signal })
      if (res.status === 429 && attempt < GROQ.retries) {
        const after = Number(res.headers.get('retry-after')) || GROQ.waitS
        await sleep(after * 1000, opts.signal)
        continue
      }
      const txt = await res.text()
      if (!res.ok) throw new Error(`Groq 받아쓰기 HTTP ${res.status}: ${txt.slice(0, 200)}`)
      const data = JSON.parse(txt) as {
        segments?: { start: number; end: number; text: string; no_speech_prob?: number }[]
        words?: { word: string; start: number; end: number }[]
      }
      const words: AsrWord[] = (data.words ?? []).map((w) => ({ start: w.start, end: w.end, text: w.word }))
      opts.onProgress?.(1)
      return (data.segments ?? []).map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
        noSpeech: s.no_speech_prob,
        words: opts.words ? words.filter((w) => w.start >= s.start - 0.01 && w.start < s.end) : undefined
      }))
    }
  }
}

// ---- whisper.cpp ----

export const WHISPER_MODELS = {
  'large-v3-turbo-q5_0': { file: 'ggml-large-v3-turbo-q5_0.bin', mb: 574, label: 'large-v3-turbo (q5, 받아쓰기)' },
  small: { file: 'ggml-small.bin', mb: 488, label: 'small (정렬 재시도)' },
  base: { file: 'ggml-base.bin', mb: 148, label: 'base (정렬 재시도)' },
  tiny: { file: 'ggml-tiny.bin', mb: 78, label: 'tiny (대본 정렬)' }
} as const
export type WhisperModel = keyof typeof WHISPER_MODELS
export const MODEL_URL = (m: WhisperModel): string => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODELS[m].file}`

export type WhisperBuild = 'vulkan' | 'cpu'

// The whisper-cli binary of a build inside the engines folder (or null).
export function whisperBinary(enginesDir: string, build: WhisperBuild): string | null {
  const dir = join(enginesDir, `whisper-${build}`)
  if (!existsSync(dir)) return null
  const names = process.platform === 'win32' ? ['whisper-cli.exe', 'main.exe'] : ['whisper-cli', 'main']
  const walk = (d: string, depth: number): string | null => {
    for (const n of names) if (existsSync(join(d, n))) return join(d, n)
    if (depth <= 0) return null
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        const hit = walk(join(d, e.name), depth - 1)
        if (hit) return hit
      }
    }
    return null
  }
  return walk(dir, 3)
}

export function modelPath(modelsDir: string, m: WhisperModel): string {
  return join(modelsDir, WHISPER_MODELS[m].file)
}

interface CliToken {
  text: string
  offsets: { from: number; to: number }
  p?: number
  t_dtw?: number // 10 ms units, -1 = none
}
interface CliSegment {
  offsets: { from: number; to: number }
  text: string
  tokens?: CliToken[]
}

export class WhisperCppAsr implements AsrEngine {
  readonly id: string
  constructor(
    private enginesDir: string,
    private model: string, // model file path
    private device: 'auto' | 'cpu' = 'auto',
    private threads = 0
  ) {
    // ":mc0:dtw" — results from before -mc 0 (some looped) / DTW are not reused
    this.id = `whisper.cpp:${model.split(/[\\/]/).pop()}:mc0:dtw`
  }

  // Builds to try, in order: Vulkan (GPU), then CPU.
  builds(): { build: WhisperBuild; bin: string }[] {
    const out: { build: WhisperBuild; bin: string }[] = []
    if (this.device === 'auto') {
      const v = whisperBinary(this.enginesDir, 'vulkan')
      if (v) out.push({ build: 'vulkan', bin: v })
    }
    const c = whisperBinary(this.enginesDir, 'cpu')
    if (c) out.push({ build: 'cpu', bin: c })
    return out
  }

  async transcribe(pcm: Int16Array, opts: AsrOptions): Promise<AsrSegment[]> {
    if (!existsSync(this.model)) throw new Error('whisper 모델이 없습니다. 설정에서 모델을 받으세요.')
    const builds = this.builds()
    if (!builds.length) throw new Error('whisper.cpp 엔진이 없습니다. 설정에서 엔진을 받으세요.')
    const dir = await fsp.mkdtemp(join(tmpdir(), 'env-asr-'))
    const wavPath = join(dir, 'in.wav')
    await fsp.writeFile(wavPath, wavFromPcm16(pcm, ASR_RATE))
    try {
      let lastErr: unknown = null
      for (const b of builds) {
        try {
          return await this.run(b.bin, b.build, wavPath, join(dir, 'out'), opts)
        } catch (e) {
          if (opts.signal?.aborted) throw e
          lastErr = e // Vulkan failed (no GPU / driver) → try the CPU build
        }
      }
      throw lastErr
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  }

  private run(bin: string, build: WhisperBuild, wav: string, outBase: string, opts: AsrOptions): Promise<AsrSegment[]> {
    // -mc 0: no previous text as prompt — otherwise one misheard moan can
    // repeat to the end of a long track ("お腹をむしめる!" × 30)
    const args = ['-m', this.model, '-f', wav, '-l', opts.language, '-mc', '0', '-oj', '-ojf', '-of', outBase, '-pp']
    // word times by DTW over the attention (tokens' own times run ~1 s late
    // and loose); needs flash attention off
    const preset = dtwPreset(this.model)
    if (opts.words && preset) args.push('-nfa', '-dtw', preset)
    if (this.threads > 0) args.push('-t', String(this.threads))
    if (build === 'cpu') args.push('-ng')
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { windowsHide: true })
      let err = ''
      const onAbort = (): void => void child.kill()
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      const progress = (chunk: Buffer): void => {
        const s = chunk.toString()
        err = (err + s).slice(-4000)
        const m = s.match(/progress\s*=\s*(\d+)%/g)
        if (m) opts.onProgress?.(Number(m[m.length - 1].replace(/\D/g, '')) / 100)
      }
      child.stderr.on('data', progress)
      child.stdout.on('data', progress)
      child.on('error', (e) => reject(e))
      child.on('close', async (code) => {
        opts.signal?.removeEventListener('abort', onAbort)
        if (opts.signal?.aborted) return reject(new Error('cancelled'))
        if (code !== 0) return reject(new Error(`whisper.cpp(${build}) 종료 코드 ${code}: ${err.split('\n').slice(-3).join(' ')}`))
        try {
          const json = JSON.parse(await fsp.readFile(`${outBase}.json`, 'utf8')) as { transcription?: CliSegment[] }
          resolve((json.transcription ?? []).map((s) => cliSegment(s, !!opts.words)))
        } catch (e) {
          reject(e)
        }
      })
    })
  }
}

const DTW_PRESET: [RegExp, string][] = [
  [/large-v3-turbo/, 'large.v3.turbo'],
  [/ggml-small/, 'small'],
  [/ggml-base/, 'base'],
  [/ggml-tiny/, 'tiny']
]
const dtwPreset = (model: string): string | null => DTW_PRESET.find(([re]) => re.test(model))?.[1] ?? null

function cliSegment(s: CliSegment, words: boolean): AsrSegment {
  const seg: AsrSegment = { start: s.offsets.from / 1000, end: s.offsets.to / 1000, text: s.text }
  if (words && s.tokens) {
    const toks = s.tokens.filter((t) => t.text && !t.text.startsWith('[_') && !t.text.startsWith('<|'))
    const dtw = toks.length > 0 && toks.every((t) => (t.t_dtw ?? -1) >= 0)
    const at = (t: CliToken): number => (dtw ? t.t_dtw! / 100 : t.offsets.from / 1000)
    seg.words = toks.map((t, i) => {
      const start = at(t)
      const next = i + 1 < toks.length ? at(toks[i + 1]) : dtw ? seg.end : t.offsets.to / 1000
      return { start, end: Math.max(start, next), text: t.text, p: t.p }
    })
  }
  return seg
}

// Tests: returns what it is given, scaled to the audio length.
export class MockAsr implements AsrEngine {
  readonly id = 'mock'
  calls = 0
  constructor(private make: (seconds: number) => AsrSegment[]) {}
  async transcribe(pcm: Int16Array, opts: AsrOptions): Promise<AsrSegment[]> {
    this.calls++
    opts.onProgress?.(1)
    return this.make(pcm.length / ASR_RATE)
  }
}
