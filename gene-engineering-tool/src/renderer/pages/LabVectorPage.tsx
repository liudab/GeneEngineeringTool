import { useState, useEffect } from 'react'
import { Search, Plus, Trash2, Edit2, X, Link2, Upload, Map } from 'lucide-react'
import type { LabVector, Vector, GeneSequence } from '../../shared/types'
import { useLifecycleLog, useModuleLogger } from '../hooks/useDebugLog'

export default function LabVectorPage() {
  useLifecycleLog('LabVectorPage')
  const log = useModuleLogger('LabVectorPage')

  const [labVectors, setLabVectors] = useState<any[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selected, setSelected] = useState<any>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [vectors, setVectors] = useState<Vector[]>([])
  const [genes, setGenes] = useState<GeneSequence[]>([])
  const [formData, setFormData] = useState({
    name: '', vector_id: null as number | null, insert_gene_id: null as number | null,
    empty_vector_id: null as number | null, notes: ''
  })

  const [importMsg, setImportMsg] = useState('')

  const handleImport = async () => {
    log.info('Importing lab vector files...')
    const result = await window.api.importLabVectorFiles()
    if (result?.success && result.count > 0) {
      log.info(`Imported ${result.count} vectors`)
      setImportMsg(`成功导入 ${result.count} 个载体`)
      loadLabVectors()
      setTimeout(() => setImportMsg(''), 3000)
    }
  }

  useEffect(() => {
    loadLabVectors()
    window.api.getVectors().then(setVectors)
    window.api.getGenes().then(setGenes)
  }, [])

  const loadLabVectors = async () => {
    log.info('Loading lab vectors...')
    try {
      const data = await window.api.getLabVectors()
      log.info(`Loaded ${data.length} lab vectors`)
      setLabVectors(data)
    } catch (err) {
      log.error('Failed to load lab vectors', err)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除？')) return
    log.info(`Deleting lab vector id=${id}`)
    await window.api.deleteLabVector(id)
    loadLabVectors()
    if (selected?.id === id) setSelected(null)
  }

  const handleEdit = (lv: any) => {
    setEditing(lv)
    setFormData({
      name: lv.name, vector_id: lv.vector_id, insert_gene_id: lv.insert_gene_id,
      empty_vector_id: lv.empty_vector_id, notes: lv.notes
    })
    setShowForm(true)
  }

  const handleCreate = () => {
    setEditing(null)
    setFormData({ name: '', vector_id: null, insert_gene_id: null, empty_vector_id: null, notes: '' })
    setShowForm(true)
  }

  const handleSubmit = async () => {
    if (!formData.name) return
    if (editing) {
      console.log(`[LabVectorPage] Updating lab vector id=${editing.id}: ${formData.name}`)
      await window.api.updateLabVector(editing.id, formData)
    } else {
      console.log(`[LabVectorPage] Creating lab vector: ${formData.name}`)
      await window.api.createLabVector(formData)
    }
    setShowForm(false)
    loadLabVectors()
  }

  const filtered = labVectors.filter(lv => !searchQuery || lv.name.toLowerCase().includes(searchQuery.toLowerCase()))

  return (
    <div className="flex gap-6 h-full">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex gap-2 mb-4">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="搜索实验室载体..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button onClick={handleCreate} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-500 flex items-center gap-1">
            <Plus size={16} /> 添加
          </button>
          <button onClick={handleImport} className="px-3 py-2 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-400 flex items-center gap-1" title="导入 GenBank/FASTA/.dna 文件">
            <Upload size={16} /> 导入
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-white rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-600">名称</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">载体</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">插入基因</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">空载体</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">创建时间</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lv) => (
                <tr key={lv.id} onClick={() => setSelected(lv)}
                  className={`border-t border-slate-100 cursor-pointer ${selected?.id === lv.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                  <td className="px-4 py-2 font-medium text-slate-800">{lv.name}</td>
                  <td className="px-4 py-2 text-slate-600 text-xs">{lv.vector_name || '-'}</td>
                  <td className="px-4 py-2 text-slate-600 text-xs">{lv.insert_gene_name || '-'}</td>
                  <td className="px-4 py-2 text-slate-600 text-xs">{lv.empty_vector_name || '-'}</td>
                  <td className="px-4 py-2 text-slate-500 text-xs">{lv.created_at?.split('T')[0] || lv.created_at}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={(e) => { e.stopPropagation(); if (lv.vector_id) window.api.openEditor(lv.vector_id) }}
                      className={`p-1 ${lv.vector_id ? 'text-slate-400 hover:text-violet-600' : 'text-slate-200 cursor-not-allowed'}`} title={lv.vector_id ? '打开图谱编辑器' : '无关联载体'}>
                      <Map size={14} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleEdit(lv) }} className="p-1 text-slate-400 hover:text-blue-600"><Edit2 size={14} /></button>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(lv.id) }} className="p-1 text-slate-400 hover:text-red-600 ml-1"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="text-center py-12 text-slate-400">暂无数据</div>}
        </div>
        {importMsg && <div className="text-xs text-green-600 mt-2">{importMsg}</div>}
      </div>

      {selected && (
        <div className="w-80 bg-white rounded-lg border border-slate-200 p-5 flex-shrink-0 overflow-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-slate-800">{selected.name}</h3>
            <div className="flex items-center gap-2">
              {selected.vector_id && (
                <button onClick={() => window.api.openEditor(selected.vector_id)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs flex items-center gap-1 hover:bg-blue-500" title="打开图谱编辑器">
                  <Map size={12} /> 图谱
                </button>
              )}
              <button onClick={() => setSelected(null)} className="p-1 text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
          </div>
          <div className="space-y-3">
            <div><label className="text-xs font-medium text-slate-500 uppercase">关联载体</label>
              <p className="text-sm text-slate-700 mt-1 flex items-center gap-1">
                {selected.vector_name ? <><Link2 size={12} /> {selected.vector_name}</> : '未关联'}
              </p></div>
            <div><label className="text-xs font-medium text-slate-500 uppercase">插入基因</label>
              <p className="text-sm text-slate-700 mt-1">{selected.insert_gene_name || '无'}</p></div>
            <div><label className="text-xs font-medium text-slate-500 uppercase">空载体</label>
              <p className="text-sm text-slate-700 mt-1">{selected.empty_vector_name || '无'}</p></div>
            <div><label className="text-xs font-medium text-slate-500 uppercase">备注</label>
              <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap">{selected.notes || '无'}</p></div>
            <div><label className="text-xs font-medium text-slate-500 uppercase">创建时间</label>
              <p className="text-sm text-slate-700 mt-1">{selected.created_at}</p></div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[520px] shadow-xl">
            <h3 className="text-lg font-bold mb-4">{editing ? '编辑实验室载体' : '添加实验室载体'}</h3>
            <div className="space-y-3">
              <div><label className="text-sm font-medium text-slate-600">名称 *</label>
                <input value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="text-sm font-medium text-slate-600">关联载体</label>
                <select value={formData.vector_id || ''} onChange={(e) => setFormData({...formData, vector_id: e.target.value ? parseInt(e.target.value) : null})}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
                  <option value="">未关联</option>
                  {vectors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select></div>
              <div><label className="text-sm font-medium text-slate-600">插入基因</label>
                <select value={formData.insert_gene_id || ''} onChange={(e) => setFormData({...formData, insert_gene_id: e.target.value ? parseInt(e.target.value) : null})}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
                  <option value="">无</option>
                  {genes.map(g => <option key={g.id} value={g.id}>{g.gene_name} ({g.type.toUpperCase()})</option>)}
                </select></div>
              <div><label className="text-sm font-medium text-slate-600">空载体对照</label>
                <select value={formData.empty_vector_id || ''} onChange={(e) => setFormData({...formData, empty_vector_id: e.target.value ? parseInt(e.target.value) : null})}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
                  <option value="">无</option>
                  {labVectors.filter(lv => lv.id !== editing?.id).map(lv => <option key={lv.id} value={lv.id}>{lv.name}</option>)}
                </select></div>
              <div><label className="text-sm font-medium text-slate-600">备注</label>
                <textarea value={formData.notes} onChange={(e) => setFormData({...formData, notes: e.target.value})} rows={3}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
            </div>
            <div className="flex gap-2 mt-6 justify-end">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-600 border rounded-lg hover:bg-slate-50">取消</button>
              <button onClick={handleSubmit} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
