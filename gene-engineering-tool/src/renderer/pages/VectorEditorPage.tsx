import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Save, Circle, Minus, List, Map, X, Trash2, Info, GripHorizontal, Eye, EyeOff, Settings, Pipette } from 'lucide-react'
import VectorMapViewer from '../components/VectorMapViewer/VectorMapViewer'
import SequenceEditor, { featureTypeName } from '../components/SequenceEditor/SequenceEditor'
import type { Vector, GenBankFeature, RestrictionEnzyme, FeatureStyles, FeatureShape, FillPattern } from '../../shared/types'
import { FEATURE_TYPE_NAMES } from '../components/SequenceEditor/SequenceEditor'
import { useI18n } from '../hooks/useI18n'
import { serializeSvg, svgToPngDataUrl, pngToJpegDataUrl } from '../utils/export'

interface EnzymeSiteInfo {
  id: number
  enzyme_name?: string
  recognition_sequence?: string
  cut_position?: number
  position: number
  is_unique: boolean
  recog_start: number  // 识别序列起始位置（序列坐标）
  recog_end: number    // 识别序列结束位置（序列坐标）
  strand: 1 | -1       // 1=正链匹配, -1=反链匹配
}

interface EditorData {
  vector: Vector
  features: GenBankFeature[]
  enzymeSites: EnzymeSiteInfo[]
}

interface Props {
  vectorId: number
}

/** 扫描序列中所有酶的识别位点 */
function scanEnzymeSites(sequence: string, enzymes: RestrictionEnzyme[]): EnzymeSiteInfo[] {
  if (!sequence || sequence.length < 4) return []
  const seq = sequence.toLowerCase()
  const isCircular = true // 默认环形可跨越首尾
  const sites: EnzymeSiteInfo[] = []
  const seqLen = seq.length
  // 为环形载体扩展序列（首尾各加30bp）
  const extSeq = isCircular ? seq.slice(-30) + seq + seq.slice(0, 30) : seq
  const offset = isCircular ? 30 : 0

  for (const enzyme of enzymes) {
    const recog = (enzyme.recognition_sequence || '').toLowerCase().replace(/[^atcgnryswkmbdhv]/g, '')
    if (recog.length < 4) continue
    const regex = iupacToRegex(recog)
    let match: RegExpExecArray | null
    regex.lastIndex = 0
    while ((match = regex.exec(extSeq)) !== null) {
      let recogStart = match.index - offset
      if (recogStart < 0) recogStart += seqLen
      if (recogStart >= seqLen) recogStart -= seqLen
      const recogEnd = (recogStart + recog.length - 1) % seqLen
      const cutPos = (recogStart + (enzyme.cut_position || 0)) % seqLen
      sites.push({
        id: sites.length,
        enzyme_name: enzyme.name,
        recognition_sequence: enzyme.recognition_sequence,
        cut_position: enzyme.cut_position,
        position: cutPos,
        is_unique: false,
        recog_start: recogStart,
        recog_end: recogEnd,
        strand: 1 // 正链匹配
      })
    }
    // 同时扫描反义链（reverse complement of recognition sequence）
    const revRecog = recog.split('').map(c => {
      const m: Record<string,string> = {a:'t',t:'a',c:'g',g:'c',r:'y',y:'r',s:'s',w:'w',k:'m',m:'k',b:'v',v:'b',d:'h',h:'d',n:'n'}
      return m[c] || c
    }).reverse().join('')
    if (revRecog !== recog) { // 只有非回文序列才需要扫描反义链
      const revRegex = iupacToRegex(revRecog)
      revRegex.lastIndex = 0
      while ((match = revRegex.exec(extSeq)) !== null) {
        let recogStart = match.index - offset
        if (recogStart < 0) recogStart += seqLen
        if (recogStart >= seqLen) recogStart -= seqLen
        const recogEnd = (recogStart + revRecog.length - 1) % seqLen
        const cutPos = (recogStart + (enzyme.cut_position || 0)) % seqLen
        sites.push({
          id: sites.length,
          enzyme_name: enzyme.name,
          recognition_sequence: enzyme.recognition_sequence,
          cut_position: enzyme.cut_position,
          position: cutPos,
          is_unique: false,
          recog_start: recogStart,
          recog_end: recogEnd,
          strand: -1 // 反义链匹配
        })
      }
    }
  }

  // 更新唯一性
  const countByName: Record<string, number> = {}
  sites.forEach(s => { countByName[s.enzyme_name || ''] = (countByName[s.enzyme_name || ''] || 0) + 1 })
  sites.forEach(s => { s.is_unique = (countByName[s.enzyme_name || ''] || 0) === 1 })

  // 按位置排序
  sites.sort((a, b) => a.position - b.position)
  return sites
}

/** IUPAC 简并碱基转正则 */
function iupacToRegex(seq: string): RegExp {
  const map: Record<string, string> = {
    a: 'a', t: 't', c: 'c', g: 'g',
    r: '[ag]', y: '[ct]', s: '[gc]', w: '[at]',
    k: '[gt]', m: '[ac]', b: '[cgt]', d: '[agt]',
    h: '[act]', v: '[acg]', n: '[atcg]'
  }
  const pattern = seq.split('').map(c => map[c] || c).join('')
  return new RegExp(pattern, 'gi')
}

/** 碱基互补 */
function complement(base: string): string {
  const map: Record<string, string> = {
    a: 't', t: 'a', c: 'g', g: 'c',
    r: 'y', y: 'r', s: 's', w: 'w',
    k: 'm', m: 'k', b: 'v', v: 'b',
    d: 'h', h: 'd', n: 'n', '.': '.', '-': '-'
  }
  return map[base] || base
}

export function getComplement(seq: string): string {
  return seq.split('').map(c => complement(c.toLowerCase())).join('')
}

export function getReverseComplement(seq: string): string {
  return getComplement(seq).split('').reverse().join('')
}

