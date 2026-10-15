import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import { embedded } from '../embed'
import type { AppInfo, SubMode } from '../../../shared/types'
import { addLibraryFolder } from './Library'
import { AddIcon, CheckIcon, CloseIcon, CloudDownloadIcon, DeleteIcon, EditIcon, FolderOpenIcon, RefreshIcon } from './icons'
import { Confirm, Stepper } from './ui'
import ShortcutSettings from './ShortcutSettings'
import AutoSubSettings from './AutoSubSettings'

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="set-row">
      <div>
        <div className="set-label">{label}</div>
        {hint && <div className="hint set-hint">{hint}</div>}
      </div>
      <div className="set-ctl">{children}</div>
    </div>
  )
}

function Seg<T extends string | number>({ value, options, onChange }: { value: T | undefined; options: [T, string][]; onChange: (v: T) => void }): JSX.Element {
  return (
    <div className="flat-group">
      {options.map(([v, label]) => (
        <button key={String(v)} className={`mini ${value === v ? 'on' : ''}`} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}

function Groups(): JSX.Element {
  const groups = useStore((s) => s.groups)
  const [editing, setEditing] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [del, setDel] = useState<number | null>(null)
  const st = useStore.getState
  const reload = async (): Promise<void> => {
    await st().loadGroups()
    await st().loadWorks()
  }
  return (
    <div className="dirs">
      {!groups.length && <div className="hint">아직 그룹이 없습니다. 작품의 그룹 버튼에서 만들 수 있습니다.</div>}
      {groups.map((g) => (
        <div key={g.id} className="dir">
          {editing === g.id ? (
            <>
              <input
                className="field grow"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    await window.api.renameGroup(g.id, name)
                    setEditing(null)
                    await reload()
                  } else if (e.key === 'Escape') setEditing(null)
                }}
              />
              <button
                className="mini icon"
                title="이름 저장"
                onClick={async () => {
                  await window.api.renameGroup(g.id, name)
                  setEditing(null)
                  await reload()
                }}
              >
                <CheckIcon />
              </button>
              <button className="mini icon" title="취소" onClick={() => setEditing(null)}>
                <CloseIcon />
              </button>
            </>
          ) : (
            <>
              <span>
                {g.name} <span className="hint">작품 {g.count}</span>
              </span>
              <button className="mini icon" title="이름 바꾸기" onClick={() => (setEditing(g.id), setName(g.name))}>
                <EditIcon />
              </button>
              <button className="mini icon" title="그룹 삭제 (작품은 그대로)" onClick={() => setDel(g.id)}>
                <DeleteIcon />
              </button>
            </>
          )}
        </div>
      ))}
      {del !== null && (
        <Confirm
          title="그룹을 삭제할까요?"
          body="작품과 파일은 그대로이고 그룹 표시만 사라집니다."
          ok="삭제"
          onCancel={() => setDel(null)}
          onOk={async () => {
            await window.api.deleteGroup(del)
            setDel(null)
            await reload()
          }}
        />
      )}
    </div>
  )
}

export default function SettingsView(): JSX.Element | null {
  const s = useStore((x) => x.settings)
  const save = useStore((x) => x.saveSettings)
  const scan = useStore((x) => x.scan)
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    void window.api.appInfo().then(setInfo)
  }, [])
  if (!s) return null
  const st = useStore.getState
  const scanning = scan && (scan.state === 'running' || scan.state === 'queued')

  const removeDir = async (d: string): Promise<void> => {
    const r = await window.api.removeLibraryDir(d)
    await st().loadSettings()
    await st().loadWorks()
    st().showToast(r)
  }

  return (
    <div className="settings">
      <h1>설정</h1>
      <section>
        <h3>라이브러리</h3>
        <div className="dirs">
          {s.libraryDirs.map((d) => (
            <div key={d} className="dir">
              <FolderOpenIcon />
              <span className="selectable">{d}</span>
              <button className="mini icon" title="목록에서 빼기 (파일은 그대로)" onClick={() => void removeDir(d)}>
                <DeleteIcon />
              </button>
            </div>
          ))}
          <div className="flat-group">
            <button className="mini" onClick={() => void addLibraryFolder()}>
              <AddIcon /> 폴더 추가
            </button>
            <button
              className="mini"
              disabled={!!scanning || !s.libraryDirs.length}
              onClick={async () => {
                const r = await window.api.scan()
                st().showToast(r)
                void st().loadWorks()
              }}
            >
              <RefreshIcon /> {scanning ? `스캔 중 ${scan.total ? `${scan.done} / ${scan.total}` : ''}` : '다시 스캔'}
            </button>
          </div>
        </div>
      </section>
      <section>
        <h3>작품 정보</h3>
        <Row label="제목 표시" hint="DLsite 제목은 작품 코드로 가져옵니다. 폴더 이름이 작품 코드뿐인 작품은 스캔할 때 자동으로 가져옵니다.">
          <Seg
            value={s.titleSource}
            options={[
              ['folder', '폴더 이름'],
              ['dlsite', 'DLsite 제목']
            ]}
            onChange={(v) => void save({ titleSource: v }).then(() => st().loadWorks())}
          />
        </Row>
        <Row label="표지" hint="DLsite 표지는 앱 데이터 폴더에 저장하고, 작품 폴더는 바꾸지 않습니다. 그림이 없는 작품은 항상 DLsite 표지를 씁니다.">
          <Seg
            value={s.coverSource}
            options={[
              ['folder', '폴더 이미지'],
              ['dlsite', 'DLsite 표지']
            ]}
            onChange={(v) => void save({ coverSource: v }).then(() => st().loadWorks())}
          />
        </Row>
        <Row label="이름 표시" hint="번역한 이름은 작품 화면의 이름 번역 버튼으로 만듭니다. 파일 이름은 바꾸지 않습니다(바꾸려면 파일 정리 › 이름 바꾸기).">
          <Seg
            value={s.nameDisplay}
            options={[
              ['original', '원래 이름'],
              ['translated', '번역한 이름']
            ]}
            onChange={(v) => void save({ nameDisplay: v }).then(() => (st().loadWorks(), st().refreshWork()))}
          />
        </Row>
        <Row
          label="원래 이름 기록"
          hint="처음 스캔했을 때의 일본어 이름(깨진 이름은 복구한 일본어)과 일본어 자막을 프로그램 안에 기록해 두고, 파일 정리 › 폴더 변경을 실행한 작품 폴더에는 envelope-original.json으로도 남깁니다. 되돌리기: 파일 정리 › 이름 › 폴더 변경 › 기록한 원래 이름, 자막 › 프로그램 내 변경 › 기록한 일본어 자막 되살리기."
        >
          <Seg
            value={s.originalsInFolder ? 'on' : 'off'}
            options={[
              ['on', '작품 폴더에도 남기기'],
              ['off', '프로그램 안에만']
            ]}
            onChange={(v) => void save({ originalsInFolder: v === 'on' })}
          />
        </Row>
        <Row label="DLsite에서 가져오기" hint="아직 가져오지 않은 작품의 제목 · 서클 · 성우 · 표지를 가져옵니다 (1초에 한 작품).">
          <div className="flat-group">
            <button
              className="mini"
              onClick={async () => {
                const r = await window.api.fetchDlsite(null)
                st().showToast(r)
                void st().loadWorks()
              }}
            >
              <CloudDownloadIcon /> 가져오기
            </button>
          </div>
        </Row>
      </section>
      <section>
        <h3>그룹</h3>
        <Groups />
      </section>
      <section>
        <h3>재생</h3>
        <Row label="기본 버전" hint="SE를 넣은 판과 뺀 판이 다 있을 때 먼저 고를 쪽입니다. 작품마다 바꿀 수 있습니다.">
          <Seg value={s.sePref} options={[['on', 'SE 포함'], ['off', 'SE 제외']]} onChange={(v) => void save({ sePref: v })} />
        </Row>
        <Row label="파일 형식" hint="같은 트랙이 여러 형식으로 있을 때 먼저 고를 쪽입니다.">
          <Seg value={s.formatPref} options={[['lossless', '무손실 (wav · flac)'], ['mp3', 'mp3']]} onChange={(v) => void save({ formatPref: v })} />
        </Row>
        <Row label="이어 듣기" hint="켜면 작품 · 트랙을 마지막으로 듣던 곳부터 재생합니다. 끄면 항상 첫 트랙의 처음부터 재생합니다(들은 위치 기록은 그대로 남습니다).">
          <Seg value={s.resume ? 'on' : 'off'} options={[['on', '켜기'], ['off', '끄기']]} onChange={(v) => void save({ resume: v === 'on' })} />
        </Row>
        <Row label="건너뛰기 간격">
          <Seg value={s.seekStep} options={[[5, '5초'], [10, '10초'], [15, '15초'], [30, '30초']]} onChange={(v) => void save({ seekStep: v })} />
        </Row>
      </section>
      <section>
        <h3>자막</h3>
        <Row label="표시" hint="원문(일본어)과 번역(한국어) 자막이 둘 다 있을 때 보여줄 줄입니다.">
          <Seg<SubMode>
            value={s.subMode}
            options={[
              ['both', '둘 다'],
              ['original', '원문'],
              ['translation', '번역'],
              ['off', '끄기']
            ]}
            onChange={(v) => void save({ subMode: v })}
          />
        </Row>
        <Row label="글자 크기">
          <Seg value={s.subSize} options={[[18, '작게'], [22, '보통'], [28, '크게'], [36, '아주 크게']]} onChange={(v) => void save({ subSize: v })} />
        </Row>
      </section>
      <AutoSubSettings />
      <section>
        <h3>화면</h3>
        {!embedded && (
          <Row label="테마">
            <Seg value={s.theme} options={[['light', '라이트'], ['dark', '다크']]} onChange={(v) => void save({ theme: v })} />
          </Row>
        )}
        <Row label="한 페이지 작품 수" hint="라이브러리 목록을 이 개수씩 나눠 페이지로 보여줍니다.">
          <Stepper value={s.pageSize ?? 50} min={1} step={10} onChange={(v) => void save({ pageSize: v })} />
        </Row>
        <Row label="LP 탭 위치" hint="열어 둔 작품이 LP로 쌓이는 막대의 위치입니다.">
          <Seg value={s.tabSide} options={[['left', '왼쪽'], ['right', '오른쪽']]} onChange={(v) => void save({ tabSide: v })} />
        </Row>
      </section>
      <section>
        <h3>단축키</h3>
        <ShortcutSettings />
      </section>
      {info && (
        <p className="hint selectable about">
          Env/ {info.version} · 데이터 구조 {info.schemaVersion} · {info.dataDir}
        </p>
      )}
    </div>
  )
}
