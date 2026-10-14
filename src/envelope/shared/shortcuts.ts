// Keyboard shortcuts: the full list (shown + editable in 설정 › 단축키) and the
// helpers that turn a key event into a combo string — same scheme as Halftone.
//
// A combo is "Ctrl+Shift+T"-style: modifiers in the fixed order Ctrl, Alt,
// Shift, then one key. Letter/digit keys use the physical key (KeyboardEvent
// .code), so shortcuts keep working with the Korean IME on.

export type ShortcutId =
  | 'focusSearch'
  | 'goLibrary'
  | 'goNow'
  | 'goTools'
  | 'goSettings'
  | 'navBack'
  | 'navForward'
  | 'rescan'
  | 'closeTab'
  | 'reopenTab'
  | 'nextTab'
  | 'prevTab'
  | 'tab1'
  | 'tab2'
  | 'tab3'
  | 'tab4'
  | 'tab5'
  | 'tab6'
  | 'tabLast'
  | 'playPause'
  | 'seekBack'
  | 'seekForward'
  | 'prevTrack'
  | 'nextTrack'
  | 'volumeUp'
  | 'volumeDown'
  | 'mute'
  | 'shuffle'
  | 'repeat'
  | 'slower'
  | 'faster'
  | 'subMode'
  | 'subOffsetDown'
  | 'subOffsetUp'
  | 'fullscreen'
  | 'favorite'
  | 'bookmark'

export interface ShortcutDef {
  id: ShortcutId
  label: string
  group: string
  defaults: string[]
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'focusSearch', group: '일반', label: '검색창으로 이동', defaults: ['Ctrl+K', 'Alt+D'] },
  { id: 'goLibrary', group: '일반', label: '라이브러리 열기', defaults: ['Ctrl+1'] },
  { id: 'goNow', group: '일반', label: '지금 재생 열기', defaults: ['Ctrl+2'] },
  { id: 'goTools', group: '일반', label: '파일 정리 열기', defaults: ['Ctrl+E'] },
  { id: 'goSettings', group: '일반', label: '설정 열기', defaults: ['Ctrl+,'] },
  { id: 'navBack', group: '일반', label: '뒤로 (마우스 뒤로 버튼)', defaults: ['Alt+ArrowLeft'] },
  { id: 'navForward', group: '일반', label: '앞으로 (마우스 앞으로 버튼)', defaults: ['Alt+ArrowRight'] },
  { id: 'rescan', group: '일반', label: '라이브러리 다시 스캔', defaults: ['F5'] },
  { id: 'closeTab', group: '탭 (LP)', label: '현재 탭 닫기', defaults: ['Ctrl+W'] },
  { id: 'reopenTab', group: '탭 (LP)', label: '닫은 탭 다시 열기', defaults: ['Ctrl+Shift+T'] },
  { id: 'nextTab', group: '탭 (LP)', label: '다음 탭', defaults: ['Ctrl+Tab'] },
  { id: 'prevTab', group: '탭 (LP)', label: '이전 탭', defaults: ['Ctrl+Shift+Tab'] },
  { id: 'tab1', group: '탭 (LP)', label: '첫 번째 탭', defaults: ['Ctrl+3'] },
  { id: 'tab2', group: '탭 (LP)', label: '두 번째 탭', defaults: ['Ctrl+4'] },
  { id: 'tab3', group: '탭 (LP)', label: '세 번째 탭', defaults: ['Ctrl+5'] },
  { id: 'tab4', group: '탭 (LP)', label: '네 번째 탭', defaults: ['Ctrl+6'] },
  { id: 'tab5', group: '탭 (LP)', label: '다섯 번째 탭', defaults: ['Ctrl+7'] },
  { id: 'tab6', group: '탭 (LP)', label: '여섯 번째 탭', defaults: ['Ctrl+8'] },
  { id: 'tabLast', group: '탭 (LP)', label: '마지막 탭', defaults: ['Ctrl+9'] },
  { id: 'playPause', group: '재생', label: '재생 / 일시정지', defaults: ['Space', 'K'] },
  { id: 'seekBack', group: '재생', label: '뒤로 건너뛰기', defaults: ['ArrowLeft', 'J'] },
  { id: 'seekForward', group: '재생', label: '앞으로 건너뛰기', defaults: ['ArrowRight', 'L'] },
  { id: 'prevTrack', group: '재생', label: '이전 트랙', defaults: ['Shift+ArrowLeft', 'PageUp'] },
  { id: 'nextTrack', group: '재생', label: '다음 트랙', defaults: ['Shift+ArrowRight', 'PageDown'] },
  { id: 'volumeUp', group: '재생', label: '음량 크게', defaults: ['ArrowUp'] },
  { id: 'volumeDown', group: '재생', label: '음량 작게', defaults: ['ArrowDown'] },
  { id: 'mute', group: '재생', label: '음소거', defaults: ['M'] },
  { id: 'shuffle', group: '재생', label: '무작위 재생', defaults: ['S'] },
  { id: 'repeat', group: '재생', label: '반복 바꾸기', defaults: ['R'] },
  { id: 'slower', group: '재생', label: '느리게', defaults: ['['] },
  { id: 'faster', group: '재생', label: '빠르게', defaults: [']'] },
  { id: 'favorite', group: '재생', label: '재생 중인 작품 즐겨찾기', defaults: ['Shift+F'] },
  { id: 'bookmark', group: '재생', label: '지금 위치 북마크 / 북마크 삭제', defaults: ['B'] },
  { id: 'subMode', group: '자막', label: '자막 켜기 / 끄기', defaults: ['C'] },
  { id: 'subOffsetDown', group: '자막', label: '자막 0.1초 빠르게', defaults: ['Shift+['] },
  { id: 'subOffsetUp', group: '자막', label: '자막 0.1초 느리게', defaults: ['Shift+]'] },
  { id: 'fullscreen', group: '자막', label: '지금 재생 전체 화면', defaults: ['F'] }
]

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock', 'HangulMode', 'Process'])
// Punctuation by physical key, so Shift+[ stays "Shift+[" (not "{").
const CODE_KEYS: Record<string, string> = { BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/', Minus: '-', Equal: '=' }

// Key part of a combo from an event: physical letter/digit/punctuation
// (IME-proof), else the named key ("ArrowLeft", "F5", "Tab" …).
function keyName(e: Pick<KeyboardEvent, 'key' | 'code'>): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null
  const m = /^(?:Key([A-Z])|Digit([0-9])|Numpad([0-9]))$/.exec(e.code)
  if (m) return m[1] ?? m[2] ?? m[3]
  if (CODE_KEYS[e.code]) return CODE_KEYS[e.code]
  if (e.key === ' ') return 'Space'
  return e.key.length === 1 ? e.key.toUpperCase() : e.key
}

// "Ctrl+Shift+T" for a key event (Cmd counts as Ctrl), or null for a lone modifier.
export function comboFromEvent(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string | null {
  const k = keyName(e)
  if (!k) return null
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(k)
  return parts.join('+')
}

// Effective combos of a shortcut: the user's override, else the defaults.
export function shortcutCombos(overrides: Partial<Record<string, string[]>> | undefined, id: ShortcutId): string[] {
  return overrides?.[id] ?? SHORTCUTS.find((s) => s.id === id)?.defaults ?? []
}

const PRETTY: Record<string, string> = { ArrowLeft: '←︎', ArrowRight: '→︎', ArrowUp: '↑︎', ArrowDown: '↓︎' }
export function prettyCombo(c: string): string {
  return c
    .split('+')
    .map((p) => PRETTY[p] ?? p)
    .join(' + ')
}
