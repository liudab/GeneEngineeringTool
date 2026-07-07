import { useState, useEffect, Component, type ReactNode } from 'react'
import { FlaskConical, Dna, FileText, Beaker, FolderOpen, ChevronLeft, Pipette, Waves } from 'lucide-react'
import EnzymePage from './pages/EnzymePage'
import VectorPage from './pages/VectorPage'
import GenePage from './pages/GenePage'
import LabVectorPage from './pages/LabVectorPage'
import FileViewerPage from './pages/FileViewerPage'
import VectorEditorPage from './pages/VectorEditorPage'
import PrimerPage from './pages/PrimerPage'
import SequencingFilePage from './pages/SequencingFilePage'
import { useI18n } from './hooks/useI18n'

type Page = 'enzymes' | 'vectors' | 'genes' | 'lab-vectors' | 'file-viewer' | 'primers' | 'sequencing'

/** 错误边界：捕获子组件渲染错误，显示错误信息而非白屏 */
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  state = { hasError: false, error: '' }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: `${error.message}\n${error.stack}` }
  }
  componentDidCatch(error: Error, info: any) {
    console.error('[ErrorBoundary] Render error:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, color: 'red', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          <h2>渲染错误</h2>
          <p>{this.state.error}</p>
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * 检测URL查询参数，判断是否为编辑器模式
 * 编辑器窗口通过 ?vectorId=X&mode=editor 打开
 */
function getEditorMode(): { isEditor: boolean; vectorId?: number; isGeneEditor: boolean; geneId?: number } {
  try {
    const params = new URLSearchParams(window.location.search)
    const mode = params.get('mode')
    const vectorId = params.get('vectorId')
    const geneId = params.get('geneId')
    console.log('[App] getEditorMode:', { mode, vectorId, geneId, search: window.location.search })
    if (mode === 'editor' && vectorId) {
      return { isEditor: true, vectorId: Number(vectorId), isGeneEditor: false }
    }
    if (mode === 'gene-editor' && geneId) {
      return { isEditor: false, isGeneEditor: true, geneId: Number(geneId) }
    }
  } catch (e) { console.error('[App] getEditorMode error:', e) }
  return { isEditor: false, isGeneEditor: false }
}

export default function App() {
  const { t, changeLanguage } = useI18n()
  const [currentPage, setCurrentPage] = useState<Page>('enzymes')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // 监听菜单语言切换动作
  useEffect(() => {
    const unsub = window.api.onMenuAction((action: string) => {
      if (action === 'set-language-zh') changeLanguage('zh')
      else if (action === 'set-language-en') changeLanguage('en')
      else if (action === 'open-file') {
        setCurrentPage('file-viewer')
      } else if (action === 'view-circular') {
        ;(window as any).__setViewMode?.('circular')
      } else if (action === 'view-linear') {
        ;(window as any).__setViewMode?.('linear')
      }
    })
    return () => { unsub() }
  }, [changeLanguage])

  // 检查是否为编辑器模式（新窗口打开的质粒图谱编辑器）
  const editorMode = getEditorMode()
  console.log('[App] Render, editorMode:', editorMode)
  if (editorMode.isEditor) {
    return (
      <ErrorBoundary>
        <VectorEditorPage vectorId={editorMode.vectorId!} />
      </ErrorBoundary>
    )
  }

  if (editorMode.isGeneEditor) {
    return (
      <ErrorBoundary>
        <VectorEditorPage geneId={editorMode.geneId!} mode="gene" />
      </ErrorBoundary>
    )
  }


  const navItems: { id: Page; label: string; icon: React.ReactNode; color: string }[] = [
    { id: 'enzymes', label: t('nav.enzymes'), icon: <FlaskConical size={20} />, color: 'text-amber-500' },
    { id: 'vectors', label: t('nav.vectors'), icon: <Dna size={20} />, color: 'text-violet-500' },
    { id: 'genes', label: t('nav.genes'), icon: <FileText size={20} />, color: 'text-pink-500' },
    { id: 'lab-vectors', label: t('nav.labVectors'), icon: <Beaker size={20} />, color: 'text-blue-500' },
    { id: 'primers', label: t('nav.primers'), icon: <Pipette size={20} />, color: 'text-cyan-500' },
    { id: 'sequencing', label: t('nav.sequencing'), icon: <Waves size={20} />, color: 'text-teal-500' },
    { id: 'file-viewer', label: t('nav.fileViewer'), icon: <FolderOpen size={20} />, color: 'text-green-500' }
  ]

  const renderPage = () => {
    switch (currentPage) {
      case 'enzymes': return <EnzymePage />
      case 'vectors': return <VectorPage />
      case 'genes': return <GenePage />
      case 'lab-vectors': return <LabVectorPage />
      case 'file-viewer': return <FileViewerPage />
      case 'primers': return <PrimerPage />
      case 'sequencing': return <SequencingFilePage />
      default: return <EnzymePage />
    }
  }

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <aside
        className={`${sidebarCollapsed ? 'w-16' : 'w-56'} bg-slate-900 text-white flex flex-col transition-all duration-200 flex-shrink-0`}
      >
        {/* Header */}
        <div className="h-14 flex items-center px-4 border-b border-slate-700">
          {!sidebarCollapsed && (
            <h1 className="text-sm font-bold truncate">{t('app.title')}</h1>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className={`p-1 hover:bg-slate-700 rounded ${sidebarCollapsed ? 'mx-auto' : 'ml-auto'}`}
          >
            <ChevronLeft size={16} className={`transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentPage(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
                ${currentPage === item.id
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }
                ${sidebarCollapsed ? 'justify-center' : ''}`}
            >
              <span className={currentPage === item.id ? item.color : ''}>{item.icon}</span>
              {!sidebarCollapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-slate-700">
          <button
            onClick={async () => {
              const result = await window.api.openFile()
              if (result) {
                setCurrentPage('file-viewer')
              }
            }}
            className={`w-full flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-500 rounded text-sm transition-colors ${sidebarCollapsed ? 'justify-center' : ''}`}
          >
            <FolderOpen size={16} />
            {!sidebarCollapsed && <span>{t('nav.openFile')}</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Top bar */}
        <header className="h-14 bg-white border-b border-slate-200 flex items-center px-6 flex-shrink-0">
          <h2 className="text-lg font-semibold text-slate-800">
            {navItems.find(n => n.id === currentPage)?.label || ''}
          </h2>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-auto p-6">
          {renderPage()}
        </div>
      </main>
    </div>
  )
}
