# Halftone (manga-viewer-2) — Developer / AI Handoff Notes

Windows Electron manga viewer. Two independent library modes: **doujin** (coded
doujinshi galleries, downloaded from the site) and **normal** (general manga /
webtoons scraped from manga-site family sites + a gnuboard "backup" site). This file
documents the conventions, architecture, and design tokens needed to keep coding
in a fresh context without re-deriving everything.

---

## 1. Stack & build

- **electron-vite** project.
  - `src/main` → main process (Node, CJS at runtime).
  - `src/preload` → preload bridge (`.mjs`).
  - `src/renderer` → React 19 + TypeScript, ESM.
  - `src/shared` → types + IPC contract shared by main & renderer.
- Language: **TypeScript, strict**. `tsc` with `noUnusedLocals` — remove unused
  imports/vars or the typecheck fails.
- Commands (run from the project dir — **cwd resets to `C:\Users\noth2\Desktop\code`
  which has no package.json**, so always `cd` in first):
  ```bash
  cd /c/Users/noth2/Desktop/code/manga-viewer-2 && npm run typecheck
  cd /c/Users/noth2/Desktop/code/manga-viewer-2 && npm run build
  ```
  - `typecheck` = `tsc --noEmit` for `tsconfig.node.json` (main/preload),
    `tsconfig.web.json` (renderer), `tsconfig.sorta.json` (embedded Sorta
    renderer, §12) and `tsconfig.envelope.json` (embedded Envelope renderer, §13). **Run it after every change.**
  - `build` = electron-vite production build (fast, ~900ms). Use to sanity-check.
  - Packaging: `npm run dist` (electron-builder). winCodeSign symlink step needs
    Developer Mode or admin — not needed for normal dev.
- App `userData`: `%APPDATA%/Halftone/` (packaged) / `%APPDATA%/Halftone-dev/` (dev),
  pinned in `src/main/lib/appPaths.ts`, which moves the pre-rename folder
  (`MangaManager` / `manga-manager`) into place once — holds `works.json`
  (scanned library) and `settings.json`.

---

## 2. Main process layout & IPC pattern

`src/main/index.ts` is ONLY app lifecycle (window, single-instance lock,
auto-update, startup migrations) and registers the IPC modules:

| file | handles |
|---|---|
| `main/context.ts` | shared `store`, `appState` (closing/quitting), `getMainWindow`, `sendToRenderer` |
| `main/ipc/library.ts` | settings, scan, works (rank/groups/tags/views), folders, thumbnails, translation, exports, exit/reset |
| `main/ipc/favorites.ts` | hearts by code, favorites file (export/import/merge), favorite lists, gallery summaries |
| `main/ipc/doujin.ts` | doujin browse/search, metadata enrich, deleted-sweep, cover regen, download |
| `main/ipc/comic.ts` | general-manga online: list/chapters/images/author/cover, downloads |
| `main/downloads.ts` | `runDownload(code, title, task)` — slot gate, stop, progress for ALL downloads |
| `main/lib/media.ts` | `mangaimg://` protocol, url encoders, thumbnail cache files |
| `main/lib/favoriteSync.ts` | the favorites model (see §10) |

Adding a channel — three files move in lockstep:

1. **`src/shared/ipc.ts`** — channel string in the `IPC` map (`myThing: 'ns:myThing'`)
   and the typed method in the `Api` interface. Shared DTOs live here too.
2. **`src/preload/index.ts`** — `myThing: (arg) => invoke(IPC.myThing, arg)`.
   `invoke` wraps `ipcRenderer.invoke` and strips Electron's "Error invoking
   remote method '…': Error:" prefix, so a rejected call's `e.message` is the
   main-process message as written (show it as is). Events main→renderer use
   the `on...` + returned-unsubscribe pattern.
3. **`src/main/ipc/<domain>.ts`** — `ipcMain.handle(IPC.myThing, (_e, arg) => ...)`
   inside that module's `register…Ipc()`. Push events with `sendToRenderer`.

Renderer calls everything via `window.api.*` (typed by `Api`).

---

## 3. Renderer state — zustand store (`src/renderer/src/store.ts`)

- Single `useStore` zustand store. State interface + action signatures declared at
  the top half of the file; implementations in the `create(...)` body.
- **`settings` in the store is EFFECTIVE settings** (per-mode overlay already
  merged). `effectiveSettings(raw, mode)` overlays `settings.perMode[mode]` onto the
  base. Keys listed in `SPLIT_SETTING_KEYS` are per-mode; everything else is shared.
  - When adding a setting: if it should differ between doujin/normal, add its key to
    `SPLIT_SETTING_KEYS`; otherwise it's shared (the common case).
- `works: Work[]`, `downloads: DownloadItem[]`, `jobs: Job[]`, `tabs`, etc.
- `addWork(w)` upserts into `works`. `mergeScanPartial` (main side) merges scan
  results.
- Defaults live in `DEFAULT_SETTINGS` (`src/shared/types.ts`). **Every new Settings
  field MUST get a default there**, or older `settings.json` loads with `undefined`
  (guard reads with `?? fallback` anyway).

### Download dispatch is centralized (recent refactor — keep it that way)

All downloads go through **`store.startDownload(spec)`** — never call
`window.api.doujinDownload/comicDownload/...` directly from a component.
```ts
type DownloadSpec =
  | { kind: 'doujin'; input: string; title?: string }
  | { kind: 'comic'; seriesUrl: string; title: string; chapterUrls?: string[] }
  | { kind: 'generic'; title: string; chapters: ComicChapter[]; only?: string[] }
```
- `specCode(spec)` derives the progress code (doujin numeric code / manga-site seriesUrl /
  `backup:<title>`) — must match the `code` main emits on the progress channel.
- `startDownload` seeds a `DownloadItem` (phase `queued`, stores `spec` for
  retry), invokes the right IPC, `addWork`s results, returns `Work[]` — or **`null`
  if the user stopped it** (detected via the `DOWNLOAD_STOPPED` message; callers
  should early-return on null, no error alert).
- Related actions: `stopDownload(code)`, `retryDownload(code)`,
  `stopAllDownloads(mode)`, `startAllDownloads(mode)`.
- Progress events land in `pushDownloadProgress` (wired once in `App.tsx` via
  `onDoujinProgress`). It rebuilds the item from the event but **preserves `spec`**
  from the previous item — keep that when editing.

---

## 4. Downloads: queue, concurrency, cancellation (main)

