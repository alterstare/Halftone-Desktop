import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import type { Work } from '../../../shared/types'
import { useStore } from '../store'
import { allTags, tagToken } from '../util'
import Thumb from './Thumb'
import { ArtistLinks } from './ArtistLinks'
import Stars from './Stars'
import TagList from './TagList'
import EditionsPanel from './EditionsPanel'
import FavGroup from './FavGroup'
import { useWorkCard } from './useWorkCard'
import ConfirmModal from './ConfirmModal'
import WorkTransEditor from './WorkTransEditor'

// List row for a local work on the home library: thumb, title + favorite,
// meta line (pages · code · language · artist), tags, and the action row
// (rating, 메타 채우기, folder, delete, Korean finder, export). Card behavior
// (clicks, favorite, tags, menus) is shared with the grid tile via useWorkCard.
export default function WorkCard({ work }: { work: Work }): JSX.Element {
  const setFilter = useStore((s) => s.setFilter)
  const addSearchToken = useStore((s) => s.addSearchToken)
  const upsertWork = useStore((s) => s.upsertWork)
  const removeWork = useStore((s) => s.removeWork)
  const favoriteTags = useStore((s) => s.settings.favoriteTags)
  const exportWorkJob = useStore((s) => s.exportWorkJob)
  const exportImagesJob = useStore((s) => s.exportImagesJob)
  const goSettings = useStore((s) => s.goSettings)
  const c = useWorkCard(work)
  const [findKo, setFindKo] = useState(false)
  const [copied, setCopied] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  // Menu is portaled to <body> (cards use content-visibility, which clips any
  // overflow) and fixed under the button, clamped to the viewport.
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const exportBtn = useRef<HTMLButtonElement>(null)
  const [editing, setEditing] = useState(false)
  const [noFolder, setNoFolder] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  // Guard: exports need a destination folder. Show a popup up-front if it's unset.
  const ensureFolder = (): boolean => {
    if (useStore.getState().settings.textExportDir) return true
    setNoFolder(true)
    return false
  }
  // Text export (OCR via the current translate engine) → .txt. Image export renders
  // each translated page and saves it. Both run as global jobs (progress in the
  // bottom activity bar, survives navigating away).
  const runExport = (withTr: boolean): void => {
    setExportOpen(false)
    if (ensureFolder()) void exportWorkJob(work.id, withTr)
  }
  const runImageExport = (): void => {
    setExportOpen(false)
    if (ensureFolder()) void exportImagesJob(work.id)
  }

  const toggleMenu = (): void => {
    if (exportOpen) return setExportOpen(false)
    const r = exportBtn.current?.getBoundingClientRect()
    if (r) {
      const W = 190
      const H = 4 * 34 + 10
      const left = Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8))
      const top = r.bottom + 4 + H > window.innerHeight ? Math.max(8, r.top - 4 - H) : r.bottom + 4
      setMenuPos({ top, left })
    }
    setExportOpen(true)
  }
  // Close the menu on any outside click or scroll (it's fixed, so it would drift).
  useEffect(() => {
    if (!exportOpen) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Element
      if (exportBtn.current?.contains(t) || t.closest?.('.export-menu')) return
      setExportOpen(false)
    }
    const onScroll = (): void => setExportOpen(false)
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [exportOpen])

  const copyCode = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!work.code) return
    navigator.clipboard.writeText(work.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }

  const tags = allTags(work)

  return (
    <div className="work-card-wrap">
    <div className="work-card" {...c.cardEvents}>
      <Thumb workId={work.id} />
      <div className="work-info">
        <div className="work-title-row">
          <span className="work-title selectable">{work.title}</span>
          <FavGroup favorite={c.isFav} onToggle={c.toggleFav} work={work} />
        </div>

        <div className="work-meta">
          {work.pageCount}p
          {work.code && (
            <>
              {' · '}
              <span className="code copyable" onClick={copyCode}>
                [{work.code}]{copied ? ' ✓복사됨' : ''}
              </span>
            </>
          )}
          {work.language && ` · ${work.language}`}
          {work.artist && (
            <>
              {' · '}
              <ArtistLinks
                artist={work.artist}
                onPick={(a) => setFilter({ kind: 'artist', value: a })}
                onMenu={(a, e) => c.openTagMenu(e, tagToken(`artist:${a}`), a)}
              />
            </>
          )}
        </div>

        <div className="work-tags">
          <TagList
            tags={tags}
            favoriteTags={favoriteTags}
            manualTags={work.manualTags}
            onTagClick={(t) => addSearchToken(tagToken(t))}
            onTagContext={(t, e) => c.openTagMenu(e, tagToken(t), t)}
            onRemove={c.removeTag}
            onAddClick={c.adding ? undefined : c.startAddTag}
          />
          {c.tagInput}
        </div>

        <div className="work-actions">
          <Stars rank={work.rank} onChange={c.setRank} />
          {work.code && (
            <button
              className="mini"
              onClick={async (e) => {
                e.stopPropagation()
                try {
                  upsertWork(await window.api.doujinEnrich(work.id))
                } catch (err: any) {
                  alert(String(err?.message ?? err))
                }
              }}
            >
              메타 채우기
            </button>
          )}
          <button
            className="mini"
            onClick={(e) => {
              e.stopPropagation()
              window.api.openInExplorer(work.id)
            }}
          >
            폴더 열기
          </button>
          <button
            className="mini danger"
            onClick={(e) => {
              e.stopPropagation()
              setConfirmDel(true)
            }}
          >
            삭제
          </button>
          <button
            className={`mini ko-toggle ${findKo ? 'on' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              setFindKo((v) => !v)
            }}
          >
            다른 언어 <span className={`dt ${findKo ? 'up' : ''}`} />
          </button>
          <div className="export-wrap" onClick={(e) => e.stopPropagation()}>
            <button ref={exportBtn} className={`mini ${exportOpen ? 'on' : ''}`} onClick={toggleMenu}>
              번역 <span className={`dt ${exportOpen ? 'up' : ''}`} />
            </button>
            {exportOpen &&
              createPortal(
                <div
                  className="export-menu export-menu-portal"
                  style={{ top: menuPos.top, left: menuPos.left }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="export-opt"
                    onClick={() => {
                      setExportOpen(false)
                      setEditing(true)
                    }}
                  >
                    번역 편집기
                  </button>
                  <button className="export-opt" onClick={runImageExport}>
                    이미지 내보내기
                  </button>
                  <button className="export-opt" onClick={() => runExport(true)}>
                    텍스트 내보내기
                  </button>
                  <button className="export-opt" onClick={() => runExport(false)}>
                    텍스트 내보내기 (원문만)
                  </button>
                </div>,
                document.body
              )}
          </div>
        </div>
      </div>
    </div>
    {findKo && (
      <EditionsPanel inline code={work.code} artist={work.artist} title={work.title} language={work.language} />
    )}
    {noFolder && (
      <div onClick={(e) => e.stopPropagation()}>
        <ConfirmModal
          title="내보낼 폴더가 없습니다"
          desc="설정에서 내보내기 폴더를 먼저 지정하세요. (텍스트·이미지 내보내기 공통)"
          icon="📁"
          confirmLabel="설정 열기"
          cancelLabel="닫기"
          onConfirm={() => {
            setNoFolder(false)
            goSettings()
          }}
          onCancel={() => setNoFolder(false)}
        />
      </div>
    )}
    {editing && (
      <WorkTransEditor work={work} onClose={() => setEditing(false)} onExportImages={runImageExport} />
    )}
    {confirmDel && (
      <div onClick={(e) => e.stopPropagation()}>
        <ConfirmModal
          danger
          icon="🗑"
          title="작품을 삭제할까요?"
          desc={<><b>{work.title}</b> 폴더를 영구 삭제합니다. 되돌릴 수 없습니다.</>}
          confirmLabel="삭제"
          cancelLabel="취소"
          onConfirm={async () => {
            setConfirmDel(false)
            await window.api.deleteWork(work.id)
            removeWork(work.id)
          }}
          onCancel={() => setConfirmDel(false)}
        />
      </div>
    )}
    {c.workMenu}
    {c.tagMenu}
    </div>
  )
}
