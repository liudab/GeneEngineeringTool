import { useState, useEffect } from 'react'
import { Search, Plus, Trash2, Edit2, X, Thermometer } from 'lucide-react'
import type { RestrictionEnzyme } from '../../shared/types'

export default function EnzymePage() {
  const [enzymes, setEnzymes] = useState<RestrictionEnzyme[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEnzyme, setSelectedEnzyme] = useState<RestrictionEnzyme | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingEnzyme, setEditingEnzyme] = useState<RestrictionEnzyme | null>(null)
  const [formData, setFormData] = useState({
    name: '', source_organism: '', recognition_sequence: '', cut_position: 0, optimal_temp: 37, is_palindromic: true
  })

  useEffect(() => {
    loadEnzymes()
  }, [])

  const loadEnzymes = async () => {
    const data = await window.api.getEnzymes()
    setEnzymes(data)
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      loadEnzymes()
      return
    }
    const data = await window.api.searchEnzymes(searchQuery)
    setEnzymes(data)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此酶？')) return
    await window.api.deleteEnzyme(id)
    loadEnzymes()
    if (selectedEnzyme?.id === id) setSelectedEnzyme(null)
  }

  const handleEdit = (enzyme: RestrictionEnzyme) => {
    setEditingEnzyme(enzyme)
    setFormData({
      name: enzyme.name,
      source_organism: enzyme.source_organism,
      recognition_sequence: enzyme.recognition_sequence,
      cut_position: enzyme.cut_position,
      optimal_temp: enzyme.optimal_temp,
      is_palindromic: enzyme.is_palindromic
    })
    setShowForm(true)
  }

  const handleCreate = () => {
    setEditingEnzyme(null)
    setFormData({ name: '', source_organism: '', recognition_sequence: '', cut_position: 0, optimal_temp: 37, is_palindromic: true })
    setShowForm(true)
  }

  const handleSubmit = async () => {
    if (!formData.name || !formData.recognition_sequence) return
    if (editingEnzyme) {
      await window.api.updateEnzyme(editingEnzyme.id, formData)
    } else {
      await window.api.createEnzyme(formData)
    }
    setShowForm(false)
    loadEnzymes()
  }

  const renderSequenceHighlight = (seq: string, cutPos: number) => {
    return seq.split('').map((char, i) => (
      <span
        key={i}
        className={`inline-block w-4 text-center font-mono font-bold ${
          i < cutPos ? 'text-emerald-600' : 'text-red-500'
        }`}
        style={{ borderBottom: i === cutPos - 1 ? '2px solid #f59e0b' : undefined }}
      >
        {char.toUpperCase()}
      </span>
    ))
  }

  return (
    <div className="flex gap-6 h-full">
      {/* Left: List */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Search bar */}
        <div className="flex gap-2 mb-4">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="搜索酶名称、物种或识别序列..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button onClick={handleSearch} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-500">
            搜索
          </button>
          <button onClick={handleCreate} className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-500 flex items-center gap-1">
            <Plus size={16} /> 添加
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto bg-white rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-600">名称</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">来源物种</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">识别序列</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">温度</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {enzymes.map((enzyme) => (
                <tr
                  key={enzyme.id}
                  onClick={() => setSelectedEnzyme(enzyme)}
                  className={`border-t border-slate-100 cursor-pointer transition-colors ${
                    selectedEnzyme?.id === enzyme.id ? 'bg-blue-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <td className="px-4 py-2 font-medium text-slate-800">{enzyme.name}</td>
                  <td className="px-4 py-2 text-slate-600 italic text-xs">{enzyme.source_organism}</td>
                  <td className="px-4 py-2 font-mono text-amber-600">{enzyme.recognition_sequence}</td>
                  <td className="px-4 py-2 text-slate-600">{enzyme.optimal_temp}°C</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={(e) => { e.stopPropagation(); handleEdit(enzyme) }} className="p-1 text-slate-400 hover:text-blue-600">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(enzyme.id) }} className="p-1 text-slate-400 hover:text-red-600 ml-1">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {enzymes.length === 0 && (
            <div className="text-center py-12 text-slate-400">暂无数据</div>
          )}
        </div>
        <div className="text-xs text-slate-400 mt-2">共 {enzymes.length} 条记录</div>
      </div>

      {/* Right: Detail */}
      {selectedEnzyme && (
        <div className="w-80 bg-white rounded-lg border border-slate-200 p-5 flex-shrink-0 overflow-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-slate-800">{selectedEnzyme.name}</h3>
            <button onClick={() => setSelectedEnzyme(null)} className="p-1 text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase">来源物种</label>
              <p className="text-sm italic text-slate-700 mt-1">{selectedEnzyme.source_organism}</p>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 uppercase">识别序列 (5'→3')</label>
              <div className="mt-1 bg-slate-50 rounded p-3 font-mono text-lg tracking-wider">
                {renderSequenceHighlight(selectedEnzyme.recognition_sequence, selectedEnzyme.cut_position)}
              </div>
              <p className="text-xs text-slate-500 mt-1">切割位置: 第 {selectedEnzyme.cut_position} 位后</p>
            </div>

            <div className="flex gap-4">
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase">最适温度</label>
                <p className="text-sm text-slate-700 mt-1 flex items-center gap-1">
                  <Thermometer size={14} /> {selectedEnzyme.optimal_temp}°C
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase">回文序列</label>
                <p className="text-sm text-slate-700 mt-1">{selectedEnzyme.is_palindromic ? '是' : '否'}</p>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 uppercase">互补链</label>
              <div className="mt-1 bg-slate-50 rounded p-3 font-mono text-sm">
                <div>5' - {selectedEnzyme.recognition_sequence.toUpperCase()} - 3'</div>
                <div>3' - {selectedEnzyme.recognition_sequence.split('').reverse().map(c => {
                  switch(c.toUpperCase()) { case 'A': return 'T'; case 'T': return 'A'; case 'G': return 'C'; case 'C': return 'G'; default: return c; }
                }).join('')} - 5'</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[480px] shadow-xl">
            <h3 className="text-lg font-bold mb-4">{editingEnzyme ? '编辑酶' : '添加酶'}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-slate-600">名称 *</label>
                <input value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-600">来源物种 *</label>
                <input value={formData.source_organism} onChange={(e) => setFormData({...formData, source_organism: e.target.value})}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-600">识别序列 *</label>
                <input value={formData.recognition_sequence} onChange={(e) => setFormData({...formData, recognition_sequence: e.target.value.toUpperCase()})}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-sm font-medium text-slate-600">切割位置</label>
                  <input type="number" value={formData.cut_position} onChange={(e) => setFormData({...formData, cut_position: parseInt(e.target.value) || 0})}
                    className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium text-slate-600">最适温度 (°C)</label>
                  <input type="number" value={formData.optimal_temp} onChange={(e) => setFormData({...formData, optimal_temp: parseFloat(e.target.value) || 37})}
                    className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={formData.is_palindromic} onChange={(e) => setFormData({...formData, is_palindromic: e.target.checked})}
                  className="rounded" />
                回文序列
              </label>
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
