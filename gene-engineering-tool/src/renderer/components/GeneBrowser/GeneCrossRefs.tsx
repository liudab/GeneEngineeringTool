import { useState, useRef, useCallback, useEffect } from 'react'
import { ExternalLink, Map, Edit2, Trash2, ChevronDown, RefreshCw, Loader2, GripHorizontal, Download } from 'lucide-react'
import type { GeneSequence, GeneTranscript, GeneCrossRef, GeneRelatedSequence, SpeciesPlugin, SpeciesGeneAnnotation, FieldDefinition } from '../../../shared/types'
import { parseSemicolonTags, getDbAccessionColor } from '../ui/TagInput'
import SpeciesAnnotationTab from './SpeciesAnnotationTab'

interface GeneCrossRefsProps {
  gene: GeneSequence
  transcripts: GeneTranscript[]
  crossRefs: GeneCrossRef[]
  relatedSequences?: GeneRelatedSequence[]
  speciesPlugins?: SpeciesPlugin[]
  speciesAnnotations?: SpeciesGeneAnnotation[]
  onEdit: (gene: GeneSequence) => void
  onDelete: (id: number) => void
  onOpenEditor: (id: number) => void
  onOpenTranscriptEditor: (geneId: number, transcriptId: number, seqType: 'mrna' | 'protein') => void
  onOpenRelatedSeqEditor?: (geneId: number, seqId: number, seqType: 'genomic' | 'mRNA' | 'protein') => void
  onAnnotationsUpdated?: () => void
}

// 来源类型标签颜色
const sourceBadgeColors: Record<string, string> = {
  'RefSeq': 'bg-blue-100 text-blue-700',
  'Other': 'bg-slate-100 text-slate-600',
  'Related': 'bg-amber-100 text-amber-700'
}

// 完整性/证据标签颜色
const statusBadgeColors: Record<string, string> = {
  'Complete': 'bg-green-100 text-green-700',
  'Partial': 'bg-orange-100 text-orange-700',
  'Predicted': 'bg-purple-100 text-purple-700',
  'Experimental': 'bg-emerald-100 text-emerald-700'
}

/** 根据存取号前缀判断来源类型 */
function getSourceType(accession: string): 'RefSeq' | 'Other' | 'Related' {
  if (/^(NM_|XM_|NP_|XP_|NC_|NT_|NW_)/.test(accession)) return 'RefSeq'
  return 'Other'
}

/** 根据存取号前缀判断完整性/证据 */
function getStatusType(accession: string): 'Complete' | 'Partial' | 'Predicted' | 'Experimental' {
  if (/^XM_/.test(accession)) return 'Predicted'
  if (/^XP_/.test(accession)) return 'Predicted'
  if (/^NM_/.test(accession)) return 'Complete'
  if (/^NP_/.test(accession)) return 'Experimental'
  return 'Partial'
}

