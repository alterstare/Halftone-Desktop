// Small building blocks shared by the settings sections, so every box row looks
// and behaves the same.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX, ReactNode } from 'react'
import SettingRow from '../SettingRow'
import { useSettings } from './context'
import { CloseIcon } from '../icons'

// Mutually-exclusive choice rendered as description cards: one card per option
// with a title, optional badge and a per-option description.
export function RadioCards<T extends string>({
  value,
  onChange,
  options
}: {
  value: T
  onChange: (v: T) => void
  options: { val: T; label: string; desc?: string; badge?: string }[]
}): JSX.Element {
  return (
    <div className="rcards">
      {options.map((o) => (
        <button
          key={o.val}
          type="button"
          className={`rcard ${value === o.val ? 'on' : ''}`}
          onClick={() => onChange(o.val)}
        >
          <span className="rcard-dot" />
          <span className="rcard-body">
            <span className="rcard-title">
              {o.label}
              {o.badge && <span className="rcard-badge">{o.badge}</span>}
            </span>
            {o.desc && <span className="rcard-desc">{o.desc}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}

// 열기 / 갱신 buttons for a registered folder (갱신 only when it belongs to a
// library mode, i.e. can be rescanned).
function FolderButtons({ path, mode }: { path: string; mode: 'doujin' | 'normal' | null }): JSX.Element {
  const { rescanning, rescan } = useSettings()
  return (
    <>
      <button className="mini" onClick={() => window.api.openFolder(path)}>
        열기
      </button>
      {mode && (
        <button className="mini" disabled={rescanning === path} onClick={() => rescan(path, mode)}>
          {rescanning === path ? '갱신 중…' : '갱신'}
        </button>
      )}
    </>
  )
}

// A list of folders: an add row plus one path line per folder.
export function RootList({
  title,
  desc,
  roots,
  onAdd,
  onRemove,
  mode,
  addLabel = '+ 폴더 추가',
  onAddNas
}: {
  title: string
  desc: string
  roots: string[]
  onAdd: () => void
  onRemove: (r: string) => void
  mode: 'doujin' | 'normal'
  addLabel?: string
  // Adds a NAS (SMB) folder: gets the UNC path from the NAS dialog.
  onAddNas?: (path: string) => void
}): JSX.Element {
  const [nasOpen, setNasOpen] = useState(false)
  return (
    <div className="set-block">
      <SettingRow title={title} desc={desc}>
        <div className="flat-group">
          <button className="mini" onClick={onAdd}>
            {addLabel}
          </button>
          {onAddNas && (
            <button className="mini" onClick={() => setNasOpen(true)}>
              + NAS (SMB)
            </button>
          )}
        </div>
      </SettingRow>
      {nasOpen && onAddNas && (
        <NasDialog
          onClose={() => setNasOpen(false)}
          onAdded={(p) => {
            onAddNas(p)
            setNasOpen(false)
          }}
        />
      )}
      {roots.map((r) => (
        <div className="path-item" key={r}>
          <code>{r}</code>
          <FolderButtons path={r} mode={mode} />
          <button className="mini danger" onClick={() => onRemove(r)}>
            제거
          </button>
        </div>
      ))}
      {roots.length === 0 && <div className="path-item empty">등록된 폴더 없음</div>}
    </div>
  )
}

// NAS (SMB) folder: address + optional login. The login is saved in Windows
// (Credential Manager), not in the app; the folder becomes a \\nas\share path.
function NasDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (path: string) => void }): JSX.Element {
  const [address, setAddress] = useState('')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const connect = async (): Promise<void> => {
    if (!address.trim() || busy) return
    setBusy(true)
    setErr(null)
    try {
      const r = await window.api.smbConnect({ address, user, password })
      if (r.ok && r.path) onAdded(r.path)
      else setErr(r.error ?? '연결 실패')
    } finally {
      setBusy(false)
    }
  }
  const enter = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') void connect()
  }
  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal nas-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>NAS 폴더 추가 (SMB)</h2>
        </div>
        <p className="hint">
          NAS의 공유 폴더 주소를 입력하세요. 계정 정보는 앱이 아니라 윈도우 자격 증명에 저장되고, 추가된 폴더는 일반
          폴더처럼 스캔·감상·이동·다운로드에 쓰입니다.
        </p>
        <label className="nas-field">
          <span>주소</span>
          <input
            className="field-input"
            autoFocus
            value={address}
            placeholder="\\NAS이름\공유폴더\만화  (또는 smb://192.168.0.10/공유폴더/만화)"
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={enter}
          />
        </label>
        <div className="nas-row">
          <label className="nas-field">
            <span>사용자 이름 (선택)</span>
            <input className="field-input" value={user} onChange={(e) => setUser(e.target.value)} onKeyDown={enter} />
          </label>
          <label className="nas-field">
            <span>비밀번호</span>
            <input
              className="field-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={enter}
            />
          </label>
        </div>
        <div className="nas-foot">
          <span className={`hint ${err ? 'nas-err' : ''}`}>{busy ? '연결하는 중…' : (err ?? '')}</span>
          <div className="flat-group">
            <button className="mini" onClick={onClose}>
              취소
            </button>
            <button className="mini on" onClick={() => void connect()} disabled={busy || !address.trim()}>
              연결하고 추가
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// A single optional folder: title/desc row with a 선택 button, then the path
// (with 해제 when `onClear` is given).
export function FolderRow({
  title,
  desc,
  path,
  onPick,
  onClear,
  mode
}: {
  title: string
  desc: string
  path: string | null | undefined
  onPick: () => void
  onClear?: () => void
  mode: 'doujin' | 'normal' | null
}): JSX.Element {
  return (
    <div className="set-block">
      <SettingRow title={title} desc={desc}>
        <button className="mini" onClick={onPick}>
          선택
        </button>
      </SettingRow>
      {path ? (
        <div className="path-item">
          <code>{path}</code>
          <FolderButtons path={path} mode={mode} />
          {onClear && (
            <button className="mini danger" onClick={onClear}>
              해제
            </button>
          )}
        </div>
      ) : (
        <div className="path-item empty">(미지정)</div>
      )}
    </div>
  )
}

// Removable chips for a string list setting (favorite tags, exclude tags…).
export function ChipList({
  items,
  onRemove,
  label = (s) => s,
  chipClass = 'tag'
}: {
  items: string[]
  onRemove: (s: string) => void
  label?: (s: string) => ReactNode
  chipClass?: string
}): JSX.Element | null {
  if (!items.length) return null
  return (
    <div className="taglist">
      {items.map((s) => (
        <span key={s} className={chipClass}>
          {label(s)}
          <span className="tag-x" onClick={() => onRemove(s)}>
            <CloseIcon />
          </span>
        </span>
      ))}
    </div>
  )
}
