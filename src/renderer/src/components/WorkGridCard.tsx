import type { JSX } from 'react'
import type { Work } from '../../../shared/types'
import { useStore } from '../store'
import { allTags, tagToken } from '../util'
import Thumb from './Thumb'
import { ArtistLine } from './ArtistLinks'
import Stars from './Stars'
import TagList from './TagList'
import FavGroup from './FavGroup'
import { useWorkCard } from './useWorkCard'

// Grid tile for a local work on the home library (image-forward). Fixed height:
// thumb · rating/favorite · title (≤2 lines) · meta · artist (1 line) · 5 tag rows (6 when a
// 1-line title and no artist leave room) — see
// .gtile in styles.css. Behavior is shared with the list card via useWorkCard.
export default function WorkGridCard({ work }: { work: Work }): JSX.Element {
  const setFilter = useStore((s) => s.setFilter)
  const addSearchToken = useStore((s) => s.addSearchToken)
  const favoriteTags = useStore((s) => s.settings.favoriteTags)
  const c = useWorkCard(work)

  return (
    <div className={`gtile ${c.selected ? 'selected' : ''}`} {...c.cardEvents} data-card-tip={work.title}>
      <div className="gtile-thumb" data-tip-off>
        <Thumb workId={work.id} />
      </div>
      <div className="gtile-foot" onClick={(e) => e.stopPropagation()}>
        <Stars rank={work.rank} onChange={c.setRank} />
        <FavGroup favorite={c.isFav} onToggle={c.toggleFav} work={work} />
      </div>
      <div className="gtile-title selectable">{work.title}</div>
      <div className="gtile-meta">
        {work.pageCount}p
        {work.code && (
          <>
            {' · '}
            <span
              className="code copyable"
              onClick={(e) => {
                e.stopPropagation()
                navigator.clipboard?.writeText(work.code!)
              }}
            >
              [{work.code}]
            </span>
          </>
        )}
        {work.language && ` · ${work.language}`}
      </div>
      {/* One line (+N for more artists); left out when there is no artist —
          the tile keeps its height, the spare space goes to the bottom. */}
      {work.artist && (
        <ArtistLine
          artist={work.artist}
          onPick={(a) => setFilter({ kind: 'artist', value: a })}
          onMenu={(a, e) => c.openTagMenu(e, tagToken(`artist:${a}`), a)}
        />
      )}
      <div className="gtile-tags">
        <TagList
          tags={allTags(work)}
          favoriteTags={favoriteTags}
          manualTags={work.manualTags}
          onTagClick={(t) => addSearchToken(tagToken(t))}
          onTagContext={(t, e) => c.openTagMenu(e, tagToken(t), t)}
          onRemove={c.removeTag}
          onAddClick={c.adding ? undefined : c.startAddTag}
          lines={6}
        />
        {c.tagInput}
      </div>
      {c.workMenu}
      {c.tagMenu}
    </div>
  )
}
