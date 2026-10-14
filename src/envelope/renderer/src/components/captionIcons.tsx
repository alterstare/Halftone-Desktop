import type { JSX } from 'react'

// Window caption glyphs for systems without Windows' own icon font
// (Segoe Fluent Icons / Segoe MDL2 Assets — used on Windows, see TitleStrip):
// VS Code's codicons from api.iconify.design (codicon set). Regenerate rather
// than hand-edit paths.
function mk(body: string) {
  return function Icon(): JSX.Element {
    return <svg className="micon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" dangerouslySetInnerHTML={{ __html: body }} />
  }
}

export const ChromeMinimizeIcon = mk("<path fill=\"currentColor\" d=\"M3 7.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5\"/>")
export const ChromeMaximizeIcon = mk("<path fill=\"currentColor\" d=\"M2 4.5A2.5 2.5 0 0 1 4.5 2h7A2.5 2.5 0 0 1 14 4.5v7a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 11.5zM4.5 3A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13h7a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 11.5 3z\"/>")
export const ChromeRestoreIcon = mk("<path fill=\"currentColor\" d=\"M5.085 4A1.5 1.5 0 0 1 6.5 3H10a3 3 0 0 1 3 3v3.5a1.5 1.5 0 0 1-1 1.415V6a2 2 0 0 0-2-2zM4.5 5h5A1.5 1.5 0 0 1 11 6.5v5A1.5 1.5 0 0 1 9.5 13h-5A1.5 1.5 0 0 1 3 11.5v-5A1.5 1.5 0 0 1 4.5 5m0 1a.5.5 0 0 0-.5.5v5a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5v-5a.5.5 0 0 0-.5-.5z\"/>")
export const ChromeCloseIcon = mk("<path fill=\"currentColor\" d=\"m2.589 2.716l.057-.07a.5.5 0 0 1 .638-.057l.07.057L8 7.293l4.646-4.647a.5.5 0 0 1 .708.708L8.707 8l4.647 4.646a.5.5 0 0 1 .057.638l-.057.07a.5.5 0 0 1-.638.057l-.07-.057L8 8.707l-4.646 4.647a.5.5 0 0 1-.708-.708L7.293 8L2.646 3.354a.5.5 0 0 1-.057-.638l.057-.07z\"/>")
