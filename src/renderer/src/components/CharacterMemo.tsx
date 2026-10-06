import { useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import type { Work } from '../../../shared/types'
import { useStore } from '../store'
import { draftWorkMemo } from '../translate'
import { workLanguage } from '../util'
import { CloseIcon } from './icons'

// 인물 메모: per-work character notes the translator follows (names, who talks
// 반말/존댓말, quirks). "AI 초안" reads the first pages and drafts them; the
// user edits and saves. Saving drops cached translations so pages re-translate
// with the notes (manually edited pages keep their edits).
export default function CharacterMemo({ work, onClose }: { work: Work; onClose: () => void }): JSX.Element {
  const saved = useStore((s) => s.settings.transMemos?.[work.id] ?? '')
  const setTransMemo = useStore((s) => s.setTransMemo)
  const [text, setText] = useState(saved)
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const draft = async (): Promise<void> => {
    setErr(null)
    setProg({ done: 0, total: 1 })
    try {
      const r = await draftWorkMemo(work.id, workLanguage(work) ?? undefined, (done, total) => setProg({ done, total }))
      if (!r.ok) return setErr(r.error ?? 'AI 초안 실패')
      // Keep what the user already wrote; put the draft under it.
      setText((t) => (t.trim() ? `${t.trim()}\n\n— AI 초안 —\n${r.memo}` : r.memo))
    } finally {
      setProg(null)
    }
  }

  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose} onClick={(e) => e.stopPropagation()}>
      <div className="modal memo-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>인물 메모 · {work.title}</h2>
          <button className="modal-x" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <p className="hint">
          번역할 때마다 AI에게 전달됩니다. 인물 이름 표기, 누가 누구에게 반말/존댓말을 쓰는지, 말버릇 등을 적어 두면
          페이지가 바뀌어도 말투가 일정하게 유지됩니다. (LLM 번역에만 적용)
        </p>
        <textarea
          className="memo-text"
          value={text}
          placeholder={
            '예:\n- 사쿠라이 모모카(櫻井桃華): 아가씨 말투, 모두에게 존댓말(～ですわ → ~해요/~랍니다)\n- 트레이너: 모모카에게 반말\n- 「プロデューサー」는 「프로듀서」로'
          }
          onChange={(e) => setText(e.target.value)}
        />
        <div className="memo-foot">
          <div className="flat-group">
            <button className="mini" onClick={draft} disabled={!!prog}>
              {prog ? `AI 초안 작성 중… ${prog.done}/${prog.total}쪽` : 'AI 초안'}
            </button>
          </div>
          <span className={`hint ${err ? 'err' : ''}`}>
            {err ??
              (prog ? '앞 페이지를 인식해 인물과 말투를 정리합니다' : 'AI 초안: 앞 8쪽 대사로 인물·말투 초안 작성')}
          </span>
          <div className="flat-group">
            <button className="mini" onClick={onClose}>
              취소
            </button>
            <button
              className="mini on"
              onClick={() => {
                setTransMemo(work.id, text)
                onClose()
              }}
            >
              저장
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
