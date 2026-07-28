import { useState } from 'react'
import { X, Dna, Loader2, Settings } from 'lucide-react'

interface NCBISearchDialogProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (geneId: number) => void
}

export default function NCBISearchDialog({ isOpen, onClose, onSuccess }: NCBISearchDialogProps) {
  const [geneIdInput, setGeneIdInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [apiKey, setApiKey] = useState('')

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }

  const handleImport = async () => {
    const trimmed = geneIdInput.trim()
    if (!trimmed) return

    // 提取纯数字 Gene ID
    let geneId = trimmed
    const locMatch = trimmed.match(/LOC_(\w+)/i) || trimmed.match(/LOC(\d+)/i)
    if (locMatch) geneId = locMatch[1]
    const numMatch = trimmed.match(/^(\d+)$/)
    if (numMatch) geneId = numMatch[1]

    setLoading(true)
    setError('')
    setProgress('正在连接 NCBI...')

    try {
      const result = await window.api.importGeneFromNCBI(geneId)
      if (result?.success && result.geneId) {
        setProgress(result.message)
        setTimeout(() => {
          onSuccess(result.geneId!)
          onClose()
        }, 1500)
      } else {
        setError(result?.message || '导入失败')
      }
    } catch (err: any) {
      setError(err.message || '网络错误，请检查连接')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveApiKey = async () => {
    try {
      await window.api.setSetting('ncbi_api_key', apiKey)
      setShowSettings(false)
    } catch (e) {
      console.error('Failed to save API key:', e)
    }
  }

  const handleLoadApiKey = async () => {
    try {
      const key = await window.api.getSetting('ncbi_api_key')
      setApiKey(key || '')
    } catch (e) {
      console.error('Failed to load API key:', e)
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onKeyDown={handleKeyDown}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[90vh] overflow-auto">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Dna size={18} className="text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-800">从 NCBI 导入基因</h3>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setShowSettings(!showSettings); if (!showSettings) handleLoadApiKey() }}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100"
              title="NCBI API Key 设置"
            >
              <Settings size={14} />
            </button>
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* API Key 设置区 */}
          {showSettings && (
            <div className="bg-slate-50 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600">NCBI API Key</span>
                <a
                  href="https://www.ncbi.nlm.nih.gov/account/settings/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-cyan-600 hover:underline"
                  onClick={(e) => { e.preventDefault(); window.api.openExternal('https://www.ncbi.nlm.nih.gov/account/settings/') }}
                >
                  获取 API Key →
                </a>
              </div>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="输入你的 NCBI API Key（可选，提高限速到10 req/s）"
                className="w-full px-3 py-1.5 border border-slate-200 rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSaveApiKey}
                  className="px-3 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-500"
                >
                  保存
                </button>
                <button
                  onClick={() => setShowSettings(false)}
                  className="px-3 py-1 border border-slate-200 rounded text-xs text-slate-600 hover:bg-slate-100"
                >
                  关闭
                </button>
              </div>
              <p className="text-[10px] text-slate-400">
                无 API Key 时限速 3 req/s，有 Key 为 10 req/s
              </p>
            </div>
          )}

          {/* 输入区 */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              NCBI Gene ID 或 LOC 号
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={geneIdInput}
                onChange={(e) => setGeneIdInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !loading && handleImport()}
                placeholder="例如: 4347, LOC4347, 或 NCBI accession"
                disabled={loading}
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                autoFocus
              />
              <button
                onClick={handleImport}
                disabled={loading || !geneIdInput.trim()}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Dna size={14} />}
                {loading ? '导入中...' : '导入'}
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5">
              支持纯数字 Gene ID（如 4347）、LOC 号（如 LOC4347）或 NCBI accession
            </p>
          </div>

          {/* 进度 */}
          {progress && (
            <div className="flex items-center gap-2 text-xs text-slate-600 bg-blue-50 rounded-lg px-3 py-2">
              {loading && <Loader2 size={12} className="animate-spin text-blue-500" />}
              <span>{progress}</span>
            </div>
          )}

          {/* 错误 */}
          {error && (
            <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* 说明 */}
          <div className="text-[10px] text-slate-400 space-y-1 bg-slate-50 rounded-lg p-3">
            <p className="font-medium text-slate-500">导入流程：</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>获取基因元数据（symbol、chromosome、biotype、summary）</li>
              <li>下载基因组序列（含前后各 4000bp 侧翼区域）</li>
              <li>获取转录本列表及序列（最多5个）</li>
              <li>解析 GenBank features 并推断外显子/内含子结构</li>
              <li>写入本地数据库（基因 + 转录本 + 外显子 + 交叉引用）</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
