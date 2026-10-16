// 엔진 · 모델 받기: the whisper.cpp builds (CPU from the official releases,
// Vulkan from Envelope's CI) and the ggml models from Hugging Face — into the
// data folder, through ".part" files so a broken download never looks finished.
import { createWriteStream, existsSync, promises as fsp } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFile } from 'child_process'
import AdmZip from 'adm-zip'
import type { EngineStatus } from '../../shared/types'
import type { Fetch, WhisperBuild, WhisperModel } from './engines'
import { MODEL_URL, WHISPER_MODELS, modelPath, whisperBinary } from './engines'

export type { EngineStatus }

export function engineStatus(enginesDir: string, modelsDir: string): EngineStatus {
  const models = {} as Record<WhisperModel, boolean>
  for (const m of Object.keys(WHISPER_MODELS) as WhisperModel[]) models[m] = !!modelsDir && existsSync(modelPath(modelsDir, m))
  return { vulkan: !!whisperBinary(enginesDir, 'vulkan'), cpu: !!whisperBinary(enginesDir, 'cpu'), models }
}

type Progress = (done: number, total: number) => void

export async function download(url: string, dest: string, fetchFn: Fetch, onProgress: Progress, signal?: AbortSignal): Promise<void> {
  const res = await fetchFn(url, { signal, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`받기 실패 HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  const part = `${dest}.part`
  const out = createWriteStream(part)
  let done = 0
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done: end, value } = await reader.read()
      if (end) break
      done += value.length
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
      onProgress(done, total)
    }
    await new Promise<void>((res2, rej) => out.end((e?: Error | null) => (e ? rej(e) : res2())))
    if (total && done !== total) throw new Error('받은 크기가 맞지 않습니다')
    await fsp.rename(part, dest)
  } catch (e) {
    out.destroy()
    await fsp.rm(part, { force: true })
    throw e
  }
}

export async function installModel(modelsDir: string, m: WhisperModel, fetchFn: Fetch, onProgress: Progress, signal?: AbortSignal): Promise<void> {
  await download(MODEL_URL(m), modelPath(modelsDir, m), fetchFn, onProgress, signal)
}

export async function removeModel(modelsDir: string, m: WhisperModel): Promise<void> {
  await fsp.rm(modelPath(modelsDir, m), { force: true })
}

// Where each build comes from: the official whisper.cpp releases have only a CPU
// build; the Vulkan build is made by .github/workflows/whisper-vulkan.yml into an
// Envelope pre-release (whisper-vulkan-v<whisper.cpp version>).
const SOURCES: Record<WhisperBuild, { releases: string; asset: string | null }> = {
  cpu: {
    releases: 'https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=15',
    asset: process.platform === 'win32' ? 'whisper-bin-x64.zip' : 'whisper-bin-ubuntu-x64.tar.gz'
  },
  vulkan: {
    releases: 'https://api.github.com/repos/alterstare/Envelope/releases?per_page=50',
    asset: process.platform === 'win32' ? 'whisper-vulkan-win-x64.zip' : process.platform === 'linux' ? 'whisper-vulkan-linux-x64.tar.gz' : null
  }
}

// The newest release of one build → engines/whisper-<build>. Returns the release tag.
export async function installBuild(enginesDir: string, build: WhisperBuild, fetchFn: Fetch, onProgress: Progress, signal?: AbortSignal): Promise<string> {
  const { releases: url, asset: name } = SOURCES[build]
  const label = build === 'vulkan' ? 'Vulkan' : 'CPU'
  if (!name) throw new Error(`이 운영체제용 whisper.cpp ${label} 빌드가 없습니다`)
  const res = await fetchFn(url, { signal, headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(`릴리즈 목록 HTTP ${res.status}`)
  const releases = (await res.json()) as { tag_name: string; draft?: boolean; assets: { name: string; browser_download_url: string }[] }[]
  const rel = releases.find((r) => !r.draft && r.assets.some((a) => a.name === name))
  const asset = rel?.assets.find((a) => a.name === name)
  if (!rel || !asset) throw new Error(`whisper.cpp ${label} 빌드를 찾지 못했습니다`)
  const tmp = await fsp.mkdtemp(join(tmpdir(), 'env-engine-'))
  try {
    const file = join(tmp, name)
    await download(asset.browser_download_url, file, fetchFn, onProgress, signal)
    const dest = join(enginesDir, `whisper-${build}`)
    await fsp.rm(dest, { recursive: true, force: true })
    await fsp.mkdir(dest, { recursive: true })
    if (name.endsWith('.zip')) new AdmZip(file).extractAllTo(dest, true)
    else await new Promise<void>((ok, bad) => execFile('tar', ['-xzf', file, '-C', dest], (e) => (e ? bad(e) : ok())))
    const bin = whisperBinary(enginesDir, build)
    if (!bin) throw new Error('받은 파일에 whisper-cli가 없습니다')
    if (process.platform !== 'win32') await fsp.chmod(bin, 0o755)
    return rel.tag_name
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true })
  }
}

// 엔진 받기: the CPU build (always works — the fallback) and the Vulkan build
// (GPU). A failed Vulkan download doesn't undo the CPU one; it's in the message.
export async function installEngines(enginesDir: string, fetchFn: Fetch, onProgress: (done: number, total: number, label: string) => void, signal?: AbortSignal): Promise<string> {
  await installBuild(enginesDir, 'cpu', fetchFn, (d, t) => onProgress(d, t, 'whisper.cpp CPU 엔진 받기'), signal)
  try {
    await installBuild(enginesDir, 'vulkan', fetchFn, (d, t) => onProgress(d, t, 'whisper.cpp Vulkan 엔진 받기'), signal)
    return 'whisper.cpp 엔진(Vulkan · CPU)을 받았습니다'
  } catch (e) {
    if (signal?.aborted) throw e
    return `CPU 엔진을 받았습니다. Vulkan 엔진은 받지 못했습니다: ${(e as Error).message}`
  }
}
