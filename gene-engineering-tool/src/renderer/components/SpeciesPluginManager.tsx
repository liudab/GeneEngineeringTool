/**
 * @module SpeciesPluginManager
 * @description
 * 物种插件管理组件 — 用于设置页面，展示已安装的物种插件并支持管理操作。
 *
 * 功能：
 * - 显示所有已安装的物种插件列表
 * - 支持启用/禁用插件
 * - 支持卸载插件
 * - 支持导入插件数据（CSV）
 */

import { useState, useEffect } from 'react'
import { Plus, Trash2, Upload, Download, Database, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import type { SpeciesPlugin } from '../../shared/types'

export default function SpeciesPluginManager() {
  const [plugins, setPlugins] = useState<SpeciesPlugin[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState<number | null>(null)
  const [exporting, setExporting] = useState<number | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [progress, setProgress] = useState<{ message: string; percent: number } | null>(null)

  // 加载插件列表
  const loadPlugins = async () => {
    try {
      const list = await window.api.getSpeciesPlugins()
      setPlugins(list || [])
    } catch (err) {
      console.error('Failed to load species plugins:', err)
      setMessage({ type: 'error', text: '加载插件列表失败' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPlugins()
  }, [])

  // 监听进度事件
  useEffect(() => {
    const cleanup = window.api.onSpeciesPluginProgress((data) => {
      setProgress(data)
      if (data.percent >= 100) {
        setTimeout(() => setProgress(null), 1500)
      }
    })
    return () => { cleanup() }
  }, [])

  // 安装插件
  const handleInstall = async () => {
    setProgress({ message: '正在准备安装...', percent: 0 })
    try {
      const result = await window.api.installSpeciesPlugin()
      setProgress(null)
      if (result?.success) {
        setMessage({ type: 'success', text: result.message || '安装成功' })
        loadPlugins()
      } else {
        setMessage({ type: 'error', text: result?.message || '安装失败' })
      }
    } catch (err: any) {
      setProgress(null)
      setMessage({ type: 'error', text: err.message || '安装失败' })
    }
  }

  // 卸载插件
  const handleUninstall = async (id: number, name: string) => {
    if (!confirm(`确定要卸载物种插件 "${name}" 吗？这将删除所有相关的注释数据。`)) {
      return
    }
    try {
      const result = await window.api.uninstallSpeciesPlugin(id)
      if (result?.success) {
        setMessage({ type: 'success', text: `已卸载: ${name}` })
        loadPlugins()
      } else {
        setMessage({ type: 'error', text: '卸载失败' })
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '卸载失败' })
    }
  }

  // 切换启用状态
  const handleToggle = async (id: number, enabled: boolean) => {
    try {
      await window.api.toggleSpeciesPlugin(id, enabled)
      loadPlugins()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '操作失败' })
    }
  }

  // 导入数据
  const handleImportData = async (pluginId: number) => {
    setImporting(pluginId)
    setProgress({ message: '正在准备导入...', percent: 0 })
    try {
      const result = await window.api.importSpeciesPluginData(pluginId)
      setProgress(null)
      if (result?.success) {
        setMessage({
          type: 'success',
          text: `导入成功: ${result.imported} 条注释, ${result.matched} 条已匹配`
        })
        loadPlugins()
      } else {
        setMessage({ type: 'error', text: '导入失败' })
      }
    } catch (err: any) {
      setProgress(null)
      setMessage({ type: 'error', text: err.message || '导入失败' })
    } finally {
      setImporting(null)
    }
  }

  // 导出插件备份
  const handleExport = async (pluginId: number, speciesName: string) => {
    setExporting(pluginId)
    try {
      const result = await window.api.exportSpeciesPlugin(pluginId)
      if (result?.success) {
        setMessage({ type: 'success', text: `已导出: ${result.filePath}` })
      } else {
        setMessage({ type: 'error', text: result?.message || '导出失败' })
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '导出失败' })
    } finally {
      setExporting(null)
    }
  }

  if (loading) {
    return (
      <div className="p-6 bg-white rounded-lg border border-slate-200">
        <p className="text-sm text-slate-500">加载中...</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-slate-800">物种数据插件</h3>
          <p className="text-xs text-slate-500 mt-1">
            管理物种基因数据库增强插件，提供多源基因注释数据
          </p>
        </div>
        <button
          onClick={handleInstall}
          title="选择 .plugin 插件文件进行安装"
          className="px-3 py-1.5 bg-cyan-600 text-white rounded-md text-xs hover:bg-cyan-500 flex items-center gap-1 transition-colors"
        >
          <Plus size={14} />
          安装插件
        </button>
      </div>

      {/* 消息提示 */}
      {message && (
        <div
          className={`mb-4 p-3 rounded-lg text-xs ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* 进度条 */}
      {progress && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 size={14} className="text-blue-600 animate-spin" />
            <span className="text-xs text-blue-700 font-medium">{progress.message}</span>
            <span className="text-xs text-blue-500 ml-auto">{progress.percent}%</span>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-1.5">
            <div
              className="bg-blue-600 h-1.5 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${Math.min(progress.percent, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* 插件列表 */}
      {plugins.length === 0 ? (
        <div className="text-center py-8 text-slate-400">
          <Database size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">暂无已安装的物种插件</p>
          <p className="text-xs mt-1">点击"安装插件"添加物种数据库</p>
        </div>
      ) : (
        <div className="space-y-3">
          {plugins.map(plugin => (
            <div
              key={plugin.id}
              className="border border-slate-200 rounded-lg p-4 hover:border-slate-300 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-slate-800">
                      {plugin.species_name}
                    </h4>
                    {plugin.species_latin && (
                      <span className="text-xs text-slate-500 italic">
                        ({plugin.species_latin})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded font-mono">
                      v{plugin.version}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      安装: {new Date(plugin.installed_at).toLocaleDateString()}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      更新: {new Date(plugin.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                  {plugin.package_name && (
                    <p className="text-[10px] text-slate-400 mt-0.5 font-mono">
                      {plugin.package_name}
                    </p>
                  )}
                  {plugin.annotation_count !== undefined && plugin.annotation_count > 0 && (
                    <p className="text-xs text-slate-500 mt-1">
                      注释数: <span className="font-medium text-slate-700">{plugin.annotation_count.toLocaleString()}</span>
                      {plugin.annotation_matched !== undefined && plugin.annotation_matched > 0 && (
                        <span className="text-green-600 ml-1">(已匹配 {plugin.annotation_matched.toLocaleString()})</span>
                      )}
                    </p>
                  )}
                </div>

                {/* 启用/禁用开关 */}
                <button
                  onClick={() => handleToggle(plugin.id, !plugin.enabled)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    plugin.enabled
                      ? 'bg-green-100 text-green-700 hover:bg-green-200'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {plugin.enabled ? (
                    <span className="flex items-center gap-1">
                      <CheckCircle size={12} />
                      已启用
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <XCircle size={12} />
                      已禁用
                    </span>
                  )}
                </button>
              </div>

              {/* 操作按钮 */}
              <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                <button
                  onClick={() => handleImportData(plugin.id)}
                  disabled={importing === plugin.id}
                  className="px-3 py-1 bg-blue-50 text-blue-700 rounded text-xs hover:bg-blue-100 flex items-center gap-1 transition-colors disabled:opacity-50"
                >
                  <Upload size={12} />
                  {importing === plugin.id ? '导入中...' : '导入数据'}
                </button>
                <button
                  onClick={() => handleExport(plugin.id, plugin.species_name)}
                  disabled={exporting === plugin.id}
                  title="导出为 .plugin 文件"
                  className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded text-xs hover:bg-emerald-100 flex items-center gap-1 transition-colors disabled:opacity-50"
                >
                  <Download size={12} />
                  {exporting === plugin.id ? '导出中...' : '导出 .plugin'}
                </button>
                <button
                  onClick={() => handleUninstall(plugin.id, plugin.species_name)}
                  className="px-3 py-1 bg-red-50 text-red-700 rounded text-xs hover:bg-red-100 flex items-center gap-1 transition-colors"
                >
                  <Trash2 size={12} />
                  卸载
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
