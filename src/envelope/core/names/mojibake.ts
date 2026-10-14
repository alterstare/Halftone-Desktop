// 뷁어 (CLAUDE.md §5.7): Japanese Shift-JIS file names read as CP949 when a
// zip is extracted on Korean Windows. The bytes survive, so encoding the name
// back to CP949 and reading it as Shift-JIS restores it — except for byte
// pairs CP949 can't represent, which the extractor already replaced with "_".
// Those lost characters are filled from other names when the context matches.
import iconv from 'iconv-lite'

// Share of extension hangul (see isExtHangul) above which a name counts as 뷁어.
export const MOJIBAKE_RATIO = 0.3

const HANGUL = /[가-힣]/
const JAPANESE = /[぀-ヿ㐀-鿿ｦ-ﾟ]/

// Hangul outside KS X 1001 (CP949 extension area: lead 0x81–0xA0, or a trail
// byte below 0xA1). Real Korean text almost never uses these; Shift-JIS kana
// and kanji land there.
export function isExtHangul(ch: string): boolean {
  if (!HANGUL.test(ch)) return false
  const b = iconv.encode(ch, 'cp949')
  return b.length === 2 && (b[0] < 0xa1 || b[1] < 0xa1)
}

export function decodeMojibake(name: string): string {
  return iconv.decode(iconv.encode(name, 'cp949'), 'shift_jis')
}

// strong: clearly 뷁어. weak: too short to tell (e.g. "_뺂") — 뷁어 only when a
// sibling or the parent folder is strong.
export type MojibakeLevel = 'none' | 'weak' | 'strong'

export function mojibakeLevel(name: string): MojibakeLevel {
  const hangul = [...name].filter((c) => HANGUL.test(c))
  if (!hangul.length) return 'none'
  const ext = hangul.filter(isExtHangul).length
  if (!ext) return 'none'
  const fixed = decodeMojibake(name)
  if (fixed.includes('�') || HANGUL.test(fixed) || !JAPANESE.test(fixed)) return 'none'
  if (hangul.length >= 2 && ext / hangul.length >= MOJIBAKE_RATIO) return 'strong'
  return ext === hangul.length ? 'weak' : 'none'
}

export interface RepairedName {
  text: string
  mojibake: boolean
}

// Repair the entries of one folder together: weak names count only next to a
// strong one (or under a 뷁어 parent).
export function repairSiblings(names: string[], parentMojibake = false): RepairedName[] {
  const levels = names.map(mojibakeLevel)
  const context = parentMojibake || levels.includes('strong')
  return names.map((n, i) => {
    const on = levels[i] === 'strong' || (levels[i] === 'weak' && context)
    return { text: on ? decodeMojibake(n) : n, mojibake: on }
  })
}

// Characters whose Shift-JIS trail byte is not a valid CP949 trail byte
// (0x40, 0x5B–0x60, 0x7B–0x80): exactly the ones an extractor turns into "_".
export function isLostChar(ch: string): boolean {
  const b = iconv.encode(ch, 'shift_jis')
  if (b.length !== 2) return false
  const t = b[1]
  return t === 0x40 || (t >= 0x5b && t <= 0x60) || (t >= 0x7b && t <= 0x80)
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Up to 2 characters next to position i (direction -1 / +1), stopping at "_".
function context(chars: string[], i: number, dir: -1 | 1): string {
  const out: string[] = []
  for (let j = i + dir; j >= 0 && j < chars.length && out.length < 2; j += dir) {
    if (chars[j] === '_') break
    out.push(chars[j])
  }
  return (dir < 0 ? out.reverse() : out).join('')
}

// Words that turn up in these folders and contain lost characters. A name
// that matches one with "_" where the lost characters were gets them back.
const DICTIONARY = [
  'ファイル', 'データ', 'プロローグ', 'エピローグ', 'フリートーク', 'ボーナス', 'トーク', 'ボイス', 'バージョン',
  'オーディオ', 'ノーマル', 'ジャケット', 'サンプル', 'キャラクター', 'ストーリー', 'シナリオ', 'イメージ', 'タイトル',
  'メイン', 'コメント', 'ミュージック', 'エンディング', 'オープニング', 'ハイレゾ', 'レビュー',
  '本編', '台本', '表紙', '効果音', '予告', '特典', '差分', '無し', '有り', '音声', '素材', '壁紙'
].filter((w) => [...w].some(isLostChar))

export function fillDictionary(name: string): { text: string; filled: number } {
  let text = name
  let filled = 0
  for (const w of DICTIONARY) {
    const masked = [...w].map((c) => (isLostChar(c) ? '_' : c)).join('')
    if (masked === w || !text.includes(masked)) continue
    // Short masks ("_編") are too common inside other names: only a whole
    // name (extension aside) counts then.
    const known = [...masked].filter((c) => c !== '_').length
    if (known < 2 && text.replace(/\.[^.]+$/, '') !== masked) continue
    const n = text.split(masked).length - 1
    text = text.split(masked).join(w)
    filled += n * [...w].filter(isLostChar).length
  }
  return { text, filled }
}

// Fill "_" gaps from reference names (work title, sibling names): the gap's
// neighbours must match a reference with exactly one character between them,
// and that character must be one that could have been lost.
export function fillGaps(name: string, refs: string[]): { text: string; filled: number } {
  const chars = [...name]
  let filled = 0
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== '_') continue
    const left = context(chars, i, -1)
    const right = context(chars, i, 1)
    if ([...left].length + [...right].length < 2) continue
    const re = new RegExp(`${escapeRe(left)}(.)${escapeRe(right)}`, 'gu')
    const found = new Set<string>()
    for (const r of refs) for (const m of r.matchAll(re)) if (isLostChar(m[1])) found.add(m[1])
    if (found.size === 1) {
      chars[i] = [...found][0]
      filled++
    }
  }
  return { text: chars.join(''), filled }
}

// All the filling a name gets: other names first (exact), then the dictionary.
export function fillName(name: string, refs: string[]): { text: string; filled: number } {
  if (!name.includes('_')) return { text: name, filled: 0 }
  const a = fillGaps(name, refs)
  const b = fillDictionary(a.text)
  return { text: b.text, filled: a.filled + b.filled }
}
