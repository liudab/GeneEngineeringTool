import { memo, useState, useCallback } from 'react'
import { Sparkles, Pencil, Trash2, X, Info, Check } from 'lucide-react'
import type { GenBankFeature, ComponentTag } from '../../shared/types'
import { COMPONENT_TAG_LABELS, COMPONENT_TAG_GROUPS } from '../../shared/types'
import { featureTypeName } from './SequenceEditor/SequenceEditor'

/** 组件类型 → GenBank 特征类型映射 */
const COMP_TYPE_TO_GB: Record<string, string> = {
  resistance: 'gene', CDS: 'CDS', promoter: 'promoter',
  origin: 'rep_origin', terminator: 'terminator', enhancer: 'enhancer',
  reporter: 'CDS', tag: 'CDS', regulatory: 'regulatory', other: 'misc_feature'
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="text-[10px] text-slate-500 uppercase">{label}</label>
      <p className="text-slate-700 break-all">{value}</p>
    </div>
  )
}

function getColor(type: string): string {
  const colors: Record<string, string> = {
    gene: '#10b981', CDS: '#3b82f6', mRNA: '#06b6d4', promoter: '#f59e0b',
    terminator: '#ef4444', rep_origin: '#8b5cf6', misc_feature: '#94a3b8',
    primer_bind: '#ec4899', protein_bind: '#6366f1', regulatory: '#f97316',
    enhancer: '#fbbf24', exon: '#14b8a6', intron: '#a3a3a3',
    five_prime_UTR: '#84cc16', three_prime_UTR: '#e879f9',
    sig_peptide: '#f97316', polyA_signal: '#eab308',
    STS: '#64748b', ncRNA: '#06b6d4', misc_RNA: '#06b6d4',
    misc_binding: '#64748b', misc_difference: '#94a3b8',
    misc_recomb: '#8b5cf6', source: '#9ca3af',
    ori: '#8b5cf6', antibiotic_resistance: '#ef4444'
  }
  return colors[type] || '#cbd5e1'
}

interface Props {
  features: GenBankFeature[]
  selectedFeature: number | null
  hoveredFeature: number | null
  width: number
  sequence: string
  dragFeatureIdx: number | null
  // i18n labels
  labels: {
    featureDetail: string
    featureList: string
    noFeatures: string
    deleteFeature: string
    featureType: string
    featurePosition: string
    featureLength: string
    featureStrand: string
    featureLocation: string
    featureSequence: string
    strandForward: string
    strandReverse: string
  }
  // 回调
  onSelectFeature: (i: number | null) => void
  onMapSelect: (i: number) => void
  onHoverFeature: (i: number | null) => void
  onDeleteFeature: (i: number) => void
  onDragStart: (i: number) => void
  onReorder: (from: number, to: number) => void
  onDragEnd: () => void
  onUpdateFeatures: (updater: (prev: GenBankFeature[]) => GenBankFeature[]) => void
  onMarkDirty: () => void
}

