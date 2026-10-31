import { StrictMode, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './ui-executive/preview.css'

// El panel ejecutivo sólo se necesita después de elegir usuario, año y mes:
// va en su propio chunk para que el arranque no lo descargue.
// oxlint-disable-next-line react/only-export-components -- punto de entrada: no hay Fast Refresh que preservar
const ExecutiveDashboard = lazy(() => import('./ui-executive/ExecutiveDashboard'))

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App uiMode="executive" periodOverviewComponent={ExecutiveDashboard} />
  </StrictMode>,
)
