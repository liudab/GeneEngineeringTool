import { useState, useEffect } from 'react'
import { Search, Plus, Trash2, Edit2, X, Link2, Upload, Map } from 'lucide-react'
import type { GeneSequence, GeneSequenceType } from '../../shared/types'

const tabs: { id: GeneSequenceType | 'all'; label: string; color: string }[] = [
  { id: 'all', label: '全部', color: 'slate' },
  { id: 'mrna', label: 'mRNA', color: 'blue' },
  { id: 'cdna', label: 'cDNA', color: 'emerald' },
  { id: 'genomic', label: 'Genomic', color: 'purple' },
  { id: 'protein', label: 'Protein', color: 'pink' }
]

export default function GenePage() {
  const [genes, setGenes] = useState<GeneSequence[]>([])
  const [activeTab, setActiveTab] = useState<GeneSequenceType | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedGene, setSelectedGene] = useState<GeneSequence | null>(null)
  const [relations, setRelations] = useState<any[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingGene, setEditingGene] = useState<GeneSequence | null>(null)
  const [formData, setFormData] = useState({
    gene_name: '', type: 'mrna' as GeneSequenceType, species: '', sequence: '', accession_number: '', description: ''
  })

  const [importMsg, setImportMsg] = useState('')

  const handleImport = async () => {
    const result = await window.api.importGeneFiles()
    if (result?.success && result.count > 0) {
      setImportMsg(`成功导入 ${result.count} 个序列`)
      loadGenes()
      setTimeout(() => setImportMsg(''), 3000)
    }
  }

  useEffect(() => { loadGenes() }, [activeTab])

  useEffect(() => {
    if (selectedGene) {
      window.api.getGeneRelations(selectedGene.id).then(setRelations)
    }
  }, [selectedGene])

  const loadGenes = async () => {
    const type = activeTab === 'all' ? undefined : activeTab
    const data = await window.api.getGenes(type)
    setGenes(data)
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) { loadGenes(); return }
    const type = activeTab === 'all' ? undefined : activeTab
    const data = await window.api.searchGenes(searchQuery, type)
    setGenes(data)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除？')) return
    await window.api.deleteGene(id)
    loadGenes()
    if (selectedGene?.id === id) setSelectedGene(null)
  }

  const handleEdit = (g: GeneSequence) => {
    setEditingGene(g)
    setFormData({ gene_name: g.gene_name, type: g.type, species: g.species, sequence: g.sequence, accession_number: g.accession_number, description: g.description })
    setShowForm(true)
  }

  const handleCreate = () => {
    setEditingGene(null)
    setFormData({ gene_name: '', type: activeTab === 'all' ? 'mrna' : activeTab, species: '', sequence: '', accession_number: '', description: '' })
    setShowForm(true)
  }

  const handleSubmit = async () => {
    if (!formData.gene_name) return
    if (editingGene) { await window.api.updateGene(editingGene.id, formData) }
    else { await window.api.createGene(formData) }
    setShowForm(false)
    loadGenes()
  }

  const typeColors: Record<string, string> = {
    mrna: 'bg-blue-100 text-blue-700',
    cdna: 'bg-emerald-100 text-emerald-700',
    genomic: 'bg-purple-100 text-purple-700',
    protein: 'bg-pink-100 text-pink-700'
  }

  return (
    <div className="flex gap-6 h-full">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-white rounded-lg border border-slate-200 p-1 w-fit">
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-1.5 rounded-md text-sm transition-colors ${
                activeTab === tab.id ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2 mb-4">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="搜索基因名称、物种、编号..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" />
          </div>
          <button onClick={handleSearch} className="px-4 py-2 bg-pink-600 text-white rounded-lg text-sm hover:bg-pink-500">搜索</button>
          <button onClick={handleCreate} className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-500 flex items-center gap-1">
            <Plus size={16} /> 添加
          </button>
          <button onClick={handleImport} className="px-3 py-2 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-400 flex items-center gap-1" title="导入 GenBank/FASTA 文件">
            <Upload size={16} /> 导入
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-white rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-600">基因名称</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">类型</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">物种</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">编号</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">序列长度</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {genes.map((g) => (
                <tr key={g.id} onClick={() => setSelectedGene(g)}
                  className={`border-t border-slate-100 cursor-pointer ${selectedGene?.id === g.id ? 'bg-pink-50' : 'hover:bg-slate-50'}`}>
                  <td className="px-4 py-2 font-medium text-slate-800">{g.gene_name}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${typeColors[g.type] || ''}`}>{g.type.toUpperCase()}</span>
                  </td>
                  <td className="px-4 py-2 text-slate-600 italic text-xs">{g.species}</td>
                  <td className="px-4 py-2 text-slate-500 text-xs font-mono">{g.accession_number || '-'}</td>
                  <td className="px-4 py-2 text-slate-600">{g.sequence.length.toLocaleString()} {g.type === 'protein' ? 'aa' : 'bp'}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={(e) => { e.stopPropagation(); window.api.openGeneEditor(g.id) }} className="p-1 text-slate-400 hover:text-violet-600" title="查看图谱"><Map size={14} /></button>
                    <button onClick={(e) => { e.stopPropagation(); handleEdit(g) }} className="p-1 text-slate-400 hover:text-blue-600"><Edit2 size={14} /></button>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(g.id) }} className="p-1 text-slate-400 hover:text-red-600 ml-1"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {genes.length === 0 && <div className="text-center py-12 text-slate-400">暂无数据</div>}
        </div>
        <div className="text-xs text-slate-400 mt-2">共 {genes.length} 条记录 {importMsg && <span className="text-green-600 ml-2">{importMsg}</span>}</div>
      </div>

      {selectedGene && (
        <div className="w-80 bg-white rounded-lg border border-slate-200 p-5 flex-shrink-0 overflow-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-slate-800">{selectedGene.gene_name}</h3>
            <div className="flex items-center gap-2">
              <button onClick={() => window.api.openGeneEditor(selectedGene.id)} className="px-2 py-1 bg-pink-600 text-white rounded text-xs flex items-center gap-1 hover:bg-pink-500" title="查看图谱">
                <Map size={12} /> 图谱
              </button>
              <button onClick={() => setSelectedGene(null)} className="p-1 text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
          </div>
          <div className="space-y-3">
            <div><label className="text-xs font-medium text-slate-500 uppercase">类型</label>
              <p className="text-sm mt-1"><span className={`px-2 py-0.5 rounded text-xs ${typeColors[selectedGene.type]}`}>{selectedGene.type.toUpperCase()}</span></p></div>
            <div><label className="text-xs font-medium text-slate-500 uppercase">物种</label>
              <p className="text-sm italic text-slate-700 mt-1">{selectedGene.species || '未指定'}</p></div>
            <div><label className="text-xs font-medium text-slate-500 uppercase">编号</label>
              <p className="text-sm font-mono text-slate-700 mt-1">{selectedGene.accession_number || '无'}</p></div>
            <div><label className="text-xs font-medium text-slate-500 uppercase">描述</label>
              <p className="text-sm text-slate-700 mt-1">{selectedGene.description || '无'}</p></div>
            {selectedGene.sequence && (
              <div><label className="text-xs font-medium text-slate-500 uppercase">序列</label>
                <div className="mt-1 bg-slate-50 rounded p-2 sequence-display text-xs max-h-32 overflow-auto">
                  {selectedGene.sequence.substring(0, 300)}{selectedGene.sequence.length > 300 ? '...' : ''}
                </div></div>
            )}
            {relations.length > 0 && (
              <div><label className="text-xs font-medium text-slate-500 uppercase flex items-center gap-1"><Link2 size={12} /> 关联序列</label>
                <div className="mt-1 space-y-1">
                  {relations.map((r: any) => (
                    <div key={r.id} className="text-xs bg-slate-50 rounded px-2 py-1 flex items-center justify-between">
                      <span className="font-medium">{r.related_name}</span>
                      <span className={`px-1.5 py-0.5 rounded ${typeColors[r.related_type]}`}>{r.related_type.toUpperCase()}</span>
                    </div>
                  ))}
                </div></div>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[520px] shadow-xl">
            <h3 className="text-lg font-bold mb-4">{editingGene ? '编辑基因' : '添加基因'}</h3>
            <div className="space-y-3">
              <div><label className="text-sm font-medium text-slate-600">基因名称 *</label>
                <input value={formData.gene_name} onChange={(e) => setFormData({...formData, gene_name: e.target.value})}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" /></div>
              <div className="flex gap-3">
                <div className="flex-1"><label className="text-sm font-medium text-slate-600">类型</label>
                  <select value={formData.type} onChange={(e) => setFormData({...formData, type: e.target.value as GeneSequenceType})}
                    className="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
                    <option value="mrna">mRNA</option><option value="cdna">cDNA</option>
                    <option value="genomic">Genomic</option><option value="protein">Protein</option>
                  </select></div>
                <div className="flex-1"><label className="text-sm font-medium text-slate-600">物种</label>
                  <input value={formData.species} onChange={(e) => setFormData({...formData, species: e.target.value})}
                    className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" /></div>
              </div>
              <div><label className="text-sm font-medium text-slate-600">编号</label>
                <input value={formData.accession_number} onChange={(e) => setFormData({...formData, accession_number: e.target.value})}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-pink-500" /></div>
              <div><label className="text-sm font-medium text-slate-600">描述</label>
                <textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} rows={2}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" /></div>
              <div><label className="text-sm font-medium text-slate-600">序列</label>
                <textarea value={formData.sequence} onChange={(e) => setFormData({...formData, sequence: e.target.value})} rows={4}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-pink-500" /></div>
            </div>
            <div className="flex gap-2 mt-6 justify-end">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-600 border rounded-lg hover:bg-slate-50">取消</button>
              <button onClick={handleSubmit} className="px-4 py-2 text-sm bg-pink-600 text-white rounded-lg hover:bg-pink-500">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
