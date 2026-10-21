// 감시 다운로드: ask main for galleries uploaded since the last check for the
// watched artists / tags (settings.watchTokens), then queue each through
// store.startDownload so they show in the activity bar like any download.
// Runs once on app start (App.tsx) and from the settings button.
import { useStore } from './store'

export async function runWatchCheck(): Promise<number> {
  const st = useStore.getState()
  const s = st.settings
  if (!s.watchTokens?.length || !s.doujinBaseUrl) return 0
  const job = st.startJob('meta', 'doujin', '감시 다운로드 확인', `${s.watchTokens.length}개 감시 중`)
  try {
    const hits = await window.api.watchCheck()
    for (const h of hits)
      void useStore
        .getState()
        .startDownload({ kind: 'doujin', input: h.code, title: h.title })
        .catch(() => {}) // failures stay in the download list (retry there)
    st.endJob(job, { status: 'done', detail: hits.length ? `새 작품 ${hits.length}개 다운로드` : '새 작품 없음' })
    return hits.length
  } catch (e: any) {
    st.endJob(job, { status: 'error', error: String(e?.message ?? e) })
    return 0
  }
}
