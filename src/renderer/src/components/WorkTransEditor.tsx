import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import type { Work } from '../../../shared/types'
import type { TransResult } from '../../../shared/ipc'
import { getImages } from '../images'
import { useStore } from '../store'
import { workLanguage } from '../util'
import { editedSrcs, getTranslation, saveTranslationEdit } from '../translate'
import TransEditor from './TransEditor'
import CharacterMemo from './CharacterMemo'
import type { TransEditorApi } from './TransEditor'

// Whole-work translation editor (list card › 번역 › 번역 편집기): a page sidebar on
// the left, the single-page editor on the right. Moving to another page (or
// closing) saves the current page if it was changed, so every page can be
// fixed in one sitting and then exported as images with the edits applied.
// Opening a work here also puts it on the 번역 편집기 list (translation-work
// mode), which remembers the page to resume at.
export default function WorkTransEditor({
  work,
  onClose,
  onExportImages
}: {
  work: Work
  onClose: () => void
  onExportImages: () => void
}): JSX.Element {
  const langHint = workLanguage(work) ?? undefined
  const [srcs, setSrcs] = useState<string[]>([])
  const addTransProjects = useStore((s) => s.addTransProjects)
  const updateTransProject = useStore((s) => s.updateTransProject)
  // Resume where the last session on this work stopped.
  const [idx, setIdx] = useState(
    () => useStore.getState().settings.transProjects?.find((p) => p.workId === work.id)?.lastPage ?? 0
  )
  // Bumped after a save / reset so the page re-resolves (override or fresh).
  const [ver, setVer] = useState(0)
  // Tagged with the page/version it belongs to, so a stale result never shows
  // (or gets edited/saved) under another page.
  const [loaded, setLoaded] = useState<{ key: string; r: TransResult } | null>(null)
  const [edited, setEdited] = useState<Set<string>>(new Set())
  const apiRef = useRef<TransEditorApi | null>(null)
  const [memoOpen, setMemoOpen] = useState(false)
  const hasMemo = useStore((s) => !!s.settings.transMemos?.[work.id])
  const listRef = useRef<HTMLDivElement>(null)
  const src = srcs[idx]
  const pageKey = `${src}#${ver}`
  const res = loaded?.key === pageKey ? loaded.r : null

  useEffect(() => {
    addTransProjects([work.id])
    void getImages(work.id).then((s) => {
      setSrcs(s)
      setIdx((i) => Math.min(Math.max(0, i), Math.max(0, s.length - 1)))
    })
    void editedSrcs().then(setEdited)
  }, [work.id, addTransProjects])
  // Remember the open page (and that the work was just worked on).
  useEffect(() => {
    if (srcs.length) updateTransProject(work.id, { lastPage: idx, updatedAt: Date.now() })
  }, [idx, srcs.length, work.id, updateTransProject])

  // Resolve the current page's translation (saved edit, cache, or a fresh run).
  useEffect(() => {
    if (!src) return
    let alive = true
    const key = `${src}#${ver}`
    getTranslation(src, langHint)
      .then((r) => alive && setLoaded({ key, r }))
      .catch(
        (e) =>
          alive &&
          setLoaded({
            key,
            r: {
              ok: false,
              w: 0,
              h: 0,
              blocks: [],
              error: String(e?.message ?? e)
            }
          })
      )
    return () => {
      alive = false
    }
  }, [src, langHint, ver])

  // Keep the active page thumbnail in view.
  useEffect(() => {
    listRef.current?.querySelector('.ted-page.on')?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  const save = async (blocks: Parameters<typeof saveTranslationEdit>[1]): Promise<void> => {
    if (!src) return
    await saveTranslationEdit(src, blocks)
    updateTransProject(work.id, { updatedAt: Date.now() })
    setEdited((s) => {
      const n = new Set(s)
      if (blocks.length) n.add(src)
      else n.delete(src)
      return n
    })
  }
  // Save the open page only if the user changed something.
  const flush = async (): Promise<void> => {
    const a = apiRef.current
    if (res?.ok && a?.dirty()) await save(a.snapshot())
  }
  const go = async (i: number): Promise<void> => {
    if (i === idx || i < 0 || i >= srcs.length) return
    await flush()
    apiRef.current = null
    setIdx(i)
    setVer((v) => v + 1) // fresh key per visit: never reuse a result loaded before a save
  }
  const close = async (): Promise<void> => {
    await flush()
    onClose()
  }

  return createPortal(
    <div className="ted-overlay" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <div className="ted-work">
        <div className="ted-pages">
          <div className="ted-pages-head">
            페이지 {srcs.length ? idx + 1 : 0} / {srcs.length}
          </div>
          <div className="ted-pages-list" ref={listRef}>
            {srcs.map((s, i) => (
              <button key={s} className={`ted-page ${i === idx ? 'on' : ''}`} onClick={() => void go(i)}>
                <img src={s} loading="lazy" decoding="async" alt="" />
                <span className="ted-page-n">{i + 1}</span>
                {edited.has(s) && <span className="ted-page-ed">편집됨</span>}
              </button>
            ))}
          </div>
        </div>
        {src && res?.ok ? (
          <TransEditor
            key={pageKey}
            embedded
            apiRef={apiRef}
            src={src}
            blocks={res.blocks}
            langHint={langHint}
            closeLabel="닫기"
            saveLabel="중간 저장"
            hint=""
            headExtra={
              <>
                <button
                  className={`mini ${hasMemo ? 'has-memo' : ''}`}
                  onClick={() => setMemoOpen(true)}
                  title="인물 이름·말투 메모 (번역에 반영)"
                >
                  인물 메모
                </button>
                <button
                  className="mini"
                  onClick={async () => {
                    await flush()
                    onClose()
                    onExportImages()
                  }}
                >
                  이미지로 내보내기
                </button>
              </>
            }
            onSave={async (blocks) => {
              await save(blocks)
              setVer((v) => v + 1) // [] = 자동으로 되돌리기 → re-run; else reload the saved edit
            }}
            onClose={() => void close()}
          />
        ) : (
          <div className="ted-pane">
            {!res ? (
              <>
                <span>번역 중…</span>
                <div className="flat-group ted-actions">
                  <button className="mini" onClick={onClose}>
                    닫기
                  </button>
                </div>
              </>
            ) : (
              <>
                <span>{res.error ?? '번역 실패'}</span>
                <div className="flat-group ted-actions">
                  <button className="mini" onClick={() => setVer((v) => v + 1)}>
                    다시 시도
                  </button>
                  <button className="mini" onClick={onClose}>
                    닫기
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {memoOpen && <CharacterMemo work={work} onClose={() => setMemoOpen(false)} />}
    </div>,
    document.body
  )
}