- Every download (doujin gallery, manga-site series, backup-site chapters) runs through
  **`runDownload(code, title, task)`** in `main/downloads.ts`: waits for a slot
  (`settings.maxConcurrentDownloads`, 0 = unlimited, read per acquire, FIFO),
  wires the stop button to an `AbortSignal`, and reports `queued → fetching →
  (task reports downloading/done) | stopped | error` on the doujinProgress channel.
  The task only reports its own `downloading`/`done`.
- Stop = `stopDownload(code)` (IPC `download:stop`) → abort → `stopped` + rejects
  with `STOP_MSG` (`'DOWNLOAD_STOPPED'`), which the renderer treats as non-error.
- Lib functions take `signal?` and `signal?.throwIfAborted()` per loop step
  (doujin per image, manga-site per chapter). Manga-site chapter images save 4 at a time
  and are resumable (files already on disk are skipped).
- `DoujinProgress.phase`: `'queued' | 'fetching' | 'downloading' | 'enriching' |
  'done' | 'error' | 'stopped'`. Code = doujin code / manga-site seriesUrl / `backup:<title>`.

---

## 5. Scanner & classification (main)

- `scanRoot` / `scanOne` stamp `work.library = 'doujin' | 'normal'` based on **which
  root the folder lives under** (`normalRoots(settings)`), NOT by code presence.
- Doujin gallery-id detection is **pattern-driven** (`src/main/lib/parser.ts`
  `parseName(folderName, patterns)`):
  - User patterns in `settings.doujinNamePatterns` (shared setting), tokens
    `-id-` `-title-` `-artist-` `-group-` `-language-`. `-id-` compiles to `(\d{4,})`
    and is **required for a code** — a folder gets a code only if a pattern matches AND the
    id slot has digits. Prevents incidental 7-digit numbers in titles being read as
    codes.
  - `DEFAULT_DOUJIN_PATTERNS` is the fallback list. Patterns tried in order.
  - Patterns WITHOUT `-id-` (must contain `-title-`) are tried only after every id
    pattern failed: they never give a code (work stays 번호 없는 작품) but split the
    name into title / artist / group; `makeWork` sets title + artist and adds
    `artist:<a>` / `group:<g>` tags (uncoded works only).
  - Only applied when `library === 'doujin'`; normal mode never parses an id.
- Shared pattern util `src/shared/pattern.ts`: `fillNamePattern(pattern, fields)`
  (used for download folder naming + the settings live preview), `langCode(lang)`
  → `KOR/CHN/JPN/ENG/ETC`, `SAMPLE_FIELDS`.
- Download folder naming uses the pattern at `doujinNamePatterns[doujinDownloadPatternIdx]`.

---

## 6. Design system / CSS conventions

- **Single stylesheet**: `src/renderer/src/styles.css`. No CSS modules, no
  Tailwind. Class names are plain kebab-case, component-scoped by prefix
  (`.dl-item-*`, `.pat-row`, `.lib-item`, `.gcard-*`, `.settings .field-input`…).
- **Everything reads CSS variables** — never hard-code a hex. Dark theme flips only
  the tokens via `:root[data-theme='dark']` (set on `<html>` from `settings.theme`).
  Adding a new color = use an existing token.

### Color tokens (light / dark)
| token | light | dark | use |
|---|---|---|---|
| `--bg` | `#f4f5f8` | `#0b0d13` | page background |
| `--bg-1` | `#ffffff` | `#14161d` | primary surface (cards, bars) |
| `--bg-2` | `#f0f1f5` | `#1b1e27` | subtle raised / hover / input bg |
| `--bg-3` | `#e7e9f0` | `#262a35` | deeper fill / thumbnails / track |
| `--line` | `#dedee5` | `#2b3040` | divider / borders |
| `--text` | `#101114` | `#eceef4` | primary text |
| `--text-dim` | `#686b82` | `#9aa0b2` | secondary text |
| `--muted` | `#9497a9` | `#6f7484` | muted / placeholder |
| `--accent` | `#7132f5` | `#8b5cf6` | **brand / primary CTA / links** (Kraken purple) |
| `--accent-2` | `#5741d8` | `#7132f5` | darker purple, secondary accent/border |
| `--accent-deep` | `#5b1ecf` | `#5b1ecf` | deepest purple |
| `--accent-soft` | `rgba(133,91,251,.16)` | `.22` | subtle purple fill |
| `--success` | `#149e61` | `#2fbd80` | positive |
| `--danger` | `#e5484d` | `#ff5d6c` | errors / destructive |
| `--gold` | `#f5a623` | `#ffcc4d` | warning / paused / stars |
| `--panel` | `#ffffff` | `#14161d` | modal/panel surface |

- Shadows: `--shadow-subtle`, `--shadow-micro`. Radius scale: `--r1`=4 `--r2`=6
  `--r3`=8 `--r4`/`--r5`=12 `--r6`=16. **Buttons cap at 12px radius — no pills.** Exception: icon-only
  buttons (`.mini.icon`) are circles (`aspect-ratio: 1; border-radius: 50%`).

Scrollbars: thumb = `--scroll-thumb` (translucent black in light, white in
dark), track transparent — a solid token thumb vanished on same-colour panes.

### Shared UI components (reuse — do NOT hand-roll native controls)
In `src/renderer/src/components/`:
- **`Dropdown<T extends string>`** — styled select. `value`, `options: [val,label][]`,
  `onChange`, `className` (use `"field"` / `"field sm"`). For numeric options, store
  as string and `Number(v)` in onChange. Native `<select>` is not used.
- **`Toggle`** — `checked` / `onChange` switch.
- **`Stepper`** — numeric +/- input.
- **`SettingRow`** — `title` + `desc` + children (the control). Standard settings row.
- **`RadioCards`** (`settings/parts.tsx`) — mutually-exclusive description cards.
- **`Pager`**, **`ContextMenu`**, **`ConfirmModal`**, **`Stars`**, **`CopyCode`**,
  **`Caret`**, **`TagPickInput`**.
- Buttons: `.btn` (`.btn.primary`, `.btn.block`, `.btn.danger`) and `.mini` (compact,
  e.g. list actions). **Custom checkboxes** use the `.pat-check` pattern (a `<button>`
  styled as a box with `.on` state + `::after` checkmark) — never a native checkbox
  when UI consistency matters.

### Korean UI copy
All user-facing strings are Korean. Match surrounding tone (terse, `…` for
in-progress, `✓`/`✗`/`■`/`▶`/`⏸`/`⬇` glyph prefixes for status/actions).

---

## 7. Settings screen

