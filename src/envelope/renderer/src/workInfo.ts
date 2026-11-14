import type React from 'react'
// Short facts about a work shown in several places: what it has to read
// along (언어 분류), and a track named by its place ("트랙 3" / "부록 1").
import type { WorkContent, WorkDetail } from '../../shared/types'

// Language names (ISO 639-1); an unknown code shows as itself
const LANG_NAME: Record<string, string> = {
  ja: '일본어', ko: '한국어', en: '영어', zh: '중국어', es: '스페인어', fr: '프랑스어', de: '독일어',
  ru: '러시아어', th: '태국어', vi: '베트남어', id: '인도네시아어', pt: '포르투갈어', it: '이탈리아어'
}
const LANG_ORDER = Object.keys(LANG_NAME)
export const langName = (l: string): string => LANG_NAME[l] ?? l.toUpperCase()
const byLang = (a: string, b: string): number =>
  (LANG_ORDER.indexOf(a) + 1 || 99) - (LANG_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b)

// 언어 분류 keys: nothing to read along ('none'), or a script / subtitles by
// language ('script:ja', 'sub:en' …) — the list grows with what the library holds
export type ContentKey = string
export function contentKeys(c: WorkContent): ContentKey[] {
  const out = [...c.scripts.map((l) => `script:${l}`), ...Object.keys(c.subs).filter((l) => c.subs[l]).map((l) => `sub:${l}`)]
  return out.length ? out : ['none']
}
export function contentKeyLabel(k: ContentKey): string {
  if (k === 'none') return '자막 · 대본 없는 작품'
  const [kind, l] = k.split(':')
  return `${langName(l)} ${kind === 'script' ? '대본' : '자막'}`
}
// every 언어 분류 option some work has: [음성 languages, 자막 · 대본 keys]
export function langOptions(works: { content: WorkContent }[]): { voices: string[]; content: ContentKey[] } {
  const voices = new Set<string>(['ja'])
  const keys = new Set<string>()
  for (const w of works) {
    voices.add(w.content.voice)
    for (const k of contentKeys(w.content)) keys.add(k)
  }
  const rank = (k: string): number => (k === 'none' ? 0 : k.startsWith('script:') ? 1 : 2)
  return {
    voices: [...voices].sort(byLang),
    content: [...keys].sort((a, b) => rank(a) - rank(b) || byLang(a.split(':')[1] ?? '', b.split(':')[1] ?? ''))
  }
}

// "한국어 음성 · 일본어 대본 · 한국어 자막 [자체 생성]"; nothing for a
// Japanese work of audio only
export function contentLabels(c: WorkContent): string[] {
  const out: string[] = []
  if (c.voice !== 'ja') out.push(`${langName(c.voice)} 음성`)
  for (const l of [...c.scripts].sort(byLang)) out.push(`${langName(l)} 대본`)
  for (const l of Object.keys(c.subs).sort(byLang)) {
    if (!c.subs[l]) continue
    const name = `${langName(l)} 자막`
    out.push(c.subs[l] === 'app' ? `${name} [자체 생성]` : name)
  }
  return out
}

const ROLE_LABEL = { main: '트랙', extra: '부록', sample: '샘플' } as const

// "트랙 3" / "부록 1" / "샘플 1": the place among the work's tracks of that kind
export function trackLabel(work: WorkDetail, groupKey: string): string {
  const g = work.groups.find((x) => x.key === groupKey)
  if (!g) return ''
  const same = work.groups.filter((x) => x.role === g.role)
  return `${ROLE_LABEL[g.role] ?? '트랙'} ${same.indexOf(g) + 1}`
}

// The cover's colour softened to a pastel: its hue kept, saturation at most
// PASTEL_S, lightness within PASTEL_L (the raw dominant colour was neon or a
// primary colour).
const PASTEL_S = 0.45
const PASTEL_L: [number, number] = [0.72, 0.84]
function pastel(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l0 = (max + min) / 2
  const d = max - min
  const s0 = d === 0 ? 0 : d / (1 - Math.abs(2 * l0 - 1))
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  const s = Math.min(s0, PASTEL_S)
  const l = Math.min(PASTEL_L[1], Math.max(PASTEL_L[0], l0))
  // HSL → RGB
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h % 2) - 1))
  const [r1, g1, b1] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x]
  const m = l - c / 2
  return '#' + [r1, g1, b1].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')
}

// 전체 자막 panel in the cover's main colour (as a pastel); the text dark on a bright one
export function lyricsTheme(raw: string | null): React.CSSProperties | undefined {
  if (!raw) return undefined
  const hex = pastel(raw)
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const light = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.35
  return {
    background: hex,
    '--text': light ? '#111318' : '#ffffff',
    '--text-hover': light ? '#000000' : '#ffffff',
    '--text-dim': light ? 'rgba(0, 0, 0, 0.66)' : 'rgba(255, 255, 255, 0.72)',
    '--muted': light ? 'rgba(0, 0, 0, 0.48)' : 'rgba(255, 255, 255, 0.52)',
    '--line': light ? 'rgba(0, 0, 0, 0.16)' : 'rgba(255, 255, 255, 0.18)',
    '--accent-hover': light ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.14)',
    '--accent-soft': light ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.1)'
  } as React.CSSProperties
}
