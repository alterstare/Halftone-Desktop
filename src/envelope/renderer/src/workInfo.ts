// Short facts about a work shown in several places: what it has to read
// along (언어 분류), and a track named by its place ("트랙 3" / "부록 1").
import type { WorkContent, WorkDetail, WorkLang } from '../../shared/types'

// 언어 분류 keys: nothing to read along, or a script / subtitles by language
export type ContentKey = 'none' | 'ja-script' | 'ko-script' | 'ja-sub' | 'ko-sub'
export const CONTENT_KEYS: [ContentKey, string][] = [
  ['none', '자막 · 대본 없음'],
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