- `components/Settings.tsx` = shell only: draft, unsaved-change guard, save /
  leave-confirm, category tabs. Sections live in `components/settings/`:
  `FolderSection`, `TagSection` (incl. 즐겨찾기 box), `StyleSection`,
  `TranslateSection`, `NetworkSection`, `ManageSection`; shared rows in
  `settings/parts.tsx` (`RadioCards`, `RootList`, `FolderRow`, `ChipList`).
- Sections read/edit through `useSettings()` (`settings/context.ts`):
  `draft`, `patch`, `applySaved`, `isDoujin`, `notify`, `pickDir`, `rescan`.
- All categories render at once; CSS (`.settings-inner[data-show]`) shows the
  active one, so section state and running jobs survive tab switches.

---

## 8. Gotchas / house rules

- **No direct download IPC calls in components** — always `store.startDownload`.
- **Preserve `spec` / fields** when rebuilding items in reducers (progress handler).
- **Every Settings field → add to `DEFAULT_SETTINGS`**; guard reads with `?? default`.
- **`cd` into the project** before npm (cwd resets outside it).
- Typecheck is strict about unused locals — when replacing a selector (e.g. swapping
  `addWork` for `startDownload`), remove the old one.
- Sandbox blocks doujin network in some contexts; real downloads run in the packaged
  app / normal dev run.
- Online list pagination: clear items (`setItems([])`) before fetching the next page
  so the previous page doesn't linger under the loader (Browse.tsx, ComicBrowse.tsx,
  OnlineList.tsx).
- Online list pages go through `pageCache.ts` (`loadPage` / `cachedPage` /
  `prefetchPages`, 5 min, 40 pages): after a page shows, the pages either side
  are fetched ahead, so paging to them shows the list at once (no loader). Keys
  `doujin:<source json>:<page>` (Browse + OnlineList share them) and
  `comic:<base>:<source json>:<page>`; a reload (🌐 pressed again) drops that
  source's pages. Manga-site prefetches go through the scraper's one queue
  (next page first), so a click right after a page shows can wait behind them.
- 폴더 분류 (Home, beside 그룹 분류): the mode's library folders
  (`util.libraryFolders` — doujin: libraryRoots + 작가 폴더 (flattenRoots) + favorites / download /
  language folders; normal: normalRoots + its download folder) with counts;
  a work's folder = the deepest root it is under (`workFolder`, a merged work
  by its first source), '' = 그 밖의 폴더. State `store.folderFilter`
  (folder → shown); online-only favorites show only with every folder on.
- Electron main is CJS at runtime; shared/renderer are ESM. Keep imports path-correct
  (`../../shared/...`).

---

## 9. Key files map

| area | file |
|---|---|
| IPC contract + DTOs | `src/shared/ipc.ts` |
| Settings type + defaults | `src/shared/types.ts` |
| Folder-name pattern util / title matching | `src/shared/pattern.ts`, `src/shared/title.ts` |
| App lifecycle | `src/main/index.ts` |
| IPC handlers | `src/main/ipc/*.ts` (§2) |
| Favorites model | `src/main/lib/favoriteSync.ts` |
| Doujin client (DoH, gg.js, download) | `src/main/lib/doujin.ts` |
| Manga-site scraper (hidden window) | `src/main/lib/comic.ts` |
| Scanner / parser | `src/main/lib/scanner.ts`, `src/main/lib/parser.ts` |
| Renderer store (sections marked) | `src/renderer/src/store.ts` |
| Favorites list builders | `src/renderer/src/favorites.ts` |
| Card behavior hooks | `components/useWorkCard.tsx`, `useSeriesCard.tsx`, `useTagMenu.tsx` |
| Thumbnails | `src/renderer/src/thumbs.ts`, `components/Thumb.tsx` |
| Reader | `components/Reader.tsx` + `components/reader/` |
| Settings | `components/Settings.tsx` + `components/settings/` |
| Styles + theme tokens | `src/renderer/src/styles.css` |

---

## 10. Favorites model (2026-10)

- ONE heart per gallery: works with a doujin code → the favorites list
  (`store.onlineFavs`, keyed by code); every local copy's `Work.favorite`
  mirrors it. Uncoded works keep `Work.favorite`. General manga uses in-app
  lists (`settings.normalFavSeries` / `normalFavChapters`), linked to online manga-site
  favorites (keyed by series url) by normalized title (`titleKey`).
- All heart changes go through main `setFavoriteByCode` / `setWorkFavorite`
  (renderer: `store.toggleUnifiedFav`, `setWorkFavorite`).
- `settings.favoriteMoveToFolder` (default on): heart moves the folder into
  `favoritesDir` (remembers `homePath`), unheart moves it back. A scan only
  ADDS a heart for a work newly found inside `favoritesDir`; it never removes one.
- `settings.groupMoveToFolder` (default on): adding to a group moves the folder
  into `<base>/<group name>/` (`setGroupFolder`), and favorites nest under the
  group folder. Off: membership only, no folder moves, and `Store.reconcile`
  keeps the stored groups instead of reading them from folders.
- 감시 다운로드: `settings.watchTokens` (search tokens, plain names resolve
  like the search box) + `watchLanguages` (korean/english/japanese/other).
  `main/lib/watch.ts` `checkWatch` (IPC `watch:check`): per token
  `fetchTokenIds(tok,'all')`, ids above the stored baseline (`userData/watch.json`
  `seen[token]` = newest id) and not in the library → language from
  `fetchRawGallery` → hits. First check of a token only sets the baseline
  (newest id + `since[token]` = now); later hits must also have an upload
  `date` ≥ since − 1h, and `got` (codes already queued by the watch) is never
  queued again — so deleted works never come back. Removed tokens are pruned. Renderer `watch.ts` `runWatchCheck` queues hits via
  `store.startDownload`; runs once per app start (App init, sessionStorage
  guard vs F5) and from the settings 「지금 확인」 button.
- Favorite lists = `settings.onlineFavLists` ({name, codes}); one favorites
  file format (Pupil-compatible `{favorites, favorite_tags, ranks}`).

## 10b. 작품 통합 (manual collections) & library selection

- Merging keeps folders in place: `settings.manualCollections` ({title, artist,
  library, dirs}); the scanner folds those folders into ONE Work with
  `sources` = the folders (pages concatenated by getWorkImages). Same model as
  the mobile app (`../MangaManagerMobile` merge.ts).
- Renderer `src/renderer/src/merge.ts`: `mergeWorks` / `unmergeWork` /
  `mergeBlocker` → IPC `setCollections(collections, dirs)` saves the setting and
  rescans ONLY those folders (`scanner.scanDirs`; full scan only when
  artist-folder auto collections could regroup them — `needsFullScan`).
