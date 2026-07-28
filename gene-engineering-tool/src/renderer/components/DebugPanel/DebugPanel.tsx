/**
 * 诊断面板 — 运行时调试信息查看器
 * 快捷键 Ctrl+Shift+D 打开/关闭
 */
import { useEffect, useRef, useMemo, useState } from 'react'
import { X, Trash2, Download, FolderOpen, RefreshCw, ChevronDown, ChevronRight, Activity, AlertTriangle, FileText } from 'lucide-react'
import { useDebugStore } from '../../stores/debugStore'
import { LogLevel, LOG_LEVEL_NAMES, type LogEntry } from '../../../shared/logger-types'

const LEVEL_COLORS: Record<number, string> = {
  [LogLevel.DEBUG]: 'text-slate-400',
  [LogLevel.INFO]: 'text-blue-500',
  [LogLevel.WARN]: 'text-amber-500',
  [LogLevel.ERROR]: 'text-red-500',
}

const LEVEL_BG: Record<number, string> = {
  [LogLevel.DEBUG]: 'bg-slate-800',
  [LogLevel.INFO]: 'bg-blue-900/30',
  [LogLevel.WARN]: 'bg-amber-900/30',
  [LogLevel.ERROR]: 'bg-red-900/30',
}

type Tab = 'logs' | 'errors' | 'system'

