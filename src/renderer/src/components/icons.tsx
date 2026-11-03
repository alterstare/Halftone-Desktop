import type { JSX } from 'react'

// Small, uniform-stroke line icons for card/list action buttons. They inherit
// `color` via `currentColor` and size to `1em`, so the surrounding span's font
// color/size drives them (see `.seg-ico` in styles.css).

interface IconProps {
  className?: string
}

// Clean, even-weight check — replaces the ✓ glyph on finished downloads.
export function CheckIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={`seg-ico ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12.5l5.2 5.2L20 6.5" />
    </svg>
  )
}

// Pause — shown while a download is in flight (click to stop/pause it).
export function PauseIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={`seg-ico ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
    >
      <rect x="6.5" y="5" width="3.6" height="14" rx="1.2" />
      <rect x="13.9" y="5" width="3.6" height="14" rx="1.2" />
    </svg>
  )
}

// Play — shown on a paused download (click to resume from where it stopped).
export function PlayIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={`seg-ico ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
    >
      <path d="M7.5 5.6c0-.9 1-1.5 1.8-1L18 9.9c.8.5.8 1.7 0 2.2l-8.7 5.3c-.8.5-1.8-.1-1.8-1V5.6z" />
    </svg>
  )
}

// Two circular arrows — the "converting" (avif→webp) indicator.
export function ConvertIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={`seg-ico ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 11a8 8 0 0 0-14.9-3.5" />
      <path d="M4.5 4.5v3.5H8" />
      <path d="M4 13a8 8 0 0 0 14.9 3.5" />
      <path d="M19.5 19.5V16H16" />
    </svg>
  )
}

