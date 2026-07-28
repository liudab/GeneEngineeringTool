import { useState, useEffect, useMemo, Component, type ReactNode } from 'react'
import { FlaskConical, Dna, FileText, Beaker, FolderOpen, ChevronLeft, Pipette, Waves, Keyboard, Menu, X, Database, Download, Upload, Settings as SettingsIcon, Wrench, Info } from 'lucide-react'
import EnzymePage from './pages/EnzymePage'
import VectorPage from './pages/VectorPage'
import GenePage from './pages/GenePage'
import LabVectorPage from './pages/LabVectorPage'
import FileViewerPage from './pages/FileViewerPage'
import VectorEditorPage from './pages/VectorEditorPage'
import PrimerPage from './pages/PrimerPage'
import SequencingFilePage from './pages/SequencingFilePage'
import ComponentDatabasePanel from './components/ComponentDatabasePanel'
import SpeciesPluginManager from './components/SpeciesPluginManager'
import DebugPanel from './components/DebugPanel/DebugPanel'
import PerfMonitor from './components/PerfMonitor'
import { useI18n } from './hooks/useI18n'
import { ToastProvider, useToast } from './components/ui/Toast'
import { ContextMenuProvider } from './components/ui/ContextMenu'
import TaskProgress from './components/ui/TaskProgress'
import { useTaskListStore, useTaskErrorStore } from './stores/taskStore'
import { useHotkeys, formatHotkey } from './hooks/useHotkeys'
import { useBreakpoint } from './hooks/useMediaQuery'
import { createLogger } from './utils/logger'
import { useDebugStore } from './stores/debugStore'
import { prefetchAppData, prefetchPageData } from './utils/prefetch'
import { useGpuAcceleration } from './utils/gpuSettings'

type Page = 'enzymes' | 'vectors' | 'genes' | 'lab-vectors' | 'file-viewer' | 'primers' | 'sequencing' | 'settings'

const appLog = createLogger('App')

/** 错误边界：捕获子组件渲染错误，显示错误信息而非白屏 */
class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode; name?: string }, { hasError: boolean; error: string }> {
  state = { hasError: false, error: '' }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: `${error.message}\n${error.stack}` }
  }
  componentDidCatch(error: Error, info: any) {
    const name = this.props.name || 'Unknown'
    appLog.error(`ErrorBoundary [${name}]: ${error.message}`, error)
    // 记录到全局错误日志
    try {
      const store = useTaskErrorStore.getState()
      store.addErrorLog({ module: `ErrorBoundary:${name}`, message: error.message, detail: error.stack, stack: error.stack })
    } catch { /* store not available */ }
  }
  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="p-6 bg-red-50 border border-red-200 rounded-lg">
          <h2 className="text-red-700 font-bold mb-2">渲染错误</h2>
          <pre className="text-xs text-red-600 whitespace-pre-wrap break-words">{this.state.error}</pre>
          <button
            onClick={() => this.setState({ hasError: false, error: '' })}
            className="mt-3 px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-500"
          >
            重试
          </button>
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
function getEditorMode(): { isEditor: boolean; vectorId?: number; isGeneEditor: boolean; geneId?: number; transcriptId?: number; seqType?: 'mrna' | 'protein'; relatedSeqId?: number; isProteinEditor?: boolean; proteinKey?: string } {
  try {
    const params = new URLSearchParams(window.location.search)
    const mode = params.get('mode')
    const vectorId = params.get('vectorId')
    const geneId = params.get('geneId')
    const transcriptId = params.get('transcriptId')
    const seqType = params.get('seqType') as 'mrna' | 'protein' | null
    const relatedSeqId = params.get('relatedSeqId')
    const proteinKey = params.get('proteinKey')
    console.log('[App] getEditorMode:', { mode, vectorId, geneId, transcriptId, seqType, relatedSeqId, proteinKey, search: window.location.search })
    appLog.debug(`getEditorMode: mode=${mode}, vectorId=${vectorId}, geneId=${geneId}, transcriptId=${transcriptId}, seqType=${seqType}, relatedSeqId=${relatedSeqId}, proteinKey=${proteinKey}`)
    if (mode === 'editor' && vectorId) {
      return { isEditor: true, vectorId: Number(vectorId), isGeneEditor: false }
    }
    if (mode === 'protein-editor' && proteinKey) {
      return { isEditor: false, isGeneEditor: false, isProteinEditor: true, proteinKey, seqType: 'protein' }
    }
    if (mode === 'gene-editor' && geneId) {
      return {
        isEditor: false, isGeneEditor: true, geneId: Number(geneId),
        transcriptId: transcriptId ? Number(transcriptId) : undefined,
        seqType: seqType || undefined,
        relatedSeqId: relatedSeqId ? Number(relatedSeqId) : undefined
      }
    }
  } catch (e) { console.error('[App] getEditorMode error:', e) }
  return { isEditor: false, isGeneEditor: false }
}

