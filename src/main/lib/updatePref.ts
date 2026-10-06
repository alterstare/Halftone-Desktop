// 설정 › 관리 › 자동 업데이트: the updater (main/index.ts, packaged builds only)
// registers how to turn itself on/off; saving settings calls it.
let apply: ((on: boolean) => void) | null = null

export function setAutoUpdateApplier(fn: (on: boolean) => void): void {
  apply = fn
}

export function applyAutoUpdate(on: boolean): void {
  apply?.(on)
}
