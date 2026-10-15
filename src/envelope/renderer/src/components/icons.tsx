import type { JSX } from 'react'

// Material Symbols (filled), from api.iconify.design/material-symbols — the
// same set as Halftone / Sorta. Colour via currentColor, size from the parent's
// font-size (1.15em). Regenerate rather than hand-edit paths.
interface IconProps {
  className?: string
}

function mkIcon(body: string) {
  return function Icon({ className }: IconProps): JSX.Element {
    return (
      <svg
        className={`micon ${className ?? ''}`}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: body }}
      />
    )
  }
}

export const AddIcon = mkIcon("<path fill=\"currentColor\" d=\"M11 13H5v-2h6V5h2v6h6v2h-6v6h-2z\"/>")
export const AlbumIcon = mkIcon("<path fill=\"currentColor\" d=\"M12 16.5q1.875 0 3.188-1.312T16.5 12t-1.312-3.187T12 7.5T8.813 8.813T7.5 12t1.313 3.188T12 16.5m-.712-3.787Q11 12.425 11 12t.288-.712T12 11t.713.288T13 12t-.288.713T12 13t-.712-.288M12 22q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22\"/>")
export const AudioFileIcon = mkIcon("<path fill=\"currentColor\" d=\"M10.75 19q.95 0 1.6-.65t.65-1.6V13h3v-2h-4v3.875q-.275-.2-.587-.288t-.663-.087q-.95 0-1.6.65t-.65 1.6t.65 1.6t1.6.65M6 22q-.825 0-1.412-.587T4 20V4q0-.825.588-1.412T6 2h8l6 6v12q0 .825-.587 1.413T18 22zm7-13h5l-5-5z\"/>")
export const BedtimeIcon = mkIcon("<path fill=\"currentColor\" d=\"M12.1 22q-2.1 0-3.937-.8t-3.2-2.162t-2.163-3.2T2 11.9q0-3.65 2.325-6.437T10.25 2q-.45 2.475.275 4.838t2.5 4.137t4.138 2.5T22 13.75q-.65 3.6-3.45 5.925T12.1 22\"/>")
export const BookmarkIcon = mkIcon("<path fill=\"currentColor\" d=\"M5 21V5q0-.825.588-1.412T7 3h10q.825 0 1.413.588T19 5v16l-7-3z\"/>")
export const BookmarkAddIcon = mkIcon("<path fill=\"currentColor\" d=\"M5 21V5q0-.825.588-1.412T7 3h7q-.5.75-.75 1.438T13 6q0 1.8 1.138 3.175T17 10.9q.575.075 1 .075t1-.075V21l-7-3zM17 9V7h-2V5h2V3h2v2h2v2h-2v2z\"/>")
export const BookmarksIcon = mkIcon("<path fill=\"currentColor\" d=\"M4 22V8q0-.825.588-1.412T6 6h8q.825 0 1.413.588T16 8v14l-6-3zm14-4V4H7V2h11q.825 0 1.413.588T20 4v14z\"/>")
export const CheckIcon = mkIcon("<path fill=\"currentColor\" d=\"m9.55 18l-5.7-5.7l1.425-1.425L9.55 15.15l9.175-9.175L20.15 7.4z\"/>")
export const CleaningServicesIcon = mkIcon("<path fill=\"currentColor\" d=\"M3 23v-7q0-2.075 1.463-3.537T8 11h1V3q0-.825.588-1.412T11 1h2q.825 0 1.413.588T15 3v8h1q2.075 0 3.538 1.463T21 16v7zm2-2h2v-3q0-.425.288-.712T8 17t.713.288T9 18v3h2v-3q0-.425.288-.712T12 17t.713.288T13 18v3h2v-3q0-.425.288-.712T16 17t.713.288T17 18v3h2v-5q0-1.25-.875-2.125T16 13H8q-1.25 0-2.125.875T5 16z\"/>")
export const CloseIcon = mkIcon("<path fill=\"currentColor\" d=\"M6.4 19L5 17.6l5.6-5.6L5 6.4L6.4 5l5.6 5.6L17.6 5L19 6.4L13.4 12l5.6 5.6l-1.4 1.4l-5.6-5.6z\"/>")
export const CloseFullscreenIcon = mkIcon("<path fill=\"currentColor\" d=\"M3.4 22L2 20.6L8.6 14H4v-2h8v8h-2v-4.6zM12 12V4h2v4.6L20.6 2L22 3.4L15.4 10H20v2z\"/>")
export const CloseSmallIcon = mkIcon("<path fill=\"currentColor\" d=\"m8.382 17.025l-1.407-1.4L10.593 12L6.975 8.4L8.382 7L12 10.615L15.593 7L17 8.4L13.382 12L17 15.625l-1.407 1.4L12 13.41z\"/>")
export const CloudDownloadIcon = mkIcon("<path fill=\"currentColor\" d=\"M6.5 20q-2.275 0-3.887-1.575T1 14.575q0-1.95 1.175-3.475T5.25 9.15q.575-2.025 2.138-3.4T11 4.075v8.075L9.4 10.6L8 12l4 4l4-4l-1.4-1.4l-1.6 1.55V4.075q2.575.35 4.288 2.313T19 11q1.725.2 2.863 1.488T23 15.5q0 1.875-1.312 3.188T18.5 20z\"/>")
export const CollectionsBookmarkIcon = mkIcon("<path fill=\"currentColor\" d=\"M4 22q-.825 0-1.412-.587T2 20V6h2v14h14v2zm4-4q-.825 0-1.412-.587T6 16V4q0-.825.588-1.412T8 2h12q.825 0 1.413.588T22 4v12q0 .825-.587 1.413T20 18zm5-7l2.5-1.5L18 11V4h-5z\"/>")
export const ContentCutIcon = mkIcon("<path fill=\"currentColor\" d=\"m19 21l-7-7l-2.35 2.35q.2.375.275.8T10 18q0 1.65-1.175 2.825T6 22t-2.825-1.175T2 18t1.175-2.825T6 14q.425 0 .85.075t.8.275L10 12L7.65 9.65q-.375.2-.8.275T6 10q-1.65 0-2.825-1.175T2 6t1.175-2.825T6 2t2.825 1.175T10 6q0 .425-.075.85t-.275.8L22 20v1zm-4-10l-2-2l6-6h3v1zM7.413 7.413Q8 6.825 8 6t-.587-1.412T6 4t-1.412.588T4 6t.588 1.413T6 8t1.413-.587m4.937 4.937q.15-.15.15-.35t-.15-.35t-.35-.15t-.35.15t-.15.35t.15.35t.35.15t.35-.15m-4.937 7.063Q8 18.825 8 18t-.587-1.412T6 16t-1.412.588T4 18t.588 1.413T6 20t1.413-.587\"/>")
export const CropSquareIcon = mkIcon("<path fill=\"currentColor\" d=\"M5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v14q0 .825-.587 1.413T19 21z\"/>")
export const DeleteIcon = mkIcon("<path fill=\"currentColor\" d=\"M7 21q-.825 0-1.412-.587T5 19V6H4V4h5V3h6v1h5v2h-1v13q0 .825-.587 1.413T17 21zm2-4h2V8H9zm4 0h2V8h-2z\"/>")
export const DriveFileRenameOutlineIcon = mkIcon("<path fill=\"currentColor\" d=\"M11.225 17H18v-2h-4.775zM6 17h3.075l6.5-6.5q.225-.225.325-.513t.1-.562t-.112-.55t-.313-.5l-.925-.925q-.225-.225-.5-.337T13.575 7q-.275 0-.55.1t-.5.325L6 13.925zm8.5-7.575l-.925-.925zm-7 6.075v-.95l4.05-4.025l.475.45l.45.475L8.45 15.5zm4.525-4.525l.45.475l-.925-.925zM5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v14q0 .825-.587 1.413T19 21zm0-2h14V5H5zM5 5v14z\"/>")
export const EditIcon = mkIcon("<path fill=\"currentColor\" d=\"M3 21v-4.25L16.2 3.575q.3-.275.663-.425t.762-.15t.775.15t.65.45L20.425 5q.3.275.438.65T21 6.4q0 .4-.137.763t-.438.662L7.25 21zM17.6 7.8L19 6.4L17.6 5l-1.4 1.4z\"/>")
export const FavoriteIcon = mkIcon("<path fill=\"currentColor\" d=\"m12 21l-1.45-1.3q-2.525-2.275-4.175-3.925T3.75 12.812T2.388 10.4T2 8.15Q2 5.8 3.575 4.225T7.5 2.65q1.3 0 2.475.55T12 4.75q.85-1 2.025-1.55t2.475-.55q2.35 0 3.925 1.575T22 8.15q0 1.15-.387 2.25t-1.363 2.412t-2.625 2.963T13.45 19.7z\"/>")
export const FavoriteOutlineIcon = mkIcon("<path fill=\"currentColor\" d=\"m12 21l-1.45-1.3q-2.525-2.275-4.175-3.925T3.75 12.812T2.388 10.4T2 8.15Q2 5.8 3.575 4.225T7.5 2.65q1.3 0 2.475.55T12 4.75q.85-1 2.025-1.55t2.475-.55q2.35 0 3.925 1.575T22 8.15q0 1.15-.387 2.25t-1.363 2.412t-2.625 2.963T13.45 19.7zm0-2.7q2.4-2.15 3.95-3.687t2.45-2.675t1.25-2.026T20 8.15q0-1.5-1-2.5t-2.5-1q-1.175 0-2.175.662T12.95 7h-1.9q-.375-1.025-1.375-1.687T7.5 4.65q-1.5 0-2.5 1t-1 2.5q0 .875.35 1.763t1.25 2.025t2.45 2.675T12 18.3m0-6.825\"/>")
export const FilterAltIcon = mkIcon("<path fill=\"currentColor\" d=\"M11 20q-.425 0-.712-.288T10 19v-6L4.2 5.6q-.375-.5-.112-1.05T5 4h14q.65 0 .913.55T19.8 5.6L14 13v6q0 .425-.288.713T13 20z\"/>")
export const FilterNoneIcon = mkIcon("<path fill=\"currentColor\" d=\"M8 18q-.825 0-1.412-.587T6 16V4q0-.825.588-1.412T8 2h12q.825 0 1.413.588T22 4v12q0 .825-.587 1.413T20 18zm-4 4q-.825 0-1.412-.587T2 20V6h2v14h14v2z\"/>")
export const FirstPageIcon = mkIcon("<path fill=\"currentColor\" d=\"M6 18V6h2v12zm11 0l-6-6l6-6l1.4 1.4l-4.6 4.6l4.6 4.6z\"/>")
export const FileOpenIcon = mkIcon("<path fill=\"currentColor\" d=\"M21.95 22.375L19 19.425v2.225h-2V16h5.65v2H20.4l2.95 2.95zM13 9h5l-5-5zM6 22q-.825 0-1.412-.587T4 20V4q0-.825.588-1.412T6 2h8l6 6v6h-5v8z\"/>")
export const FolderOpenIcon = mkIcon("<path fill=\"currentColor\" d=\"M4 20q-.825 0-1.412-.587T2 18V6q0-.825.588-1.412T4 4h6l2 2h8q.825 0 1.413.588T22 8H4v10l2.4-8h17.1l-2.575 8.575q-.2.65-.737 1.038T19 20z\"/>")
export const Forward5Icon = mkIcon("<path fill=\"currentColor\" d=\"M8.488 21.288q-1.638-.713-2.85-1.925t-1.925-2.85T3 13t.713-3.512t1.924-2.85t2.85-1.925T12 4h.15L10.6 2.45L12 1l4 4l-4 4l-1.4-1.45L12.15 6H12Q9.075 6 7.038 8.038T5 13t2.038 4.963T12 20t4.963-2.037T19 13h2q0 1.875-.712 3.513t-1.925 2.85t-2.85 1.925T12 22t-3.512-.712M9.5 16v-1.5h3v-1h-3V10H14v1.5h-3v1h2q.425 0 .713.288T14 13.5V15q0 .425-.288.713T13 16z\"/>")
export const FullscreenIcon = mkIcon("<path fill=\"currentColor\" d=\"M3 21v-5h2v3h3v2zm13 0v-2h3v-3h2v5zM3 8V3h5v2H5v3zm16 0V5h-3V3h5v5z\"/>")
export const GraphicEqIcon = mkIcon("<path fill=\"currentColor\" d=\"M7 18V6h2v12zm4 4V2h2v20zm-8-8v-4h2v4zm12 4V6h2v12zm4-4v-4h2v4z\"/>")
export const GridViewIcon = mkIcon("<path fill=\"currentColor\" d=\"M3 11V3h8v8zm0 10v-8h8v8zm10-10V3h8v8zm0 10v-8h8v8z\"/>")
export const HistoryIcon = mkIcon("<path fill=\"currentColor\" d=\"M12 21q-3.45 0-6.012-2.287T3.05 13H5.1q.35 2.6 2.313 4.3T12 19q2.925 0 4.963-2.037T19 12t-2.037-4.962T12 5q-1.725 0-3.225.8T6.25 8H9v2H3V4h2v2.35q1.275-1.6 3.113-2.475T12 3q1.875 0 3.513.713t2.85 1.924t1.925 2.85T21 12t-.712 3.513t-1.925 2.85t-2.85 1.925T12 21m2.8-4.8L11 12.4V7h2v4.6l3.2 3.2z\"/>")
export const HomeIcon = mkIcon("<path fill=\"currentColor\" d=\"M4 21V9l8-6l8 6v12h-6v-7h-4v7z\"/>")
export const ImageIcon = mkIcon("<path fill=\"currentColor\" d=\"M5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v14q0 .825-.587 1.413T19 21zm1-4h12l-3.75-5l-3 4L9 13z\"/>")
export const KeepIcon = mkIcon("<path fill=\"currentColor\" d=\"m16 12l2 2v2h-5v6l-1 1l-1-1v-6H6v-2l2-2V5H7V3h10v2h-1z\"/>")
export const KeyboardIcon = mkIcon("<path fill=\"currentColor\" d=\"M4 19q-.825 0-1.412-.587T2 17V7q0-.825.588-1.412T4 5h16q.825 0 1.413.588T22 7v10q0 .825-.587 1.413T20 19zm4-3h8v-2H8zm-3-3h2v-2H5zm3 0h2v-2H8zm3 0h2v-2h-2zm3 0h2v-2h-2zm3 0h2v-2h-2zM5 10h2V8H5zm3 0h2V8H8zm3 0h2V8h-2zm3 0h2V8h-2zm3 0h2V8h-2z\"/>")
export const KeyboardArrowDownIcon = mkIcon("<path fill=\"currentColor\" d=\"m12 15.4l-6-6L7.4 8l4.6 4.6L16.6 8L18 9.4z\"/>")
export const KeyboardArrowLeftIcon = mkIcon("<path fill=\"currentColor\" d=\"m14 18l-6-6l6-6l1.4 1.4l-4.6 4.6l4.6 4.6z\"/>")
export const KeyboardArrowRightIcon = mkIcon("<path fill=\"currentColor\" d=\"M12.6 12L8 7.4L9.4 6l6 6l-6 6L8 16.6z\"/>")
export const KeyboardArrowUpIcon = mkIcon("<path fill=\"currentColor\" d=\"m12 10.8l-4.6 4.6L6 14l6-6l6 6l-1.4 1.4z\"/>")
export const LabelIcon = mkIcon("<path fill=\"currentColor\" d=\"M4 20q-.825 0-1.412-.587T2 18V6q0-.825.588-1.412T4 4h11q.475 0 .9.213t.7.587L22 12l-5.4 7.2q-.275.375-.7.588T15 20z\"/>")
export const LastPageIcon = mkIcon("<path fill=\"currentColor\" d=\"m7 18l-1.4-1.4l4.6-4.6l-4.6-4.6L7 6l6 6zm9 0V6h2v12z\"/>")
export const LeftPanelCloseIcon = mkIcon("<path fill=\"currentColor\" d=\"M16.5 16V8l-4 4zM5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v14q0 .825-.587 1.413T19 21zm5-2h9V5h-9z\"/>")
export const LeftPanelOpenIcon = mkIcon("<path fill=\"currentColor\" d=\"M12.5 8v8l4-4zM5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v14q0 .825-.587 1.413T19 21zm5-2h9V5h-9z\"/>")
export const LibraryMusicIcon = mkIcon("<path fill=\"currentColor\" d=\"M12.5 15q1.05 0 1.775-.725T15 12.5V7h3V5h-4v5.5q-.325-.25-.7-.375T12.5 10q-1.05 0-1.775.725T10 12.5t.725 1.775T12.5 15M8 18q-.825 0-1.412-.587T6 16V4q0-.825.588-1.412T8 2h12q.825 0 1.413.588T22 4v12q0 .825-.587 1.413T20 18zm-4 4q-.825 0-1.412-.587T2 20V6h2v14h14v2z\"/>")
export const LyricsIcon = mkIcon("<path fill=\"currentColor\" d=\"M6 14h4v-2H6zm10.875-2.875Q16 10.25 16 9t.875-2.125T19 6q.275 0 .513.05t.487.125V1h4v2h-2v6q0 1.25-.875 2.125T19 12t-2.125-.875M6 11h7V9H6zm0-3h7V6H6zm0 10l-4 4V4q0-.825.588-1.412T4 2h11q.825 0 1.413.588T17 4v.425q-1.375.6-2.187 1.838T14 9t.813 2.738T17 13.575V16q0 .825-.587 1.413T15 18z\"/>")
export const MergeIcon = mkIcon("<path fill=\"currentColor\" d=\"M6.4 21L5 19.6l4.825-4.85q.575-.575.875-1.3t.3-1.525v-5.1L9.4 8.4L8 7l4-4l4 4l-1.4 1.4L13 6.825v5.1q0 .8.3 1.525t.875 1.3L19 19.6L17.6 21L12 15.4z\"/>")
export const MoreHorizIcon = mkIcon("<path fill=\"currentColor\" d=\"M6 14q-.825 0-1.412-.587T4 12t.588-1.412T6 10t1.413.588T8 12t-.587 1.413T6 14m6 0q-.825 0-1.412-.587T10 12t.588-1.412T12 10t1.413.588T14 12t-.587 1.413T12 14m6 0q-.825 0-1.412-.587T16 12t.588-1.412T18 10t1.413.588T20 12t-.587 1.413T18 14\"/>")
export const CancelIcon = mkIcon("<path fill=\"currentColor\" d=\"m8.4 17l3.6-3.6l3.6 3.6l1.4-1.4l-3.6-3.6L17 8.4L15.6 7L12 10.6L8.4 7L7 8.4l3.6 3.6L7 15.6zm3.6 5q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22\"/>")
export const OpenInFullIcon = mkIcon("<path fill=\"currentColor\" d=\"M3 21v-8h2v4.6L17.6 5H13V3h8v8h-2V6.4L6.4 19H11v2z\"/>")
export const PauseIcon = mkIcon("<path fill=\"currentColor\" d=\"M14 19V5h4v14zm-8 0V5h4v14z\"/>")
export const PictureInPictureAltIcon = mkIcon("<path fill=\"currentColor\" d=\"M11 17h8v-6h-8zm-7 3q-.825 0-1.412-.587T2 18V6q0-.825.588-1.412T4 4h16q.825 0 1.413.588T22 6v12q0 .825-.587 1.413T20 20z\"/>")
export const PlayArrowIcon = mkIcon("<path fill=\"currentColor\" d=\"M8 19V5l11 7z\"/>")
export const RedoIcon = mkIcon("<path fill=\"currentColor\" d=\"M9.9 19q-2.425 0-4.163-1.575T4 13.5t1.738-3.925T9.9 8h6.3l-2.6-2.6L15 4l5 5l-5 5l-1.4-1.4l2.6-2.6H9.9q-1.575 0-2.738 1T6 13.5T7.163 16T9.9 17H17v2z\"/>")
export const RefreshIcon = mkIcon("<path fill=\"currentColor\" d=\"M12 20q-3.35 0-5.675-2.325T4 12t2.325-5.675T12 4q1.725 0 3.3.712T18 6.75V4h2v7h-7V9h4.2q-.8-1.4-2.187-2.2T12 6Q9.5 6 7.75 7.75T6 12t1.75 4.25T12 18q1.925 0 3.475-1.1T17.65 14h2.1q-.7 2.65-2.85 4.325T12 20\"/>")
export const RemoveIcon = mkIcon("<path fill=\"currentColor\" d=\"M5 13v-2h14v2z\"/>")
export const RepeatIcon = mkIcon("<path fill=\"currentColor\" d=\"m7 22l-4-4l4-4l1.4 1.45L6.85 17H17v-4h2v6H6.85l1.55 1.55zM5 11V5h12.15L15.6 3.45L17 2l4 4l-4 4l-1.4-1.45L17.15 7H7v4z\"/>")
export const RepeatOneIcon = mkIcon("<path fill=\"currentColor\" d=\"M11.5 15v-4.5H10V9h3v6zM7 22l-4-4l4-4l1.4 1.45L6.85 17H17v-4h2v6H6.85l1.55 1.55zM5 11V5h12.15L15.6 3.45L17 2l4 4l-4 4l-1.4-1.45L17.15 7H7v4z\"/>")
export const Replay5Icon = mkIcon("<path fill=\"currentColor\" d=\"M8.488 21.288q-1.638-.713-2.85-1.925t-1.925-2.85T3 13h2q0 2.925 2.038 4.963T12 20t4.963-2.037T19 13t-2.037-4.962T12 6h-.15l1.55 1.55L12 9L8 5l4-4l1.4 1.45L11.85 4H12q1.875 0 3.513.713t2.85 1.925t1.925 2.85T21 13t-.712 3.513t-1.925 2.85t-2.85 1.925T12 22t-3.512-.712M9.5 16v-1.5h3v-1h-3V10H14v1.5h-3v1h2q.425 0 .713.288T14 13.5V15q0 .425-.288.713T13 16z\"/>")
export const RightPanelCloseIcon = mkIcon("<path fill=\"currentColor\" d=\"M7.5 8v8l4-4zM5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v14q0 .825-.587 1.413T19 21zm9-2V5H5v14z\"/>")
export const RightPanelOpenIcon = mkIcon("<path fill=\"currentColor\" d=\"M11.5 16V8l-4 4zM5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v14q0 .825-.587 1.413T19 21zm9-2V5H5v14z\"/>")
export const SaveIcon = mkIcon("<path fill=\"currentColor\" d=\"M21 7v12q0 .825-.587 1.413T19 21H5q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h12zm-6.875 10.125Q15 16.25 15 15t-.875-2.125T12 12t-2.125.875T9 15t.875 2.125T12 18t2.125-.875M6 10h9V6H6z\"/>")
export const ScheduleIcon = mkIcon("<path fill=\"currentColor\" d=\"m15.3 16.7l1.4-1.4l-3.7-3.7V7h-2v5.4zM12 22q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22\"/>")
export const SearchIcon = mkIcon("<path fill=\"currentColor\" d=\"m19.6 21l-6.3-6.3q-.75.6-1.725.95T9.5 16q-2.725 0-4.612-1.888T3 9.5t1.888-4.612T9.5 3t4.613 1.888T16 9.5q0 1.1-.35 2.075T14.7 13.3l6.3 6.3zM9.5 14q1.875 0 3.188-1.312T14 9.5t-1.312-3.187T9.5 5T6.313 6.313T5 9.5t1.313 3.188T9.5 14\"/>")
export const SettingsIcon = mkIcon("<path fill=\"currentColor\" d=\"m9.25 22l-.4-3.2q-.325-.125-.612-.3t-.563-.375L4.7 19.375l-2.75-4.75l2.575-1.95Q4.5 12.5 4.5 12.338v-.675q0-.163.025-.338L1.95 9.375l2.75-4.75l2.975 1.25q.275-.2.575-.375t.6-.3l.4-3.2h5.5l.4 3.2q.325.125.613.3t.562.375l2.975-1.25l2.75 4.75l-2.575 1.95q.025.175.025.338v.674q0 .163-.05.338l2.575 1.95l-2.75 4.75l-2.95-1.25q-.275.2-.575.375t-.6.3l-.4 3.2zm2.8-6.5q1.45 0 2.475-1.025T15.55 12t-1.025-2.475T12.05 8.5q-1.475 0-2.488 1.025T8.55 12t1.013 2.475T12.05 15.5\"/>")
export const ShuffleIcon = mkIcon("<path fill=\"currentColor\" d=\"M14 20v-2h2.6l-3.175-3.175L14.85 13.4L18 16.55V14h2v6zm-8.6 0L4 18.6L16.6 6H14V4h6v6h-2V7.4zm3.775-9.425L4 5.4L5.4 4l5.175 5.175z\"/>")
export const SkipNextIcon = mkIcon("<path fill=\"currentColor\" d=\"M16.5 18V6h2v12zm-11 0V6l9 6z\"/>")
export const SkipPreviousIcon = mkIcon("<path fill=\"currentColor\" d=\"M5.5 18V6h2v12zm13 0l-9-6l9-6z\"/>")
export const SpeedIcon = mkIcon("<path fill=\"currentColor\" d=\"M10.45 15.5q.625.625 1.575.588T13.4 15.4L19 7l-8.4 5.6q-.65.45-.712 1.362t.562 1.538M5.1 20q-.55 0-1.012-.238t-.738-.712q-.65-1.175-1-2.437T2 14q0-2.075.788-3.9t2.137-3.175T8.1 4.788T12 4q2.05 0 3.85.775T19 6.888t2.15 3.125t.825 3.837q.025 1.375-.312 2.688t-1.038 2.512q-.275.475-.737.713T18.874 20z\"/>")
export const StarIcon = mkIcon("<path fill=\"currentColor\" d=\"m5.825 21l1.625-7.025L2 9.25l7.2-.625L12 2l2.8 6.625l7.2.625l-5.45 4.725L18.175 21L12 17.275z\"/>")
export const SubtitlesIcon = mkIcon("<path fill=\"currentColor\" d=\"M4 20q-.825 0-1.412-.587T2 18V6q0-.825.588-1.412T4 4h16q.825 0 1.413.588T22 6v12q0 .825-.587 1.413T20 20zm2-4h8v-2H6zm10 0h2v-2h-2zM6 12h2v-2H6zm4 0h8v-2h-8z\"/>")
export const SubtitlesOffIcon = mkIcon("<path fill=\"currentColor\" d=\"M18 10h-5.15l-6-6H20q.825 0 1.413.588T22 6v11.9q0 .275-.05.525t-.2.475l-6.9-6.9H18zm2.55 13.35L17.15 20H4q-.825 0-1.412-.587T2 18V6q0-.825.588-1.412T4 4v2.8L.65 3.45l1.4-1.4l19.9 19.9zM6 12h2v-1.2l-.8-.8H6zm5.15 2H6v2h7.15z\"/>")
export const TextDecreaseIcon = mkIcon("<path fill=\"currentColor\" d=\"M1 19L6.25 5h2.5L14 19h-2.4l-1.275-3.575h-5.65L3.4 19zm4.4-5.6h4.2L7.55 7.6h-.1zM15 13v-2h8v2z\"/>")
export const TextIncreaseIcon = mkIcon("<path fill=\"currentColor\" d=\"M1 19L6.25 5h2.5L14 19h-2.4l-1.275-3.575h-5.65L3.4 19zm4.4-5.6h4.2L7.55 7.6h-.1zM18 16v-3h-3v-2h3V8h2v3h3v2h-3v3z\"/>")
export const TranslateIcon = mkIcon("<path fill=\"currentColor\" d=\"m11.9 22l4.55-12h2.1l4.55 12H21l-1.075-3.05h-4.85L14 22zM4 19l-1.4-1.4l5.05-5.05q-.875-.875-1.588-2T4.75 8h2.1q.5.975 1 1.7t1.2 1.45q.825-.825 1.713-2.313T12.1 6H1V4h7V2h2v2h7v2h-2.9q-.525 1.8-1.575 3.7t-2.075 2.9l2.4 2.45l-.75 2.05l-3.05-3.125zm11.7-1.8h3.6l-1.8-5.1z\"/>")
export const UndoIcon = mkIcon("<path fill=\"currentColor\" d=\"M7 19v-2h7.1q1.575 0 2.738-1T18 13.5T16.838 11T14.1 10H7.8l2.6 2.6L9 14L4 9l5-5l1.4 1.4L7.8 8h6.3q2.425 0 4.163 1.575T20 13.5t-1.737 3.925T14.1 19z\"/>")
export const UpdateIcon = mkIcon("<path fill=\"currentColor\" d=\"M12 21q-1.875 0-3.512-.712t-2.85-1.925t-1.925-2.85T3 12t.713-3.512t1.924-2.85t2.85-1.925T12 3q2.05 0 3.888.875T19 6.35V4h2v6h-6V8h2.75q-1.025-1.4-2.525-2.2T12 5Q9.075 5 7.038 7.038T5 12t2.038 4.963T12 19q2.625 0 4.588-1.7T18.9 13h2.05q-.375 3.425-2.937 5.713T12 21m2.8-4.8L11 12.4V7h2v4.6l3.2 3.2z\"/>")
export const UpdateDisabledIcon = mkIcon("<path fill=\"currentColor\" d=\"m19.775 22.625l-3-3q-1.05.65-2.25 1.013T12 21q-1.875 0-3.512-.712t-2.85-1.925t-1.925-2.85T3 12q0-1.325.363-2.525t1.012-2.25l-3-3L2.8 2.8l18.4 18.4zM12 19q.9 0 1.738-.213t1.587-.612l-9.5-9.5q-.4.75-.612 1.588T5 12q0 2.925 2.038 4.963T12 19m3-9V8h2.75q-1.025-1.4-2.525-2.2T12 5q-.9 0-1.737.213t-1.588.612l-1.45-1.45q1.05-.65 2.25-1.012T12 3q2.05 0 3.888.875T19 6.35V4h2v6zm-2 .15l-2-2V7h2zm6.625 6.625l-1.45-1.45q.275-.55.463-1.125T18.9 13h2.05q-.125 1.05-.462 2t-.863 1.775\"/>")
export const ViewListIcon = mkIcon("<path fill=\"currentColor\" d=\"M9 20h11q.825 0 1.413-.587T22 18v-2H9zM2 8h5V4H4q-.825 0-1.412.588T2 6zm0 6h5v-4H2zm2 6h3v-4H2v2q0 .825.588 1.413T4 20m5-6h13v-4H9zm0-6h13V6q0-.825-.587-1.412T20 4H9z\"/>")
export const VolumeOffIcon = mkIcon("<path fill=\"currentColor\" d=\"m19.8 22.6l-3.025-3.025q-.625.4-1.325.688t-1.45.462v-2.05q.35-.125.688-.25t.637-.3L12 14.8V20l-5-5H3V9h3.2L1.4 4.2l1.4-1.4l18.4 18.4zm-.2-5.8l-1.45-1.45q.425-.775.638-1.625t.212-1.75q0-2.35-1.375-4.2T14 5.275v-2.05q3.1.7 5.05 3.138T21 11.975q0 1.325-.363 2.55T19.6 16.8m-3.35-3.35L14 11.2V7.95q1.175.55 1.838 1.65T16.5 12q0 .375-.062.738t-.188.712M12 9.2L9.4 6.6L12 4z\"/>")
export const VolumeUpIcon = mkIcon("<path fill=\"currentColor\" d=\"M14 20.725v-2.05q2.25-.65 3.625-2.5t1.375-4.2t-1.375-4.2T14 5.275v-2.05q3.1.7 5.05 3.138T21 11.975t-1.95 5.613T14 20.725M3 15V9h4l5-5v16l-5-5zm11 1V7.95q1.175.55 1.838 1.65T16.5 12q0 1.275-.663 2.363T14 16\"/>")
