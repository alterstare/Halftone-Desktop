// 중복 작품: the same release found more than once in the library — the same
// work code (RJ…) in two folders, or, for works without a code, the same
// title (brackets, spaces and punctuation aside). 따로 두기 (파일 정리 ›
// 폴더 변경) moves a copy into <library folder>/_중복 작품/ — never deletes;
// the scan skips that folder, so the copy leaves the library, and 되돌리기
// moves it back. 중복 아님 remembers a group as distinct.
import { existsSync, promises as fsp } from 'fs'
import { basename, dirname, join } from 'path'
import type { DupGroup, DupMember, SetAsideItem, ToolResult } from '../shared/types'
import type { Db } from './db'
import type { ActionLog } from './actionLog'
import type { JobContext } from './queue'
import { nfkc } from './names/normalize'

export const DUP_DIR = '_중복 작품'
const SET_ASIDE = 'tools.setaside'
const NOT_DUP = 'dups.notdup'

// A title without its brackets, spaces and punctuation; too short to tell
// works apart → null.
export function titleKey(title: string): string | null {
  const t = nfkc(title)
    .toLowerCase()
    .replace(/[[(【「『（〔<＜][^\])】」』）〕>＞]*[\])】」』）〕>＞]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '')
  return t.length >= 4 ? t : null
}

const groupId = (key: string, ids: number[]): string => `${key}|${[...ids].sort((a, b) => a - b).join(',')}`

export function duplicateGroups(db: Db): DupGroup[] {
  const works = db
    .prepare('SELECT id, code, title, favorite, rank, last_played_at AS played FROM works ORDER BY id')
    .all() as { id: number; code: string | null; title: string; favorite: number; rank: number; played: number | null }[]
  const stats = new Map(
    (
      db
        .prepare(
          `SELECT work_id AS id, COUNT(*) AS files, COALESCE(SUM(size), 0) AS size, GROUP_CONCAT(DISTINCT ext) AS exts,
                  COUNT(DISTINCT CASE WHEN role = 'main' THEN group_key END) AS tracks
           FROM tracks GROUP BY work_id`
        )
        .all() as { id: number; files: number; size: number; exts: string | null; tracks: number }[]
    ).map((r) => [r.id, r])
  )
  const byKey = new Map<string, { label: string; ids: number[] }>()
  for (const w of works) {
    const tk = w.code ? null : titleKey(w.title)
    const key = w.code ? w.code.toUpperCase() : tk ? `title:${tk}` : null
    if (!key) continue
    const g = byKey.get(key) ?? { label: w.code ? w.code.toUpperCase() : w.title, ids: [] }
    g.ids.push(w.id)
    if (!w.code && w.title.length < g.label.length) g.label = w.title // the plainest title names the group
    byKey.set(key, g)
  }
  const ignored = new Set((db.prepare('SELECT key FROM dup_ignore').all() as { key: string }[]).map((r) => r.key))
  const info = new Map(works.map((w) => [w.id, w]))
  const out: DupGroup[] = []
  for (const [key, g] of byKey) {
    if (g.ids.length < 2 || ignored.has(groupId(key, g.ids))) continue
    const members: DupMember[] = g.ids.map((id) => {
      const s = stats.get(id)
      return {
        id,
        tracks: s?.tracks ?? 0,
        files: s?.files ?? 0,
        size: s?.size ?? 0,
        formats: (s?.exts ?? '').split(',').filter(Boolean).sort()
      }
    })
    // Keep first: the most tracks, then the one listened to / marked, then the
    // biggest.
    const used = (id: number): number => {
      const w = info.get(id)!
      return w.favorite || w.rank > 0 || w.played ? 1 : 0
    }
    members.sort((a, b) => b.tracks - a.tracks || used(b.id) - used(a.id) || b.size - a.size || a.id - b.id)
    out.push({ key, label: g.label, members })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

// 중복 아님: the group as it is now is never shown again (one undo step).
export function markNotDuplicate(db: Db, log: ActionLog, key: string, ids: number[], label: string): void {
  const k = groupId(key, ids)
  db.prepare('INSERT OR IGNORE INTO dup_ignore (key, created_at) VALUES (?, ?)').run(k, Date.now())
  log.record(NOT_DUP, { label: `중복 아님 · ${label}`, key: k })
}

// Where each work folder would go (nothing moves yet).
export function planSetAside(db: Db, ids: number[]): SetAsideItem[] {
  const taken = new Set<string>()
  const out: SetAsideItem[] = []
  for (const id of ids) {
    const w = db.prepare('SELECT path, root FROM works WHERE id = ?').get(id) as { path: string; root: string } | undefined
    if (!w) continue
    const base = join(w.root, DUP_DIR, basename(w.path))
    let to = base
    for (let n = 2; existsSync(to) || taken.has(to.toLowerCase()); n++) to = `${base} (${n})`
    taken.add(to.toLowerCase())
    out.push({ workId: id, from: w.path, to })
  }
  return out
}

// Move them (same library folder → a rename, nothing copied). One undo step.
export async function runSetAside(log: ActionLog, items: SetAsideItem[], ctx: JobContext): Promise<ToolResult> {
  const moved: { from: string; to: string }[] = []
  const failed: string[] = []
  for (let i = 0; i < items.length; i++) {
    ctx.report(i, items.length)
    const it = items[i]
    try {
      if (existsSync(it.to)) throw new Error('같은 이름의 폴더가 이미 있습니다')
      await fsp.mkdir(dirname(it.to), { recursive: true })
      await fsp.rename(it.from, it.to)
      moved.push({ from: it.from, to: it.to })
    } catch (e) {
      failed.push(`${basename(it.from)}: ${String((e as Error)?.message ?? e)}`)
    }
  }
  ctx.report(items.length, items.length)
  if (moved.length) log.record(SET_ASIDE, { label: `중복 작품 따로 두기`, items: moved })
  return {
    ok: !failed.length,
    message: `${moved.length}개 작품을 "${DUP_DIR}" 폴더로 옮겼습니다${failed.length ? ` · ${failed.length}개 실패` : ''}`,
    done: moved.length,
    failed
  }
}

export function registerDupUndo(db: Db, log: ActionLog): void {
  // back where they were (newest first); the scan after it brings them in
  // (redo: the same moves the other way)
  log.register<{ label: string; items: { from: string; to: string }[] }>(
    SET_ASIDE,
    async (p) => {
      for (const it of [...p.items].reverse()) {
        if (!existsSync(it.to) || existsSync(it.from)) continue
        await fsp.mkdir(dirname(it.from), { recursive: true })
        await fsp.rename(it.to, it.from)
      }
    },
    (p) => ({ ...p, items: p.items.map((it) => ({ from: it.to, to: it.from })) })
  )
  log.register<{ label: string; key: string }>(NOT_DUP, async (p) => {
    db.prepare('DELETE FROM dup_ignore WHERE key = ?').run(p.key)
  })
}
