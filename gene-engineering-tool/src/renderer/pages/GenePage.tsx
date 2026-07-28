import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Star, GripVertical } from 'lucide-react'
import type { GeneSequence, GeneSequenceType, GeneTranscript, GeneCrossRef, GeneRelatedSequence, SpeciesPlugin, SpeciesGeneAnnotation } from '../../shared/types'
import { useLifecycleLog, useModuleLogger } from '../hooks/useDebugLog'
import GeneSidebar from '../components/GeneBrowser/GeneSidebar'
import GeneCrossRefsPanel from '../components/GeneBrowser/GeneCrossRefs'
import NCBISearchDialog from '../components/GeneBrowser/NCBISearchDialog'
import RiceGeneImportDialog from '../components/GeneBrowser/RiceGeneImportDialog'
import TagInput, { parseSemicolonTags, serializeSemicolonTags, getDbAccessionColor, validateDbAccession } from '../components/ui/TagInput'

export default function GenePage() {
  useLifecycleLog('GenePage')
  const log = useModuleLogger('GenePage')

  // 列表与选择状态
  const [genes, setGenes] = useState<GeneSequence[]>([])
  const [selectedGene, setSelectedGene] = useState<GeneSequence | null>(null)
  const [importMsg, setImportMsg] = useState('')

  // 右侧面板数据
  const [transcripts, setTranscripts] = useState<GeneTranscript[]>([])
  const [crossRefs, setCrossRefs] = useState<GeneCrossRef[]>([])
  const [relatedSeqs, setRelatedSeqs] = useState<GeneRelatedSequence[]>([])
  const [speciesPlugins, setSpeciesPlugins] = useState<SpeciesPlugin[]>([])
  const [speciesAnnotations, setSpeciesAnnotations] = useState<SpeciesGeneAnnotation[]>([])

  // 对话框状态
  const [showNCBI, setShowNCBI] = useState(false)
  const [showRiceImport, setShowRiceImport] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingGene, setEditingGene] = useState<GeneSequence | null>(null)
  const [formData, setFormData] = useState({
    gene_name: '', type: 'mrna' as GeneSequenceType, species: '', sequence: '',
    accession_number: '', description: '', gene_symbol: '', chromosome: '',
    biotype: '', summary: ''
  })
  // 多标签状态（从 formData 的字符串字段解析）
  const [nameTags, setNameTags] = useState<string[]>([])
  const [dbTags, setDbTags] = useState<string[]>([])
  // 名称标签拖拽排序状态
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [nameTagInput, setNameTagInput] = useState('')

  // 加载基因列表（不做类型过滤）
  const loadGenes = useCallback(async () => {
    log.info('Loading all genes...')
    try {
      const data = await window.api.getGenes()
      setGenes(data)
    } catch (err) {
      log.error('Failed to load genes', err)
    }
  }, [])

  useEffect(() => { loadGenes() }, [])

  // 加载选中基因的转录本/交叉引用
  useEffect(() => {
    if (!selectedGene) {
      setTranscripts([])
      setCrossRefs([])
      return
    }
    const geneId = selectedGene.id

    window.api.getGeneTranscripts(geneId).then((txs: GeneTranscript[]) => {
      setTranscripts(txs || [])
    }).catch(err => {
      log.error('Failed to load transcripts', err)
      setTranscripts([])
    })

    window.api.getGeneCrossRefs(geneId).then((refs: GeneCrossRef[]) => {
      setCrossRefs(refs || [])
    }).catch(() => setCrossRefs([]))

    window.api.getGeneRelatedSequences(geneId).then((seqs: GeneRelatedSequence[]) => {
      setRelatedSeqs(seqs || [])
    }).catch(() => setRelatedSeqs([]))
  }, [selectedGene])

  const handleSearch = async (query: string) => {
    if (!query.trim()) { loadGenes(); return }
    try {
      const data = await window.api.searchGenes(query)
      setGenes(data)
    } catch (err) {
      log.error('Search failed', err)
    }
  }

  const handleImport = async () => {
    log.info('Importing gene files...')
    const result = await window.api.importGeneFiles()
    if (result?.success && result.count > 0) {
      setImportMsg(`成功导入 ${result.count} 个序列`)
      loadGenes()
      setTimeout(() => setImportMsg(''), 3000)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除？')) return
    await window.api.deleteGene(id)
    loadGenes()
    if (selectedGene?.id === id) setSelectedGene(null)
  }

  const handleEdit = (g: GeneSequence) => {
    setEditingGene(g)
    setFormData({
      gene_name: g.gene_name, type: g.type, species: g.species, sequence: g.sequence,
      accession_number: g.accession_number, description: g.description,
      gene_symbol: g.gene_symbol || '', chromosome: g.chromosome || '',
      biotype: g.biotype || '', summary: g.summary || ''
    })
    // 合并用户标签 + 物种注释来源标签（去重）
    const userTags = parseSemicolonTags(g.gene_name)
    const mergedTags = [...userTags]
    for (const ann of speciesAnnotations) {
      try {
        const data = JSON.parse(ann.annotation_data || '{}')
        for (const key of ['gene_chinese_name', 'gene_english_name']) {
          if (data[key]) {
            data[key].split(/[;；]/).map((s: string) => s.trim()).filter(Boolean).forEach((t: string) => {
              if (!mergedTags.includes(t)) mergedTags.push(t)
            })
          }
        }
      } catch {}
    }
    setNameTags(mergedTags)
    setDbTags(parseSemicolonTags(g.gene_symbol))
    setNameTagInput('')
    setShowForm(true)
  }

  const handleCreate = () => {
    setEditingGene(null)
    setFormData({
      gene_name: '', type: 'mrna', species: '', sequence: '',
      accession_number: '', description: '', gene_symbol: '', chromosome: '',
      biotype: '', summary: ''
    })
    setNameTags([])
    setDbTags([])
    setNameTagInput('')
    setShowForm(true)
  }

  const handleSubmit = async () => {
    // 从标签状态序列化回字符串
    const submitData = {
      ...formData,
      gene_name: serializeSemicolonTags(nameTags),
      gene_symbol: serializeSemicolonTags(dbTags)
    }
    if (!submitData.gene_name) return
    if (editingGene) {
      await window.api.updateGene(editingGene.id, submitData)
    } else {
      await window.api.createGene(submitData)
    }
    setShowForm(false)
    loadGenes()
  }

  const handleNCBISuccess = (geneId: number) => {
    loadGenes()
    setTimeout(async () => {
      const gene = await window.api.getGene(geneId)
      if (gene) setSelectedGene(gene)
    }, 200)
  }

  // 加载物种插件和注释数据
  useEffect(() => {
    // 加载所有启用的物种插件
    window.api.getSpeciesPlugins().then((plugins: SpeciesPlugin[]) => {
      const enabledPlugins = plugins.filter(p => p.enabled)
      setSpeciesPlugins(enabledPlugins)
    }).catch(err => {
      log.error('Failed to load species plugins', err)
      setSpeciesPlugins([])
    })
  }, [])

  // 当选中基因变化时加载物种注释
  useEffect(() => {
    if (!selectedGene) {
      setSpeciesAnnotations([])
      return
    }
    window.api.getSpeciesGeneAnnotations(selectedGene.id).then((anns: SpeciesGeneAnnotation[]) => {
      setSpeciesAnnotations(anns || [])
    }).catch(err => {
      log.error('Failed to load species annotations', err)
      setSpeciesAnnotations([])
    })
  }, [selectedGene])

  return (
    <div className="flex h-full bg-slate-100">
      {/* 左侧面板：基因列表 */}
      <GeneSidebar
        genes={genes}
        selectedGene={selectedGene}
        onSelect={setSelectedGene}
        onSearch={handleSearch}
        onCreate={handleCreate}
        onImport={handleImport}
        onImportPackage={async () => {
          try {
            const res = await window.api.importGenePackage()
            if (res.success) {
              setImportMsg(`成功导入基因：${res.geneName}`)
              loadGenes()
              setTimeout(() => setImportMsg(''), 3000)
            } else if (res.error && res.error !== '用户取消') {
              alert(`导入失败：${res.error}`)
            }
          } catch (err: any) {
            alert(`导入失败：${err.message}`)
          }
        }}
        onOpenNCBI={() => setShowNCBI(true)}
        onOpenRiceImport={() => setShowRiceImport(true)}
        importMsg={importMsg}
      />

      {/* 右侧面板：基因详情 */}
      {selectedGene ? (
        <GeneCrossRefsPanel
          gene={selectedGene}
          transcripts={transcripts}
          crossRefs={crossRefs}
          relatedSequences={relatedSeqs}
          speciesPlugins={speciesPlugins}
          speciesAnnotations={speciesAnnotations}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onOpenEditor={(id) => window.api.openGeneEditor(id)}
          onOpenTranscriptEditor={(geneId, transcriptId, seqType) => window.api.openGeneTranscriptEditor(geneId, transcriptId, seqType)}
          onOpenRelatedSeqEditor={async (geneId, seqId, seqType) => {
            // 调用专门的相关序列编辑器 API（会按需下载序列并打开独立窗口）
            try {
              const result = await window.api.openRelatedSeqEditor(geneId, seqId, seqType)
              if (!result?.success) {
                log.error('Failed to open related seq editor', result?.message || 'Unknown error')
              }
            } catch (err: any) {
              log.error('Failed to open related seq editor', err)
            }
          }}
          onAnnotationsUpdated={() => {
            if (selectedGene) {
              // 刷新物种注释
              window.api.getSpeciesGeneAnnotations(selectedGene.id).then((anns: SpeciesGeneAnnotation[]) => {
                setSpeciesAnnotations(anns || [])
              }).catch(() => {})
              // 刷新相关序列（NCBI 更新后 ncbi_content 已变化）
              window.api.getGeneRelatedSequences(selectedGene.id).then((seqs: GeneRelatedSequence[]) => {
                setRelatedSeqs(seqs || [])
              }).catch(() => {})
              // 刷新转录本和基因主记录
              window.api.getGeneTranscripts(selectedGene.id).then((txs: GeneTranscript[]) => {
                setTranscripts(txs || [])
              }).catch(() => {})
              window.api.getGene(selectedGene.id).then((g: GeneSequence | null) => {
                if (g) setSelectedGene(g)
              }).catch(() => {})
            }
          }}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-slate-400">
            <p className="text-lg font-light">选择一个基因查看详细信息</p>
            <p className="text-xs mt-2">从左侧列表选择基因，或通过 NCBI 导入新基因</p>
          </div>
        </div>
      )}

      {/* NCBI 导入对话框 */}
      <NCBISearchDialog
        isOpen={showNCBI}
        onClose={() => setShowNCBI(false)}
        onSuccess={handleNCBISuccess}
      />

      {showRiceImport && (
        <RiceGeneImportDialog
          onClose={() => setShowRiceImport(false)}
          onGeneCreated={(geneId) => {
            loadGenes()
            const gene = genes.find(g => g.id === geneId)
            if (gene) setSelectedGene(gene)
            else setTimeout(() => loadGenes().then(() => {}), 500)
          }}
        />
      )}

      {/* 编辑/创建表单 */}
      {showForm && (
        <div
          className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowForm(false) }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false) }}
        >
          <div className="bg-white rounded-xl p-6 w-[560px] max-h-[90vh] overflow-auto shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-800">
                {editingGene ? '编辑基因' : '添加基因'}
              </h3>
              <button onClick={() => setShowForm(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600">基因名称（别名） * <span className="text-slate-400 font-normal">拖拽排序，★ 为主要名称</span></label>
                {/* 可拖拽排序的标签列表 */}
                <div className="flex flex-wrap gap-1 mt-1 p-2 bg-slate-50 rounded-lg border border-slate-200 min-h-[36px]">
                  {nameTags.map((tag, i) => (
                    <span
                      key={`tag-${i}`}
                      draggable
                      onDragStart={() => setDragIdx(i)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragIdx === null || dragIdx === i) return
                        const newTags = [...nameTags]
                        const [moved] = newTags.splice(dragIdx, 1)
                        newTags.splice(i, 0, moved)
                        setNameTags(newTags)
                        setDragIdx(null)
                      }}
                      onDragEnd={() => setDragIdx(null)}
                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs border cursor-grab active:cursor-grabbing select-none transition-all ${
                        i === 0
                          ? 'bg-amber-50 text-amber-800 border-amber-300 font-semibold'
                          : 'bg-white text-slate-700 border-slate-300 hover:border-cyan-300'
                      } ${dragIdx === i ? 'opacity-50 scale-95' : ''}`}
                    >
                      <GripVertical size={10} className="text-slate-300 flex-shrink-0" />
                      {i === 0 && <Star size={10} className="text-amber-500 fill-amber-500 flex-shrink-0" />}
                      <span className="max-w-[180px] truncate">{tag}</span>
                      {i !== 0 && (
                        <button
                          onClick={() => {
                            const newTags = [...nameTags]
                            newTags.splice(i, 1)
                            newTags.unshift(tag)
                            setNameTags(newTags)
                          }}
                          className="ml-0.5 text-slate-300 hover:text-amber-500 transition-colors"
                          title="设为主要名称"
                        >
                          <Star size={10} />
                        </button>
                      )}
                      <button
                        onClick={() => setNameTags(nameTags.filter((_, idx) => idx !== i))}
                        className="ml-0.5 text-slate-300 hover:text-red-500 transition-colors"
                        title="删除"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
                {/* 添加新标签输入框 */}
                <input
                  value={nameTagInput}
                  onChange={(e) => setNameTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ';' || e.key === '；') && nameTagInput.trim()) {
                      e.preventDefault()
                      const val = nameTagInput.trim()
                      if (!nameTags.includes(val)) setNameTags([...nameTags, val])
                      setNameTagInput('')
                    } else if (e.key === 'Backspace' && !nameTagInput && nameTags.length > 0) {
                      setNameTags(nameTags.slice(0, -1))
                    }
                  }}
                  placeholder="输入别名后按 Enter 添加..."
                  className="w-full mt-1.5 px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">数据库存取号 <span className="text-slate-400 font-normal">格式：数据库:存取号</span></label>
                <TagInput
                  tags={dbTags}
                  onChange={setDbTags}
                  placeholder="如 NCBI:LOC4327046 后按 Enter..."
                  inputHint="数据库:存取号"
                  tagColorFn={getDbAccessionColor}
                  validate={validateDbAccession}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600">物种</label>
                  <input value={formData.species} onChange={(e) => setFormData({...formData, species: e.target.value})}
                    className="w-full mt-1 px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">Biotype</label>
                  <input value={formData.biotype} onChange={(e) => setFormData({...formData, biotype: e.target.value})}
                    placeholder="e.g. protein_coding"
                    className="w-full mt-1 px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600">染色体</label>
                  <input value={formData.chromosome} onChange={(e) => setFormData({...formData, chromosome: e.target.value})}
                    placeholder="e.g. Chr1"
                    className="w-full mt-1 px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">描述</label>
                <textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} rows={2}
                  className="w-full mt-1 px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">功能摘要 (Summary)</label>
                <textarea value={formData.summary} onChange={(e) => setFormData({...formData, summary: e.target.value})} rows={3}
                  className="w-full mt-1 px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">序列</label>
                <textarea value={formData.sequence} onChange={(e) => setFormData({...formData, sequence: e.target.value})} rows={4}
                  className="w-full mt-1 px-3 py-1.5 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500" />
              </div>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-600 border rounded-lg hover:bg-slate-50">取消</button>
              <button onClick={handleSubmit} className="px-4 py-2 text-sm bg-cyan-600 text-white rounded-lg hover:bg-cyan-500">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