export default function VectorEditorPage({ vectorId }: Props) {
  const { t, language, changeLanguage, featureTypeLabel } = useI18n()
  const [data, setData] = useState<EditorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [viewMode, setViewMode] = useState<'circular' | 'linear'>('circular')
  const [selectedFeature, setSelectedFeature] = useState<number | null>(null)
  const [hoveredFeature, setHoveredFeature] = useState<number | null>(null)
  const [showFeatureList, setShowFeatureList] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [enzymes, setEnzymes] = useState<RestrictionEnzyme[]>([])
  const [showAllEnzymes, setShowAllEnzymes] = useState(false) // 默认只显示唯一酶切位点
  // 通用引物位点（比对后显示在图谱上）
  const [primerSites, setPrimerSites] = useState<any[]>([])
  const [primerScanLoading, setPrimerScanLoading] = useState(false)
  const [showPrimerResultDialog, setShowPrimerResultDialog] = useState(false)
  const [primerResultData, setPrimerResultData] = useState<any[]>([])
  const [primerStyle, setPrimerStyle] = useState<'arrow' | 'line' | 'triangle' | 'flag'>(() => {
    try { const v = localStorage.getItem('primerDisplayStyle'); if (v && ['arrow','line','triangle','flag'].includes(v)) return v as any } catch {}
    return 'arrow'
  })
  const [primerColor, setPrimerColor] = useState<string>(() => {
    try { const v = localStorage.getItem('primerDisplayColor'); if (v) return v } catch {}
    return '#0891b2'
  })
  useEffect(() => { try { localStorage.setItem('primerDisplayStyle', primerStyle) } catch {} }, [primerStyle])
  useEffect(() => { try { localStorage.setItem('primerDisplayColor', primerColor) } catch {} }, [primerColor])
  // 图谱→序列联动选择
  const [mapSelection, setMapSelection] = useState<{ start: number; end: number } | null>(null)
  // 序列→图谱联动选择
  const [seqSelection, setSeqSelection] = useState<{ start: number; end: number } | null>(null)
  const [seqInsertPos, setSeqInsertPos] = useState<number | null>(null)
  const [seqHoverPos, setSeqHoverPos] = useState<number | null>(null)
  const handleSeqSelectionChange = useCallback((sel: { start: number; end: number } | null, insPos: number | null) => {
    setSeqSelection(sel)
    setSeqInsertPos(insPos)
  }, [])
  // RAF 节流 hover 回调：每帧最多更新一次，避免 mousemove 过频触发图谱重渲染
  const hoverRafRef = useRef<number>(0)
  const hoverPendingRef = useRef<number | null>(null)
  const handleSeqHoverPosition = useCallback((pos: number | null) => {
    hoverPendingRef.current = pos
    if (hoverRafRef.current) return // 已有待执行的 RAF
    hoverRafRef.current = requestAnimationFrame(() => {
      setSeqHoverPos(hoverPendingRef.current)
      hoverRafRef.current = 0
    })
  }, [])
  // hover位置优先显示，无hover时用光标位置
  const displayInsertPos = seqHoverPos ?? seqInsertPos
  const [showStyleDialog, setShowStyleDialog] = useState(false)
  // 缩放控制（由父组件管理，传给 VectorMapViewer）
  const [zoom, setZoom] = useState(1)
  // SVG ref 用于导出
  const mapSvgRef = useRef<SVGSVGElement | null>(null)
  const handleSvgRef = useCallback((el: SVGSVGElement | null) => {
    mapSvgRef.current = el
  }, [])
  // DPI 导出对话框
  const [showDpiDialog, setShowDpiDialog] = useState(false)
  const [pendingExportFormat, setPendingExportFormat] = useState<string | null>(null)
  // 酶切位点设置
  const [showEnzymeSettings, setShowEnzymeSettings] = useState(false)
  const [hiddenEnzymes, setHiddenEnzymes] = useState<Set<string>>(new Set())
  const [enzymeFontSize, setEnzymeFontSize] = useState(7)
  // 图谱全局字体和图例设置（从 localStorage 恢复）
  const [mapFontSize, setMapFontSize] = useState(() => {
    try { const v = localStorage.getItem('vectorMapFontSize'); if (v) return Number(v) } catch {}
    return 12
  })
  const [legendScale, setLegendScale] = useState(() => {
    try { const v = localStorage.getItem('vectorLegendScale'); if (v) return Number(v) } catch {}
    return 1
  })
  useEffect(() => {
    try { localStorage.setItem('vectorMapFontSize', String(mapFontSize)) } catch {}
  }, [mapFontSize])
  useEffect(() => {
    try { localStorage.setItem('vectorLegendScale', String(legendScale)) } catch {}
  }, [legendScale])
  // 元件标签字号和元件粗细
  const [featureFontSize, setFeatureFontSize] = useState(() => {
    try { const v = localStorage.getItem('vectorFeatureFontSize'); if (v) return Number(v) } catch {}
    return 10
  })
  const [featureHeight, setFeatureHeight] = useState(() => {
    try { const v = localStorage.getItem('vectorFeatureHeight'); if (v) return Number(v) } catch {}
    return 22
  })
  useEffect(() => {
    try { localStorage.setItem('vectorFeatureFontSize', String(featureFontSize)) } catch {}
  }, [featureFontSize])
  useEffect(() => {
    try { localStorage.setItem('vectorFeatureHeight', String(featureHeight)) } catch {}
  }, [featureHeight])

  // 元件自定义样式（默认值）
  const defaultFeatureStyles: FeatureStyles = useMemo(() => ({
    gene: { color: '#10b981', shape: 'arrow', fill: 'solid' },
    CDS: { color: '#3b82f6', shape: 'arrow', fill: 'solid' },
    mRNA: { color: '#06b6d4', shape: 'wave', fill: 'solid' },
    promoter: { color: '#f59e0b', shape: 'bent-arrow', fill: 'solid' },
    terminator: { color: '#ef4444', shape: 'box', fill: 'solid' },
    rep_origin: { color: '#8b5cf6', shape: 'box', fill: 'striped' },
    misc_feature: { color: '#94a3b8', shape: 'box', fill: 'solid' },
    primer_bind: { color: '#ec4899', shape: 'box', fill: 'solid' },
    protein_bind: { color: '#6366f1', shape: 'box-arrow', fill: 'solid' },
    regulatory: { color: '#f97316', shape: 'bent-arrow', fill: 'solid' },
    enhancer: { color: '#fbbf24', shape: 'box', fill: 'dotted' },
    exon: { color: '#14b8a6', shape: 'box-arrow', fill: 'solid' },
    intron: { color: '#a3a3a3', shape: 'box', fill: 'hollow' },
  }), [])
  const [featureStyles, setFeatureStyles] = useState<FeatureStyles>(() => {
    try {
      const saved = localStorage.getItem('vectorMapFeatureStyles')
      if (saved) return { ...defaultFeatureStyles, ...JSON.parse(saved) }
    } catch {}
    return defaultFeatureStyles
  })
  // 持久化元件样式设置
  useEffect(() => {
    try { localStorage.setItem('vectorMapFeatureStyles', JSON.stringify(featureStyles)) } catch {}
  }, [featureStyles])

  // 可拖拽分栏
  const containerRef = useRef<HTMLDivElement>(null)
  const [mapHeight, setMapHeight] = useState(0.55) // 图谱占 55%
  const [isDragging, setIsDragging] = useState(false)

  const handleDragStart = useCallback(() => { setIsDragging(true) }, [])
  useEffect(() => {
    if (!isDragging) return
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const ratio = (e.clientY - rect.top) / rect.height
      setMapHeight(Math.max(0.2, Math.min(0.8, ratio)))
    }
    const onUp = () => setIsDragging(false)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [isDragging])

  // 加载数据
  useEffect(() => {
    (async () => {
      try {
        const [result, enzymeList] = await Promise.all([
          window.api.getEditorData(vectorId),
          window.api.getEnzymes()
        ])
        if (!result) { setError(t('editor.vectorNotFound')); setLoading(false); return }
        setEnzymes(enzymeList || [])
        const scannedSites = scanEnzymeSites(result.vector.sequence || '', enzymeList || [])
        const mergedSites = scannedSites.length > 0 ? scannedSites : result.enzymeSites
        setData({ ...result, enzymeSites: mergedSites })
      } catch (e: any) {
        setError(e.message || t('editor.loadFailed'))
      }
      setLoading(false)
    })()
  }, [vectorId])

  // 关闭前检测未保存更改
  // 同步脏状态到主进程 + 监听保存并关闭命令
  useEffect(() => {
    if (window.api.setEditorDirty) {
      window.api.setEditorDirty(dirty)
    }
  }, [dirty])

  // 监听主进程的保存并关闭命令
  useEffect(() => {
    if (!window.api.onSaveAndClose) return
    const cleanup = window.api.onSaveAndClose(async () => {
      if (dirty && data) {
        await window.api.saveSequence(vectorId, data.vector.sequence)
      }
    })
    return cleanup
  }, [dirty, data, vectorId])

  // 导出处理函数
  const handleExport = useCallback(async (format: string) => {
    if (!mapSvgRef.current) return
    const svgEl = mapSvgRef.current
    const defaultName = data?.vector.name || 'vector-map'

    if (format === 'svg') {
      const svgContent = serializeSvg(svgEl)
      await window.api.exportSvg(svgContent, defaultName)
    } else if (format === 'pdf') {
      const svgContent = serializeSvg(svgEl)
      await window.api.exportPdf(svgContent, defaultName)
    } else {
      // PNG, JPG, BMP, TIF — show DPI dialog
      setPendingExportFormat(format)
      setShowDpiDialog(true)
    }
  }, [data])

  const handleExportWithDpi = useCallback(async (dpi: number) => {
    if (!mapSvgRef.current || !pendingExportFormat) return
    setShowDpiDialog(false)
    const svgEl = mapSvgRef.current
    const defaultName = data?.vector.name || 'vector-map'

    let dataUrl = await svgToPngDataUrl(svgEl, dpi)
    if (pendingExportFormat === 'jpg' || pendingExportFormat === 'jpeg') {
      dataUrl = await pngToJpegDataUrl(dataUrl)
    }
    await window.api.exportImage(pendingExportFormat, dataUrl, defaultName)
    setPendingExportFormat(null)
  }, [pendingExportFormat, data])

  // 监听菜单操作
  useEffect(() => {
    if (!window.api.onMenuAction) return
    const cleanup = window.api.onMenuAction((action: string) => {
      switch (action) {
        case 'view-circular': setViewMode('circular'); break
        case 'view-linear': setViewMode('linear'); break
        case 'show-style-dialog': setShowStyleDialog(prev => !prev); break
        case 'show-enzyme-settings': setShowEnzymeSettings(prev => !prev); break
        case 'zoom-in': setZoom(z => Math.min(z + 0.1, 3)); break
        case 'zoom-out': setZoom(z => Math.max(z - 0.1, 0.3)); break
        case 'zoom-reset': setZoom(1); break
        case 'save-as-genbank': window.api.saveAsGenBank(vectorId); break
        case 'save-as-fasta': window.api.saveAsFasta(vectorId); break
        case 'open-file': window.api.openFile(); break
        case 'set-language-zh': changeLanguage('zh'); break
        case 'set-language-en': changeLanguage('en'); break
        case 'export-svg': handleExport('svg'); break
        case 'export-pdf': handleExport('pdf'); break
        case 'export-png': handleExport('png'); break
        case 'export-jpg': handleExport('jpg'); break
        case 'export-bmp': handleExport('bmp'); break
        case 'export-tif': handleExport('tif'); break
      }
    })
    return cleanup
  }, [vectorId, changeLanguage, handleExport])

  // 序列修改 → 重新扫描酶切位点 + 自动调整元件位置
  const handleSequenceChange = useCallback((newSeq: string, adjustment?: {
    type: 'delete', start: number, end: number, keepFeatures: boolean
  } | {
    type: 'insert', position: number, length: number
  }) => {
    if (!data) return
    let adjustedFeatures = data.features

    if (adjustment) {
      if (adjustment.type === 'delete') {
        const { start: delLo, end: delHi, keepFeatures } = adjustment
        const delLen = delHi - delLo + 1
        if (keepFeatures) {
          // 保留元件：调整位置
          adjustedFeatures = data.features
            .filter(f => {
              // 完全在删除区内的元件，标记为移除
              return !(f.start >= delLo && f.end <= delHi)
            })
            .map(f => {
              let newStart = f.start
              let newEnd = f.end
              if (f.start > delHi) {
                // 元件完全在删除区后面，整体左移
                newStart -= delLen
                newEnd -= delLen
              } else if (f.end < delLo) {
                // 元件完全在删除区前面，不变
              } else if (f.start >= delLo && f.end > delHi) {
                // 元件起始在删除区内，缩小
                newStart = delLo
                newEnd -= delLen
              } else if (f.start < delLo && f.end <= delHi) {
                // 元件结束在删除区内，缩小
                newEnd = delLo - 1
              } else if (f.start < delLo && f.end > delHi) {
                // 元件跨越整个删除区，缩小
                newEnd -= delLen
              }
              if (newEnd < newStart) newEnd = newStart
              return { ...f, start: newStart, end: newEnd, location: `${newStart + 1}..${newEnd + 1}` }
            })
        } else {
          // 不保留元件：删除受影响元件 + 调整剩余元件位置
          adjustedFeatures = data.features
            .filter(f => !(f.end >= delLo && f.start <= delHi))
            .map(f => {
              if (f.start > delHi) {
                const newStart = f.start - delLen
                const newEnd = f.end - delLen
                return { ...f, start: newStart, end: newEnd, location: `${newStart + 1}..${newEnd + 1}` }
              }
              return f
            })
        }
      } else if (adjustment.type === 'insert') {
        const { position, length } = adjustment
        adjustedFeatures = data.features.map(f => {
          if (f.start >= position) {
            const newStart = f.start + length
            const newEnd = f.end + length
            return { ...f, start: newStart, end: newEnd, location: `${newStart + 1}..${newEnd + 1}` }
          } else if (f.end >= position) {
            // 元件跨越插入点，扩展结束位置
            const newEnd = f.end + length
            return { ...f, end: newEnd, location: `${f.start + 1}..${newEnd + 1}` }
          }
          return f
        })
      }
    }

    const newSites = scanEnzymeSites(newSeq, enzymes)
    setData({
      ...data,
      vector: { ...data.vector, sequence: newSeq, size_bp: newSeq.length },
      features: adjustedFeatures,
      enzymeSites: newSites
    })
    setDirty(true)
  }, [data, enzymes])

  // 添加元件
  const handleAddFeature = useCallback((feature: GenBankFeature) => {
    if (!data) return
    setData({ ...data, features: [...data.features, feature] })
    setDirty(true)
  }, [data])

  // 删除元件
  const handleDeleteFeature = useCallback((index: number) => {
    if (!data) return
    const newFeatures = [...data.features]
    newFeatures.splice(index, 1)
    setData({ ...data, features: newFeatures })
    if (selectedFeature === index) setSelectedFeature(null)
    else if (selectedFeature !== null && selectedFeature > index) setSelectedFeature(selectedFeature - 1)
    setDirty(true)
  }, [data, selectedFeature])

  // 保存
  const handleSave = useCallback(async () => {
    if (!data) return
    await window.api.saveSequence(vectorId, data.vector.sequence)
    setDirty(false)
    setSaveMsg(t('editor.saved'))
    setTimeout(() => setSaveMsg(''), 2000)
  }, [data, vectorId])

  // 图谱点击元件 → 设置序列选择
  const handleMapSelectFeature = useCallback((idx: number | null) => {
    setSelectedFeature(idx)
    if (idx !== null && data && data.features[idx]) {
      const f = data.features[idx]
      setMapSelection({ start: f.start, end: f.end })
    } else {
      setMapSelection(null)
    }
  }, [data])

  // 图谱点击酶切位点 → 设置序列选择
  const handleMapSelectEnzymeSite = useCallback((site: EnzymeSiteInfo | null) => {
    if (site) {
      const pos = site.position
      const recogLen = (site.recognition_sequence || '').length || 6
      setMapSelection({ start: pos, end: pos + recogLen - 1 })
    } else {
      setMapSelection(null)
    }
  }, [])

  if (loading) {
    return <div className="flex items-center justify-center h-screen bg-slate-50"><div className="text-slate-400 text-sm">{t('editor.loading')}</div></div>
  }
  if (error || !data) {
    return <div className="flex items-center justify-center h-screen bg-slate-50"><div className="text-red-500 text-sm">{error || t('editor.loadFailed')}</div></div>
  }

  const { vector, features, enzymeSites } = data
  const selectedFeat = selectedFeature !== null ? features[selectedFeature] : null
  // 根据设置过滤酶切位点（显示所有/仅唯一 + 隐藏酶切位点）
  const displayEnzymeSites = (showAllEnzymes ? enzymeSites : enzymeSites.filter(s => s.is_unique))
    .filter(s => !hiddenEnzymes.has(s.enzyme_name || ''))

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* 顶部工具栏 */}
      <header className="h-12 bg-white border-b border-slate-200 flex items-center px-4 flex-shrink-0 gap-3">
        <h1 className="text-sm font-bold text-slate-800 truncate max-w-[200px]">{vector.name}</h1>
        <span className="text-xs text-slate-400">{vector.size_bp?.toLocaleString()} bp</span>
        <span className={`px-1.5 py-0.5 text-[10px] rounded ${vector.topology === 'circular' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>
          {vector.topology === 'circular' ? t('editor.topology.circular') : t('editor.topology.linear')}
        </span>
        <div className="w-px h-5 bg-slate-200" />
        <div className="flex border border-slate-200 rounded overflow-hidden">
          <button onClick={() => setViewMode('circular')}
            className={`px-2.5 py-1 text-xs flex items-center gap-1 ${viewMode === 'circular' ? 'bg-violet-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            <Circle size={12} /> {t('editor.view.circular')}
          </button>
          <button onClick={() => setViewMode('linear')}
            className={`px-2.5 py-1 text-xs flex items-center gap-1 ${viewMode === 'linear' ? 'bg-violet-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            <Minus size={12} /> {t('editor.view.linear')}
          </button>
        </div>
        <button onClick={() => setShowFeatureList(!showFeatureList)}
          className={`px-2.5 py-1 text-xs border rounded flex items-center gap-1 ${showFeatureList ? 'bg-slate-100' : ''}`}>
          <List size={12} /> {t('editor.featureList')}
        </button>
        <button onClick={() => setShowAllEnzymes(!showAllEnzymes)}
          className={`px-2.5 py-1 text-xs border rounded flex items-center gap-1 ${showAllEnzymes ? 'bg-emerald-100 text-emerald-700' : 'text-slate-600 hover:bg-slate-50'}`}>
          {showAllEnzymes ? <Eye size={12} /> : <EyeOff size={12} />} {showAllEnzymes ? t('editor.showAllEnzymes') : t('editor.uniqueEnzymesOnly')}
        </button>
        <button onClick={() => setShowStyleDialog(!showStyleDialog)}
          className="px-2.5 py-1 text-xs border rounded flex items-center gap-1 text-slate-600 hover:bg-slate-50">
          <Settings size={12} /> {t('editor.styleSettings')}
        </button>
        <button onClick={() => setShowEnzymeSettings(!showEnzymeSettings)}
          className={`px-2.5 py-1 text-xs border rounded flex items-center gap-1 ${showEnzymeSettings ? 'bg-violet-100 text-violet-700' : 'text-slate-600 hover:bg-slate-50'}`}>
          <Settings size={12} /> {t('editor.enzymeSettings')}
        </button>
        <button
          onClick={async () => {
            if (primerScanLoading) return
            setPrimerScanLoading(true)
            try {
              const seq = vector.sequence || ''
              if (!seq) {
                alert(t('editor.noSequence'))
                return
              }
              const sites = await window.api.scanVectorForPrimers(seq)
              setPrimerSites(sites)
              if (sites.length === 0) {
                alert(t('editor.noPrimerMatch'))
              } else {
                // 计算每个引物下游1000bp内的元件
                const seqLen = vector.size_bp || seq.length
                const resultData = sites.map((site: any) => {
                  const pos = site.position - 1 // 转为0-based
                  const downstreamEnd = site.strand === 1
                    ? (pos + site.sequence.length + 1000) % seqLen
                    : (pos - 1000 + seqLen) % seqLen
                  const downstreamStart = site.strand === 1
                    ? pos + site.sequence.length
                    : pos
                  // 查找下游1000bp内的元件
                  const nearbyFeatures = features.filter(f => {
                    const fStart = f.start
                    const fEnd = f.end
                    if (site.strand === 1) {
                      // 正向：引物结束位置到结束+1000
                      const rangeStart = downstreamStart
                      const rangeEnd = downstreamEnd
                      if (rangeEnd > rangeStart) {
                        return fEnd > rangeStart && fStart < rangeEnd
                      } else {
                        // 跨越原点
                        return fEnd > rangeStart || fStart < rangeEnd
                      }
                    } else {
                      // 反向：引物起始位置到起始-1000
                      const rangeStart = downstreamEnd
                      const rangeEnd = downstreamStart
                      if (rangeEnd > rangeStart) {
                        return fEnd > rangeStart && fStart < rangeEnd
                      } else {
                        return fEnd > rangeStart || fStart < rangeEnd
                      }
                    }
                  })
                  return {
                    ...site,
                    nearbyFeatures: nearbyFeatures.slice(0, 10)
                  }
                })
                setPrimerResultData(resultData)
                setShowPrimerResultDialog(true)
              }
            } catch (e: any) {
              console.error('Primer scan error:', e)
              alert(e.message || '引物比对失败')
            } finally {
              setPrimerScanLoading(false)
            }
          }}
          disabled={primerScanLoading}
          className={`px-2.5 py-1 text-xs border rounded flex items-center gap-1 ${primerSites.length > 0 ? 'bg-cyan-100 text-cyan-700' : 'text-slate-600 hover:bg-slate-50'}`}>
          <Pipette size={12} /> {primerScanLoading ? '比对中...' : primerSites.length > 0 ? `${t('editor.scanPrimers')} (${primerSites.length})` : t('editor.scanPrimers')}
        </button>
        <div className="flex-1" />
        {dirty && <span className="text-xs text-amber-500">{t('editor.unsaved')}</span>}
        {saveMsg && <span className="text-xs text-green-600">{saveMsg}</span>}
        <button onClick={handleSave}
          className="px-3 py-1.5 bg-green-600 text-white rounded text-xs flex items-center gap-1 hover:bg-green-500">
          <Save size={12} /> {t('editor.saveSequence')}
        </button>
      </header>

      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        <div ref={containerRef} className={`flex-1 flex flex-col overflow-hidden ${isDragging ? 'cursor-row-resize' : ''}`}>
          {/* 图谱区域 */}
          <div className="overflow-auto bg-white" style={{ height: `${mapHeight * 100}%`, flexShrink: 0 }}>
            <VectorMapViewer
              sequence={vector.sequence || ''}
              size={vector.size_bp || 0}
              name={vector.name}
              topology={vector.topology || 'circular'}
              features={features}
              enzymeSites={displayEnzymeSites}
              primerSites={primerSites}
              primerStyle={primerStyle}
              primerColor={primerColor}
              viewMode={viewMode}
              selectedFeature={selectedFeature}
              onSelectFeature={handleMapSelectFeature}
              hoveredFeature={hoveredFeature}
              onHoverFeature={setHoveredFeature}
              onSelectEnzymeSite={handleMapSelectEnzymeSite}
              featureStyles={featureStyles}
              sequenceSelection={seqSelection}
              sequenceInsertPos={displayInsertPos}
              enzymeFontSize={enzymeFontSize}
              mapFontSize={mapFontSize}
              legendScale={legendScale}
              featureFontSize={featureFontSize}
              featureHeight={featureHeight}
              onSvgRef={handleSvgRef}
              zoom={zoom}
              onZoomChange={setZoom}
            />
          </div>

          {/* 拖拽分隔条 */}
          <div
            onMouseDown={handleDragStart}
            className={`flex items-center justify-center h-3 border-t border-b border-slate-200 bg-slate-100 cursor-row-resize hover:bg-violet-100 transition-colors flex-shrink-0 select-none`}>
            <GripHorizontal size={14} className="text-slate-400" />
          </div>

          {/* 序列编辑器 */}
          <div className="flex-1 overflow-hidden">
            <SequenceEditor
              sequence={vector.sequence || ''}
              features={features}
              enzymeSites={displayEnzymeSites}
              primerSites={primerSites}
              onSequenceChange={handleSequenceChange}
              onAddFeature={handleAddFeature}
              onDeleteFeature={handleDeleteFeature}
              selectedFeature={selectedFeature}
              onSelectFeature={setSelectedFeature}
              hoveredFeature={hoveredFeature}
              mapSelection={mapSelection}
              onClearMapSelection={() => setMapSelection(null)}
              onSelectionChange={handleSeqSelectionChange}
              onHoverPosition={handleSeqHoverPosition}
            />
          </div>
        </div>

        {/* 右侧：元件面板 */}
        {showFeatureList && (
          <aside className="w-72 bg-white border-l border-slate-200 flex flex-col flex-shrink-0 overflow-hidden">
            {selectedFeat && selectedFeature !== null ? (
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
                  <h3 className="text-xs font-bold text-slate-700">{t('editor.featureDetail')}</h3>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleDeleteFeature(selectedFeature)}
                      className="p-1 text-red-400 hover:text-red-600" title={t('editor.deleteFeature')}>
                      <Trash2 size={12} />
                    </button>
                    <button onClick={() => setSelectedFeature(null)}
                      className="p-1 text-slate-400 hover:text-slate-600"><X size={12} /></button>
                  </div>
                </div>
                <div className="flex-1 overflow-auto px-3 py-2 space-y-2 text-xs">
                  <DetailRow label={t('editor.featureType')} value={featureTypeName(selectedFeat.type)} />
                  <DetailRow label={t('editor.featurePosition')} value={`${selectedFeat.start + 1}..${selectedFeat.end + 1}`} />
                  <DetailRow label={t('editor.featureLength')} value={`${selectedFeat.end - selectedFeat.start + 1} bp`} />
                  <DetailRow label={t('editor.featureStrand')} value={selectedFeat.strand === 1 ? t('editor.strand.forward') : t('editor.strand.reverse')} />
                  <DetailRow label={t('editor.featureLocation')} value={selectedFeat.location} />
                  {Object.entries(selectedFeat.qualifiers).map(([k, v]) => (
                    <DetailRow key={k} label={k} value={v} />
                  ))}
                  {vector.sequence && (
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase">{t('editor.featureSequence')}</label>
                      <div className="mt-1 bg-slate-50 p-2 rounded font-mono text-[10px] text-slate-600 max-h-20 overflow-auto break-all">
                        {vector.sequence.substring(selectedFeat.start, Math.min(selectedFeat.end + 1, selectedFeat.start + 200))}
                        {selectedFeat.end - selectedFeat.start > 200 && '...'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="px-3 py-2 border-b border-slate-200">
                  <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1">
                    <Info size={12} /> {t('editor.featureList')} ({features.length})
                  </h3>
                </div>
                <div className="flex-1 overflow-auto">
                  {features.length === 0 ? (
                    <div className="text-xs text-slate-400 text-center py-8">{t('editor.noFeatures')}</div>
                  ) : (
                    features.map((f, i) => {
                      const label = f.qualifiers.label || f.qualifiers.gene || f.qualifiers.product || f.type
                      const isSelected = selectedFeature === i
                      const isHovered = hoveredFeature === i
                      return (
                        <div key={i}
                          onClick={() => { setSelectedFeature(i); handleMapSelectFeature(i) }}
                          onMouseEnter={() => setHoveredFeature(i)}
                          onMouseLeave={() => setHoveredFeature(null)}
                          className={`px-3 py-2 cursor-pointer border-b border-slate-50 text-xs
                            ${isSelected ? 'bg-violet-50' : isHovered ? 'bg-slate-50' : ''}`}>
                          <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: getColor(f.type) }} />
                            <span className="font-medium text-slate-700 truncate flex-1">{label}</span>
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteFeature(i) }}
                              className="p-0.5 text-slate-300 hover:text-red-500"><X size={10} /></button>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {featureTypeName(f.type)} | {f.start + 1}..{f.end + 1} | {f.strand === 1 ? '+' : '-'}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </>
            )}
          </aside>
        )}
      </div>

      {/* 图示设置对话框 */}
      {showStyleDialog && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[9999]" onClick={() => setShowStyleDialog(false)}>
          <div className="bg-white rounded-xl p-5 w-[560px] shadow-2xl max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-bold text-sm">{t('settings.title')}</h4>
              <button onClick={() => setShowStyleDialog(false)} className="p-1 text-slate-400 hover:text-slate-600"><X size={14} /></button>
            </div>
            <p className="text-xs text-slate-500 mb-3">{t('settings.description')}</p>
            {/* 全局字体大小 */}
            <div className="mb-4 p-3 bg-violet-50 rounded-lg">
              <label className="text-xs font-medium text-slate-700 block mb-2">{t('settings.mapFontSize')}</label>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-slate-400">{t('settings.rangeSmall')}</span>
                <input type="range" min={5} max={64} step={0.5} value={mapFontSize}
                  onChange={e => setMapFontSize(Number(e.target.value))}
                  className="flex-1" />
                <span className="text-[10px] text-slate-400">{t('settings.rangeLarge')}</span>
                <span className="text-xs text-slate-500 w-10 text-right">{mapFontSize}px</span>
              </div>
            </div>
            {/* 图例大小 */}
            <div className="mb-4 p-3 bg-violet-50 rounded-lg">
              <label className="text-xs font-medium text-slate-700 block mb-2">{t('settings.legendScale')}</label>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-slate-400">{t('settings.rangeSmall')}</span>
                <input type="range" min={0.5} max={2} step={0.1} value={legendScale}
                  onChange={e => setLegendScale(Number(e.target.value))}
                  className="flex-1" />
                <span className="text-[10px] text-slate-400">{t('settings.rangeLarge')}</span>
                <span className="text-xs text-slate-500 w-10 text-right">{(legendScale * 100).toFixed(0)}%</span>
              </div>
            </div>
            {/* 元件标签字号 */}
            <div className="mb-4 p-3 bg-violet-50 rounded-lg">
              <label className="text-xs font-medium text-slate-700 block mb-2">{t('settings.featureFontSize')}</label>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-slate-400">{t('settings.rangeSmall')}</span>
                <input type="range" min={5} max={64} step={0.5} value={featureFontSize}
                  onChange={e => setFeatureFontSize(Number(e.target.value))}
                  className="flex-1" />
                <span className="text-[10px] text-slate-400">{t('settings.rangeLarge')}</span>
                <span className="text-xs text-slate-500 w-10 text-right">{featureFontSize}px</span>
              </div>
            </div>
            {/* 元件粗细（高度） */}
            <div className="mb-4 p-3 bg-violet-50 rounded-lg">
              <label className="text-xs font-medium text-slate-700 block mb-2">{t('settings.featureHeight')}</label>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-slate-400">{t('settings.rangeThin')}</span>
                <input type="range" min={10} max={80} step={1} value={featureHeight}
                  onChange={e => setFeatureHeight(Number(e.target.value))}
                  className="flex-1" />
                <span className="text-[10px] text-slate-400">{t('settings.rangeThick')}</span>
                <span className="text-xs text-slate-500 w-10 text-right">{featureHeight}px</span>
              </div>
            </div>
            {/* 引物图示样式 */}
            <div className="mb-4 p-3 bg-cyan-50 rounded-lg">
              <label className="text-xs font-medium text-slate-700 block mb-2">{t('settings.primerStyleTitle')}</label>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-slate-500">{t('settings.primerShape')}</label>
                  <select value={primerStyle} onChange={e => setPrimerStyle(e.target.value as any)}
                    className="text-xs border rounded px-2 py-1">
                    <option value="arrow">{t('settings.primerShape.arrow')}</option>
                    <option value="line">{t('settings.primerShape.line')}</option>
                    <option value="triangle">{t('settings.primerShape.triangle')}</option>
                    <option value="flag">{t('settings.primerShape.flag')}</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-slate-500">{t('settings.color')}</label>
                  <input type="color" value={primerColor} onChange={e => setPrimerColor(e.target.value)}
                    className="w-7 h-7 rounded border cursor-pointer" />
                </div>
                {/* 引物样式预览 */}
                <svg width="60" height="20" viewBox="0 0 60 20">
                  {primerStyle === 'arrow' && (
                    <>
                      <line x1="5" y1="10" x2="40" y2="10" stroke={primerColor} strokeWidth={1.5} />
                      <polygon points={`45,10 38,6 38,14`} fill={primerColor} />
                      <text x="48" y="10" fontSize="7" fill={primerColor} dominantBaseline="middle">F</text>
                    </>
                  )}
                  {primerStyle === 'line' && (
                    <>
                      <line x1="5" y1="10" x2="45" y2="10" stroke={primerColor} strokeWidth={2} />
                      <text x="48" y="10" fontSize="7" fill={primerColor} dominantBaseline="middle">F</text>
                    </>
                  )}
                  {primerStyle === 'triangle' && (
                    <>
                      <polygon points="25,4 35,10 25,16" fill={primerColor} />
                      <text x="40" y="10" fontSize="7" fill={primerColor} dominantBaseline="middle">F</text>
                    </>
                  )}
                  {primerStyle === 'flag' && (
                    <>
                      <line x1="10" y1="4" x2="10" y2="16" stroke={primerColor} strokeWidth={1.5} />
                      <rect x="10" y="4" width="18" height="8" fill={primerColor} rx={1} />
                      <text x="32" y="10" fontSize="7" fill={primerColor} dominantBaseline="middle">F</text>
                    </>
                  )}
                </svg>
              </div>
            </div>
            <div className="space-y-2">
              {[...new Set(features.map(f => f.type))].map(type => {
                const style = featureStyles[type] || { color: '#cbd5e1', shape: 'box' as FeatureShape, fill: 'solid' as FillPattern }
                return (
                  <div key={type} className="flex items-center gap-3 p-2 bg-slate-50 rounded">
                    <span className="w-28 text-xs font-medium text-slate-700 truncate">{featureTypeLabel(type)}</span>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-slate-500">{t('settings.color')}</label>
                      <input type="color" value={style.color} onChange={e => setFeatureStyles(s => ({ ...s, [type]: { ...style, color: e.target.value } }))}
                        className="w-7 h-7 rounded border cursor-pointer" />
                    </div>
                    <div className="flex items-center gap-1">
                      <label className="text-[10px] text-slate-500">{t('settings.shape')}</label>
                      <select value={style.shape} onChange={e => setFeatureStyles(s => ({ ...s, [type]: { ...style, shape: e.target.value as FeatureShape } }))}
                        className="text-xs border rounded px-1.5 py-1">
                        <option value="arrow">{t('settings.shape.arrow')}</option>
                        <option value="box">{t('settings.shape.box')}</option>
                        <option value="box-arrow">{t('settings.shape.box-arrow')}</option>
                        <option value="bent-arrow">{t('settings.shape.bent-arrow')}</option>
                        <option value="bent-arrow-up">{t('settings.shape.bent-arrow-up')}</option>
                        <option value="big-arrow">{t('settings.shape.big-arrow')}</option>
                        <option value="wave">{t('settings.shape.wave')}</option>
                        <option value="line">{t('settings.shape.line')}</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-1">
                      <label className="text-[10px] text-slate-500">{t('settings.fill')}</label>
                      <select value={style.fill} onChange={e => setFeatureStyles(s => ({ ...s, [type]: { ...style, fill: e.target.value as FillPattern } }))}
                        className="text-xs border rounded px-1.5 py-1">
                        <option value="solid">{t('settings.fill.solid')}</option>
                        <option value="striped">{t('settings.fill.striped')}</option>
                        <option value="hollow">{t('settings.fill.hollow')}</option>
                        <option value="dotted">{t('settings.fill.dotted')}</option>
                        <option value="crosshatch">{t('settings.fill.crosshatch')}</option>
                        <option value="horizontal">{t('settings.fill.horizontal')}</option>
                      </select>
                    </div>
                    {/* 预览 */}
                    <svg width="40" height="16" viewBox="0 0 40 16">
                      <FeaturePreview shape={style.shape} color={style.color} fill={style.fill} />
                    </svg>
                  </div>
                )
              })}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => { setFeatureStyles(defaultFeatureStyles); setMapFontSize(12); setLegendScale(1); setFeatureFontSize(10); setFeatureHeight(22); setPrimerStyle('arrow'); setPrimerColor('#0891b2') }}
                className="px-3 py-1.5 text-xs border rounded text-slate-600 hover:bg-slate-50">{t('settings.resetDefaults')}</button>
              <button onClick={() => setShowStyleDialog(false)}
                className="px-3 py-1.5 text-xs bg-violet-600 text-white rounded hover:bg-violet-500">{t('settings.ok')}</button>
            </div>
          </div>
        </div>
      )}
      {showEnzymeSettings && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[9999]" onClick={() => setShowEnzymeSettings(false)}>
          <div className="bg-white rounded-xl p-5 w-[480px] shadow-2xl max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-bold text-sm">{t('enzymeSettings.title')}</h4>
              <button onClick={() => setShowEnzymeSettings(false)} className="p-1 text-slate-400 hover:text-slate-600"><X size={14} /></button>
            </div>
            {/* 字体大小 */}
            <div className="mb-4">
              <label className="text-xs font-medium text-slate-700 block mb-2">{t('enzymeSettings.fontSize')}</label>
              <div className="flex items-center gap-3">
                <input type="range" min={5} max={64} step={0.5} value={enzymeFontSize}
                  onChange={e => setEnzymeFontSize(Number(e.target.value))}
                  className="flex-1" />
                <span className="text-xs text-slate-500 w-10 text-right">{enzymeFontSize}px</span>
              </div>
            </div>
            {/* 显示/隐藏酶切位点 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-slate-700">{t('enzymeSettings.whichToShow')}</label>
                <div className="flex gap-2">
                  <button onClick={() => setHiddenEnzymes(new Set())}
                    className="px-2 py-0.5 text-[10px] border rounded text-slate-500 hover:bg-slate-50">{t('enzymeSettings.showAll')}</button>
                  <button onClick={() => {
                    const names = [...new Set(enzymeSites.map(s => s.enzyme_name || ''))]
                    setHiddenEnzymes(new Set(names))
                  }}
                    className="px-2 py-0.5 text-[10px] border rounded text-slate-500 hover:bg-slate-50">{t('enzymeSettings.hideAll')}</button>
                </div>
              </div>
              <div className="space-y-1 max-h-[40vh] overflow-auto border rounded p-2">
                {[...new Set(enzymeSites.map(s => s.enzyme_name || ''))].sort().map(name => (
                  <label key={name} className="flex items-center gap-2 py-0.5 px-1 rounded hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox"
                      checked={!hiddenEnzymes.has(name)}
                      onChange={e => {
                        setHiddenEnzymes(prev => {
                          const next = new Set(prev)
                          if (e.target.checked) next.delete(name)
                          else next.add(name)
                          return next
                        })
                      }}
                      className="accent-violet-600" />
                    <span className="text-xs text-slate-700">{name}</span>
                    <span className="text-[10px] text-slate-400 ml-auto">
                      {enzymeSites.filter(s => s.enzyme_name === name).length} {t('enzymeSettings.sites')}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowEnzymeSettings(false)}
                className="px-3 py-1.5 text-xs bg-violet-600 text-white rounded hover:bg-violet-500">{t('settings.ok')}</button>
            </div>
          </div>
        </div>
      )}
      {/* DPI 导出对话框 */}
      {showDpiDialog && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[9999]" onClick={() => setShowDpiDialog(false)}>
          <div className="bg-white rounded-xl p-5 w-[320px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <h4 className="font-bold text-sm mb-3">{t('export.dpiTitle')}</h4>
            <div className="space-y-2">
              <button onClick={() => handleExportWithDpi(1)} className="w-full px-3 py-2 text-xs border rounded hover:bg-violet-50">{t('export.dpi1x')}</button>
              <button onClick={() => handleExportWithDpi(2)} className="w-full px-3 py-2 text-xs border rounded hover:bg-violet-50">{t('export.dpi2x')}</button>
              <button onClick={() => handleExportWithDpi(3)} className="w-full px-3 py-2 text-xs border rounded hover:bg-violet-50">{t('export.dpi3x')}</button>
            </div>
            <button onClick={() => setShowDpiDialog(false)} className="mt-3 w-full px-3 py-1.5 text-xs text-slate-600 border rounded hover:bg-slate-50">{t('export.cancel')}</button>
          </div>
        </div>
      )}

      {/* 引物比对结果对话框 */}
      {showPrimerResultDialog && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[9999]" onClick={() => setShowPrimerResultDialog(false)}>
          <div className="bg-white rounded-xl p-5 w-[560px] shadow-2xl max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-bold text-sm text-cyan-700 flex items-center gap-2">
                <Pipette size={16} />
                {t('editor.primerResultTitle')}
              </h4>
              <span className="text-xs text-slate-500">{primerResultData.length} {t('editor.primersMatched')}</span>
            </div>
            <div className="space-y-3">
              {primerResultData.map((site, i) => (
                <div key={i} className="border rounded-lg p-3 bg-cyan-50/50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-cyan-800 text-sm">{site.primer_name}</span>
                    <span className="text-xs text-slate-500">
                      {site.strand === 1 ? '→' : '←'} {site.position} bp
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-600 mb-2 break-all">{site.sequence}</div>
                  {site.nearbyFeatures && site.nearbyFeatures.length > 0 ? (
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1">{t('editor.downstreamFeatures')}:</div>
                      <div className="flex flex-wrap gap-1">
                        {site.nearbyFeatures.map((f: any, fi: number) => (
                          <span key={fi} className="px-1.5 py-0.5 bg-white border rounded text-[10px] text-slate-700">
                            {f.qualifiers?.label || f.qualifiers?.gene || f.qualifiers?.note || f.type}
                            <span className="text-slate-400 ml-1">{f.start + 1}..{f.end + 1}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-[10px] text-slate-400">{t('editor.noDownstreamFeatures')}</div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={() => setShowPrimerResultDialog(false)}
                className="px-4 py-2 text-sm bg-cyan-600 text-white rounded hover:bg-cyan-500">
                {t('settings.ok')}
              </button>
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
    enhancer: '#fbbf24', exon: '#14b8a6'
  }
  return colors[type] || '#cbd5e1'
}

/** 元件形状预览组件 */
function FeaturePreview({ shape, color, fill }: { shape: FeatureShape; color: string; fill: FillPattern }) {
  const fillVal = fill === 'hollow' ? 'white' : color
  const strokeW = fill === 'hollow' ? 1.5 : 0.5
  const patternId = `p-${shape}-${fill}`
  return (
    <>
      {fill === 'striped' && (
        <defs>
          <pattern id={patternId} patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" stroke={color} strokeWidth="2" />
          </pattern>
        </defs>
      )}
      {fill === 'dotted' && (
        <defs>
          <pattern id={patternId} patternUnits="userSpaceOnUse" width="4" height="4">
            <circle cx="2" cy="2" r="1" fill={color} />
          </pattern>
        </defs>
      )}
      {fill === 'crosshatch' && (
        <defs>
          <pattern id={patternId} patternUnits="userSpaceOnUse" width="4" height="4">
            <line x1="0" y1="0" x2="4" y2="4" stroke={color} strokeWidth="0.8" />
            <line x1="4" y1="0" x2="0" y2="4" stroke={color} strokeWidth="0.8" />
          </pattern>
        </defs>
      )}
      {fill === 'horizontal' && (
        <defs>
          <pattern id={patternId} patternUnits="userSpaceOnUse" width="4" height="4">
            <line x1="0" y1="2" x2="4" y2="2" stroke={color} strokeWidth="1.5" />
          </pattern>
        </defs>
      )}
      {shape === 'arrow' && (
        <polygon points="2,4 30,4 38,8 30,12 2,12" fill={fill === 'striped' || fill === 'dotted' || fill === 'crosshatch' || fill === 'horizontal' ? `url(#${patternId})` : fillVal} stroke={color} strokeWidth={strokeW} />
      )}
      {shape === 'box' && (
        <rect x="2" y="3" width="36" height="10" rx="2" fill={fill === 'striped' || fill === 'dotted' || fill === 'crosshatch' || fill === 'horizontal' ? `url(#${patternId})` : fillVal} stroke={color} strokeWidth={strokeW} />
      )}
      {shape === 'box-arrow' && (
        <>
          <rect x="2" y="3" width="22" height="10" rx="1" fill={fill === 'striped' || fill === 'dotted' || fill === 'crosshatch' || fill === 'horizontal' ? `url(#${patternId})` : fillVal} stroke={color} strokeWidth={strokeW} />
          <polygon points="24,0 38,8 24,16" fill={color} opacity={0.8} />
        </>
      )}
      {shape === 'bent-arrow' && (
        <>
          <line x1="4" y1="12" x2="4" y2="4" stroke={color} strokeWidth="2" />
          <line x1="4" y1="4" x2="34" y2="4" stroke={color} strokeWidth="2" />
          <polygon points="34,1 38,4 34,7" fill={color} />
        </>
      )}
      {shape === 'bent-arrow-up' && (
        <>
          <line x1="4" y1="4" x2="4" y2="12" stroke={color} strokeWidth="2" />
          <line x1="4" y1="12" x2="34" y2="12" stroke={color} strokeWidth="2" />
          <polygon points="34,9 38,12 34,15" fill={color} />
        </>
      )}
      {shape === 'big-arrow' && (
        <polygon points="2,2 26,2 38,8 26,14 2,14" fill={fill === 'striped' || fill === 'dotted' || fill === 'crosshatch' || fill === 'horizontal' ? `url(#${patternId})` : fillVal} stroke={color} strokeWidth={strokeW} />
      )}
      {shape === 'wave' && (
        <path d="M 2,8 Q 10,2 18,8 Q 26,14 34,8" fill="none" stroke={color} strokeWidth="2" />
      )}
      {shape === 'line' && (
        <line x1="2" y1="8" x2="38" y2="8" stroke={color} strokeWidth="3" />
      )}
    </>
  )
}