export default function DebugPanel() {
  const isOpen = useDebugStore((s) => s.isOpen)
  const togglePanel = useDebugStore((s) => s.togglePanel)
  const logs = useDebugStore((s) => s.logs)
  const errors = useDebugStore((s) => s.errors)
  const levelFilter = useDebugStore((s) => s.levelFilter)
  const moduleFilter = useDebugStore((s) => s.moduleFilter)
  const setLevelFilter = useDebugStore((s) => s.setLevelFilter)
  const setModuleFilter = useDebugStore((s) => s.setModuleFilter)
  const clearLogs = useDebugStore((s) => s.clearLogs)
  const exportLogs = useDebugStore((s) => s.exportLogs)
  const openLogFolder = useDebugStore((s) => s.openLogFolder)
  const systemStatus = useDebugStore((s) => s.systemStatus)
  const refreshSystemStatus = useDebugStore((s) => s.refreshSystemStatus)
  const init = useDebugStore((s) => s.init)

  const [tab, setTab] = useState<Tab>('logs')
  const scrollRef = useRef<HTMLDivElement>(null)

  // 初始化监听器
  useEffect(() => { init() }, [])

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current && tab === 'logs') {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, tab])

  // 面板打开时刷新系统状态
  useEffect(() => {
    if (isOpen) refreshSystemStatus()
  }, [isOpen])

  // 过滤后的日志
  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      if (levelFilter !== null && l.level !== levelFilter) return false
      if (moduleFilter && !l.module.includes(moduleFilter)) return false
      return true
    })
  }, [logs, levelFilter, moduleFilter])

  // 所有模块列表
  const modules = useMemo(() => {
    const set = new Set(logs.map((l) => l.module))
    return Array.from(set).sort()
  }, [logs])

  if (!isOpen) return null

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
  }

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    return `${h}h ${m}m ${s}s`
  }

  return (
    <div className="fixed right-0 top-0 bottom-0 w-[480px] bg-slate-900 text-slate-200 shadow-2xl z-[99998] flex flex-col border-l border-slate-700">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700 bg-slate-800">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-emerald-400" />
          <span className="text-sm font-bold">诊断面板</span>
          <span className="text-xs text-slate-500">Ctrl+Shift+D</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => clearLogs()} className="p-1 hover:bg-slate-700 rounded" title="清空日志">
            <Trash2 size={14} />
          </button>
          <button onClick={() => exportLogs()} className="p-1 hover:bg-slate-700 rounded" title="导出日志">
            <Download size={14} />
          </button>
          <button onClick={() => openLogFolder()} className="p-1 hover:bg-slate-700 rounded" title="打开日志目录">
            <FolderOpen size={14} />
          </button>
          <button onClick={() => togglePanel()} className="p-1 hover:bg-slate-700 rounded" title="关闭">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-700">
        {(['logs', 'errors', 'system'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${tab === t ? 'text-white border-b-2 border-emerald-400 bg-slate-800' : 'text-slate-400 hover:text-slate-200'}`}
          >
            {t === 'logs' && <><FileText size={12} className="inline mr-1" />日志 ({filteredLogs.length})</>}
            {t === 'errors' && <><AlertTriangle size={12} className="inline mr-1" />错误 ({errors.length})</>}
            {t === 'system' && <><Activity size={12} className="inline mr-1" />系统</>}
          </button>
        ))}
      </div>

      {/* Filters (logs tab only) */}
      {tab === 'logs' && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-700 bg-slate-800/50">
          <select
            value={levelFilter ?? ''}
            onChange={(e) => setLevelFilter(e.target.value ? Number(e.target.value) : null)}
            className="text-xs bg-slate-700 text-slate-200 rounded px-2 py-1 border border-slate-600"
          >
            <option value="">所有级别</option>
            {Object.entries(LOG_LEVEL_NAMES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            value={moduleFilter ?? ''}
            onChange={(e) => setModuleFilter(e.target.value || null)}
            className="text-xs bg-slate-700 text-slate-200 rounded px-2 py-1 border border-slate-600 flex-1"
          >
            <option value="">所有模块</option>
            {modules.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      )}

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        {tab === 'logs' && (
          <div className="font-mono text-[11px]">
            {filteredLogs.length === 0 && (
              <div className="p-4 text-center text-slate-500">暂无日志</div>
            )}
            {filteredLogs.map((entry) => (
              <div key={entry.id} className={`px-3 py-1 border-b border-slate-800 hover:bg-slate-800/50 ${LEVEL_BG[entry.level]}`}>
                <div className="flex items-start gap-2">
                  <span className="text-slate-500 flex-shrink-0">{formatTime(entry.timestamp)}</span>
                  <span className={`flex-shrink-0 font-bold ${LEVEL_COLORS[entry.level]}`}>
                    {LOG_LEVEL_NAMES[entry.level]}
                  </span>
                  <span className="text-cyan-400 flex-shrink-0">[{entry.module}]</span>
                  <span className="text-slate-300 break-all">{entry.message}</span>
                </div>
                {entry.detail && (
                  <pre className="mt-1 text-[10px] text-red-400 whitespace-pre-wrap break-all pl-16">{entry.detail}</pre>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'errors' && (
          <div className="text-xs">
            {errors.length === 0 && (
              <div className="p-4 text-center text-slate-500">暂无错误</div>
            )}
            {errors.map((err) => (
              <div key={err.id} className="px-3 py-2 border-b border-slate-800 hover:bg-red-900/10">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle size={12} className="text-red-400 flex-shrink-0" />
                  <span className="text-red-300 font-medium">{err.module}</span>
                  <span className="text-slate-500">{formatTime(err.timestamp)}</span>
                </div>
                <p className="text-red-200 break-words">{err.message}</p>
                {err.stack && (
                  <pre className="mt-1 text-[10px] text-slate-400 whitespace-pre-wrap break-all">{err.stack.slice(0, 300)}</pre>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'system' && (
          <div className="p-4 space-y-3 text-xs">
            <button
              onClick={() => refreshSystemStatus()}
              className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300"
            >
              <RefreshCw size={12} /> 刷新状态
            </button>
            {systemStatus ? (
              <>
                <div className="bg-slate-800 rounded p-3 space-y-2">
                  <h4 className="font-bold text-slate-300">内存使用</h4>
                  {systemStatus.memoryUsage && (
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Heap Used</span>
                        <span className="text-emerald-400">{formatBytes(systemStatus.memoryUsage.heapUsed)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Heap Total</span>
                        <span>{formatBytes(systemStatus.memoryUsage.heapTotal)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">RSS</span>
                        <span>{formatBytes(systemStatus.memoryUsage.rss)}</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="bg-slate-800 rounded p-3 space-y-2">
                  <h4 className="font-bold text-slate-300">运行时</h4>
                  <div className="flex justify-between">
                    <span className="text-slate-400">运行时间</span>
                    <span className="text-cyan-400">{systemStatus.uptime ? formatUptime(systemStatus.uptime) : '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Node.js</span>
                    <span>{systemStatus.nodeVersion || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Electron</span>
                    <span>{systemStatus.electronVersion || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">平台</span>
                    <span>{systemStatus.platform} / {systemStatus.arch}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">日志数</span>
                    <span>{systemStatus.recentLogCount ?? 0}</span>
                  </div>
                </div>
                <div className="bg-slate-800 rounded p-3">
                  <h4 className="font-bold text-slate-300 mb-1">日志目录</h4>
                  <p className="text-slate-400 break-all text-[10px]">{systemStatus.logDir || '-'}</p>
                </div>
              </>
            ) : (
              <div className="text-center text-slate-500 py-8">点击"刷新状态"加载系统信息</div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-slate-700 bg-slate-800 text-[10px] text-slate-500 flex items-center justify-between">
        <span>日志: {filteredLogs.length}/{logs.length} | 错误: {errors.length}</span>
        <span>Ctrl+Shift+D 关闭</span>
      </div>
    </div>
  )
}
