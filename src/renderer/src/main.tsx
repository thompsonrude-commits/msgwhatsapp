import './index.css'

import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './App'

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
