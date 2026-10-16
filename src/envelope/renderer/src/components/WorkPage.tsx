import type { JSX } from 'react'
import { useStore } from '../store'
import AutoSubButton from './AutoSubButton'
import type { TrackGroup, TrackVersion, WorkDetail } from '../../../shared/types'
import { media, play, resumeTarget, toggle } from '../player'
import { clock, length } from '../format'
import {
  CleaningServicesIcon,
  CloudDownloadIcon,
  FolderOpenIcon,
  GraphicEqIcon,
  HistoryIcon,
  KeyboardArrowLeftIcon,
  PauseIcon,
  PlayArrowIcon,
  ScheduleIcon,
  ShuffleIcon,
  SubtitlesIcon,
  TranslateIcon
} from './icons'
import { Dropdown, FavButton, GroupButton, Stars, TagLine, useNarrow } from './ui'
import { contentLabels, trackLabel } from '../workInfo'
import { useTrackMenu } from './WorkMenu'

export function versionLabel(v: TrackVersion): string {
  const se = v.se === 'on' ? 'SE 포함' : v.se === 'off' ? 'SE 제외' : ''
  const fmt = v.ext.slice(1).toUpperCase() + (v.bitrate ? ` ${v.bitrate}kbps` : '')
  return [se, fmt].filter(Boolean).join(' · ')
}


// After SE / edition changes: reload, and keep the track playing on the
// newly chosen file from the same point.
async function afterPrefs(w: WorkDetail): Promise<void> {
  const st = useStore.getState()
  await st.refreshWork(w.id)
  const n = useStore.getState().now
  if (!n || n.work.id !== w.id) return
  const g = n.work.groups.find((x) => x.key === n.groupKey)
  if (g && g.chosen !== n.trackId) void play(n.work, g.key, { versionId: g.chosen, at: media().currentTime, autoplay: !media().paused })
}

function TrackRow({
  w,
  g,
  n,
  current,
  playing
}: {
  w: WorkDetail
  g: TrackGroup
  n: number
  current: boolean
  playing: boolean
}): JSX.Element {
  const nowTrack = useStore((s) => (current ? s.now?.trackId : undefined))
  const v = g.versions.find((x) => x.id === (current ? nowTrack : g.chosen)) ?? g.versions[0]
  const pct = g.duration && g.position && !g.finished ? Math.min(100, (g.position / g.duration) * 100) : 0
  const hasSubs = g.versions.some((x) => x.subs.length)
  const { trackMenu, openTrackMenu } = useTrackMenu()
  return (
    <div className={`trow ${current ? 'current' : ''}`} onClick={() => (current ? toggle() : void play(w, g.key))} onContextMenu={(e) => openTrackMenu(e, w, g, current)} title={g.originalTitle ? `${g.title}\n${g.originalTitle}` : g.title}>
      <span className="trow-n">
        <span className="n">{current && playing ? <GraphicEqIcon /> : n}</span>
        <span className="hover">{current && playing ? <PauseIcon /> : <PlayArrowIcon />}</span>
      </span>
      <span className="trow-main">
        <span className="trow-title">{g.title}</span>
        <span className="trow-sub">
          {current && g.versions.length > 1 && nowTrack !== undefined ? (
            <Dropdown<number>
              kind="inline"
              value={nowTrack}
              title="이 트랙의 파일"
              options={g.versions.map((x) => [x.id, `${versionLabel(x)}${x.relDir ? ` · ${x.relDir}` : ''}`] as const)}
              onChange={(id) => void play(w, g.key, { versionId: id, at: media().currentTime, autoplay: !media().paused })}
            />
          ) : (
            versionLabel(v)
          )}
          {hasSubs && <SubtitlesIcon className="trow-submark" />}
        </span>
        {pct > 0 && (
          <span className="trow-bar">
            <span style={{ width: `${pct}%` }} />
          </span>
        )}
      </span>
      <span className="trow-icon">{hasSubs && <SubtitlesIcon />}</span>
      <span className="trow-time">{clock(g.duration)}</span>
      {trackMenu}
    </div>
  )
}

function Section({ w, title, groups }: { w: WorkDetail; title?: string; groups: TrackGroup[] }): JSX.Element | null {
  const now = useStore((s) => s.now)
  const playing = useStore((s) => s.playing)
  if (!groups.length) return null
  return (
    <>
      {title && <h3 className="tsection">{title}</h3>}
      {groups.map((g, i) => (
        <TrackRow key={g.key} w={w} g={g} n={i + 1} current={now?.work.id === w.id && now.groupKey === g.key} playing={playing} />
      ))}
    </>
  )
}

