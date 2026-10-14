import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { Work } from '../../../shared/types'
import { useStore } from '../store'
import { mergeBlocker, mergeWorks } from '../merge'
import ConfirmModal from './ConfirmModal'
import TrashConfirm from './TrashConfirm'
import { CloseIcon } from './icons'

// Library selection bar (작품 통합 / 삭제). Selecting starts with Ctrl+click on
// a card or 「선택」 in its right-click menu; while it's on, a click picks a card.
// Sticks to the top of the library list. Esc / × ends it.
export default function SelectBar({
  pageKeys,
  resolve
}: {
  pageKeys: string[] // the cards on the current page (전체 선택)
  resolve: (keys: string[]) => Work[] // card keys → their local works (a series = its chapters)
}): JSX.Element | null {
  const sel = useStore((s) => s.homeSel)
  const setSel = useStore((s) => s.setHomeSel)
  const [merge, setMerge] = useState<{ works: Work[]; name: string } | null>(null)
  const [trash, setTrash] = useState<Work[] | null>(null)

  useEffect(() => {
    if (!sel) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || merge || trash) return
      e.preventDefault()
      setSel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel, merge, trash, setSel])

  if (!sel) return null
  const allPicked = pageKeys.length > 0 && pageKeys.every((k) => sel.includes(k))

  const startMerge = (): void => {
    const works = resolve(sel)
    const why = mergeBlocker(works)
    if (why) return alert(why)
    setMerge({ works, name: works[0].title })
  }
  const doMerge = (): void => {
    if (!merge) return
    const m = merge
    setMerge(null)
    // The merge runs as a job (작업 바); back to the plain list at once.
    if (mergeWorks(m.works, m.name)) setSel(null)
  }

  return (
    <>
      <div className="sel-bar">
        <span className="sel-count">{sel.length}개 선택</span>
        <div className="flat-group">
          <button className="mini" onClick={() => setSel(allPicked ? null : [...new Set([...sel, ...pageKeys])])}>
            {allPicked ? '전체 해제' : '전체 선택'}
          </button>
          <button className="mini" disabled={sel.length < 2} onClick={startMerge} title="선택한 작품을 라이브러리에서 하나로 보이게 합니다 (폴더는 그대로)">
            통합
          </button>
          <button className="mini danger" onClick={() => setTrash(resolve(sel))}>
            삭제
          </button>
        </div>
        <span className="spacer" />
        <span className="sel-hint">Ctrl+클릭 · Esc 끝내기</span>
        <button className="mini icon" title="선택 끝내기 (Esc)" onClick={() => setSel(null)}>
          <CloseIcon />
        </button>
      </div>

      {merge && (
        <ConfirmModal
          title={`${merge.works.length}개 작품을 하나로 통합할까요?`}
          desc={
            <>
              라이브러리에서 한 작품으로 보이고, 페이지는 차례대로 이어집니다. 폴더는 옮기지 않으며, 통합된
              작품의 우클릭 메뉴에서 「통합 해제」로 되돌릴 수 있습니다.
              <input
                className="search merge-name"
                autoFocus
                value={merge.name}
                placeholder="통합한 작품 이름"
                onChange={(e) => setMerge({ ...merge, name: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && doMerge()}
              />
            </>
          }
          confirmLabel="통합"
          cancelLabel="취소"
          onConfirm={doMerge}
          onCancel={() => setMerge(null)}
        />
      )}
      {trash && (
        <TrashConfirm
          works={trash}
          title={trash.length === 1 ? trash[0].title : `선택한 작품 ${trash.length}개`}
          onClose={() => setTrash(null)}
          onDone={() => setSel(null)}
        />
      )}
    </>
  )
}
