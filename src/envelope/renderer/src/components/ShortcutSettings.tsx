// 설정 › 단축키: every shortcut with its keys; add a key by pressing it, remove
// one, or go back to the defaults (Halftone's 단축키 section).
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import { SHORTCUTS, comboFromEvent, prettyCombo, shortcutCombos } from '../../../shared/shortcuts'
import type { ShortcutId } from '../../../shared/shortcuts'
import { AddIcon, CloseSmallIcon, RefreshIcon } from './icons'

export default function ShortcutSettings(): JSX.Element {
  const s = useStore((x) => x.settings)
  const save = useStore((x) => x.saveSettings)
  const [capture, setCapture] = useState<ShortcutId | null>(null)
  const overrides = s?.shortcuts ?? {}

  const set = (id: ShortcutId, combos: string[]): void => {
    const def = SHORTCUTS.find((d) => d.id === id)!.defaults
    const next = { ...overrides }
    if (JSON.stringify(combos) === JSON.stringify(def)) delete next[id]
    else next[id] = combos
    void save({ shortcuts: next })
  }

  // Next key press becomes a combo of `capture` (Escape cancels). Taken from
  // whichever shortcut had it before, so no two share a key.
  useEffect(() => {
    if (!capture) return
    const h = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setCapture(null)
      const c = comboFromEvent(e)
      if (!c) return
      const next = { ...overrides }
      for (const d of SHORTCUTS) {
        const cur = shortcutCombos(next, d.id)
        if (d.id !== capture && cur.includes(c)) next[d.id] = cur.filter((x) => x !== c)
      }
      const mine = shortcutCombos(next, capture)
      if (!mine.includes(c)) next[capture] = [...mine, c]
      void save({ shortcuts: next })
      setCapture(null)
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [capture, overrides, save])

  const groups = [...new Set(SHORTCUTS.map((d) => d.group))]
  return (
    <div className="keys-table">
      {groups.map((g) => (
        <div key={g} className="keys-group">
          <h4>{g}</h4>
          {SHORTCUTS.filter((d) => d.group === g).map((d) => {
            const combos = shortcutCombos(overrides, d.id)
            return (
              <div key={d.id} className="key-row">
                <span className="key-label">{d.label}</span>
                <span className="key-combos">
                  {combos.map((c) => (
                    <span key={c} className="kbd">
                      {prettyCombo(c)}
                      <button title="이 키 빼기" onClick={() => set(d.id, combos.filter((x) => x !== c))}>
                        <CloseSmallIcon />
                      </button>
                    </span>
                  ))}
                  {!combos.length && <span className="hint">지정 안 함</span>}
                </span>
                <div className="flat-group">
                  <button className={`mini ${capture === d.id ? 'on' : ''}`} onClick={() => setCapture(capture === d.id ? null : d.id)}>
                    {capture === d.id ? (
                      '키를 누르세요…'
                    ) : (
                      <>
                        <AddIcon /> 키 추가
                      </>
                    )}
                  </button>
                  <button className="mini icon" title="기본값으로" disabled={!(d.id in overrides)} onClick={() => set(d.id, d.defaults)}>
                    <RefreshIcon />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ))}
      <p className="hint keys-note">마우스 뒤로 · 앞으로 버튼은 화면 이동(뒤로 / 앞으로)에 쓰입니다. 키보드 미디어 키(재생 · 다음 · 이전)도 동작합니다.</p>
    </div>
  )
}
