// 작품 정보 from DLsite by work code (RJ / VJ / BJ …): title, circle, voice
// actors. Only the code is sent. Used when a folder is named by its code
// alone, or on request.
export interface DlsiteInfo {
  code: string
  title: string
  circle: string | null
  voices: string[]
  image: string | null // cover (https URL)
}

export type JsonFetch = (url: string, signal?: AbortSignal) => Promise<unknown>

export type BytesFetch = (url: string, signal?: AbortSignal) => Promise<Buffer>

const HEADERS = { 'User-Agent': 'Mozilla/5.0 Env', Cookie: 'adultchecked=1; locale=ja-jp' }

export const fetchBytes: BytesFetch = async (url, signal) => {
  const r = await fetch(url, { signal, headers: HEADERS })
  if (!r.ok) throw new Error(`DLsite ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

export const fetchJson: JsonFetch = async (url, signal) => {
  const r = await fetch(url, { signal, headers: HEADERS })
  if (!r.ok) throw new Error(`DLsite ${r.status}`)
  return r.json()
}

interface ProductJson {
  work_name?: string
  maker_name?: string
  creaters?: { voice_by?: { name: string }[] }
  image_main?: { url?: string }
}

// null = DLsite doesn't know the code (removed, or not a DLsite work).
export async function fetchDlsite(code: string, get: JsonFetch = fetchJson, signal?: AbortSignal): Promise<DlsiteInfo | null> {
  const id = code.toUpperCase()
  if (!/^[RVB]J\d{6,8}$/.test(id)) return null
  const data = (await get(`https://www.dlsite.com/maniax/api/=/product.json?workno=${id}`, signal)) as ProductJson[] | unknown
  const p = Array.isArray(data) ? (data[0] as ProductJson | undefined) : undefined
  if (!p?.work_name) return null
  return {
    code: id,
    title: p.work_name.trim(),
    circle: p.maker_name?.trim() || null,
    voices: [...new Set((p.creaters?.voice_by ?? []).map((v) => v.name.trim()).filter(Boolean))],
    image: p.image_main?.url ? (p.image_main.url.startsWith('//') ? `https:${p.image_main.url}` : p.image_main.url) : null
  }
}
