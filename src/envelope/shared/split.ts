// Works split out of one folder by the work codes in their file names: a
// folder that holds many single-file works ("01M.タイトルRJ222673.mp3", …)
// becomes one work per code. Such a work's path is "<folder>|<code>" — "|"
// can't be in a Windows path, so it never names a real folder; the files
// stay where they are.
export const SPLIT_MARK = '|'
const SPLIT_PATH = /^(.*)\|([RVB]J\d{6,8})$/i

// The folder a work's files are in (a split work: the shared folder).
export function workDir(path: string): string {
  return path.match(SPLIT_PATH)?.[1] ?? path
}

// The code of a split work, null for a work that is its own folder.
export function splitCode(path: string): string | null {
  return path.match(SPLIT_PATH)?.[2]?.toUpperCase() ?? null
}

export function splitPath(folder: string, code: string): string {
  return `${folder}${SPLIT_MARK}${code.toUpperCase()}`
}
