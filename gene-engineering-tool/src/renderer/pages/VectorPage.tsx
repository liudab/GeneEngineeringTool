import { useState, useEffect } from 'react'
import { Search, Plus, Trash2, Edit2, X, Link2, Upload, FileText, Map } from 'lucide-react'
import type { Vector, VectorEnzymeSite } from '../../shared/types'

const typeLabels: Record<string, string> = {
  plasmid: '质粒', phage: '噬菌体', cosmid: '黏粒', bac: 'BAC', yac: 'YAC', other: '其他'
}

const purposeLabels: Record<string, string> = {
  expression: '表达载体', cloning: '克隆载体', shuttle: '穿梭载体',
  reporter: '报告载体', knockout: '敲除载体', knockin: '敲入载体',
  crispr: 'CRISPR载体', other: '其他'
}

const hostLabels: Record<string, string> = {
  ecoli: '大肠杆菌', mammalian: '哺乳动物', yeast: '酵母',
  plant: '植物', insect: '昆虫', bacillus: '芽孢杆菌', other: '其他'
}

const promoterLabels: Record<string, string> = {
  constitutive: '组成型', inducible: '诱导型', tissue_specific: '组织特异性',
  none: '无', other: '其他'
}

const topologyLabels: Record<string, string> = {
  circular: '环形', linear: '线性'
}

