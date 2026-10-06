// 번역: the in-reader page translation engine and its credentials.
//   llm    — any OpenAI-compatible vision API (OCR + translate + layout at once)
//   gemini — Google Gemini (same, one call)
//   papago — Naver Papago image translation
//   free   — on-device Tesseract OCR + a free text translator
//   local  — in-app OCR (comic-text-detector + manga-ocr / PaddleOCR) + text-only
//            translation of the whole page (LLM or free translator)
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { LLM_PRESETS } from '../../../../shared/types'
import type { Settings } from '../../../../shared/types'
import Dropdown from '../Dropdown'
import SettingRow from '../SettingRow'
import { useSettings } from './context'
import { ExportDirRow } from './FolderSection'

// Base URL + a default vision model for each preset OpenAI-compatible provider
// (custom = keep whatever the user typed).
// Labeled single-line input bound to one string setting (trimmed).
function Field({
  title,
  k,
  secret
}: {
  title: string
  k: 'llmBaseUrl' | 'llmModel' | 'llmApiKey' | 'geminiApiKey' | 'geminiModel' | 'papagoClientId' | 'papagoClientSecret' | 'papagoImageEndpoint' | 'deeplApiKey'
  secret?: boolean
}): JSX.Element {
  const { draft, patch } = useSettings()
  return (
    <>
      <SettingRow title={title} />
      <input
        type={secret ? 'password' : 'text'}
        className="field-input"
        value={draft[k]}
        onChange={(e) => patch({ [k]: e.target.value.trim() })}
      />
    </>
  )
}

// 로컬 OCR models: status + one-shot download (all models together) / delete.
function LocalOcrModels(): JSX.Element {
  const [st, setSt] = useState<{ installed: boolean; sizeMB: number } | null>(null)
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const refresh = (): void => void window.api.ocrModelsStatus().then(setSt)
  useEffect(() => {
    refresh()
    return window.api.onOcrModelsProgress(setProg)
  }, [])
  const busy = !!prog && prog.done < prog.total
  const mb = (b: number): string => (b / 1024 / 1024).toFixed(0)
  return (
    <SettingRow
      title="로컬 OCR 모델"
      desc={
        st?.installed
          ? '설치됨 — 글자 위치 찾기·일본어·영어 인식 모델이 모두 준비되었습니다.'
          : `처음 한 번 모델 파일(약 ${st?.sizeMB ?? 225}MB)을 받아야 합니다. 받은 뒤에는 인터넷 없이 기기에서 인식합니다.`
      }
    >
      {err && <span className="warn err">{err}</span>}
      {busy && (
        <span className="hint">
          받는 중… {mb(prog!.done)} / {mb(prog!.total)}MB
        </span>
      )}
      {st?.installed ? (
        <button
          className="mini danger"
          onClick={async () => {
            await window.api.ocrModelsDelete()
            refresh()
          }}
        >
          모델 삭제
        </button>
      ) : (
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setErr(null)
            const r = await window.api.ocrModelsDownload()
            if (!r.ok) setErr(r.error ?? '다운로드 실패')
            setProg(null)
            refresh()
          }}
        >
          {busy ? '받는 중…' : '모델 받기'}
        </button>
      )}
    </SettingRow>
  )
}

