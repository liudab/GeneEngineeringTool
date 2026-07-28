import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Search, Plus, Trash2, Edit2, X, Check, Database, ChevronDown, ChevronRight, Activity, RefreshCw, Square, CheckSquare, Download, Upload, Merge, Loader2, Tag } from 'lucide-react'
import type { VectorComponent, VectorComponentType, SimilarVariant, ComponentTag } from '../../shared/types'
import { COMPONENT_TAG_LABELS, COMPONENT_TAG_GROUPS } from '../../shared/types'
import { translateSequence } from '../engine/alignment/codonTable'

const TYPE_LABELS: Record<VectorComponentType, string> = {
  resistance: '抗性基因', CDS: '编码序列', promoter: '启动子',
  origin: '复制子', terminator: '终止子', enhancer: '增强子',
  reporter: '报告基因', tag: '标签序列', regulatory: '调控元件', other: '其他'
}

const TYPE_COLORS: Record<VectorComponentType, string> = {
  resistance: 'bg-red-100 text-red-700', CDS: 'bg-blue-100 text-blue-700',
  promoter: 'bg-amber-100 text-amber-700', origin: 'bg-violet-100 text-violet-700',
  terminator: 'bg-rose-100 text-rose-700', enhancer: 'bg-yellow-100 text-yellow-700',
  reporter: 'bg-emerald-100 text-emerald-700', tag: 'bg-cyan-100 text-cyan-700',
  regulatory: 'bg-orange-100 text-orange-700', other: 'bg-slate-100 text-slate-600'
}

interface FormData {
  sequence: string
  standard_name: string
  aliases: string
  type: VectorComponentType
  species: string
  notes: string
  amino_acid_sequence: string
  feature_id: string
  direction: string
  species_short: string
  species_latin: string
  species_cn: string
  taxonomic_category: string
  ref_protein_sequence: string
  molecular_weight: string
  product_description: string
  gene: string
  bound_moiety: string
  source_databases: string
  tags: string  // JSON ComponentTag[]
}

const emptyForm: FormData = {
  sequence: '', standard_name: '', aliases: '', type: 'other', species: '', notes: '', amino_acid_sequence: '',
  feature_id: '', direction: 'none', species_short: '', species_latin: '', species_cn: '',
  taxonomic_category: '', ref_protein_sequence: '', molecular_weight: '', product_description: '',
  gene: '', bound_moiety: '', source_databases: '', tags: '[]'
}

type SortMode = 'time-desc' | 'time-asc' | 'name'
const TYPE_ORDER: VectorComponentType[] = [
  'resistance', 'CDS', 'promoter', 'origin', 'terminator', 'reporter', 'tag', 'enhancer', 'regulatory', 'other'
]

