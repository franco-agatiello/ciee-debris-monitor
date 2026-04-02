import React from 'react'
import { useI18n } from '../i18n/I18nProvider.jsx'

function ErrorBoundaryView(props) {
  const { tr } = useI18n()
  return <ErrorBoundaryInner {...props} tr={tr} />
}

class ErrorBoundaryInner extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    try {
      // Helpful during dev: keep details in console
      // eslint-disable-next-line no-console
      console.error('UI crashed:', error, info)
    } catch {
      // ignore
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const title = this.props.title || this.props.tr('Algo salió mal', 'Something went wrong')
    const hint = this.props.hint || this.props.tr('Revisa la terminal del servidor dev y la consola del navegador para más detalle.', 'Check the dev server terminal and browser console for details.')

    return (
      <div className="p-5">
        <div className="glass rounded-2xl p-4">
          <div className="text-sm font-bold">{title}</div>
          <div className="text-xs text-white/60 mt-2">{hint}</div>
          <pre className="mono text-xs text-red-200 mt-3 whitespace-pre-wrap break-words">
            {String(this.state.error?.stack || this.state.error?.message || this.state.error || 'Unknown error')}
          </pre>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-3 py-2 rounded-xl border text-sm font-bold transition bg-white/10 border-white/20 hover:bg-white/15"
            >
              {this.props.tr('Reintentar', 'Try again')}
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3 py-2 rounded-xl border text-sm font-bold transition bg-white/5 border-white/10 hover:bg-white/10"
            >
              {this.props.tr('Recargar', 'Reload')}
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export default ErrorBoundaryView
