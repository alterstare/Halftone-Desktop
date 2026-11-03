import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX, MutableRefObject, ReactNode } from 'react'
import type { TextGradient, TextMask, TextRun, TextStyle, TransBlock, TransDoc, TransLayer, TransRegion } from '../../../shared/ipc'
import { loadImage, drawDocText, fillSelection, healPage, autoPage, canvasSize, packMask, regionMask, rgbToHex } from '../inpaint'
import type { Drawn } from '../inpaint'
import { edgeCost, floodRegion, healStroke, livewire, polygonMask } from '../paintTools'
import type { Pt } from '../paintTools'
import { getTransDoc, getTransPaint, retranslatePage, transModelLabel, translateLines, translateRegion } from '../translate'
import { comboFromEvent, shortcutCombos } from '../../../shared/shortcuts'
import { useStore } from '../store'
import { FIT_ICON, FIT_TEXT } from './reader/fit'
import FontPicker from './FontPicker'
import OutlineButton from './OutlineButton'
import ColorButton from './ColorButton'
import GradientButton from './GradientButton'
import { gradientCss, readGradient } from '../gradient'
import { pageOf } from '../images'
import Stepper from './Stepper'
import {
  AddIcon,
  ArrowDownwardIcon,
  ArrowSelectorIcon,
  ArrowUpwardIcon,
  AutoAwesomeIcon,
  BrushIcon,
  ChatBubbleIcon,
  CloseIcon,
  ColorizeIcon,
  DeleteIcon,
  DeselectIcon,
  EllipseSelectIcon,
  FormatAlignCenterIcon,
  FormatAlignJustifyIcon,
  FormatAlignLeftIcon,
  FormatAlignRightIcon,
  FormatBoldIcon,
  FormatColorFillIcon,
  FormatItalicIcon,
  FormatStrikethroughIcon,
  FormatUnderlinedIcon,
  GradientIcon,
  HealingIcon,
  InkEraserIcon,
  InvertColorsIcon,
  DeleteSweepIcon,
  LassoSelectIcon,
  LayersIcon,
  PolylineIcon,
  RedoIcon,
  RestartIcon,
  SelectIcon,
  TextFieldsIcon,
  TranslateIcon,
  UndoIcon,
  VisibilityIcon,
  VisibilityOffIcon
} from './icons'

// Layered translation editor for one page, in four stages (tabs):
//   1) 인식·번역 — the OCR + translation as a list only (the page as it is), and
//      영역 번역: drag a rectangle over text the auto pass missed → new block,
//   2) 말풍선 — where each translation goes: regions on a bubble layer, drawn
//      with the selection tools (사각형 · 원형 · 다각형 · 자석 올가미) or found
//      by 자동 선택 (the auto pass's balloon parts),
//   3) 인페인팅 — painted layers: 자동 인페인팅 (the auto erase, LaMa when
//      installed) and the tools (채우기 · 브러시 · 복구 브러시 · 지우개), all
//      limited by the mask: the selection, else the bubble regions, or their
//      inverse,
//   4) 번역문 — the text typeset in its regions; boxes move / resize it, and
//      font · size · colour · alignment · bold / italic / underline / strike go
//      to the selected part of a translation, or all of it.
// Layers (bottom-right): the page itself at the bottom, then bubble / painted /
// text layers, the upper ones above. Auto steps write their own layers and
// never touch the user's. The document (TransDoc) is what the viewer draws.
// The page analysis and erase (≈1 s) run only in the auto steps: moving a box or
// recolouring text redraws the text alone.

// Handle the work-wide editor uses to auto-save a page before switching away.
export interface TransEditorApi {
  dirty: () => boolean
  collect: () => { doc: TransDoc; images: Record<string, string | null> } | null
}

type Stage = 1 | 2 | 3 | 4
type Tool = 'move' | 'pick' | 'rect' | 'ellipse' | 'poly' | 'magnet' | 'fill' | 'brush' | 'heal' | 'erase' | 'grad'
const STAGES: [Stage, string, ReactNode][] = [
  [1, '인식·번역', <TranslateIcon key="i" />],
  [2, '말풍선', <ChatBubbleIcon key="i" />],
  [3, '인페인팅', <HealingIcon key="i" />],
  [4, '번역문', <TextFieldsIcon key="i" />]
]
// The tools by group (left bar), the stages each group works in, and their
// keys (as Photoshop's).
const TOOL_GROUPS: { name: string; stages: Stage[]; tools: [Tool, ReactNode, string, string][] }[] = [
  {
    name: '범용',
    stages: [1, 2, 3, 4],
    tools: [
      ['move', <ArrowSelectorIcon key="i" />, '이동', 'V'],
      ['pick', <ColorizeIcon key="i" />, '색상 추출', 'I']
    ]
  },
  {
    name: '범위 선택',
    stages: [2, 3],
    tools: [
      ['rect', <SelectIcon key="i" />, '사각형 선택', 'M'],
      ['ellipse', <EllipseSelectIcon key="i" />, '원형 선택', 'Shift+M'],
      ['poly', <PolylineIcon key="i" />, '다각형 올가미', 'L'],
      ['magnet', <LassoSelectIcon key="i" />, '자석 올가미', 'Shift+L']
    ]
  },
  {
    name: '인페인팅',
    stages: [3],
    tools: [
      ['fill', <FormatColorFillIcon key="i" />, '채우기', 'G'],
      ['brush', <BrushIcon key="i" />, '브러시', 'B'],
      ['heal', <HealingIcon key="i" />, '복구 브러시', 'J'],
      ['erase', <InkEraserIcon key="i" />, '지우개', 'E'],
      ['grad', <GradientIcon key="i" />, '그라데이션 인식', 'Shift+I']
    ]
  }
]
const toolStages = (t: Tool): Stage[] => TOOL_GROUPS.find((g) => g.tools.some(([x]) => x === t))?.stages ?? []
const TOOL_KEYS: Record<string, Tool> = { v: 'move', i: 'pick', 'shift+i': 'grad', m: 'rect', 'shift+m': 'ellipse', l: 'poly', 'shift+l': 'magnet', g: 'fill', b: 'brush', j: 'heal', e: 'erase' }
const STAGE_HINT: Record<Stage, string> = {
  1: '인식·번역 결과를 확인하고 고칩니다 · 이미지는 원본 그대로 · 놓친 글자는 영역 번역',
  2: '범위를 선택한 뒤 Enter로 말풍선 지정 (선택한 대사에 연결) · 말풍선 클릭으로 선택, Delete로 삭제',
  3: '선택 영역(없으면 말풍선)이 마스크 · Ctrl+Shift+I로 안/밖 전환',
  4: '상자를 끌어 위치·크기 조정 · 번역 글을 드래그해 그 부분만, 아니면 말풍선 전체에 서식 적용'
}
const TOOL_HINT: Partial<Record<Tool, string>> = {
  pick: '클릭한 곳의 색을 브러시 색으로 · Shift+클릭은 선택한 대사의 글자색으로',
  rect: '끌어서 사각형 선택 (여러 개 가능) · Delete 마지막 선택 삭제 · Ctrl+D 모두 해제',
  ellipse: '끌어서 원형 선택 (여러 개 가능) · Delete 마지막 선택 삭제 · Ctrl+D 모두 해제',
  poly: '클릭으로 꼭짓점 추가 · 첫 점 클릭·더블클릭·Enter로 닫기 · Esc 취소',
  magnet: '클릭으로 시작, 경계를 따라 움직이며 클릭으로 고정 · 첫 점·더블클릭·Enter로 닫기',
  fill: '클릭한 곳과 비슷한 색의 이어진 범위를 브러시 색으로 · 마스크 안으로 제한',
  brush: '끌어서 칠하기 · [ ]로 크기 · 마스크 안으로 제한',
  heal: 'Alt+클릭으로 복제할 곳 지정 · 그 뒤 칠하면 복제 위치가 브러시를 따라 움직입니다',
  erase: '활성 레이어에서 지우기 (원래 페이지가 드러남)',
  grad: '글자를 끌어서 감싸거나 선택 영역을 클릭하면 그 글자의 그라데이션을 인식해 저장합니다'
}
const BRUSH_SIZES = [3, 5, 10, 20, 30, 50, 75, 100]
const BRUSH_MAX = 100
const FALLBACK_FONTS = ['Malgun Gothic', 'Gulim', 'Dotum', 'Batang', 'Gungsuh', 'NanumGothic', 'NanumMyeongjo', 'NanumBarunGothic', 'Noto Sans KR']

// Fixed layer ids of the auto steps.
const L_TEXT = 'text'
const L_AUTO_INPAINT = 'auto-inpaint'
const L_AUTO_BUBBLES = 'auto-bubbles'
const L_USER_BUBBLES = 'user-bubbles'

// One undo step: the document's lists, plus the painted rect of a layer when the
// step painted (`patch`: that rect before / after).
interface Step {
  blocks: TransBlock[]
  regions: TransRegion[]
  layers: TransLayer[]
  patch?: { layer: string; x: number; y: number; before: ImageData; after: ImageData }
}

type Corner = 'nw' | 'ne' | 'sw' | 'se'
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']

// View size: a fit mode (same as the reader's fit button) times a Ctrl+wheel
// zoom. Kept module-wide so it carries over between pages / editor openings.
type EdFit = 'contain' | 'width' | 'height'
const ED_FITS: EdFit[] = ['contain', 'width', 'height']
let lastView: { fit: EdFit; zoom: number; stage: Stage } = { fit: 'contain', zoom: 1, stage: 4 }
interface Drag {
  i: number
  mode: 'move' | Corner
  sx: number
  sy: number
  orig: { x: number; y: number; w: number; h: number }
  // Moves the block's own box (an old manual block: bg set) or else its room.
  own: boolean
}

// ── Rich text runs ──────────────────────────────────────────────────────────
// Per-character styles of a text of length n (runs expanded), and back.
const STYLE_KEYS: (keyof TextStyle)[] = ['font', 'size', 'color', 'bold', 'italic', 'underline', 'strike', 'outline', 'outlineWidth', 'outlineColor', 'opacity', 'gradient']
function expandRuns(runs: TextRun[] | undefined, n: number): TextStyle[] {
  const out: TextStyle[] = Array.from({ length: n }, () => ({}))
  for (const r of runs ?? []) {
    const { start, end, ...st } = r
    for (let k = Math.max(0, start); k < Math.min(n, end); k++) out[k] = { ...out[k], ...st }
  }
  return out
}
function clean(st: TextStyle): TextStyle {
  const out: TextStyle = {}
  for (const k of STYLE_KEYS) if (st[k] !== undefined) (out as Record<string, unknown>)[k] = st[k]
  return out
}
function compressRuns(chars: TextStyle[]): TextRun[] | undefined {
  const runs: TextRun[] = []
  chars.forEach((c, k) => {
    const st = clean(c)
    if (!Object.keys(st).length) return
    const last = runs[runs.length - 1]
    if (last && last.end === k && JSON.stringify(clean(last)) === JSON.stringify(st)) last.end = k + 1
    else runs.push({ ...st, start: k, end: k + 1 })
  })
  return runs.length ? runs : undefined
}
// Runs after the text changed from `prev` to `next`: the changed middle is cut
// out, typed characters take the style of the one before them.
function shiftRuns(runs: TextRun[] | undefined, prev: string, next: string): TextRun[] | undefined {
  if (!runs?.length || prev === next) return runs
  let p = 0
  while (p < prev.length && p < next.length && prev[p] === next[p]) p++
  let q = 0
  while (q < prev.length - p && q < next.length - p && prev[prev.length - 1 - q] === next[next.length - 1 - q]) q++
  const chars = expandRuns(runs, prev.length)
  const typed = next.length - p - q
  const like = chars[Math.max(0, p - 1)] ?? {}
  return compressRuns([...chars.slice(0, p), ...Array.from({ length: typed }, () => ({ ...like })), ...chars.slice(prev.length - q)])
}

// An ellipse in the box from a to b, as a polygon.
function ellipsePts(a: Pt, b: Pt): Pt[] {
  const cx = (a.x + b.x) / 2
  const cy = (a.y + b.y) / 2
  const rx = Math.abs(b.x - a.x) / 2
  const ry = Math.abs(b.y - a.y) / 2
  return Array.from({ length: 72 }, (_, k) => ({ x: cx + rx * Math.cos((k / 72) * Math.PI * 2), y: cy + ry * Math.sin((k / 72) * Math.PI * 2) }))
}

