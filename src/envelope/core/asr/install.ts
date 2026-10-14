// 엔진 · 모델 받기: the whisper.cpp CPU build from the official releases, the
// ggml models from Hugging Face — into the data folder, through ".part" files
// so a broken download never looks finished. (The Vulkan build is made with
// scripts/build-whisper-vulkan.ps1 and placed in engines/whisper-vulkan.)
import { createWriteStream, existsSync, promises as fsp } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFile } from 'child_process'
import AdmZip from 'adm-zip'
import type { EngineStatus } from '../../shared/types'
import type { Fetch, WhisperModel } from './engines'
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

const RELEASES = 'https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=15'
const CPU_ASSET = process.platform === 'win32' ? 'whisper-bin-x64.zip' : 'whisper-bin-ubuntu-x64.tar.gz'

// The newest official CPU build → engines/whisper-cpu.
export async function installCpuEngine(enginesDir: string, fetchFn: Fetch, onProgress: Progress, signal?: AbortSignal): Promise<string> {
  const res = await fetchFn(RELEASES, { signal, headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(`릴리즈 목록 HTTP ${res.status}`)
  const releases = (await res.json()) as { tag_name: string; assets: { name: string; browser_download_url: string }[] }[]
  const rel = releases.find((r) => r.assets.some((a) => a.name === CPU_ASSET))
  const asset = rel?.assets.find((a) => a.name === CPU_ASSET)
  if (!rel || !asset) throw new Error('whisper.cpp CPU 빌드를 찾지 못했습니다')
  const tmp = await fsp.mkdtemp(join(tmpdir(), 'env-engine-'))
  try {
    const file = join(tmp, CPU_ASSET)
    await download(asset.browser_download_url, file, fetchFn, onProgress, signal)
    const dest = join(enginesDir, 'whisper-cpu')
    await fsp.rm(dest, { recursive: true, force: true })
    await fsp.mkdir(dest, { recursive: true })
    if (CPU_ASSET.endsWith('.zip')) new AdmZip(file).extractAllTo(dest, true)
    else await new Promise<void>((ok, bad) => execFile('tar', ['-xzf', file, '-C', dest], (e) => (e ? bad(e) : ok())))
    if (process.platform !== 'win32') {
      const bin = whisperBinary(enginesDir, 'cpu')
      if (bin) await fsp.chmod(bin, 0o755)
    }
    if (!whisperBinary(enginesDir, 'cpu')) throw new Error('받은 파일에 whisper-cli가 없습니다')
    return rel.tag_name
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true })
  }
}
