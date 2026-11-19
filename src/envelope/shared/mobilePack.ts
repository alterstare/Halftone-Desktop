// 모바일 정보 파일 / 모바일 변경 파일 — how Envelope (PC) and Envelope 모바일
// share a library folder on the NAS, the same way Sorta and Sorta 모바일 do.
// IDENTICAL FILE in both repos (doujin_player, doujin_player mobile) — change both.
//
// PC → phone: `<라이브러리 폴더>/.envelope/mobile.envpack` (gzip JSON, MobilePack):
//   the works as Envelope shows them (repaired / translated names, lengths,
//   DLsite info) and what the user did with them (즐겨찾기, 평점, 그룹, 이어 듣기,
//   북마크, 자막 싱크 …). Covers in `.envelope/covers/`, the program's subtitles
//   in `.envelope/subs/` (files named by their content, so unchanged ones aren't
//   written again). Rewritten when something changed.
// phone → PC: `.envelope/mobile/<device>-<time>.json` (MobileEditFile), one file
//   per batch, never rewritten. Envelope applies the edits, deletes the file and
//   writes the pack again. Until then the phone lays its edits over the pack.
//
// Every path is relative to the library folder, '/'-separated. Works are named
// by that path (`rel`; a work split by file codes is "<folder>|<code>"),
// groups by name (ids differ between the two).

import type { Se, SubLang, TrackRole, WorkAge, WorkContent, WorkLang, SePref } from './types'

export const PACK_DIR = '.envelope'
export const PACK_FILE = '.envelope/mobile.envpack'
export const PACK_COVERS = '.envelope/covers'
export const PACK_SUBS = '.envelope/subs'
export const PACK_EDITS = '.envelope/mobile'
export const PACK_FORMAT = 'envelope-mobile'
export const PACK_VERSION = 1
export const EDITS_FORMAT = 'envelope-mobile-edits'

export interface PackSub {
  rel: string // file next to the audio, or "envsub:<lang>:<track rel>" (text in MobilePack.subs)
  lang: SubLang | null
}

export interface PackTrack {
  id: number // Envelope's track id
  rel: string
  title: string // shown name (repaired; translated when Envelope shows translations)
  ext: string // '.mp3'
  kind: 'audio' | 'video'
  role: TrackRole
  edition: string
  editionKey: string
  se: Se
  formatDir: string
  groupKey: string // equal for versions of one track
  sort: number
  duration: number | null
  bitrate: number | null
  relDir: string
  subs: PackSub[]
}

export interface PackBookmark {
  groupKey: string
  position: number
  name: string
  createdAt: number
}

export interface PackProgress {
  position: number
  duration: number | null
  at: number // when it was played (the newer side wins)
}

export interface PackWork {
  id: number // Envelope's work id
  rel: string
  code: string | null
  title: string // as Envelope shows it
  folderTitle: string
  dlTitle: string | null
  cover: string | null // .envelope/covers/<file>.jpg
  images: string[] // background pictures in the work folder
  addedAt: number
  circle: string | null
  voices: string[]
  tags: { ko: string; ja: string }[]
  content: WorkContent
  age: WorkAge
  lang: WorkLang
  mojibake: boolean
  // what the user did (shared both ways)
  sePref: SePref | null
  edition: string | null
  favorite: boolean
  rank: number
  plays: number
  lastPlayedAt: number | null
  lastGroup: string | null
  groups: string[] // group names
  progress: Record<string, PackProgress>
  offsets: Record<string, number>
  bookmarks: PackBookmark[]
  tracks: PackTrack[]
}

export interface MobilePack {
  format: typeof PACK_FORMAT
  v: number
  createdAt: number
  app: string // "Envelope 0.1.2"
  groups: string[] // every group name, in Envelope's order
  works: PackWork[]
  subs: Record<string, Record<string, string>> // track rel → lang → .envelope/subs/<file>.vtt
}

// ---- phone → PC ----

// A work's settings as the phone left them; fields left out are unchanged.
export interface MobileWorkState {
  favorite?: boolean
  rank?: number
  groups?: string[]
  sePref?: SePref | null
  edition?: string | null
}

export type MobileEdit =
  | { op: 'work'; at: number; work: string; set: MobileWorkState }
  | { op: 'progress'; at: number; work: string; groupKey: string; position: number; duration: number | null }
  | { op: 'reset'; at: number; work: string } // 처음부터: progress forgotten
  | { op: 'play'; at: number; work: string } // 감상 횟수 +1
  | { op: 'offset'; at: number; work: string; groupKey: string; offset: number }
  | { op: 'bookmark'; at: number; work: string; action: 'add' | 'delete'; groupKey: string; position: number; name?: string }
  | { op: 'group'; at: number; action: 'create' | 'rename' | 'delete'; name: string; to?: string }

export interface MobileEditFile {
  format: typeof EDITS_FORMAT
  version: number
  device: string
  createdAt: number
  basedOn: number // createdAt of the pack the phone had
  edits: MobileEdit[]
}

// Same bookmark (a bookmark has no shared id): same track, within half a second.
export const sameBookmark = (a: { groupKey: string; position: number }, b: { groupKey: string; position: number }): boolean =>
  a.groupKey === b.groupKey && Math.abs(a.position - b.position) < 0.5