- **A merged work's `path` is the PARENT of its folders** (often a library root /
  favorites dir). Anything that moves or deletes folders must use `sources`:
  deleteWork trashes the sources (and drops the collection entry), the heart
  never moves a merged work's folder, reset deletes the sources.
- Selection: `store.homeSel` (card keys: work id, or series key in the normal
  list). Ctrl+click or the card menu 「선택」 starts it; while on, a click picks
  (`useWorkCard` / `useSeriesCard` onClick). `components/SelectBar.tsx` = sticky
  bar (전체 선택 · 통합 · 삭제 · ×, Esc); cleared on mode switch / leaving home.
  Merged works get 「통합 해제」 in their card menu.

## 11. Verifying changes

No test suite. Typecheck + build, then drive the built app over the Chrome
DevTools Protocol: `./node_modules/.bin/electron . --remote-debugging-port=9333`
(if the user's packaged app is running, also set
`ELECTRON_RENDERER_URL=file:///…/out/renderer/index.html` to skip the
single-instance lock), connect to the page target and click / call
`window.api.*`. It uses the real userData — back up `works.json`,
`settings.json`, `online.json` before anything that writes.

To test without touching the real data, start the built main from a tiny
ESM wrapper whose first import calls `app.setPath('appData', <scratch>)`
(userData is picked from appData in `appPaths.ts`), plus
`SORTA_DATA_DIR` / `ENVELOPE_DATA_DIR` for the embedded apps:
`main.mjs` = `import './appdata.mjs'` then `import 'file:///…/out/main/index.js'`
(static imports, so the schemes still register before app ready).