// Whether p is inside the polygon (even-odd).
function inPolygon(p: Pt, pts: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

// The gradient 그라데이션 인식 read last (kept across pages and sessions).
const GRAD_KEY = 'halftone.transGradient'
function loadGrad(): TextGradient | null {
  try {
    const v = JSON.parse(localStorage.getItem(GRAD_KEY) ?? 'null')
    return v && Array.isArray(v.stops) && typeof v.angle === 'number' ? v : null
  } catch {
    return null
  }
}

// A region's mask turned by `deg` (clockwise) round its rect's centre.
function rotateRegion(r: TransRegion, deg: number, W: number, H: number): TransRegion {
  const m = regionMask(r)
  const a = (deg * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const corners = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w, r.y + r.h]
  ].map(([x, y]) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos])
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))))
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))))
  const x1 = Math.min(W, Math.ceil(Math.max(...corners.map((c) => c[0]))))
  const y1 = Math.min(H, Math.ceil(Math.max(...corners.map((c) => c[1]))))
  const w = Math.max(1, x1 - x0)
  const h = Math.max(1, y1 - y0)
  const inside = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // Back to where this pixel was before the turn.
      const px = x0 + x + 0.5 - cx
      const py = y0 + y + 0.5 - cy
      const sx = Math.floor(px * cos + py * sin + cx - r.x)
      const sy = Math.floor(-px * sin + py * cos + cy - r.y)
      if (sx >= 0 && sy >= 0 && sx < r.w && sy < r.h && m[sy * r.w + sx]) inside[y * w + x] = 1
    }
  return { ...r, x: x0, y: y0, w, h, bits: packMask(inside) }
}
const rotatePts = (pts: Pt[], deg: number): Pt[] => {
  const xs = pts.map((q) => q.x)
  const ys = pts.map((q) => q.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const a = (deg * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  return pts.map((q) => ({ x: cx + (q.x - cx) * cos - (q.y - cy) * sin, y: cy + (q.x - cx) * sin + (q.y - cy) * cos }))
}

// Favourite fonts (pinned at the top of the list, kept across sessions) and the
// recently used ones, per work, for as long as the app runs.
const FAV_KEY = 'halftone.transFontFavs'
function loadFavs(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}
const recentFonts = new Map<string, string[]>()
const RECENT_MAX = 8

let fontList: Promise<string[]> | null = null
// Installed font families (Local Font Access), else a list of common Korean ones.
function installedFonts(): Promise<string[]> {
  if (!fontList)
    fontList = (async () => {
      try {
        const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
        if (q) {
          const fams = [...new Set((await q()).map((f) => f.family))].sort((a, b) => a.localeCompare(b))
          if (fams.length) return fams
        }
      } catch {
        /* not allowed → the fallback list */
      }
      return FALLBACK_FONTS
    })()
  return fontList
}

const newCanvas = (W: number, H: number, cls?: string): HTMLCanvasElement => {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  if (cls) c.className = cls
  return c
}
const isEmpty = (c: HTMLCanvasElement): boolean => {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data
  for (let i = 3; i < d.length; i += 4) if (d[i]) return false
  return true
}

// A page's blocks through the auto pass (as the viewer shows them): the blocks,
// the 자동 말풍선 regions and the 자동 인페인팅 erase.
async function autoDoc(
  img: HTMLImageElement,
  from: TransBlock[],
  mask?: TextMask
): Promise<{ blocks: TransBlock[]; regions: TransRegion[]; erase: ImageData }> {
  const blocks0 = from.map((b, i) => {
    // The old editor's text colour → the style's.
    const { ink, ...rest } = b
    return { ...rest, id: b.id ?? `b${i}`, ...(ink ? { style: { ...b.style, color: ink } } : {}) }
  })
  const res = { ok: true, w: 0, h: 0, blocks: blocks0, mask }
  const heal = await healPage(img, res)
  const auto = autoPage(img, res, heal)
  return { blocks: auto.blocks, regions: auto.regions.map((r) => ({ ...r, layer: L_AUTO_BUBBLES })), erase: auto.erase }
}
// What a document holds before any work: its text, auto inpaint and auto bubble layers.
const autoLayers = (): TransLayer[] => [
  { id: L_TEXT, name: '번역문', kind: 'text', visible: true },
  { id: L_AUTO_INPAINT, name: '자동 인페인팅', kind: 'pixels', visible: true, auto: true },
  { id: L_AUTO_BUBBLES, name: '자동 말풍선', kind: 'bubbles', visible: true, auto: true }
]
// A block as recognised, without the editor's work (for documents saved before
// `orig` was kept: the translation stays as it was last edited).
const unedited = (b: TransBlock): TransBlock => {
  const { style: _s, runs: _r, room: _m, edited: _e, bg: _b, ink: _i, look: _l, ...rest } = b
  return rest
}

export default function TransEditor({
  src,
  blocks: initial,
  mask,
  langHint,
  onSave,
  onClose,
  embedded,
  apiRef,
  headExtra,
  transExtra,
  closeLabel = '취소',
  saveLabel = '저장'
}: {
  src: string
  blocks: TransBlock[]
  // The page's OCR text mask (as the viewer has it): the auto steps use it.
  mask?: TextMask
  langHint?: string
  // embedded: rendered inside the work-wide editor (no own overlay/backdrop).
  embedded?: boolean
  apiRef?: MutableRefObject<TransEditorApi | null>
  headExtra?: ReactNode
  // extra buttons on the 인식·번역 stage's options row (the work's 인물 메모)
  transExtra?: ReactNode
  closeLabel?: string
  saveLabel?: string
  hint?: string
  onSave: (doc: TransDoc | null, images: Record<string, string | null>) => void
  onClose: () => void
}): JSX.Element {
  const overlayRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [size, setSize] = useState<{ W: number; H: number } | null>(null)
  // Building the document: loading, or running the auto pass for a new page.
  const [busyMsg, setBusyMsg] = useState<string | null>('불러오는 중…')
  // The canvases: the page, each painted layer, the text, the bubble overlay —
  // stacked in layer order by an effect (not React: they keep their pixels).
  const pageC = useRef<HTMLCanvasElement | null>(null)
  const textC = useRef<HTMLCanvasElement | null>(null)
  const overC = useRef<HTMLCanvasElement | null>(null)
  const pixRef = useRef<Map<string, HTMLCanvasElement>>(new Map())
  const stackRef = useRef<HTMLDivElement>(null)
  // Painted layers changed since the page was loaded (their PNGs to save); all of
  // them for a document made here.
  const dirtyPix = useRef<Set<string>>(new Set())
  // The OCR text mask the auto steps use (a 전체 다시 번역 brings a new one), and
  // the recognition 초기화 rebuilds from.
  const maskRef = useRef<TextMask | undefined>(mask)
  const origRef = useRef<TransBlock[]>(initial)

  // ── Document state ──
  const [blocks, setBlocks] = useState<TransBlock[]>([])
  const blocksRef = useRef<TransBlock[]>([])
  const [regions, setRegions] = useState<TransRegion[]>([])
  const regionsRef = useRef<TransRegion[]>([])
  const [layers, setLayers] = useState<TransLayer[]>([])
  const layersRef = useRef<TransLayer[]>([])
  const [activeId, setActiveId] = useState<string>(L_TEXT)
  // Stable per-row ids so a row keeps its DOM (and IME/caret) across edits and
  // deletions — index keys would remount textareas and break Korean input.
  const uidsRef = useRef<number[]>([])
  const nextUidRef = useRef(0)
  // Live textarea DOM nodes (by row uid). Typing NEVER calls setState — that would
  // re-render and cancel an IME composition. We read the DOM to redraw the text,
  // and commit to state on blur.
  const taRefs = useRef<Record<number, HTMLTextAreaElement | null>>({})
  // The text each textarea last had (runs follow the edits), and its selection.
  const prevText = useRef<Record<number, string>>({})
  const selRange = useRef<{ uid: number; start: number; end: number } | null>(null)
  // Row uids whose text the user touched → edited (drawn even if it looks like SFX).
  const editedRef = useRef<Set<number>>(new Set())
  const composingRef = useRef(false)
  const pendingFocusRef = useRef<number | null>(null)
  const draggedRef = useRef(false)
  const dragRef = useRef<Drag | null>(null)

  const histRef = useRef<Step[]>([])
  const hiRef = useRef(0)
  const [, setHistVer] = useState(0)
  const bumpHist = (): void => setHistVer((v) => v + 1)

  const [stage, setStageRaw] = useState<Stage>(lastView.stage)
  const [tool, setTool] = useState<Tool>('move')
  const [sel, setSel] = useState<number | null>(null)
  const [selRegion, setSelRegion] = useState<string | null>(null)
  const [maskOut, setMaskOut] = useState(false)
  const [brushColor, setBrushColor] = useState('#ffffff')
  const [brushAlpha, setBrushAlpha] = useState(1)
  // The text colour the 글자색 button puts on (as a document editor's).
  const [pen, setPen] = useState<{ color: string; opacity: number }>({ color: '#141414', opacity: 1 })
  const [savedGrad, setSavedGrad] = useState<TextGradient | null>(loadGrad)
  const [brushSize, setBrushSize] = useState(20)
  const [tol, setTol] = useState(24)
  const [healSrc, setHealSrc] = useState<Pt | null>(null)
  // Aligned healing: the source's offset from the brush, kept across strokes.
  const healOff = useRef<{ dx: number; dy: number } | null>(null)
  const [toolMsg, setToolMsg] = useState<string | null>(null)
  // The selections (polygons), kept until the user removes them: a new one adds
  // to them (the mask is their union).
  const [sels, setSels] = useState<Pt[][]>([])
  const selPts = sels.length ? sels : null
  // The selection clicked (index into sels): it alone is the mask; none = all.
  const [activeSel, setActiveSel] = useState<number | null>(null)
  const [draft, setDraft] = useState<Pt[] | null>(null)
  const [hover, setHover] = useState<Pt | null>(null)
  const [wire, setWire] = useState<Pt[] | null>(null)
  // The brush's size at the cursor while it's being set (screen px).
  const [peek, setPeek] = useState<{ x: number; y: number } | null>(null)
  const costRef = useRef<Float32Array | null>(null)
  const [picking, setPicking] = useState(false)
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [regionErr, setRegionErr] = useState<string | null>(null)
  const [fonts, setFonts] = useState<string[]>(FALLBACK_FONTS)
  const [favFonts, setFavFonts] = useState<string[]>(loadFavs)
  const workKey = pageOf(src)?.workId ?? src.replace(/[^/]*$/, '')
  const [recents, setRecents] = useState<string[]>(() => recentFonts.get(workKey) ?? [])
  // A font previewed by hovering it: the blocks as they were before.
  const fontPreview = useRef<TransBlock[] | null>(null)
  const toolRef = useRef(tool)
  toolRef.current = tool
  const brushTool = (t: Tool): boolean => t === 'brush' || t === 'erase' || t === 'heal'
  const drawnRef = useRef<Drawn>({ inks: [], boxes: [], lead: [] })
  const [, setDrawVer] = useState(0)

  const setStage = (s: Stage): void => {
    setStageRaw(s)
    lastView.stage = s
    if (!toolStages(tool).includes(s)) setTool('move')
    if (s !== 1) setPicking(false)
  }

  // ── View: fit + zoom ──
  const scrollRef = useRef<HTMLDivElement>(null)
  const [avail, setAvail] = useState<{ w: number; h: number } | null>(null)
  const [fit, setFit] = useState<EdFit>(lastView.fit)
  const [zoom, setZoom] = useState(lastView.zoom)
  lastView = { ...lastView, fit, zoom }
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = (): void => setAvail({ w: el.clientWidth - 32, h: el.clientHeight - 32 })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const ready = !!size && !busyMsg
  const dim = useMemo(() => {
    if (!size || !avail) return null
    const sw = Math.max(50, avail.w) / size.W
    const sh = Math.max(50, avail.h) / size.H
    const base = fit === 'width' ? sw : fit === 'height' ? sh : Math.min(sw, sh)
    return { W: size.W, H: size.H, disp: base * zoom }
  }, [size, avail, fit, zoom])
  const atFit = Math.abs(zoom - 1) < 0.001
  const anchorRef = useRef<{ fx: number; fy: number; mx: number; my: number } | null>(null)
  const zoomAt = (z: number, mx?: number, my?: number): void => {
    const el = scrollRef.current
    if (el) {
      const x = mx ?? el.clientWidth / 2
      const y = my ?? el.clientHeight / 2
      anchorRef.current = { fx: (el.scrollLeft + x) / Math.max(1, el.scrollWidth), fy: (el.scrollTop + y) / Math.max(1, el.scrollHeight), mx: x, my: y }
    }
    setZoom(Math.min(6, Math.max(0.2, z)))
  }
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      // Alt+wheel: the brush's size.
      if (e.altKey && brushTool(toolRef.current)) {
        e.preventDefault()
        const up = e.deltaY < 0
        setBrushSize((v) => Math.min(BRUSH_MAX, Math.max(1, up ? Math.max(v + 1, Math.round(v * 1.12)) : Math.min(v - 1, Math.round(v / 1.12)))))
        return
      }
      if (!e.ctrlKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      setZoom((z) => {
        anchorRef.current = {
          fx: (el.scrollLeft + e.clientX - r.left) / Math.max(1, el.scrollWidth),
          fy: (el.scrollTop + e.clientY - r.top) / Math.max(1, el.scrollHeight),
          mx: e.clientX - r.left,
          my: e.clientY - r.top
        }
        return Math.min(6, Math.max(0.2, z * Math.exp(-e.deltaY * 0.0015)))
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  useLayoutEffect(() => {
    const a = anchorRef.current
    const el = scrollRef.current
    if (!a || !el) return
    anchorRef.current = null
    el.scrollLeft = a.fx * el.scrollWidth - a.mx
    el.scrollTop = a.fy * el.scrollHeight - a.my
  }, [zoom])
  const onZoomButton = (): void => {
    if (atFit) setFit((f) => ED_FITS[(ED_FITS.indexOf(f) + 1) % ED_FITS.length])
    else setZoom(1)
  }

  // ── Build the document ──
  useEffect(() => {
    let alive = true
    void (async () => {
      const img = await loadImage(src)
      if (!alive) return
      imgRef.current = img
      const { W, H } = canvasSize(img)
      const page = newCanvas(W, H)
      // Software canvas: the page scaled as the viewer scales it.
      page.getContext('2d', { willReadFrequently: true })!.drawImage(img, 0, 0, W, H)
      pageC.current = page
      textC.current = newCanvas(W, H, 'ted-layer')
      overC.current = newCanvas(W, H, 'ted-layer ted-over')
      const pix = new Map<string, HTMLCanvasElement>()
      const put = (id: string, im: CanvasImageSource | ImageData | null): void => {
        const c = newCanvas(W, H, 'ted-layer')
        if (im instanceof ImageData) c.getContext('2d')!.putImageData(im, 0, 0)
        else if (im) c.getContext('2d')!.drawImage(im, 0, 0, W, H)
        pix.set(id, c)
      }
      let doc: TransDoc
      const saved = await getTransDoc(src)
      if (saved && saved.doc.W === W && saved.doc.H === H) {
        doc = saved.doc
        origRef.current = doc.orig ?? doc.blocks.map(unedited)
        for (const l of doc.layers) if (l.kind === 'pixels') put(l.id, saved.images.get(l.id) ?? null)
      } else {
        // A page not edited here yet: the auto pass as layers (as the viewer shows it).
        if (alive) setBusyMsg('자동 처리 중…')
        const auto = await autoDoc(img, initial, mask)
        if (!alive) return
        const old = await getTransPaint(src)
        const [text, ...rest] = autoLayers()
        doc = {
          v: 1,
          W,
          H,
          blocks: auto.blocks,
          regions: auto.regions,
          layers: [text, ...(old ? [{ id: 'layer-1', name: '레이어 1', kind: 'pixels' as const, visible: true }] : []), ...rest]
        }
        put(L_AUTO_INPAINT, auto.erase)
        if (old) put('layer-1', old)
        for (const id of pix.keys()) dirtyPix.current.add(id)
      }
      if (!alive) return
      pixRef.current = pix
      uidsRef.current = doc.blocks.map(() => nextUidRef.current++)
      blocksRef.current = doc.blocks
      regionsRef.current = doc.regions
      layersRef.current = doc.layers
      histRef.current = [{ blocks: doc.blocks, regions: doc.regions, layers: doc.layers }]
      hiRef.current = 0
      setBlocks(doc.blocks)
      setRegions(doc.regions)
      setLayers(doc.layers)
      setSize({ W, H })
      setBusyMsg(null)
    })().catch((e) => {
      console.error('editor load failed', e)
      if (alive) setBusyMsg('불러오지 못했습니다')
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  useEffect(() => {
    if (stage === 4) void installedFonts().then(setFonts)
  }, [stage])

  // Current blocks merged with LIVE textarea text (read from the DOM).
  const snapshot = (): TransBlock[] =>
    blocksRef.current.map((b, i) => {
      const uid = uidsRef.current[i]
      const el = taRefs.current[uid]
      const tr = el ? el.value : b.tr
      return editedRef.current.has(uid) ? { ...b, tr, edited: true } : tr === b.tr ? b : { ...b, tr }
    })

  // ── Drawing ──
  // The text alone (layout from the regions): cheap, so every edit redraws it.
  const drawText = (): void => {
    const c = textC.current
    if (!c || !size) return
    drawnRef.current = drawDocText(c, { W: size.W, H: size.H, blocks: snapshot(), regions: regionsRef.current })
  }
  // Live edits (typing, a palette being dragged, a box being dragged): one text
  // redraw a frame, none mid-IME-composition.
  const rafRef = useRef<number | null>(null)
  const redrawLive = (): void => {
    if (composingRef.current || rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      drawText()
      setDrawVer((v) => v + 1)
    })
  }
  useEffect(() => {
    if (!ready) return
    drawText()
    setDrawVer((v) => v + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, regions, ready])
  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    },
    []
  )

  // Stack the canvases in layer order; show what the stage shows.
  useLayoutEffect(() => {
    const st = stackRef.current
    const page = pageC.current
    if (!st || !page || !ready) return
    const order: HTMLCanvasElement[] = [page]
    for (const l of [...layers].reverse()) {
      const c = l.kind === 'pixels' ? pixRef.current.get(l.id) : l.kind === 'text' ? textC.current : null
      if (!c) continue
      const shown = l.visible && (l.kind === 'pixels' ? stage >= 3 : stage === 4)
      c.style.display = shown ? '' : 'none'
      order.push(c)
    }
    if (overC.current) {
      overC.current.style.display = stage === 2 || stage === 3 ? '' : 'none'
      order.push(overC.current)
    }
    for (const c of order) st.appendChild(c)
    for (const c of [...st.children]) if (!order.includes(c as HTMLCanvasElement)) c.remove()
  }, [layers, stage, ready])

  // Bubble regions (stages 2 and 3), kept until deleted: light purple; the one
  // clicked (active) dark purple with its outline drawn.
  useEffect(() => {
    const c = overC.current
    if (!c || !size || !ready) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, size.W, size.H)
    if (stage !== 2 && stage !== 3) return
    const img = ctx.createImageData(size.W, size.H)
    const d = img.data
    const shown = new Set(layers.filter((l) => l.kind === 'bubbles' && l.visible).map((l) => l.id))
    const active = regions.find((r) => r.id === selRegion && shown.has(r.layer))
    const paint = (r: TransRegion, fill: number[], edge?: number[]): void => {
      const m = regionMask(r)
      for (let y = 0; y < r.h; y++)
        for (let x = 0; x < r.w; x++) {
          if (!m[y * r.w + x]) continue
          const X = r.x + x
          const Y = r.y + y
          if (X < 0 || Y < 0 || X >= size.W || Y >= size.H) continue
          const out = (dx: number, dy: number): boolean => {
            const xx = x + dx
            const yy = y + dy
            return xx < 0 || yy < 0 || xx >= r.w || yy >= r.h || !m[yy * r.w + xx]
          }
          // The outline: pixels within 2 of the region's edge.
          const rim = edge && (out(-1, 0) || out(1, 0) || out(0, -1) || out(0, 1) || out(-2, 0) || out(2, 0) || out(0, -2) || out(0, 2))
          d.set(rim ? edge : fill, (Y * size.W + X) * 4)
        }
    }
    for (const r of regions) if (shown.has(r.layer) && r !== active) paint(r, [150, 110, 250, 60])
    if (active) paint(active, [91, 30, 207, 120], [91, 30, 207, 255])
    ctx.putImageData(img, 0, 0)
  }, [regions, layers, stage, selRegion, size, ready])

  // ── History ──
  const applyBlocks = (next: TransBlock[]): void => {
    blocksRef.current = next
    setBlocks(next)
  }
  const applyRegions = (next: TransRegion[]): void => {
    regionsRef.current = next
    setRegions(next)
  }
  const applyLayers = (next: TransLayer[]): void => {
    layersRef.current = next
    setLayers(next)
  }
  const pushHistory = (patch?: Step['patch']): void => {
    const base = histRef.current.slice(0, hiRef.current + 1)
    const last = base[base.length - 1]
    base.push({ blocks: patch ? last.blocks : snapshot(), regions: regionsRef.current, layers: layersRef.current, patch })
    histRef.current = base
    hiRef.current = base.length - 1
    bumpHist()
  }
  const commit = (next: TransBlock[]): void => {
    applyBlocks(next)
    pushHistory()
  }
  const patched = (i: number, patch: Partial<TransBlock>): TransBlock[] =>
    blocksRef.current.map((b, idx) => (idx === i ? { ...b, ...patch, edited: true } : b))
  // Undo/redo replay a step. Restored rows get FRESH uids: their textareas remount
  // and show the restored text (normal edits keep uids → IME undisturbed).
  const restore = (step: Step): void => {
    if (step.blocks !== blocksRef.current) {
      uidsRef.current = step.blocks.map(() => nextUidRef.current++)
      editedRef.current = new Set()
      applyBlocks(step.blocks)
    }
    if (step.regions !== regionsRef.current) applyRegions(step.regions)
    if (step.layers !== layersRef.current) {
      applyLayers(step.layers)
      // A layer brought back may have lost its saved image: save them all again.
      for (const l of step.layers) if (l.kind === 'pixels') dirtyPix.current.add(l.id)
    }
  }
  const putPatch = (p: Step['patch'], which: 'before' | 'after'): void => {
    const c = p && pixRef.current.get(p.layer)
    if (!p || !c) return
    c.getContext('2d')!.putImageData(p[which], p.x, p.y)
    dirtyPix.current.add(p.layer)
  }
  const undo = (): void => {
    if (hiRef.current <= 0) return
    putPatch(histRef.current[hiRef.current].patch, 'before')
    hiRef.current -= 1
    restore(histRef.current[hiRef.current])
    bumpHist()
  }
  const redo = (): void => {
    if (hiRef.current >= histRef.current.length - 1) return
    hiRef.current += 1
    const step = histRef.current[hiRef.current]
    putPatch(step.patch, 'after')
    restore(step)
    bumpHist()
  }
  const canUndo = hiRef.current > 0
  const canRedo = hiRef.current < histRef.current.length - 1

  // ── Save ──
  const collect = (): { doc: TransDoc; images: Record<string, string | null> } | null => {
    if (!size) return null
    const doc: TransDoc = { v: 1, W: size.W, H: size.H, blocks: snapshot(), regions: regionsRef.current, layers: layersRef.current, orig: origRef.current }
    const images: Record<string, string | null> = {}
    for (const id of dirtyPix.current) {
      const c = pixRef.current.get(id)
      if (!c || !doc.layers.some((l) => l.id === id)) continue
      images[id] = isEmpty(c) ? null : c.toDataURL('image/png')
    }
    return { doc, images }
  }
  const save = (): void => {
    const got = collect()
    if (got) onSave(got.doc, got.images)
  }
  if (apiRef)
    apiRef.current = {
      dirty: () =>
        hiRef.current > 0 ||
        blocksRef.current.some((b, i) => {
          const el = taRefs.current[uidsRef.current[i]]
          return !!el && el.value !== b.tr
        }),
      collect
    }

  // ── Layers ──
  const layerOf = (id: string): TransLayer | undefined => layersRef.current.find((l) => l.id === id)
  // A new painted layer above the active one (or under the text).
  const addPixLayer = (): string => {
    if (!size) return ''
    const ls = layersRef.current
    let n = 1
    while (ls.some((l) => l.id === `layer-${n}`)) n++
    const id = `layer-${n}`
    if (!pixRef.current.has(id)) pixRef.current.set(id, newCanvas(size.W, size.H, 'ted-layer'))
    const at = Math.max(0, ls.findIndex((l) => l.id === activeId))
    const l: TransLayer = { id, name: `레이어 ${n}`, kind: 'pixels', visible: true }
    applyLayers(layerOf(activeId)?.kind === 'text' ? [...ls.slice(0, at + 1), l, ...ls.slice(at + 1)] : [...ls.slice(0, at), l, ...ls.slice(at)])
    setActiveId(id)
    pushHistory()
    return id
  }
  // Where the paint tools paint: the active layer if it's a painted one, else the
  // topmost painted layer of the user's, else a new one.
  const paintTarget = (): string => {
    const a = layerOf(activeId)
    if (a?.kind === 'pixels') return a.id
    const mine = layersRef.current.find((l) => l.kind === 'pixels' && !l.auto)
    if (mine) {
      setActiveId(mine.id)
      return mine.id
    }
    return addPixLayer()
  }
  const moveLayer = (id: string, by: -1 | 1): void => {
    const ls = [...layersRef.current]
    const k = ls.findIndex((l) => l.id === id)
    const to = k + by
    if (k < 0 || to < 0 || to >= ls.length) return
    ;[ls[k], ls[to]] = [ls[to], ls[k]]
    applyLayers(ls)
    pushHistory()
  }
  const deleteLayer = (id: string): void => {
    const l = layerOf(id)
    if (!l || l.kind === 'text') return
    applyLayers(layersRef.current.filter((x) => x.id !== id))
    if (l.kind === 'bubbles') applyRegions(regionsRef.current.filter((r) => r.layer !== id))
    if (activeId === id) setActiveId(L_TEXT)
    pushHistory()
  }
  // Visibility is a view setting: no undo step, but saved.
  const toggleLayer = (id: string): void => {
    applyLayers(layersRef.current.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)))
    const h = histRef.current[hiRef.current]
    if (h) h.layers = layersRef.current
  }

  // ── Pixels: composite, masks, painting ──
  // The page as it shows under the text: the page + visible painted layers.
  const composite = (): ImageData | null => {
    if (!size || !pageC.current) return null
    const c = newCanvas(size.W, size.H)
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(pageC.current, 0, 0)
    for (const l of [...layersRef.current].reverse()) {
      const p = l.kind === 'pixels' && l.visible ? pixRef.current.get(l.id) : null
      if (p) ctx.drawImage(p, 0, 0)
    }
    return ctx.getImageData(0, 0, size.W, size.H)
  }
  // The bubble regions (or just the one `only`) as one page mask.
  const regionsMask = (only?: string | null): Uint8Array | null => {
    const rs = regionsRef.current.filter((r) => !only || r.id === only)
    if (!size || !rs.length) return null
    const out = new Uint8Array(size.W * size.H)
    for (const r of rs) {
      const m = regionMask(r)
      for (let y = 0; y < r.h; y++)
        for (let x = 0; x < r.w; x++) {
          const X = r.x + x
          const Y = r.y + y
          if (m[y * r.w + x] && X >= 0 && Y >= 0 && X < size.W && Y < size.H) out[Y * size.W + X] = 1
        }
    }
    return out
  }
  // The selections in use: the clicked one, else all of them.
  const usedSels = (): Pt[][] => (activeSel !== null && sels[activeSel] ? [sels[activeSel]] : sels)
  const selMaskRef = useRef<{ sels: Pt[][]; m: Uint8Array } | null>(null)
  const selMask = (): Uint8Array | null => {
    const used = usedSels()
    if (!used.length || !size) return null
    if (selMaskRef.current?.sels.length !== used.length || selMaskRef.current.sels.some((q, k) => q !== used[k])) {
      const m = new Uint8Array(size.W * size.H)
      for (const pts of used) {
        const one = polygonMask(pts, size.W, size.H)
        for (let i = 0; i < m.length; i++) if (one[i]) m[i] = 1
      }
      selMaskRef.current = { sels: used, m }
    }
    return selMaskRef.current.m
  }
  // Stage 3's mask: the clicked selection, else the clicked region, else all the
  // selections, else all the bubble regions — or the outside of it.
  const toolMask = (): Uint8Array | null => {
    const m = activeSel !== null ? selMask() : selRegion ? regionsMask(selRegion) : (selMask() ?? regionsMask(null))
    if (!m || !maskOut) return m
    const inv = new Uint8Array(m.length)
    for (let i = 0; i < m.length; i++) inv[i] = m[i] ? 0 : 1
    return inv
  }
  const maskCanvas = (m: Uint8Array): HTMLCanvasElement => {
    const c = newCanvas(size!.W, size!.H)
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(size!.W, size!.H)
    for (let i = 0; i < m.length; i++) if (m[i]) img.data[i * 4 + 3] = 255
    ctx.putImageData(img, 0, 0)
    return c
  }
  // One paint step on a layer: before → after, its changed rect into history.
  const endPaint = (layer: string, before: ImageData): void => {
    const c = pixRef.current.get(layer)
    if (!c) return
    const after = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
    const W = c.width
    let x0 = W
    let y0 = c.height
    let x1 = -1
    let y1 = -1
    const a = after.data
    const b = before.data
    for (let i = 0; i < a.length; i += 4)
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
        const p = i >> 2
        const x = p % W
        const y = (p - x) / W
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    if (x1 < 0) return
    const cut = (img: ImageData): ImageData => {
      const w = x1 - x0 + 1
      const h = y1 - y0 + 1
      const out = new ImageData(w, h)
      for (let y = 0; y < h; y++) out.data.set(img.data.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + w) * 4), y * w * 4)
      return out
    }
    dirtyPix.current.add(layer)
    pushHistory({ layer, x: x0, y: y0, before: cut(before), after: cut(after) })
  }
  // Paint `region` (page mask) in the brush colour on the paint target.
  const fillMask = (region: Uint8Array): void => {
    const id = paintTarget()
    const c = pixRef.current.get(id)
    if (!c) return
    const ctx = c.getContext('2d')!
    const before = ctx.getImageData(0, 0, c.width, c.height)
    const img = ctx.getImageData(0, 0, c.width, c.height)
    const rgb = [parseInt(brushColor.slice(1, 3), 16), parseInt(brushColor.slice(3, 5), 16), parseInt(brushColor.slice(5, 7), 16)]
    const A = brushAlpha
    const d = img.data
    for (let i = 0; i < region.length; i++)
      if (region[i]) {
        // The colour at its opacity over what the layer has there.
        const a = d[i * 4 + 3] / 255
        const out = A + a * (1 - A)
        for (let k = 0; k < 3; k++) d[i * 4 + k] = out ? (rgb[k] * A + d[i * 4 + k] * a * (1 - A)) / out : 0
        d[i * 4 + 3] = Math.round(out * 255)
      }
    ctx.putImageData(img, 0, 0)
    endPaint(id, before)
  }

  // ── Selection ──
  const finishSelection = (pts: Pt[]): void => {
    setDraft(null)
    setWire(null)
    if (pts.length < 3) return
    setSels((s) => [...s, pts])
    // A new selection is what the next step works on: nothing stays picked.
    setActiveSel(null)
    setSelRegion(null)
  }
  // 선택 해제 (Ctrl+D): all the selections.
  const clearSelection = (): void => {
    setDraft(null)
    setWire(null)
    setSels([])
    setActiveSel(null)
  }
  // Remove one selection (the clicked one).
  const removeSel = (k: number): void => {
    setSels((s) => s.filter((_, i) => i !== k))
    setActiveSel(null)
  }
  // A click on the page: the selection under it is picked (the top one), or none.
  const selAt = (p: Pt): number | null => {
    for (let k = sels.length - 1; k >= 0; k--) if (inPolygon(p, sels[k])) return k
    return null
  }
  useEffect(() => {
    if (tool !== 'magnet' || !size || !ready) return
    const img = composite()
    if (img) costRef.current = edgeCost(img.data, size.W, size.H)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, size, ready])
  useEffect(() => {
    setDraft(null)
    setWire(null)
    setToolMsg(null)
  }, [tool])

  // Stage 2: the selection → a region on the user's bubble layer, for the
  // selected block (else the block whose box it covers most).
  const makeRegion = (): void => {
    const m = selMask()
    const page = pageC.current
    if (!m || !size || !page) return
    const { W, H } = size
    let x0 = W
    let y0 = H
    let x1 = -1
    let y1 = -1
    for (let i = 0; i < m.length; i++)
      if (m[i]) {
        const x = i % W
        const y = (i - x) / W
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
    if (x1 < 0) return
    const w = x1 - x0 + 1
    const h = y1 - y0 + 1
    const inside = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) inside[y * w + x] = m[(y0 + y) * W + x0 + x]
    // Its fill: the commonest page colour in it (16 levels a channel).
    const d = page.getContext('2d', { willReadFrequently: true })!.getImageData(x0, y0, w, h).data
    const counts = new Map<number, number>()
    for (let i = 0; i < w * h; i++) if (inside[i]) counts.set(((d[i * 4] >> 4) << 8) | ((d[i * 4 + 1] >> 4) << 4) | (d[i * 4 + 2] >> 4), (counts.get(((d[i * 4] >> 4) << 8) | ((d[i * 4 + 1] >> 4) << 4) | (d[i * 4 + 2] >> 4)) ?? 0) + 1)
    const top = [...counts].sort((p, q) => q[1] - p[1])[0]?.[0] ?? 0xfff
    const fill = rgbToHex([((top >> 8) & 15) * 17, ((top >> 4) & 15) * 17, (top & 15) * 17])
    let owner = sel !== null ? blocksRef.current[sel]?.id : undefined
    if (!owner) {
      let best = 0
      for (const b of blocksRef.current) {
        let n = 0
        for (let y = Math.max(y0, Math.floor(b.y)); y < Math.min(y0 + h, Math.ceil(b.y + b.h)); y++)
          for (let x = Math.max(x0, Math.floor(b.x)); x < Math.min(x0 + w, Math.ceil(b.x + b.w)); x++) n += inside[(y - y0) * w + x - x0]
        if (n > best) {
          best = n
          owner = b.id
        }
      }
    }
    // The user's bubble layer: the active one if it's theirs, else 사용자 말풍선
    // (made above the auto one, so its regions win for their blocks).
    let layer = layerOf(activeId)?.kind === 'bubbles' && !layerOf(activeId)?.auto ? activeId : L_USER_BUBBLES
    if (!layerOf(layer)) {
      layer = L_USER_BUBBLES
      const ls = layersRef.current
      const at = ls.findIndex((l) => l.id === L_AUTO_BUBBLES)
      const l: TransLayer = { id: L_USER_BUBBLES, name: '사용자 말풍선', kind: 'bubbles', visible: true }
      applyLayers(at < 0 ? [...ls, l] : [...ls.slice(0, at), l, ...ls.slice(at)])
    }
    let n = regionsRef.current.length
    while (regionsRef.current.some((r) => r.id === `u${n}`)) n++
    const r: TransRegion = { id: `u${n}`, layer, blocks: owner ? [owner] : [], x: x0, y: y0, w, h, bits: packMask(inside), fill }
    applyRegions([r, ...regionsRef.current])
    setSelRegion(r.id)
    if (activeSel !== null) removeSel(activeSel)
    else setSels([])
    pushHistory()
  }
  const deleteRegion = (id: string | null): void => {
    if (!id) return
    applyRegions(regionsRef.current.filter((r) => r.id !== id))
    setSelRegion(null)
    pushHistory()
  }
  const linkRegion = (i: number): void => {
    const id = blocksRef.current[i]?.id
    if (!selRegion || !id) return
    applyRegions(regionsRef.current.map((r) => (r.id === selRegion ? { ...r, blocks: [id] } : r)))
    pushHistory()
  }
  // The region under a page point (the topmost layer's first).
  const regionAt = (p: Pt): TransRegion | null => {
    const order = new Map(layersRef.current.map((l, k) => [l.id, k]))
    const hits = regionsRef.current.filter((r) => {
      const x = Math.floor(p.x - r.x)
      const y = Math.floor(p.y - r.y)
      return x >= 0 && y >= 0 && x < r.w && y < r.h && regionMask(r)[y * r.w + x] === 1
    })
    hits.sort((a, b) => (order.get(a.layer) ?? 0) - (order.get(b.layer) ?? 0))
    return hits[0] ?? null
  }

  // ── Auto steps ──
  const [autoBusy, setAutoBusy] = useState<string | null>(null)
  const autoRes = (): { ok: boolean; w: number; h: number; blocks: TransBlock[]; mask?: TextMask } => ({ ok: true, w: 0, h: 0, blocks: snapshot(), mask: maskRef.current })
  // 자동 선택: the auto pass's regions replace the auto bubble layer's.
  const autoSelect = async (): Promise<void> => {
    const img = imgRef.current
    if (!img) return
    setAutoBusy('말풍선 찾는 중…')
    await new Promise((r) => setTimeout(r, 20))
    try {
      const auto = autoPage(img, autoRes(), null)
      const looks = new Map(auto.blocks.map((b) => [b.id, b.look]))
      applyBlocks(blocksRef.current.map((b) => (b.look || !looks.get(b.id) ? b : { ...b, look: looks.get(b.id) })))
      let ls = layersRef.current
      if (!ls.some((l) => l.id === L_AUTO_BUBBLES)) ls = [...ls, { id: L_AUTO_BUBBLES, name: '자동 말풍선', kind: 'bubbles', visible: true, auto: true }]
      applyLayers(ls)
      applyRegions([...regionsRef.current.filter((r) => r.layer !== L_AUTO_BUBBLES), ...auto.regions.map((r) => ({ ...r, layer: L_AUTO_BUBBLES }))])
      pushHistory()
    } finally {
      setAutoBusy(null)
    }
  }
  // 자동 인페인팅: the auto erase (LaMa when installed), within the mask, replaces
  // the auto inpaint layer.
  const autoInpaint = async (): Promise<void> => {
    const img = imgRef.current
    if (!img || !size) return
    setAutoBusy('인페인팅 중…')
    try {
      const res = autoRes()
      const heal = await healPage(img, res)
      const auto = autoPage(img, res, heal)
      const m = toolMask()
      // Inside the user's selections the whole selection is painted over from
      // round it (sound effects, which the auto erase leaves).
      const fill = !maskOut && (activeSel !== null || (!selRegion && !!selPts)) ? usedSels() : null
      let ls = layersRef.current
      if (!ls.some((l) => l.id === L_AUTO_INPAINT)) {
        const at = ls.findIndex((l) => l.kind === 'bubbles')
        const l: TransLayer = { id: L_AUTO_INPAINT, name: '자동 인페인팅', kind: 'pixels', visible: true, auto: true }
        ls = at < 0 ? [...ls, l] : [...ls.slice(0, at), l, ...ls.slice(at)]
        applyLayers(ls)
      }
      let c = pixRef.current.get(L_AUTO_INPAINT)
      if (!c) {
        c = newCanvas(size.W, size.H, 'ted-layer')
        pixRef.current.set(L_AUTO_INPAINT, c)
      }
      const ctx = c.getContext('2d')!
      const before = ctx.getImageData(0, 0, size.W, size.H)
      const out = auto.erase
      // Outside the mask the layer keeps what it had.
      if (m) for (let i = 0; i < m.length; i++) if (!m[i]) for (let k = 0; k < 4; k++) out.data[i * 4 + k] = before.data[i * 4 + k]
      if (fill && m && pageC.current) {
        const page = pageC.current.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, size.W, size.H)
        for (let i = 0; i < m.length; i++) if (out.data[i * 4 + 3]) for (let k = 0; k < 4; k++) page.data[i * 4 + k] = out.data[i * 4 + k]
        const rects = fill.map((pts) => {
          const xs = pts.map((q) => q.x)
          const ys = pts.map((q) => q.y)
          const x0 = Math.max(0, Math.floor(Math.min(...xs)))
          const y0 = Math.max(0, Math.floor(Math.min(...ys)))
          return { x0, y0, w: Math.min(size.W, Math.ceil(Math.max(...xs))) - x0, h: Math.min(size.H, Math.ceil(Math.max(...ys))) - y0 }
        })
        const done = await fillSelection(page, m, rects)
        for (let i = 0; i < m.length; i++)
          if (m[i]) {
            for (let k = 0; k < 3; k++) out.data[i * 4 + k] = done.data[i * 4 + k]
            out.data[i * 4 + 3] = 255
          }
      }
      ctx.putImageData(out, 0, 0)
      endPaint(L_AUTO_INPAINT, before)
    } finally {
      setAutoBusy(null)
    }
  }

  // The document rebuilt from `from` by the auto pass, as a page opens before any
  // work: the user's layers and bubble regions go. One undo step.
  const rebuild = async (from: TransBlock[]): Promise<void> => {
    const img = imgRef.current
    if (!img || !size) return
    const auto = await autoDoc(img, from, maskRef.current)
    uidsRef.current = auto.blocks.map(() => nextUidRef.current++)
    editedRef.current = new Set()
    setSel(null)
    setSelRegion(null)
    setActiveId(L_TEXT)
    applyBlocks(auto.blocks)
    applyRegions(auto.regions)
    applyLayers(autoLayers())
    let c = pixRef.current.get(L_AUTO_INPAINT)
    if (!c) {
      c = newCanvas(size.W, size.H, 'ted-layer')
      pixRef.current.set(L_AUTO_INPAINT, c)
    }
    const ctx = c.getContext('2d')!
    const before = ctx.getImageData(0, 0, size.W, size.H)
    ctx.putImageData(auto.erase, 0, 0)
    const at = hiRef.current
    endPaint(L_AUTO_INPAINT, before)
    if (hiRef.current === at) pushHistory() // the erase came out the same
  }
  // 초기화: all the work on this page thrown away (undo brings it back).
  const resetDoc = async (): Promise<void> => {
    setAutoBusy('초기화 중…')
    setRegionErr(null)
    try {
      await rebuild(origRef.current)
    } finally {
      setAutoBusy(null)
    }
  }
  // 전체 다시 번역: the page through the engine again, the document rebuilt from it.
  const retranslateAll = async (): Promise<void> => {
    setAutoBusy('다시 번역 중…')
    setRegionErr(null)
    try {
      const r = await retranslatePage(src, langHint)
      if (!r.ok) return setRegionErr(r.error ?? '번역 실패')
      origRef.current = r.blocks
      maskRef.current = r.mask
      await rebuild(r.blocks)
    } catch (e) {
      setRegionErr(String((e as Error)?.message ?? e))
    } finally {
      setAutoBusy(null)
    }
  }
  // 선택 영역 다시 번역: the selected line's source through the translator again.
  const retranslateSel = async (): Promise<void> => {
    const b = sel === null ? null : blocksRef.current[sel]
    if (!b?.text.trim()) return
    setAutoBusy('다시 번역 중…')
    setRegionErr(null)
    try {
      const r = await translateLines(src, [b.text], langHint)
      if (!r.ok) return setRegionErr(r.error ?? '번역 실패')
      const i = blocksRef.current.indexOf(b)
      if (i < 0) return // deleted meanwhile
      // A fresh uid remounts its textarea with the new text.
      const uid = nextUidRef.current++
      uidsRef.current = uidsRef.current.map((u, k) => (k === i ? uid : u))
      editedRef.current.add(uid)
      commit(patched(i, { tr: r.texts[0] ?? '', runs: undefined }))
    } catch (e) {
      setRegionErr(String((e as Error)?.message ?? e))
    } finally {
      setAutoBusy(null)
    }
  }
  const modelLabel = useStore((s) => transModelLabel(s.settings))

  // ── Canvas mouse ──
  const pointAt = (e: { clientX: number; clientY: number }, el: Element): Pt => {
    const r = el.getBoundingClientRect()
    const disp = dim?.disp ?? 1
    return { x: (e.clientX - r.left) / disp, y: (e.clientY - r.top) / disp }
  }
  const nearFirst = (p: Pt, pts: Pt[]): boolean => pts.length >= 3 && Math.hypot(p.x - pts[0].x, p.y - pts[0].y) * (dim?.disp ?? 1) <= 8

  const onToolDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!dim || e.button !== 0) return
    const wrap = e.currentTarget
    const p = pointAt(e, wrap)
    const { W, H } = dim
    e.preventDefault()
    setToolMsg(null)
    if (tool === 'move') {
      // Stages 2, 3: pick the selection under the cursor, else the region (and
      // its block); nothing there → nothing picked.
      if (stage === 2 || stage === 3) {
        const k = selAt(p)
        setActiveSel(k)
        if (k !== null) return setSelRegion(null)
        const r = regionAt(p)
        setSelRegion(r?.id ?? null)
        if (r?.blocks[0]) {
          const k = blocksRef.current.findIndex((b) => b.id === r.blocks[0])
          if (k >= 0) setSel(k)
        }
      } else setActiveSel(null) // stages 1, 4: the selections pick themselves (their polygons)
      return
    }
    if (tool === 'pick') {
      const img = composite()
      if (!img) return
      const o = (Math.min(H - 1, Math.max(0, Math.floor(p.y))) * W + Math.min(W - 1, Math.max(0, Math.floor(p.x)))) * 4
      const hex = rgbToHex([img.data[o], img.data[o + 1], img.data[o + 2]])
      if (e.shiftKey && sel !== null) applyStyle({ color: hex })
      else setBrushColor(hex)
      return
    }
    if (tool === 'fill') {
      const img = composite()
      if (!img) return
      fillMask(floodRegion(img.data, W, H, p.x, p.y, tol, toolMask()))
      return
    }
    if (tool === 'grad') {
      // Drag round a lettering (or click a selection): its gradient, saved for
      // the 번역문 stage's gradient button.
      const read = (pts: Pt[]): void => {
        const page = pageC.current
        if (!page) return
        const inMask = polygonMask(pts, W, H)
        const xs = pts.map((q) => q.x)
        const ys = pts.map((q) => q.y)
        const bx0 = Math.max(0, Math.floor(Math.min(...xs)))
        const by0 = Math.max(0, Math.floor(Math.min(...ys)))
        const bx1 = Math.min(W - 1, Math.ceil(Math.max(...xs)))
        const by1 = Math.min(H - 1, Math.ceil(Math.max(...ys)))
        const inside: number[] = []
        const border: number[] = []
        for (let y = by0; y <= by1; y++)
          for (let x = bx0; x <= bx1; x++) {
            const i = y * W + x
            if (!inMask[i]) continue
            inside.push(i)
            if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || !inMask[i - 1] || !inMask[i + 1] || !inMask[i - W] || !inMask[i + W]) border.push(i)
          }
        const d = page.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data
        const g = readGradient(d, W, inside, border)
        if (!g) return setToolMsg('그 안에서 글자를 찾지 못했습니다 · 글자를 조금 더 넉넉히 감싸 주세요')
        setSavedGrad(g)
        try {
          localStorage.setItem(GRAD_KEY, JSON.stringify(g))
        } catch {
          /* kept for this run only */
        }
        setToolMsg('그라데이션을 저장했습니다 · 번역문 단계의 그라데이션 버튼으로 적용')
      }
      const box = (a: Pt, b: Pt): Pt[] => [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }]
      const move = (ev: MouseEvent): void => setDraft(box(p, pointAt(ev, wrap)))
      const up = (ev: MouseEvent): void => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        setDraft(null)
        const q = pointAt(ev, wrap)
        if (Math.abs(q.x - p.x) >= 3 && Math.abs(q.y - p.y) >= 3) return read(box(p, q))
        const k = selAt(p)
        if (k !== null) read(sels[k])
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
      return
    }
    if (tool === 'rect' || tool === 'ellipse') {
      const shape = (a: Pt, b: Pt): Pt[] => (tool === 'rect' ? [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }] : ellipsePts(a, b))
      const move = (ev: MouseEvent): void => setDraft(shape(p, pointAt(ev, wrap)))
      const up = (ev: MouseEvent): void => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        const q = pointAt(ev, wrap)
        const clamp = (v: Pt): Pt => ({ x: Math.max(0, Math.min(W, v.x)), y: Math.max(0, Math.min(H, v.y)) })
        if (Math.abs(q.x - p.x) < 3 || Math.abs(q.y - p.y) < 3) {
          // A click: picks the selection under it, or none.
          setDraft(null)
          const k = selAt(p)
          setActiveSel(k)
          if (k !== null) setSelRegion(null)
        } else finishSelection(shape(p, q).map(clamp))
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
      return
    }
    if (tool === 'poly' || tool === 'magnet') {
      const pts = draft ?? []
      if (nearFirst(p, pts)) {
        const close = tool === 'magnet' && costRef.current ? livewire(costRef.current, W, H, pts[pts.length - 1], pts[0]) : []
        finishSelection([...pts, ...close])
        return
      }
      if (!pts.length || tool === 'poly') setDraft([...pts, p])
      else setDraft([...pts, ...(costRef.current ? livewire(costRef.current, W, H, pts[pts.length - 1], p) : [p])])
      setWire(null)
      return
    }
    // Brush, eraser, healing brush: a stroke on the paint target.
    if (tool === 'heal' && e.altKey) {
      setHealSrc(p)
      healOff.current = null
      return
    }
    if (tool === 'heal' && !healSrc) {
      setToolMsg('Alt+클릭으로 복제할 곳을 먼저 지정하세요')
      return
    }
    const target = tool === 'erase' ? (layerOf(activeId)?.kind === 'pixels' ? activeId : null) : paintTarget()
    if (!target) {
      setToolMsg('지울 레이어(그림 레이어)를 오른쪽 아래 목록에서 선택하세요')
      return
    }
    const c = pixRef.current.get(target)
    if (!c) return
    const ctx = c.getContext('2d')!
    const before = ctx.getImageData(0, 0, W, H)
    const m = toolMask()
    if (tool === 'heal') {
      const base = composite()
      if (!base) return
      // Aligned: the first stroke after Alt+click fixes the offset; later
      // strokes keep it (the source follows the brush).
      if (!healOff.current) healOff.current = { dx: Math.round(healSrc!.x - p.x), dy: Math.round(healSrc!.y - p.y) }
      const { dx, dy } = healOff.current
      const layer = ctx.getImageData(0, 0, W, H)
      const done = new Uint8Array(W * H)
      const r = brushSize / 2
      const stamp = (q: Pt): void => {
        const bx = Math.max(0, Math.floor(q.x - r))
        const by = Math.max(0, Math.floor(q.y - r))
        const ex = Math.min(W - 1, Math.ceil(q.x + r))
        const ey = Math.min(H - 1, Math.ceil(q.y + r))
        for (let y = by; y <= ey; y++)
          for (let x = bx; x <= ex; x++) {
            const i = y * W + x
            if ((x - q.x) ** 2 + (y - q.y) ** 2 > r * r || (m && !m[i])) continue
            const sx = Math.max(0, Math.min(W - 1, x + dx))
            const sy = Math.max(0, Math.min(H - 1, y + dy))
            const so = (sy * W + sx) * 4
            layer.data.set(base.data.subarray(so, so + 3), i * 4)
            layer.data[i * 4 + 3] = 255
            done[i] = 1
          }
        if (ex >= bx && ey >= by) ctx.putImageData(layer, 0, 0, bx, by, ex - bx + 1, ey - by + 1)
      }
      let last = p
      stamp(p)
      const move = (ev: MouseEvent): void => {
        const q = pointAt(ev, wrap)
        const steps = Math.max(1, Math.ceil(Math.hypot(q.x - last.x, q.y - last.y) / Math.max(1, r / 3)))
        for (let k = 1; k <= steps; k++) stamp({ x: last.x + ((q.x - last.x) * k) / steps, y: last.y + ((q.y - last.y) * k) / steps })
        last = q
        setHover(q)
      }
      const up = (): void => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        healStroke(base.data, layer.data, done, W, H, dx, dy)
        ctx.putImageData(layer, 0, 0)
        endPaint(target, before)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
      return
    }
    // Brush / eraser: each segment drawn on a scratch canvas, cut to the mask,
    // then laid on (or cut out of) the layer.
    const mc = m ? maskCanvas(m) : null
    const scratch = newCanvas(1, 1)
    const sctx = scratch.getContext('2d')!
    // A see-through brush: the stroke built at full strength, laid on the layer
    // as it was at the opacity (overlapping dabs don't darken).
    const soft = tool === 'brush' && brushAlpha < 1 ? newCanvas(W, H) : null
    const seg = (a: Pt, b: Pt): void => {
      const r = brushSize / 2 + 2
      const x0 = Math.floor(Math.min(a.x, b.x) - r)
      const y0 = Math.floor(Math.min(a.y, b.y) - r)
      const w = Math.ceil(Math.abs(a.x - b.x) + 2 * r)
      const h = Math.ceil(Math.abs(a.y - b.y) + 2 * r)
      scratch.width = w
      scratch.height = h
      sctx.strokeStyle = sctx.fillStyle = tool === 'erase' ? '#000' : brushColor
      sctx.lineWidth = brushSize
      sctx.lineCap = sctx.lineJoin = 'round'
      sctx.beginPath()
      sctx.moveTo(a.x - x0, a.y - y0)
      sctx.lineTo(b.x - x0 + 0.01, b.y - y0)
      sctx.stroke()
      if (mc) {
        sctx.globalCompositeOperation = 'destination-in'
        sctx.drawImage(mc, -x0, -y0)
        sctx.globalCompositeOperation = 'source-over'
      }
      if (soft) {
        soft.getContext('2d')!.drawImage(scratch, x0, y0)
        ctx.putImageData(before, 0, 0, x0, y0, w, h)
        ctx.save()
        ctx.globalAlpha = brushAlpha
        ctx.drawImage(soft, x0, y0, w, h, x0, y0, w, h)
        ctx.restore()
        return
      }
      ctx.save()
      ctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over'
      ctx.drawImage(scratch, x0, y0)
      ctx.restore()
    }
    seg(p, p)
    let last = p
    const move = (ev: MouseEvent): void => {
      const q = pointAt(ev, wrap)
      seg(last, q)
      last = q
      setHover(q)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      endPaint(target, before)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const wireRaf = useRef<number | null>(null)
  const onToolMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!dim) return
    const p = pointAt(e, e.currentTarget)
    setHover(p)
    if (tool === 'magnet' && draft?.length && costRef.current && wireRaf.current == null) {
      const from = draft[draft.length - 1]
      wireRaf.current = requestAnimationFrame(() => {
        wireRaf.current = null
        if (costRef.current) setWire(livewire(costRef.current, dim.W, dim.H, from, p))
      })
    }
  }
  const closeDraft = (): void => {
    if (!draft || !dim) return
    const close = tool === 'magnet' && costRef.current && draft.length ? livewire(costRef.current, dim.W, dim.H, draft[draft.length - 1], draft[0]) : []
    finishSelection([...draft, ...close])
  }

  // ── Blocks ──
  const del = (i: number): void => {
    const id = blocksRef.current[i]?.id
    uidsRef.current = uidsRef.current.filter((_, idx) => idx !== i)
    setSel(null)
    if (id && regionsRef.current.some((r) => r.blocks.includes(id)))
      applyRegions(regionsRef.current.map((r) => (r.blocks.includes(id) ? { ...r, blocks: r.blocks.filter((x) => x !== id) } : r)))
    commit(blocksRef.current.filter((_, idx) => idx !== i))
  }
  const newId = (): string => {
    let n = blocksRef.current.length
    while (blocksRef.current.some((b) => b.id === `n${n}`)) n++
    return `n${n}`
  }
  // A new text box at the view's centre, seeded (an empty textarea can't take
  // Korean IME input).
  const addBlock = (): void => {
    if (!dim) return
    const { W, H } = dim
    const w = Math.round(W * 0.22)
    const h = Math.round(H * 0.1)
    const x = Math.round((W - w) / 2)
    const y = Math.round((H - h) / 2)
    const uid = nextUidRef.current++
    uidsRef.current = [...uidsRef.current, uid]
    editedRef.current.add(uid)
    pendingFocusRef.current = uid
    setSel(blocksRef.current.length)
    commit([...blocksRef.current, { id: newId(), x, y, w, h, text: '', tr: '내용', edited: true, room: [x, y, w, h], look: { fill: '#ffffff' } }])
  }
  useEffect(() => {
    const uid = pendingFocusRef.current
    if (uid == null) return
    const el = taRefs.current[uid]
    if (el) {
      el.focus()
      el.select()
      pendingFocusRef.current = null
    }
  }, [blocks])

  // 영역 번역 (stage 1): rubber-band a rectangle, OCR + translate it → a block.
  const startBand = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!picking || busy || !dim || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    const sx = (e.clientX - r.left) / dim.disp
    const sy = (e.clientY - r.top) / dim.disp
    const rectAt = (ev: MouseEvent): { x: number; y: number; w: number; h: number } => {
      const cx = Math.max(0, Math.min(dim.W, (ev.clientX - r.left) / dim.disp))
      const cy = Math.max(0, Math.min(dim.H, (ev.clientY - r.top) / dim.disp))
      return { x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) }
    }
    setRegionErr(null)
    setBand({ x: sx, y: sy, w: 0, h: 0 })
    const onMove = (ev: MouseEvent): void => setBand(rectAt(ev))
    const onUp = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const rect = rectAt(ev)
      if (rect.w < 8 || rect.h < 8) {
        setBand(null)
        return
      }
      setBand(rect)
      setBusy(true)
      translateRegion(src, rect, langHint)
        .then((res) => {
          if (!res.ok) return setRegionErr(res.error ?? '번역 실패')
          const b = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) }
          const uid = nextUidRef.current++
          uidsRef.current = [...uidsRef.current, uid]
          editedRef.current.add(uid) // picked by hand: drawn even if it looks like SFX
          setSel(blocksRef.current.length)
          commit([...blocksRef.current, { ...b, id: newId(), text: res.text, tr: res.tr || res.text, edited: true }])
        })
        .catch((err) => setRegionErr(String(err?.message ?? err)))
        .finally(() => {
          setBusy(false)
          setBand(null)
        })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ── Text style (stage 4) ──
  // The selected block's text and the part of it selected in its textarea.
  const styleTarget = (): { i: number; text: string; range: [number, number] | null } | null => {
    if (sel === null || !blocksRef.current[sel]) return null
    const uid = uidsRef.current[sel]
    const text = taRefs.current[uid]?.value ?? blocksRef.current[sel].tr
    const r = selRange.current
    return { i: sel, text, range: r && r.uid === uid && r.end > r.start && r.end <= text.length ? [r.start, r.end] : null }
  }
  // The style in effect: of the selected part (all of it), else the block's.
  const styleNow = (): TextStyle => {
    const t = styleTarget()
    if (!t) return {}
    const b = blocksRef.current[t.i]
    if (!t.range) return b.style ?? {}
    const chars = expandRuns(b.runs, t.text.length).slice(t.range[0], t.range[1])
    const out: TextStyle = { ...b.style }
    for (const k of STYLE_KEYS) {
      const vals = chars.map((c) => c[k] ?? b.style?.[k])
      ;(out as Record<string, unknown>)[k] = vals.every((v) => v === vals[0]) ? vals[0] : undefined
    }
    return out
  }
  // Apply to the selected part, else to the whole block (its runs lose those keys).
  const applyStyle = (patch: TextStyle, live = false): void => {
    const t = styleTarget()
    if (!t) return
    const b = blocksRef.current[t.i]
    let next: TransBlock
    if (t.range && !('align' in patch)) {
      const chars = expandRuns(b.runs, t.text.length)
      for (let k = t.range[0]; k < t.range[1]; k++) chars[k] = { ...chars[k], ...patch }
      next = { ...b, tr: t.text, runs: compressRuns(chars) }
    } else {
      const runs = b.runs?.map((r) => {
        const x = { ...r }
        for (const k of Object.keys(patch)) delete (x as Record<string, unknown>)[k]
        return x
      })
      const style = clean({ ...b.style, ...patch }) as TextStyle
      if (patch.align) style.align = patch.align
      next = { ...b, tr: t.text, style: Object.keys(style).length ? style : undefined, runs: compressRuns(expandRuns(runs, t.text.length)) }
    }
    editedRef.current.add(uidsRef.current[t.i])
    prevText.current[uidsRef.current[t.i]] = t.text
    const all = blocksRef.current.map((x, k) => (k === t.i ? { ...next, edited: true } : x))
    if (live) {
      blocksRef.current = all
      redrawLive()
    } else commit(all)
  }
  const toggleStyle = (k: 'bold' | 'italic' | 'underline' | 'strike'): void => applyStyle({ [k]: !styleNow()[k] })
  // Hovering a font in the list shows it on the text; leaving puts it back.
  const previewFont = (f: string | null): void => {
    if (f === null) {
      if (fontPreview.current) blocksRef.current = fontPreview.current
      fontPreview.current = null
      redrawLive()
      return
    }
    if (!fontPreview.current) fontPreview.current = blocksRef.current
    blocksRef.current = fontPreview.current
    applyStyle({ font: f || undefined }, true)
  }
  const pickFont = (f: string): void => {
    if (fontPreview.current) blocksRef.current = fontPreview.current
    fontPreview.current = null
    applyStyle({ font: f || undefined })
    if (!f) return
    const next = [f, ...recents.filter((x) => x !== f)].slice(0, RECENT_MAX)
    recentFonts.set(workKey, next)
    setRecents(next)
  }
  const bumpSize = (by: number): void => {
    const t = styleTarget()
    if (!t) return
    const fs = styleNow().size ?? blocksRef.current[t.i].size ?? 20
    applyStyle({ size: Math.max(6, Math.min(120, Math.round(fs + by))) })
  }
  // Format keys (as Photoshop's): Ctrl+B / I / U, Ctrl+Shift+/ strike,
  // Ctrl+Shift+L / C / R / J align, Ctrl+Shift+> / < size.
  const formatKey = (e: KeyboardEvent | React.KeyboardEvent): boolean => {
    if (stage !== 4 || sel === null || !(e.ctrlKey || e.metaKey) || e.altKey) return false
    const k = e.code
    const run = (f: () => void): boolean => {
      e.preventDefault()
      e.stopPropagation()
      f()
      return true
    }
    if (!e.shiftKey && k === 'KeyB') return run(() => toggleStyle('bold'))
    if (!e.shiftKey && k === 'KeyI') return run(() => toggleStyle('italic'))
    if (!e.shiftKey && k === 'KeyU') return run(() => toggleStyle('underline'))
    if (e.shiftKey && k === 'Slash') return run(() => toggleStyle('strike'))
    if (e.shiftKey && k === 'KeyL') return run(() => applyStyle({ align: 'left' }))
    if (e.shiftKey && k === 'KeyC') return run(() => applyStyle({ align: 'center' }))
    if (e.shiftKey && k === 'KeyR') return run(() => applyStyle({ align: 'right' }))
    if (e.shiftKey && k === 'KeyJ') return run(() => applyStyle({ align: 'justify' }))
    if (e.shiftKey && k === 'Period') return run(() => bumpSize(2))
    if (e.shiftKey && k === 'Comma') return run(() => bumpSize(-2))
    return false
  }

  // ── Keys ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)
      const combo = comboFromEvent(e)
      const keys = useStore.getState().settings.shortcuts
      if (combo && shortcutCombos(keys, 'transUndo').includes(combo) && !typing) {
        e.preventDefault()
        return undo()
      }
      if (combo && shortcutCombos(keys, 'transRedo').includes(combo) && !typing) {
        e.preventDefault()
        return redo()
      }
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && !e.altKey) {
        if (e.code === 'KeyS' && !e.shiftKey) {
          e.preventDefault()
          return save()
        }
        if (typing) return
        if (formatKey(e)) return
        if (e.code === 'KeyD' && !e.shiftKey) {
          e.preventDefault()
          return clearSelection()
        }
        if (e.code === 'KeyI' && e.shiftKey) {
          e.preventDefault()
          return setMaskOut((v) => !v)
        }
        if (e.code === 'KeyN' && e.shiftKey) {
          e.preventDefault()
          addPixLayer()
          return
        }
        if (e.code === 'Digit0') {
          e.preventDefault()
          setFit('contain')
          return setZoom(1)
        }
        if (e.code === 'Equal' || e.code === 'NumpadAdd') {
          e.preventDefault()
          return zoomAt(zoom * 1.25)
        }
        if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
          e.preventDefault()
          return zoomAt(zoom / 1.25)
        }
        return
      }
      if (typing || e.altKey || !ready) return
      const key = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.code
      const tk = TOOL_KEYS[(e.shiftKey ? 'shift+' : '') + key]
      if (tk) {
        if (toolStages(tk).includes(stage)) {
          e.preventDefault()
          setTool(tk)
        }
        return
      }
      if (/^Digit[1-4]$/.test(e.code)) return setStage(Number(e.code.slice(5)) as Stage)
      if (e.code === 'BracketLeft') return setBrushSize((v) => Math.max(1, Math.round(v / 1.2)))
      if (e.code === 'BracketRight') return setBrushSize((v) => Math.min(BRUSH_MAX, Math.max(v + 1, Math.round(v * 1.2))))
      if (e.key === 'Enter') {
        if (draft) return closeDraft()
        if (stage === 2 && selPts) return makeRegion()
      }
      // Delete: whatever is picked — the clicked selection, else the region, else
      // the selection being drawn, else the selected block (selections no one
      // picked stay).
      if (e.key === 'Delete') {
        e.preventDefault()
        if (draft) return setDraft(null)
        if (activeSel !== null) return removeSel(activeSel)
        if (selRegion && (stage === 2 || stage === 3)) return deleteRegion(selRegion)
        if (selPts && (stage === 2 || stage === 3)) return
        if (sel !== null) return del(sel)
        return
      }
      // Esc cancels a selection being drawn / unpicks; the selections stay
      // until removed (Delete, Ctrl+D).
      if (e.key === 'Escape' && (draft || selRegion || activeSel !== null)) {
        e.stopPropagation()
        if (draft) setDraft(null)
        else {
          setSelRegion(null)
          setActiveSel(null)
        }
        setWire(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  // The reader's page-flip wheel handler lives on an ancestor: stop it here.
  useEffect(() => {
    const el = overlayRef.current
    if (!el) return
    const stop = (e: WheelEvent): void => e.stopPropagation()
    el.addEventListener('wheel', stop, { passive: false })
    return () => el.removeEventListener('wheel', stop)
  }, [])

  // Mouse side buttons (3 = back, 4 = forward) → undo/redo while the editor is open.
  useEffect(() => {
    const onSide = (e: MouseEvent): void => {
      if (e.button !== 3 && e.button !== 4) return
      e.preventDefault()
      e.stopPropagation()
      if (e.type === 'mouseup') {
        if (e.button === 3) undo()
        else redo()
      }
    }
    window.addEventListener('mousedown', onSide, true)
    window.addEventListener('mouseup', onSide, true)
    window.addEventListener('auxclick', onSide, true)
    return () => {
      window.removeEventListener('mousedown', onSide, true)
      window.removeEventListener('mouseup', onSide, true)
      window.removeEventListener('auxclick', onSide, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Box drag (stage 4): the room its text is typeset in; only the text redraws.
  useEffect(() => {
    if (!dim) return
    const onMove = (e: MouseEvent): void => {
      const d = dragRef.current
      if (!d) return
      const dx = (e.clientX - d.sx) / dim.disp
      const dy = (e.clientY - d.sy) / dim.disp
      const o = d.orig
      let { x, y, w, h } = o
      const rot = ((blocksRef.current[d.i]?.rot ?? 0) * Math.PI) / 180
      if (d.mode === 'move') {
        x = o.x + dx
        y = o.y + dy
      } else if (rot) {
        // A turned box: the drag in the box's frame; the opposite corner stays put.
        const cos = Math.cos(rot)
        const sin = Math.sin(rot)
        const lx = dx * cos + dy * sin
        const ly = -dx * sin + dy * cos
        const west = d.mode === 'nw' || d.mode === 'sw'
        const north = d.mode === 'nw' || d.mode === 'ne'
        w = Math.max(6, west ? o.w - lx : o.w + lx)
        h = Math.max(6, north ? o.h - ly : o.h + ly)
        const ox = ((west ? -1 : 1) * (w - o.w)) / 2
        const oy = ((north ? -1 : 1) * (h - o.h)) / 2
        x = o.x + o.w / 2 + ox * cos - oy * sin - w / 2
        y = o.y + o.h / 2 + ox * sin + oy * cos - h / 2
      } else {
        if (d.mode === 'nw' || d.mode === 'sw') {
          x = o.x + dx
          w = o.w - dx
        }
        if (d.mode === 'ne' || d.mode === 'se') w = o.w + dx
        if (d.mode === 'nw' || d.mode === 'ne') {
          y = o.y + dy
          h = o.h - dy
        }
        if (d.mode === 'sw' || d.mode === 'se') h = o.h + dy
      }
      if (w < 6) w = 6
      if (h < 6) h = 6
      draggedRef.current = true
      const r = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
      blocksRef.current = patched(d.i, d.own ? r : { room: [r.x, r.y, r.w, r.h] })
      redrawLive()
    }
    const onUp = (): void => {
      const was = dragRef.current
      dragRef.current = null
      document.body.classList.remove('resizing')
      if (was && draggedRef.current) commit(blocksRef.current)
      draggedRef.current = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dim])
  const startDrag = (e: React.MouseEvent, i: number, mode: 'move' | Corner): void => {
    e.preventDefault()
    e.stopPropagation()
    setSel(i)
    const b = blocksRef.current[i]
    const own = !!b.bg
    const at = (own ? null : drawnRef.current.boxes[i]) ?? b
    draggedRef.current = false
    dragRef.current = { i, mode, sx: e.clientX, sy: e.clientY, orig: { x: at.x, y: at.y, w: at.w, h: at.h }, own }
    document.body.classList.add('resizing')
  }

  // Rotation handle drag: the angle round `c` (page px) since the press, in
  // degrees; Shift snaps the result to 15°.
  const startRot = (e: React.MouseEvent, c: Pt, apply: (deg: number, snap: boolean, done: boolean) => void): void => {
    e.preventDefault()
    e.stopPropagation()
    const wrap = (e.currentTarget as HTMLElement).closest('.ted-canvas-wrap')
    if (!wrap || !dim) return
    const r = wrap.getBoundingClientRect()
    const ang = (ev: { clientX: number; clientY: number }): number =>
      (Math.atan2(ev.clientY - (r.top + c.y * dim.disp), ev.clientX - (r.left + c.x * dim.disp)) * 180) / Math.PI
    const a0 = ang(e)
    let last = 0
    let snap = false
    let raf: number | null = null
    const move = (ev: MouseEvent): void => {
      last = ang(ev) - a0
      snap = ev.shiftKey
      if (raf == null)
        raf = requestAnimationFrame(() => {
          raf = null
          apply(last, snap, false)
        })
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      if (raf != null) cancelAnimationFrame(raf)
      document.body.classList.remove('resizing')
      apply(last, snap, true)
    }
    document.body.classList.add('resizing')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const turn = (deg: number, snap: boolean): number => {
    let v = snap ? Math.round(deg / 15) * 15 : Math.round(deg * 10) / 10
    v = ((v % 360) + 540) % 360 - 180
    return v
  }
  // A text box (stage 4): its text turns round the box's centre.
  const rotateBox = (e: React.MouseEvent, i: number, at: { x: number; y: number; w: number; h: number }): void => {
    setSel(i)
    const rot0 = blocksRef.current[i]?.rot ?? 0
    startRot(e, { x: at.x + at.w / 2, y: at.y + at.h / 2 }, (d, snap, done) => {
      const rot = turn(rot0 + d, snap)
      blocksRef.current = patched(i, { rot: rot || undefined })
      redrawLive()
      if (done && d) commit(blocksRef.current)
    })
  }
  // The picked selection (any stage) or bubble region (stages 2, 3): turned
  // round its box, removed by its × button.
  const picked = ((): { x: number; y: number; w: number; h: number } | null => {
    if (activeSel !== null && sels[activeSel]) {
      const xs = sels[activeSel].map((q) => q.x)
      const ys = sels[activeSel].map((q) => q.y)
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
    }
    if (stage !== 2 && stage !== 3) return null
    const r = selRegion ? regions.find((x) => x.id === selRegion) : null
    return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null
  })()
  // Stages 1, 4 have no selection tools: there the move tool picks a selection
  // by clicking it (its polygon takes the press).
  const selsClickable = (stage === 1 || stage === 4) && tool === 'move' && !picking
  const rotatePicked = (e: React.MouseEvent): void => {
    if (!picked || !size) return
    const c = { x: picked.x + picked.w / 2, y: picked.y + picked.h / 2 }
    if (activeSel !== null) {
      const k = activeSel
      const orig = sels[k]
      startRot(e, c, (d, snap) => {
        const deg = snap ? Math.round(d / 15) * 15 : d
        setSels((s) => s.map((q, j) => (j === k ? rotatePts(orig, deg) : q)))
      })
      return
    }
    const orig = regionsRef.current.find((x) => x.id === selRegion)
    if (!orig) return
    startRot(e, c, (d, snap, done) => {
      const deg = snap ? Math.round(d / 15) * 15 : d
      applyRegions(regionsRef.current.map((x) => (x.id === orig.id ? (deg ? rotateRegion(orig, deg, size.W, size.H) : orig) : x)))
      if (done && deg) pushHistory()
    })
  }

  // ── Render ──
  const painting = tool !== 'move' && !picking
  const st = stage === 4 ? styleNow() : {}
  const keep = (e: React.MouseEvent): void => e.preventDefault() // keep the textarea's selection
  const fmtBtn = (on: boolean | undefined, title: string, icon: ReactNode, f: () => void): JSX.Element => (
    <button className={`mini icon${on ? ' on' : ''}`} title={title} onMouseDown={keep} onClick={f} disabled={sel === null}>
      {icon}
    </button>
  )
  const sizeCtl = (
    <div className="ted-sizes" onPointerMove={(e) => setPeek({ x: e.clientX, y: e.clientY })} onPointerLeave={() => setPeek(null)}>
      {BRUSH_SIZES.map((s) => (
        <button key={s} className={`ted-size${brushSize === s ? ' on' : ''}`} onClick={() => setBrushSize(s)} title={`${s}px`}>
          {s}
        </button>
      ))}
      <input type="range" min={1} max={BRUSH_MAX} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} />
      <span className="ted-tool-val">{brushSize}px</span>
    </div>
  )

  const options: Record<Stage, ReactNode> = {
    1: (
      <div className="flat-group ted-actions">
        <button
          className={`mini${picking ? ' on' : ''}`}
          onClick={() => setPicking((v) => !v)}
          disabled={!ready}
          title="자동 번역이 놓친 글자를 끌어서 선택하면 그 부분만 인식·번역합니다 (로컬 OCR 모델 필요)"
        >
          <SelectIcon />
          {picking ? '영역 번역 끝내기' : '영역 번역'}
        </button>
        <button className="mini" onClick={() => void retranslateAll()} disabled={!ready || !!autoBusy} title="페이지 전체를 다시 인식·번역하고 문서를 새로 만듭니다 (실행 취소 가능)">
          <TranslateIcon />
          전체 다시 번역
        </button>
        <button
          className="mini"
          onClick={() => void retranslateSel()}
          disabled={!ready || !!autoBusy || sel === null || !blocks[sel]?.text.trim()}
          title="선택한 대사의 원문을 다시 번역합니다"
        >
          <RestartIcon />
          선택 영역 다시 번역
        </button>
      </div>
    ),
    2: (
      <div className="flat-group ted-actions">
        <button className="mini" onClick={() => void autoSelect()} disabled={!ready || !!autoBusy} title="자동으로 말풍선을 찾아 '자동 말풍선' 레이어를 새로 채웁니다">
          <AutoAwesomeIcon />
          자동 선택
        </button>
        <button className="mini" onClick={makeRegion} disabled={!selPts} title="선택 범위를 말풍선으로 (Enter)">
          <ChatBubbleIcon />
          말풍선으로 지정
        </button>
        <button className="mini" onClick={() => deleteRegion(selRegion)} disabled={!selRegion} title="선택한 말풍선 영역 삭제 (Delete)">
          <DeleteIcon />
          영역 삭제
        </button>
      </div>
    ),
    3: (
      <>
        <div className="flat-group ted-actions">
          <button className="mini" onClick={() => void autoInpaint()} disabled={!ready || !!autoBusy} title="원문 글자를 자동으로 지워 '자동 인페인팅' 레이어를 채웁니다 (마스크 안만) · 선택 영역이 마스크면 그 안을 통째로 주변 그림으로 채웁니다 (효과음 지우기)">
            <AutoAwesomeIcon />
            자동 인페인팅
          </button>
          <button className="mini" onClick={() => deleteRegion(selRegion)} disabled={!selRegion} title="선택한 말풍선 영역 삭제 (Delete)">
            <DeleteIcon />
            영역 삭제
          </button>
        </div>
        <div className="flat-group ted-actions" title="Ctrl+Shift+I로 전환">
          <button className={`mini${!maskOut ? ' on' : ''}`} onClick={() => setMaskOut(false)}>
            {activeSel !== null ? '이 선택 영역 안' : selRegion ? '이 말풍선 안' : selPts ? '선택 영역 안' : '말풍선 안'}
          </button>
          <button className={`mini${maskOut ? ' on' : ''}`} onClick={() => setMaskOut(true)}>
            <InvertColorsIcon />
            {activeSel !== null ? '이 선택 영역 밖' : selRegion ? '이 말풍선 밖' : selPts ? '선택 영역 밖' : '말풍선 밖'}
          </button>
        </div>
        <ColorButton
          title="브러시 색 — 누르면 마스크를 이 색으로 채웁니다"
          look="swatch"
          color={brushColor}
          opacity={brushAlpha}
          disabled={!selPts && !regions.length}
          onApply={() => {
            const m = toolMask()
            if (m) fillMask(m)
          }}
          onPreview={(p) => {
            if (p.color) setBrushColor(p.color)
            if (p.opacity !== undefined) setBrushAlpha(p.opacity)
          }}
          onCommit={(p) => {
            if (p.color) setBrushColor(p.color)
            if (p.opacity !== undefined) setBrushAlpha(p.opacity)
          }}
        />
        {sizeCtl}
        <label className="ted-tool-field" title="채우기: 이 차이까지의 색을 같은 범위로 봅니다">
          허용 범위
          <input type="range" min={0} max={128} value={tol} onChange={(e) => setTol(Number(e.target.value))} />
          <span className="ted-tool-val">{tol}</span>
        </label>
      </>
    ),
    4: (
      <>
        <FontPicker
          value={st.font ?? ''}
          fonts={fonts}
          favs={favFonts}
          recents={recents}
          disabled={sel === null}
          onToggleFav={(f) => {
            const next = favFonts.includes(f) ? favFonts.filter((x) => x !== f) : [...favFonts, f]
            setFavFonts(next)
            try {
              localStorage.setItem(FAV_KEY, JSON.stringify(next))
            } catch {
              /* not kept */
            }
          }}
          onPreview={previewFont}
          onPick={pickFont}
        />
        <span className="ted-tool-field" title="글자 크기 (Ctrl+Shift+> / <)">
          <Stepper value={Math.round(st.size ?? (sel !== null ? (blocks[sel]?.size ?? 20) : 20))} min={6} max={120} onChange={(v) => applyStyle({ size: v })} width={40} />
        </span>
        <ColorButton
          title="글자색"
          look="text"
          color={pen.color}
          opacity={pen.opacity}
          disabled={sel === null}
          onApply={() => applyStyle({ color: pen.color, opacity: pen.opacity < 1 ? pen.opacity : undefined, gradient: undefined })}
          onPreview={(p) => {
            const next = { ...pen, ...p }
            setPen(next)
            applyStyle({ color: next.color, opacity: next.opacity < 1 ? next.opacity : undefined, gradient: undefined }, true)
          }}
          onCommit={(p) => {
            const next = { ...pen, ...p }
            setPen(next)
            applyStyle({ color: next.color, opacity: next.opacity < 1 ? next.opacity : undefined, gradient: undefined })
          }}
        />
        <GradientButton
          value={st.gradient}
          saved={savedGrad}
          fallback={st.color ?? (sel !== null ? (drawnRef.current.inks[sel] ?? '#141414') : '#141414')}
          disabled={sel === null}
          onToggle={() =>
            applyStyle({
              gradient: st.gradient
                ? undefined
                : (savedGrad ?? {
                    angle: 90,
                    stops: [
                      { pos: 0, color: st.color ?? '#141414', alpha: 1 },
                      { pos: 1, color: '#ffffff', alpha: 1 }
                    ]
                  })
            })
          }
          opacity={st.opacity ?? 1}
          onPreview={(g, opacity) => applyStyle({ gradient: g, opacity: opacity < 1 ? opacity : undefined }, true)}
          onCommit={(g, opacity) => applyStyle({ gradient: g, opacity: opacity < 1 ? opacity : undefined })}
        />
        <OutlineButton
          on={st.outline !== false}
          width={st.outlineWidth ?? 3}
          color={st.outlineColor ?? (st.color && parseInt(st.color.slice(1, 3), 16) > 140 ? '#000000' : '#ffffff')}
          disabled={sel === null}
          onToggle={() => applyStyle({ outline: st.outline === false })}
          onPreview={(p) => applyStyle({ ...p, outline: true }, true)}
          onCommit={(p) => applyStyle({ ...p, outline: true })}
        />
        <div className="flat-group ted-actions">
          {fmtBtn((st.align ?? 'center') === 'justify', '양쪽 정렬 (Ctrl+Shift+J)', <FormatAlignJustifyIcon />, () => applyStyle({ align: 'justify' }))}
          {fmtBtn(st.align === 'left', '왼쪽 정렬 (Ctrl+Shift+L)', <FormatAlignLeftIcon />, () => applyStyle({ align: 'left' }))}
          {fmtBtn((st.align ?? 'center') === 'center', '가운데 정렬 (Ctrl+Shift+C)', <FormatAlignCenterIcon />, () => applyStyle({ align: 'center' }))}
          {fmtBtn(st.align === 'right', '오른쪽 정렬 (Ctrl+Shift+R)', <FormatAlignRightIcon />, () => applyStyle({ align: 'right' }))}
        </div>
        <div className="flat-group ted-actions">
          {fmtBtn(st.bold, '진하게 (Ctrl+B)', <FormatBoldIcon />, () => toggleStyle('bold'))}
          {fmtBtn(st.italic, '기울임 (Ctrl+I)', <FormatItalicIcon />, () => toggleStyle('italic'))}
          {fmtBtn(st.underline, '밑줄 (Ctrl+U)', <FormatUnderlinedIcon />, () => toggleStyle('underline'))}
          {fmtBtn(st.strike, '취소선 (Ctrl+Shift+/)', <FormatStrikethroughIcon />, () => toggleStyle('strike'))}
          <button
            className="mini ted-clear-fmt"
            onMouseDown={keep}
            disabled={sel === null}
            title="이 대사의 서식을 모두 지웁니다"
            onClick={() => {
              if (sel === null) return
              editedRef.current.add(uidsRef.current[sel])
              commit(blocksRef.current.map((b, k) => (k === sel ? { ...b, style: undefined, runs: undefined, edited: true } : b)))
            }}
          >
            서식 지우기
          </button>
        </div>
      </>
    )
  }

  const layerIcon = (l: TransLayer): ReactNode => (l.kind === 'bubbles' ? <ChatBubbleIcon /> : l.kind === 'text' ? <TextFieldsIcon /> : <BrushIcon />)
  const regionCount = (id?: string): number => (id ? regions.filter((r) => r.blocks.includes(id)).length : 0)

  const panel = (
    <div
      className={`ted ted-staged${embedded ? ' ted-embedded' : ''}`}
      ref={embedded ? overlayRef : undefined}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="ted-head">
        <b>번역 편집</b>
        <div className="flat-group ted-stages">
          {STAGES.map(([s, label, icon]) => (
            <button key={s} className={`mini${stage === s ? ' on' : ''}`} onClick={() => setStage(s)} title={`${label} (${s}) — ${STAGE_HINT[s]}`}>
              {icon}
              {s}. {label}
            </button>
          ))}
        </div>
        <span className="ted-spacer" />
        <div className="flat-group ted-actions">
          <button className="mini" onClick={() => onSave(null, {})} title="편집을 모두 버리고 자동 번역으로 되돌립니다">
            <RestartIcon />
            자동으로 되돌리기
          </button>
          <button className="mini" onClick={() => void resetDoc()} disabled={!ready || !!autoBusy} title="이 페이지에서 작업한 내용을 모두 지우고 처음 상태로 돌립니다 (실행 취소 가능)">
            <DeleteSweepIcon />
            초기화
          </button>
          {headExtra}
          <button className="mini" onClick={onClose}>
            {closeLabel}
          </button>
          <button className="mini on" onClick={save} disabled={!ready} title="저장 (Ctrl+S)">
            {saveLabel}
          </button>
        </div>
      </div>

      <div className="ted-tools">
        <div className="flat-group ted-actions">
          <button className="mini icon" onClick={undo} disabled={!canUndo} title="실행 취소 (Ctrl+Z)">
            <UndoIcon />
          </button>
          <button className="mini icon" onClick={redo} disabled={!canRedo} title="다시 실행 (Ctrl+Shift+Z)">
            <RedoIcon />
          </button>
          <button
            className="mini icon"
            onClick={onZoomButton}
            title={`${atFit ? FIT_TEXT[fit] : `${Math.round(zoom * 100)}%`} — 화면 맞춤 전환 · Ctrl+휠 / Ctrl+= / Ctrl+- 확대·축소 · Ctrl+0 맞춤`}
          >
            {FIT_ICON[fit]}
          </button>
        </div>
        {options[stage]}
        {stage === 1 && transExtra && <div className="flat-group ted-actions">{transExtra}</div>}
        <span className="ted-hint">{autoBusy ?? toolMsg ?? ''}</span>
        {stage === 1 && (
          <span className="ted-tools-end ted-model" title="현재 번역 모델 (설정 › 번역)">
            {modelLabel}
          </span>
        )}
        {stage === 4 && (
          <div className="flat-group ted-actions ted-tools-end">
            <button className="mini" onClick={addBlock} disabled={!ready}>
              <AddIcon />
              글 상자 추가
            </button>
          </div>
        )}
      </div>

      <div className="ted-body">
        <div className="ted-toolbar">
          {TOOL_GROUPS.map((g) => (
            <div key={g.name} className="ted-tgroup" title={g.name}>
              {g.tools.map(([t, icon, label, key]) => (
                <button
                  key={t}
                  className={`ted-tbtn${tool === t ? ' on' : ''}`}
                  onClick={() => setTool(t)}
                  disabled={!ready || !g.stages.includes(stage)}
                  title={`${label} (${key})${TOOL_HINT[t] ? ` — ${TOOL_HINT[t]}` : ''}`}
                >
                  {icon}
                  {t === 'grad' && savedGrad && <span className="ted-tbtn-grad" style={{ background: gradientCss(savedGrad) }} />}
                </button>
              ))}
              {g.name === '범위 선택' && (
                <button className="ted-tbtn" onClick={clearSelection} disabled={!selPts || !g.stages.includes(stage)} title="선택 해제 (Ctrl+D)">
                  <DeselectIcon />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="ted-canvas-scroll" ref={scrollRef}>
          {dim && ready ? (
            <div
              className={`ted-canvas-wrap${picking ? ' picking' : ''}${painting ? ` tooling tool-${tool}` : ''} stage-${stage}`}
              style={{ width: dim.W * dim.disp, height: dim.H * dim.disp }}
              onMouseDown={picking ? startBand : onToolDown}
              onMouseMove={painting ? onToolMove : undefined}
              onMouseLeave={() => setHover(null)}
              onDoubleClick={painting ? closeDraft : undefined}
            >
              <div className="ted-stack" ref={stackRef} />
              <svg className="ted-sel" viewBox={`0 0 ${dim.W} ${dim.H}`} preserveAspectRatio="none">
                {sels.map((pts, k) => (
                  <polygon
                    key={k}
                    className={`ted-ants${activeSel === k ? ' on' : ''}${selsClickable ? ' pickable' : ''}`}
                    points={pts.map((q) => `${q.x},${q.y}`).join(' ')}
                    onMouseDown={
                      selsClickable
                        ? (e) => {
                            if (e.button !== 0) return
                            e.preventDefault()
                            e.stopPropagation()
                            setActiveSel(k)
                          }
                        : undefined
                    }
                  />
                ))}
                {draft && (
                  <polyline
                    className="ted-ants"
                    points={[...draft, ...(tool === 'magnet' ? (wire ?? []) : hover && tool === 'poly' ? [hover] : [])].map((q) => `${q.x},${q.y}`).join(' ')}
                  />
                )}
                {tool === 'heal' && healSrc && (
                  <g className="ted-heal-src">
                    {(() => {
                      // Aligned: once a stroke set the offset, the source rides with the cursor.
                      const at = healOff.current && hover ? { x: hover.x + healOff.current.dx, y: hover.y + healOff.current.dy } : healSrc
                      return (
                        <>
                          <circle cx={at.x} cy={at.y} r={brushSize / 2} />
                          <line x1={at.x - 6 / dim.disp} y1={at.y} x2={at.x + 6 / dim.disp} y2={at.y} />
                          <line x1={at.x} y1={at.y - 6 / dim.disp} x2={at.x} y2={at.y + 6 / dim.disp} />
                        </>
                      )
                    })()}
                  </g>
                )}
              </svg>
              {hover && (tool === 'brush' || tool === 'erase' || tool === 'heal') && (
                <div className="ted-brush" style={{ left: hover.x * dim.disp, top: hover.y * dim.disp, width: brushSize * dim.disp, height: brushSize * dim.disp }} />
              )}
              {/* Stage 1: the OCR boxes (click = its row). Stage 4: where each
                  translation was drawn, to move / resize. */}
              {stage === 1 &&
                blocks.map((b, i) => (
                  <div
                    key={i}
                    className={`ted-box ted-ocr ${sel === i ? 'sel' : ''}`}
                    style={{ left: b.x * dim.disp, top: b.y * dim.disp, width: b.w * dim.disp, height: b.h * dim.disp }}
                    onMouseDown={(e) => {
                      if (picking) return
                      e.stopPropagation()
                      setSel(i)
                    }}
                  >
                    <span className="ted-box-n">{i + 1}</span>
                  </div>
                ))}
              {stage === 4 &&
                blocks.map((b, i) => {
                  const drawn = drawnRef.current.boxes[i]
                  if (drawn === null && !b.bg) return null
                  const at = b.bg || !drawn ? { ...b, skip: false } : drawn
                  const nums = drawnRef.current.lead.flatMap((l, k) => (l === i ? [k + 1] : []))
                  return (
                    <div
                      key={i}
                      className={`ted-box ${sel === i ? 'sel' : ''} ${at.skip ? 'skip' : ''}`}
                      title={at.skip ? '효과음으로 보고 그대로 둔 글자 · 번역을 고치면 그려집니다' : undefined}
                      style={{
                        left: at.x * dim.disp,
                        top: at.y * dim.disp,
                        width: at.w * dim.disp,
                        height: at.h * dim.disp,
                        transform: blocksRef.current[i]?.rot ? `rotate(${blocksRef.current[i].rot}deg)` : undefined
                      }}
                      onMouseDown={(e) => startDrag(e, i, 'move')}
                    >
                      <span className="ted-box-n">{nums.length > 1 ? nums.join('+') : i + 1}</span>
                      {CORNERS.map((c) => (
                        <span key={c} className={`ted-handle ${c}`} onMouseDown={(e) => startDrag(e, i, c)} />
                      ))}
                      <span className="ted-rot" title="끌어서 회전 · Shift: 15° 단위" onMouseDown={(e) => rotateBox(e, i, at)} />
                    </div>
                  )
                })}
              {picked && (
                <div
                  className="ted-rot-wrap"
                  style={{ left: picked.x * dim.disp, top: picked.y * dim.disp, width: picked.w * dim.disp, height: picked.h * dim.disp }}
                >
                  <span className="ted-rot" title="끌어서 회전 · Shift: 15° 단위" onMouseDown={rotatePicked} />
                  <button
                    className="ted-sel-del"
                    title={activeSel !== null ? '이 선택 영역 삭제 (Delete)' : '이 말풍선 삭제 (Delete)'}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => (activeSel !== null ? removeSel(activeSel) : deleteRegion(selRegion))}
                  >
                    <CloseIcon />
                  </button>
                </div>
              )}
              {band && (
                <div className={`ted-band${busy ? ' busy' : ''}`} style={{ left: band.x * dim.disp, top: band.y * dim.disp, width: band.w * dim.disp, height: band.h * dim.disp }}>
                  {busy && <span>인식 중…</span>}
                </div>
              )}
            </div>
          ) : (
            <div className="ted-loading">{busyMsg ?? '불러오는 중…'}</div>
          )}
        </div>

        <div className="ted-side">
          <div className="ted-list">
            {regionErr && <div className="ted-err">{regionErr}</div>}
            {ready && blocks.length === 0 && <div className="ted-empty">편집할 대사가 없습니다.</div>}
            {blocks.map((b, i) => (
              <div key={uidsRef.current[i]} className={`ted-row ${sel === i ? 'sel' : ''}`} onClick={() => setSel(i)}>
                <div className="ted-row-head">
                  <span className="ted-idx">{i + 1}</span>
                  {stage === 2 && <span className="ted-label">말풍선 {regionCount(b.id)}</span>}
                  {stage === 2 && selRegion && (
                    <button
                      className="mini"
                      onClick={(e) => {
                        e.stopPropagation()
                        linkRegion(i)
                      }}
                      title="선택한 말풍선에 이 대사를 넣습니다"
                    >
                      선택한 말풍선에 연결
                    </button>
                  )}
                  <span className="ted-spacer" />
                  <div className="flat-group ted-actions">
                    <button className="mini ted-del" onClick={() => del(i)} title="대사 삭제">
                      <CloseIcon />
                    </button>
                  </div>
                </div>
                {b.text && (
                  <div className="ted-field">
                    <span className="ted-label">원문</span>
                    <div className="ted-src">{b.text}</div>
                  </div>
                )}
                {b.text && <span className="ted-label">번역</span>}
                {/* Uncontrolled + stable key: typing touches only the DOM (no
                    setState), so re-renders never cancel Korean IME. */}
                <textarea
                  className="ted-tr"
                  ref={(el) => {
                    const uid = uidsRef.current[i]
                    taRefs.current[uid] = el
                    if (el && prevText.current[uid] === undefined) prevText.current[uid] = el.value
                    if (el) {
                      el.style.height = 'auto'
                      el.style.height = `${el.scrollHeight}px`
                    }
                  }}
                  defaultValue={b.tr}
                  rows={2}
                  placeholder="번역 내용"
                  onFocus={() => setSel(i)}
                  onSelect={(e) => noteSel(i, e.currentTarget)}
                  onMouseUp={(e) => noteSel(i, e.currentTarget)}
                  onKeyUp={(e) => noteSel(i, e.currentTarget)}
                  onKeyDown={(e) => {
                    if (formatKey(e)) return
                    // The editor's undo/redo, not the textarea's: blur first so the
                    // edit lands in history.
                    if (!(e.ctrlKey || e.metaKey)) return
                    const k = e.key.toLowerCase()
                    if (k !== 'z' && k !== 'y') return
                    e.preventDefault()
                    e.stopPropagation()
                    e.currentTarget.blur()
                    if (k === 'z' && !e.shiftKey) undo()
                    else redo()
                  }}
                  onCompositionStart={() => {
                    composingRef.current = true
                  }}
                  onCompositionEnd={(e) => {
                    composingRef.current = false
                    onTyped(i, e.currentTarget)
                  }}
                  onInput={(e) => onTyped(i, e.currentTarget)}
                  onBlur={(e) => {
                    // Emptied → remove the block (an empty textarea takes no IME input).
                    const v = e.currentTarget.value
                    if (v.trim() === '') del(i)
                    else if (v !== histRef.current[hiRef.current]?.blocks[i]?.tr || blocksRef.current[i]?.runs !== histRef.current[hiRef.current]?.blocks[i]?.runs)
                      commit(patched(i, { tr: v }))
                  }}
                />
              </div>
            ))}
          </div>

          <div className="ted-layers">
            <div className="ted-layers-head">
              <LayersIcon />
              <b>레이어</b>
              <span className="ted-spacer" />
              <div className="flat-group ted-actions">
                <button className="mini icon" onClick={addPixLayer} disabled={!ready} title="새 레이어 (Ctrl+Shift+N)">
                  <AddIcon />
                </button>
                <button className="mini icon" onClick={() => moveLayer(activeId, -1)} disabled={layers.findIndex((l) => l.id === activeId) <= 0} title="위로">
                  <ArrowUpwardIcon />
                </button>
                <button
                  className="mini icon"
                  onClick={() => moveLayer(activeId, 1)}
                  disabled={(() => {
                    const k = layers.findIndex((l) => l.id === activeId)
                    return k < 0 || k >= layers.length - 1
                  })()}
                  title="아래로"
                >
                  <ArrowDownwardIcon />
                </button>
                <button className="mini icon" onClick={() => deleteLayer(activeId)} disabled={layerOf(activeId)?.kind === 'text' || !layerOf(activeId)} title="레이어 삭제">
                  <DeleteIcon />
                </button>
              </div>
            </div>
            <div className="ted-layer-list">
              {layers.map((l) => (
                <div key={l.id} className={`ted-layer-row${activeId === l.id ? ' on' : ''}`} onClick={() => setActiveId(l.id)}>
                  <button
                    className="ted-eye"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleLayer(l.id)
                    }}
                    title={l.visible ? '숨기기' : '보이기'}
                  >
                    {l.visible ? <VisibilityIcon /> : <VisibilityOffIcon />}
                  </button>
                  {layerIcon(l)}
                  <span className="ted-layer-name">{l.name}</span>
                  {l.auto && <span className="ted-layer-tag">자동</span>}
                  {l.kind === 'bubbles' && <span className="ted-layer-tag">{regions.filter((r) => r.layer === l.id).length}</span>}
                </div>
              ))}
              <div className="ted-layer-row base">
                <span className="ted-eye" />
                <span className="ted-layer-name">원본 이미지</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      {peek && dim && (
        <div className="ted-peek" style={{ left: peek.x, top: peek.y, width: brushSize * dim.disp, height: brushSize * dim.disp }} />
      )}
    </div>
  )

  // The part of a translation selected in its textarea (what formatting goes to).
  function noteSel(i: number, el: HTMLTextAreaElement): void {
    selRange.current = { uid: uidsRef.current[i], start: el.selectionStart, end: el.selectionEnd }
  }

  // Typing: runs follow the edit, the text redraws (no setState: IME-safe).
  function onTyped(i: number, el: HTMLTextAreaElement): void {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
    const uid = uidsRef.current[i]
    editedRef.current.add(uid)
    const b = blocksRef.current[i]
    const prev = prevText.current[uid] ?? b.tr
    if (b.runs?.length && prev !== el.value) blocksRef.current = blocksRef.current.map((x, k) => (k === i ? { ...x, runs: shiftRuns(x.runs, prev, el.value) } : x))
    prevText.current[uid] = el.value
    redrawLive()
  }

  if (embedded) return panel
  return (
    <div
      ref={overlayRef}
      className="ted-overlay"
      onMouseDown={onClose}
      // Swallow clicks so a paged/spread reader underneath doesn't flip pages.
      onClick={(e) => e.stopPropagation()}
    >
      {panel}
    </div>
  )
}
