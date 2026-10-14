import type { JSX } from 'react'
import type { Work } from '../../../shared/types'
import { useStore } from '../store'
import { invalidate } from '../images'
import ConfirmModal from './ConfirmModal'

// "삭제" confirm shared by the cards, the reader's left list and their context
// menus: moves each work's folder to the recycle bin (main also takes a series
// folder left empty) and drops the work from the library.
export default function TrashConfirm({
  works,
  title,
  onClose,
  onDone
}: {
  works: Work[]
  title: string // what's being deleted, shown in bold
  onClose: () => void // the dialog closes (삭제 or 취소)
  onDone?: () => void // after the deletions ran
}): JSX.Element {
  // NAS shares have no recycle bin: Windows deletes from them for good.
  const onNas = works.some((w) => w.path.startsWith('\\\\'))
  const run = async (): Promise<void> => {
    onClose()
    const failed: string[] = []
    for (const w of works) {
      try {
        await window.api.deleteWork(w.id)
        invalidate(w.id)
        useStore.getState().removeWork(w.id)
      } catch {
        failed.push(w.title)
      }
    }
    // A merged work's manual-collection entry was dropped in main → reload it.
    if (works.some((w) => w.sources?.length)) useStore.getState().setSettings(await window.api.getSettings())
    onDone?.()
    if (failed.length) alert(`휴지통으로 옮기지 못했습니다.\n\n${failed.join('\n')}`)
  }
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <ConfirmModal
        danger
        title={works.length > 1 ? `${works.length}개를 삭제할까요?` : '삭제할까요?'}
        desc={
          <>
            <b>{title}</b> 폴더를 휴지통으로 옮기고 목록에서 지웁니다.
            {onNas && <> NAS 폴더는 휴지통이 없어 <b>영구 삭제</b>될 수 있습니다.</>}
          </>
        }
        confirmLabel="삭제"
        cancelLabel="취소"
        onConfirm={run}
        onCancel={onClose}
      />
    </div>
  )
}
