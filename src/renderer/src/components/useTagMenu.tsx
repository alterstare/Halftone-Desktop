import { useState } from 'react'
import type { JSX, MouseEvent } from 'react'
import { useStore } from '../store'
import ContextMenu from './ContextMenu'
import { ContentCopyIcon, LanguageIcon, SearchIcon, StarIcon, BlockIcon } from './icons'

// Right-click menu shared by every tag / artist chip in the app:
//   • "로컬에서 검색" / "온라인에서 검색" — both on every chip, local or online,
//   • "복사" — the tag / artist text as shown,
//   • "즐겨찾는 태그로 추가" — highlight the raw tag everywhere,
//   • (doujin only) "검색 제외 태그로 추가/에서 빼기" — 설정 › 검색 제외 태그,
//     hidden from online browse/search.
//
// Usage:
//   const { openTagMenu, tagMenu } = useTagMenu()
//   <span onContextMenu={(e) => openTagMenu(e, tagToken(t), t)}>…</span>
//   …
//   {tagMenu}   ← render once, anywhere inside the component
//
// `query` is the search token (e.g. "artist:foo", "female:bar"); `raw` is the
// tag text as shown, used for the favorite-tag list.
export function useTagMenu(): {
  openTagMenu: (e: MouseEvent, query: string, raw: string) => void
  tagMenu: JSX.Element | null
} {
  const [menu, setMenu] = useState<{ x: number; y: number; query: string; raw: string } | null>(null)
  const searchOnline = useStore((s) => s.searchOnline)
  const searchLocal = useStore((s) => s.searchLocal)
  const addFavoriteTag = useStore((s) => s.addFavoriteTag)
  const toggleExcludeTag = useStore((s) => s.toggleExcludeTag)
  const excludeTags = useStore((s) => s.settings.onlineExcludeTags)
  const doujinMode = useStore((s) => s.libraryMode !== 'normal')

  const openTagMenu = (e: MouseEvent, query: string, raw: string): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, query, raw })
  }

  const tagMenu = menu && (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      items={[
        { label: '로컬에서 검색', icon: <SearchIcon />, onClick: () => searchLocal(menu.query) },
        { label: '온라인에서 검색', icon: <LanguageIcon />, onClick: () => searchOnline(menu.query) },
        { label: '복사', icon: <ContentCopyIcon />, onClick: () => void window.api.clipboardWriteText(menu.raw) },
        { label: '즐겨찾는 태그로 추가', icon: <StarIcon />, onClick: () => addFavoriteTag(menu.raw) },
        ...(doujinMode
          ? [
              {
                label: (excludeTags ?? []).includes(menu.query) ? '검색 제외 태그에서 빼기' : '검색 제외 태그로 추가',
                icon: <BlockIcon />,
                onClick: () => toggleExcludeTag(menu.query)
              }
            ]
          : [])
      ]}
      onClose={() => setMenu(null)}
    />
  )

  return { openTagMenu, tagMenu }
}