// --- Material Symbols (filled, 24px). Inherit color via currentColor, size 1em. ---
function mkIcon(path: string) {
  return function Icon({ className }: IconProps): JSX.Element {
    return (
      <svg className={`micon ${className ?? ''}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={path} />
      </svg>
    )
  }
}

export const EditLineIcon = mkIcon('m10.05 21l2-2H22v2zM3 21v-4.25L16.2 3.575q.275-.275.65-.425t.775-.15t.763.162t.662.438L20.425 5q.275.3.425.663T21 6.4q0 .4-.137.762t-.438.663L7.25 21zM17.6 7.8L19 6.4L17.6 5l-1.4 1.4z')
export const ShieldIcon = mkIcon('M12 22q-3.475-.875-5.738-3.988T4 11.1V5l8-3l8 3v6.1q0 3.8-2.262 6.913T12 22')
export const HomeIcon = mkIcon('M4 21V9l8-6l8 6v12h-6v-7h-4v7z')
export const LanguageIcon = mkIcon(
  'M8.125 21.213q-1.825-.788-3.187-2.15t-2.15-3.188T2 11.988t.788-3.875t2.15-3.175t3.187-2.15T12.013 2t3.875.788t3.175 2.15t2.15 3.175t.787 3.875t-.787 3.887t-2.15 3.188t-3.175 2.15t-3.875.787t-3.888-.787M12 19.95q.65-.9 1.125-1.875T13.9 16h-3.8q.3 1.1.775 2.075T12 19.95m-2.6-.4q-.45-.825-.787-1.713T8.05 16H5.1q.725 1.25 1.813 2.175T9.4 19.55m5.2 0q1.4-.45 2.488-1.375T18.9 16h-2.95q-.225.95-.562 1.838T14.6 19.55M4.25 14h3.4q-.075-.5-.112-.987T7.5 12t.038-1.012T7.65 10h-3.4q-.125.5-.187.988T4 12t.063 1.013t.187.987m5.4 0h4.7q.075-.5.113-.987T14.5 12t-.038-1.012T14.35 10h-4.7q-.075.5-.112.988T9.5 12t.038 1.013t.112.987m6.7 0h3.4q.125-.5.188-.987T20 12t-.062-1.012T19.75 10h-3.4q.075.5.113.988T16.5 12t-.038 1.013t-.112.987m-.4-6h2.95q-.725-1.25-1.812-2.175T14.6 4.45q.45.825.788 1.713T15.95 8M10.1 8h3.8q-.3-1.1-.775-2.075T12 4.05q-.65.9-1.125 1.875T10.1 8m-5 0h2.95q.225-.95.563-1.838T9.4 4.45Q8 4.9 6.912 5.825T5.1 8'
)
export const MenuIcon = mkIcon('M3 18v-2h18v2zm0-5v-2h18v2zm0-5V6h18v2z')
export const SettingsIcon = mkIcon(
  'm9.25 22l-.4-3.2q-.325-.125-.612-.3t-.563-.375L4.7 19.375l-2.75-4.75l2.575-1.95Q4.5 12.5 4.5 12.338v-.675q0-.163.025-.338L1.95 9.375l2.75-4.75l2.975 1.25q.275-.2.575-.375t.6-.3l.4-3.2h5.5l.4 3.2q.325.125.613.3t.562.375l2.975-1.25l2.75 4.75l-2.575 1.95q.025.175.025.338v.674q0 .163-.05.338l2.575 1.95l-2.75 4.75l-2.95-1.25q-.275.2-.575.375t-.6.3l-.4 3.2zm2.8-6.5q1.45 0 2.475-1.025T15.55 12t-1.025-2.475T12.05 8.5q-1.475 0-2.488 1.025T8.55 12t1.013 2.475T12.05 15.5'
)
export const SearchIcon = mkIcon(
  'm19.6 21l-6.3-6.3q-.75.6-1.725.95T9.5 16q-2.725 0-4.612-1.888T3 9.5t1.888-4.612T9.5 3t4.613 1.888T16 9.5q0 1.1-.35 2.075T14.7 13.3l6.3 6.3zM9.5 14q1.875 0 3.188-1.312T14 9.5t-1.312-3.187T9.5 5T6.313 6.313T5 9.5t1.313 3.188T9.5 14'
)
export const RefreshIcon = mkIcon('M12 20q-3.35 0-5.675-2.325T4 12t2.325-5.675T12 4q1.725 0 3.3.712T18 6.75V4h2v7h-7V9h4.2q-.8-1.4-2.187-2.2T12 6Q9.5 6 7.75 7.75T6 12t1.75 4.25T12 18q1.925 0 3.475-1.1T17.65 14h2.1q-.7 2.65-2.85 4.325T12 20') // Refresh
export const SyncIcon = mkIcon(
  'M4 20v-2h2.75l-.4-.35q-1.225-1.225-1.787-2.662T4 12.05q0-2.775 1.663-4.937T10 4.25v2.1Q8.2 7 7.1 8.563T7 12.05q0 1.125.425 2.188T7.75 16.2l.25.25V14h2v6zm10-.25v-2.1q1.8-.65 2.9-2.212T18 11.95q0-1.125-.425-2.187T16.25 7.8L16 7.55V10h-2V4h6v2h-2.75l.4.35q1.225 1.225 1.788 2.663T20 11.95q0 2.775-1.662 4.938T14 19.75'
)
export const DownloadIcon = mkIcon(
  'm12 16l-5-5l1.4-1.45l2.6 2.6V4h2v8.15l2.6-2.6L17 11zm-6 4q-.825 0-1.412-.587T4 18v-3h2v3h12v-3h2v3q0 .825-.587 1.413T18 20z'
)
export const GridIcon = mkIcon('M2 10V2h8v8zm0 12v-8h8v8zm12-12V2h8v8zm0 12v-8h8v8z')
export const Download2Icon = mkIcon('M4 22v-2h16v2zm8-4L5 9h4V2h6v7h4z')
export const DescriptionIcon = mkIcon(
  'M8 18h8v-2H8zm0-4h8v-2H8zm-2 8q-.825 0-1.412-.587T4 20V4q0-.825.588-1.412T6 2h8l6 6v12q0 .825-.587 1.413T18 22zm7-13h5l-5-5z'
)
export const ScanIcon = mkIcon(
  'M2 6V1h5v2H4v3zm18 0V3h-3V1h5v5zM2 23v-5h2v3h3v2zm15 0v-2h3v-3h2v5zM7 20q-.825 0-1.412-.587T5 18V6q0-.825.588-1.412T7 4h10q.825 0 1.413.588T19 6v12q0 .825-.587 1.413T17 20zm2-10h6V8H9zm0 3h6v-2H9zm0 3h6v-2H9z'
)
export const AddPhotoIcon = mkIcon(
  'M5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h9q-.5.65-.75 1.425T13 6q0 2.075 1.463 3.538T18 11q.8 0 1.575-.25T21 10v9q0 .825-.587 1.413T19 21zm1-4h12l-3.75-5l-3 4L9 13zm11-8V7h-2V5h2V3h2v2h2v2h-2v2z'
)
export const FolderIcon = mkIcon(
  'M4 20q-.825 0-1.412-.587T2 18V6q0-.825.588-1.412T4 4h6l2 2h8q.825 0 1.413.588T22 8v10q0 .825-.587 1.413T20 20z'
)
export const EditIcon = mkIcon(
  'M3 21v-4.25L16.2 3.575q.3-.275.663-.425t.762-.15t.775.15t.65.45L20.425 5q.3.275.438.65T21 6.4q0 .4-.137.763t-.438.662L7.25 21zM17.6 7.8L19 6.4L17.6 5l-1.4 1.4z'
)
export const AssignmentIcon = mkIcon(
  'M5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h4.2q.325-.9 1.088-1.45T12 1t1.713.55T14.8 3H19q.825 0 1.413.588T21 5v14q0 .825-.587 1.413T19 21zm2-4h7v-2H7zm0-4h10v-2H7zm0-4h10V7H7zm5.538-4.962q.212-.213.212-.538t-.213-.537T12 2.75t-.537.213t-.213.537t.213.538t.537.212t.538-.213'
)
export const HistoryIcon = mkIcon(
  'M12 21q-3.45 0-6.012-2.287T3.05 13H5.1q.35 2.6 2.313 4.3T12 19q2.925 0 4.963-2.037T19 12t-2.037-4.962T12 5q-1.725 0-3.225.8T6.25 8H9v2H3V4h2v2.35q1.275-1.6 3.113-2.475T12 3q1.875 0 3.513.713t2.85 1.924t1.925 2.85T21 12t-.712 3.513t-1.925 2.85t-2.85 1.925T12 21m2.8-4.8L11 12.4V7h2v4.6l3.2 3.2z'
)
export const CompareArrowsIcon = mkIcon(
  'm8 20l-1.4-1.425L9.175 16H2v-2h7.175L6.6 11.425L8 10l5 5zm8-6l-5-5l5-5l1.4 1.425L14.825 8H22v2h-7.175l2.575 2.575z'
)
export const ArrowRangeIcon = mkIcon(
  'm7 17l-5-5l5-5l1.4 1.4L5.825 11h12.35L15.6 8.4L17 7l5 5l-5 5l-1.4-1.4l2.575-2.6H5.825L8.4 15.6z'
)
export const HeightIcon = mkIcon(
  'm12 21l-4-4l1.4-1.4l1.6 1.575V6.825L9.4 8.4L8 7l4-4l4 4l-1.4 1.425l-1.6-1.6v10.35l1.6-1.575L16 17z'
)
export const FullscreenIcon = mkIcon('M3 21v-5h2v3h3v2zm13 0v-2h3v-3h2v5zM3 8V3h5v2H5v3zm16 0V5h-3V3h5v5z')
export const FullscreenExitIcon = mkIcon('M6 21v-3H3v-2h5v5zm10 0v-5h5v2h-3v3zM3 8V6h3V3h2v5zm13 0V3h2v3h3v2z')
// Material Symbols "auto_stories" (outlined) — series marker in the reader list.
export function AutoStoriesIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={`micon ${className ?? ''}`} viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">
      <path d="M480-160q-48-38-104-59t-116-21q-42 0-82.5 11T100-198q-21 11-40.5-1T40-234v-482q0-11 5.5-21T62-752q46-24 96-36t102-12q58 0 113.5 15T480-740v484q51-32 107-48t113-16q36 0 70.5 6t69.5 18v-480q15 5 29.5 10.5T898-752q11 5 16.5 15t5.5 21v482q0 23-19.5 35t-40.5 1q-37-20-77.5-31T700-240q-60 0-116 21t-104 59Zm80-200v-380l200-200v400L560-360Zm-160 65v-396q-33-14-68.5-21.5T260-720q-37 0-72 7t-68 21v397q35-13 69.5-19t70.5-6q36 0 70.5 6t69.5 19Zm0 0v-396 396Z" />
    </svg>
  )
}

// Reader mode (스크롤 / 클릭 넘김 / 두 쪽), 번역, and window-style buttons.
export const ScrollModeIcon = mkIcon('m12 19l-6-6l1.4-1.4l4.6 4.575l4.6-4.575L18 13zm0-6L6 7l1.4-1.4l4.6 4.575L16.6 5.6L18 7z') // Keyboard Double Arrow Down
export const PageModeIcon = mkIcon('M4 20q-.825 0-1.412-.587T2 18V6q0-.825.588-1.412T4 4h16q.825 0 1.413.588T22 6v12q0 .825-.587 1.413T20 20zm2-4h12V8H6z') // Capture
export const SpreadModeIcon = mkIcon('M13 16h5V8h-5zm-7 0h5V8H6zm-2 4q-.825 0-1.412-.587T2 18V6q0-.825.588-1.412T4 4h16q.825 0 1.413.588T22 6v12q0 .825-.587 1.413T20 20z') // Splitscreen Landscape
// Material Symbols "category" (filled) — 캐릭터 분류 mode
export const HeadphonesIcon = mkIcon('M9 21H5q-.825 0-1.412-.587T3 19v-7q0-1.875.713-3.512t1.924-2.85t2.85-1.925T12 3t3.513.713t2.85 1.924t1.925 2.85T21 12v7q0 .825-.587 1.413T19 21h-4v-8h4v-1q0-2.925-2.037-4.962T12 5T7.038 7.038T5 12v1h4z')
export const CategoryIcon = mkIcon('m6.5 11l5.5-9l5.5 9zm11 11q-1.875 0-3.187-1.312T13 17.5t1.313-3.187T17.5 13t3.188 1.313T22 17.5t-1.312 3.188T17.5 22M3 21.5v-8h8v8z')
export const TranslateIcon = mkIcon('m11.9 22l4.55-12h2.1l4.55 12H21l-1.075-3.05h-4.85L14 22zM4 19l-1.4-1.4l5.05-5.05q-.875-.875-1.588-2T4.75 8h2.1q.5.975 1 1.7t1.2 1.45q.825-.825 1.713-2.313T12.1 6H1V4h7V2h2v2h7v2h-2.9q-.525 1.8-1.575 3.7t-2.075 2.9l2.4 2.45l-.75 2.05l-3.05-3.125zm11.7-1.8h3.6l-1.8-5.1z')
export const MaximizeIcon = mkIcon('M5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v14q0 .825-.587 1.413T19 21zm0-2h14V5H5z')
export const NoteStackIcon = mkIcon('M7 20V8.975q0-.825.6-1.4T9.025 7H20q.825 0 1.413.587T22 9v8l-5 5H9q-.825 0-1.412-.587T7 20M2.025 6.25q-.15-.825.325-1.487t1.3-.813L14.5 2.025q.825-.15 1.488.325t.812 1.3L17.05 5H9Q7.35 5 6.175 6.175T5 9v9.55q-.4-.225-.687-.6t-.363-.85zM20 16h-4v4z')
export const ArrowBackIcon = mkIcon('m7.825 13l5.6 5.6L12 20l-8-8l8-8l1.425 1.4l-5.6 5.6H20v2z')
export const FolderOpenIcon = mkIcon('M4 20q-.825 0-1.412-.587T2 18V6q0-.825.588-1.412T4 4h6l2 2h8q.825 0 1.413.588T22 8H4v10l2.4-8h17.1l-2.575 8.575q-.2.65-.737 1.038T19 20z')
export const CheckMarkIcon = mkIcon('m9.55 18l-5.7-5.7l1.425-1.425L9.55 15.15l9.175-9.175L20.15 7.4z')
export const UndoIcon = mkIcon('M7 19v-2h7.1q1.575 0 2.738-1T18 13.5T16.838 11T14.1 10H7.8l2.6 2.6L9 14L4 9l5-5l1.4 1.4L7.8 8h6.3q2.425 0 4.163 1.575T20 13.5t-1.737 3.925T14.1 19z')
export const RedoIcon = mkIcon('M9.9 19q-2.425 0-4.163-1.575T4 13.5t1.738-3.925T9.9 8h6.3l-2.6-2.6L15 4l5 5l-5 5l-1.4-1.4l2.6-2.6H9.9q-1.575 0-2.738 1T6 13.5T7.163 16T9.9 17H17v2z')
export const RestartIcon = mkIcon('M11 20.95q-3.025-.375-5.012-2.637T4 13q0-1.65.65-3.162T6.5 7.2l1.425 1.425q-.95.85-1.437 1.975T6 13q0 2.2 1.4 3.888T11 18.95zm2 0v-2q2.175-.4 3.588-2.075T18 13q0-2.5-1.75-4.25T12 7h-.075l1.1 1.1l-1.4 1.4l-3.5-3.5l3.5-3.5l1.4 1.4l-1.1 1.1H12q3.35 0 5.675 2.325T20 13q0 3.025-1.987 5.288T13 20.95')
export const DeleteSweepIcon = mkIcon('M15 18v-2h4v2zm0-8V8h7v2zm0 4v-2h6v2zM3 8H2V6h4V4.5h4V6h4v2h-1v9q0 .825-.587 1.413T11 19H5q-.825 0-1.412-.587T3 17z')
export const GradientIcon = mkIcon('M5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v14q0 .825-.587 1.413T19 21zm6-10v2h2v-2zm-4 0v2h2v-2zm2 2v2h2v-2zm4 0v2h2v-2zm-8 0v2h2v-2zm10-2v2h2v2h2v-2h-2v-2zm-8 4v2H5v2h2v-2h2v2h2v-2h2v2h2v-2h2v2h2v-2h-2v-2h-2v2h-2v-2h-2v2H9v-2zm12-4v2zm0 4v2z')
export const SelectIcon = mkIcon('M5 19v2q-.825 0-1.412-.587T3 19zm-2-2v-2h2v2zm0-4v-2h2v2zm0-4V7h2v2zm2-4H3q0-.825.588-1.412T5 3zm2 16v-2h2v2zM7 5V3h2v2zm4 16v-2h2v2zm0-16V3h2v2zm4 16v-2h2v2zm0-16V3h2v2zm4 14h2q0 .825-.587 1.413T19 21zm0-2v-2h2v2zm0-4v-2h2v2zm0-4V7h2v2zm0-4V3q.825 0 1.413.588T21 5z') // Select
export const ArrowUpIcon = mkIcon('m12 10.8l-4.6 4.6L6 14l6-6l6 6l-1.4 1.4z') // Keyboard Arrow Up
export const ArrowDownIcon = mkIcon('m12 15.4l-6-6L7.4 8l4.6 4.6L16.6 8L18 9.4z') // Keyboard Arrow Down
export const KeyboardArrowDownIcon = mkIcon('m12 15.4l-6-6L7.4 8l4.6 4.6L16.6 8L18 9.4z')
export const KeyboardArrowLeftIcon = mkIcon('m14 18l-6-6l6-6l1.4 1.4l-4.6 4.6l4.6 4.6z')
export const KeyboardArrowRightIcon = mkIcon('M12.6 12L8 7.4L9.4 6l6 6l-6 6L8 16.6z')
export const ArrowUpwardIcon = mkIcon('M11 20V7.825l-5.6 5.6L4 12l8-8l8 8l-1.4 1.425l-5.6-5.6V20z')
export const AddIcon = mkIcon('M11 13H5v-2h6V5h2v6h6v2h-6v6h-2z')
// Context menu items (Material Symbols, filled — same choices as Sorta's menus)
export const OpenInNewIcon = mkIcon('M5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h7v2H5v14h14v-7h2v7q0 .825-.587 1.413T19 21zm4.7-5.3l-1.4-1.4L17.6 5H14V3h7v7h-2V6.4z')
export const TabIcon = mkIcon('M4 20q-.825 0-1.412-.587T2 18V6q0-.825.588-1.412T4 4h16q.825 0 1.413.588T22 6v12q0 .825-.587 1.413T20 20zm9-10h7V6h-7z')
export const VerticalSplitIcon = mkIcon('M3 15v-2h8v2zm0 4v-2h8v2zm0-8V9h8v2zm0-4V5h8v2zm12 12q-.825 0-1.412-.587T13 17V7q0-.825.588-1.412T15 5h4q.825 0 1.413.588T21 7v10q0 .825-.587 1.413T19 19z')
export const OpenInBrowserIcon = mkIcon('M5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v14q0 .825-.587 1.413T19 21h-4v-2h4V7H5v12h4v2zm6 0v-6.15l-1.6 1.6L8 15l4-4l4 4l-1.4 1.45l-1.6-1.6V21z')
export const ContentCopyIcon = mkIcon('M9 18q-.825 0-1.412-.587T7 16V4q0-.825.588-1.412T9 2h9q.825 0 1.413.588T20 4v12q0 .825-.587 1.413T18 18zm-4 4q-.825 0-1.412-.587T3 20V6h2v14h11v2z')
export const ContentCutIcon = mkIcon('m19 21l-7-7l-2.35 2.35q.2.375.275.8T10 18q0 1.65-1.175 2.825T6 22t-2.825-1.175T2 18t1.175-2.825T6 14q.425 0 .85.075t.8.275L10 12L7.65 9.65q-.375.2-.8.275T6 10q-1.65 0-2.825-1.175T2 6t1.175-2.825T6 2t2.825 1.175T10 6q0 .425-.075.85t-.275.8L22 20v1zm-4-10l-2-2l6-6h3v1zM7.413 7.413Q8 6.825 8 6t-.587-1.412T6 4t-1.412.588T4 6t.588 1.413T6 8t1.413-.587m4.937 4.937q.15-.15.15-.35t-.15-.35t-.35-.15t-.35.15t-.15.35t.15.35t.35.15t.35-.15m-4.937 7.063Q8 18.825 8 18t-.587-1.412T6 16t-1.412.588T4 18t.588 1.413T6 20t1.413-.587')
export const ContentPasteIcon = mkIcon('M5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h4.175q.275-.875 1.075-1.437T12 1q1 0 1.788.563T14.85 3H19q.825 0 1.413.588T21 5v14q0 .825-.587 1.413T19 21zm0-2h14V5h-2v3H7V5H5zm7.713-14.288Q13 4.425 13 4t-.288-.712T12 3t-.712.288T11 4t.288.713T12 5t.713-.288')
export const SelectAllIcon = mkIcon('M7 17V7h10v10zm2-2h6V9H9zm-4 4v2q-.825 0-1.412-.587T3 19zm-2-2v-2h2v2zm0-4v-2h2v2zm0-4V7h2v2zm2-4H3q0-.825.588-1.412T5 3zm2 16v-2h2v2zM7 5V3h2v2zm4 16v-2h2v2zm0-16V3h2v2zm4 16v-2h2v2zm0-16V3h2v2zm4 16v-2h2q0 .825-.587 1.413T19 21m0-4v-2h2v2zm0-4v-2h2v2zm0-4V7h2v2zm0-4V3q.825 0 1.413.588T21 5z')
export const DeleteIcon = mkIcon('M7 21q-.825 0-1.412-.587T5 19V6H4V4h5V3h6v1h5v2h-1v13q0 .825-.587 1.413T17 21zm2-4h2V8H9zm4 0h2V8h-2z')
export const CallSplitIcon = mkIcon('M11 20v-7.6l-5-5V10H4V4h6v2H7.4l5.6 5.6V20zm3.85-9.4L13.4 9.15L16.6 6H14V4h6v6h-2V7.4z')
export const RemoveIcon = mkIcon('M5 13v-2h14v2z')
export const SwapHorizIcon = mkIcon('m7 20l-5-5l5-5l1.4 1.425L5.825 14H13v2H5.825L8.4 18.575zm10-6l-1.4-1.425L18.175 10H11V8h7.175L15.6 5.425L17 4l5 5z')
export const LeftPanelCloseIcon = mkIcon('M16.5 16V8l-4 4zM5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v14q0 .825-.587 1.413T19 21zm5-2h9V5h-9z')
export const RightPanelCloseIcon = mkIcon('M7.5 8v8l4-4zM5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v14q0 .825-.587 1.413T19 21zm9-2V5H5v14z')
export const StarIcon = mkIcon('m5.825 21l1.625-7.025L2 9.25l7.2-.625L12 2l2.8 6.625l7.2.625l-5.45 4.725L18.175 21L12 17.275z')
export const BlockIcon = mkIcon('M8.1 21.213q-1.825-.788-3.175-2.138T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22t-3.9-.788m8.825-2.887q.4-.3.75-.65t.65-.75L7.075 5.675q-.4.3-.75.65t-.65.75z')
export const CloseIcon = mkIcon('M6.4 19L5 17.6l5.6-5.6L5 6.4L6.4 5l5.6 5.6L17.6 5L19 6.4L13.4 12l5.6 5.6l-1.4 1.4l-5.6-5.6z')

// Translation editor's inpaint tools (Material Symbols).
export const ColorizeIcon = mkIcon('M3 21v-4.75l8.95-8.95l-1.45-1.4l1.45-1.4l1.9 1.9l3.1-3.1q.125-.125.313-.2t.387-.075t.375.075t.325.2l2.35 2.35q.125.15.2.325t.075.375t-.075.387t-.2.313l-3.075 3.075l1.9 1.95L18.1 13.5l-1.4-1.45L7.75 21zm2-2h1.95l8.3-8.35l-1.9-1.9L5 17.05z')
export const FormatColorFillIcon = mkIcon('M6.175 1.4L7.6 0l8.575 8.575q.575.575.575 1.425t-.575 1.425l-4.75 4.75q-.575.575-1.425.575t-1.425-.575l-4.75-4.75Q3.25 10.85 3.25 10t.575-1.425L8.575 3.8zM10 5.225L5.225 10h9.55zm7.588 11.188Q17 15.825 17 15q0-.525.313-1.125T18 12.75q.225-.3.475-.625T19 11.5q.275.3.525.625t.475.625q.375.525.688 1.125T21 15q0 .825-.587 1.413T19 17t-1.412-.587M2 24v-4h20v4z')
export const BrushIcon = mkIcon('M6 21q-1.125 0-2.225-.55T2 19q.65 0 1.325-.513T4 17q0-1.25.875-2.125T7 14t2.125.875T10 17q0 1.65-1.175 2.825T6 21m5.75-6L9 12.25l8.95-8.95q.275-.275.688-.288t.712.288l1.35 1.35q.3.3.3.7t-.3.7z')
export const InkEraserIcon = mkIcon('M17.25 18H22v2h-6.75zm-12.5 2l-2.125-2.125q-.575-.575-.587-1.425T2.6 15l11-11.4q.575-.6 1.413-.6t1.412.575L21.4 8.55q.575.575.575 1.425T21.4 11.4L13 20z')
export const HealingIcon = mkIcon('M5.45 21.4L2.6 18.55q-.575-.575-.575-1.4t.575-1.4L15.75 2.6q.575-.575 1.4-.575t1.4.575l2.85 2.85q.575.575.575 1.4t-.575 1.4L8.25 21.4q-.575.575-1.4.575t-1.4-.575m7.25-3.05l5.65-5.65l3.05 3.05q.575.575.575 1.4t-.575 1.4l-2.85 2.85q-.575.575-1.4.575t-1.4-.575zm.013-3.637Q13 14.425 13 14t-.288-.712T12 13t-.712.288T11 14t.288.713T12 15t.713-.288M10 13q.425 0 .713-.288T11 12t-.288-.712T10 11t-.712.288T9 12t.288.713T10 13m4 0q.425 0 .713-.288T15 12t-.288-.712T14 11t-.712.288T13 12t.288.713T14 13m-8.375-1.725L2.6 8.25q-.575-.575-.575-1.4t.575-1.4L5.45 2.6q.575-.575 1.4-.575t1.4.575l3.05 3.05zm7.088-.562Q13 10.425 13 10t-.288-.712T12 9t-.712.288T11 10t.288.713T12 11t.713-.288')
export const LassoSelectIcon = mkIcon('m4.025 11.1l-2-.2q.15-1.15.513-2.237T3.525 6.6l1.7 1.05q-.5.775-.787 1.65t-.413 1.8m.9 7.9Q4.1 18.2 3.5 17.237T2.525 15.2l1.9-.65q.3.875.775 1.638T6.325 17.6zm2.75-13.8l-1.05-1.7q.975-.625 2.063-.988T10.925 2l.2 2q-.925.125-1.8.413t-1.65.787m4.3 16.75q-.875 0-1.737-.137t-1.663-.463l.65-1.9q.675.225 1.35.363t1.4.137zm5.65-15.65q-.65-.65-1.412-1.125T14.574 4.4l.65-1.9q1.075.375 2.038.975T19.025 4.9zm2.15 14.85l-2.8-2.8v2.6h-2v-6h6v2h-2.6l2.8 2.8zm.2-9.2q0-.725-.138-1.4t-.362-1.35l1.9-.65q.325.8.463 1.663t.137 1.737z')
export const PolylineIcon = mkIcon('M15 22v-2.5L8 16H3v-6h4.3L10 6.9V2h6v6h-4.3L9 11.1v3.15l6 3V16h6v6z')
export const FormatColorTextIcon = mkIcon('M2 24v-4h20v4zm3.5-7l5.25-14h2.5l5.25 14h-2.4l-1.25-3.6H9.2L7.9 17zm4.4-5.6h4.2l-2.05-5.8h-.1z')
export const ArrowSelectorIcon = mkIcon('m13.775 22l-3.625-7.8L6 20V2l14 11h-7.1l3.6 7.725z')
export const DeselectIcon = mkIcon('m19.775 22.6l-5.6-5.6H7V9.825l-5.6-5.6L2.8 2.8l18.4 18.4zM9 15h3.175L9 11.825zm8-.825l-2-2V9h-3.175l-2-2H17zM5 19v2q-.825 0-1.412-.587T3 19zm-2-2v-2h2v2zm0-4v-2h2v2zm0-4V7h2v2zm4 12v-2h2v2zM7 5V3h2v2zm4 16v-2h2v2zm0-16V3h2v2zm4 16v-2h2v2zm0-16V3h2v2zm4 12v-2h2v2zm0-4v-2h2v2zm0-4V7h2v2zm0-4V3q.825 0 1.413.588T21 5z')

const FAV_FILLED =
  'm12 21l-1.45-1.3q-2.525-2.275-4.175-3.925T3.75 12.812T2.388 10.4T2 8.15Q2 5.8 3.575 4.225T7.5 2.65q1.3 0 2.475.55T12 4.75q.85-1 2.025-1.55t2.475-.55q2.35 0 3.925 1.575T22 8.15q0 1.15-.387 2.25t-1.363 2.412t-2.625 2.963T13.45 19.7z'
const FAV_OUTLINE =
  'm12 21l-1.45-1.3q-2.525-2.275-4.175-3.925T3.75 12.812T2.388 10.4T2 8.15Q2 5.8 3.575 4.225T7.5 2.65q1.3 0 2.475.55T12 4.75q.85-1 2.025-1.55t2.475-.55q2.35 0 3.925 1.575T22 8.15q0 1.15-.387 2.25t-1.363 2.412t-2.625 2.963T13.45 19.7zm0-2.7q2.4-2.15 3.95-3.687t2.45-2.675t1.25-2.026T20 8.15q0-1.5-1-2.5t-2.5-1q-1.175 0-2.175.662T12.95 7h-1.9q-.375-1.025-1.375-1.687T7.5 4.65q-1.5 0-2.5 1t-1 2.5q0 .875.35 1.763t1.25 2.025t2.45 2.675T12 18.3'
// Favorite heart — outline by default; `filled` swaps to the solid glyph (colour
// it red via the caller/CSS for the favorited state).
export function FavoriteIcon({ className, filled }: IconProps & { filled?: boolean }): JSX.Element {
  return (
    <svg className={`micon fav-heart ${className ?? ''}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={filled ? FAV_FILLED : FAV_OUTLINE} />
    </svg>
  )
}

// A clean X for cancel/remove.
export function XIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={`seg-ico ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

// --- Material Symbols downloaded as-is (fill 1, 24px; 960-unit viewBox). ---
function mkIcon960(path: string) {
  return function Icon({ className }: IconProps): JSX.Element {
    return (
      <svg className={`micon ${className ?? ''}`} viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">
        <path d={path} />
      </svg>
    )
  }
}
export const PageGapIcon = mkIcon960('M240-160 80-320l56-56 64 62v-332l-64 62-56-56 160-160 160 160-56 56-64-62v332l64-62 56 56-160 160Zm240-40v-80h400v80H480Zm0-240v-80h400v80H480Zm0-240v-80h400v80H480Z') // format_line_spacing — reader option: 페이지 간격
export const CoverSingleIcon = mkIcon960('M480-280h80v-400H400v80h80v320ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Z') // looks_one — reader option: 첫 페이지 단독
export const WheelFlipOnIcon = mkIcon960('M480-200 240-440l56-56 184 183 184-183 56 56-240 240Zm0-240L240-680l56-56 184 183 184-183 56 56-240 240Z') // keyboard_double_arrow_down — reader option: 스크롤 넘김 ON
export const WheelFlipOffIcon = mkIcon960('M551-80 406-392 240-160v-720l560 440H516l144 309-109 51Z') // arrow_selector_tool — reader option: 스크롤 넘김 OFF
export const ClickLeftIcon = mkIcon960('M460-320v-320L300-480l160 160ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm360-80v-560H200v560h360Z') // right_panel_open — reader option: 넘김 클릭 왼쪽
export const ClickRightIcon = mkIcon960('M500-640v320l160-160-160-160ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm200-80h360v-560H400v560Z') // left_panel_open — reader option: 넘김 클릭 오른쪽
export const NextRightIcon = mkIcon960('M800-240v-480h80v480h-80Zm-320 0-57-56 144-144H80v-80h487L424-664l56-56 240 240-240 240Z') // keyboard_tab — reader option: 다음 페이지 오른쪽
export const NextLeftIcon = mkIcon960('M160-240H80v-480h80v480Zm320 0L240-480l240-240 56 56-143 144h487v80H393l144 144-57 56Z') // keyboard_tab_rtl — reader option: 다음 페이지 왼쪽

// 포커스 모드 level: fullscreen_exit corners (inward) when off; fullscreen
// corners (outward) with the level number inside when on — like the fit icons.
export function FocusLevelIcon({ level, className }: IconProps & { level: number }): JSX.Element {
  return (
    <svg className={`micon ${className ?? ''}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {level > 0 ? (
        <>
          <path d="M3 21v-5h2v3h3v2zm13 0v-2h3v-3h2v5zM3 8V3h5v2H5v3zm16 0V5h-3V3h5v5z" />
          <text x="12" y="12.5" textAnchor="middle" dominantBaseline="central" fontSize="10" fontWeight="700">
            {level}
          </text>
        </>
      ) : (
        <path d="M6 21v-3H3v-2h5v5zm10 0v-5h5v2h-3v3zM3 8V6h3V3h2v5zm13 0V3h2v3h3v2z" />
      )}
    </svg>
  )
}
// Translation editor: layers, text format, stages.
export const LayersIcon = mkIcon('m12 21.05l-9-7l1.65-1.25L12 18.5l7.35-5.7L21 14.05zM12 16L3 9l9-7l9 7z') // layers
export const VisibilityIcon = mkIcon('M15.188 14.688Q16.5 13.375 16.5 11.5t-1.312-3.187T12 7T8.813 8.313T7.5 11.5t1.313 3.188T12 16t3.188-1.312m-5.1-1.276Q9.3 12.625 9.3 11.5t.788-1.912T12 8.8t1.913.788t.787 1.912t-.787 1.913T12 14.2t-1.912-.787m-4.738 3.55Q2.35 14.925 1 11.5q1.35-3.425 4.35-5.462T12 4t6.65 2.038T23 11.5q-1.35 3.425-4.35 5.463T12 19t-6.65-2.037') // visibility
export const VisibilityOffIcon = mkIcon('m19.8 22.6l-4.2-4.15q-.875.275-1.762.413T12 19q-3.775 0-6.725-2.087T1 11.5q.525-1.325 1.325-2.463T4.15 7L1.4 4.2l1.4-1.4l18.4 18.4zM12 16q.275 0 .513-.025t.512-.1l-5.4-5.4q-.075.275-.1.513T7.5 11.5q0 1.875 1.313 3.188T12 16m7.3.45l-3.175-3.15q.175-.425.275-.862t.1-.938q0-1.875-1.312-3.187T12 7q-.5 0-.937.1t-.863.3L7.65 4.85q1.025-.425 2.1-.637T12 4q3.775 0 6.725 2.088T23 11.5q-.575 1.475-1.513 2.738T19.3 16.45m-4.625-4.6l-3-3q.7-.125 1.288.113t1.012.687t.613 1.038t.087 1.162') // visibility-off
export const FormatBoldIcon = mkIcon('M6.8 19V5h5.525q1.625 0 3 1T16.7 8.775q0 1.275-.575 1.963t-1.075.987q.625.275 1.388 1.025T17.2 15q0 2.225-1.625 3.113t-3.05.887zm3.025-2.8h2.6q1.2 0 1.463-.612t.262-.888t-.262-.887t-1.538-.613H9.825zm0-5.7h2.325q.825 0 1.2-.425t.375-.95q0-.6-.425-.975t-1.1-.375H9.825z') // format-bold
export const FormatItalicIcon = mkIcon('M5 19v-2.5h4l3-9H8V5h10v2.5h-3.5l-3 9H15V19z') // format-italic
export const FormatUnderlinedIcon = mkIcon('M5 21v-2h14v2zm3.075-5.575q-1.4-1.575-1.4-4.175V3H9.25v8.4q0 1.4.7 2.275t2.05.875t2.05-.875t.7-2.275V3h2.575v8.25q0 2.6-1.4 4.175T12 17t-3.925-1.575') // format-underlined
export const FormatStrikethroughIcon = mkIcon('M2 14v-2h20v2zm8.5-4V7H5V4h14v3h-5.5v3zm0 10v-4h3v4z') // format-strikethrough
export const FormatAlignLeftIcon = mkIcon('M3 21v-2h18v2zm0-4v-2h12v2zm0-4v-2h18v2zm0-4V7h12v2zm0-4V3h18v2z') // format-align-left
export const FormatAlignCenterIcon = mkIcon('M3 21v-2h18v2zm4-4v-2h10v2zm-4-4v-2h18v2zm4-4V7h10v2zM3 5V3h18v2z') // format-align-center
export const FormatAlignRightIcon = mkIcon('M3 5V3h18v2zm6 4V7h12v2zm-6 4v-2h18v2zm6 4v-2h12v2zm-6 4v-2h18v2z') // format-align-right
export const FormatAlignJustifyIcon = mkIcon('M3 21v-2h18v2zm0-4v-2h18v2zm0-4v-2h18v2zm0-4V7h18v2zm0-4V3h18v2z') // format-align-justify
export const AutoAwesomeIcon = mkIcon('m19 9l-1.25-2.75L15 5l2.75-1.25L19 1l1.25 2.75L23 5l-2.75 1.25L19 9Zm0 14l-1.25-2.75L15 19l2.75-1.25L19 15l1.25 2.75L23 19l-2.75 1.25L19 23ZM9 20l-2.5-5.5L1 12l5.5-2.5L9 4l2.5 5.5L17 12l-5.5 2.5L9 20Z') // auto-awesome
export const ArrowDownwardIcon = mkIcon('M11 4v12.175l-5.6-5.6L4 12l8 8l8-8l-1.4-1.425l-5.6 5.6V4z') // arrow-downward
export const EllipseSelectIcon = mkIcon('M12 22q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22m0-2q3.35 0 5.675-2.325T20 12t-2.325-5.675T12 4T6.325 6.325T4 12t2.325 5.675T12 20') // radio-button-unchecked
export const ChatBubbleIcon = mkIcon('M2 22V4q0-.825.588-1.412T4 2h16q.825 0 1.413.588T22 4v12q0 .825-.587 1.413T20 18H6z') // chat-bubble
export const InvertColorsIcon = mkIcon('M12 21q-3.325 0-5.663-2.3T4 13.125q0-1.65.625-3.062T6.35 7.55L12 2l5.65 5.55q1.1 1.1 1.725 2.513T20 13.125q0 3.275-2.337 5.575T12 21m0-2V4.8L7.75 9q-.875.825-1.312 1.875T6 13.125q0 2.425 1.75 4.15T12 19') // invert-colors
export const TextFieldsIcon = mkIcon('M7 20V7H2V4h13v3h-5v13zm9 0v-8h-3V9h9v3h-3v8z') // text-fields
export const StarOutlineIcon = mkIcon('m8.85 16.825l3.15-1.9l3.15 1.925l-.825-3.6l2.775-2.4l-3.65-.325l-1.45-3.4l-1.45 3.375l-3.65.325l2.775 2.425zM5.825 21l1.625-7.025L2 9.25l7.2-.625L12 2l2.8 6.625l7.2.625l-5.45 4.725L18.175 21L12 17.275zM12 12.25') // star-outline
