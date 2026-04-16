import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import LoadingScreen from './components/LoadingScreen.jsx'
import LanguageToggle from './components/LanguageToggle.jsx'

const LandingPage = lazy(() => import('./components/LandingPage.jsx'))
const DashboardLayout = lazy(() => import('./layouts/DashboardLayout.jsx'))

const ReentryMapModule = lazy(() => import('./components/modules/ReentryMapModule/ReentryMapModule.jsx'))
const OrbitMonitor3D = lazy(() => import('./components/modules/OrbitMonitor3D/OrbitMonitor3D.jsx'))
const OrbitalRegimesGuide = lazy(() => import('./components/modules/OrbitMonitor3D/OrbitalRegimesGuide.jsx'))
const ObjectSearchModule = lazy(() => import('./components/modules/ObjectSearch/ObjectSearchModule.jsx'))

function AppRoutes() {
  const location = useLocation()

  return (
    <>
      <Suspense fallback={<LoadingScreen />}>
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<LandingPage />} />

            <Route path="/dashboard" element={<DashboardLayout />}>
              <Route index element={<Navigate to="orbit" replace />} />
              <Route path="search" element={<ObjectSearchModule />} />
              <Route path="map" element={<ReentryMapModule />} />
              <Route path="orbit" element={<OrbitMonitor3D />} />
              <Route path="orbit/guide" element={<OrbitalRegimesGuide />} />
            </Route>

            {/* Back-compat redirects */}
            <Route path="/analytics" element={<Navigate to="/dashboard/orbit" replace />} />
            <Route path="/search" element={<Navigate to="/dashboard/search" replace />} />
            <Route path="/reentry-map" element={<Navigate to="/dashboard/map" replace />} />
            <Route path="/orbit-monitor" element={<Navigate to="/dashboard/orbit" replace />} />
            <Route path="/risk" element={<Navigate to="/dashboard/orbit" replace />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AnimatePresence>
      </Suspense>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter
      basename={import.meta.env.BASE_URL}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AppRoutes />
    </BrowserRouter>
  )
}
