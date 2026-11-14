import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// Noto Sans bundled (OFL-1.1): Korean first, Japanese for the kanji it lacks
import '@fontsource-variable/noto-sans-kr'
import '@fontsource-variable/noto-sans-jp'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
