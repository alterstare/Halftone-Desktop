// 설정 › 자동 자막 · 번역: the speech engine (local whisper.cpp or Groq), its
// engine / model downloads, the translator (Halftone's choices), what may be
// sent out, and the common glossary.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { EngineStatus, GlossaryEntry, Settings, WhisperModelId } from '../../../shared/types'
import { Dropdown } from './ui'
import { AddIcon, CheckIcon, CloudDownloadIcon, DeleteIcon, FileOpenIcon, FolderOpenIcon } from './icons'

const MODELS: [WhisperModelId, string, number][] = [
  ['large-v3-turbo-q5_0', 'large-v3-turbo (받아쓰기 기본)', 574],
  ['small', 'small (대본 정렬 재시도)', 488],
  ['base', 'base (대본 정렬 재시도)', 148],
  ['tiny', 'tiny (대본 정렬)', 78]
]

function Row({ label, hint, children }: { label: string; hint?: string; children?: React.ReactNode }): JSX.Element {
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

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }): JSX.Element {
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

// A text field saved when it loses focus (or Enter).
function Field({ value, onSave, placeholder, secret, wide }: { value: string; onSave: (v: string) => void; placeholder?: string; secret?: boolean; wide?: boolean }): JSX.Element {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input
      className={`set-input ${wide ? 'wide' : ''}`}
      type={secret ? 'password' : 'text'}
      value={v}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v.trim())}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}

export function Glossary({ workId = null }: { workId?: number | null }): JSX.Element {
  const [rows, setRows] = useState<GlossaryEntry[]>([])
  useEffect(() => {
    void window.api.getGlossary(workId).then(setRows)
  }, [workId])
  const store = (next: GlossaryEntry[]): void => {
    setRows(next)
    void window.api.setGlossary(workId, next.filter((r) => r.source.trim() && r.target.trim()))
  }
  return (
    <div className="gloss">
      {rows.map((r, i) => (
        <div key={i} className="gloss-row">
          <Field value={r.source} placeholder="원문 (예: お兄ちゃん)" onSave={(v) => store(rows.map((x, j) => (j === i ? { ...x, source: v } : x)))} />
          <span className="hint">→</span>
          <Field value={r.target} placeholder="번역 (예: 오빠)" onSave={(v) => store(rows.map((x, j) => (j === i ? { ...x, target: v } : x)))} />
          <button className="mini icon" title="빼기" onClick={() => store(rows.filter((_, j) => j !== i))}>
            <DeleteIcon />
          </button>
        </div>
      ))}
      <div className="flat-group">
        <button className="mini" onClick={() => setRows([...rows, { source: '', target: '' }])}>
          <AddIcon /> 항목 추가
        </button>
        <button
          className="mini"
          title={'txt · md · csv · tsv — 한 줄에 하나: "원문 → 번역", "원문 = 번역", "원문: 번역", 탭 · 쉼표로 나눈 두 칸, 마크다운 표 "| 원문 | 번역 |". 같은 원문은 새 번역으로 바뀝니다.'}
          onClick={async () => {
            const r = await window.api.importGlossary(workId)
            if (!r) return
            useStore.getState().showToast(r)
            setRows(await window.api.getGlossary(workId))
          }}
        >
          <FileOpenIcon /> 텍스트 파일에서 가져오기
        </button>
      </div>
    </div>
  )
}

