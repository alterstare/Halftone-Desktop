// 설정 화면 draft (Halftone's settings shell): the sections show the saved
// settings with the unsaved edits laid over them, and edit only the overlay —
// nothing applies until 저장. Only the edited keys are kept (not a whole copy),
// so values changed elsewhere meanwhile (volume, LP tabs) aren't written back.
import { createContext, useContext } from 'react'
import type { Settings } from '../../../shared/types'

export interface SettingsDraft {
  s: Settings // saved settings + edits
  set: (p: Partial<Settings>) => void
}

export const DraftContext = createContext<SettingsDraft | null>(null)

export function useDraft(): SettingsDraft | null {
  return useContext(DraftContext)
}

// Edits whose value differs from the saved one.
export function changed(saved: Settings, edits: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {}
  for (const k of Object.keys(edits) as (keyof Settings)[]) {
    if (JSON.stringify(edits[k]) !== JSON.stringify(saved[k])) (out as Record<string, unknown>)[k] = edits[k]
  }
  return out
}
