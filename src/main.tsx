import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
// Self-hosted variable fonts — this is an offline PWA; nothing loads from
// Google Fonts. Fraunces needs the `full` variant for its SOFT/WONK axes.
import '@fontsource-variable/fraunces/full.css'
import '@fontsource-variable/schibsted-grotesk/index.css'
import '@fontsource-variable/martian-mono/index.css'
// Prism (vendored, src/prism/) before the app layer so app rules win.
import './prism/tokens.css'
import './prism/glass.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Offline at the easel: cache the app shell (spec §7). Dev servers skip this.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  })
}