export default function GeneCrossRefs({ gene, transcripts, crossRefs, relatedSequences = [], speciesPlugins = [], speciesAnnotations = [], onEdit, onDelete, onOpenEditor, onOpenTranscriptEditor, onOpenRelatedSeqEditor, onAnnotationsUpdated }: GeneCrossRefsProps) {
  const [activeTab, setActiveTab] = useState<string>('NCBI')
  const [ricedataLoading, setRicedataLoading] = useState(false)
  const [ricedataError, setRicedataError] = useState<string | null>(null)
  const [ricedataSuccess, setRicedataSuccess] = useState<string | null>(null)
  // 批量更新状态
  const [batchUpdating, setBatchUpdating] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number; log: string[] } | null>(null)
  const [ncbiUpdating, setNcbiUpdating] = useState(false)
  const [ncbiUpdateMsg, setNcbiUpdateMsg] = useState('')

  // 切换到序列管理器时自动刷新数据
  useEffect(() => {
    if (activeTab === 'sequence-manager') {
      onAnnotationsUpdated?.()
    }
  }, [activeTab])

  const externalUrl = (url: string) => {
    window.api.openExternal(url)
  }

  // 相关序列类型颜色
  const seqTypeColors: Record<string, string> = {
    genomic: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    mRNA: 'bg-teal-100 text-teal-700 border-teal-200',
    protein: 'bg-rose-100 text-rose-700 border-rose-200'
  }

  // 获取外部 NCBI 链接
  function getNucCoreLink(accession: string): string {
    return `https://www.ncbi.nlm.nih.gov/nuccore/${accession}`
  }
  
  function getProteinLink(accession: string): string {
    return `https://www.ncbi.nlm.nih.gov/protein/${accession}`
  }

  // 构建外部链接列表
  const externalLinks: { label: string; url: string }[] = []

  // NCBI 基因详情页
  if (gene.ncbi_gene_id) {
    externalLinks.push({
      label: `NCBI Gene: ${gene.ncbi_gene_id}`,
      url: `https://www.ncbi.nlm.nih.gov/gene/${gene.ncbi_gene_id}`
    })
  }

  // 从交叉引用中提取链接
  for (const ref of crossRefs) {
    const url = ref.url || (() => {
      if (ref.database === 'NCBI') return `https://www.ncbi.nlm.nih.gov/gene/${ref.accession}`
      if (ref.database === 'NCBI-RefSeq') return `https://www.ncbi.nlm.nih.gov/nuccore/${ref.accession}`
      if (ref.database === 'NCBI-Protein') return `https://www.ncbi.nlm.nih.gov/protein/${ref.accession}`
      if (ref.database === 'UniProt') return `https://www.uniprot.org/uniprotkb/${ref.accession}`
      return ''
    })()
    if (url) {
      externalLinks.push({ label: `${ref.database}: ${ref.accession}`, url })
    }
  }

  // 从转录本中提取 mRNA 和蛋白质链接
  for (const tx of transcripts) {
    if (tx.transcript_id) {
      externalLinks.push({
        label: `mRNA: ${tx.transcript_id}`,
        url: `https://www.ncbi.nlm.nih.gov/nuccore/${tx.transcript_id}`
      })
    }
    // 从 CDS feature 中提取 protein_id（如果有）
    // 这里简化处理：如果转录本有蛋白质序列，假设有一个对应的蛋白质存取号
  }

  // 解析多别名和多存取号
  const nameTags = parseSemicolonTags(gene.gene_name)
  const dbTags = parseSemicolonTags(gene.gene_symbol)

  // 数据库存取号点击跳转外部链接
  function getDbUrl(tag: string): string {
    const [db, acc] = tag.split(':')
    if (!db || !acc) return ''
    const dbUpper = db.toUpperCase()
    if (dbUpper === 'NCBI') return `https://www.ncbi.nlm.nih.gov/gene/${acc}`
    if (dbUpper === 'ENSEMBL') return `https://ensembl.org/id/${acc}`
    if (dbUpper === 'UNIPROT') return `https://www.uniprot.org/uniprotkb/${acc}`
    if (dbUpper === 'RAP-DB') return `https://rapdb.dna.affrc.go.jp/viewer/gbrowse_details/irgsp1?name=${acc}`
    if (dbUpper === 'MSU') return `http://rice.uga.org/cgi-bin/ORF_infopage.cgi?orf=${acc}`
    if (dbUpper === 'GRAMENE') return `https://www.gramene.org/db/genes/gene?search_term=${acc}`
    if (dbUpper === 'KEGG') return `https://www.genome.jp/dbget-bin/www_bget?${acc}`
    return ''
  }

  // 按 source_database 分组注释数据（用于 per-source 标签页）
  const sourceDbGroups: Record<string, SpeciesGeneAnnotation[]> = {}
  for (const ann of speciesAnnotations) {
    if (!sourceDbGroups[ann.source_database]) {
      sourceDbGroups[ann.source_database] = []
    }
    sourceDbGroups[ann.source_database].push(ann)
  }
  const sourceDbKeys = Object.keys(sourceDbGroups)

  // 从插件注释中提取基因别名（displayLocation=gene_aliases），无来源标注，去重
  const pluginAliasValues: string[] = []
  // 从插件注释中提取数据库存取号（displayLocation=gene_accession），带来源标注
  const pluginAccessions: { source: string; value: string; label?: string }[] = []
  // 从插件注释中提取基因中文名称（displayLocation=gene_chinese_name）
  let geneChineseName: string = ''
  // 从插件注释中提取功能描述（displayLocation=gene_description）
  const pluginDescriptions: { source: string; field: FieldDefinition; value: string }[] = []
  
  for (const plugin of speciesPlugins) {
    const fieldDefs: FieldDefinition[] = (() => {
      try {
        return JSON.parse(plugin.fields_config || '[]')
      } catch {
        return []
      }
    })()
  
    const pluginAnns = speciesAnnotations.filter(a => {
      const p = speciesPlugins.find(pp => pp.id === a.plugin_id)
      return p?.species_name === plugin.species_name
    })
  
    // 对同一 plugin 的注释按 source_database 去重（同一来源只取第一条）
    const seenSources = new Set<string>()
  
    for (const ann of pluginAnns) {
      let annData: Record<string, string> = {}
      try {
        annData = JSON.parse(ann.annotation_data || '{}')
      } catch {
        continue
      }
  
      const srcKey = ann.source_database
  
      for (const field of fieldDefs) {
        // _source_accession 是内置特殊字段，从注释记录的 source_accession 取值
        const value = field.name === '_source_accession'
          ? ann.source_accession
          : annData[field.name]
        if (!value || value.trim().length === 0) continue
  
        const displayLocation = field.displayLocation || 'tab'
  
        if (displayLocation === 'gene_aliases') {
          if (field.type === 'tags') {
            const tags = value.split(/[;\uff1b]/).map(s => s.trim()).filter(Boolean)
            for (const tag of tags) {
              if (!pluginAliasValues.includes(tag)) {
                pluginAliasValues.push(tag)
              }
            }
          } else {
            if (!pluginAliasValues.includes(value)) {
              pluginAliasValues.push(value)
            }
          }
        } else if (displayLocation === 'gene_accession') {
          // 同一 source + 同一字段名只取一次
          const accKey = `${srcKey}-${field.name}`
          if (!pluginAccessions.some(a => a.source === srcKey && a.value === value)) {
            pluginAccessions.push({ source: srcKey, value, label: field.displayLabel })
          }
        } else if (displayLocation === 'gene_chinese_name') {
          if (!geneChineseName) geneChineseName = value
        } else if (displayLocation === 'gene_description') {
          if (!pluginDescriptions.some(d => d.field.name === field.name)) {
            pluginDescriptions.push({ source: ann.source_database, field, value })
          }
        }
      }
    }
  }
  
  // 提取 Ricedata ID（从物种注释中）
  let ricedataId = ''
  for (const ann of speciesAnnotations) {
    try {
      const data = JSON.parse(ann.annotation_data || '{}')
      if (data['ricedata_id']) {
        ricedataId = data['ricedata_id']
        break
      }
    } catch {}
  }

  // 提取基因英文名称（从物种注释中）
  let geneEnglishName = ''
  for (const ann of speciesAnnotations) {
    try {
      const data = JSON.parse(ann.annotation_data || '{}')
      if (data['gene_english_name']) {
        geneEnglishName = data['gene_english_name']
        break
      }
    } catch {}
  }

  // 回退提取基因中文名称（直接从 annotation_data，不依赖 fields_config）
  if (!geneChineseName) {
    for (const ann of speciesAnnotations) {
      try {
        const data = JSON.parse(ann.annotation_data || '{}')
        if (data['gene_chinese_name']) {
          geneChineseName = data['gene_chinese_name']
          break
        }
      } catch {}
    }
  }

  // 合并所有别名：nameTags + pluginAliasValues + 中文名称 + 英文名称，去重（大小写不敏感）
  const allAliases: string[] = [...nameTags]
  const aliasLowerSet = new Set(allAliases.map(a => a.toLowerCase()))
  for (const alias of pluginAliasValues) {
    if (!aliasLowerSet.has(alias.toLowerCase())) {
      allAliases.push(alias)
      aliasLowerSet.add(alias.toLowerCase())
    }
  }
  // 追加基因中文名称为标签（按分号拆分为独立标签）
  if (geneChineseName) {
    const chineseTags = geneChineseName.split(/[;；]/).map(s => s.trim()).filter(Boolean)
    for (const tag of chineseTags) {
      if (!aliasLowerSet.has(tag.toLowerCase())) {
        allAliases.push(tag)
        aliasLowerSet.add(tag.toLowerCase())
      }
    }
  }
  // 追加基因英文名称为标签（按分号拆分为独立标签）
  if (geneEnglishName) {
    const englishTags = geneEnglishName.split(/[;；]/).map(s => s.trim()).filter(Boolean)
    for (const tag of englishTags) {
      if (!aliasLowerSet.has(tag.toLowerCase())) {
        allAliases.push(tag)
        aliasLowerSet.add(tag.toLowerCase())
      }
    }
  }

  // 去重：过滤 pluginAccessions 中已被 dbTags 覆盖的条目（避免同一存取号显示两次）
  const dbTagsUpperSet = new Set(dbTags.map(t => t.toUpperCase()))
  const dedupedPluginAccessions = pluginAccessions.filter(acc => {
    // 检查 "SOURCE:VALUE" 是否已在 dbTags 中
    const combined = `${acc.source}:${acc.value}`.toUpperCase()
    return !dbTagsUpperSet.has(combined)
  })

  // 从 RiceData 在线更新
  const handleRiceDataUpdate = async () => {
    if (!ricedataId) return
    setRicedataLoading(true)
    setRicedataError(null)
    setRicedataSuccess(null)
    try {
      const result = await window.api.fetchRiceDataGeneInfo(ricedataId)
      if (!result.success) {
        setRicedataError(result.error || '获取 RiceData 信息失败')
        return
      }
      const data = result.data
      // 获取当前基因的所有注释记录 ID
      const annotationIds = speciesAnnotations.map(a => a.id)
      if (annotationIds.length === 0) {
        setRicedataError('未找到关联的注释记录')
        return
      }
      // 更新到本地数据库
      const updateResult = await window.api.updateRiceDataAnnotation(annotationIds, data)
      if (updateResult.success) {
        setRicedataSuccess(`已更新 ${updateResult.data.updated} 条注释记录`)
        // 通知父组件刷新
        onAnnotationsUpdated?.()
      } else {
        setRicedataError(updateResult.error || '更新数据库失败')
      }
    } catch (err: any) {
      setRicedataError(err.message || '获取 RiceData 信息失败')
    } finally {
      setRicedataLoading(false)
    }
  }

  // 批量更新物种注释（按顺序逐条调用在线 API，每条间隔 500ms）
  const handleBatchUpdate = async () => {
    const updatable = speciesAnnotations.filter(a =>
      a.source_database === 'RAP-DB' || a.source_database === 'MSU'
    )
    if (updatable.length === 0) return
    const sourceDist = updatable.reduce((m, a) => { m[a.source_database] = (m[a.source_database] || 0) + 1; return m }, {} as Record<string, number>)
    const desc = Object.entries(sourceDist).map(([k, v]) => `${k}: ${v}条`).join(', ')
    if (!window.confirm(`将批量更新 ${updatable.length} 条注释记录（${desc}）\n每条间隔 500ms 避免请求过快，确认继续？`)) return

    setBatchUpdating(true)
    const log: string[] = []
    let success = 0, failed = 0
    setBatchProgress({ done: 0, total: updatable.length + 1, log: [] })

    // NCBI 数据更新（若有 ncbi_gene_id）
    if (gene.ncbi_gene_id) {
      try {
        const ncbiRes = await window.api.importGeneFromNCBI(gene.ncbi_gene_id)
        if (ncbiRes.success) {
          log.push(`✅ NCBI (ID:${gene.ncbi_gene_id}) 更新成功`)
          success++
        } else {
          log.push(`❌ NCBI (ID:${gene.ncbi_gene_id}): ${ncbiRes.error || '导入失败'}`)
          failed++
        }
      } catch (err: any) {
        log.push(`❌ NCBI: ${err.message}`)
        failed++
      }
      setBatchProgress({ done: 1, total: updatable.length + 1, log: [...log] })
      await new Promise(r => setTimeout(r, 500))
    }

    for (let i = 0; i < updatable.length; i++) {
      const ann = updatable[i]
      try {
        if (ann.source_database === 'RAP-DB') {
          const res = await window.api.fetchRAPDBLocusInfo(ann.source_accession)
          if (res.success) {
            const info: any = { ...res.data }
            // 获取表达图谱图片 URL
            try {
              const imgRes = await window.api.fetchRAPDBExpressionImages(ann.source_accession)
              if (imgRes.success && imgRes.data.categories) info.expression_categories = imgRes.data.categories
            } catch {}
            // 获取表达数值数据
            try {
              const exprRes = await window.api.fetchRAPDBExpression(ann.source_accession, 'RXP_3001')
              if (exprRes.success && exprRes.data.data) {
                info.expression_data = exprRes.data.data
                info.expression_rxp_name = exprRes.data.rxp_name
              }
            } catch {}
            await window.api.cacheRAPDBInfo(ann.id, info)
            // 后台批量获取图表型实验数据
            window.api.fetchAllRAPDBExpressionData(ann.source_accession, ann.id).catch(() => {})
            log.push(`✅ [${i + 1}] RAP-DB ${ann.source_accession} 更新成功`)
            success++
          } else {
            log.push(`❌ [${i + 1}] RAP-DB ${ann.source_accession}: ${res.error}`)
            failed++
          }
        } else if (ann.source_database === 'MSU') {
          const res = await window.api.fetchMSUGeneInfo(ann.source_accession)
          if (res.success) {
            await window.api.cacheMSUInfo(ann.id, res.data)
            // 获取序列（含 splice variants）并缓存
            try {
              const variants = res.data.splice_variants || []
              const seqRes = await window.api.fetchMSUSequences(ann.source_accession, variants.length > 0 ? variants : undefined)
              if (seqRes.success && seqRes.data) {
                await window.api.cacheMSUInfo(ann.id, { msu_sequences: seqRes.data })
              }
            } catch (seqErr: any) {
              log.push(`  ⚠️ MSU 序列获取失败: ${seqErr.message}`)
            }
            log.push(`✅ [${i + 1}] MSU ${ann.source_accession} 更新成功`)
            success++
          } else {
            log.push(`❌ [${i + 1}] MSU ${ann.source_accession}: ${res.error}`)
            failed++
          }
        }
      } catch (err: any) {
        log.push(`❌ [${i + 1}] ${ann.source_database} ${ann.source_accession}: ${err.message}`)
        failed++
      }
      setBatchProgress({ done: i + 2, total: updatable.length + 1, log: [...log] })
      // 间隔 500ms
      if (i < updatable.length - 1) await new Promise(r => setTimeout(r, 500))
    }

    log.push(`\n汇总：成功 ${success} 条，失败 ${failed} 条`)

    // RiceData 更新（从任意注释的 annotation_data 中提取 ricedata_id）
    try {
      let ricedataId = ''
      for (const ann of speciesAnnotations) {
        try {
          const data = JSON.parse(ann.annotation_data || '{}')
          if (data.ricedata_id) { ricedataId = data.ricedata_id; break }
        } catch {}
      }
      if (ricedataId) {
        const rdRes = await window.api.fetchRiceDataGeneInfo(ricedataId)
        if (rdRes.success && rdRes.data) {
          const annIds = speciesAnnotations.map(a => a.id)
          await window.api.updateRiceDataAnnotation(annIds, rdRes.data)
          log.push(`✅ RiceData (ID:${ricedataId}) 更新成功`)
        } else {
          log.push(`❌ RiceData (ID:${ricedataId}): ${rdRes.error || '获取失败'}`)
        }
      }
    } catch (err: any) {
      log.push(`❌ RiceData: ${err.message}`)
    }

    setBatchProgress({ done: updatable.length + 1, total: updatable.length + 1, log: [...log] })
    setBatchUpdating(false)
    // 批量更新完成后重新生成基因详情页 HTML（确保无 NCBI ID 的基因也能生成）
    window.api.regenerateGeneHtml?.().catch(() => {})
    onAnnotationsUpdated?.()
  }

  // 可折叠区块状态
  const [expandedDescriptions, setExpandedDescriptions] = useState<Record<string, boolean>>({})

  // ============ 上下区域拖拽调整比例 ============
  const containerRef = useRef<HTMLDivElement>(null)
  const [topRatio, setTopRatio] = useState(0.45) // 上方详情区域占 45%
  const topRatioRef = useRef(0.45)
  const [isDragging, setIsDragging] = useState(false)

  const handleDragStart = useCallback(() => { setIsDragging(true) }, [])

  useEffect(() => {
    if (!isDragging) return
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    let raf = 0
    // 拖拽期间直接 DOM 操作，不触发 React 重渲染
    const topPane = containerRef.current?.querySelector<HTMLElement>('[data-top-pane]')
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const MIN_H = 150 // 上下区域最小高度
      const DIV_H = 4   // 分隔条高度
      const minRatio = MIN_H / rect.height
      const maxRatio = (rect.height - MIN_H - DIV_H) / rect.height
      const ratio = Math.max(minRatio, Math.min(maxRatio, (e.clientY - rect.top) / rect.height))
      topRatioRef.current = ratio
      if (!raf) {
        raf = requestAnimationFrame(() => {
          if (topPane) topPane.style.height = `${topRatioRef.current * 100}%`
          raf = 0
        })
      }
    }
    const onUp = () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0 }
      // 拖拽结束时同步 React state（仅触发一次重渲染）
      setTopRatio(topRatioRef.current)
      setIsDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (raf) cancelAnimationFrame(raf)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging])

  return (
    <div ref={containerRef} className="flex-1 flex flex-col bg-white overflow-hidden">
      {/* 上方区域：基因基本信息头部（可拖拽调整高度） */}
      <div data-top-pane className="overflow-y-auto flex-shrink-0 bg-slate-50" style={{ height: `${topRatio * 100}%` }}>
      {/* 基因基本信息头部 */}
      <div className="px-4 py-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {/* 基因别名标签组（NCBI + 插件来源合并，去重，无来源标注） */}
            <div className="flex flex-wrap gap-1 mb-1">
              {allAliases.length > 0 ? allAliases.map((tag, i) => (
                <span key={i} className={`px-1.5 py-0.5 rounded text-xs border ${i === 0 ? 'bg-cyan-50 text-cyan-700 border-cyan-200 font-semibold' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                  {tag}
                </span>
              )) : (
                <h3 className="text-sm font-bold text-slate-800">未命名</h3>
              )}
            </div>
            {/* 数据库存取号标签组（NCBI + 插件来源，插件来源带 [Source] 前缀） */}
            {(dbTags.length > 0 || dedupedPluginAccessions.length > 0) && (
              <div className="flex flex-wrap gap-1 mt-1">
                {/* NCBI 来源存取号（无来源前缀，已有“NCBI:”前缀） */}
                {dbTags.map((tag, i) => {
                  const url = getDbUrl(tag)
                  return url ? (
                    <button
                      key={`db-${i}`}
                      onClick={() => window.api.openExternal(url)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono border hover:opacity-80 transition-opacity ${getDbAccessionColor(tag)}`}
                      title={`跳转到 ${tag}`}
                    >
                      {tag}
                    </button>
                  ) : (
                    <span key={`db-${i}`} className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${getDbAccessionColor(tag)}`}>
                      {tag}
                    </span>
                  )
                })}
                {/* 插件来源存取号（带 [Source] 前缀，已去重） */}
                {dedupedPluginAccessions.map((acc, i) => (
                  <span
                    key={`pa-${i}`}
                    className="px-1.5 py-0.5 rounded text-[10px] font-mono border bg-emerald-50 text-emerald-700 border-emerald-200"
                    title={`${acc.source}: ${acc.value}`}
                  >
                    <span className="text-[8px] text-emerald-500 mr-0.5">[{acc.source}]</span>
                    {acc.value}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {ricedataId && (
              <button
                onClick={handleRiceDataUpdate}
                disabled={ricedataLoading}
                className="px-2 py-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                title="从国家水稻数据中心在线更新基因信息"
              >
                {ricedataLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                从 RiceData 更新
              </button>
            )}
            {speciesAnnotations.some(a => a.source_database === 'RAP-DB' || a.source_database === 'MSU') && (
              <button
                onClick={handleBatchUpdate}
                disabled={batchUpdating}
                className="px-2 py-1 text-[10px] font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                title="批量更新所有 RAP-DB/MSU 注释（在线获取最新数据）"
              >
                {batchUpdating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                批量更新物种注释
              </button>
            )}
            <button
              onClick={async () => {
                try {
                  const res = await window.api.exportGenePackage(gene.id)
                  if (res.success) {
                    alert(`导出成功：${res.filePath}\n大小：${(res.size / 1024).toFixed(0)} KB`)
                  } else if (res.error && res.error !== '用户取消') {
                    alert(`导出失败：${res.error}`)
                  }
                } catch (err: any) {
                  alert(`导出失败：${err.message}`)
                }
              }}
              className="px-2 py-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100 transition-colors flex items-center gap-1"
              title="导出基因数据包（ZIP）"
            >
              <Download size={11} /> 导出数据包
            </button>
            <button
              onClick={() => onEdit(gene)}
              className="p-1.5 text-slate-400 hover:text-blue-600 rounded hover:bg-slate-100"
              title="编辑"
            >
              <Edit2 size={13} />
            </button>
            <button
              onClick={() => onDelete(gene.id)}
              className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-slate-100"
              title="删除"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* 缓存时效提示（超过180天显示灰色小字） */}
        {(() => {
          const CACHE_MAX_AGE_DAYS = 180
          let oldestTs = ''
          for (const ann of speciesAnnotations) {
            try {
              const data = JSON.parse(ann.annotation_data || '{}')
              const ts = data.fetched_at || data.updated_at || data.rapdb_fetched_at || data.msu_fetched_at || ''
              if (ts && (!oldestTs || ts < oldestTs)) oldestTs = ts
            } catch {}
          }
          if (!oldestTs) return null
          const ageDays = Math.floor((Date.now() - new Date(oldestTs).getTime()) / 86400000)
          if (ageDays < CACHE_MAX_AGE_DAYS) return null
          const dateStr = oldestTs.split('T')[0]
          return (
            <div className="px-4 py-1 text-[10px] text-slate-400">
              数据获取于 {dateStr}（{ageDays} 天前），可点击“批量更新物种注释”刷新
            </div>
          )
        })()}

        {/* 批量更新进度 */}
        {batchProgress && (
          <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center justify-between text-xs text-blue-700 mb-1">
              <span>批量更新进度：{batchProgress.done}/{batchProgress.total}</span>
              {batchProgress.done >= batchProgress.total && (
                <button onClick={() => setBatchProgress(null)} className="text-blue-500 hover:text-blue-700">✕ 关闭</button>
              )}
            </div>
            <div className="w-full bg-blue-100 rounded-full h-1.5 mb-2">
              <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%` }} />
            </div>
            <div className="max-h-24 overflow-auto text-[10px] font-mono text-slate-600 space-y-0.5">
              {batchProgress.log.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>
        )}

        {/* 基因中文名称（插件来源） */}
        {geneChineseName && (
          <div className="mt-3 pt-2 border-t border-slate-200">
            <span className="text-slate-400 uppercase text-[10px] font-medium">基因中文名称</span>
            <p className="text-sm text-slate-700 mt-1">{geneChineseName}</p>
          </div>
        )}

        {/* 基因英文名称（插件来源） */}
        {geneEnglishName && (
          <div className="mt-2">
            <span className="text-slate-400 uppercase text-[10px] font-medium">基因英文名称</span>
            <p className="text-sm text-slate-700 mt-1">{geneEnglishName}</p>
          </div>
        )}

        {/* RiceData 更新状态提示 */}
        {ricedataError && (
          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            {ricedataError}
          </div>
        )}
        {ricedataSuccess && (
          <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">
            {ricedataSuccess}
          </div>
        )}

        {/* 基本信息网格 */}
        <div className="grid grid-cols-3 gap-x-4 gap-y-2 mt-3 text-xs">
          <div>
            <span className="text-slate-400 uppercase text-[10px] font-medium">物种</span>
            <p className="italic text-slate-700">{gene.species || '-'}</p>
          </div>
          <div>
            <span className="text-slate-400 uppercase text-[10px] font-medium">Biotype</span>
            <p className="text-slate-700">{gene.biotype || '-'}</p>
          </div>
          <div>
            <span className="text-slate-400 uppercase text-[10px] font-medium">染色体</span>
            <p className="text-slate-700">{gene.chromosome || '-'}</p>
          </div>
          <div>
            <span className="text-slate-400 uppercase text-[10px] font-medium">链方向</span>
            <p className="text-slate-700">{Number(gene.strand) === -1 ? '反向 (−)' : '正向 (+)'}</p>
          </div>
          <div>
            <span className="text-slate-400 uppercase text-[10px] font-medium">NCBI ID</span>
            <p className="text-slate-700 font-mono">{gene.ncbi_gene_id || '-'}</p>
          </div>
          {ricedataId && (
            <div>
              <span className="text-slate-400 uppercase text-[10px] font-medium">Ricedata ID</span>
              <p className="text-slate-700 font-mono">{ricedataId}</p>
            </div>
          )}
        </div>

        {/* 功能摘要 */}
        {(gene.summary || gene.description) && (
          <div className="mt-3 pt-3 border-t border-slate-200">
            <span className="text-slate-400 uppercase text-[10px] font-medium">功能描述</span>
            <p className="text-xs text-slate-600 leading-relaxed mt-1">
              {gene.summary || gene.description}
            </p>
          </div>
        )}

        {/* 插件来源的功能描述（可折叠区块） */}
        {pluginDescriptions.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
            {pluginDescriptions.map((desc, i) => {
              const blockKey = desc.field.name
              const isExpanded = expandedDescriptions[blockKey] || false
              const displayLabel = desc.field.displayLabel || desc.field.label

              return (
                <div key={i} className="border border-slate-200 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedDescriptions(prev => ({ ...prev, [blockKey]: !prev[blockKey] }))}
                    className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors"
                  >
                    <span className="text-xs font-medium text-slate-700">
                      {displayLabel}
                    </span>
                    <ChevronDown
                      size={14}
                      className={`text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {isExpanded && (
                    <div className="px-3 py-2 text-xs text-slate-600 leading-relaxed whitespace-pre-wrap max-h-64 overflow-auto">
                      {desc.value}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      </div>

      {/* 拖拽分隔条 */}
      <div
        onMouseDown={handleDragStart}
        className={`h-1 flex items-center justify-center flex-shrink-0 cursor-row-resize select-none transition-colors ${
          isDragging ? 'bg-violet-400' : 'bg-slate-200 hover:bg-violet-300 active:bg-violet-400'
        }`}
      >
        <GripHorizontal size={12} className={isDragging ? 'text-violet-100' : 'text-slate-400'} />
      </div>

      {/* 下方区域：物种注释标签页区域 */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">

      {/* 标签栏（始终显示） */}
        <div className="border-b border-slate-200 bg-slate-50 px-4">
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab('NCBI')}
              className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === 'NCBI'
                  ? 'border-cyan-500 text-cyan-700 bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-800'
              }`}
            >
              NCBI
            </button>
            {sourceDbKeys.map(dbKey => {
              const dbAnns = sourceDbGroups[dbKey]
              const firstAccession = dbAnns[0]?.source_accession || ''
              const tabId = `src-${dbKey}`
              return (
                <button
                  key={dbKey}
                  onClick={() => setActiveTab(tabId)}
                  className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                    activeTab === tabId
                      ? 'border-cyan-500 text-cyan-700 bg-white'
                      : 'border-transparent text-slate-600 hover:text-slate-800'
                  }`}
                >
                  {dbKey} {firstAccession ? `(${firstAccession})` : ''}
                </button>
              )
            })}
            {ricedataId && (
              <button
                onClick={() => setActiveTab('ricedata')}
                className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === 'ricedata'
                    ? 'border-emerald-500 text-emerald-700 bg-white'
                    : 'border-transparent text-slate-600 hover:text-slate-800'
                }`}
              >
                国家水稻数据中心
              </button>
            )}
            <button
              onClick={() => setActiveTab('sequence-manager')}
              className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === 'sequence-manager'
                  ? 'border-violet-500 text-violet-700 bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-800'
              }`}
            >
              序列管理器
            </button>
          </div>
        </div>

      {/* 主内容区 */}
      <div className="flex-1 overflow-auto p-4 space-y-5">
        {/* NCBI 标签内容 */}
        {activeTab === 'NCBI' && (<>
        {/* 更新 NCBI 信息按钮 */}
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={async () => {
              if (!gene.ncbi_gene_id) {
                setNcbiUpdateMsg('该基因无 NCBI Gene ID，无法更新')
                return
              }
              setNcbiUpdating(true)
              setNcbiUpdateMsg('')
              try {
                const res = await window.api.importGeneFromNCBI(gene.ncbi_gene_id)
                if (res.success) {
                  setNcbiUpdateMsg('NCBI 数据更新成功')
                  onAnnotationsUpdated?.()
                } else {
                  setNcbiUpdateMsg(`更新失败: ${res.error || '未知错误'}`)
                }
              } catch (err: any) {
                setNcbiUpdateMsg(`更新失败: ${err.message}`)
              } finally {
                setNcbiUpdating(false)
              }
            }}
            disabled={ncbiUpdating}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md text-xs hover:bg-indigo-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {ncbiUpdating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            更新 NCBI 信息
          </button>
          {ncbiUpdateMsg && (
            <span className={`text-xs ${ncbiUpdateMsg.includes('成功') ? 'text-green-600' : 'text-red-600'}`}>{ncbiUpdateMsg}</span>
          )}
        </div>
        {/* 参考基因组序列 */}
        <section>
          <h4 className="text-xs uppercase font-semibold text-slate-400 tracking-wider mb-3">
            参考基因组序列
          </h4>
          <div className="p-3 bg-slate-50 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-slate-700">
                  {gene.accession_number || 'Genomic Sequence'}
                </div>
                <div className="text-[10px] text-slate-400 mt-1 space-y-0.5">
                  {gene.sequence && <div>长度: {gene.sequence.length.toLocaleString()} bp</div>}
                  {gene.genomic_start !== undefined && gene.genomic_end !== undefined && (
                    <div>位置: {gene.genomic_start.toLocaleString()}..{gene.genomic_end.toLocaleString()}</div>
                  )}
                  {gene.species && <div>来源: {gene.species}</div>}
                </div>
              </div>
              <button
                onClick={() => onOpenEditor(gene.id)}
                className="px-2.5 py-1.5 bg-cyan-600 text-white rounded text-xs hover:bg-cyan-500 flex items-center gap-1 transition-colors"
              >
                <Map size={12} /> 图谱查看
              </button>
            </div>
          </div>
        </section>

        {/* 转录本列表 */}
        <section>
          <h4 className="text-xs uppercase font-semibold text-slate-400 tracking-wider mb-3">
            转录本 ({transcripts.length})
          </h4>
          {transcripts.length > 0 ? (
            <div className="space-y-2">
              {transcripts.map(tx => {
                const sourceType = getSourceType(tx.transcript_id)
                const statusType = getStatusType(tx.transcript_id)
                return (
                  <div key={tx.id} className="p-3 bg-slate-50 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-medium text-slate-700">{tx.transcript_id}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${sourceBadgeColors[sourceType]}`}>
                          {sourceType}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${statusBadgeColors[statusType]}`}>
                          {statusType}
                        </span>
                        {tx.is_primary && (
                          <span className="px-1.5 py-0.5 bg-cyan-100 text-cyan-700 rounded text-[9px]">primary</span>
                        )}
                      </div>
                      <button
                        onClick={() => onOpenTranscriptEditor(gene.id, tx.id, 'mrna')}
                        className="px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-600 hover:bg-cyan-50 hover:border-cyan-300 hover:text-cyan-700 flex items-center gap-1 transition-colors"
                        title="查看 mRNA 图谱"
                      >
                        <Map size={11} /> 图谱
                      </button>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1.5">{tx.name}</div>
                    <div className="flex gap-3 text-[10px] text-slate-400 mt-1">
                      <span>Exons: {tx.exon_count}</span>
                      {tx.mrna_sequence && <span>mRNA: {tx.mrna_sequence.length.toLocaleString()} bp</span>}
                      {tx.cds_sequence && <span>CDS: {tx.cds_sequence.length.toLocaleString()} bp</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic py-2">暂无转录本数据</p>
          )}
        </section>

        {/* 蛋白质序列列表 */}
        <section>
          <h4 className="text-xs uppercase font-semibold text-slate-400 tracking-wider mb-3">
            蛋白质序列
          </h4>
          {transcripts.some(tx => tx.protein_sequence) ? (
            <div className="space-y-2">
              {transcripts.filter(tx => tx.protein_sequence).map(tx => {
                // 从交叉引用中查找对应的蛋白质存取号
                const proteinRef = crossRefs.find(r => r.database === 'NCBI-Protein')
                const proteinAccession = proteinRef?.accession || `${tx.transcript_id.replace(/^XM_/, 'XP_').replace(/^NM_/, 'NP_')}`
                const sourceType = getSourceType(proteinAccession)
                const statusType = getStatusType(proteinAccession)
                return (
                  <div key={`protein-${tx.id}`} className="p-3 bg-slate-50 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-medium text-slate-700">{proteinAccession}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${sourceBadgeColors[sourceType]}`}>
                          {sourceType}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${statusBadgeColors[statusType]}`}>
                          {statusType}
                        </span>
                      </div>
                      <button
                        onClick={() => onOpenTranscriptEditor(gene.id, tx.id, 'protein')}
                        className="px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-600 hover:bg-cyan-50 hover:border-cyan-300 hover:text-cyan-700 flex items-center gap-1 transition-colors"
                        title="查看蛋白质序列"
                      >
                        <Map size={11} /> 图谱
                      </button>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1.5">
                      长度: {tx.protein_sequence!.length} aa
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic py-2">暂无蛋白质序列数据</p>
          )}
        </section>

        {/* 相关序列（Related Sequences） */}
        <section>
          <h4 className="text-xs uppercase font-semibold text-slate-400 tracking-wider mb-3">
            相关序列 ({relatedSequences.length})
          </h4>
          {relatedSequences.length > 0 ? (
            <div className="space-y-2">
              {relatedSequences.map(seq => {
                const seqTypeLabel = seq.seq_type === 'genomic' ? 'Genomic' : seq.seq_type === 'mRNA' ? 'mRNA' : 'Protein'
                return (
                  <div key={seq.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${seqTypeColors[seq.seq_type]}`}>
                          {seqTypeLabel}
                        </span>
                        <span className="font-mono text-xs font-medium text-slate-700">
                          {seq.nucleotide_accession || seq.protein_accession}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        {/* 图谱查看按钮（仅 Genomic 和 mRNA） */}
                        {(seq.seq_type === 'genomic' || seq.seq_type === 'mRNA') && seq.nucleotide_accession && (
                          <button
                            onClick={() => onOpenRelatedSeqEditor?.(gene.id, seq.id, seq.seq_type === 'genomic' ? 'genomic' : 'mRNA')}
                            className="px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-600 hover:bg-cyan-50 hover:border-cyan-300 hover:text-cyan-700 flex items-center gap-1 transition-colors"
                            title="查看图谱"
                          >
                            <Map size={11} /> 图谱
                          </button>
                        )}
                        {/* 蛋白图谱查看按钮 */}
                        {seq.seq_type === 'protein' && seq.protein_accession && (
                          <button
                            onClick={() => onOpenRelatedSeqEditor?.(gene.id, seq.id, 'protein')}
                            className="px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-600 hover:bg-cyan-50 hover:border-cyan-300 hover:text-cyan-700 flex items-center gap-1 transition-colors"
                            title="查看蛋白质图谱"
                          >
                            <Map size={11} /> 图谱
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1.5 truncate">{seq.description}</div>
                    <div className="flex gap-3 text-[10px] text-slate-400 mt-1.5 flex-wrap">
                      {/* 核酸存取号 */}
                      {seq.nucleotide_accession && (
                        <button
                          onClick={() => externalUrl(getNucCoreLink(seq.nucleotide_accession))}
                          className="hover:text-cyan-600 transition-colors"
                        >
                          NCBI Nuccore: {seq.nucleotide_accession}
                        </button>
                      )}
                      {/* 蛋白存取号 */}
                      {seq.protein_accession && (
                        <button
                          onClick={() => externalUrl(getProteinLink(seq.protein_accession!))}
                          className="hover:text-cyan-600 transition-colors"
                        >
                          NCBI Protein: {seq.protein_accession}
                        </button>
                      )}
                      {/* 基因组范围 */}
                      {seq.genomic_range && (
                        <span>chr:{seq.genomic_range}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic py-2">暂无相关序列数据</p>
          )}
        </section>

        {/* 外部链接 */}
        <section>
          <h4 className="text-xs uppercase font-semibold text-slate-400 tracking-wider mb-3">
            外部数据库链接
          </h4>
          {externalLinks.length > 0 ? (
            <div className="space-y-1">
              {externalLinks.map((link, idx) => (
                <button
                  key={idx}
                  onClick={() => externalUrl(link.url)}
                  className="w-full flex items-center gap-2 text-xs p-2 rounded-lg hover:bg-slate-50 text-left transition-colors group"
                >
                  <ExternalLink size={11} className="text-slate-400 group-hover:text-cyan-600 flex-shrink-0" />
                  <span className="text-slate-600 group-hover:text-cyan-700 truncate">{link.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic py-2">暂无外部链接</p>
          )}
        </section>
        </>)}

        {/* 物种插件标签内容（按 source_database 分组） */}
        {sourceDbKeys.map(dbKey => {
          const tabId = `src-${dbKey}`
          if (activeTab !== tabId) return null
          const dbAnns = sourceDbGroups[dbKey]
          if (!dbAnns || dbAnns.length === 0) return null

          // 找到第一个注释对应的 plugin 来获取字段定义和 URL 模板
          const firstPluginId = dbAnns[0].plugin_id
          const plugin = speciesPlugins.find(p => p.id === firstPluginId)
          let fieldDefs: FieldDefinition[] = []
          let urlTemplates: Record<string, string> = {}
          if (plugin) {
            try {
              fieldDefs = JSON.parse(plugin.fields_config || '[]')
              urlTemplates = JSON.parse(plugin.url_templates || '{}')
            } catch (e) {
              console.warn('Failed to parse plugin config:', e)
            }
          }

          return (
            <div key={dbKey} className="space-y-4">
              {dbAnns.map(ann => (
                <SpeciesAnnotationTab
                  key={ann.id}
                  annotation={ann}
                  fieldDefinitions={fieldDefs}
                  urlTemplates={urlTemplates}
                />
              ))}
            </div>
          )
        })}

        {/* 国家水稻数据中心标签内容 */}
        {activeTab === 'ricedata' && ricedataId && (() => {
          // 从第一条注释中提取 RiceData 数据
          let ricedata: Record<string, string> = {}
          for (const ann of speciesAnnotations) {
            try {
              const data = JSON.parse(ann.annotation_data || '{}')
              if (data['ricedata_id']) {
                ricedata = data
                break
              }
            } catch {}
          }

          const ricedataFields = [
            { key: 'ontology_phenotype', label: '表型特征', color: 'text-rose-700 bg-rose-50 border-rose-200' },
            { key: 'ontology_molecular_function', label: '分子功能', color: 'text-blue-700 bg-blue-50 border-blue-200' },
            { key: 'ontology_biological_process', label: '生物进程', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
            { key: 'ontology_cellular_component', label: '细胞结构', color: 'text-purple-700 bg-purple-50 border-purple-200' }
          ]

          const hasOntology = ricedataFields.some(f => ricedata[f.key] && ricedata[f.key].trim().length > 0)
          const hasReferences = ricedata['references'] && ricedata['references'].trim().length > 0

          return (
            <div className="space-y-4">
              <div className="bg-white border border-emerald-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-emerald-900">国家水稻数据中心 (ricedata.cn)</h4>
                  <a
                    href={`https://www.ricedata.cn/gene/list/${ricedataId}.htm`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-xs hover:bg-emerald-100 transition-colors"
                  >
                    访问原始页面
                    <ExternalLink size={11} />
                  </a>
                </div>

                {/* 基因名称信息 */}
                <div className="grid grid-cols-2 gap-3 text-xs mb-4">
                  {ricedata['gene_chinese_name'] && (
                    <div>
                      <span className="text-slate-500 font-medium">基因中文名称</span>
                      <p className="text-slate-800 mt-0.5">{ricedata['gene_chinese_name']}</p>
                    </div>
                  )}
                  {ricedata['gene_english_name'] && (
                    <div>
                      <span className="text-slate-500 font-medium">基因英文名称</span>
                      <p className="text-slate-800 mt-0.5">{ricedata['gene_english_name']}</p>
                    </div>
                  )}
                  {ricedata['gene_symbol'] && (
                    <div>
                      <span className="text-slate-500 font-medium">基因符号</span>
                      <p className="text-slate-800 font-mono mt-0.5">{ricedata['gene_symbol']}</p>
                    </div>
                  )}
                  <div>
                    <span className="text-slate-500 font-medium">Ricedata ID</span>
                    <p className="text-slate-800 font-mono mt-0.5">{ricedataId}</p>
                  </div>
                </div>

                {/* ONTOLOGY 及相关基因 */}
                {hasOntology ? (
                  <div className="space-y-3">
                    <h5 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">ONTOLOGY 及相关基因</h5>
                    {ricedataFields.map(field => {
                      const value = ricedata[field.key]
                      if (!value || value.trim().length === 0) return null
                      // 按逗号拆分为独立标签
                      const terms = value.split(/[,，]/).map((s: string) => s.trim()).filter(Boolean)
                      return (
                        <div key={field.key}>
                          <label className="text-xs font-medium text-slate-600">{field.label}</label>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {terms.map((term: string, ti: number) => (
                              <span key={ti} className={`px-1.5 py-0.5 rounded text-[11px] border ${field.color}`}>
                                {term}
                              </span>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <p className="text-xs text-slate-400">尚未从 RiceData 获取 ONTOLOGY 数据</p>
                    <p className="text-xs text-slate-400 mt-1">请点击顶部“从 RiceData 更新”按钮获取最新数据</p>
                  </div>
                )}

                {/* 参考文献 */}
                {hasReferences && (
                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">参考文献</label>
                    <div className="mt-1 p-3 bg-slate-50 rounded-lg text-xs text-slate-700 whitespace-pre-wrap max-h-48 overflow-auto">
                      {ricedata['references']}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {/* 序列管理器标签页（常驻） */}
        {activeTab === 'sequence-manager' && (() => {
          // 汇总所有序列数据
          const seqItems: Array<{ source: string; name: string; molType: string; format: string; length: string; id?: number; seqType?: string }> = []
          const seenAccessions = new Set<string>() // 去重用
          // 1. 基因组序列（纯序列字符串，非 GenBank 格式）
          if (gene.sequence && gene.sequence.length > 0) {
            seqItems.push({ source: 'NCBI 基因组', name: gene.accession_number || gene.gene_name, molType: 'genomic', format: '纯序列', length: `${gene.sequence.length} bp` })
          }
          // 2. 转录本
          for (const tx of transcripts) {
            if (tx.mrna_sequence) {
              seqItems.push({ source: 'NCBI mRNA', name: tx.transcript_id, molType: 'mRNA', format: '纯序列', length: `${tx.mrna_sequence.length} bp`, id: tx.id, seqType: 'mrna' })
              seenAccessions.add(tx.transcript_id)
            }
            if (tx.cds_sequence) {
              seqItems.push({ source: 'NCBI CDS', name: tx.transcript_id, molType: 'CDS', format: '纯序列', length: `${tx.cds_sequence.length} bp` })
            }
            if (tx.protein_sequence) {
              seqItems.push({ source: 'NCBI Protein', name: tx.transcript_id, molType: 'protein', format: '纯序列', length: `${tx.protein_sequence.length} aa`, id: tx.id, seqType: 'protein' })
            }
          }
          // 3. 相关序列（跳过已在转录本中出现的 accession）
          for (const rel of relatedSequences) {
            const acc = rel.nucleotide_accession || rel.protein_accession || ''
            // 去重：跳过已在转录本中显示的，以及自身重复的
            // 注意：MSU:/RAPDB: 前缀的 accession 不能截断版本号（如 MSU:LOC_Os03g49350.1:CDS 是唯一标识）
            if (seenAccessions.has(acc)) continue
            // 仅对 NCBI 风格 accession（无 MSU:/RAPDB: 前缀）做版本号模糊匹配
            if (!acc.startsWith('MSU:') && !acc.startsWith('RAPDB:')) {
              const accBase = acc.split('.')[0]
              if (seenAccessions.has(accBase)) continue
              seenAccessions.add(accBase)
            }
            seenAccessions.add(acc)
            const content = rel.ncbi_content || ''
            const isSkipped = content.startsWith('SKIPPED')
            const hasContent = content.length > 50 && !isSkipped
            // 解析实际序列长度
            let seqLen = 0
            let format = '未下载'
            if (hasContent) {
              if (content.startsWith('LOCUS') || content.includes('ORIGIN')) {
                // GenBank 格式：提取 ORIGIN 后的纯序列
                format = 'GenBank'
                const originIdx = content.indexOf('ORIGIN')
                if (originIdx !== -1) {
                  const seqPart = content.substring(originIdx).replace(/ORIGIN/, '').replace(/\/\//, '').replace(/[\d\s]/g, '')
                  seqLen = seqPart.length
                }
              } else if (content.startsWith('>')) {
                // FASTA 格式：去掉 header 和空白
                format = 'FASTA'
                const seqPart = content.replace(/^>[^\n]*\n?/, '').replace(/\s+/g, '')
                seqLen = seqPart.length
              } else {
                format = '纯序列'
                seqLen = content.replace(/\s+/g, '').length
              }
            } else if (isSkipped) {
              format = '已跳过(过大)'
            }
            const unit = rel.seq_type === 'protein' ? 'aa' : 'bp'
            // 根据 accession 前缀识别来源
            const source = acc.startsWith('MSU:') ? 'MSU' : acc.startsWith('RAPDB:') ? 'RAP-DB' : 'NCBI 相关'
            const displayName = acc.replace(/^(MSU|RAPDB):/, '').replace(/:(CDS|Protein|mRNA)$/, '')
            seqItems.push({ source, name: displayName, molType: rel.seq_type, format, length: seqLen > 0 ? `${seqLen} ${unit}` : '-', id: rel.id, seqType: rel.seq_type })
          }
          // 注：MSU/RAP-DB 序列已在后端 cacheMSUInfo/cacheRAPDBInfo 时保存到 gene_related_sequences，
          // 会通过 section 3（相关序列）自动显示，带 FASTA 内容和 📂 按钮

          return (
            <div>
              <h4 className="text-xs uppercase font-semibold text-slate-400 tracking-wider mb-3">序列管理器 ({seqItems.length} 条序列)</h4>
              {seqItems.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">暂无序列数据，请先通过 NCBI 导入或插件获取</p>
              ) : (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-100">
                        <th className="text-left px-2 py-1.5 font-medium text-slate-600">来源</th>
                        <th className="text-left px-2 py-1.5 font-medium text-slate-600">名称</th>
                        <th className="text-left px-2 py-1.5 font-medium text-slate-600">类型</th>
                        <th className="text-left px-2 py-1.5 font-medium text-slate-600">格式</th>
                        <th className="text-right px-2 py-1.5 font-medium text-slate-600">长度</th>
                        <th className="text-center px-2 py-1.5 font-medium text-slate-600">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {seqItems.map((item, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                          <td className="px-2 py-1">
                            <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${
                              item.source.includes('NCBI') ? 'bg-blue-50 text-blue-600' :
                              item.source.includes('RAP-DB') ? 'bg-indigo-50 text-indigo-600' :
                              item.source.includes('MSU') ? 'bg-sky-50 text-sky-600' : 'bg-slate-100 text-slate-600'
                            }`}>{item.source}</span>
                          </td>
                          <td className="px-2 py-1 font-mono text-slate-700">{item.name}</td>
                          <td className="px-2 py-1 text-slate-600">{item.molType}</td>
                          <td className="px-2 py-1 text-slate-500">{item.format}</td>
                          <td className="px-2 py-1 text-right font-mono text-slate-700">{item.length}</td>
                          <td className="px-2 py-1 text-center">
                            {item.id && item.seqType && (item.source.startsWith('NCBI mRNA') || item.source.startsWith('NCBI Protein')) ? (
                              <button
                                onClick={() => onOpenTranscriptEditor(gene.id, item.id!, item.seqType as 'mrna' | 'protein')}
                                className="p-0.5 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50"
                                title="在编辑器中打开"
                              >📂</button>
                            ) : item.id && item.seqType && onOpenRelatedSeqEditor && (item.source === 'NCBI 相关' || item.source === 'MSU' || item.source === 'RAP-DB') ? (
                              <button
                                onClick={() => onOpenRelatedSeqEditor(gene.id, item.id!, item.seqType as 'genomic' | 'mRNA' | 'protein')}
                                className="p-0.5 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50"
                                title="在编辑器中打开"
                              >📂</button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })()}
      </div>
      </div>
    </div>
  )
}
