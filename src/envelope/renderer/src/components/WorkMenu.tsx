// Right-click menus for the library (a work = an album) and the work page's
// track list. Same component and order of things as Sorta's / Halftone's
// menus: play first, then where it goes (작품 열기), collecting (즐겨찾기 ·
// 그룹 · 별점), then copying and the folder.
import { useCallback, useState } from 'react'
import type { JSX, MouseEvent } from 'react'
import { useStore } from '../store'
import { play, playWork } from '../player'
import type { TrackGroup, WorkDetail, WorkSummary } from '../../../shared/types'
import ContextMenu from './ContextMenu'
import type { MenuItem } from './ContextMenu'
import {
  AddIcon,
  AlbumIcon,
  CheckIcon,
  ContentCopyIcon,
  FavoriteIcon,
  FavoriteOutlineIcon,
  FolderOpenIcon,
  LabelIcon,
  PlayArrowIcon,
  RestartAltIcon,
  StarIcon,
  SubtitlesIcon
} from './icons'

const copy = (text: string, what: string): void => {
  void navigator.clipboard.writeText(text).then(
    () => useStore.getState().showToast({ ok: true, message: `${what}을 복사했습니다.` }),
    () => useStore.getState().showToast({ ok: false, message: '복사하지 못했습니다.' })
  )
}

// the work's first main track, from the top
async function playFromStart(id: number): Promise<void> {
  const w = await window.api.work(id)
  const g = w && (w.groups.find((x) => x.role === 'main') ?? w.groups[0])
  if (w && g) await play(w, g.key, { at: 0 })
}

function workItems(w: WorkSummary): MenuItem[] {
  const st = useStore.getState()
  const resume = (st.settings?.resume ?? true) && w.played > 0 && w.finished < w.tracks
  const patch = st.patchWork
  const setGroup = async (g: number, on: boolean): Promise<void> => {
    await window.api.setGroupMembership([w.id], g, on)
    patch(w.id, { groupIds: on ? [...w.groupIds, g] : w.groupIds.filter((x) => x !== g) })
    void st.loadGroups()
  }
  const setRank = (r: number): void => {
    void window.api.setRank([w.id], r)
    patch(w.id, { rank: r })
  }
  return [
    { label: resume ? '이어 듣기' : '재생', icon: <PlayArrowIcon />, onClick: () => void playWork(w.id) },
    { label: '처음부터 재생', icon: <RestartAltIcon />, onClick: () => void playFromStart(w.id) },
    { label: '작품 열기', icon: <AlbumIcon />, separator: true, onClick: () => void st.openWork(w.id) },
    {
      label: w.favorite ? '즐겨찾기 해제' : '즐겨찾기에 추가',
      icon: w.favorite ? <FavoriteIcon /> : <FavoriteOutlineIcon />,
      separator: true,
      onClick: () => {
        void window.api.setFavorite([w.id], !w.favorite)
        patch(w.id, { favorite: !w.favorite })
      }
    },
    {
      label: '그룹',
      icon: <LabelIcon />,
      children: [
        ...st.groups.map((g) => {
          const on = w.groupIds.includes(g.id)
          return { label: g.name, icon: on ? <CheckIcon /> : undefined, checked: on, onClick: () => void setGroup(g.id, !on) }
        }),
        {
          label: '새 그룹…',
          icon: <AddIcon />,
          separator: st.groups.length > 0,
          // the card's own 그룹 pop-up, with its name field
          onClick: () => (document.querySelector(`[data-wid="${w.id}"] .grp-btn`) as HTMLElement | null)?.click()
        }
      ]
    },
    {
      label: '별점',
      icon: <StarIcon />,
      children: [
        ...[5, 4, 3, 2, 1].map((r) => ({ label: `${r}점`, icon: w.rank === r ? <CheckIcon /> : undefined, checked: w.rank === r, onClick: () => setRank(r) })),
        { label: '별점 지우기', separator: true, disabled: !w.rank, onClick: () => setRank(0) }
      ]
    },
    { label: '제목 복사', icon: <ContentCopyIcon />, separator: true, onClick: () => copy(w.title, '제목') },
    ...(w.code ? [{ label: '작품 코드 복사', icon: <ContentCopyIcon />, onClick: () => copy(w.code!, '작품 코드') }] : []),
    { label: '폴더 열기', icon: <FolderOpenIcon />, onClick: () => void window.api.showInFolder(w.path) }
  ]
}

function trackItems(w: WorkDetail, g: TrackGroup, current: boolean): MenuItem[] {
  const v = g.versions.find((x) => x.id === g.chosen) ?? g.versions[0]
  return [
    { label: '이 트랙 재생', icon: <PlayArrowIcon />, onClick: () => void play(w, g.key) },
    { label: '처음부터 재생', icon: <RestartAltIcon />, onClick: () => void play(w, g.key, { at: 0 }) },
    {
      label: '자막 편집',
      icon: <SubtitlesIcon />,
      separator: true,
      onClick: async () => {
        // the editor works on what is playing: start this track first
        if (!current) await play(w, g.key, { autoplay: false })
        useStore.setState({ editing: true })
        useStore.getState().setView('now')
      }
    },
    { label: '트랙 이름 복사', icon: <ContentCopyIcon />, separator: true, onClick: () => copy(g.title, '트랙 이름') },
    ...(v ? [{ label: '폴더에서 보기', icon: <FolderOpenIcon />, onClick: () => void window.api.showInFolder(v.path) }] : [])
  ]
}

type Open = { x: number; y: number; items: MenuItem[] } | null

function useMenu(): { menu: JSX.Element | null; show: (e: MouseEvent, items: MenuItem[]) => void } {
  const [m, setM] = useState<Open>(null)
  const close = useCallback(() => setM(null), [])
  const show = (e: MouseEvent, items: MenuItem[]): void => {
    e.preventDefault()
    e.stopPropagation()
    setM({ x: e.clientX, y: e.clientY, items })
  }
  return { menu: m && <ContextMenu x={m.x} y={m.y} items={m.items} onClose={close} />, show }
}

// cards, list rows, the 이어 듣기 shelf
export function useWorkMenu(): { workMenu: JSX.Element | null; openWorkMenu: (e: MouseEvent, w: WorkSummary) => void } {
  const { menu, show } = useMenu()
  return { workMenu: menu, openWorkMenu: (e, w) => show(e, workItems(w)) }
}

// the work page's track list
export function useTrackMenu(): { trackMenu: JSX.Element | null; openTrackMenu: (e: MouseEvent, w: WorkDetail, g: TrackGroup, current: boolean) => void } {
  const { menu, show } = useMenu()
  return { trackMenu: menu, openTrackMenu: (e, w, g, current) => show(e, trackItems(w, g, current)) }
}
