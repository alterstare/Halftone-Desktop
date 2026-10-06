// 동인지 잠금: PIN required to enter doujin mode, plus an optional decoy PIN
// that opens an empty doujin library. Only salted hashes are stored.
import { useState } from 'react'
import type { JSX } from 'react'
import SettingRow from '../SettingRow'
import Toggle from '../Toggle'
import { useSettings } from './context'
import { hashPin, newSalt, useLock } from '../../lock'

const EMPTY = { enabled: false, pinHash: '', decoyHash: '', salt: '' }
const valid = (p: string): boolean => /^\d{4,8}$/.test(p)

export default function LockSection(): JSX.Element | null {
  const { draft, patch } = useSettings()
  const decoy = useLock((s) => s.decoy)
  const lock = draft.doujinLock ?? EMPTY
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [fake, setFake] = useState('')
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null)

  // Never reveal (or allow changing) the lock from inside the decoy library.
  if (decoy) return null

  const digits = (v: string): string => v.replace(/\D/g, '').slice(0, 8)

  const savePin = async (): Promise<void> => {
    if (!valid(pin)) return setMsg({ text: 'PIN은 숫자 4~8자리로 입력하세요.', err: true })
    if (pin !== pin2) return setMsg({ text: 'PIN 확인이 일치하지 않습니다.', err: true })
    const salt = lock.salt || newSalt()
    const pinHash = await hashPin(pin, salt)
    if (lock.decoyHash && pinHash === lock.decoyHash)
      return setMsg({ text: '가짜 PIN과 같은 번호는 쓸 수 없습니다.', err: true })
    patch({ doujinLock: { ...lock, salt, pinHash, enabled: true } })
    setPin('')
    setPin2('')
    setMsg({ text: 'PIN이 설정되었습니다. 아래 “저장”을 눌러 적용하세요.' })
  }

  const saveFake = async (): Promise<void> => {
    if (!lock.pinHash) return setMsg({ text: '먼저 PIN을 설정하세요.', err: true })
    if (!valid(fake)) return setMsg({ text: '가짜 PIN은 숫자 4~8자리로 입력하세요.', err: true })
    const decoyHash = await hashPin(fake, lock.salt)
    if (decoyHash === lock.pinHash) return setMsg({ text: '진짜 PIN과 다른 번호를 입력하세요.', err: true })
    patch({ doujinLock: { ...lock, decoyHash } })
    setFake('')
    setMsg({ text: '가짜 PIN이 설정되었습니다. 아래 “저장”을 눌러 적용하세요.' })
  }

  return (
    <section data-cat="manage">
      <h2>동인지 잠금</h2>
      <SettingRow
        title="동인지 모드 잠금"
        desc="동인지 모드로 들어갈 때마다 PIN을 묻습니다. 일반 만화 모드로 나가면 다시 잠깁니다."
      >
        <Toggle
          checked={!!lock.enabled && !!lock.pinHash}
          onChange={(v) => {
            if (v && !lock.pinHash) return setMsg({ text: '먼저 아래에서 PIN을 설정하세요.', err: true })
            patch({ doujinLock: { ...lock, enabled: v } })
          }}
        />
      </SettingRow>
      <div className="set-block">
        <SettingRow title={lock.pinHash ? 'PIN 변경' : 'PIN 설정'} desc="숫자 4~8자리." />
        <div className="lock-fields">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            className="field-input"
            placeholder="새 PIN"
            value={pin}
            onChange={(e) => setPin(digits(e.target.value))}
          />
          <input
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            className="field-input"
            placeholder="PIN 확인"
            value={pin2}
            onChange={(e) => setPin2(digits(e.target.value))}
            onKeyDown={(e) => e.key === 'Enter' && void savePin()}
          />
          <div className="flat-group">
            <button className="mini" onClick={() => void savePin()}>
              {lock.pinHash ? 'PIN 변경' : 'PIN 설정'}
            </button>
          </div>
        </div>
      </div>
      <div className="set-block">
        <SettingRow
          title="가짜 PIN"
          desc={`이 번호를 입력하면 동인지 작품이 하나도 없는 빈 라이브러리가 열립니다. 그 상태에서는 이 잠금 설정도 보이지 않습니다.${lock.decoyHash ? ' (설정됨)' : ''}`}
        />
        <div className="lock-fields">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            className="field-input"
            placeholder="가짜 PIN"
            value={fake}
            onChange={(e) => setFake(digits(e.target.value))}
            onKeyDown={(e) => e.key === 'Enter' && void saveFake()}
          />
          <div className="flat-group">
            <button className="mini" onClick={() => void saveFake()}>
              {lock.decoyHash ? '가짜 PIN 변경' : '가짜 PIN 설정'}
            </button>
            {lock.decoyHash && (
              <button className="mini" onClick={() => patch({ doujinLock: { ...lock, decoyHash: '' } })}>
                가짜 PIN 삭제
              </button>
            )}
          </div>
        </div>
      </div>
      {msg && <p className={`hint ${msg.err ? 'lock-err' : ''}`}>{msg.text}</p>}
    </section>
  )
}
