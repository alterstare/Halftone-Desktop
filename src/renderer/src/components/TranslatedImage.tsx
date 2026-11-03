import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { TransResult, TransDoc } from '../../../shared/ipc'
import { getTranslation, getTransDoc, getTransPaint, saveTransDoc } from '../translate'
import { loadImage, drawTranslation, healPage, renderDoc } from '../inpaint'
import TransEditor from './TransEditor'
import { useStore } from '../store'

// An image that, when `translate` is on, is replaced by an in-place translated
// version: the original speech-bubble text is erased and the Korean translation
// is typeset in the same spot (rendered locally on a canvas). Translation is
// cached per src so OCR quota isn't re-spent.
export default function TranslatedImage({
  src,
  style,
  translate,
  langHint,
  onClick,
  className
}: {
  src: string
  style?: React.CSSProperties
  translate: boolean
  langHint?: string
  onClick?: (e: React.MouseEvent) => void
  className?: string
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [res, setRes] = useState<TransResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [rendered, setRendered] = useState(false)
  const [editing, setEditing] = useState(false)
  // Bumped when translation settings change → translate this page again.
  const transNonce = useStore((s) => s.transNonce)
  // Bumped after the editor saves (redraw from its document) or resets (translate again).
  const [docVer, setDocVer] = useState(0)
  const [again, setAgain] = useState(0)

  // 1) Fetch OCR + translation (boxes + Korean text).
  useEffect(() => {
    if (!translate) {
      setRes(null)
      setRendered(false)
      return
    }
    let alive = true
    setLoading(true)
    setRendered(false)
    getTranslation(src, langHint)
      .then((r) => alive && setRes(r))
      .catch((e) => {
        console.error('translateImage failed', e)
        if (alive) setRes({ ok: false, w: 0, h: 0, blocks: [], error: String(e?.message ?? e) })
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [src, translate, langHint, transNonce, again])

  // 2) Once we have boxes + the image, draw the in-place translated page.
  useEffect(() => {
    if (!translate || !res || !res.ok || res.blocks.length === 0) {
      setRendered(false)
      return
    }
    let alive = true
    Promise.all([loadImage(src), getTransPaint(src), getTransDoc(src)])
      .then(([img, paint, doc]) => {
        const c = canvasRef.current
        if (!alive || !c) return
        // Edited in the layered editor: its document, as saved.
        if (doc) {
          renderDoc(c, img, doc.doc, doc.images)
          setRendered(true)
          return
        }
        drawTranslation(c, img, res, { paint })
        if (alive) setRendered(true)
        // With the inpainting model: the same page again, its art erases painted by it.
        return healPage(img, res).then((heal) => {
          if (alive && heal && canvasRef.current) drawTranslation(canvasRef.current, img, res, { heal, paint })
        })
      })
      .catch((e) => {
        console.error('inpaint draw failed', e)
        if (alive) setRendered(false)
      })
    return () => {
      alive = false
    }
  }, [src, translate, res, docVer])

  const showCanvas = translate && rendered && !!res?.ok && res.blocks.length > 0

  // Save edited blocks → persist override, refresh local res so the canvas redraws.
  const onSaveEdit = async (doc: TransDoc | null, images: Record<string, string | null>): Promise<void> => {
    await saveTransDoc(src, doc, images)
    setEditing(false)
    if (doc) {
      setRes((r) => (r && r.ok ? { ...r, blocks: doc.blocks } : r))
      setDocVer((v) => v + 1)
    } else setAgain((v) => v + 1)
  }

  return (
    <span className={className ? `timg ${className}` : 'timg'}>
      <img src={src} style={style} onClick={onClick} alt="" hidden={showCanvas} decoding="async" />
      {/* Always mounted so the draw effect's ref is available; hidden until drawn. */}
      <canvas
        ref={canvasRef}
        className="tcanvas"
        style={showCanvas ? style : { display: 'none' }}
        onClick={onClick}
      />
      {translate && res?.ok && !loading && (
        <button
          className="timg-edit"
          onClick={(e) => {
            e.stopPropagation()
            setEditing(true)
          }}
        >
          ✎ 편집
        </button>
      )}
      {editing && res?.ok && (
        <TransEditor
          src={src}
          blocks={res.blocks}
          mask={res.mask}
          langHint={langHint}
          onSave={onSaveEdit}
          onClose={() => setEditing(false)}
        />
      )}
      {translate && !showCanvas && (
        <div className="tlayer">
          {loading && <div className="tlayer-msg">번역 중…</div>}
          {res && !res.ok && <div className="tlayer-msg err">{res.error}</div>}
          {res && res.ok && res.blocks.length === 0 && res.panelText && (
            <div className="tpanel">{res.panelText}</div>
          )}
          {res && res.ok && res.blocks.length === 0 && !res.panelText && !loading && (
            <div className="tlayer-msg">인식된 글자가 없습니다</div>
          )}
        </div>
      )}
    </span>
  )
}
