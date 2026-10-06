import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { GallerySummary } from '../../../shared/ipc'
import { useStore } from '../store'
import { DownloadIcon } from './icons'

// 다른 언어판 panel (online list view, under a card): the work's 한국어 번역본 / 일본어 원문 / 영어 번역본
// side by side (the gallery's own language map first, else the artist's works
// with a similar title). Clicking one opens it in a new tab; ⬇ downloads it.
// Used under online list cards and local list cards (replaces the old
// Korean-only finder).
type Hit = GallerySummary & { similar?: boolean }
type Editions = { korean: Hit[]; japanese: Hit[]; english: Hit[] }
const COLS: [keyof Editions, string][] = [
  ['korean', '한국어 번역본'],
  ['japanese', '일본어 원문'],
  ['english', '영어 번역본']
]

export default function EditionsPanel({
  code,
  artist,
  title,
  language = null,
  inline = false
}: {
  code: string | null
  artist: string | null
  title: string
  language?: string | null
  inline?: boolean // attached under a list card instead of dropping over the reader
}): JSX.Element {
  const openOnline = useStore((s) => s.openOnline)
  const startDownload = useStore((s) => s.startDownload)
  const [downloading, setDownloading] = useState<string | null>(null)
  const download = async (code: string): Promise<void> => {
    setDownloading(code)
    try {
      await startDownload({ kind: 'doujin', input: code })
    } catch (e: any) {
      alert(String(e?.message ?? e))
    } finally {
      setDownloading(null)
    }
  }
  const [eds, setEds] = useState<Editions | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setEds(null)
    setError(null)
    window.api
      .doujinFindEditions({ code, artist, title, language })
      .then((r) => alive && setEds(r))
      .catch((e) => alive && setError(String(e?.message ?? e)))
    return () => {
      alive = false
    }
  }, [code, artist, title, language])

  return (
    <div className={`editions-panel ${inline ? 'inline' : ''}`} onClick={(e) => e.stopPropagation()}>
      {error && <div className="warn err">{error}</div>}
      <div className="editions-cols">
        {COLS.map(([k, label]) => (
          <div className="editions-col" key={k}>
            <div className="editions-head">
              {label}
              {eds && <span className="editions-count">{eds[k].filter((g) => !g.similar).length}</span>}
            </div>
            {!eds && !error && <div className="hint">찾는 중…</div>}
            {eds && eds[k].length === 0 && <div className="hint">없음</div>}
            <div className="editions-list">
              {eds?.[k].map((g) => (
                <div
                  key={g.code}
                  className="edition-row"
                  title={g.title}
                  onClick={() => openOnline({ code: g.code, title: g.title, artist: g.artists.join(', ') || null })}
                >
                  <div className="edition-thumb">
                    {g.thumbUrl ? <img src={g.thumbUrl} loading="lazy" alt="" /> : <div className="thumb-ph" />}
                    {/* Near match (same artist, similar title) — not certain. */}
                    {g.similar && <span className="online-fav-badge edition-similar">유사</span>}
                  </div>
                  <div className="edition-info">
                    <div className="edition-title">{g.title}</div>
                    <div className="edition-meta">
                      {g.pageCount}p · {g.code}
                    </div>
                  </div>
                  <button
                    className="mini icon edition-dl"
                    title="다운로드"
                    disabled={downloading === g.code}
                    onClick={(e) => {
                      e.stopPropagation()
                      void download(g.code)
                    }}
                  >
                    <DownloadIcon />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
