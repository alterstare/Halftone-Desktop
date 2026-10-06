import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { cancelPin, tryPin, useLock } from '../lock'

// Full-window PIN prompt shown when doujin mode is locked. Five wrong tries
// pause input for 30 seconds.
export default function LockPrompt(): JSX.Element | null {
  const prompt = useLock((s) => s.prompt)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [shake, setShake] = useState(0)
  const [fails, setFails] = useState(0)
  const [waitUntil, setWaitUntil] = useState(0)
  const [now, setNow] = useState(Date.now())
  const inputRef = useRef<HTMLInputElement>(null)
  const waiting = waitUntil > now

  useEffect(() => {
    if (!prompt) return
    setPin('')
    setErr(null)
    setTimeout(() => inputRef.current?.focus(), 30)
  }, [prompt])
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [waiting])

  if (!prompt) return null

  const submit = async (): Promise<void> => {
    if (waiting || pin.length < 4) return
    const r = await tryPin(pin)
    if (r !== 'wrong') {
      setFails(0)
      return
    }
    const n = fails + 1
    setFails(n)
    setPin('')
    setShake((s) => s + 1)
    if (n >= 5) {
      setWaitUntil(Date.now() + 30_000)
      setNow(Date.now())
      setFails(0)
      setErr('5번 틀렸습니다. 30초 뒤에 다시 시도하세요.')
    } else setErr('PIN이 올바르지 않습니다.')
  }

  return createPortal(
    <div className="lock-overlay" onMouseDown={(e) => e.stopPropagation()}>
      <div className="lock-box" key={shake} data-shake={shake > 0}>
        <svg className="lock-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 22q-.825 0-1.412-.587T4 20V10q0-.825.588-1.412T6 8h1V6q0-2.075 1.463-3.537T12 1t3.538 1.463T17 6v2h1q.825 0 1.413.588T20 10v10q0 .825-.587 1.413T18 22zm6-5q.825 0 1.413-.587T14 15t-.587-1.412T12 13t-1.412.588T10 15t.588 1.413T12 17M9 8h6V6q0-1.25-.875-2.125T12 3t-2.125.875T9 6z" />
        </svg>
        <h2>동인지 잠금</h2>
        <p className="hint">PIN을 입력하세요</p>
        <input
          ref={inputRef}
          className="lock-input"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          value={pin}
          disabled={waiting}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, ''))
            setErr(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
            if (e.key === 'Escape') cancelPin()
          }}
        />
        <div className={`lock-msg ${err ? 'err' : ''}`}>
          {waiting ? `${Math.ceil((waitUntil - now) / 1000)}초 뒤에 다시 시도하세요` : (err ?? ' ')}
        </div>
        <div className="flat-group">
          <button className="mini" onClick={cancelPin}>
            취소
          </button>
          <button className="mini on" onClick={() => void submit()} disabled={waiting || pin.length < 4}>
            확인
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
