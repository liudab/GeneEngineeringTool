import { useState, useEffect } from 'react'
import { Search, Plus, Trash2, Edit2, X, Upload, Dna, Link2, FlaskConical } from 'lucide-react'
import type { Primer, PrimerCategory, PrimerAlignmentHit } from '../../shared/types'
import { useI18n } from '../hooks/useI18n'
import { useLifecycleLog, useModuleLogger } from '../hooks/useDebugLog'

type TabId = 'all' | 'universal' | 'lab'

export default function PrimerPage() {
  useLifecycleLog('PrimerPage')
  const log = useModuleLogger('PrimerPage')

  const { t } = useI18n()
  const [primers, setPrimers] = useState<Primer[]>([])
  const [activeTab, setActiveTab] = useState<TabId>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selected, setSelected] = useState<Primer | null>(null)
  const [alignmentHits, setAlignmentHits] = useState<PrimerAlignmentHit[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Primer | null>(null)
  const [formData, setFormData] = useState({
    name: '', sequence: '', category: 'lab' as PrimerCategory,
    description: '', target_gene_id: null as number | null,
    source: '', added_by: ''
  })

  const tabs: { id: TabId; label: string; icon: React.ReactNode; color: string }[] = [
    { id: 'all', label: t('primer.all'), icon: <Dna size={16} />, color: 'slate' },
    { id: 'universal', label: t('primer.universal'), icon: <FlaskConical size={16} />, color: 'blue' },
    { id: 'lab', label: t('primer.lab'), icon: <Link2 size={16} />, color: 'emerald' }
  ]

  useEffect(() => { loadPrimers() }, [activeTab])

  const loadPrimers = async () => {
    const cat = activeTab === 'all' ? undefined : activeTab
    log.info(`Loading primers (category=${cat || 'all'})...`)
    try {
      const data = await window.api.getPrimers(cat)
      log.info(`Loaded ${data.length} primers`)
      setPrimers(data)
    } catch (err) {
      log.error('Failed to load primers', err)
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) { loadPrimers(); return }
    const cat = activeTab === 'all' ? undefined : activeTab
    const data = await window.api.searchPrimers(searchQuery, cat)
    setPrimers(data)
  }

  const handleDelete = async (id: number) => {
    if (!confirm(t('dialog.confirmDelete'))) return
    log.info(`Deleting primer id=${id}`)
    await window.api.deletePrimer(id)
    loadPrimers()
    if (selected?.id === id) { setSelected(null); setAlignmentHits([]) }
  }

  const handleEdit = (p: Primer) => {
    setEditing(p)
    setFormData({
      name: p.name, sequence: p.sequence, category: p.category,
      description: p.description || '', target_gene_id: p.target_gene_id || null,
      source: p.source || '', added_by: p.added_by || ''
    })
    setShowForm(true)
  }

  const handleCreate = () => {
    setEditing(null)
    setFormData({
      name: '', sequence: '', category: activeTab === 'all' ? 'lab' : activeTab,
      description: '', target_gene_id: null, source: '用户添加', added_by: ''
    })
    setShowForm(true)
  }

  const handleSubmit = async () => {
    if (!formData.name || !formData.sequence) return
    if (editing) {
      await window.api.updatePrimer(editing.id, formData)
    } else {
      await window.api.createPrimer(formData)
    }
    setShowForm(false)
    loadPrimers()
  }

  const handleSelect = async (p: Primer) => {
    setSelected(p)
    if (p.alignment_result) {
      try { setAlignmentHits(JSON.parse(p.alignment_result)) } catch { setAlignmentHits([]) }
    } else if (p.category === 'lab') {
      const hits = await window.api.alignPrimer(p.id)
      setAlignmentHits(hits)
      // 重新加载以获取更新后的 alignment_result
      loadPrimers()
    } else {
      setAlignmentHits([])
    }
  }

  const handleImportXlsx = async () => {
    log.info('Importing primers from XLSX...')
    const count = await window.api.importPrimersFromXlsx()
    if (count > 0) {
      log.info(`Imported ${count} primers from XLSX`)
      alert(`${t('primer.imported')}${count}${t('primer.primers')}`)
      loadPrimers()
    } else {
      alert(t('primer.importNone'))
    }
  }

  const handleAlign = async () => {
    if (!selected || selected.category !== 'lab') return
    const hits = await window.api.alignPrimer(selected.id)
    setAlignmentHits(hits)
    loadPrimers()
    // 重新获取 selected
    const updated = await window.api.getPrimer(selected.id)
    if (updated) setSelected(updated)
  }

  const filtered = primers

  return (
    <div className="flex h-full gap-4">
      {/* 左侧列表 */}
      <div className="w-80 flex flex-col border-r border-slate-200 pr-4">
        {/* Tab 切换 */}
        <div className="flex gap-1 mb-3">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSelected(null) }}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-full transition-colors
                ${activeTab === tab.id ? `bg-${tab.color}-100 text-${tab.color}-700 font-medium` : 'text-slate-500 hover:bg-slate-100'}`}
            >
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        {/* 搜索 */}
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder={t('primer.searchPlaceholder')}
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <button onClick={handleCreate} className="p-1.5 bg-blue-500 text-white rounded hover:bg-blue-600" title={t('primer.addPrimer')}>
            <Plus size={14} />
          </button>
          {activeTab !== 'lab' && (
            <button onClick={handleImportXlsx} className="p-1.5 bg-green-500 text-white rounded hover:bg-green-600" title={t('primer.importXlsx')}>
              <Upload size={14} />
            </button>
          )}
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto space-y-1">
          {filtered.map(p => (
            <div
              key={p.id}
              onClick={() => handleSelect(p)}
              className={`p-2 rounded cursor-pointer text-sm transition-colors
                ${selected?.id === p.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50 border border-transparent'}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800 truncate">{p.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.category === 'universal' ? 'bg-blue-100 text-blue-600' : 'bg-emerald-100 text-emerald-600'}`}>
                  {p.category === 'universal' ? t('primer.universal') : t('primer.lab')}
                </span>
              </div>
              <div className="text-xs text-slate-500 font-mono mt-0.5 truncate">{p.sequence}</div>
              <div className="flex gap-3 text-[10px] text-slate-400 mt-0.5">
                {p.tm && <span>Tm: {p.tm}°C</span>}
                {p.gc_content && <span>GC: {p.gc_content}%</span>}
                {p.target_gene_id && <span className="text-emerald-500">● {t('primer.linked')}</span>}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-center text-slate-400 text-sm py-8">{t('primer.noPrimers')}</div>
          )}
        </div>
        <div className="text-xs text-slate-400 mt-2">{filtered.length} {t('primer.primers')}</div>
      </div>

      {/* 右侧详情 */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800">{selected.name}</h3>
              <div className="flex gap-2">
                {selected.category === 'lab' && (
                  <button onClick={handleAlign} className="px-3 py-1 text-xs bg-emerald-500 text-white rounded hover:bg-emerald-600">
                    {t('primer.align')}
                  </button>
                )}
                <button onClick={() => handleEdit(selected)} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded"><Edit2 size={14} /></button>
                <button onClick={() => handleDelete(selected.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
              </div>
            </div>

            {/* 基本信息 */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-slate-50 rounded p-3">
                <div className="text-xs text-slate-500 mb-1">{t('primer.sequence')}</div>
                <div className="font-mono text-blue-700 break-all">{selected.sequence}</div>
              </div>
              <div className="bg-slate-50 rounded p-3">
                <div className="text-xs text-slate-500 mb-1">{t('primer.category')}</div>
                <div>{selected.category === 'universal' ? t('primer.universal') : t('primer.lab')}</div>
              </div>
              {selected.tm != null && (
                <div className="bg-slate-50 rounded p-3">
                  <div className="text-xs text-slate-500 mb-1">{t('primer.tm')}</div>
                  <div>{selected.tm}°C</div>
                </div>
              )}
              {selected.gc_content != null && (
                <div className="bg-slate-50 rounded p-3">
                  <div className="text-xs text-slate-500 mb-1">{t('primer.gcContent')}</div>
                  <div>{selected.gc_content}%</div>
                </div>
              )}
              {selected.description && (
                <div className="bg-slate-50 rounded p-3 col-span-2">
                  <div className="text-xs text-slate-500 mb-1">{t('primer.description')}</div>
                  <div>{selected.description}</div>
                </div>
              )}
              {selected.source && (
                <div className="bg-slate-50 rounded p-3">
                  <div className="text-xs text-slate-500 mb-1">{t('primer.source')}</div>
                  <div>{selected.source}</div>
                </div>
              )}
              {selected.added_by && (
                <div className="bg-slate-50 rounded p-3">
                  <div className="text-xs text-slate-500 mb-1">{t('primer.addedBy')}</div>
                  <div>{selected.added_by}</div>
                </div>
              )}
              {selected.added_at && (
                <div className="bg-slate-50 rounded p-3">
                  <div className="text-xs text-slate-500 mb-1">{t('primer.addedAt')}</div>
                  <div>{selected.added_at}</div>
                </div>
              )}
            </div>

            {/* 序列比对结果 */}
            {alignmentHits.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1">
                  <Link2 size={14} className="text-emerald-500" />{t('primer.alignmentResults')}
                </h4>
                <div className="bg-white border rounded divide-y">
                  {alignmentHits.map((hit, i) => (
                    <div key={i} className="p-3 flex items-center gap-4 text-sm">
                      <span className="font-medium text-slate-800">{hit.gene_name}</span>
                      <span className="text-xs text-slate-500">{hit.strand === 1 ? t('primer.forward') : t('primer.reverse')}</span>
                      <span className="text-xs text-slate-500">{hit.match_start}-{hit.match_end}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${hit.identity === 100 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {hit.identity}% {t('primer.identity')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">{t('primer.selectPrimer')}</div>
        )}
      </div>

      {/* 新建/编辑表单 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-96 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">{editing ? t('primer.editPrimer') : t('primer.addPrimer')}</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div>
              <label className="text-xs text-slate-500">{t('primer.name')}</label>
              <input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full mt-1 px-3 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="text-xs text-slate-500">{t('primer.sequence')}</label>
              <textarea value={formData.sequence} onChange={e => setFormData({ ...formData, sequence: e.target.value.toUpperCase().replace(/[^ATGCNRYSWKMBDHV]/g, '') })}
                rows={3} className="w-full mt-1 px-3 py-1.5 text-sm border rounded font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="text-xs text-slate-500">{t('primer.category')}</label>
              <select value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value as PrimerCategory })}
                className="w-full mt-1 px-3 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-400">
                <option value="universal">{t('primer.universal')}</option>
                <option value="lab">{t('primer.lab')}</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500">{t('primer.description')}</label>
              <input value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })}
                className="w-full mt-1 px-3 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="text-xs text-slate-500">{t('primer.source')}</label>
              <input value={formData.source} onChange={e => setFormData({ ...formData, source: e.target.value })}
                placeholder="测序公司提供 / 用户添加"
                className="w-full mt-1 px-3 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="text-xs text-slate-500">{t('primer.addedBy')}</label>
              <input value={formData.added_by} onChange={e => setFormData({ ...formData, added_by: e.target.value })}
                placeholder="添加人名称"
                className="w-full mt-1 px-3 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded">{t('dialog.cancel')}</button>
              <button onClick={handleSubmit} className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600">{t('dialog.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