/** 通用自动完成组合框：支持手动输入 + 模糊匹配 + 下拉选择 */
function AutoCombobox({ value, onChange, suggestions, placeholder, italic }: {
  value: string; onChange: (v: string) => void; suggestions: string[]; placeholder?: string; italic?: boolean
}) {
  const [filtered, setFiltered] = useState<string[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [focusIdx, setFocusIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!value.trim()) {
      setFiltered(suggestions.slice(0, 20))
    } else {
      const q = value.toLowerCase()
      setFiltered(suggestions.filter(s => s.toLowerCase().includes(q)).slice(0, 20))
    }
  }, [value, suggestions])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setFocusIdx(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setFocusIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && focusIdx >= 0 && filtered[focusIdx]) {
      e.preventDefault(); onChange(filtered[focusIdx]); setShowDropdown(false); setFocusIdx(-1)
    } else if (e.key === 'Escape') {
      setShowDropdown(false); setFocusIdx(-1)
    }
  }

  const handleFocus = () => { if (filtered.length > 0) setShowDropdown(true) }

  return (
    <div className="relative" onClick={e => e.stopPropagation()}>
      <input
        ref={inputRef}
        value={value}
        onChange={e => { onChange(e.target.value); setShowDropdown(true); setFocusIdx(-1) }}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        className={`w-full px-2 py-1 text-xs border border-slate-200 rounded ${italic ? 'italic' : ''}`}
        placeholder={placeholder}
      />
      {showDropdown && filtered.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-0.5 w-full min-w-[120px] max-h-32 overflow-y-auto bg-white border border-slate-200 rounded shadow-lg"
        >
          {filtered.map((s, i) => (
            <div
              key={s}
              className={`px-2 py-1 text-xs cursor-pointer ${i === focusIdx ? 'bg-violet-100 text-violet-800' : 'hover:bg-slate-50 text-slate-700'} ${italic ? 'italic' : ''}`}
              onMouseDown={e => { e.preventDefault(); onChange(s); setShowDropdown(false) }}
              onMouseEnter={() => setFocusIdx(i)}
            >
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 载体元件数据库管理面板 — 在 Settings 中提供隐藏入口 */
export default function ComponentDatabasePanel() {
  const [components, setComponents] = useState<VectorComponent[]>([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<VectorComponentType | ''>('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<FormData>(emptyForm)
  const [sortMode, setSortMode] = useState<SortMode>('time-desc')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [operating, setOperating] = useState(false)
  const [progress, setProgress] = useState<{ message: string; current: number; total: number } | null>(null)
  const [filterTags, setFilterTags] = useState<ComponentTag[]>([])

  // 物种自动完成候选列表（从已加载元件提取去重）
  const speciesShortOptions = useMemo(() => {
    const set = new Set<string>()
    components.forEach(c => { if (c.species_short) set.add(c.species_short) })
    return Array.from(set).sort()
  }, [components])
  const speciesLatinOptions = useMemo(() => {
    const set = new Set<string>()
    components.forEach(c => { if (c.species_latin) set.add(c.species_latin) })
    return Array.from(set).sort()
  }, [components])
  const speciesCnOptions = useMemo(() => {
    const set = new Set<string>()
    components.forEach(c => { if (c.species_cn) set.add(c.species_cn) })
    return Array.from(set).sort()
  }, [components])

  // 物种三字段联动映射：从已有元件构建 species_short ↔ species_latin ↔ species_cn 映射
  const speciesRecords = useMemo(() => {
    const map = new Map<string, { short: string; latin: string; cn: string }>()
    components.forEach(c => {
      const keys = [c.species_short, c.species_latin, c.species_cn].filter((v): v is string => !!v)
      for (const key of keys) {
        const existing = map.get(key.toLowerCase()) || { short: '', latin: '', cn: '' }
        if (c.species_short) existing.short = c.species_short
        if (c.species_latin) existing.latin = c.species_latin
        if (c.species_cn) existing.cn = c.species_cn
        map.set(key.toLowerCase(), existing)
      }
    })
    return map
  }, [components])

  // 常见抗性基因建议列表
  const resistanceSuggestions = useMemo(() => {
    const standard = [
      '氨苄青霉素(Ampicillin)', '卡那霉素(Kanamycin)', '氯霉素(Chloramphenicol)',
      '四环素(Tetracycline)', '壮观霉素(Spectinomycin)', '庆大霉素(Gentamicin)',
      '潮霉素(Hygromycin)', '嘌呤霉素(Puromycin)', '博来霉素(Zeocin)',
      '诺尔丝菌素(Nourseothricin)', '腐草霉素(Phleomycin)'
    ]
    const existing = new Set<string>()
    components.forEach(c => {
      if (c.type === 'resistance' && c.standard_name) existing.add(c.standard_name)
    })
    return [...new Set([...standard, ...existing])]
  }, [components])

  // Feature ID 校验：查找重复 + 计算建议 ID
  const featureIdDuplicate = useMemo(() => {
    if (!form.feature_id.trim()) return null
    const fid = form.feature_id.trim()
    const found = components.find(c => c.feature_id === fid && c.id !== editingId)
    return found || null
  }, [form.feature_id, components, editingId])
  const suggestedFeatureId = useMemo(() => {
    let maxNum = 0
    components.forEach(c => {
      if (c.feature_id) {
        const match = c.feature_id.match(/(\d+)$/)
        if (match) maxNum = Math.max(maxNum, parseInt(match[1]))
      }
    })
    const prefix = 'F'
    return `${prefix}${String(maxNum + 1).padStart(4, '0')}`
  }, [components])

  const load = useCallback(async () => {
    try {
      const data = search
        ? await window.api.searchComponents(search)
        : await window.api.getComponents()
      setComponents(data)
      // 清除已被删除记录的选择状态
      setSelected(prev => {
        const next = new Set<number>()
        for (const id of prev) {
          if (data.some((c: VectorComponent) => c.id === id)) next.add(id)
        }
        return next
      })
    } catch (e: any) {
      console.error('[ComponentDB] load failed:', e)
    }
  }, [search])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    let result = typeFilter
      ? components.filter(c => c.type === typeFilter)
      : components
    if (filterTags.length > 0) {
      result = result.filter(c => {
        try {
          const compTags: ComponentTag[] = JSON.parse((c as any).tags || '[]')
          return filterTags.some(ft => compTags.includes(ft))
        } catch { return false }
      })
    }
    return result
  }, [components, typeFilter, filterTags])

  // 排序
  const sorted = useMemo(() => {
    const arr = [...filtered]
    if (sortMode === 'time-desc') {
      arr.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    } else if (sortMode === 'time-asc') {
      arr.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    } else {
      arr.sort((a, b) => a.standard_name.localeCompare(b.standard_name))
    }
    return arr
  }, [filtered, sortMode])

  // 分组（仅名称排序时）
  const grouped = useMemo(() => {
    if (sortMode !== 'name') return null
    const groups = new Map<VectorComponentType, VectorComponent[]>()
    for (const c of sorted) {
      if (!groups.has(c.type)) groups.set(c.type, [])
      groups.get(c.type)!.push(c)
    }
    return groups
  }, [sorted, sortMode])

  const toggleGroup = (type: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type); else next.add(type)
      return next
    })
  }

  const handleSave = async () => {
    if (!form.standard_name.trim() || !form.sequence.trim()) {
      alert('标准名称和序列不能为空')
      return
    }
    // Feature ID 重复确认
    if (featureIdDuplicate && !editingId) {
      if (!confirm(`Feature ID "${form.feature_id}" 已被元件「${featureIdDuplicate.standard_name}」(ID: ${featureIdDuplicate.id}) 使用。\n\n确定要强行使用此 Feature ID 创建新元件吗？`)) return
    }
    if (featureIdDuplicate && editingId && featureIdDuplicate.id !== editingId) {
      if (!confirm(`Feature ID "${form.feature_id}" 已被元件「${featureIdDuplicate.standard_name}」(ID: ${featureIdDuplicate.id}) 使用。\n\n确定要强行覆盖此 Feature ID 吗？`)) return
    }
    const dna = form.sequence.toUpperCase().replace(/[^ATGC]/g, '')
    const payload = {
      ...form,
      standard_name: form.standard_name.trim(),
      sequence: dna,
      aliases: JSON.stringify(form.aliases.split(',').map(s => s.trim()).filter(Boolean)),
      amino_acid_sequence: ['CDS', 'tag', 'reporter', 'resistance'].includes(form.type)
        ? form.amino_acid_sequence.toUpperCase().replace(/[^A-Z*]/g, '')
        : '',
      ref_protein_sequence: form.ref_protein_sequence.toUpperCase().replace(/[^A-Z*]/g, ''),
      molecular_weight: parseFloat(form.molecular_weight) || 0,
      // species 与 species_short 同步
      species: form.species_short || form.species || '',
      variants: JSON.stringify([
        { variant_id: 'ref', seq_type: 'DNA', sequence: dna, length: dna.length, is_reference: true, sources: form.source_databases || '' },
        ...(form.ref_protein_sequence
          ? [{ variant_id: 'ref', seq_type: 'Protein', sequence: form.ref_protein_sequence.toUpperCase().replace(/[^A-Z*]/g, ''), length: form.ref_protein_sequence.length, is_reference: true, sources: form.source_databases || '' }]
          : [])
      ] as any[])
    }
    if (editingId) {
      await window.api.updateComponent(editingId, payload).catch((e: any) => { console.error('[ComponentDB] update failed:', e); alert('更新失败: ' + (e?.message || e)) })
    } else {
      await window.api.createComponent(payload).catch((e: any) => { console.error('[ComponentDB] create failed:', e); alert('创建失败: ' + (e?.message || e)) })
    }
    setShowForm(false)
    setEditingId(null)
    setForm(emptyForm)
    load()
  }

  const handleEdit = (c: VectorComponent) => {
    let aliases = ''
    try { aliases = (JSON.parse(c.aliases) as string[]).join(', ') } catch { aliases = c.aliases }
    setForm({
      sequence: c.sequence, standard_name: c.standard_name,
      aliases, type: c.type, species: c.species || c.species_short || '', notes: c.notes || '',
      amino_acid_sequence: c.amino_acid_sequence || '',
      feature_id: c.feature_id || '',
      direction: c.direction || 'none',
      species_short: c.species_short || '',
      species_latin: c.species_latin || '',
      species_cn: c.species_cn || '',
      taxonomic_category: c.taxonomic_category || '',
      ref_protein_sequence: c.ref_protein_sequence || '',
      molecular_weight: c.molecular_weight ? String(c.molecular_weight) : '',
      product_description: c.product_description || '',
      gene: c.gene || '',
      bound_moiety: c.bound_moiety || '',
      source_databases: c.source_databases || '',
      tags: (c as any).tags || '[]'
    })
    setEditingId(c.id)
    setShowForm(true)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此元件记录？')) return
    try { await window.api.deleteComponent(id); load() } catch (e: any) { alert('删除失败: ' + (e?.message || e)) }
  }

  const handleClearVariants = async (id: number) => {
    if (!confirm('确定清除此元件的所有相似变体关联记录？')) return
    try { await window.api.updateComponent(id, { similar_variants: '[]' }); load() } catch (e: any) { alert('清除失败: ' + (e?.message || e)) }
  }

  const handleBackfillSpecies = async () => {
    try {
      const count = await window.api.backfillComponentSpecies?.()
      if (count > 0) {
        alert(`已回填 ${count} 个元件的物种信息`)
        load()
      } else {
        alert('未找到可回填的物种数据\n\n提示：需要载体数据中包含 source feature 的 organism 信息')
      }
    } catch (e: any) { alert('回填物种失败: ' + (e?.message || e)) }
  }

  const handleDeduplicate = async () => {
    if (!confirm('去重将保留每个重复组中创建时间最早的一条，并删除其余记录。确定继续？')) return
    try {
      const result = await window.api.deduplicateComponents()
      alert(`去重完成：删除 ${result.deleted} 条，合并变体 ${result.merged} 条`)
      load()
    } catch (e: any) {
      alert(`去重失败: ${e?.message || String(e)}`)
    }
  }

  // 清理旧种子数据
  const handlePurgeSeedData = async () => {
    if (!confirm('此操作将删除所有通过旧版本自动播种机制导入的元件数据（约 1000 条）。\n\n已手动导入或编辑的元件不受影响。\n确定继续？')) return
    try {
      const result = await window.api.purgeSeedComponents()
      if (result > 0) {
        alert(`已清理 ${result} 条旧种子数据`)
        load()
      } else {
        alert('未发现需要清理的旧种子数据')
      }
    } catch (e: any) {
      alert(`清理失败: ${e?.message || String(e)}`)
    }
  }

  // 选择相关
  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(sorted.map(c => c.id)))
  const selectNone = () => setSelected(new Set())
  const selectFiltered = () => setSelected(new Set(filtered.map(c => c.id)))

  const allFilteredSelected = filtered.length > 0 && filtered.every(c => selected.has(c.id))

  // 批量删除
  const handleBatchDelete = async () => {
    if (selected.size === 0) { alert('请先选择要删除的元件'); return }
    if (!confirm(`确定删除选中的 ${selected.size} 个元件？此操作不可恢复。`)) return
    setOperating(true)
    setProgress({ message: '正在删除...', current: 0, total: selected.size })
    try {
      const ids = Array.from(selected)
      const result = await window.api.batchDeleteComponents(ids)
      setProgress({ message: '删除完成', current: result.deleted, total: ids.length })
      setTimeout(() => setProgress(null), 1500)
      load()
    } catch (e: any) {
      alert(`批量删除失败: ${e?.message || String(e)}`)
    } finally {
      setOperating(false)
    }
  }

  // 批量合并相似变体
  const handleMergeVariants = async () => {
    if (selected.size === 0) { alert('请先选择要合并的元件'); return }
    if (!confirm(`将对选中的 ${selected.size} 个元件按标准名称 + DNA 序列相似度（≥90%）合并相似变体，保留最早记录并删除重复项。确定继续？`)) return
    setOperating(true)
    setProgress({ message: '正在合并相似变体...', current: 0, total: selected.size })
    try {
      const ids = Array.from(selected)
      const result = await window.api.mergeComponentVariants(ids)
      setProgress({ message: '合并完成', current: result.deleted + result.kept, total: ids.length })
      setTimeout(() => setProgress(null), 1500)
      load()
      alert(`合并完成：保留 ${result.kept} 条，删除 ${result.deleted} 条，合并变体 ${result.merged} 条`)
    } catch (e: any) {
      alert(`合并失败: ${e?.message || String(e)}`)
    } finally {
      setOperating(false)
    }
  }

  // 批量导入文件
  const handleImportFiles = async () => {
    setOperating(true)
    setProgress({ message: '正在打开文件选择...', current: 0, total: 1 })
    try {
      const result = await window.api.importComponentFiles()
      if (result.success) {
        const { imported, skipped, linked, speciesFilled, failed } = result
        alert(`导入完成：新增 ${imported} 条，跳过 ${skipped} 条，关联 ${linked} 条，回填物种 ${speciesFilled} 条，失败 ${failed} 条`)
        load()
      }
    } catch (e: any) {
      alert(`导入失败: ${e?.message || String(e)}`)
    } finally {
      setOperating(false)
      setProgress(null)
    }
  }

  // 导出元件数据库为 JSON
  const handleExportJson = async () => {
    setOperating(true)
    setProgress({ message: '正在导出元件数据库...', current: 0, total: 1 })
    try {
      const result = await window.api.exportComponentsJson()
      if (result.success) {
        alert(result.message)
      } else if (result.message) {
        alert(result.message)
      }
    } catch (e: any) {
      alert(`导出失败: ${e?.message || String(e)}`)
    } finally {
      setOperating(false)
      setProgress(null)
    }
  }

  // 从 JSON 文件导入元件数据库
  const handleImportJson = async () => {
    setOperating(true)
    setProgress({ message: '正在导入元件数据库...', current: 0, total: 1 })
    try {
      const result = await window.api.importComponentsJson()
      if (result.success) {
        const { imported, skipped, failed } = result
        alert(`导入完成：新增 ${imported} 条，跳过 ${skipped} 条（已存在），失败 ${failed} 条`)
        load()
      } else if (result.message) {
        alert(result.message)
      }
    } catch (e: any) {
      alert(`导入失败: ${e?.message || String(e)}`)
    } finally {
      setOperating(false)
      setProgress(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* 标题 + 搜索 */}
      <div className="flex items-center gap-3">
        <Database size={18} className="text-violet-600" />
        <h3 className="text-sm font-bold text-slate-800">载体元件数据库</h3>
        <span className="text-xs text-slate-400">({filtered.length} 条记录)</span>
      </div>

      {/* 搜索与筛选行 */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索名称/别名/物种..."
            className="w-full pl-7 pr-3 py-1.5 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-violet-400 focus:border-violet-400"
          />
        </div>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as any)}
          className="px-2 py-1.5 text-xs border border-slate-200 rounded"
        >
          <option value="">全部类型</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={sortMode}
          onChange={e => setSortMode(e.target.value as SortMode)}
          className="px-2 py-1.5 text-xs border border-slate-200 rounded"
        >
          <option value="time-desc">最新优先</option>
          <option value="time-asc">最早优先</option>
          <option value="name">名称字母序</option>
        </select>
      </div>

      {/* 操作按钮行 */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => { setShowForm(true); setEditingId(null); setForm(emptyForm) }}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-violet-600 text-white rounded hover:bg-violet-500"
        >
          <Plus size={14} /> 添加元件
        </button>
        <button
          onClick={handleBackfillSpecies}
          className="flex items-center gap-1 px-2 py-1.5 text-xs border border-slate-200 rounded hover:bg-slate-50 text-slate-600"
          title="从已导入载体的 source feature 提取物种信息，回填到空物种元件"
        >
          <RefreshCw size={12} /> 回填物种
        </button>
        <button
          onClick={handleDeduplicate}
          className="flex items-center gap-1 px-2 py-1.5 text-xs border border-slate-200 rounded hover:bg-slate-50 text-slate-600"
          title="按标准名称 + 序列去重，保留最早记录并合并变体"
        >
          <Database size={12} /> 去重
        </button>
        <button
          onClick={handleImportFiles}
          disabled={operating}
          className="flex items-center gap-1 px-2 py-1.5 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100 disabled:opacity-50"
          title="从 GenBank/FASTA 文件批量导入元件"
        >
          <Download size={12} /> 批量导入
        </button>
        <button
          onClick={async () => {
            setOperating(true)
            try {
              const result = await (window.api as any).autoAnnotateComponents()
              alert(`自动标注完成：${result.count} 个元件已更新标签`)
              load()
            } catch (e: any) {
              alert(`标注失败: ${e?.message || String(e)}`)
            } finally {
              setOperating(false)
            }
          }}
          disabled={operating}
          className="flex items-center gap-1 px-2 py-1.5 text-xs bg-violet-50 text-violet-700 border border-violet-200 rounded hover:bg-violet-100 disabled:opacity-50"
          title="根据元件名称和注释自动添加功能标签"
        >
          <Tag size={12} /> 自动标注
        </button>
        <button
          onClick={handleImportJson}
          disabled={operating}
          className="flex items-center gap-1 px-2 py-1.5 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 disabled:opacity-50"
          title="从 JSON 文件导入元件数据库（自动去重）"
        >
          <Upload size={12} /> 导入JSON
        </button>
        <button
          onClick={handleExportJson}
          disabled={operating}
          className="flex items-center gap-1 px-2 py-1.5 text-xs bg-sky-50 text-sky-700 border border-sky-200 rounded hover:bg-sky-100 disabled:opacity-50"
          title="导出所有元件为 JSON 文件（可用于备份和迁移）"
        >
          <Download size={12} /> 导出JSON
        </button>
        <button
          onClick={handlePurgeSeedData}
          disabled={operating}
          className="flex items-center gap-1 px-2 py-1.5 text-xs border border-orange-200 rounded hover:bg-orange-50 text-orange-600 disabled:opacity-50"
          title="删除所有通过旧版本自动播种导入的元件数据"
        >
          <Trash2 size={12} /> 清理旧数据
        </button>
      </div>

      {/* 标签筛选 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-slate-500 font-medium">标签筛选:</span>
        {(Object.entries(COMPONENT_TAG_LABELS) as [ComponentTag, { zh: string; color: string }][]).map(([tag, label]) => {
          const isSelected = filterTags.includes(tag)
          return (
            <button
              key={tag}
              type="button"
              onClick={() => setFilterTags(prev => isSelected ? prev.filter(t => t !== tag) : [...prev, tag])}
              className={`px-2 py-0.5 text-[10px] rounded-full border transition-all ${
                isSelected
                  ? label.color + ' border-current font-medium'
                  : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
              }`}
            >
              {label.zh}
            </button>
          )
        })}
        {filterTags.length > 0 && (
          <button
            type="button"
            onClick={() => setFilterTags([])}
            className="px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-slate-600"
          >
            清除
          </button>
        )}
      </div>

      {/* 表单 */}
      {showForm && (
        <div className="border border-violet-200 rounded-lg p-3 bg-violet-50/50 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-violet-700">{editingId ? '编辑元件' : '新增元件'}</span>
            <button onClick={() => { setShowForm(false); setEditingId(null) }} className="text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2" onClick={e => e.stopPropagation()}>
            <div>
              <label className="text-[10px] text-slate-500">标准名称 *</label>
              <input value={form.standard_name} onChange={e => setForm(f => ({ ...f, standard_name: e.target.value }))}
                onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-violet-400" placeholder="如 AmpR, pUC ori" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500">Feature ID
                {featureIdDuplicate && <span className="text-red-500 ml-1">⚠ 重复</span>}
              </label>
              <input value={form.feature_id} onChange={e => setForm(f => ({ ...f, feature_id: e.target.value }))}
                onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                className={`w-full px-2 py-1 text-xs border rounded focus:ring-1 focus:ring-violet-400 ${featureIdDuplicate ? 'border-red-400 bg-red-50' : 'border-slate-200'}`}
                placeholder={`建议: ${suggestedFeatureId}`} />
              {featureIdDuplicate && (
                <div className="mt-0.5 text-[10px] text-red-600">
                  已存在: <span className="font-bold">{featureIdDuplicate.standard_name}</span> (ID: {featureIdDuplicate.id})
                </div>
              )}
              {!form.feature_id.trim() && !editingId && (
                <button type="button" onClick={() => setForm(f => ({ ...f, feature_id: suggestedFeatureId }))}
                  className="mt-0.5 text-[10px] text-violet-600 hover:text-violet-800">
                  使用建议: {suggestedFeatureId} (已有 {components.length} 个元件)
                </button>
              )}
            </div>
            <div>
              <label className="text-[10px] text-slate-500">类型</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as any }))}
                onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                className="w-full px-2 py-1 text-xs border border-slate-200 rounded">
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="col-span-3">
              <label className="text-[10px] text-slate-500">功能标签（点击选择/取消）</label>
              {(() => {
                const currentTags: ComponentTag[] = JSON.parse(form.tags || '[]')
                return (
                  <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
                    {COMPONENT_TAG_GROUPS.map(group => (
                      <details key={group.label} open className="group">
                        <summary className="text-[10px] font-medium text-slate-600 cursor-pointer select-none hover:text-slate-800">
                          {group.label} <span className="text-slate-400 font-normal">({group.tags.filter(t => currentTags.includes(t)).length}/{group.tags.length})</span>
                        </summary>
                        <div className="flex flex-wrap gap-1 mt-1 ml-2">
                          {group.tags.map(tag => {
                            const label = COMPONENT_TAG_LABELS[tag]
                            const isSelected = currentTags.includes(tag)
                            return (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => {
                                  const tags: ComponentTag[] = JSON.parse(form.tags || '[]')
                                  const newTags = isSelected ? tags.filter(t => t !== tag) : [...tags, tag]
                                  setForm(prev => ({ ...prev, tags: JSON.stringify(newTags) }))
                                }}
                                className={`px-2 py-0.5 text-[10px] rounded-full border transition-all ${
                                  isSelected
                                    ? label.color + ' border-current font-medium'
                                    : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                                }`}
                              >
                                {label.zh}
                              </button>
                            )
                          })}
                        </div>
                      </details>
                    ))}
                  </div>
                )
              })()}
            </div>
            <div>
              <label className="text-[10px] text-slate-500">方向</label>
              <select value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value }))}
                onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                className="w-full px-2 py-1 text-xs border border-slate-200 rounded">
                <option value="none">无</option>
                <option value="forward">正向</option>
                <option value="reverse">反向</option>
                <option value="bidirectional">双向</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500">别名 (逗号分隔)</label>
              <input value={form.aliases} onChange={e => setForm(f => ({ ...f, aliases: e.target.value }))}
                onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                className="w-full px-2 py-1 text-xs border border-slate-200 rounded" placeholder="如 β-lactamase,bla" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500">物种来源 (Short)</label>
              <AutoCombobox value={form.species_short}
                onChange={v => {
                  const rec = speciesRecords.get(v.toLowerCase())
                  setForm(f => ({
                    ...f, species_short: v, species: v,
                    ...(rec?.latin ? { species_latin: rec.latin } : {}),
                    ...(rec?.cn ? { species_cn: rec.cn } : {})
                  }))
                }}
                suggestions={speciesShortOptions} placeholder="如 E. coli" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500">拉丁名 <span className="italic text-slate-400">(斜体)</span></label>
              <AutoCombobox value={form.species_latin}
                onChange={v => {
                  const rec = speciesRecords.get(v.toLowerCase())
                  setForm(f => ({
                    ...f, species_latin: v,
                    ...(rec?.short ? { species_short: rec.short, species: rec.short } : {}),
                    ...(rec?.cn ? { species_cn: rec.cn } : {})
                  }))
                }}
                suggestions={speciesLatinOptions} placeholder="Escherichia coli" italic />
            </div>
            <div>
              <label className="text-[10px] text-slate-500">中文名</label>
              <AutoCombobox value={form.species_cn}
                onChange={v => {
                  const rec = speciesRecords.get(v.toLowerCase())
                  setForm(f => ({
                    ...f, species_cn: v,
                    ...(rec?.short ? { species_short: rec.short, species: rec.short } : {}),
                    ...(rec?.latin ? { species_latin: rec.latin } : {})
                  }))
                }}
                suggestions={speciesCnOptions} placeholder="大肠杆菌" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500">分类类别</label>
              <select value={form.taxonomic_category} onChange={e => setForm(f => ({ ...f, taxonomic_category: e.target.value }))}
                onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                className="w-full px-2 py-1 text-xs border border-slate-200 rounded">
                <option value="">请选择</option>
                <option value="Bacteria">细菌 (Bacteria)</option>
                <option value="Eukaryota">真核生物 (Eukaryota)</option>
                <option value="Virus">病毒 (Virus)</option>
                <option value="Archaea">古菌 (Archaea)</option>
                <option value="Synthetic">人工合成 (Synthetic)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500">来源数据库</label>
              <input value={form.source_databases} onChange={e => setForm(f => ({ ...f, source_databases: e.target.value }))}
                onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                className="w-full px-2 py-1 text-xs border border-slate-200 rounded" placeholder="CommonFeatures; PlasmidFeatures" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500">关联基因</label>
              <input value={form.gene} onChange={e => setForm(f => ({ ...f, gene: e.target.value }))}
                onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                className="w-full px-2 py-1 text-xs border border-slate-200 rounded" placeholder="bla" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500">结合分子</label>
              <input value={form.bound_moiety} onChange={e => setForm(f => ({ ...f, bound_moiety: e.target.value }))}
                onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                className="w-full px-2 py-1 text-xs border border-slate-200 rounded" placeholder="Cre recombinase" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500">分子量 (Da)</label>
              <input value={form.molecular_weight} onChange={e => setForm(f => ({ ...f, molecular_weight: e.target.value }))}
                onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                className="w-full px-2 py-1 text-xs border border-slate-200 rounded" placeholder="31676.23" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-slate-500">DNA 序列 *</label>
            <textarea value={form.sequence} onChange={e => setForm(f => ({ ...f, sequence: e.target.value }))}
              onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
              className="w-full px-2 py-1 text-xs border border-slate-200 rounded font-mono h-16 resize-y"
              placeholder="ATGC..." />
            <span className="text-[10px] text-slate-400">{form.sequence.replace(/[^ATGCatgc]/g, '').length} bp</span>
          </div>
          <div>
            <label className="text-[10px] text-slate-500">参考蛋白序列</label>
            <textarea value={form.ref_protein_sequence} onChange={e => setForm(f => ({ ...f, ref_protein_sequence: e.target.value }))}
              onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
              className="w-full px-2 py-1 text-xs border border-slate-200 rounded font-mono h-12 resize-y"
              placeholder="蛋白序列..." />
            <span className="text-[10px] text-slate-400">{form.ref_protein_sequence.length} aa</span>
          </div>
          <div>
            <label className="text-[10px] text-slate-500">功能描述</label>
            <textarea value={form.product_description} onChange={e => setForm(f => ({ ...f, product_description: e.target.value }))}
              onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
              className="w-full px-2 py-1 text-xs border border-slate-200 rounded h-16 resize-y"
              placeholder="功能描述 / Product / Description" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500">备注</label>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
              className="w-full px-2 py-1 text-xs border border-slate-200 rounded" />
          </div>
          {/* 氨基酸序列（蛋白表达相关类型时显示） */}
          {['CDS', 'tag', 'reporter', 'resistance'].includes(form.type) && (
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-[10px] text-slate-500">氨基酸序列 <span className="text-slate-400">(可手动编辑)</span></label>
                <button
                  type="button"
                  disabled={!form.sequence.trim()}
                  onClick={() => {
                    const dna = form.sequence.toUpperCase().replace(/[^ATGC]/g, '')
                    if (!dna) return
                    const aa = translateSequence(dna, 0)
                    setForm(f => ({ ...f, amino_acid_sequence: aa }))
                  }}
                  className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-violet-50 text-violet-700 rounded border border-violet-200 hover:bg-violet-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Activity size={10} /> 翻译
                </button>
              </div>
              <textarea value={form.amino_acid_sequence} onChange={e => setForm(f => ({ ...f, amino_acid_sequence: e.target.value }))}
                onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                className="w-full px-2 py-1 text-xs border border-slate-200 rounded font-mono h-12 resize-y"
                placeholder="点击「翻译」按钮从 DNA 序列翻译，或手动输入..." />
              <span className="text-[10px] text-slate-400">{form.amino_acid_sequence.length} aa</span>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowForm(false); setEditingId(null) }}
              className="px-3 py-1 text-xs text-slate-500 border border-slate-200 rounded hover:bg-slate-50">取消</button>
            <button onClick={handleSave}
              className="flex items-center gap-1 px-3 py-1 text-xs bg-violet-600 text-white rounded hover:bg-violet-500">
              <Check size={12} /> 保存
            </button>
          </div>
        </div>
      )}

      {/* 批量操作工具栏 */}
      <div className="flex items-center gap-2">
        <button
          onClick={allFilteredSelected ? selectNone : selectFiltered}
          disabled={operating || filtered.length === 0}
          className="flex items-center gap-1 px-2 py-1.5 text-xs border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-50"
          title={allFilteredSelected ? '取消全选' : '选择当前筛选结果'}
        >
          {allFilteredSelected ? <CheckSquare size={12} /> : <Square size={12} />}
          {allFilteredSelected ? '取消全选' : '全选筛选'}
        </button>
        <span className="text-xs text-slate-500">已选 {selected.size} / {filtered.length}</span>
        <div className="flex-1" />
        <button
          onClick={handleBatchDelete}
          disabled={operating || selected.size === 0}
          className="flex items-center gap-1 px-2 py-1.5 text-xs bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 disabled:opacity-50"
        >
          <Trash2 size={12} /> 删除选中
        </button>
        <button
          onClick={handleMergeVariants}
          disabled={operating || selected.size === 0}
          className="flex items-center gap-1 px-2 py-1.5 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 disabled:opacity-50"
        >
          <Merge size={12} /> 合并相似变体
        </button>
      </div>

      {/* 进度提示 */}
      {progress && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded">
          {operating && <Loader2 size={12} className="animate-spin text-violet-600" />}
          <span className="text-slate-700">{progress.message}</span>
          {progress.total > 0 && (
            <span className="text-slate-400">({progress.current}/{progress.total})</span>
          )}
        </div>
      )}

      {/* 列表 */}
      <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
        {sorted.length === 0 && (
          <div className="py-8 text-center text-xs text-slate-400">暂无元件记录</div>
        )}
        {/* 分组模式（名称排序时） */}
        {grouped && sorted.length > 0 && TYPE_ORDER.filter(t => grouped.has(t)).map(type => {
          const items = grouped.get(type)!
          const collapsed = collapsedGroups.has(type)
          return (
            <div key={type}>
              <div
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 cursor-pointer select-none sticky top-0 z-10"
                onClick={() => toggleGroup(type)}
              >
                {collapsed ? <ChevronRight size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TYPE_COLORS[type]}`}>{TYPE_LABELS[type]}</span>
                <span className="text-[10px] text-slate-400">({items.length})</span>
              </div>
              {!collapsed && items.map(c => <ComponentRow key={c.id} c={c} selected={selected.has(c.id)} onToggleSelect={() => toggleSelect(c.id)} onEdit={handleEdit} onDelete={handleDelete} onClearVariants={handleClearVariants} />)}
            </div>
          )
        })}
        {/* 平铺模式（时间排序时） */}
        {!grouped && sorted.map(c => <ComponentRow key={c.id} c={c} selected={selected.has(c.id)} onToggleSelect={() => toggleSelect(c.id)} onEdit={handleEdit} onDelete={handleDelete} onClearVariants={handleClearVariants} />)}
      </div>
    </div>
  )
}

/** 分类类别颜色 */
const TAXONOMY_COLORS: Record<string, string> = {
  Bacteria: 'bg-blue-50 text-blue-700',
  Eukaryota: 'bg-emerald-50 text-emerald-700',
  Virus: 'bg-rose-50 text-rose-700',
  Archaea: 'bg-amber-50 text-amber-700',
  Synthetic: 'bg-slate-100 text-slate-600',
  Fungi: 'bg-purple-50 text-purple-700',
  Mammalia: 'bg-pink-50 text-pink-700',
  Insecta: 'bg-lime-50 text-lime-700',
  Platyhelminthes: 'bg-teal-50 text-teal-700',
  Cnidaria: 'bg-cyan-50 text-cyan-700'
}

/** 元件列表行组件 */
function ComponentRow({ c, selected, onToggleSelect, onEdit, onDelete, onClearVariants }: {
  c: VectorComponent
  selected: boolean
  onToggleSelect: () => void
  onEdit: (c: VectorComponent) => void
  onDelete: (id: number) => void
  onClearVariants: (id: number) => void
}) {
  let aliases: string[] = []
  try { aliases = JSON.parse(c.aliases) } catch { aliases = [] }
  let variants: SimilarVariant[] = []
  try { variants = JSON.parse(c.similar_variants || '[]') } catch { variants = [] }
  return (
    <div className="px-3 py-2 hover:bg-slate-50 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-3.5 w-3.5 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
        />
        <span className="font-bold text-slate-800">{c.standard_name}</span>
        {c.feature_id && <span className="text-[10px] text-slate-400 font-mono">{c.feature_id}</span>}
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TYPE_COLORS[c.type]}`}>
          {TYPE_LABELS[c.type]}
        </span>
        {/* 标签 chips */}
        {(() => {
          try {
            const tags: ComponentTag[] = JSON.parse((c as any).tags || '[]')
            return tags.map(tag => {
              const label = COMPONENT_TAG_LABELS[tag]
              if (!label) return null
              return (
                <span key={tag} className={`px-1.5 py-0.5 text-[10px] rounded ${label.color}`}>
                  {label.zh}
                </span>
              )
            })
          } catch { return null }
        })()}
        {c.taxonomic_category && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TAXONOMY_COLORS[c.taxonomic_category] || 'bg-slate-100 text-slate-600'}`}>
            {c.taxonomic_category}
          </span>
        )}
        {c.species && <span className="text-slate-500 text-[10px]">{c.species}</span>}
        {c.species_cn && <span className="text-slate-400 text-[10px]">{c.species_cn}</span>}
        <span className="ml-auto text-slate-400 text-[10px] font-mono">{c.sequence.length} bp</span>
        <button onClick={() => onEdit(c)} className="text-slate-400 hover:text-violet-600"><Edit2 size={12} /></button>
        <button onClick={() => onDelete(c.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={12} /></button>
      </div>
      {aliases.length > 0 && (
        <div className="mt-0.5 text-[10px] text-slate-400">别名: {aliases.join(', ')}</div>
      )}
      {c.product_description && (
        <div className="mt-0.5 text-[10px] text-slate-500 truncate" title={c.product_description}>{c.product_description}</div>
      )}
      {c.notes && (
        <div className="mt-0.5 text-[10px] text-slate-400 italic">{c.notes}</div>
      )}
      {c.amino_acid_sequence && (
        <div className="mt-0.5 text-[10px] text-purple-500 font-mono truncate" title={c.amino_acid_sequence}>
          AA: {c.amino_acid_sequence.substring(0, 40)}{c.amino_acid_sequence.length > 40 ? '...' : ''} ({c.amino_acid_sequence.length} aa)
        </div>
      )}
      {c.source_databases && (
        <div className="mt-0.5 text-[10px] text-slate-400">来源: {c.source_databases}</div>
      )}
      {variants.length > 0 && (
        <SimilarVariantsSection componentId={c.id} variants={variants} onClear={() => onClearVariants(c.id)} />
      )}
    </div>
  )
}

/** 相似变体折叠显示组件 */
function SimilarVariantsSection({ variants, onClear }: { componentId: number; variants: SimilarVariant[]; onClear: () => void }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="mt-1 border border-amber-200 rounded bg-amber-50/50">
      <div className="flex items-center gap-1 px-1.5 py-0.5 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        {expanded ? <ChevronDown size={10} className="text-amber-600" /> : <ChevronRight size={10} className="text-amber-600" />}
        <span className="text-[10px] font-medium text-amber-700">相似变体 ({variants.length})</span>
        <button
          onClick={e => { e.stopPropagation(); onClear() }}
          className="ml-auto text-[10px] text-amber-500 hover:text-red-500"
          title="清除所有关联记录"
        >
          清除
        </button>
      </div>
      {expanded && (
        <div className="px-1.5 pb-1 space-y-0.5">
          {variants.map((v, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px] text-slate-600 flex-wrap">
              <span className="font-medium text-amber-700">{v.name}</span>
              <span className="px-1 py-0 bg-amber-100 rounded">相似度 {v.identity}%</span>
              <span>{v.length_new}bp vs {v.length_existing}bp (差异 {v.length_diff_pct}%)</span>
              <span className="text-slate-400">来源: {v.source_vector}</span>
              <span className="text-slate-300 text-[9px]">{v.detected_at}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
