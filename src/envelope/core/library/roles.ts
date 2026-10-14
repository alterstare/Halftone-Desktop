// What a folder (or file) name says about the audio under it (CLAUDE.md §5.1,
// token lists from docs/sample-library.md). All matching is done on the
// repaired name, NFKC + lower case.

// Before "on": "SE無" must not read as "SE有".
const SEP = String.raw`[\s_\-・･()\[\]【】「」（）]*`
const SE_OFF = [
  /(?<![a-z])no[\s_-]*se(?![a-z])/g,
  /(?<![a-z])se[\s_-]*no(?![a-z])/g,
  /voice[\s_-]*only/g,
  new RegExp(`(?<![a-z])(?:se|sfx)${SEP}(?:효과음${SEP})?(?:なし|無し|無|없음|제거|抜き|off)`, 'g'),
  new RegExp(`(?:効果音|효과음)${SEP}(?:なし|無し|無|없음|제거)`, 'g')
]
const SE_ON = [
  new RegExp(`(?<![a-z])(?:se|sfx)${SEP}(?:효과음${SEP})?(?:あり|有り|有|있음|포함|入り|on)(?![a-z])`, 'g'),
  new RegExp(`(?:効果音|효과음)${SEP}(?:あり|有り|있음|포함)`, 'g'),
  /voice[\s_-]*se(?![a-z])/g
]
// For stripping SE markers out of names (normalize.ts).
export const SE_PATTERNS: RegExp[] = [...SE_OFF, ...SE_ON]

const FORMAT = /(?<![a-z0-9])(mp3|wav|flac|m4a|aac|ogg|opus)(?![a-z0-9])/
const EXTRA = /おまけ|omake|特典|(?:^|[^가-힣])덤(?:[^가-힣]|$)|부록|bonus|フリートーク|프리토크|free\s*talk|イラスト|일러스트|illust|표지|ジャケット|jacket|画像|cg集|グッズ|アーカイブ|archive|配信|otobanana|^ex$|^img$|^images?$|差分/
const SAMPLE = /sample|サンプル|샘플|試聴/
const SCRIPT = /^script$|台本|대본|シナリオ|scenario/
const CODE = /^[rvb]j\d{6,8}$/
const WRAPPER = /^(?:本編|本篇|本登録|master|作品本編データ|dlsite|본편|音声|音声ファイル|음성파일|data|main|編)$/
const AUDIO_WORDS = /音声ファイル|음성\s*파일|音声|version|ver\./gi

const lower = (s: string): string => s.normalize('NFKC').toLowerCase()

export function seOf(name: string): 'on' | 'off' | null {
  const s = lower(name)
  if (SE_OFF.some((re) => new RegExp(re.source).test(s))) return 'off'
  if (SE_ON.some((re) => new RegExp(re.source).test(s)) || s === 'se') return 'on'
  return null
}

export function formatOf(name: string): string | null {
  return lower(name).match(FORMAT)?.[1] ?? null
}

export const isSampleName = (name: string): boolean => SAMPLE.test(lower(name))

export interface FolderRole {
  se: 'on' | 'off' | null
  format: string | null
  extra: boolean // 덤 / 특전 / 이미지 / 대본 — not the main story
  sample: boolean
  label: string // what is left once role words are gone: an edition name, or ''
}

// Leading "01_", "2.", "03_" ordering numbers.
const NUMBERING = /^\d+[\s_.\-)）]*/

// Name minus numbering, SE / format markers (and, for the comparable key,
// "audio file" words), brackets and punctuation.
function strip(name: string, words: boolean): string {
  let s = name.normalize('NFKC').replace(NUMBERING, '')
  for (const re of [...SE_PATTERNS, FORMAT]) s = s.replace(new RegExp(re.source, 'gi'), ' ')
  if (words) s = s.replace(AUDIO_WORDS, ' ')
  return s.replace(/[\s_\-・･()[\]【】「」（）★※.,]+/g, ' ').trim()
}

// Edition label of a folder: what is left once role words are gone. Wrapper
// folders (本編, RJ code, a bare "se" …) have none.
export function labelOf(name: string): string {
  if (CODE.test(name.normalize('NFKC').toLowerCase())) return ''
  const key = strip(name, true).toLowerCase().replace(/\s+/g, '')
  if (!key || key === 'se' || WRAPPER.test(key)) return ''
  return strip(name, false)
}

export function folderRole(name: string): FolderRole {
  const l = lower(name)
  const extra = EXTRA.test(l) || SCRIPT.test(l)
  const sample = SAMPLE.test(l)
  return {
    se: seOf(name),
    format: formatOf(name),
    extra,
    sample,
    label: extra || sample ? '' : labelOf(name)
  }
}

// Comparable form of an edition label.
export const labelKey = (label: string): string => strip(label, true).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
