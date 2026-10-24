import { StrictMode, Suspense, lazy } from 'react'
import type { JSX, LazyExoticComponent } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Herramientas de desarrollo: solo en `npm run dev`, fuera del bundle de producción
const DEV_ROUTES: Record<string, LazyExoticComponent<() => JSX.Element>> = import.meta.env.DEV
  ? {
      '/dev/record-reference': lazy(() =>
        import('@/ui/screens/dev/RecordReferenceScreen').then(m => ({
          default: m.RecordReferenceScreen,
        })),
      ),
    }
  : {}

const DevScreen = DEV_ROUTES[window.location.pathname]

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {DevScreen ? (
      <Suspense fallback={null}>
        <DevScreen />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