export default function App() {
  const { t, changeLanguage } = useI18n()
  const [currentPage, setCurrentPage] = useState<Page>('enzymes')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showShortcutPanel, setShowShortcutPanel] = useState(false)
  const [showAboutDialog, setShowAboutDialog] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { isMobile, isTablet } = useBreakpoint()
  const tasks = useTaskListStore((s) => s.tasks)
  const removeTask = useTaskListStore((s) => s.removeTask)
  const toggleDebugPanel = useDebugStore((s) => s.togglePanel)
  const [showPerfMonitor, setShowPerfMonitor] = useState(false)
  const [gpuEnabled, setGpuEnabled] = useGpuAcceleration()

  // 应用启动时后台预加载高频数据
  useEffect(() => { prefetchAppData() }, [])

  const [showBackupMenu, setShowBackupMenu] = useState(false)

  // 元件数据库调试模式 & 自动规范化检测 (localStorage 持久化)
  const [debugMode, setDebugMode] = useState<boolean>(() => {
    try { return localStorage.getItem('componentDbDebugMode') === 'true' } catch { return false }
  })
  const [autoNormalize, setAutoNormalize] = useState<boolean>(() => {
    try { return localStorage.getItem('autoNormalizeEnabled') !== 'false' } catch { return true }
  })
  useEffect(() => { try { localStorage.setItem('componentDbDebugMode', String(debugMode)) } catch {} }, [debugMode])
  useEffect(() => { try { localStorage.setItem('autoNormalizeEnabled', String(autoNormalize)) } catch {} }, [autoNormalize])

  // ESC 关闭关于对话框
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showAboutDialog) setShowAboutDialog(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [showAboutDialog])

  // 响应式：平板自动折叠侧栏，移动端隐藏侧栏
  useEffect(() => {
    if (isTablet) setSidebarCollapsed(true)
    if (isMobile) setMobileMenuOpen(false)
  }, [isTablet, isMobile])

  // 页面切换时预加载下一页可能需要的数据
  useEffect(() => { prefetchPageData(currentPage) }, [currentPage])

  // 全局未捕获 Promise 错误监听
  useEffect(() => {
    const handleRejection = (event: PromiseRejectionEvent) => {
      const error = event.reason
      const message = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      appLog.error('Unhandled promise rejection', error)
      try {
        useTaskErrorStore.getState().addErrorLog({
          module: 'Global',
          message,
          detail: stack,
          stack,
        })
      } catch { /* store not available */ }
    }
    window.addEventListener('unhandledrejection', handleRejection)
    return () => window.removeEventListener('unhandledrejection', handleRejection)
  }, [])

  // 全局快捷键
  const { registeredKeys } = useHotkeys([
    { key: 'k', ctrl: true, label: '切换侧栏', action: () => setSidebarCollapsed((v) => !v), global: true },
    { key: '/', ctrl: true, label: '快捷键帮助', action: () => setShowShortcutPanel((v) => !v), global: true },
    { key: 'd', ctrl: true, shift: true, label: '诊断面板', action: () => toggleDebugPanel(), global: true },
    { key: 'f', ctrl: true, shift: true, label: '性能监视器', action: () => setShowPerfMonitor(v => !v), global: true },
    { key: '1', ctrl: true, label: '酶库', action: () => setCurrentPage('enzymes'), global: true },
    { key: '2', ctrl: true, label: '载体', action: () => setCurrentPage('vectors'), global: true },
    { key: '3', ctrl: true, label: '基因', action: () => setCurrentPage('genes'), global: true },
    { key: '4', ctrl: true, label: '实验室载体', action: () => setCurrentPage('lab-vectors'), global: true },
    { key: '5', ctrl: true, label: '引物', action: () => setCurrentPage('primers'), global: true },
    { key: '6', ctrl: true, label: '测序', action: () => setCurrentPage('sequencing'), global: true },
    { key: '7', ctrl: true, label: '文件查看器', action: () => setCurrentPage('file-viewer'), global: true },
  ])

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
      } else if (action === 'toggle-debug-panel') {
        toggleDebugPanel()
      }
    })
    return () => { unsub() }
  }, [changeLanguage])

  // 检查是否为编辑器模式（新窗口打开的质粒图谱编辑器）
  const editorMode = useMemo(() => getEditorMode(), [])
  appLog.debug(`Render, editorMode: ${JSON.stringify(editorMode)}`)
  // 编辑器窗口不需要全局 Providers
  if (editorMode.isEditor) {
    return (
      <ErrorBoundary>
        <ContextMenuProvider>
          <VectorEditorPage vectorId={editorMode.vectorId!} />
        </ContextMenuProvider>
      </ErrorBoundary>
    )
  }

  if (editorMode.isGeneEditor) {
    return (
      <ErrorBoundary>
        <ContextMenuProvider>
          <VectorEditorPage geneId={editorMode.geneId!} transcriptId={editorMode.transcriptId} seqType={editorMode.seqType} relatedSeqId={editorMode.relatedSeqId} />
        </ContextMenuProvider>
      </ErrorBoundary>
    )
  }

  if (editorMode.isProteinEditor) {
    return (
      <ErrorBoundary>
        <ContextMenuProvider>
          <VectorEditorPage seqType="protein" proteinKey={editorMode.proteinKey} />
        </ContextMenuProvider>
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
      case 'enzymes': return <ErrorBoundary name="EnzymePage"><EnzymePage /></ErrorBoundary>
      case 'vectors': return <ErrorBoundary name="VectorPage"><VectorPage /></ErrorBoundary>
      case 'genes': return <ErrorBoundary name="GenePage"><GenePage /></ErrorBoundary>
      case 'lab-vectors': return <ErrorBoundary name="LabVectorPage"><LabVectorPage /></ErrorBoundary>
      case 'file-viewer': return <ErrorBoundary name="FileViewerPage"><FileViewerPage /></ErrorBoundary>
      case 'primers': return <ErrorBoundary name="PrimerPage"><PrimerPage /></ErrorBoundary>
      case 'sequencing': return <ErrorBoundary name="SequencingFilePage"><SequencingFilePage /></ErrorBoundary>
      case 'settings': return (
        <div className="w-full max-w-7xl mx-auto px-4 lg:px-6 space-y-6">
          <div className="flex items-center gap-2 mb-4">
            <SettingsIcon size={20} className="text-slate-600" />
            <h2 className="text-lg font-bold text-slate-800">设置</h2>
          </div>

          {/* 功能开关 */}
          <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
            <h3 className="text-sm font-bold text-slate-700">功能开关</h3>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={autoNormalize}
                onChange={e => setAutoNormalize(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
              <div>
                <span className="text-xs text-slate-700">自动规范化检测</span>
                <p className="text-[10px] text-slate-400">导入载体后自动扫描元件并提示名称规范化</p>
              </div>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={debugMode}
                onChange={e => setDebugMode(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500" />
              <div>
                <span className="text-xs text-slate-700">元件数据库调试模式</span>
                <p className="text-[10px] text-slate-400">启用后显示调试工具，方便快速完善元件数据库</p>
              </div>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={gpuEnabled}
                onChange={e => setGpuEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500" />
              <div>
                <span className="text-xs text-slate-700">GPU 加速渲染</span>
                <p className="text-[10px] text-slate-400">图谱视图使用 GPU 合成层加速缩放/平移，关闭可兼容低端设备</p>
              </div>
            </label>
          </div>

          {/* 载体元件数据库管理（隐藏入口） */}
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <ComponentDatabasePanel />
          </div>

          {/* 物种基因数据库插件管理 */}
          <SpeciesPluginManager />
        </div>
      )
      default: return <ErrorBoundary name="EnzymePage"><EnzymePage /></ErrorBoundary>
    }
  }

  return (
    <ToastProvider>
      <ContextMenuProvider>
        <TaskProgress tasks={tasks} onCancel={removeTask} />
        <DebugPanel />
        <PerfMonitor visible={showPerfMonitor} onClose={() => setShowPerfMonitor(false)} />
        <div className="flex h-screen bg-slate-50">
          {/* Sidebar — 移动端隐藏，平板折叠，桌面正常 */}
          {!isMobile && (
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
              <div className="p-3 border-t border-slate-700 space-y-2">
                <button
                  onClick={async () => {
                    try {
                      const result = await window.api.openFile()
                      if (result) {
                        setCurrentPage('file-viewer')
                      }
                    } catch (e) { console.error(e) }
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-500 rounded text-sm transition-colors ${sidebarCollapsed ? 'justify-center' : ''}`}
                >
                  <FolderOpen size={16} />
                  {!sidebarCollapsed && <span>{t('nav.openFile')}</span>}
                </button>
                {/* 数据库备份/恢复 */}
                {!sidebarCollapsed && (
                  <div className="relative">
                    <button
                      onClick={() => setShowBackupMenu(!showBackupMenu)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded text-xs transition-colors"
                    >
                      <Database size={14} />
                      <span>数据库管理</span>
                      <ChevronLeft size={12} className={`ml-auto transition-transform ${showBackupMenu ? 'rotate-90' : ''}`} />
                    </button>
                    {showBackupMenu && (
                      <div className="absolute bottom-full left-0 mb-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 w-full z-[100]">
                        <button
                          onClick={async () => {
                            setShowBackupMenu(false)
                            try {
                              const result = await window.api.backupDatabase()
                              if (result?.success) alert(result.message)
                            } catch (e) { console.error(e) }
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700"
                        >
                          <Download size={14} /> 备份数据库
                        </button>
                        <button
                          onClick={async () => {
                            setShowBackupMenu(false)
                            if (!confirm('恢复数据库将替换当前所有数据，确定继续？')) return
                            try {
                              const result = await window.api.restoreDatabase()
                              if (result?.success) {
                                alert(result.message)
                                window.location.reload()
                              } else if (result?.message) {
                                alert(result.message)
                              }
                            } catch (e) { console.error(e) }
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-orange-300 hover:bg-slate-700"
                        >
                          <Upload size={14} /> 恢复数据库
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {/* 设置（隐藏入口 — 齿轮图标） */}
                <button
                  onClick={() => setCurrentPage('settings')}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded text-xs transition-colors
                    ${currentPage === 'settings' ? 'text-slate-200 bg-slate-800' : ''}
                    ${sidebarCollapsed ? 'justify-center' : ''}`}
                  title="设置"
                >
                  <SettingsIcon size={14} />
                  {!sidebarCollapsed && <span>设置</span>}
                </button>
                {/* 关于 HelixCraft */}
                <button
                  onClick={() => setShowAboutDialog(true)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded text-xs transition-colors
                    ${sidebarCollapsed ? 'justify-center' : ''}`}
                  title="关于 HelixCraft"
                >
                  <Info size={14} />
                  {!sidebarCollapsed && <span>关于</span>}
                </button>
              </div>
            </aside>
          )}

          {/* Main content */}
          <main className="flex-1 overflow-hidden flex flex-col">
            {/* Top bar */}
            <header className="h-14 bg-white border-b border-slate-200 flex items-center px-4 md:px-6 flex-shrink-0">
              {/* 移动端汉堡菜单 */}
              {isMobile && (
                <button
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  className="p-1.5 text-slate-600 hover:bg-slate-100 rounded mr-2"
                >
                  {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
                </button>
              )}
              <h2 className="text-base md:text-lg font-semibold text-slate-800 flex-1 truncate">
                {navItems.find(n => n.id === currentPage)?.label || (currentPage === 'settings' ? '设置' : '')}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowShortcutPanel((v) => !v)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors hidden md:block"
                  title="快捷键帮助 (Ctrl+/)"
                >
                  <Keyboard size={16} />
                </button>
              </div>
            </header>

            {/* 移动端抽屉菜单 */}
            {isMobile && mobileMenuOpen && (
              <div className="fixed inset-0 z-[99996] flex">
                <div className="absolute inset-0 bg-black/40" onClick={() => setMobileMenuOpen(false)} />
                <div className="relative w-64 bg-slate-900 text-white flex flex-col shadow-xl animate-[toast-in_150ms_ease-out]">
                  <div className="h-14 flex items-center px-4 border-b border-slate-700">
                    <h1 className="text-sm font-bold truncate">{t('app.title')}</h1>
                    <button onClick={() => setMobileMenuOpen(false)} className="ml-auto p-1 hover:bg-slate-700 rounded">
                      <X size={16} />
                    </button>
                  </div>
                  <nav className="flex-1 py-2 overflow-y-auto">
                    {navItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => { setCurrentPage(item.id); setMobileMenuOpen(false) }}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors
                          ${currentPage === item.id ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                      >
                        <span className={currentPage === item.id ? item.color : ''}>{item.icon}</span>
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </nav>
                  <div className="p-3 border-t border-slate-700">
                    <button
                      onClick={async () => {
                        try {
                          const result = await window.api.openFile()
                          if (result) { setCurrentPage('file-viewer'); setMobileMenuOpen(false) }
                        } catch (e) { console.error(e) }
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-500 rounded text-sm transition-colors"
                    >
                      <FolderOpen size={16} />
                      <span>{t('nav.openFile')}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Page content */}
            <div className="flex-1 overflow-auto p-3 md:p-6">
              {renderPage()}
            </div>

            {/* 移动端底部导航栏 */}
            {isMobile && (
              <nav className="bg-white border-t border-slate-200 flex flex-shrink-0">
                {navItems.slice(0, 5).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setCurrentPage(item.id)}
                    className={`flex-1 flex flex-col items-center py-1.5 text-[10px] transition-colors
                      ${currentPage === item.id ? 'text-blue-600' : 'text-slate-400'}`}
                  >
                    <span className={currentPage === item.id ? item.color : ''}>{item.icon}</span>
                    <span className="mt-0.5 truncate max-w-[48px]">{item.label}</span>
                  </button>
                ))}
                {/* 更多按钮 */}
                <button
                  onClick={() => setMobileMenuOpen(true)}
                  className="flex-1 flex flex-col items-center py-1.5 text-[10px] text-slate-400"
                >
                  <Menu size={20} />
                  <span className="mt-0.5">更多</span>
                </button>
              </nav>
            )}
          </main>
        </div>

        {/* 关于 HelixCraft 对话框 */}
        {showAboutDialog && (
          <div className="fixed inset-0 z-[99997] flex items-center justify-center bg-black/30" onClick={() => setShowAboutDialog(false)}>
            <div className="bg-white rounded-xl shadow-2xl w-[440px] overflow-hidden" onClick={(e) => e.stopPropagation()}>
              {/* 头部 Banner */}
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 px-6 py-6 text-white">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
                      <Dna size={20} className="text-emerald-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold tracking-wide">{t('about.softwareName')}</h3>
                      <p className="text-[11px] text-slate-400">Genetic Engineering Assistant</p>
                    </div>
                  </div>
                  <button onClick={() => setShowAboutDialog(false)} className="text-slate-400 hover:text-white transition-colors text-lg leading-none p-1">&times;</button>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="px-2 py-0.5 text-[10px] font-medium bg-emerald-500/20 text-emerald-300 rounded-full border border-emerald-500/30">Beta</span>
                  <span className="text-xs text-slate-400">{t('about.version')}</span>
                </div>
              </div>

              {/* 内容区 */}
              <div className="px-6 py-4 space-y-3">
                {/* 作者信息 */}
                <div className="bg-slate-50 rounded-lg border border-slate-100 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 w-16 flex-shrink-0">作者</span>
                    <span className="text-xs text-slate-700 font-medium">{t('about.author')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 w-16 flex-shrink-0">邮箱</span>
                    <a href={`mailto:${t('about.email')}`} className="text-xs text-blue-600 hover:underline">{t('about.email')}</a>
                  </div>
                </div>

                {/* 使用协议 */}
                <div className="bg-amber-50 rounded-lg border border-amber-200 p-3 space-y-1.5">
                  <div className="text-[11px] font-semibold text-amber-700 mb-1">使用协议与免责声明</div>
                  <div className="flex gap-1.5 text-[11px] text-amber-800 leading-relaxed">
                    <span className="text-amber-500 flex-shrink-0">•</span>
                    <span>{t('about.copyright')}</span>
                  </div>
                  <div className="flex gap-1.5 text-[11px] text-amber-800 leading-relaxed">
                    <span className="text-amber-500 flex-shrink-0">•</span>
                    <span>{t('about.license')}</span>
                  </div>
                  <div className="flex gap-1.5 text-[11px] text-amber-800 leading-relaxed">
                    <span className="text-amber-500 flex-shrink-0">•</span>
                    <span>{t('about.internalNote')}</span>
                  </div>
                  <div className="flex gap-1.5 text-[11px] text-amber-800 leading-relaxed">
                    <span className="text-amber-500 flex-shrink-0">•</span>
                    <span>{t('about.businessContact')}：<a href={`mailto:${t('about.email')}`} className="text-blue-600 hover:underline">{t('about.email')}</a></span>
                  </div>
                </div>
              </div>

              {/* 底部 */}
              <div className="px-6 py-3 border-t border-slate-100 flex justify-end">
                <button
                  onClick={() => setShowAboutDialog(false)}
                  className="px-4 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 快捷键帮助面板 */}
        {showShortcutPanel && (
          <div className="fixed inset-0 z-[99997] flex items-center justify-center bg-black/30" onClick={() => setShowShortcutPanel(false)}>
            <div className="bg-white rounded-xl shadow-2xl p-6 w-[400px] max-h-[70vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-slate-800">键盘快捷键</h3>
                <button onClick={() => setShowShortcutPanel(false)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
              </div>
              <div className="space-y-1">
                {registeredKeys.map((hk, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                    <span className="text-sm text-slate-600">{hk.label}</span>
                    <kbd className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-xs font-mono">{formatHotkey(hk)}</kbd>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </ContextMenuProvider>
    </ToastProvider>
  )
}