export default function VectorPage() {
  const [vectors, setVectors] = useState<Vector[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedVector, setSelectedVector] = useState<Vector | null>(null)
  const [enzymeSites, setEnzymeSites] = useState<VectorEnzymeSite[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingVector, setEditingVector] = useState<Vector | null>(null)
  const [importMsg, setImportMsg] = useState('')
  const [formData, setFormData] = useState({
    name: '', type: 'plasmid' as const, size_bp: 0, description: '', sequence: '', backbone_id: null as number | null,
    purpose: 'cloning' as string, host_type: 'ecoli' as string, promoter_type: 'none' as string,
    is_recombinant: false, antibiotic_resistance: '', copy_number: '', topology: 'circular' as string,
    file_path: '', source_file: ''
  })

  useEffect(() => { loadVectors() }, [])

  useEffect(() => {
    if (selectedVector) {
      window.api.getVectorEnzymeSites(selectedVector.id).then(setEnzymeSites)
    }
  }, [selectedVector])

  const loadVectors = async () => {
    const data = await window.api.getVectors()
    setVectors(data)
  }

  const handleImport = async () => {
    const result = await window.api.importVectors()
    if (result && result.success) {
      setImportMsg(`成功导入 ${result.count} 个载体`)
      loadVectors()
      setTimeout(() => setImportMsg(''), 3000)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此载体？')) return
    await window.api.deleteVector(id)
    loadVectors()
    if (selectedVector?.id === id) setSelectedVector(null)
  }

  const handleEdit = (v: Vector) => {
    setEditingVector(v)
    setFormData({
      name: v.name, type: v.type, size_bp: v.size_bp, description: v.description,
      sequence: v.sequence, backbone_id: v.backbone_id, purpose: v.purpose || 'cloning',
      host_type: v.host_type || 'ecoli', promoter_type: v.promoter_type || 'none',
      is_recombinant: !!v.is_recombinant, antibiotic_resistance: v.antibiotic_resistance || '',
      copy_number: v.copy_number || '', topology: v.topology || 'circular',
      file_path: v.file_path || '', source_file: v.source_file || ''
    })
    setShowForm(true)
  }

  const handleCreate = () => {
    setEditingVector(null)
    setFormData({
      name: '', type: 'plasmid', size_bp: 0, description: '', sequence: '', backbone_id: null,
      purpose: 'cloning', host_type: 'ecoli', promoter_type: 'none',
      is_recombinant: false, antibiotic_resistance: '', copy_number: '', topology: 'circular',
      file_path: '', source_file: ''
    })
    setShowForm(true)
  }

  const handleSubmit = async () => {
    if (!formData.name) return
    if (editingVector) {
      await window.api.updateVector(editingVector.id, formData)
    } else {
      await window.api.createVector(formData as any)
    }
    setShowForm(false)
    loadVectors()
  }

  const filtered = vectors.filter(v =>
    !searchQuery ||
    v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (v.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (v.antibiotic_resistance || '').toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="flex gap-6 h-full">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <div className="flex-1 relative min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="搜索载体名称、描述、抗性..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </div>
          <button onClick={handleImport}
            className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-500 flex items-center gap-1">
            <Upload size={16} /> 导入文件
          </button>
          <button onClick={handleCreate}
            className="px-3 py-2 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-500 flex items-center gap-1">
            <Plus size={16} /> 手动添加
          </button>
        </div>

        {/* Import status */}
        {importMsg && (
          <div className="mb-3 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-lg text-sm flex items-center gap-2">
            <FileText size={14} /> {importMsg}
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto bg-white rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">名称</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">类型</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">拓扑</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">总长(bp)</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">目的</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">宿主</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">启动子</th>
                <th className="text-center px-3 py-2 font-medium text-slate-600 whitespace-nowrap">重组</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">抗性</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">拷贝数</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">来源文件</th>
                <th className="text-center px-3 py-2 font-medium text-slate-600 whitespace-nowrap">图谱</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600 whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.id} onClick={() => setSelectedVector(v)}
                  className={`border-t border-slate-100 cursor-pointer transition-colors ${selectedVector?.id === v.id ? 'bg-violet-50' : 'hover:bg-slate-50'}`}>
                  <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">{v.name}</td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded text-xs">{typeLabels[v.type] || v.type}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">{topologyLabels[v.topology] || v.topology || '-'}</td>
                  <td className="px-3 py-2 text-slate-600 text-xs">{v.size_bp?.toLocaleString() || 0}</td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{purposeLabels[v.purpose] || v.purpose || '-'}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">{hostLabels[v.host_type] || v.host_type || '-'}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{promoterLabels[v.promoter_type] || v.promoter_type || '-'}</td>
                  <td className="px-3 py-2 text-center">
                    {v.is_recombinant ? (
                      <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs">是</span>
                    ) : (
                      <span className="text-xs text-slate-400">否</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">{v.antibiotic_resistance || '-'}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{v.copy_number || '-'}</td>
                  <td className="px-3 py-2 text-xs text-slate-400 max-w-[100px] truncate">{v.source_file || '-'}</td>
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    <button onClick={(e) => { e.stopPropagation(); window.api.openEditor(v.id) }}
                      className="px-2 py-1 text-xs text-violet-600 border border-violet-200 rounded flex items-center gap-1 hover:bg-violet-50" title="打开图谱编辑器">
                      <Map size={12} /> 图谱
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={(e) => { e.stopPropagation(); handleEdit(v) }} className="p-1 text-slate-400 hover:text-blue-600"><Edit2 size={14} /></button>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(v.id) }} className="p-1 text-slate-400 hover:text-red-600 ml-1"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="text-center py-12 text-slate-400">暂无数据，点击"导入文件"或"手动添加"创建载体</div>}
        </div>
        <div className="text-xs text-slate-400 mt-2">共 {filtered.length} 条记录</div>
      </div>

      {/* Detail Panel */}
      {selectedVector && (
        <div className="w-80 bg-white rounded-lg border border-slate-200 p-5 flex-shrink-0 overflow-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-slate-800">{selectedVector.name}</h3>
            <div className="flex items-center gap-1">
              <button onClick={() => window.api.openEditor(selectedVector.id)}
                className="px-2 py-1 bg-violet-600 text-white rounded text-xs flex items-center gap-1 hover:bg-violet-500" title="打开图谱编辑器">
                <Map size={12} /> 图谱
              </button>
              <button onClick={() => setSelectedVector(null)} className="p-1 text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
          </div>
          <div className="space-y-3 text-sm">
            <DetailRow label="类型" value={typeLabels[selectedVector.type] || selectedVector.type} />
            <DetailRow label="拓扑结构" value={topologyLabels[selectedVector.topology] || selectedVector.topology || '-'} />
            <DetailRow label="序列总长" value={`${(selectedVector.size_bp || 0).toLocaleString()} bp`} />
            <DetailRow label="基因工程目的" value={purposeLabels[selectedVector.purpose] || selectedVector.purpose || '-'} />
            <DetailRow label="宿主类型" value={hostLabels[selectedVector.host_type] || selectedVector.host_type || '-'} />
            <DetailRow label="启动子类型" value={promoterLabels[selectedVector.promoter_type] || selectedVector.promoter_type || '-'} />
            <DetailRow label="重组质粒" value={selectedVector.is_recombinant ? '是' : '否'} />
            <DetailRow label="抗生素抗性" value={selectedVector.antibiotic_resistance || '未指定'} />
            <DetailRow label="拷贝数" value={selectedVector.copy_number || '未指定'} />
            <DetailRow label="描述" value={selectedVector.description || '无'} />
            {selectedVector.source_file && (
              <DetailRow label="来源文件" value={selectedVector.source_file} />
            )}
            {selectedVector.backbone_id && (
              <div><label className="text-xs font-medium text-slate-500 uppercase">空载体</label>
                <p className="mt-1 flex items-center gap-1 text-blue-600"><Link2 size={12} /> 已关联空载体</p></div>
            )}
            {/* 酶切位点 */}
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase">酶切位点</label>
              <div className="mt-1 space-y-1">
                {enzymeSites.length > 0 ? enzymeSites.map((site: any) => (
                  <div key={site.id} className="flex items-center justify-between text-xs bg-slate-50 rounded px-2 py-1">
                    <span className="font-medium">{site.enzyme_name}</span>
                    <span className="text-slate-500">{site.position} bp</span>
                    {site.is_unique ? (
                      <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded">唯一</span>
                    ) : (
                      <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded">多位点</span>
                    )}
                  </div>
                )) : <p className="text-xs text-slate-400">暂无酶切位点数据</p>}
              </div>
            </div>
            {/* 序列预览 */}
            {selectedVector.sequence && (
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase">序列预览</label>
                <div className="mt-1 bg-slate-50 rounded p-2 sequence-display text-xs max-h-24 overflow-auto">
                  {selectedVector.sequence.substring(0, 300)}{selectedVector.sequence.length > 300 ? '...' : ''}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[580px] max-h-[85vh] overflow-auto shadow-xl">
            <h3 className="text-lg font-bold mb-4">{editingVector ? '编辑载体' : '添加载体'}</h3>
            <div className="space-y-3">
              <div><label className="text-sm font-medium text-slate-600">名称 *</label>
                <input value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" /></div>

              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm font-medium text-slate-600">载体类型</label>
                  <select value={formData.type} onChange={(e) => setFormData({...formData, type: e.target.value})}
                    className="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
                    {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></div>
                <div><label className="text-sm font-medium text-slate-600">拓扑结构</label>
                  <select value={formData.topology} onChange={(e) => setFormData({...formData, topology: e.target.value})}
                    className="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
                    {Object.entries(topologyLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm font-medium text-slate-600">基因工程目的</label>
                  <select value={formData.purpose} onChange={(e) => setFormData({...formData, purpose: e.target.value})}
                    className="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
                    {Object.entries(purposeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></div>
                <div><label className="text-sm font-medium text-slate-600">宿主类型</label>
                  <select value={formData.host_type} onChange={(e) => setFormData({...formData, host_type: e.target.value})}
                    className="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
                    {Object.entries(hostLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm font-medium text-slate-600">启动子类型</label>
                  <select value={formData.promoter_type} onChange={(e) => setFormData({...formData, promoter_type: e.target.value})}
                    className="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
                    {Object.entries(promoterLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></div>
                <div><label className="text-sm font-medium text-slate-600">序列总长 (bp)</label>
                  <input type="number" value={formData.size_bp} onChange={(e) => setFormData({...formData, size_bp: parseInt(e.target.value) || 0})}
                    className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" /></div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm font-medium text-slate-600">抗生素抗性</label>
                  <input value={formData.antibiotic_resistance} onChange={(e) => setFormData({...formData, antibiotic_resistance: e.target.value})}
                    placeholder="如: Ampicillin, Kanamycin"
                    className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" /></div>
                <div><label className="text-sm font-medium text-slate-600">拷贝数</label>
                  <input value={formData.copy_number} onChange={(e) => setFormData({...formData, copy_number: e.target.value})}
                    placeholder="如: High copy, Low copy"
                    className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" /></div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={formData.is_recombinant} onChange={(e) => setFormData({...formData, is_recombinant: e.target.checked})}
                  className="rounded" />
                重组质粒
              </label>

              <div><label className="text-sm font-medium text-slate-600">描述</label>
                <textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} rows={2}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" /></div>

              <div><label className="text-sm font-medium text-slate-600">序列</label>
                <textarea value={formData.sequence} onChange={(e) => setFormData({...formData, sequence: e.target.value})} rows={3}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500" /></div>
            </div>
            <div className="flex gap-2 mt-6 justify-end">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-600 border rounded-lg hover:bg-slate-50">取消</button>
              <button onClick={handleSubmit} className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-500">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-500 uppercase">{label}</label>
      <p className="mt-0.5 text-slate-700">{value}</p>
    </div>
  )
}