In-place translation drawing (`src/renderer/src/inpaint.ts`) has its own
debugger: `node scripts/inpaint-debug.mjs <image> [outDir] [--tr "줄1|줄2"] [--nomask]`
runs the real local OCR (models from `%APPDATA%/Halftone/ocr-models`) and the
real `drawTranslation` in a hidden Electron window exactly as the app does
(any format Chromium decodes, webp too; OCR'd from the canvas-downscaled JPEG,
drawn on the page itself; `--nomask` = without the OCR text mask, as saved
edits from before 2026-11-02 draw), and writes `result.png`,
`debug.png` (OCR boxes, the page's bubbles striped per lobe, the parts each
block owns tinted, the editor's boxes dashed purple) and `debug.json` (bubbles;
per block: glyph size, target font, parts, laid-out sizes; `boxes` = the
editor's boxes) to `.inpaint-debug/` (git-ignored). Use the
ORIGINAL page file the app opens (`.inpaint-debug/orig/`: the works' avif files —
a JPEG conversion gives OCR other pixels and other blocks), not a translated screenshot; a small crop changes the SFX size
rule and the OCR.

How `inpaint.ts` places text (keep it this way — per-block box heuristics made
the same balloon come out differently on every page):
1. **Bubbles are found once per page, from the text, never from OCR boxes**
   (`findBubbles`): each group of glyphs (text-mask components) seeds a flood
   of the colour around it, closed by its outline (gap-tolerant, widened when
   it leaks, rejected past 15% of the page), then extended over light pixels
   up to the outline for see-through balloons — lum ≥ α·255 − 10 with α the
   balloons' measured opacity (`measureAlpha`: fill F vs the flat background
   just past a dark outline, α = (F − B)/(255 − B), white balloons only; pooled
   per work = page URL's folder, `pageOpacity`), else / when that leaks
   lum > 150 (some outlines are grey ~120 in the original); confined to the block's box ± 60% (touching that
   limit = leaked into the art → no extension); the text mask next to
   the fill counts as inside (else a gradient balloon's glyph columns wall it
   into strips); two finds of one balloon (text on different shades) are
   merged, as are parts touching with no outline between (a see-through part
   over dark art next to the plain fill); split into lobes by necks, inkless
   lobes (tails) dropped. Erase in a bubble = mask glyphs + fill-enclosed
   holes near text + pixels in each block's glyph colour inside its box (the
   mask misses …… / ♡), all grown so the rebuild doesn't smear colour back.
   **Each balloon is classified first (`Bubble.kind`), each kind found its own
   way** — don't fold kinds back into one path with shared exceptions:
   see-through (own α measured, the work's α on a light not-white fill, or an
   outlined find whose extension grows it > 10%) → fill + extension above;
   outlined → fill flood only; plain (opaque, no outline, e.g. white on light
   grey) → `castRays`: 48 rays from the block's box over the fill (glyphs and
   their halos skipped; the fill = ring 3–8 px around the box, followed along
   gradients but capped at half the edge contrast, `drift`) to where they leave
   it; more steps than dark outlines = plain; region = fill colour (± drift)
   within the traced outline. Joined plain balloons (no outline between) each
   trace their own and the shared pixels go to whichever outline they're
   deeper in (`carve`); merged only when each holds the other's text.
   `Bubble.note` / debug.json `note` = kind, ray counts, extension verdict;
   the debugger draws a plain bubble's traced outline in magenta. A fill flood
   > 1.6× the rays' traced area spilled onto a close background → plain.
   **Font size beats the outline** (user's call): layouts shrink only to 85%
   of the OCR glyph size (`minFont`), past that keep the size and run over
   the outline (`overflowAt`, kept on the page) — unless the size is
   implausible (source chars × size² > its lobes' area → misread, fit down to
   9 as before). **Text areas never overlap** (user's rule): overflow
   (`claim`) grows the lobe step by step (¼…2 × fs) only over pixels no other
   block's parts or placed text hold — it moves aside; no room → shrinks into
   its lobe (`shrinkInto`). Joined plain balloons split their shared pixels
   by the nearer block's glyphs (`carve`; not the OCR box, which can run far
   past the text, nor the traced outlines, which run into each other) and
   stay one bubble with a lobe each (`joinLobes`). **One lobe, one speech**:
   blocks whose text is all in one lobe and of one colour (`sameInk`) are
   laid out as one text — the first in reading order (`boxOrder`) draws them
   joined (`Job.unit`), the rest `into` it; another colour = another speaker,
   they share the lobe as before.
   A block's home bubble = the one holding most of its text if ≥ 25% (the
   OCR can box dialogue with a sound effect beside the balloon); its erase is
   its box clipped to the bubble's rect (the effect stays).
   Text left as it is (SFX-skipped) still holds its part of a lobe (a rival
   in the split) and its pixels in the bubble erase (`kept`).
   **Erase must survive a weaker text mask** (the app's GPU-downscaled JPEG
   gives a slightly different mask than a software one — a 1 px thinner mask
   left a white glow in a black balloon that the rebuild then spread): the
   text's colours = every common colour of its masked glyphs clearly off the
   fill (`textColours` — fill, outline, glow); in its boxes any pixel nearer
   one of them than the fill is erased, and anywhere around it is never a
   source for `fillIn` (`avoid`; on the art via `textColoured`, only over a
   flat ground). **Opaque balloons only** — a see-through balloon (and the art)
   shows art under the text, so the mask's colours are the art's too (that
   erased Neon p1's art): there, per box, the strokes' colour (`glyphColour`,
   not the mask's commonest, which can be an art shadow) is erased, the art
   stays a source.
   **Background colour** (`sampleBg`, also the editor's default swatch) = the
   colour in both the box and the ring around it, not the box majority (bold /
   glowing text can be most of the box). Check with
   `IP_ERODE=1` / `2` (debugger env: mask shrunk n cells).   **Korean word cuts** (`cutAt`, a word wider than its
   line): at a grammar boundary if one fits — before a particle (오빠/한테),
   an auxiliary verb after its connector (먹고/싶다), after a connective
   ending (`koreanCut`; word lists, no analyser) — else as far as fits but
   not onto an ending's vowel (달라/붙어서); never a lone syllable either side
   (a layout needing that is rejected; overflow / box fallbacks are `loose`).
   Trailing punctuation (, . ! ? 」 …) never starts a line:
   `wrap` glues a lone punctuation token to the word before and hangs it past
   the line's edge (widths measured without it, `bodyWidth`; lines centred
   on their body) — ellipses ("...", "……") excepted, they may stand alone.
   Whole words may shrink to 80% of the word-broken size
   (below minFont) — a broken word reads worse. Line margin = 0.08 fs (the
   glyphs' side bearing + halo are the rest). Lobes take back a 6 px rim of
   their bubble (`RIM`): the distance-map split can hand the thin rim to a
   neighbouring lobe that wraps round to it. Overflow keeps the lobe's width (words broken) and runs
   past top/bottom — widening drifted text off narrow balloons. Per-block
   sizes are still a little noisy, so
   `layoutAll` groups a page's sizes within 1.3× (`pageSizes`) and lays each
   block out at its group's median (≤ 1.1× its own); not fitting → its own
   size; fitting nowhere → over the outline at the median size the rest of
   its group fitted at, if smaller. **Text keeps the source colour** (`glyphColour`: dominant of
   the farthest-from-fill 15% of mask pixels; speakers are told apart by
   colour) for blocks in a bubble; on the art `textPaint` (below). **One
   colour of text = one colour throughout the work** (`settleInks`): every
   page's inks/halos pooled per work (page URL folder, like `pageOpacity`),
   grouped within `SAME_INK`, each drawn as its group's per-channel median —
   a glyph's blended edges pulled the measure toward whatever was under it,
   so the same pink changed shade with the background. Halo = the text's
   own outline colour when it has one; else on the art the opposite shade of
   the ink (never the art's colour), in a balloon the fill colour when the
   text contrasts with it.
   **Text on the art (no balloon)** — first, false balloons are rejected per
   kind: a plain find needs a paper fill (chroma ≤ `PLAIN_CHROMA` — skin /
   sheets are coloured); a see-through find needs a light fill (≥ DARK and
   ≥ α·255) and must be closed one way or the other (extension not leaked,
   or rays outline ≥ 2 × step; real see-through balloons with few outline
   rays all stop their extension, those that leak all have outline-majority
   rays). Then `artRooms`: a block's room = its OCR lines (`TransBlock.cols`,
   local OCR's text lines clipped to the block; else the box) + the gaps
   between them; blocks side by side (lines within `ROOM_GAP` = 2 ems,
   overlapping ≥ 30%) share one room; the first in reading order lays out all
   their texts horizontally across it, one paragraph per block (another
   speaker → another line), each paragraph in its block's colours
   (`Job.paints`, `lineParas`). Rooms shrink only to `minFont` (whole words
   too), then `claim` the least room past them. `textPaint` (ink / halo / rim
   off the glyphs alone): masked pixels' two commonest colours; outer = the
   one clearly more present in the ring 1–2 outline-widths out (a ground),
   else the shallower one in the mask (outline round the ink); halo only when
   that outer colour doesn't go on past (own outline). `eraseOnArt` pads the
   box by an outline width (0.25 em) and also takes pixels in the ink / rim
   colour within that of the mask (outline remnants). Erase in bubbles pads
   boxes the same. Verified at `IP_ERODE` 0/1/2 on a synthetic page
   (`.scratch/noballoon/neon1.png`, built by `mk.cjs` from a json of columns).
   `fillIn` averages, so erasing over line art leaves a smooth patch; the
   optional **인페인팅 모델** (설정 › 번역, below 로컬 OCR 모델) fixes that:
   LaMa (Carve/LaMa-ONNX `lama_fp32.onnx`, Apache-2.0, ~199MB, input image
   0‥1 + mask, output 0‥255, fixed 512²) in `src/main/lib/lama.ts`, stored in
   userData/inpaint-models (not ocr-models: deleting the OCR models wipes that
   dir), run one patch at a time (~1s CPU) via `lamaPatch` ipc. Renderer:
   `healPage(img, res)` re-runs the erase pass with `erasing` recording every
   `eraseOnArt` mask, cuts square patches (≥512, merged when overlapping) round
   them, sends them scaled to 512², and returns a `Healed` page (cached per
   page+blocks); `drawTranslation(…, heal)` pastes it over its own fill where
   both masks agree. Balloons keep their flat fill. Not downloaded → null →
   built-in fill. The viewer draws at once, then redraws when healPage
   resolves; export awaits it; the editor too (asked again 300 ms after the
   blocks settle). Debugger:
   `IP_LAMA=<path to onnx>`.
   Follow-up from the user's pages (vertical text on a grey wall, 2026-11-02):
   a plain balloon's fill must also be paper (`PLAIN_LIGHT` ≥200 or
   `PLAIN_DARK` ≤60 luminance) — a grey wall's bright patch was swallowing the
   blocks; a room's size is always trusted (`sizeTrusted`), else minFont fell
   to 9px (ant-sized text); `ROOM_GAP` 2.5 em across lines (column beside
   column), only `ROOM_RUN` 1 em along them (two blocks' columns stacked end
   to end = two balloons — 4087000 p.2 joined at 2.5 em); `maskReach` grows an art
   block's erase box along text-mask runs (gaps ≤0.6 em, ≤4 em past the box,
   not into other boxes) — the detector box can stop short of a column's end.
   Debugger writes `mask.txt` (the OCR mask as '#'/'.'). A plain balloon must
   also hold `PLAIN_HOLDS` (0.8) of its text's box — a white window behind a
   column took it (the editor, drawing without the mask, didn't, so the two
   differed). LaMa holes are grown by half an outline reach per erase plus
   `HEAL_EDGE` px over the page (glow remnants), and the healed page is pasted
   once in `eraseAll` after the art erases.
2. **Blocks are only assigned** (`planJobs`): a block takes the lobes holding
   ≥15% of its text; a lobe shared by several blocks is cut between them
   (voronoi), a part holding several of a block's paragraphs is cut per
   paragraph — only when ≥2 of them have several lines (widely spaced columns
   come back from OCR as one paragraph per column). A lone block in a lone bubble is just laid out in it.
3. **Font size = the source glyph size** (`TransBlock.size`, local OCR's
   character pitch: its lines' length ÷ the characters read, an ellipsis or a
   !/? run one em — `blockSize`; else an estimate from box/char count), smaller
   only when it doesn't fit. Not the lines' thickness (detector map ×2: close
   columns come back as one thick line → 1.5–2× too big) nor glyph pixels
   (outlined/glowing text fuses into column blobs) — both were tried.
4. **A junk read isn't dropped whole** (`ocrPage`): the detector can box a
   balloon's columns together with a sound effect beside it, and manga-ocr
   reads the lot as junk. Its own text lines are regrouped (`groupLines`) and
   read; still junk → read line by line, the clean lines regrouped and their
   texts joined in reading order (the effect stays junk and drops).
   **Long lines** (visual-novel text boxes): manga-ocr squashes its input to
   224², so a line past ~16 chars comes back half made up at a confidence
   isJunk passes (synthetic measure: `.scratch/ocrmeasure`). `readLine` reads
   a line longer than `LONG_H` 14 (horizontal, length ÷ its ink-row height,
   `inkRows` — the detector's line height is not the glyph size) / `LONG_V`
   16 (column, length ÷ width) glyphs in pieces of `PIECE` 5, cut on the
   line's character grid (`glyphGaps`: pitch by autocorrelation, phase from
   five cell edges — a lone gap can be a kanji's own, 弓|長). A half-width
   "..." still shifts the grid, so pieces overlap `OVERLAP` 1.5 cells past
   each cut and are joined on the longest run their seam ends share
   (`joinSeam`, ties → fewest characters dropped); a phrase of 4+ read twice
   in a row inside a piece is the decoder looping and is kept once. A vertical block
   with such a column is read column by column, right to left. Lines are read
   to their own ends, not clipped to the block box (it stopped ~200 px short
   of a text box's line). The test sets (484 / neon) are unchanged.
   Two boxes of one balloon (the detector can box it twice) then read the
   same text: `oneSpeech` merges blocks with the same text overlapping by
   ≥ 25% of the smaller into one over their union.
5. **Ellipsis in wrapping**: an ellipsis written onto a word ("직장이라…활용하기")
   is a break point after it (`AFTER_DOTS`, the two halves joined without a
   space on one line), and a cut never lands before / inside an ellipsis glued
   to its word (`cutAt`) — else the word was cut by character (활/용하기) and the
   dots went down a line on their own.
6. **Odd balloons** (focus-line burst, spiky, cloud; synthetic test
   `.scratch/burst/odd.png` from `mk.cjs`): a fill leaking out between the
   focus lines round a burst balloon is cut by an opening in `splitBubble`
   (`opened`: k = `OPEN_EM` 0.3 em, ≥ `OPEN` 4 px; the parts holding text kept)
   — before, the leak ran to the page edge and merged the burst with the
   balloon beside it. The detector's mask can mark outlines / focus lines as
   text: `fillPart` adds mask text to the fill only within an em of its block's
   box, and `eraseBubble` erases mask strokes past the inside or on its rim
   (`RIM_DEPTH` 6) only near the boxes' own text — else a spiky balloon's
   outline got erased.
7. **Editor inpaint tools** (`TransEditor.tsx`, pixel work in `paintTools.ts`):
   the editor stacks three canvases — the erased page (`drawTranslation`'s
   canvas), a painted layer, and the text (`DrawOpts.text`) — so painting never
   re-runs drawTranslation. Tools: 색상 추출 (Shift: selected block's text
   colour), 채우기 (`floodRegion` on erased page + layer, tolerance), 브러시 /
   지우개 (canvas strokes, clipped to the selection), 복구 브러시 (Alt+click
   source; clones a disc per stamp, then `healStroke` spreads the edge's
   dst−src difference over the stroke — membrane blend), 선택: 사각형 · 다각형
   올가미 · 자석 올가미 (`livewire` = Dijkstra on `edgeCost`; keep its dist
   Float64 + settled flags — float32 rounding looped forever). Undo steps hold
   the layer's changed rect before/after (`Step.patch`), sharing the blocks
   array with the previous step. The layer is saved per page
   (`saveTransPaint` → userData/trans-paint/<sha1(src)>.png; `getTransPaint`
   in translate.ts) and drawn by the viewer/export via `DrawOpts.paint`; 자동으로
   되돌리기 clears it. `TransBlock.ink` = manual text colour (wins over the
   read/settled ink; halo then by the usual rule). Colour swatches commit on
   the native `change` event (React's onChange fires per input → one history
   step + full repaint per colour dragged over = the lag). Harness for the
   editor alone: `.scratch/edh` (esbuild entry + electron main + t1.js;
   t3.js = real OCR blocks + mask of 484-002, b484.json / m484.json).
8. **Editor = viewer** (user's rule: the editor opens on the page exactly as
   the viewer shows it): it draws with the same `TransResult` (blocks + OCR
   text `mask`, prop `mask`) and the same `healPage`. A saved edit replaces
   the OCR run, so the mask is kept with it (`saveTransMask` →
   userData/trans-mask/<sha1(src)>.bin: w, h u32, scale f64, bits) and
   `getTranslation` returns it with the override. The boxes shown are where
   each translation was drawn (`drawTranslation` returns `Drawn`: `inks`,
   `boxes` = its lobes ∪ text, a joined block `null` + `lead`, SFX-skipped
   `skip`) — not the OCR box, which can hold a sound effect beside the
   balloon. Touching a block never switches it to the manual path:
   text / ink edits set `TransBlock.edited` (text final, empty = erase, no
   SFX skip; erase + layout as auto), a moved / resized box sets
   `TransBlock.room` (layout there at its glyph size, the source still erased
   at x/y/w/h; a joined speech takes any member's room). `bg` (flat bubble
   fill) only from the 배경 swatch or 말풍선 추가; edits saved before this have
   `bg` stamped on every touched block and keep the old look.
9. **Layered, staged editor** (2026-11-03, user's spec) — `TransEditor.tsx`
   edits a per-page **`TransDoc`** (shared/ipc.ts): `blocks` (+ `id`, `style`,
   `runs` = rich text over `tr`, `look` = the auto pass's ink/halo/fill/art),
   `regions` (bubble regions: rect + bit-packed mask, `blocks` = ids whose text
   goes in it — several = one joined speech, `layer`), `layers` (top first:
   `bubbles` = guide only, `pixels` = PNG, `text`; the page under all; `auto`
   = written by an auto step, re-running replaces only that layer).
   Saved by `saveTransDoc` → userData/trans-doc/<sha1(src)>/doc.json +
   <layer>.png; translate.ts `getTransDoc` caches it; **the viewer and export
   draw an edited page with `renderDoc`** (page + pixel layers + `drawDocText`
   in layer order), never re-running the auto pass. The blocks also go to
   translationEdits (편집 marks, next-page context). 자동으로 되돌리기 = doc null.
   A page without a doc opens with `autoPage` (planJobs + eraseAll once:
   regions = each job's parts, erase = changed pixels) as 자동 말풍선 /
   자동 인페인팅 layers — `drawDocText` over them reproduces drawTranslation
   (debugger `doc.png`, `docDiff` ≈ 0 on all test pages; keep it that way:
   `docJobs` mirrors planJobs' joins, `renderDoc` must use a
   willReadFrequently canvas or the GPU downscale differs).
   **Lag fix**: moving a box / a colour palette used to re-run the whole
   drawTranslation (0.4–1.2 s) per mousemove/input; now only `drawDocText`
   (1–2 ms). Fonts: layouts carry a `Face` (`fontAt`, set per job in
   layoutAll from the block's style); runs only affect drawing (`drawRich`:
   pieces per style, align left/center/right/justify, underline/strike).
   Stages: 1 list only (영역 번역), 2 regions (selection → Enter → region on
   사용자 말풍선, which sits above 자동 말풍선 so it wins for its block; 자동
   선택), 3 painting (mask = selection else regions, 안/밖; 자동 인페인팅 into
   the mask; healing brush aligned: offset kept across strokes, the source
   mark follows the cursor), 4 text (boxes = `room`; format bar applies to
   the textarea's selected range, else the block). Keys (Photoshop-like,
   hard-coded in TransEditor): V I M Shift+M L Shift+L G B J E, [ ], 1–4
   stages, Ctrl+D, Ctrl+Shift+I, Ctrl+Shift+N, Ctrl+S, Ctrl+0/=/-, Ctrl+B/I/U,
   Ctrl+Shift+/ (strike), Ctrl+Shift+L/C/R/J, Ctrl+Shift+>/<, Alt+wheel =
   brush size, Delete = whatever is selected (active region › selection ›
   block). Harness: `.scratch/edh` t4.js (all stages), t5.js (UI shot per
   stage), t6.js (font picker, regions, Delete, Alt+wheel).
   Selections (`sels`, polygons) are kept until the user removes them (user's
   rule): a new one adds (mask = union), a click / Esc never clears them;
   Delete = the last one, Ctrl+D / 선택 해제 = all; Enter in stage 2 turns the
   union into one region. Harness t10.js. A click on a selection (move
   tool, or a no-drag click with 사각형/원형) picks it (`activeSel`, drawn
   dark purple): the mask is then that one alone; a click on nothing picks
   nothing (mask = all selections). Mask order: picked selection › picked
   region › all selections › all regions. Delete removes the picked one only.
   자동 인페인팅 with selections as the mask fills them whole (`fillSelection`:
   LaMa patches via `lamaInto`, else fillIn) — sound effects, which the auto
   erase skips; outside the mask the layer keeps its pixels (it used to be
   wiped). Harness t11.js.
   **Gradients / opacity / rotation** (2026-11-03): `TextStyle.opacity`
   (fill alpha) and `gradient` (`TextGradient`: angle, 0 = left→right, 90 =
   top→bottom; stops pos/colour/alpha) — drawRich fills with `gradientFill`
   across the whole job's text area. 그라데이션 인식 = tool `grad` (stage 3,
   Shift+I): drag round a lettering or click a selection → `readGradient`
   (gradient.ts: ground = border colours, letters = pixels off them (only the
   coloured ones when most are), angle = least within-band spread over 16
   bands, stops added where a straight blend misses a band by > 20) → saved
   in localStorage `halftone.transGradient`, shown as a bar under the tool.
   Stage 4 `GradientButton` (split: main = saved gradient on / off, arrow =
   stops bar, colour, opacity, position, angle). `ColorButton` (split: main
   applies, arrow = colour + 투명도) for 글자색 (a pen colour, Word-like) and
   브러시 색 (main = fill the mask; brush strokes at an opacity are built
   full-strength on their own canvas, laid on at it). Popups share
   `usePopover`; their mousedown preventDefault (keeps the textarea's
   selection) skips inputs — on a range it stopped the drag.
   외곽선 button: on = `outline !== false` (the auto halo counts as on);
   off = `outline: false` = no stroke at all, on again = the set width.
   Gradient menu's 투명도 = the text's `opacity` (whole gradient), no per-stop
   alpha / position sliders (stops move on the bar). 인물 메모 sits on the
   stage-1 options row (`transExtra`), not the header.
   Selections stay interactive in every stage: in stages 1 / 4 (no
   selection tools) the move tool picks one by clicking its polygon
   (`.ted-ants.pickable`), a click elsewhere unpicks; the picked selection
   (or stage 2–3 region) has a × button (`.ted-sel-del`) beside the rotate
   handle, and Delete removes a picked selection in any stage. Harness t17.js.
   Harness `main4.cjs` = main3 plus real mouse drags: the page logs
   `DRAG x0 y0 x1 y1` and main sends them with sendInputEvent (t18: popup
   sliders). Its drags often stop part-way even on a plain range — check that
   inputs fire and the value commits, not the distance travelled. `TransBlock.rot`: drawDocText turns the text round its
   drawn box's centre; the stage-4 box is CSS-rotated with a PowerPoint-like
   handle (`.ted-rot`, Shift = 15°), corner drags work in the box's frame.
   Stages 2–3: the picked selection (`rotatePts`) or region (`rotateRegion`,
   mask resampled from the original each move, one undo step) has the same
   handle. Harness t14.js; `main3.cjs` = the harness in an off-screen visible
   window (hidden windows capture stale frames — use it for UI shots).
   Regions show in stages 2–3 until deleted (light purple; the clicked one
   dark purple + outline = active; stage 3 mask = selection › active region ›
   all regions). `FontPicker.tsx` (not Dropdown: the editor stops mousedown
   bubbling, so Dropdown's outside-click never fired; FontPicker listens in
   the capture phase, fixed-positioned list): favourites pinned
   (localStorage `halftone.transFontFavs`), recents per work (module map,
   this run), hover previews on the text and reverts. Colour buttons are
   round (`ColorInput look="text"` = A over a colour bar, `"swatch"` = dot).
   The options row never wraps (the hint ellipses) — it used to change height
   with the tool hint.
   Stage 1 also has 전체 다시 번역 (`retranslatePage`: the engine again past
   any saved edit, cached as the page's run; the doc is rebuilt from it with
   its new mask) and 선택 영역 다시 번역 (`translateLines` ipc: the selected
   block's source through the page engine's translator — Gemini / LLM in text
   mode, the local chain, else the free one), and the current model at the
   row's right end (`transModelLabel`). Header 초기화 = `rebuild` from
   `TransDoc.orig` (the recognition the doc was built from; older docs: their
   blocks minus the edit fields): auto layers only, one undo step. Harness
   t9.js. The 번역 편집기 list (TransWork.tsx) has a per-work 초기화 too
   (`resetWorkEdits`: `saveTransDoc(src, null)` + cache drop for every page,
   project back to page 1 / 작업 중; 인물 메모 kept; confirm first — no undo).

## 12. 캐릭터 분류 mode (Sorta, embedded)

- Sorta (character image sorter, repo `alterstare/Sorta`, local `../sorta`) is
  embedded as a mode: sidebar → "캐릭터 분류 모드로 전환" (under 번역 편집기).
- **`src/sorta/` is a generated copy — never edit it.** Change Sorta, then
  `npm run sync-sorta` (copies `core`, `shared`, `main/host.ts`,
  `preload/api.ts`, `preload/index.d.ts`, `renderer/src`, writes `version.ts`).
- Screen: `src/renderer/sorta.html` (second renderer entry) shown in an
  `<iframe class="sorta-frame">` that App keeps alive after the first visit, so
  Sorta's CSS / shortcuts / state stay isolated from Halftone's.
- The preload runs in every frame (`nodeIntegrationInSubFrames: true` on the
  main window): `sorta.html` gets Sorta's `window.api` (`createSortaApi`), the
  top page gets Halftone's, other frames get nothing.
- Main side: `src/main/sorta.ts` → Sorta's `initSorta()` (IPC on `sorta:*`
  channels, `sorta-img://` protocol registered with Halftone's schemes in
  `registerImageScheme([SORTA_SCHEME])`). Events go to the Sorta frame via
  `WebFrameMain.send`.
- Data: shared with the standalone Sorta app, `%APPDATA%/Sorta` (opened lazily on
  the first visit; `sorta.lock` lets only one app use it — the other shows
  "…에서 Sorta 데이터를 쓰고 있습니다" + 다시 시도). Test with a copy:
  `SORTA_DATA_DIR=<folder>`.
- Native modules for it: `better-sqlite3` (Electron prebuilt fetched by
  `scripts/native.mjs` on postinstall; `npmRebuild: false`), `sharp`; both
  `asarUnpack`ed and external in the main build.

## 13. 음성 플레이어 (Envelope, embedded)

- Envelope (voice-work player, repo `alterstare/Envelope`, local `../doujin_player`)
  is embedded like Sorta: sidebar → "음성 플레이어 열기 / 닫기" (under 캐릭터 분류).
- **`src/envelope/` is a generated copy — never edit it.** Change Envelope, then
  `npm run sync-envelope` (copies `core`, `shared`, `main/host.ts`,
  `main/encodeWorker.ts`, `preload/api.ts`, `preload/index.d.ts`,
  `renderer/src`, writes `version.ts`). Typecheck covers it via
  `tsconfig.envelope.json` (renderer) and `tsconfig.node.json` (core/main).
- Screen: `src/renderer/envelope.html` (+ `envelope-main.ts`). ONE frame
  (`components/EnvelopeDock.tsx`) that is never moved in the page — moving a
  frame reloads it and stops the sound; only its box changes:
  - **panel** — beside Halftone at full height (tab bar, page and activity bar
    end at its edge), 360px by default, its left edge drags it wider (≤845,
    kept in localStorage `envelopeWidth`); `.app.env-panel` pads the right by
    `--env-w`. The env-panel / env-bar class is part of App's className (from
    `envelope` in the store) — toggled from outside, the next App render
    (e.g. focus mode when reading starts) dropped it and the reader ran under
    the panel.
  - **bar** — Envelope's mini-mode bar along Halftone's bottom at Halftone's
    full width (`.app.env-bar` pads the bottom; the activity bar sits above it).
    While the pointer is on its 음량 button the frame is lifted (`lift`, 150px,
    see-through) so the vertical volume bar fits above.
  - **hidden** — while the separate big window is open; the frame keeps
    playing.
- The frame holds THE player. The big window (`envelope.html?remote&theme=…`,
  `main/envelope.ts`) shows it: Envelope's host relays state down
  (`env:mirror`) and actions up (`env:remote:cmd`); closing it (or its
  패널로 보기 / 최소화 모드 buttons) returns to the panel / bar.
- Frame ⇄ page: the frame posts `env-request` ({what: window | panel | bar |
  close | lift}) and `env-job` (→ activity bar, `store.envelopeJob`); the page
  posts `env-mode` (its shape) and `env-key`. **Never post to the frame before
  its `load`** — touching the frame's first (empty) window keeps Electron's
  preload from giving the real page its `window.api`.
- Theme from the first paint: the preload stamps Halftone's theme on the
  frame's (and big window's) <html> like Sorta's, and envelope.html / index.html
  colour the first paint from it with a small inline style (the stylesheet
  arrives later — in dev it is injected by script), so nothing flashes light.
- Keys: everything works when the frame has focus; with focus in Halftone, a
  key goes down to the frame only if no Halftone shortcut (incl. user
  overrides) uses it and it isn't reserved for the reader / scrolling
  (arrows, Space, Enter, Esc, Tab, Page/Home/End, Backspace, Delete), and not
  while typing.
- Data: shared with the standalone app, `%APPDATA%/Envelope` (lazy, `env.lock`;
  test with a copy: `ENVELOPE_DATA_DIR=<folder>`). `env-media://` is registered
  with Halftone's schemes. Main build input `envelopeEncodeWorker` = its wav →
  mp3 worker thread.
- **Any Envelope release → also sync + release Halftone** (always when its DB
  schema changes).
