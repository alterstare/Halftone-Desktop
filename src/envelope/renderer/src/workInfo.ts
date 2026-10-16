import type React from 'react'
// Short facts about a work shown in several places: what it has to read
// along (언어 분류), and a track named by its place ("트랙 3" / "부록 1").
import type { WorkContent, WorkDetail, WorkLang } from '../../shared/types'

// 언어 분류 keys: nothing to read along, or a script / subtitles by language
export type ContentKey = 'none' | 'ja-script' | 'ko-script' | 'ja-sub' | 'ko-sub'
export const CONTENT_KEYS: [ContentKey, string][] = [
  ['none', '자막 · 대본 없는 작품'],
  ['ja-script', '일본어 대본'],
  ['ko-script', '한국어 대본'],
  ['ja-sub', '일본어 자막'],
  ['ko-sub', '한국어 자막']
]

export function contentKeys(c: WorkContent): ContentKey[] {
  const out: ContentKey[] = []
  if (c.scripts.includes('ja')) out.push('ja-script')
  if (c.scripts.includes('ko')) out.push('ko-script')
  if (c.subs.ja) out.push('ja-sub')
  if (c.subs.ko) out.push('ko-sub')
  return out.length ? out : ['none']
}

// "일본어 대본 · 한국어 자막 [자체 생성]"; nothing for a work of audio only
export function contentLabels(c: WorkContent, lang?: WorkLang): string[] {
  const out: string[] = []
  if (lang === 'ko-voice') out.push('한국어 음성')
  if (c.scripts.includes('ja')) out.push('일본어 대본')
  if (c.scripts.includes('ko')) out.push('한국어 대본')
  for (const [l, name] of [
    ['ja', '일본어 자막'],
    ['ko', '한국어 자막']
  ] as const)
    if (c.subs[l]) out.push(c.subs[l] === 'app' ? `${name} [자체 생성]` : name)
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

// 전체 자막 panel in the cover's main colour; the text dark on a bright one
export function lyricsTheme(hex: string | null): React.CSSProperties | undefined {
  if (!hex) return undefined
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
