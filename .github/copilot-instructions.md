# Copilot Workspace Instructions

## Resumen del Proyecto

Dashboard web para visualización y análisis de desechos espaciales. Incluye:
- Mapa 2D (Leaflet)
- Globo 3D (Three.js / react-globe.gl)
- Analíticas (Recharts)
- Internacionalización (es/en)

## Comandos principales
- **Instalar dependencias:**
  - `npm install`
- **Desarrollo:**
  - `npm run dev` (o `dev.cmd` / `dev.ps1` en Windows con NVM)
- **Build producción:**
  - `npm run build`
- **Preview build:**
  - `npm run preview`
- **Precomputar analíticas:**
  - `npm run precompute:analytics`
- **Publicar en GitHub (sin git.exe):**
  - Setear variables de entorno `GITHUB_REPO_URL` y `GITHUB_TOKEN` en PowerShell
  - Ejecutar `npm run publish:github`

## Estructura y convenciones
- **Componentes React** en PascalCase, hooks en camelCase.
- **Módulos funcionales** en `src/components/modules/`.
- **Utilidades** en `src/utils/`.
- **Datos** en `public/data/` (CSV/JSON).
- **Internacionalización** vía `src/i18n/I18nProvider.jsx`.
- **Estilos** con TailwindCSS y PostCSS.
- **Carga diferida** con React.lazy y Suspense.

## Notas y recomendaciones
- Node.js 18+ (ideal 20+).
- En Windows, usar scripts `dev.cmd` o `dev.ps1` si Node/NPM no están en PATH.
- Variables de entorno `.env` pueden ser requeridas para builds/deploys.
- Si Vite falla por políticas de binarios en Windows, servir `dist/` con `node scripts/serve-dist.mjs`.
- Para GitHub Pages, el workflow `.github/workflows/deploy-pages.yml` hace build y deploy automático.

## Ejemplo de prompts útiles
- "¿Cómo agrego un nuevo módulo funcional?"
- "¿Cómo integro una nueva fuente de datos CSV?"
- "¿Cómo cambio el idioma por defecto?"
- "¿Cómo publico en GitHub Pages?"

---

> Si el workspace crece, sugerir instrucciones específicas por área usando `applyTo` (ej: solo para `src/components/modules/`).
