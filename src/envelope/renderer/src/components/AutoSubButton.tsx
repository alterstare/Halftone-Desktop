// 작품 화면 › 자동 자막: how to make the subtitles — 받아쓰기 (speech engine),
// or 대본 (a script found in the work, or any txt / pdf / docx picked with
// 파일 고르기…, timed by a small model) — which tracks, the work's own
// glossary; then one background job.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { ScriptPreview, ScriptSource, WorkDetail } from '../../../shared/types'
import { Check, Dropdown, Popover, useAnchor } from './ui'
import { Glossary } from './AutoSubSettings'
import { FileOpenIcon, SubtitlesIcon } from './icons'

const ENGINE: Record<string, string> = { local: '로컬 whisper.cpp', groq: 'Groq' }
const TRANSLATOR: Record<string, string> = { google: 'Google 번역', deepl: 'DeepL', gemini: 'Gemini', llm: 'LLM' }
const LANG: Record<string, string> = { ja: '일본어', ko: '한국어', other: '언어 미확인' }

export default function AutoSubButton({ w }: { w: WorkDetail }): JSX.Element {
  const s = useStore((x) => x.settings)
  const pop = useAnchor()
  const [method, setMethod] = useState<'asr' | 'script'>('asr')
  const [scripts, setScripts] = useState<ScriptSource[]>([])
  const [src, setSrc] = useState('')
  const [preview, setPreview] = useState<ScriptPreview[] | string | null>(null)
  const [transcribe, setTranscribe] = useState(true)
  const [translate, setTranslate] = useState(w.lang !== 'ko-voice')
  const [extras, setExtras] = useState(false)
  const [redo, setRedo] = useState(false)
  const [gloss, setGloss] = useState(false)

  // look for scripts when the panel opens
  useEffect(() => {
    if (!pop.open) return
    void window.api.findScripts(w.id).then((list) => {
      // keep a file picked earlier in the list
      const picked = scripts.filter((x) => x.id.startsWith('file:') && !list.some((y) => y.id === x.id))
      const all = [...list, ...picked]
      setScripts(all)
      if (all.length && !all.some((x) => x.id === src)) setSrc(all[0].id)
    })
  }, [pop.open, w.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setPreview(null), [src])

  const source = scripts.find((x) => x.id === src)
  const pickFile = async (): Promise<void> => {
    const f = await window.api.pickScript(w.id)
    if (!f) return
    setScripts((list) => [...list.filter((x) => x.id !== f.id), f])
    setSrc(f.id)
    setMethod('script')
  }
  const start = async (): Promise<void> => {
    pop.close()
    const st = useStore.getState()
    st.showToast({ ok: true, message: '자동 자막을 시작했습니다. 진행은 위쪽 막대에 보입니다.' })
    const r =
      method === 'script' && source
        ? await window.api.scriptSub(w.id, { sourceId: source.id, translate, redo })
        : await window.api.autoSub(w.id, { transcribe, translate, extras, redo })
    st.showToast(r)
    void st.refreshWork(w.id)
  }
  const showPreview = async (): Promise<void> => {
    if (!source) return
    setPreview('확인하는 중…')
    try {
      setPreview(await window.api.previewScript(w.id, source.id))
    } catch (e) {
      setPreview(String((e as Error)?.message ?? e))
    }
  }

  return (
    <>
      <button className={`mini icon ${pop.open ? 'on' : ''}`} title="자동 자막 (받아쓰기 · 대본 · 번역)" onClick={(e) => pop.toggle(e.currentTarget)}>
        <SubtitlesIcon />
      </button>
      {pop.anchor && (
        <Popover anchor={pop.anchor} closing={pop.closing} onClose={pop.close}>
          <div className="autosub-pop">
            <div className="menu-title">자동 자막</div>
            <div className="flat-group">
              <button className={`mini ${method === 'asr' ? 'on' : ''}`} onClick={() => setMethod('asr')}>
                받아쓰기
              </button>
              <button className={`mini ${method === 'script' ? 'on' : ''}`} onClick={() => setMethod('script')}>
                대본 사용
              </button>
            </div>
            {method === 'script' && !source ? (
              <>
                <div className="hint">작품 폴더에서 대본을 찾지 못했습니다. txt · pdf · docx 파일을 직접 고를 수 있습니다.</div>
                <button className="mini" onClick={() => void pickFile()}>
                  <FileOpenIcon /> 파일 고르기…
                </button>
              </>
            ) : method === 'asr' || !source ? (
              <>
                <Check checked={transcribe} onChange={setTranscribe}>
                  받아쓰기 — {w.lang === 'ko-voice' ? '한국어' : '일본어'} 자막 만들기
                </Check>
                {w.lang !== 'ko-voice' && (
                  <Check checked={translate} onChange={setTranslate}>
                    한국어로 번역
                  </Check>
                )}
                <Check checked={extras} onChange={setExtras}>
                  부록 트랙도
                </Check>
              </>
            ) : (
              <>
                <div className="autosub-script">
                  <Dropdown<string>
                    kind="mini"
                    title="대본"
                    value={source.id}
                    options={scripts.map((x) => [x.id, `${x.label} · ${LANG[x.lang]}${x.kind === 'perTrack' ? ' · 트랙별' : ''}`] as const)}
                    onChange={setSrc}
                  />
                  <button className="mini icon" title="파일 고르기… (txt · pdf · docx)" onClick={() => void pickFile()}>
                    <FileOpenIcon />
                  </button>
                </div>
                {source.lang !== 'ko' && (
                  <Check checked={translate} onChange={setTranslate}>
                    대본을 한국어로 번역
                  </Check>
                )}
                <button className="mini" onClick={() => void showPreview()}>
                  트랙 나누기 확인
                </button>
                {typeof preview === 'string' && <div className="hint">{preview}</div>}
                {Array.isArray(preview) && !preview.length && (
                  <div className="hint">대본에 트랙 제목이 없어, 각 트랙에서 들리는 말과 맞춰 보며 트랙을 나눕니다.</div>
                )}
                {Array.isArray(preview) && preview.length > 0 && (
                  <div className="script-preview">
                    {preview.map((p) => (
                      <div key={p.groupKey} className="sp-row">
                        <span className="sp-title">{p.title}</span>
                        <span className="hint">
                          {p.lines}줄 · {p.first}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            <Check checked={redo} onChange={setRedo}>
              이미 만든 자막 다시 만들기
            </Check>
            <div className="hint autosub-engines">
              {method === 'script' && source
                ? `${s?.asrEngine === 'groq' ? 'Groq' : '로컬 tiny 모델(없으면 받기, base · small은 받아 두면 다시 맞출 때 사용)'}로 위치 맞추기${source.lang !== 'ko' && translate ? ` · ${TRANSLATOR[s?.translator ?? 'google']}` : ''}`
                : `${transcribe ? ENGINE[s?.asrEngine ?? 'local'] : ''}${transcribe && translate ? ' · ' : ''}${translate ? TRANSLATOR[s?.translator ?? 'google'] : ''}`}
              {' — 바꾸기: 설정 › 자동 자막'}
            </div>
            <div className="autosub-actions">
              <button className={`mini ${gloss ? 'on' : ''}`} onClick={() => setGloss(!gloss)}>
                작품 용어집
              </button>
              <span className="grow" />
              <button className="btn primary small" disabled={method === 'asr' ? !transcribe && !translate : !source} onClick={() => void start()}>
                시작
              </button>
            </div>
            {gloss && <Glossary workId={w.id} />}
          </div>
        </Popover>
      )}
    </>
  )
}