export default function WorkPage(): JSX.Element | null {
  const w = useStore((s) => s.shown)
  const works = useStore((s) => s.works)
  const now = useStore((s) => s.now)
  const playing = useStore((s) => s.playing)
  const settings = useStore((s) => s.settings)
  const narrow = useNarrow()
  if (!w) return null
  const sum = works.find((x) => x.id === w.id)
  const fav = sum?.favorite ?? w.favorite
  const rank = sum?.rank ?? w.rank
  const groupIds = sum?.groupIds ?? w.groupIds
  const main = w.groups.filter((g) => g.role === 'main')
  const total = main.reduce((n, g) => n + (g.duration ?? 0), 0)
  const here = now?.work.id === w.id
  const target = resumeTarget(w)
  const resumeOk = useStore((s) => s.settings?.resume ?? true)
  const resumable = resumeOk && !!target && target.position > 3 && !target.finished
  const coverUrl = w.cover ? window.api.thumbUrl(w.cover) : null

  const top = (
    <>
      {/* top edge: way back on the left, file actions on the right */}
      <div className="wp-top">
        <div className="flat-group">
          <button className="mini icon" title="뒤로 (Alt+←, 마우스 뒤로 버튼)" onClick={() => void useStore.getState().navBack()}>
            <KeyboardArrowLeftIcon />
          </button>
        </div>
        <div className="flat-group">
          {w.code && (
            <button
              className="mini icon"
              title="DLsite에서 제목 · 서클 · 성우 가져오기"
              onClick={async () => {
                const r = await window.api.fetchDlsite([w.id])
                useStore.getState().showToast(r)
                await useStore.getState().refreshWork(w.id)
                void useStore.getState().loadWorks()
              }}
            >
              <CloudDownloadIcon />
            </button>
          )}
          <AutoSubButton w={w} />
          <button
            className="mini icon"
            title="이름 번역 (작품 제목 · 트랙 이름, 표시만)"
            onClick={async () => {
              const st = useStore.getState()
              const r = await window.api.translateNames(w.id)
              st.showToast(r.ok && st.settings?.nameDisplay !== 'translated' ? { ...r, message: `${r.message} — 설정 › 이름 표시에서 번역한 이름을 고르면 보입니다` } : r)
              void st.loadWorks()
              void st.refreshWork(w.id)
            }}
          >
            <TranslateIcon />
          </button>
          <button
            className="mini icon"
            title="폴더 열기"
            onClick={() => void window.api.showInFolder(w.groups[0]?.versions[0]?.path ?? w.path)}
          >
            <FolderOpenIcon />
          </button>
          {!narrow && (
            <button
              className="mini icon"
              title="파일 정리 (썸네일 · wav · 이름 복구)"
              onClick={() => useStore.setState({ toolsScope: [w.id], view: 'tools' })}
            >
              <CleaningServicesIcon />
            </button>
          )}
          <button
            className="mini icon"
            title="듣기 기록을 지우고 처음부터"
            onClick={async () => {
              await window.api.resetProgress(w.id)
              await useStore.getState().refreshWork(w.id)
              void useStore.getState().loadWorks()
            }}
          >
            <HistoryIcon />
          </button>
        </div>
      </div>
    </>
  )
  const playBtn = (
    <>
      <button
        className="btn primary play-main"
        title={here ? (playing ? '일시정지' : '계속 재생') : resumable ? '이어 듣기' : '재생'}
        onClick={() => (here ? toggle() : target && void play(w, target.key))}
      >
        {here && playing ? <PauseIcon /> : <PlayArrowIcon />}
      </button>
    </>
  )
  const shuffle = (
    <>
      <div className="flat-group">
        <button
          className={`mini icon ${settings?.shuffle ? 'on' : ''}`}
          title="무작위 재생"
          onClick={() => void useStore.getState().saveSettings({ shuffle: !settings?.shuffle })}
        >
          <ShuffleIcon />
        </button>
      </div>
    </>
  )
  // the track: its name in the big window, its place ("트랙 2") in the small one
  const nameOf = (key: string, title: string): string => (narrow ? trackLabel(w, key) : title)
  const resume = (
    <>
      <span className="wp-resume hint">
        {here
          ? `${playing ? '재생 중' : '일시정지'} · ${nameOf(now!.groupKey, w.groups.find((g) => g.key === now!.groupKey)?.title ?? '')}`
          : target && (resumable ? `이어 듣기 · ${nameOf(target.key, target.title)} ${clock(target.position)}부터` : `재생 · ${nameOf(target.key, target.title)}부터`)}
      </span>
    </>
  )
  const kind = [w.code, ...contentLabels(w.content, w.lang)].filter(Boolean).join(' · ')
  const prefs = (
    <>
      {w.hasSeChoice && (
        <div className="flat-group">
          {(['on', 'off'] as const).map((se) => (
            <button
              key={se}
              className={`mini ${w.sePref === se ? 'on' : ''}`}
              onClick={async () => {
                await window.api.setWorkPrefs(w.id, { sePref: se })
                await afterPrefs(w)
              }}
            >
              {se === 'on' ? 'SE 포함' : 'SE 제외'}
            </button>
          ))}
        </div>
      )}
      {w.editions.length > 0 && (
        <Dropdown<string>
          kind="mini"
          title="판"
          value={w.edition}
          options={w.editions.map((e) => [e.key, e.label] as const)}
          onChange={async (v) => {
            await window.api.setWorkPrefs(w.id, { edition: v })
            await afterPrefs(w)
          }}
        />
      )}
    </>
  )
  const table = (
    <>
      <div className="ttable">
        <div className="thead">
          <span className="trow-n">#</span>
          <span className="trow-main">제목</span>
          <span className="trow-icon" title="자막">
            <SubtitlesIcon />
          </span>
          <span className="trow-time" title="길이">
            <ScheduleIcon />
          </span>
        </div>
        <Section w={w} groups={main} />
        <Section w={w} title="부록" groups={w.groups.filter((g) => g.role === 'extra')} />
        <Section w={w} title="샘플" groups={w.groups.filter((g) => g.role === 'sample')} />
      </div>
    </>
  )

  // narrow window (Halftone side panel): Spotify's album page on mobile —
  // centred cover, title, people, meta; ♥ · 그룹 · 별점 left and shuffle +
  // the big play right; then SE / 판 and the track list.
  if (narrow)
    return (
      <div className="workpage mwork">
        {coverUrl && <div className="mw-bg" style={{ backgroundImage: `url("${coverUrl}")` }} />}
        {top}
        <div className="mw-cover">{coverUrl ? <img src={coverUrl} alt="" draggable={false} /> : null}</div>
        <div className="mw-collect">
          <Stars id={w.id} rank={rank} />
          <div className="flat-group">
            <GroupButton id={w.id} groupIds={groupIds} />
            <FavButton id={w.id} on={fav} />
          </div>
        </div>
        <h1 className="mw-title selectable">{w.title}</h1>
        {(w.circle || w.voices.length > 0) && (
          <div className="mw-people">
            {w.circle && <b>{w.circle}</b>}
            {w.circle && w.voices.length > 0 && ' · '}
            {w.voices.length > 0 && <b>{w.voices.join(', ')}</b>}
          </div>
        )}
        <div className="mw-meta">{[kind, length(total)].filter(Boolean).join(' · ')}</div>
        <TagLine tags={w.tags} className="mw-tags" all />
        <div className="mw-actions">
          {playBtn}
          {shuffle}
          {resume}
        </div>
        {(w.hasSeChoice || w.editions.length > 0) && <div className="mw-prefs">{prefs}</div>}
        <div className="mw-count">
          <hr />
          <span>총 {main.length}트랙</span>
        </div>
        {table}
      </div>
    )

  return (
    <div className="workpage">
      <div className="wp-head">
        {coverUrl && <div className="wp-backdrop" style={{ backgroundImage: `url("${coverUrl}")` }} />}
        {top}
        <div className="wp-main">
          <div className="wp-cover">{coverUrl ? <img src={coverUrl} alt="" draggable={false} /> : null}</div>
          <div className="wp-info">
            {kind && <div className="wp-kind">{kind}</div>}
            <h1 className="wp-title selectable">{w.title}</h1>
            <div className="wp-meta">
              {main.length}트랙 · {length(total) || '길이 미확인'}
            </div>
            {(w.circle || w.voices.length > 0) && (
              <div className="wp-people">
                {w.circle && (
                  <>
                    서클 <b>{w.circle}</b>
                  </>
                )}
                {w.circle && w.voices.length > 0 && ' · '}
                {w.voices.length > 0 && (
                  <>
                    성우 <b>{w.voices.join(', ')}</b>
                  </>
                )}
              </div>
            )}
            <TagLine tags={w.tags} className="wp-tags" all />
            <div className="wp-collect">
              <Stars id={w.id} rank={rank} />
              <div className="flat-group">
                <GroupButton id={w.id} groupIds={groupIds} />
                <FavButton id={w.id} on={fav} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="wp-actions">
        {playBtn}
        {shuffle}
        {resume}
        <span className="grow" />
        {prefs}
      </div>

      {table}
    </div>
  )
}
