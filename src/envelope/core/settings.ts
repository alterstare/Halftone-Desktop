// Settings live in the `settings` table, one row per top-level key. Missing
// keys fall back to DEFAULT_SETTINGS, so new settings need no migration.
import type { Settings } from '../shared/types'
import type { Db } from './db'

export const DEFAULT_SETTINGS: Settings = {
  libraryDirs: [],
  sePref: 'on',
  formatPref: 'lossless',
  seekStep: 5,
  volume: 1,
  rate: 1,
  repeat: 'off',
  shuffle: false,
  libSort: 'recent',
  libDir: 'desc',
  libLayout: 'grid',
  subMode: 'both',
  subSize: 22,
  subsVisible: true,
  lyricsPanel: true,
  mp3Bitrate: 320,
  coverSquare: false,
  coverSkipExisting: true,
  originalsInFolder: true,
  shortcuts: {},
  tabSide: 'right',
  miniOnTop: true,
  resume: true,
  tabs: [],
  titleSource: 'folder',
  coverSource: 'folder',
  theme: 'dark',
  autoUpdate: true,
  pageSize: 50,
  asrEngine: 'local',
  groqApiKey: '',
  localModel: 'large-v3-turbo-q5_0',
  localDevice: 'auto',
  translator: 'google',
  deeplApiKey: '',
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  llmProvider: 'groq',
  llmBaseUrl: '',
  llmModel: 'qwen/qwen3.8-27b',
  llmApiKey: '',
  translatePrompt: '',
  allowAudioUpload: false,
  allowTextUpload: false,
  nameDisplay: 'original'
}

export function loadSettings(db: Db): Settings {
  const rows = db.prepare('SELECT key, value_json FROM settings').all() as { key: string; value_json: string }[]
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const r of rows) {
    if (!(r.key in DEFAULT_SETTINGS)) continue
    try {
      out[r.key] = JSON.parse(r.value_json)
    } catch {
      /* corrupt row → keep the default */
    }
  }
  return out as unknown as Settings
}

export function saveSettings(db: Db, patch: Partial<Settings>): Settings {
  const put = db.prepare(
    'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json'
  )
  db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (k in DEFAULT_SETTINGS && v !== undefined) put.run(k, JSON.stringify(v))
    }
  })()
  return loadSettings(db)
}