export default function TranslateSection(): JSX.Element {
  const { draft, patch } = useSettings()
  return (
    <section data-cat="translate">
      <h2>번역</h2>
      <p className="hint">
        한국어가 아닌 작품을 볼 때 뷰어 하단 “🌐 번역”으로 현재 페이지 말풍선 원문을 지우고 그 자리에
        한국어를 덧씌웁니다. 보고 있는 페이지만 번역하며 결과는 캐시됩니다.
      </p>
      <ExportDirRow />

      <SettingRow title="번역 엔진" desc="글자 인식·번역을 처리할 엔진.">
        <Dropdown<Settings['translateEngine']>
          className="field"
          value={draft.translateEngine}
          onChange={(v) => patch({ translateEngine: v })}
          options={[
            ['local', '로컬 OCR + LLM 번역 (무료 · 추천)'],
            ['llm', 'Vision LLM (무료)'],
            ['gemini', 'Gemini Flash (유료)'],
            ['papago', 'Papago (유료)'],
            ['free', '기본 (무료 · Tesseract)']
          ]}
        />
      </SettingRow>

      {draft.translateEngine === 'local' && (
        <div className="set-block">
          <p className="hint" style={{ marginTop: 8 }}>
            말풍선 위치 찾기와 글자 인식(일본어 manga-ocr · 영어 PaddleOCR)을 기기에서 무료로 처리하고,
            인식된 대사만 페이지 단위로 한 번에 번역합니다. 이미지는 외부로 보내지 않습니다.
          </p>
          <LocalOcrModels />
          <SettingRow
            title="번역기"
            desc="자동: Gemini 키가 있으면 Gemini, 없으면 아래 LLM, 둘 다 없으면 무료 번역기. 번역이 실패해도 무료 번역기로 이어서 처리합니다."
          >
            <Dropdown<Settings['localTranslator']>
              className="field"
              value={draft.localTranslator ?? 'auto'}
              onChange={(v) => patch({ localTranslator: v })}
              options={[
                ['auto', '자동'],
                ['gemini', 'Gemini'],
                ['llm', 'LLM (Groq · OpenRouter · Mistral · Ollama)'],
                ['free', '무료 번역기 (Google · DeepL)']
              ]}
            />
          </SettingRow>
          {(draft.localTranslator === 'gemini' || draft.localTranslator === 'auto') && (
            <>
              <Field title="Gemini API 키 (선택)" k="geminiApiKey" secret />
              <Field title="Gemini 모델" k="geminiModel" />
            </>
          )}
          {(draft.localTranslator === 'llm' || draft.localTranslator === 'auto') && (
            <>
              <SettingRow title="LLM 제공자">
                <Dropdown<Settings['llmProvider']>
                  className="field prov-field"
                  value={draft.llmProvider}
                  onChange={(p) => patch({ llmProvider: p, ...(LLM_PRESETS[p] ?? {}) })}
                  options={[
                    ['groq', 'Groq'],
                    ['openrouter', 'OpenRouter'],
                    ['mistral', 'Mistral'],
                    ['ollama', 'Ollama (내 PC)'],
                    ['custom', '커스텀']
                  ]}
                />
              </SettingRow>
              <Field title="Base URL" k="llmBaseUrl" />
              <Field title="모델" k="llmModel" />
              <Field title="API 키 (선택)" k="llmApiKey" secret />
              <p className="hint">
                무료 키: Groq=console.groq.com · OpenRouter=openrouter.ai/keys · Mistral=console.mistral.ai.
                Ollama는 키 없이 내 PC에서 실행 (예: gemma3:12b, qwen3:14b).
              </p>
            </>
          )}
          {draft.localTranslator === 'free' && (
            <SettingRow title="무료 번역기">
              <Dropdown<Settings['freeTranslator']>
                className="field"
                value={draft.freeTranslator}
                onChange={(v) => patch({ freeTranslator: v })}
                options={[
                  ['google', 'Google 비공식 (키 없음)'],
                  ['deepl', 'DeepL Free (키 필요)']
                ]}
              />
            </SettingRow>
          )}
        </div>
      )}

      {draft.translateEngine === 'llm' && (
        <div className="set-block">
          <p className="hint" style={{ marginTop: 8 }}>
            OpenAI 호환 비전 API로 인식+번역+위치를 한 번에. 대부분 카드 없이 무료 한도가 있습니다.
            제공자를 고르면 주소/모델이 자동 채워지며, 키만 발급해 넣으면 됩니다.
          </p>
          <SettingRow title="제공자">
            <Dropdown<Settings['llmProvider']>
              className="field prov-field"
              value={draft.llmProvider}
              onChange={(p) => patch({ llmProvider: p, ...(LLM_PRESETS[p] ?? {}) })}
              options={[
                ['groq', 'Groq'],
                ['openrouter', 'OpenRouter'],
                ['mistral', 'Mistral'],
                ['custom', '커스텀']
              ]}
            />
          </SettingRow>
          <Field title="Base URL" k="llmBaseUrl" />
          <Field title="모델" k="llmModel" />
          <Field title="API 키" k="llmApiKey" secret />
          <p className="hint">
            키 발급: Groq=console.groq.com · OpenRouter=openrouter.ai/keys · Mistral=console.mistral.ai.
            모델은 비전(이미지) 지원 모델이어야 합니다.
          </p>
        </div>
      )}

      {draft.translateEngine === 'gemini' && (
        <div className="set-block">
          <p className="hint" style={{ marginTop: 8 }}>
            Gemini가 글자 인식+번역+위치를 한 번에 처리합니다. Google AI Studio에서 무료 API 키를
            발급(aistudio.google.com → Get API key)해 입력하세요. (이미지가 Google로 전송)
          </p>
          <Field title="Gemini API 키" k="geminiApiKey" secret />
          <Field title="모델" k="geminiModel" />
          <p className="hint">
            기본 <code>gemini-2.5-flash</code>. <code>gemini-3.5-flash</code> 등 최신 Flash 모델도 무료입니다.
          </p>
        </div>
      )}

      {draft.translateEngine === 'papago' && (
        <div className="set-block">
          <p className="hint" style={{ marginTop: 8 }}>
            네이버 클라우드 Papago Image Translation(Text) 하나로 글자 인식+번역. NCP에서 해당 API를
            켜고 Client ID/Secret을 입력하세요. (이미지가 Papago로 전송, 사용량 과금)
          </p>
          <Field title="Papago Client ID" k="papagoClientId" />
          <Field title="Papago Client Secret" k="papagoClientSecret" secret />
          <Field title="이미지 번역 엔드포인트" k="papagoImageEndpoint" />
          <p className="hint">※ 콘솔의 API Gateway 호출 URL과 다르면 위 주소를 맞춰주세요.</p>
        </div>
      )}

      {draft.translateEngine === 'free' && (
        <div className="set-block">
          <p className="hint" style={{ marginTop: 8 }}>
            글자 인식은 기기에서 Tesseract로 무료 처리(페이지당 0원). 번역만 아래 무료 번역기를 씁니다.
            인식 정확도는 파파고보다 낮을 수 있고, 첫 페이지는 인식 엔진 로딩으로 조금 느립니다.
          </p>
          <SettingRow title="무료 번역기">
            <Dropdown<Settings['freeTranslator']>
              className="field"
              value={draft.freeTranslator}
              onChange={(v) => patch({ freeTranslator: v })}
              options={[
                ['google', 'Google 비공식 (키 없음 · 불안정할 수 있음)'],
                ['deepl', 'DeepL Free (키 필요 · 월 50만자 무료 · 품질↑)']
              ]}
            />
          </SettingRow>
          {draft.freeTranslator === 'deepl' && (
            <>
              <Field title="DeepL API 키" k="deeplApiKey" secret />
              <p className="hint">DeepL 계정 → API(Free) 키 발급 후 입력. 엔드포인트는 api-free.deepl.com을 씁니다.</p>
            </>
          )}
        </div>
      )}

      <div className="set-block">
        <SettingRow
          title="전역 번역 프롬프트"
          desc="LLM 번역(로컬 OCR + LLM · Vision LLM · Gemini)에 항상 덧붙는 지시입니다. 말투, 용어, 번역 스타일 등을 적어 두세요. 무료 번역기(Google·DeepL)에는 적용되지 않습니다."
        />
        <textarea
          className="field-input field-textarea"
          rows={4}
          value={draft.translatePrompt ?? ''}
          placeholder="예: 의성어는 짧게. 여성 캐릭터의 ～わ 어미는 '~해요'체로. 'お兄ちゃん'은 '오빠'로."
          onChange={(e) => patch({ translatePrompt: e.target.value })}
        />
      </div>
    </section>
  )
}