/** 右侧元件详情/列表面板 — memo 隔离，与图谱区域渲染互不影响 */
const FeatureDetailPanel = memo(function FeatureDetailPanel({
  features, selectedFeature, hoveredFeature, width, sequence, dragFeatureIdx,
  labels, onSelectFeature, onMapSelect, onHoverFeature, onDeleteFeature,
  onDragStart, onReorder, onDragEnd, onUpdateFeatures, onMarkDirty
}: Props) {
  // 内部编辑状态（不污染父组件）
  const [editingFeature, setEditingFeature] = useState(false)
  const [editForm, setEditForm] = useState({
    label: '', type: '', note: '', product: '', db_xref: '',
    normalized_type: '', species: '', tags: '[]', direction: 'none'
  })
  const [showIdentify, setShowIdentify] = useState(false)
  const [identifyLoading, setIdentifyLoading] = useState(false)
  const [identifyResults, setIdentifyResults] = useState<Array<{ component_id: number; standard_name: string; component_type: string; species: string; identity: number; match_type: string }>>([])

  const selectedFeat = selectedFeature !== null ? features[selectedFeature] : null

  const handleIdentify = useCallback(async () => {
    if (!sequence || !selectedFeat) return
    const seq = sequence.substring(selectedFeat.start, selectedFeat.end + 1)
    if (seq.length < 10) { alert('元件序列太短，无法识别'); return }
    setIdentifyLoading(true)
    setShowIdentify(true)
    try {
      const results = await (window as any).api.identifyFeatureSequence?.(seq)
      setIdentifyResults(results || [])
    } catch (e: any) {
      console.error('[Identify] Failed:', e)
      setIdentifyResults([])
    } finally {
      setIdentifyLoading(false)
    }
  }, [sequence, selectedFeat])

  const handleStartEdit = useCallback(() => {
    if (!selectedFeat) return
    setEditForm({
      label: selectedFeat.qualifiers.label || selectedFeat.qualifiers.gene || selectedFeat.qualifiers.product || '',
      type: selectedFeat.type,
      note: selectedFeat.qualifiers.note || '',
      product: selectedFeat.qualifiers.product || '',
      db_xref: selectedFeat.qualifiers.db_xref || '',
      normalized_type: selectedFeat.qualifiers.normalized_type || '',
      species: selectedFeat.qualifiers.species || '',
      tags: selectedFeat.qualifiers.tags || '[]',
      direction: selectedFeat.qualifiers.direction || 'none',
    })
    setEditingFeature(true)
  }, [selectedFeat])

  const handleSaveEdit = useCallback(() => {
    if (selectedFeature === null) return
    onUpdateFeatures(prev => {
      const updated = [...prev]
      const f = { ...updated[selectedFeature] }
      f.type = editForm.type
      f.qualifiers = { ...f.qualifiers, label: editForm.label }
      if (editForm.note) f.qualifiers.note = editForm.note; else delete f.qualifiers.note
      if (editForm.product) f.qualifiers.product = editForm.product; else delete f.qualifiers.product
      if (editForm.db_xref) f.qualifiers.db_xref = editForm.db_xref; else delete f.qualifiers.db_xref
      if (editForm.normalized_type) f.qualifiers.normalized_type = editForm.normalized_type; else delete f.qualifiers.normalized_type
      if (editForm.species) f.qualifiers.species = editForm.species; else delete f.qualifiers.species
      if (editForm.tags && editForm.tags !== '[]') f.qualifiers.tags = editForm.tags; else delete f.qualifiers.tags
      if (editForm.direction && editForm.direction !== 'none') f.qualifiers.direction = editForm.direction; else delete f.qualifiers.direction
      updated[selectedFeature] = f
      return updated
    })
    onMarkDirty()
    setEditingFeature(false)
  }, [selectedFeature, editForm, onUpdateFeatures, onMarkDirty])

  const handleAdoptIdentify = useCallback((r: { standard_name: string; component_type: string; species: string }) => {
    if (selectedFeature === null) return
    const gbType = COMP_TYPE_TO_GB[r.component_type] || r.component_type
    onUpdateFeatures(prev => {
      const updated = [...prev]
      const f = { ...updated[selectedFeature] }
      f.type = gbType
      f.qualifiers = { ...f.qualifiers, label: r.standard_name, normalized_type: r.component_type }
      if (r.species) f.qualifiers.species = r.species
      updated[selectedFeature] = f
      return updated
    })
    onMarkDirty()
    setShowIdentify(false)
  }, [selectedFeature, onUpdateFeatures, onMarkDirty])

  const handleClose = useCallback(() => {
    onSelectFeature(null)
    setEditingFeature(false)
    setShowIdentify(false)
  }, [onSelectFeature])

  return (
    <aside data-feature-pane className="bg-white border-l border-slate-200 flex flex-col flex-shrink-0 overflow-hidden"
      style={{ width: `${width}px` }}>
      {selectedFeat && selectedFeature !== null ? (
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
            <h3 className="text-xs font-bold text-slate-700">{labels.featureDetail}</h3>
            <div className="flex items-center gap-1">
              {!editingFeature && (
                <button onClick={handleIdentify} className="p-1 text-emerald-500 hover:text-emerald-700" title="智能识别">
                  <Sparkles size={12} />
                </button>
              )}
              {!editingFeature && (
                <button onClick={handleStartEdit} className="p-1 text-blue-400 hover:text-blue-600" title="编辑元件">
                  <Pencil size={12} />
                </button>
              )}
              <button onClick={() => onDeleteFeature(selectedFeature)}
                className="p-1 text-red-400 hover:text-red-600" title={labels.deleteFeature}>
                <Trash2 size={12} />
              </button>
              <button onClick={handleClose}
                className="p-1 text-slate-400 hover:text-slate-600"><X size={12} /></button>
            </div>
          </div>
          <div className="flex-1 overflow-auto px-3 py-2 space-y-2 text-xs" onClick={e => e.stopPropagation()}>
            {editingFeature ? (
              <>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase block mb-0.5">名称 (label)</label>
                  <input value={editForm.label} onChange={e => setEditForm({ ...editForm, label: e.target.value })}
                    onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                    className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-violet-400" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase block mb-0.5">元件类型</label>
                  <select value={editForm.type} onChange={e => setEditForm({ ...editForm, type: e.target.value })}
                    onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                    className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-violet-400">
                    {['gene','CDS','mRNA','promoter','rep_origin','terminator','enhancer','regulatory','misc_feature','primer_bind','protein_bind','source','exon','intron','five_prime_UTR','three_prime_UTR'].map(tp => (
                      <option key={tp} value={tp}>{tp}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase block mb-0.5">规范化类型</label>
                  <select value={editForm.normalized_type} onChange={e => setEditForm({ ...editForm, normalized_type: e.target.value })}
                    onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                    className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-violet-400">
                    <option value="">未指定</option>
                    {Object.entries({ resistance: '抗性基因', CDS: '编码序列', promoter: '启动子', origin: '复制子', terminator: '终止子', reporter: '报告基因', tag: '标签序列', regulatory: '调控元件', enhancer: '增强子', other: '其他' }).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase block mb-0.5">物种</label>
                  <input value={editForm.species} onChange={e => setEditForm({ ...editForm, species: e.target.value })}
                    onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                    placeholder="如：大肠杆菌、酿酒酵母、人工合成"
                    className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-violet-400" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase block mb-0.5">方向</label>
                  <select value={editForm.direction} onChange={e => setEditForm({ ...editForm, direction: e.target.value })}
                    onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                    className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-violet-400">
                    <option value="none">无</option>
                    <option value="forward">正向</option>
                    <option value="reverse">反向</option>
                    <option value="bidirectional">双向</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase block mb-0.5">功能标签</label>
                  {(() => {
                    const currentTags: ComponentTag[] = JSON.parse(editForm.tags || '[]')
                    return (
                      <div className="space-y-1 max-h-[160px] overflow-y-auto pr-1">
                        {COMPONENT_TAG_GROUPS.map(group => (
                          <details key={group.label} className="group">
                            <summary className="text-[9px] font-medium text-slate-500 cursor-pointer select-none hover:text-slate-700">
                              {group.label} <span className="text-slate-400 font-normal">({group.tags.filter(t => currentTags.includes(t)).length})</span>
                            </summary>
                            <div className="flex flex-wrap gap-1 mt-0.5 ml-2">
                              {group.tags.map(tag => {
                                const label = COMPONENT_TAG_LABELS[tag]
                                const isSelected = currentTags.includes(tag)
                                return (
                                  <button key={tag} type="button"
                                    onClick={() => {
                                      const tags: ComponentTag[] = JSON.parse(editForm.tags || '[]')
                                      const newTags = isSelected ? tags.filter(t => t !== tag) : [...tags, tag]
                                      setEditForm(prev => ({ ...prev, tags: JSON.stringify(newTags) }))
                                    }}
                                    className={`px-1.5 py-0.5 text-[9px] rounded-full border transition-all ${
                                      isSelected ? label.color + ' border-current font-medium' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                                    }`}>
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
                  <label className="text-[10px] text-slate-500 uppercase block mb-0.5">备注 (note)</label>
                  <textarea value={editForm.note} onChange={e => setEditForm({ ...editForm, note: e.target.value })} rows={2}
                    onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                    className="w-full px-2 py-1 text-xs border border-slate-200 rounded resize-none focus:outline-none focus:border-violet-400" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase block mb-0.5">product</label>
                  <input value={editForm.product} onChange={e => setEditForm({ ...editForm, product: e.target.value })}
                    onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                    className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-violet-400" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase block mb-0.5">db_xref</label>
                  <input value={editForm.db_xref} onChange={e => setEditForm({ ...editForm, db_xref: e.target.value })}
                    onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                    placeholder="如：UniProt:P12345、NCBI:NP_123456"
                    className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-violet-400" />
                </div>
                <DetailRow label={labels.featurePosition} value={`${selectedFeat.start + 1}..${selectedFeat.end + 1}`} />
                <DetailRow label={labels.featureLength} value={`${selectedFeat.end - selectedFeat.start + 1} bp`} />
                <DetailRow label={labels.featureStrand} value={selectedFeat.strand === 1 ? labels.strandForward : labels.strandReverse} />
                <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                  <button onClick={handleSaveEdit}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs bg-violet-600 text-white rounded hover:bg-violet-700">
                    <Check size={11} /> 保存
                  </button>
                  <button onClick={() => setEditingFeature(false)}
                    className="px-2.5 py-1 text-xs text-slate-500 border border-slate-200 rounded hover:bg-slate-50">取消</button>
                </div>
              </>
            ) : (
              <>
                <DetailRow label={labels.featureType} value={featureTypeName(selectedFeat.type)} />
                {selectedFeat.qualifiers.normalized_type && (
                  <DetailRow label="规范化类型" value={COMPONENT_TAG_LABELS[selectedFeat.qualifiers.normalized_type as ComponentTag]?.zh || selectedFeat.qualifiers.normalized_type} />
                )}
                <DetailRow label={labels.featurePosition} value={`${selectedFeat.start + 1}..${selectedFeat.end + 1}`} />
                <DetailRow label={labels.featureLength} value={`${selectedFeat.end - selectedFeat.start + 1} bp`} />
                <DetailRow label={labels.featureStrand} value={selectedFeat.strand === 1 ? labels.strandForward : labels.strandReverse} />
                <DetailRow label={labels.featureLocation} value={selectedFeat.location} />
                {selectedFeat.qualifiers.tags && (() => {
                  try {
                    const tags: ComponentTag[] = JSON.parse(selectedFeat.qualifiers.tags)
                    if (tags.length > 0) {
                      return (
                        <div>
                          <label className="text-[10px] text-slate-500 uppercase">功能标签</label>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {tags.map(tag => {
                              const label = COMPONENT_TAG_LABELS[tag]
                              return label ? (
                                <span key={tag} className={`px-1.5 py-0.5 text-[9px] rounded-full ${label.color}`}>{label.zh}</span>
                              ) : (
                                <span key={tag} className="px-1.5 py-0.5 text-[9px] rounded-full bg-slate-100 text-slate-600">{tag}</span>
                              )
                            })}
                          </div>
                        </div>
                      )
                    }
                  } catch {}
                  return null
                })()}
                {Object.entries(selectedFeat.qualifiers)
                  .filter(([k]) => !['label', 'normalized_type', 'tags', 'direction'].includes(k))
                  .map(([k, v]) => (
                    <DetailRow key={k} label={k} value={v} />
                  ))}
                {sequence && (
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase">{labels.featureSequence}</label>
                    <div className="mt-1 bg-slate-50 p-2 rounded font-mono text-[10px] text-slate-600 max-h-20 overflow-auto break-all">
                      {sequence.substring(selectedFeat.start, Math.min(selectedFeat.end + 1, selectedFeat.start + 200))}
                      {selectedFeat.end - selectedFeat.start > 200 && '...'}
                    </div>
                  </div>
                )}
              </>
            )}
            {/* 智能识别结果 */}
            {showIdentify && !editingFeature && (
              <div className="border-t border-slate-200 pt-2 mt-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold text-emerald-700 uppercase">数据库匹配结果</span>
                  <button onClick={() => setShowIdentify(false)} className="text-slate-400 hover:text-slate-600"><X size={10} /></button>
                </div>
                {identifyLoading ? (
                  <div className="text-xs text-slate-400 py-2">正在匹配元件数据库...</div>
                ) : identifyResults.length === 0 ? (
                  <div className="text-xs text-slate-400 py-2">未找到匹配的数据库元件</div>
                ) : (
                  <div className="space-y-1">
                    {identifyResults.map((r, i) => (
                      <div key={i} className="p-1.5 rounded border border-slate-100 hover:border-emerald-200 bg-slate-50">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-700 truncate flex-1">{r.standard_name}</span>
                          <span className={`text-[10px] font-bold px-1 rounded ${
                            r.identity >= 95 ? 'text-emerald-700 bg-emerald-50' :
                            r.identity >= 85 ? 'text-amber-700 bg-amber-50' : 'text-slate-500 bg-slate-100'
                          }`}>{r.identity}%</span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {r.component_type}{r.species ? ` · ${r.species}` : ''} · {r.match_type}
                        </div>
                        <button onClick={() => handleAdoptIdentify(r)}
                          className="mt-1 px-2 py-0.5 text-[10px] bg-emerald-600 text-white rounded hover:bg-emerald-700">
                          采用
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="px-3 py-2 border-b border-slate-200">
            <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1">
              <Info size={12} /> {labels.featureList} ({features.length})
            </h3>
          </div>
          <div className="flex-1 overflow-auto">
            {features.length === 0 ? (
              <div className="text-xs text-slate-400 text-center py-8">{labels.noFeatures}</div>
            ) : (
              features.map((f, i) => (
                <FeatureListItem
                  key={i}
                  index={i}
                  feature={f}
                  isSelected={selectedFeature === i}
                  isHovered={hoveredFeature === i}
                  isDragging={dragFeatureIdx === i}
                  onSelect={onSelectFeature}
                  onMapSelect={onMapSelect}
                  onHover={onHoverFeature}
                  onDelete={onDeleteFeature}
                  onDragStart={onDragStart}
                  onReorder={onReorder}
                  onDragEnd={onDragEnd}
                />
              ))
            )}
          </div>
        </>
      )}
    </aside>
  )
})

/** 元件列表项 memo 组件 */
const FeatureListItem = memo(function FeatureListItem({
  index, feature, isSelected, isHovered, isDragging,
  onSelect, onMapSelect, onHover, onDelete, onDragStart, onReorder, onDragEnd
}: {
  index: number
  feature: GenBankFeature
  isSelected: boolean
  isHovered: boolean
  isDragging: boolean
  onSelect: (i: number) => void
  onMapSelect: (i: number) => void
  onHover: (i: number | null) => void
  onDelete: (i: number) => void
  onDragStart: (i: number) => void
  onReorder: (from: number, to: number) => void
  onDragEnd: () => void
}) {
  const label = feature.qualifiers.label || feature.qualifiers.gene || feature.qualifiers.product || feature.type
  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
    onDragStart(index)
  }, [onDragStart, index])
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const fromIdx = Number(e.dataTransfer.getData('text/plain'))
    if (!isNaN(fromIdx)) onReorder(fromIdx, index)
    onDragEnd()
  }, [onReorder, onDragEnd, index])
  const handleClick = useCallback(() => {
    onSelect(index)
    onMapSelect(index)
  }, [onSelect, onMapSelect, index])
  const handleMouseEnter = useCallback(() => onHover(index), [onHover, index])
  const handleMouseLeave = useCallback(() => onHover(null), [onHover])
  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onDelete(index)
  }, [onDelete, index])

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragEnd={onDragEnd}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`px-3 py-2 cursor-pointer border-b border-slate-50 text-xs group
        ${isSelected ? 'bg-violet-50' : isHovered ? 'bg-slate-50' : ''}
        ${isDragging ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: getColor(feature.type) }} />
        <span className="font-medium text-slate-700 truncate flex-1">{label}</span>
        <button onClick={handleDelete}
          className="p-0.5 text-slate-300 hover:text-red-500"><X size={10} /></button>
      </div>
      <div className="text-[10px] text-slate-400 mt-0.5">
        {featureTypeName(feature.type)} | {feature.start + 1}..{feature.end + 1} | {feature.strand === 1 ? '+' : '-'}
      </div>
    </div>
  )
})

export default FeatureDetailPanel