export default function AutoSubSettings(): JSX.Element | null {
  const s = useStore((x) => x.settings)
  const save = useStore((x) => x.saveSettings)
  const job = useStore((x) => x.job)
  const [eng, setEng] = useState<EngineStatus | null>(null)
  const refresh = (): void => void window.api.engineStatus().then(setEng)
  useEffect(refresh, [job?.state])
  if (!s) return null
  const toast = useStore.getState().showToast
  const set = (p: Partial<Settings>): void => void save(p)
  const busy = !!job && (job.state === 'running' || job.state === 'queued')

  return (
    <>
      <section>
        <h3>자동 자막 · 받아쓰기</h3>
        <Row label="받아쓰기 엔진" hint="로컬은 이 PC에서만 처리합니다(무료, 음성이 밖으로 나가지 않음). Groq는 음성을 Groq 서버로 보냅니다.">
          <Seg value={s.asrEngine} options={[['local', '로컬 (whisper.cpp)'], ['groq', 'Groq']]} onChange={(v) => set({ asrEngine: v })} />
        </Row>
        {s.asrEngine === 'local' ? (
          <>
            <Row
              label="엔진"
              hint={
                eng
                  ? `Vulkan(GPU) ${eng.vulkan ? '있음' : '없음'} · CPU ${eng.cpu ? '있음' : '없음'} — GPU 엔진이 있으면 먼저 쓰고, 안 되면 CPU로 자동 전환합니다.`
                  : undefined
              }
            >
              <div className="flat-group">
                <button className="mini" disabled={busy} onClick={async () => (toast(await window.api.installEngine()), refresh())}>
                  <CloudDownloadIcon /> CPU 엔진 받기
                </button>
                <button className="mini" title="직접 빌드한 Vulkan whisper-cli.exe 넣기" onClick={async () => (toast(await window.api.importVulkanEngine()), refresh())}>
                  <FolderOpenIcon /> Vulkan 엔진 넣기
                </button>
              </div>
            </Row>
            <Row label="장치">
              <Seg value={s.localDevice} options={[['auto', '자동 (GPU 먼저)'], ['cpu', 'CPU만']]} onChange={(v) => set({ localDevice: v })} />
            </Row>
            <div className="models">
              {MODELS.map(([m, label, mb]) => (
                <div key={m} className={`model-row ${s.localModel === m ? 'on' : ''}`}>
                  <button className="model-pick" disabled={!eng?.models[m]} title="받아쓰기에 쓸 모델" onClick={() => set({ localModel: m })}>
                    {s.localModel === m && <CheckIcon />}
                    <span>{label}</span>
                  </button>
                  {/* the size in a fixed column just left of the button — it doesn't move with the name */}
                  <span className="hint model-size">{mb} MB</span>
                  <div className="flat-group model-act">
                    {eng?.models[m] ? (
                      <button className="mini icon" title="모델 지우기" onClick={async () => (await window.api.removeModel(m), refresh())}>
                        <DeleteIcon />
                      </button>
                    ) : (
                      <button className="mini" disabled={busy} onClick={async () => (toast(await window.api.installModel(m)), refresh())}>
                        <CloudDownloadIcon /> 받기
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <Row label="Groq API 키" hint="console.groq.com에서 무료로 만들 수 있습니다.">
              <Field secret value={s.groqApiKey} placeholder="gsk_…" onSave={(v) => set({ groqApiKey: v })} />
            </Row>
            <Row label="음성을 밖으로 보내기" hint="켜야 Groq로 받아쓸 수 있습니다. 받아쓸 트랙의 음성만 보냅니다.">
              <Seg value={s.allowAudioUpload ? 1 : 0} options={[[0, '끄기'], [1, '켜기']]} onChange={(v) => set({ allowAudioUpload: !!v })} />
            </Row>
          </>
        )}
      </section>
      <section>
        <h3>번역</h3>
        <Row label="번역 엔진" hint="Google은 키 없이 쓰는 비공식 번역(무료, 막힐 수 있음)입니다. LLM은 문맥과 용어집을 함께 보고 번역합니다.">
          <Dropdown
            kind="mini"
            title="번역 엔진"
            value={s.translator}
            options={[
              ['google', 'Google (무료)'],
              ['deepl', 'DeepL'],
              ['gemini', 'Gemini'],
              ['llm', 'LLM']
            ]}
            onChange={(v) => set({ translator: v })}
          />
        </Row>
        {s.translator === 'deepl' && (
          <Row label="DeepL API 키" hint="DeepL API Free 키 (한 달 50만 자 무료).">
            <Field secret value={s.deeplApiKey} onSave={(v) => set({ deeplApiKey: v })} />
          </Row>
        )}
        {s.translator === 'gemini' && (
          <>
            <Row label="Gemini API 키" hint="Google AI Studio에서 무료로 만들 수 있습니다.">
              <Field secret value={s.geminiApiKey} onSave={(v) => set({ geminiApiKey: v })} />
            </Row>
            <Row label="모델">
              <Field value={s.geminiModel} placeholder="gemini-2.5-flash" onSave={(v) => set({ geminiModel: v || 'gemini-2.5-flash' })} />
            </Row>
          </>
        )}
        {s.translator === 'llm' && (
          <>
            <Row label="LLM 제공자" hint="OpenAI 호환 API. Groq는 받아쓰기 키를 함께 씁니다(따로 넣으면 그 키).">
              <Dropdown
                kind="mini"
                title="LLM 제공자"
                value={s.llmProvider}
                options={[
                  ['groq', 'Groq'],
                  ['openrouter', 'OpenRouter'],
                  ['mistral', 'Mistral'],
                  ['ollama', 'Ollama'],
                  ['custom', '직접 입력']
                ]}
                onChange={(v) => set({ llmProvider: v })}
              />
            </Row>
            {s.llmProvider === 'custom' && (
              <Row label="주소">
                <Field wide value={s.llmBaseUrl} placeholder="https://…/v1" onSave={(v) => set({ llmBaseUrl: v })} />
              </Row>
            )}
            <Row label="모델">
              <Field value={s.llmModel} placeholder="qwen/qwen3.8-27b" onSave={(v) => set({ llmModel: v })} />
            </Row>
            {s.llmProvider !== 'ollama' && (
              <Row label="API 키">
                <Field secret value={s.llmApiKey} placeholder={s.llmProvider === 'groq' ? '비우면 받아쓰기 키' : ''} onSave={(v) => set({ llmApiKey: v })} />
              </Row>
            )}
          </>
        )}
        <Row label="글자를 밖으로 보내기" hint="켜야 번역할 수 있습니다. 자막 · 대본 · 이름 글자만 보냅니다(음성은 보내지 않음).">
          <Seg value={s.allowTextUpload ? 1 : 0} options={[[0, '끄기'], [1, '켜기']]} onChange={(v) => set({ allowTextUpload: !!v })} />
        </Row>
        <Row label="번역 확인" hint="한 줄을 번역해서 엔진과 키가 동작하는지 봅니다.">
          <div className="flat-group">
            <button className="mini" onClick={async () => toast(await window.api.testTranslator())}>
              확인하기
            </button>
          </div>
        </Row>
        <div className="set-row column">
          <div>
            <div className="set-label">추가 지시</div>
            <div className="hint set-hint">LLM 번역에 덧붙일 지시입니다. 예: 여자 화자는 반말, 효과음은 옮기지 않기.</div>
          </div>
          <textarea
            className="set-text"
            defaultValue={s.translatePrompt}
            rows={3}
            onBlur={(e) => e.target.value !== s.translatePrompt && set({ translatePrompt: e.target.value })}
          />
        </div>
        <div className="set-row column">
          <div>
            <div className="set-label">공통 용어집</div>
            <div className="hint set-hint">이름 · 호칭을 늘 같은 말로 옮깁니다. LLM은 지시로, 다른 엔진은 번역 전에 바꿔 넣습니다. 작품별 용어집은 작품 화면에서.</div>
          </div>
          <Glossary />
        </div>
      </section>
    </>
  )
}
