# CIEE Space Watch Suite

Dashboard web para visualización de desechos espaciales:
- Mapa 2D (Leaflet)
- Globo 3D (Three / react-globe.gl)
- Analíticas (Recharts)

## Requisitos
- Node.js 18+ (recomendado 20+)
- npm

## Desarrollo
```bash
npm install
npm run dev
```
Luego abrir `http://localhost:5173`.

## Build
```bash
npm run build
npm run preview
```

## Datos
Los CSV/JSON que consume la app están en:
- `public/data/`

## Nota sobre Windows (esbuild / políticas)
En algunos entornos Windows, Vite puede fallar si el sistema bloquea la ejecución de binarios (por ejemplo `esbuild.exe`).

Workaround: si ya existe `dist/`, podés servirlo como sitio estático con:
```bash
node scripts/serve-dist.mjs
```
Y abrir `http://127.0.0.1:5173`.

## Publicar a GitHub (sin `git.exe`)
En algunos equipos `git.exe` puede quedar bloqueado por políticas (Windows App Control). Este repo incluye un script que publica usando una implementación JS de git.

1) Creá un repo vacío en GitHub (sin README ni .gitignore).
2) En PowerShell, seteá variables de entorno (no pegues el token en el chat):
```powershell
$env:GITHUB_REPO_URL = "https://github.com/<usuario>/<repo>.git"
$env:GITHUB_TOKEN = "<PAT con permiso repo>"
```
3) Ejecutá:
```bash
node scripts/publish-github.mjs
```

## GitHub Pages

Este repo está configurado para desplegar automáticamente en GitHub Pages a través de GitHub Actions.

- Workflow: `.github/workflows/deploy-pages.yml`
- URL esperada: `https://franco-agatiello.github.io/ciee-debris-monitor/`

Notas:
- La construcción establece `base` de Vite automáticamente cuando `GITHUB_PAGES=true`.
- React Router utiliza `import.meta.env.BASE_URL` como `basename`, por lo que el enrutamiento funciona bajo la subruta de Pages.

> Por defecto `dist/` está ignorado por git (ver `.gitignore`). Si querés publicar en GitHub Pages, lo ideal es usar un workflow que haga build y despliegue.
