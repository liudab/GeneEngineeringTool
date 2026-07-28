import { useState } from 'react'
import { X, Search, Loader2, Database } from 'lucide-react'

interface Props {
  onClose: () => void
  onGeneCreated: (geneId: number) => void
}

export default function RiceGeneImportDialog({ onClose, onGeneCreated }: Props) {
  const [msuLocus, setMsuLocus] = useState('')
  const [rapdbAccession, setRapdbAccession] = useState('')
  const [ricedataId, setRicedataId] = useState('')
  const [searching, setSearching] = useState(false)
  const [creating, setCreating] = useState(false)
  const [results, setResults] = useState<any[]>([])
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')

  const handleSearch = async () => {
    const keyword = msuLocus.trim() || rapdbAccession.trim() || ricedataId.trim()
    if (!keyword) { setError('请至少填写一个搜索字段'); return }
    setSearching(true)
    setError('')
    setResults([])
    setSearched(false)
    try {
      const res = await window.api.searchSpeciesAnnotations(keyword)
      if (res.success) {
        setResults(res.data || [])
        if ((res.data || []).length === 0) setError('未找到匹配的插件注释数据，请确认存取号是否正确')
      } else {
        setError(res.error || '搜索失败')
      }
    } catch (err: any) {
      setError(err.message || '搜索失败')
    } finally {
      setSearching(false)
      setSearched(true)
    }
  }

  const handleCreate = async () => {
    if (results.length === 0) return
    setCreating(true)
    setError('')
    try {
      // 从注释中提取基因名称
      let geneName = ''
      for (const ann of results) {
        try {
          const data = JSON.parse(ann.annotation_data || '{}')
          if (data.gene_chinese_name) { geneName = data.gene_chinese_name; break }
        } catch {}
        if (ann.gene_name) { geneName = ann.gene_name; break }
        if (ann.gene_symbol) { geneName = ann.gene_symbol; break }
      }
      if (!geneName) geneName = results[0].source_accession || '未命名水稻基因'

      const annotationIds = results.map((r: any) => r.id)
      const res = await window.api.createGeneFromAnnotation(annotationIds, geneName)
      if (res.success) {
        onGeneCreated(res.geneId)
        onClose()
      } else {
        setError(res.error || '创建基因失败')
      }
    } catch (err: any) {
      setError(err.message || '创建基因失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[9999]" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Database size={18} className="text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-800">水稻基因导入</h3>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        {/* 搜索区域 */}
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-slate-500">填写以下任意一个或多个字段进行搜索：</p>
          <div className="grid grid-cols-1 gap-2">
            <div>
              <label className="text-xs font-medium text-slate-600">MSU Locus</label>
              <input value={msuLocus} onChange={e => setMsuLocus(e.target.value)} placeholder="如 LOC_Os05g06280"
                className="mt-0.5 w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400"
                onKeyDown={e => e.key === 'Enter' && handleSearch()} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">RAP-DB 存取号</label>
              <input value={rapdbAccession} onChange={e => setRapdbAccession(e.target.value)} placeholder="如 Os05g0154700"
                className="mt-0.5 w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400"
                onKeyDown={e => e.key === 'Enter' && handleSearch()} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Ricedata ID</label>
              <input value={ricedataId} onChange={e => setRicedataId(e.target.value)} placeholder="如 12011"
                className="mt-0.5 w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400"
                onKeyDown={e => e.key === 'Enter' && handleSearch()} />
            </div>
          </div>
          <button onClick={handleSearch} disabled={searching}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50">
            {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            搜索
          </button>
        </div>

        {/* 结果区域 */}
        {searched && (
          <div className="px-5 pb-4 flex-1 overflow-auto">
            {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{error}</div>}
            {results.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-600">找到 {results.length} 条匹配记录：</p>
                {results.map((ann: any, i: number) => (
                  <div key={i} className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${ann.source_database === 'RAP-DB' ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'}`}>
                        {ann.source_database}
                      </span>
                      <span className="font-mono text-slate-800">{ann.source_accession}</span>
                    </div>
                    {ann.gene_name && <p className="mt-1 text-slate-600">基因名: {ann.gene_name}</p>}
                    {ann.gene_symbol && <p className="text-slate-500">符号: {ann.gene_symbol}</p>}
                    {ann.ncbi_gene_id && <p className="text-slate-500">NCBI ID: {ann.ncbi_gene_id}</p>}
                  </div>
                ))}
                <button onClick={handleCreate} disabled={creating}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 mt-2">
                  {creating ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                  创建基因并关联
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
