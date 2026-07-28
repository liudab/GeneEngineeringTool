import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react'
import { Save, Circle, Minus, List, X, Trash2, Info, GripHorizontal, Eye, EyeOff, Settings, Sliders, Pipette, AlignLeft, FlaskConical, Activity, Scissors, Beaker, Globe, Sparkles, GitBranch, Database, Pencil, Check, Search, ChevronDown, ChevronRight, Type } from 'lucide-react'
import VectorMapViewer from '../components/VectorMapViewer/VectorMapViewer'
import type { EnzymeFilterState } from '../components/VectorMapViewer/VectorMapViewer'
import SequenceEditor, { featureTypeName } from '../components/SequenceEditor/SequenceEditor'
import type { Vector, GenBankFeature, RestrictionEnzyme, FeatureStyles, FeatureShape, FillPattern, TextStyles, TextStyle, ComponentTag } from '../../shared/types'
import { DEFAULT_TEXT_STYLES, COMPONENT_TAG_LABELS, COMPONENT_TAG_GROUPS } from '../../shared/types'
import { FEATURE_TYPE_NAMES } from '../components/SequenceEditor/SequenceEditor'
import { useI18n } from '../hooks/useI18n'
import { serializeSvg, svgToPngDataUrl, pngToJpegDataUrl } from '../utils/export'

import { scanEnzymeSites, getComplement, getReverseComplement, type EnzymeSiteInfo } from '../utils/enzymeScanner'
import { useAlignment } from '../hooks/useAlignment'
import { usePrimerDesign } from '../hooks/usePrimerDesign'
import { useContextMenu } from '../components/ui/ContextMenu'
import { useHotkeys } from '../hooks/useHotkeys'
import AlignmentViewer from '../components/AlignmentViewer/AlignmentViewer'
import PrimerDesignPanel from '../components/PrimerDesignPanel/PrimerDesignPanel'
import CloningDesigner from '../components/CloningDesigner/CloningDesigner'
import ProteinAnalysisPanel from '../components/ProteinAnalysis/ProteinAnalysisPanel'
import MultiSeqAligner from '../components/MultiSeqAligner/MultiSeqAligner'
import DigestSimulationPanel from '../components/DigestSimulation/DigestSimulationPanel'
import ExtendedCloningPanel from '../components/ExtendedCloning/ExtendedCloningPanel'
import BlastSearchPanel from '../components/BlastSearch/BlastSearchPanel'
import NormalizationDialog from '../components/NormalizationDialog'
import ImportPreviewDialog from '../components/ImportPreviewDialog'
import { METHYLATION_SENSITIVE_ENZYMES, findMethylationSites } from '../engine/cloning/methylation'
import type { AlignmentType } from '../engine/alignment/types'
import type { DesignedPrimer } from '../engine/primer/types'
import type { ComponentMatch, SmartMatchResult, ImportPreviewItem, ImportDecision } from '../../shared/types'
import { useLifecycleLog, useModuleLogger } from '../hooks/useDebugLog'
import { perfMeasure, perfMark } from '../components/PerfMonitor'
import { useSmartAnnotation } from '../hooks/useSmartAnnotation'
import EditorSidebar from '../components/EditorSidebar'
import type { ActivePanel } from '../components/EditorSidebar'
import EditorToolbar from '../components/EditorToolbar'
import FeatureDetailPanel from '../components/FeatureDetailPanel'

/** 组件类型 → GenBank 特征类型映射（智能标注共用） */
const COMP_TYPE_TO_GB: Record<string, string> = {
  resistance: 'gene', CDS: 'CDS', promoter: 'promoter',
  origin: 'rep_origin', terminator: 'terminator', enhancer: 'enhancer',
  reporter: 'CDS', tag: 'CDS', regulatory: 'regulatory', other: 'misc_feature'
}

/** 通用可拖拽调整宽度的侧边浮动面板包裹组件
 * 拖拽期间直接操作 DOM style.width，mouse up 时才同步到 React state，避免每帧重渲染
 */
const ResizablePanel = memo(function ResizablePanel({ defaultWidth = 380, minWidth = 280, maxWidthRatio = 0.6, children, className = '' }: {
  defaultWidth?: number
  minWidth?: number
  maxWidthRatio?: number
  children: React.ReactNode
  className?: string
}) {
  const [width, setWidth] = useState(defaultWidth)
  const panelRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef(defaultWidth)

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const handle = panel.querySelector<HTMLElement>('[data-resize-handle]')
    if (!handle) return

    let dragging = false
    let raf = 0

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault()
      dragging = true
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return
      const newWidth = window.innerWidth - e.clientX
      const maxW = window.innerWidth * maxWidthRatio
      const clamped = Math.max(minWidth, Math.min(maxW, newWidth))
      widthRef.current = clamped
      // 直接 DOM 操作，不触发 React 重渲染
      if (!raf) {
        raf = requestAnimationFrame(() => {
          if (panelRef.current) panelRef.current.style.width = `${widthRef.current}px`
          raf = 0
        })
      }
    }

    const onMouseUp = () => {
      if (!dragging) return
      dragging = false
      if (raf) { cancelAnimationFrame(raf); raf = 0 }
      // 拖拽结束时同步 React state（仅触发一次重渲染）
      setWidth(widthRef.current)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    handle.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      handle.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      if (raf) cancelAnimationFrame(raf)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [minWidth, maxWidthRatio])

  return (
    <div ref={panelRef} className={`fixed inset-y-0 right-0 bg-white shadow-2xl border-l border-slate-200 z-[100] flex flex-row overflow-hidden ${className}`}
      style={{ width: `${width}px` }}>
      {/* 左侧拖拽分隔条 */}
      <div
        data-resize-handle
        className={`w-1 flex-shrink-0 cursor-col-resize hover:bg-violet-300 active:bg-violet-400 transition-colors bg-slate-200`} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {children}
      </div>
    </div>
  )
})

interface EditorData {
  vector: Vector
  features: GenBankFeature[]
  enzymeSites: EnzymeSiteInfo[]
  geneInfo?: { id: number; gene_name: string; type: string; species: string; accession_number: string; description: string }
}

interface Props {
  vectorId?: number
  geneId?: number
  transcriptId?: number
  seqType?: 'mrna' | 'protein'
  relatedSeqId?: number
  proteinKey?: string
}

// scanEnzymeSites, iupacToRegex, complement 等已提取到 utils/enzymeScanner.ts

/** 默认实验室常用限制性内切酶（22种） */
const DEFAULT_LAB_COMMON_ENZYMES: string[] = [
  'ApaI', 'BamHI', 'BbsI', 'BsaI', 'ClaI', 'DpnI', 'EcoRI', 'HindIII', 'KpnI', 'NcoI',
  'NdeI', 'NheI', 'NotI', 'PacI', 'PstI', 'SacI', 'SalI', 'SmaI', 'SpeI', 'SphI', 'XbaI', 'XhoI'
]

export default function VectorEditorPage({ vectorId, geneId, transcriptId, seqType, relatedSeqId, proteinKey }: Props) {
  useLifecycleLog('VectorEditorPage', { vectorId, geneId, transcriptId, seqType, relatedSeqId, proteinKey })
  const log = useModuleLogger('VectorEditorPage')

  // 模式派生：seqMode 决定 UI 行为，dataSource 决定 API 路由
  const seqMode: 'nucleotide' | 'protein' = seqType === 'protein' ? 'protein' : 'nucleotide'
  const dataSource: 'gene' | 'vector' | 'standalone' = proteinKey ? 'standalone' : geneId ? 'gene' : vectorId ? 'vector' : 'standalone'
  const entityId = geneId ?? vectorId ?? 0
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
  // 酶切筛选器状态（持久化到 localStorage）
  // 首次使用（无持久化数据）时，默认只显示实验室常用酶
  const [enzymeFilter, setEnzymeFilter] = useState<EnzymeFilterState>(() => {
    try {
      const raw = localStorage.getItem('enzymeFilterState')
      if (raw) {
        const parsed = JSON.parse(raw)
        return {
          enabled: parsed.enabled ?? true,
          showUniqueOnly: parsed.showUniqueOnly ?? false,
          overhangTypes: new Set<string>(parsed.overhangTypes || []),
          subtypes: new Set<string>(parsed.subtypes || []),
          selectedEnzymes: new Set<string>(parsed.selectedEnzymes || []),
          searchQuery: parsed.searchQuery || '',
        }
      }
    } catch {}
    // 默认：仅显示实验室常用酶
    return { enabled: true, showUniqueOnly: false, overhangTypes: new Set(), subtypes: new Set(), selectedEnzymes: new Set(DEFAULT_LAB_COMMON_ENZYMES), searchQuery: '' }
  })
  // 持久化酶切筛选器
  useEffect(() => {
    try {
      localStorage.setItem('enzymeFilterState', JSON.stringify({
        enabled: enzymeFilter.enabled,
        showUniqueOnly: enzymeFilter.showUniqueOnly,
        overhangTypes: Array.from(enzymeFilter.overhangTypes),
        subtypes: Array.from(enzymeFilter.subtypes),
        selectedEnzymes: Array.from(enzymeFilter.selectedEnzymes),
        searchQuery: enzymeFilter.searchQuery,
      }))
    } catch {}
  }, [enzymeFilter])
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
  // 引物显示设置持久化（debounce 300ms）
  const primerPersistTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    if (primerPersistTimer.current) clearTimeout(primerPersistTimer.current)
    primerPersistTimer.current = setTimeout(() => {
      try {
        localStorage.setItem('primerDisplayStyle', primerStyle)
        localStorage.setItem('primerDisplayColor', primerColor)
      } catch {}
    }, 300)
    return () => { if (primerPersistTimer.current) clearTimeout(primerPersistTimer.current) }
  }, [primerStyle, primerColor])
  // 图谱→序列联动选择
  const [mapSelection, setMapSelection] = useState<{ start: number; end: number } | null>(null)
  const handleClearMapSelection = useCallback(() => setMapSelection(null), [])
  const handleClearDragFeature = useCallback(() => setDragFeatureIdx(null), [])
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
  const [showUnifiedSettings, setShowUnifiedSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'visibility' | 'element' | 'text'>('element')
  // 草稿态：文字样式（对话框内编辑，确认后才提交）
  const [draftTextStyles, setDraftTextStyles] = useState<TextStyles | null>(null)
  // 草稿态：元件样式
  const [draftFeatureStyles, setDraftFeatureStyles] = useState<FeatureStyles | null>(null)
  // 草稿态：其他样式
  const [draftLegendScale, setDraftLegendScale] = useState<number | null>(null)
  const [draftFeatureHeight, setDraftFeatureHeight] = useState<number | null>(null)
  const [draftPrimerStyle, setDraftPrimerStyle] = useState<string | null>(null)
  const [draftPrimerColor, setDraftPrimerColor] = useState<string | null>(null)
  // 元件编辑模式
  const [editingFeature, setEditingFeature] = useState(false)
  const [editForm, setEditForm] = useState<{
    label: string; type: string; note: string; product: string; db_xref: string;
    normalized_type: string; species: string; tags: string; direction: string
  }>({ label: '', type: '', note: '', product: '', db_xref: '', normalized_type: '', species: '', tags: '[]', direction: 'none' })
  // 元件显示/隐藏控制
  const [hiddenFeatures, setHiddenFeatures] = useState<Set<number>>(new Set())
  // showVisibilityPanel removed — merged into unified settings dialog
  // 智能识别结果
  const [identifyResults, setIdentifyResults] = useState<Array<{ component_id: number; standard_name: string; component_type: string; species: string; identity: number; match_type: string }>>([])
  const [identifyLoading, setIdentifyLoading] = useState(false)
  const [showIdentify, setShowIdentify] = useState(false)
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
  const [enzymeFontSize, setEnzymeFontSize] = useState(7)
  // 酶切筛选草稿状态（对话框内编辑，确认后才提交）
  const [draftFilter, setDraftFilter] = useState<EnzymeFilterState | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  // 酶集合来源标签（多选预填充，非互斥）
  const [enzymeSourceTags, setEnzymeSourceTags] = useState<Set<'commercial' | 'lab'>>(new Set())

  const openEnzymeSettings = useCallback(() => {
    setDraftFilter({
      enabled: enzymeFilter.enabled,
      showUniqueOnly: enzymeFilter.showUniqueOnly,
      overhangTypes: new Set(enzymeFilter.overhangTypes),
      subtypes: new Set(enzymeFilter.subtypes),
      selectedEnzymes: new Set(enzymeFilter.selectedEnzymes),
      searchQuery: enzymeFilter.searchQuery,
    })
    setShowEnzymeSettings(true)
  }, [enzymeFilter])

  const closeEnzymeSettings = useCallback(() => {
    setShowEnzymeSettings(false)
    setDraftFilter(null)
    setCollapsedGroups(new Set())
    setEnzymeSourceTags(new Set())
  }, [])

  const commitEnzymeSettings = useCallback(() => {
    if (draftFilter) setEnzymeFilter(draftFilter)
    closeEnzymeSettings()
  }, [draftFilter, setEnzymeFilter, closeEnzymeSettings])

  const updateDraftFilter = useCallback((partial: Partial<EnzymeFilterState>) => {
    setDraftFilter(prev => prev ? { ...prev, ...partial } : prev)
  }, [])

  const OVERHANG_LABELS: Record<string, string> = { '5prime': "粘性5'", '3prime': "粘性3'", blunt: '平末端' }
  const SUBTYPE_LABELS: Record<string, string> = { P: 'Type IIP', S: 'Type IIS', A: 'Type IIA', B: 'Type IIB', C: 'Type IIC', F: 'Type IIF', E: 'Type IIE', G: 'Type IIG', T: 'Type IIT', V: 'Type IIV' }

  // 61种常见商用限制性内切酶
  const COMMERCIAL_ENZYMES = useMemo(() => new Set([
    'AfaI', 'AflII', 'AgeI', 'AluI', 'ApaI', 'ApoI', 'BamHI', 'BbsI', 'BclI', 'BglI',
    'BglII', 'BlnI', 'BmtI', 'BsaI', 'BsiWI', 'BsrGI', 'BstEII', 'BstZ17I', 'ClaI', 'DpnI',
    'DraI', 'DraIII', 'EagI', 'EcoRI', 'EcoRV', 'HaeIII', 'HhaI', 'HindIII', 'HinfI', 'HpaI',
    'KpnI', 'MfeI', 'MluI', 'NcoI', 'NdeI', 'NheI', 'NotI', 'NruI', 'NsiI', 'PacI',
    'PstI', 'PvuI', 'PvuII', 'RsaI', 'SacI', 'SacII', 'SalI', 'SbfI', 'ScaI', 'SfiI',
    'SgfI', 'SmaI', 'SnaBI', 'SpeI', 'SphI', 'SspI', 'StuI', 'StyI', 'TaqI', 'XbaI', 'XhoI'
  ]), [])

  // 实验室常用限制性内切酶（从 localStorage 动态读取，与 EnzymePage 管理面板联动）
  const LAB_COMMON_STORAGE_KEY = 'lab_common_enzymes'
  const DEFAULT_LAB_COMMON = DEFAULT_LAB_COMMON_ENZYMES
  const [labCommonEnzymes, setLabCommonEnzymes] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(LAB_COMMON_STORAGE_KEY)
      if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return new Set(arr) }
    } catch {}
    return new Set(DEFAULT_LAB_COMMON)
  })

  // 监听 localStorage 变化（跨窗口）+ 自定义事件（同窗口，由 EnzymePage 触发）
  useEffect(() => {
    const storageHandler = (e: StorageEvent) => {
      if (e.key === LAB_COMMON_STORAGE_KEY && e.newValue) {
        try { const arr = JSON.parse(e.newValue); if (Array.isArray(arr)) setLabCommonEnzymes(new Set(arr)) } catch {}
      }
    }
    const customHandler = (e: Event) => {
      const arr = (e as CustomEvent).detail
      if (Array.isArray(arr)) setLabCommonEnzymes(new Set(arr))
    }
    window.addEventListener('storage', storageHandler)
    window.addEventListener('lab-common-enzymes-changed', customHandler)
    return () => {
      window.removeEventListener('storage', storageHandler)
      window.removeEventListener('lab-common-enzymes-changed', customHandler)
    }
  }, [])

  const groupedEnzymes = useMemo(() => {
    const q = (draftFilter?.searchQuery || '').toLowerCase().trim()
    const sites = data?.enzymeSites || []
    const hasSiteSet = new Set(sites.map(s => s.enzyme_name))
    // 计算唯一位点酶集合（用于 showUniqueOnly 过滤）
    const uniqueEnzymeSet = new Set<string>()
    sites.forEach(s => { if (s.is_unique) uniqueEnzymeSet.add(s.enzyme_name || '') })
    const dfOverhang = draftFilter?.overhangTypes ?? new Set()
    const dfSubtypes = draftFilter?.subtypes ?? new Set()
    const dfShowUnique = draftFilter?.showUniqueOnly ?? false
    let filtered = enzymes.filter(e => {
      // 名称搜索
      if (q && !e.name.toLowerCase().includes(q)) return false
      // 末端类型过滤
      if (dfOverhang.size > 0 && !dfOverhang.has(e.overhang_type || '')) return false
      // 亚型过滤
      if (dfSubtypes.size > 0 && !dfSubtypes.has(e.subtype || '')) return false
      // 仅唯一位点
      if (dfShowUnique && !uniqueEnzymeSet.has(e.name)) return false
      return true
    })
    const groups = new Map<string, { overhang: string; subtype: string; label: string; enzymes: { name: string; hasSites: boolean }[] }>()
    for (const e of filtered) {
      const oh = e.overhang_type || 'other'
      const st = e.subtype || 'other'
      const key = `${oh}|${st}`
      if (!groups.has(key)) {
        const ohLabel = OVERHANG_LABELS[oh] || oh
        const stLabel = SUBTYPE_LABELS[st] || (st !== 'other' ? `Type ${st}` : '其他')
        groups.set(key, { overhang: oh, subtype: st, label: `${ohLabel} · ${stLabel}`, enzymes: [] })
      }
      groups.get(key)!.enzymes.push({ name: e.name, hasSites: hasSiteSet.has(e.name) })
    }
    const ohOrder: Record<string, number> = { '5prime': 0, '3prime': 1, blunt: 2, other: 3 }
    return Array.from(groups.values())
      .sort((a, b) => (ohOrder[a.overhang] ?? 9) - (ohOrder[b.overhang] ?? 9) || a.subtype.localeCompare(b.subtype))
  }, [enzymes, data?.enzymeSites, draftFilter])

  const toggleGroupEnzymes = useCallback((groupEnzymes: { name: string; hasSites: boolean }[], checked: boolean) => {
    setDraftFilter(prev => {
      if (!prev) return prev
      const next = new Set(prev.selectedEnzymes)
      const available = groupEnzymes.filter(e => e.hasSites).map(e => e.name)
      if (checked) { available.forEach(n => next.add(n)) } else { available.forEach(n => next.delete(n)) }
      return { ...prev, selectedEnzymes: next }
    })
  }, [])

  const toggleDraftEnzyme = useCallback((name: string) => {
    setDraftFilter(prev => {
      if (!prev) return prev
      const next = new Set(prev.selectedEnzymes)
      next.has(name) ? next.delete(name) : next.add(name)
      return { ...prev, selectedEnzymes: next }
    })
  }, [])
  // 智能标注元件 & 调试模式
  const smartAnnotation = useSmartAnnotation()
  const [showNormalizationDialog, setShowNormalizationDialog] = useState(false)
  const [debugMode] = useState(() => { try { return localStorage.getItem('componentDbDebugMode') === 'true' } catch { return false } })
  const [autoNormalize] = useState(() => { try { return localStorage.getItem('autoNormalizeEnabled') !== 'false' } catch { return true } })
  // 批量导入预览
  const [importPreviewItems, setImportPreviewItems] = useState<ImportPreviewItem[]>([])
  const [showImportPreview, setShowImportPreview] = useState(false)
  const [importPreviewLoading, setImportPreviewLoading] = useState(false)
  // 文字样式精细控制（从 localStorage 恢复）
  const [textStyles, setTextStyles] = useState<TextStyles>(() => {
    try {
      const saved = localStorage.getItem('vectorTextStyles')
      if (saved) return { ...DEFAULT_TEXT_STYLES, ...JSON.parse(saved) }
    } catch {}
    return DEFAULT_TEXT_STYLES
  })
  const textPersistTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    if (textPersistTimer.current) clearTimeout(textPersistTimer.current)
    textPersistTimer.current = setTimeout(() => {
      try { localStorage.setItem('vectorTextStyles', JSON.stringify(textStyles)) } catch {}
    }, 300)
    return () => { if (textPersistTimer.current) clearTimeout(textPersistTimer.current) }
  }, [textStyles])
  // 图例缩放和元件粗细（从 localStorage 恢复）
  const [legendScale, setLegendScale] = useState(() => {
    try { const v = localStorage.getItem('vectorLegendScale'); if (v) return Number(v) } catch {}
    return 1
  })
  const [featureHeight, setFeatureHeight] = useState(() => {
    try { const v = localStorage.getItem('vectorFeatureHeight'); if (v) return Number(v) } catch {}
    return 22
  })
  const mapPersistTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    if (mapPersistTimer.current) clearTimeout(mapPersistTimer.current)
    mapPersistTimer.current = setTimeout(() => {
      try {
        localStorage.setItem('vectorLegendScale', String(legendScale))
        localStorage.setItem('vectorFeatureHeight', String(featureHeight))
      } catch {}
    }, 300)
    return () => { if (mapPersistTimer.current) clearTimeout(mapPersistTimer.current) }
  }, [legendScale, featureHeight])

  // 比对 & 引物设计状态
  const alignment = useAlignment()
  const primerDesign = usePrimerDesign()
  const [showAlignmentDrawer, setShowAlignmentDrawer] = useState(false)
  // 侧边浮动面板统一状态（同一时间只能打开一个面板）
  const [activePanel, setActivePanel] = useState<ActivePanel>('none')
  // 酶切面板首次挂载后保留内部状态，后续切换只做 CSS 显隐
  const [digestMounted, setDigestMounted] = useState(false)
  const [contextMenuSequence, setContextMenuSequence] = useState<string | null>(null)
  const [dragFeatureIdx, setDragFeatureIdx] = useState<number | null>(null)
  const [showAlignInputDialog, setShowAlignInputDialog] = useState(false)
  const [alignInputSeq, setAlignInputSeq] = useState('')
  const [alignInputName, setAlignInputName] = useState('')
  const [alignType, setAlignType] = useState<AlignmentType>('nucleotide-nw')
  const [designedPrimerSites, setDesignedPrimerSites] = useState<any[]>([])

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

  // ============ 统一设置面板（合并图示设置+显示设置） ============
  const openUnifiedSettings = useCallback((tab: 'visibility' | 'element' | 'text' = 'element') => {
    setSettingsTab(tab)
    setDraftTextStyles({ ...textStyles })
    setDraftFeatureStyles({ ...featureStyles })
    setDraftLegendScale(legendScale)
    setDraftFeatureHeight(featureHeight)
    setDraftPrimerStyle(primerStyle)
    setDraftPrimerColor(primerColor)
    setShowUnifiedSettings(true)
  }, [textStyles, featureStyles, legendScale, featureHeight, primerStyle, primerColor])

  const closeUnifiedSettings = useCallback(() => {
    setShowUnifiedSettings(false)
    setDraftTextStyles(null)
    setDraftFeatureStyles(null)
    setDraftLegendScale(null)
    setDraftFeatureHeight(null)
    setDraftPrimerStyle(null)
    setDraftPrimerColor(null)
  }, [])

  const commitUnifiedSettings = useCallback(() => {
    if (draftTextStyles) setTextStyles(draftTextStyles)
    if (draftFeatureStyles) setFeatureStyles(draftFeatureStyles)
    if (draftLegendScale !== null) setLegendScale(draftLegendScale)
    if (draftFeatureHeight !== null) setFeatureHeight(draftFeatureHeight)
    if (draftPrimerStyle !== null) setPrimerStyle(draftPrimerStyle as any)
    if (draftPrimerColor !== null) setPrimerColor(draftPrimerColor)
    closeUnifiedSettings()
  }, [draftTextStyles, draftFeatureStyles, draftLegendScale, draftFeatureHeight, draftPrimerStyle, draftPrimerColor, closeUnifiedSettings])

  // 可拖拽分栏 - RAF 节流：拖拽期间直接 DOM 操作，mouse up 时才同步 React state
  const containerRef = useRef<HTMLDivElement>(null)
  const [mapHeight, setMapHeight] = useState(0.55) // 图谱占 55%
  const mapHeightRef = useRef(0.55)
  const [isDragging, setIsDragging] = useState(false)

  const handleDragStart = useCallback(() => { setIsDragging(true) }, [])
  useEffect(() => {
    if (!isDragging) return
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    let raf = 0
    // 拖拽期间暂存最新的 DOM 引用，避免每帧 setState
    const mapPane = containerRef.current?.querySelector<HTMLElement>('[data-map-pane]')
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const ratio = Math.max(0.2, Math.min(0.8, (e.clientY - rect.top) / rect.height))
      mapHeightRef.current = ratio
      if (!raf) {
        raf = requestAnimationFrame(() => {
          if (mapPane) mapPane.style.height = `${mapHeightRef.current * 100}%`
          raf = 0
        })
      }
    }
    const onUp = () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0 }
      setMapHeight(mapHeightRef.current)
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

  // 元件面板拖拽调整宽度 - RAF 节流
  const [featureListWidth, setFeatureListWidth] = useState(288) // w-72 = 18rem = 288px
  const featureListWidthRef = useRef(288)
  const [isResizingFeature, setIsResizingFeature] = useState(false)
  useEffect(() => {
    if (!isResizingFeature) return
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    let raf = 0
    const featurePane = containerRef.current?.querySelector<HTMLElement>('[data-feature-pane]')
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const containerRect = containerRef.current.getBoundingClientRect()
      const newWidth = Math.max(220, Math.min(containerRect.width * 0.5, containerRect.right - e.clientX))
      featureListWidthRef.current = newWidth
      if (!raf) {
        raf = requestAnimationFrame(() => {
          if (featurePane) featurePane.style.width = `${featureListWidthRef.current}px`
          raf = 0
        })
      }
    }
    const onUp = () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0 }
      setFeatureListWidth(featureListWidthRef.current)
      setIsResizingFeature(false)
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
  }, [isResizingFeature])

  // RAF 节流的 slider 更新器：每帧最多触发一次 setState，避免拖拽滑块时过频重渲染
  const rafSliderRefs = useRef<Record<string, number>>({})
  const pendingSliderRefs = useRef<Record<string, number>>({})
  const throttledSliderSet = useCallback((key: string, setter: (v: number) => void, value: number) => {
    pendingSliderRefs.current[key] = value
    if (rafSliderRefs.current[key]) return
    rafSliderRefs.current[key] = requestAnimationFrame(() => {
      setter(pendingSliderRefs.current[key])
      rafSliderRefs.current[key] = 0
    })
  }, [])

  // ESC 键关闭所有模态对话框和侧边面板（防止遮罩层阻挡交互）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 按优先级关闭：后打开的面板优先关闭
      if (showNormalizationDialog) { setShowNormalizationDialog(false); smartAnnotation.reset(); return }
      if (showAlignInputDialog) { setShowAlignInputDialog(false); return }
      if (showPrimerResultDialog) { setShowPrimerResultDialog(false); return }
      if (showDpiDialog) { setShowDpiDialog(false); return }
      if (showEnzymeSettings) { closeEnzymeSettings(); return }
      if (showUnifiedSettings) { closeUnifiedSettings(); return }
      if (showIdentify) { setShowIdentify(false); return }
      // 侧边浮动面板
      if (activePanel !== 'none') { setActivePanel('none'); return }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    showNormalizationDialog, showAlignInputDialog, showPrimerResultDialog, showDpiDialog,
    showEnzymeSettings, closeEnzymeSettings, showUnifiedSettings, showIdentify,
    activePanel
  ])

  // 加载数据
  useEffect(() => {
    const endTotalLoad = perfMeasure('编辑器总加载')
    ;(async () => {
      try {
        log.info(`Loading data: entityId=${entityId}, dataSource=${dataSource}`)
        let result: EditorData | null = null
        const endEnzymeLoad = perfMeasure('酶库加载')
        const enzymeList = await window.api.getEnzymes()
        endEnzymeLoad()
        setEnzymes(enzymeList || [])

        if (dataSource === 'gene') {
          let raw: any = null
          if (relatedSeqId) {
            // 相关序列编辑器模式：使用专门的 API
            raw = await window.api.getRelatedSeqEditorData(relatedSeqId)
            if (!raw) { setError('相关序列未找到或序列内容为空（可能尚未下载）'); setLoading(false); return }
          } else {
            // 普通基因/转录本编辑器模式
            raw = await window.api.getGeneEditorData(geneId!, transcriptId, seqType)
            if (!raw) { setError('基因序列未找到'); setLoading(false); return }
          }
          const gene = raw.gene
          const features: GenBankFeature[] = (raw as any).features || []
          const topology = (raw as any).topology || gene.topology || 'linear'
          const seq = gene.sequence || ''
          const scannedSites = scanEnzymeSites(seq, enzymeList || [], topology === 'circular')
          result = {
            vector: {
              id: gene.id, name: gene.gene_name, sequence: seq,
              size_bp: seq.length, topology: topology,
              description: gene.description || '',
              genbank_accession: gene.accession_number || ''
            } as unknown as Vector,
            features,
            enzymeSites: scannedSites,
            geneInfo: { id: gene.id, gene_name: gene.gene_name, type: gene.type || '', species: gene.species || '', accession_number: gene.accession_number || '', description: gene.description || '' }
          }
          setViewMode(topology === 'circular' ? 'circular' : 'linear')
        } else if (dataSource === 'standalone') {
          // 蛋白质独立编辑器模式
          const raw = await window.api.getProteinEditorData(proteinKey!)
          if (!raw) { setError('蛋白质序列数据未找到'); setLoading(false); return }
          const seq = raw.gene.sequence || ''
          result = {
            vector: {
              id: 0, name: raw.gene.name || 'protein', sequence: seq,
              size_bp: seq.length, topology: 'linear', description: '', genbank_accession: ''
            } as unknown as Vector,
            features: [],
            enzymeSites: []
          }
          setViewMode('linear')
        } else {
          const r = await window.api.getEditorData(vectorId!)
          if (!r) { setError(t('editor.vectorNotFound')); setLoading(false); return }
          const scannedSites = scanEnzymeSites(r.vector.sequence || '', enzymeList || [])
          const mergedSites = scannedSites.length > 0 ? scannedSites : r.enzymeSites
          result = { ...r, enzymeSites: mergedSites }
        }
        setData(result)
        if (result) {
          log.info(`Data loaded: seq=${result.vector.sequence.length}bp, features=${result.features.length}, enzymeSites=${result.enzymeSites.length}`)
          perfMark(`序列 ${result.vector.sequence.length}bp`, 0)
        }
        endTotalLoad()
      } catch (e: any) {
        log.error('Load failed', e)
        setError(e.message || t('editor.loadFailed'))
      }
      setLoading(false)
    })()
  }, [entityId])

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
    const cleanup: (() => void) | undefined = window.api.onSaveAndClose(async () => {
      if (dirty && data) {
        try {
          if (dataSource === 'gene') {
            await window.api.saveGeneSequence(geneId!, data.vector.sequence)
          } else if (dataSource === 'standalone') {
            await window.api.exportGenBankData({ name: data.vector.name, sequence: data.vector.sequence || '', features: data.features, topology: 'linear' })
          } else {
            await window.api.saveSequence(vectorId!, data.vector.sequence)
            if (window.api.saveFeatures) {
              await window.api.saveFeatures(vectorId!, data.features)
            }
          }
          setDirty(false)
        } catch (e: any) {
          console.error('[VectorEditor] Save on close failed:', e)
        }
      }
    })
    return () => { cleanup?.() }
  }, [dirty, data, vectorId, geneId, dataSource])

  // 导出处理函数
  const handleExport = useCallback(async (format: string) => {
    if (!mapSvgRef.current) return
    console.log(`[VectorEditor] Export: format=${format}, name=${data?.vector.name}`)
    log.info(`Export: format=${format}, name=${data?.vector.name}`)
    const svgEl = mapSvgRef.current
    const defaultName = data?.vector.name || (seqMode === 'protein' ? 'protein-map' : 'sequence-map')

    if (format === 'svg') {
      const svgContent = serializeSvg(svgEl)
      await window.api.exportSvg(svgContent, defaultName).catch((e: any) => console.error('[Export SVG failed]', e))
    } else if (format === 'pdf') {
      const svgContent = serializeSvg(svgEl)
      await window.api.exportPdf(svgContent, defaultName).catch((e: any) => console.error('[Export PDF failed]', e))
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
    const defaultName = data?.vector.name || (seqMode === 'protein' ? 'protein-map' : 'sequence-map')

    let dataUrl = await svgToPngDataUrl(svgEl, dpi)
    if (pendingExportFormat === 'jpg' || pendingExportFormat === 'jpeg') {
      dataUrl = await pngToJpegDataUrl(dataUrl)
    }
    await window.api.exportImage(pendingExportFormat, dataUrl, defaultName).catch((e: any) => console.error('[Export image failed]', e))
    setPendingExportFormat(null)
  }, [pendingExportFormat, data])

  // 监听菜单操作
  useEffect(() => {
    if (!window.api.onMenuAction) return
    const cleanup: (() => void) | undefined = window.api.onMenuAction((action: string) => {
      switch (action) {
        case 'view-circular': setViewMode('circular'); break
        case 'view-linear': setViewMode('linear'); break
        case 'show-style-dialog': showUnifiedSettings ? closeUnifiedSettings() : openUnifiedSettings(); break
        case 'show-enzyme-settings': showEnzymeSettings ? closeEnzymeSettings() : openEnzymeSettings(); break;
        case 'zoom-in': window.dispatchEvent(new CustomEvent('map-zoom-change', { detail: 'zoom-in' })); break
        case 'zoom-out': window.dispatchEvent(new CustomEvent('map-zoom-change', { detail: 'zoom-out' })); break
        case 'zoom-reset': window.dispatchEvent(new CustomEvent('map-zoom-change', { detail: 'zoom-reset' })); break
        case 'save-as-genbank':
          if (dataSource === 'gene') {
            window.api.exportGenBankData({ name: vector.name, sequence: vector.sequence || '', features, topology: vector.topology || 'linear' }).catch(e => console.error(e))
          } else {
            window.api.saveAsGenBank(vectorId!).catch(e => console.error(e))
          }
          break
        case 'save-as-fasta': window.api.saveAsFasta(entityId).catch(e => console.error(e)); break
        case 'open-file': window.api.openFile().catch(e => console.error(e)); break
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
    return () => { cleanup?.() }
  }, [entityId, changeLanguage, handleExport, dataSource, showEnzymeSettings, openEnzymeSettings, closeEnzymeSettings])

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

    const isCircular = (data.vector.topology || 'circular') === 'circular'
    setTimeout(() => {
      const newSites = scanEnzymeSites(newSeq, enzymes, isCircular)
      setData(prev => prev ? {
        ...prev,
        vector: { ...prev.vector, sequence: newSeq, size_bp: newSeq.length },
        features: adjustedFeatures,
        enzymeSites: newSites
      } : prev)
      setDirty(true)
    }, 0)
  }, [data, enzymes])

  // 添加元件
  const handleAddFeature = useCallback((feature: GenBankFeature) => {
    if (!data) return
    setData({ ...data, features: [...data.features, feature] })
    setDirty(true)
  }, [data])

  // 拖拽重排元件
  const handleFeatureReorder = useCallback((fromIdx: number, toIdx: number) => {
    if (!data || fromIdx === toIdx) return
    const newFeatures = [...data.features]
    const [moved] = newFeatures.splice(fromIdx, 1)
    newFeatures.splice(toIdx, 0, moved)
    setData({ ...data, features: newFeatures })
    // 更新 selectedFeature 索引
    if (selectedFeature === fromIdx) setSelectedFeature(toIdx)
    else if (selectedFeature !== null) {
      if (fromIdx < selectedFeature && toIdx >= selectedFeature) setSelectedFeature(selectedFeature - 1)
      else if (fromIdx > selectedFeature && toIdx <= selectedFeature) setSelectedFeature(selectedFeature + 1)
    }
    setDirty(true)
  }, [data, selectedFeature])

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
    console.log(`[VectorEditor] Saving: entityId=${entityId}, seqLen=${data.vector.sequence.length}, features=${data.features.length}`)
    log.info(`Saving: entityId=${entityId}, seqLen=${data.vector.sequence.length}, features=${data.features.length}`)
    try {
      if (dataSource === 'gene') {
        await window.api.saveGeneSequence(geneId!, data.vector.sequence)
      } else if (dataSource === 'standalone') {
        // 独立模式：导出为 FASTA 文件（不写数据库）
        await window.api.exportGenBankData({ name: data.vector.name, sequence: data.vector.sequence || '', features: data.features, topology: 'linear' })
      } else {
        await window.api.saveSequence(vectorId!, data.vector.sequence)
        // 持久化 features（包括规范化修改）
        if (window.api.saveFeatures) {
          await window.api.saveFeatures(vectorId!, data.features)
        }
      }
    } catch (err) {
      console.error('Save failed:', err)
      return
    }
    setDirty(false)
    console.log('[VectorEditor] Save complete')
    log.info('Save complete')
    setSaveMsg(t('editor.saved'))
    setTimeout(() => setSaveMsg(''), 2000)
  }, [data, vectorId, geneId, dataSource])

  // 快捷键
  useHotkeys([
    { key: 's', ctrl: true, label: '保存', action: () => { handleSave() }, global: true },
    { key: 'p', ctrl: true, shift: true, label: '设计引物', action: () => { setActivePanel(prev => prev === 'primer' ? 'none' : 'primer') }, global: true },
  ])

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

  // 比对 & 引物设计回调
  const handleAlignSelection = useCallback(() => {
    setShowAlignInputDialog(true)
  }, [])

  // 右键菜单：BLAST 搜索
  const handleBlastSearch = useCallback(() => {
    if (!seqSelection || !data) return
    const subSeq = data.vector.sequence.substring(seqSelection.start, seqSelection.end + 1)
    setContextMenuSequence(subSeq)
    setActivePanel('blast')
    setShowFeatureList(false)
  }, [seqSelection, data])

  // 右键菜单：翻译成蛋白质
  const handleTranslateSequence = useCallback(() => {
    if (!seqSelection || !data) return
    const subSeq = data.vector.sequence.substring(seqSelection.start, seqSelection.end + 1)
    setContextMenuSequence(subSeq)
    setActivePanel('protein')
    setShowFeatureList(false)
  }, [seqSelection, data])

  // 右键菜单：添加到元件数据库
  const handleAddToComponentDb = useCallback(async () => {
    if (!seqSelection || !data) return
    const subSeq = data.vector.sequence.substring(seqSelection.start, seqSelection.end + 1)
    if (subSeq.length < 10) { alert('选区序列太短（至少 10 bp）'); return }
    const name = prompt('元件标准名称:', '')
    if (!name) return
    try {
      await window.api.createComponent({
        sequence: subSeq.toUpperCase(),
        standard_name: name,
        aliases: JSON.stringify([]),
        type: 'other',
        species: '',
        notes: `从载体 ${data.vector.name} [${seqSelection.start + 1}..${seqSelection.end + 1}] 添加`
      })
      alert(`元件 "${name}" 已添加到元件数据库`)
    } catch (e: any) {
      console.error('[VectorEditor] Add to component DB failed:', e)
      alert('添加元件失败: ' + (e.message || '未知错误'))
    }
  }, [seqSelection, data])

  // ============ 图谱右键菜单 ============
  const { showContextMenu } = useContextMenu()
  const handleMapContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    let rangeStart: number | null = null
    let rangeEnd: number | null = null

    if (seqSelection) {
      rangeStart = seqSelection.start
      rangeEnd = seqSelection.end
    } else if (selectedFeature !== null && data?.features[selectedFeature]) {
      const f = data.features[selectedFeature]
      rangeStart = f.start
      rangeEnd = f.end
    }

    if (rangeStart === null || rangeEnd === null || !data) return

    const selSeq = data.vector.sequence.substring(rangeStart, rangeEnd + 1)
    const compBase = (b: string) => ({ a: 't', t: 'a', c: 'g', g: 'c' } as Record<string, string>)[b.toLowerCase()] || b
    const revComp = (s: string) => s.split('').map(c => compBase(c)).reverse().join('')

    const items: any[] = []
    if (selectedFeature !== null && data.features[selectedFeature]) {
      const f = data.features[selectedFeature]
      items.push({ id: 'map-feat', label: f.qualifiers?.label || f.type, disabled: true })
      items.push({ id: 'sep0', separator: true })
    }
    items.push({ id: 'map-copy-top', label: "复制正义链 (5'→3')", onClick: () => { try { navigator.clipboard.writeText(selSeq) } catch {} } })
    items.push({ id: 'map-copy-bot', label: "复制反义链 (3'→5')", onClick: () => { try { navigator.clipboard.writeText(revComp(selSeq)) } catch {} } })
    items.push({
      id: 'map-copy-both', label: '复制双链', onClick: () => {
        try { const bot = revComp(selSeq); navigator.clipboard.writeText(`5' ${selSeq} 3'\n3' ${bot} 5'`) } catch {}
      }
    })
    items.push({ id: 'sep1', separator: true })
    items.push({ id: 'map-mark', label: t('editor.markSelection') || '标记选区', onClick: async () => {
      if (selSeq.length < 10) { alert('选区序列太短'); return }
      const name = prompt('元件标准名称:', '')
      if (!name) return
      try {
        await window.api.createComponent({
          sequence: selSeq.toUpperCase(), standard_name: name,
          aliases: '[]', type: 'other', species: '',
          notes: `从载体图谱 [${rangeStart! + 1}..${rangeEnd! + 1}] 标记`
        })
        alert(`元件 "${name}" 已添加`)
      } catch (e: any) {
        console.error('[VectorEditor] Mark selection failed:', e)
        alert('标记失败: ' + (e.message || '未知错误'))
      }
    } })
    items.push({
      id: 'map-design-primer', label: t('editor.designPrimers'), onClick: () => {
        setSeqSelection({ start: rangeStart!, end: rangeEnd! })
        setActivePanel('primer')
        setShowFeatureList(false)
      }
    })
    items.push({
      id: 'map-align', label: '序列比对', onClick: () => {
        setSeqSelection({ start: rangeStart!, end: rangeEnd! })
        setShowAlignInputDialog(true)
      }
    })
    items.push({
      id: 'map-blast', label: 'BLAST 搜索', onClick: () => {
        setContextMenuSequence(selSeq)
        setActivePanel('blast')
        setShowFeatureList(false)
      }
    })
    items.push({
      id: 'map-translate', label: '翻译成蛋白质', onClick: () => {
        setContextMenuSequence(selSeq)
        setActivePanel('protein')
        setShowFeatureList(false)
      }
    })
    items.push({
      id: 'map-component', label: '添加到元件数据库', onClick: async () => {
        if (selSeq.length < 10) { alert('选区序列太短'); return }
        const name = prompt('元件标准名称:', '')
        if (!name) return
        try {
          await window.api.createComponent({
            sequence: selSeq.toUpperCase(), standard_name: name,
            aliases: '[]', type: 'other', species: '',
            notes: `从载体图谱 [${rangeStart! + 1}..${rangeEnd! + 1}] 添加`
          })
          alert(`元件 "${name}" 已添加`)
        } catch (e: any) {
          console.error('[VectorEditor] Add component from map failed:', e)
          alert('添加元件失败: ' + (e.message || '未知错误'))
        }
      }
    })
    showContextMenu(e.clientX, e.clientY, items)
  }, [seqSelection, selectedFeature, data, showContextMenu])

  const handleDoAlignment = useCallback(() => {
    if (!alignInputSeq || !seqSelection || !data) return
    const seq1 = data.vector.sequence.substring(seqSelection.start, seqSelection.end + 1)
    const name1 = `${data?.vector.name ?? 'Vector'} [${seqSelection.start + 1}..${seqSelection.end + 1}]`
    const name2 = alignInputName || 'Input Sequence'
    alignment.align(seq1, alignInputSeq.trim().replace(/\s/g, ''), alignType, undefined, name1, name2)
    setShowAlignInputDialog(false)
    setShowAlignmentDrawer(true)
    setAlignInputSeq('')
    setAlignInputName('')
  }, [alignInputSeq, alignInputName, alignType, seqSelection, data, alignment])

  const handleDesignPrimers = useCallback(() => {
    if (!seqSelection || !data) return
    setActivePanel('primer')
    setShowFeatureList(false)
  }, [seqSelection, data])

  const handlePrimerDesignRun = useCallback((mode: any, params?: any) => {
    if (!seqSelection || !data) return
    primerDesign.design(data.vector.sequence, seqSelection.start, seqSelection.end, mode, params)
  }, [seqSelection, data, primerDesign])

  const handleShowPrimersOnSequence = useCallback((pair: DesignedPrimer) => {
    if (!data) return
    const sites: any[] = []
    // Forward primer
    sites.push({
      primer_id: -1,
      primer_name: `Designed-F`,
      sequence: pair.forward.sequence,
      position: pair.forward.position + 1,
      recog_start: pair.forward.position,
      recog_end: pair.forward.position + pair.forward.length - 1,
      strand: 1 as const
    })
    // Reverse primer
    sites.push({
      primer_id: -2,
      primer_name: `Designed-R`,
      sequence: pair.reverse.sequence,
      position: pair.reverse.position + 1,
      recog_start: pair.reverse.position,
      recog_end: pair.reverse.position + pair.reverse.length - 1,
      strand: -1 as const
    })
    setDesignedPrimerSites(sites)
  }, [data])

  const handleSavePrimersToDb = useCallback(async (pair: DesignedPrimer) => {
    try {
      const name = `Designed_${data?.vector.name ?? 'Vector'}_${pair.productStart + 1}-${pair.productEnd}`
      await window.api.createPrimer({
        name: `${name}_F`,
        sequence: pair.forward.sequence,
        category: 'lab',
        tm: pair.forward.tm,
        gc_content: pair.forward.gc,
        description: `Auto-designed (score: ${pair.pairScore}), product: ${pair.productLength}bp`,
        source: '引物设计模块',
        target_gene_id: dataSource === 'gene' ? geneId : null
      })
      await window.api.createPrimer({
        name: `${name}_R`,
        sequence: pair.reverse.sequence,
        category: 'lab',
        tm: pair.reverse.tm,
        gc_content: pair.reverse.gc,
        description: `Auto-designed (score: ${pair.pairScore}), product: ${pair.productLength}bp`,
        source: '引物设计模块',
        target_gene_id: dataSource === 'gene' ? geneId : null
      })
      alert(`引物对已保存到数据库: ${name}_F / ${name}_R`)
    } catch (e: any) {
      alert('保存失败: ' + (e.message || '未知错误'))
    }
  }, [data, dataSource, geneId])

  const allPrimerSites = useMemo(() => [...primerSites, ...designedPrimerSites], [primerSites, designedPrimerSites])

  // ============ 侧边栏稳定回调 (useCallback 隔离，避免侧边栏随主组件重渲染) ============
  const sidebarToggleFeatureList = useCallback(() => setShowFeatureList(v => !v), [])
  const sidebarToggleSettings = useCallback(() => {
    if (showUnifiedSettings) { closeUnifiedSettings() } else { openUnifiedSettings() }
  }, [showUnifiedSettings, openUnifiedSettings, closeUnifiedSettings])
  const sidebarToggleEnzymeSettings = useCallback(() => {
    if (showEnzymeSettings) { closeEnzymeSettings() } else { openEnzymeSettings() }
  }, [showEnzymeSettings, openEnzymeSettings, closeEnzymeSettings])
  const sidebarSmartAnnotate = useCallback(async () => {
    const seq = data?.vector?.sequence || ''
    if (!seq) { alert('载体无序列数据'); return }
    const result = await smartAnnotation.annotateSequence(seq)
    if (!result) {
      if (smartAnnotation.error) alert('智能标注失败: ' + smartAnnotation.error)
      return
    }
    if (result.length === 0) {
      alert('未检测到有效的元件匹配（nt-nt ≥99% / nt-aa ≥90%）')
      return
    }
    setShowNormalizationDialog(true)
  }, [data, smartAnnotation])
  const sidebarBatchImport = useCallback(async () => {
    const feats = data?.features
    const seq = data?.vector?.sequence || ''
    if (!feats || feats.length === 0) { alert('当前载体无元件数据'); return }
    if (!seq) { alert('载体无序列数据'); return }
    try {
      setImportPreviewLoading(true)
      setShowImportPreview(true)
      const items = await window.api.previewBatchImport(feats, seq, data?.vector?.name)
      setImportPreviewItems(items)
      setImportPreviewLoading(false)
    } catch (e: any) {
      setImportPreviewLoading(false)
      console.error('[VectorEditor] Import preview failed:', e)
      alert('导入预览失败: ' + (e.message || '未知错误'))
      setShowImportPreview(false)
    }
  }, [data])
  const sidebarPrimerScan = useCallback(async () => {
    if (primerScanLoading) return
    const seq = data?.vector?.sequence || ''
    if (!seq) { alert('载体无序列数据'); return }
    setPrimerScanLoading(true)
    try {
      const sites = await window.api.scanVectorForPrimers(seq)
      setPrimerSites(sites)
      if (sites.length === 0) {
        alert('未找到匹配的引物')
      } else {
        const seqLen = data?.vector?.size_bp || seq.length
        const feats = data?.features || []
        const resultData = sites.map((site: any) => {
          const pos = site.position - 1
          const downstreamEnd = site.strand === 1
            ? (pos + site.sequence.length + 1000) % seqLen
            : (pos - 1000 + seqLen) % seqLen
          const downstreamStart = site.strand === 1 ? pos + site.sequence.length : pos
          const nearbyFeatures = feats.filter(f => {
            const fStart = f.start, fEnd = f.end
            if (site.strand === 1) {
              const rangeStart = downstreamStart, rangeEnd = downstreamEnd
              return rangeEnd > rangeStart ? (fEnd > rangeStart && fStart < rangeEnd) : (fEnd > rangeStart || fStart < rangeEnd)
            } else {
              const rangeStart = downstreamEnd, rangeEnd = downstreamStart
              return rangeEnd > rangeStart ? (fEnd > rangeStart && fStart < rangeEnd) : (fEnd > rangeStart || fStart < rangeEnd)
            }
          })
          return { ...site, nearbyFeatures: nearbyFeatures.slice(0, 10) }
        })
        setPrimerResultData(resultData)
        setShowPrimerResultDialog(true)
      }
    } catch (e: any) {
      console.error('[VectorEditor] Primer scan error:', e)
      alert(e.message || '引物比对失败')
    } finally {
      setPrimerScanLoading(false)
    }
  }, [data, primerScanLoading])
  const sidebarToggleAlignment = useCallback(() => {
    setShowAlignmentDrawer(prev => !prev)
  }, [])
  const sidebarTogglePanel = useCallback((panel: ActivePanel) => {
    setActivePanel(prev => prev === panel ? 'none' : panel)
    setShowFeatureList(false)
    if (panel === 'digest') setDigestMounted(true)
  }, [])

  // ============ EditorToolbar 稳定回调 ============
  const toolbarSetViewMode = useCallback((mode: 'circular' | 'linear') => {
    setViewMode(mode)
    setData(prev => prev ? { ...prev, vector: { ...prev.vector, topology: mode } } : prev)
  }, [])

  // ============ FeatureDetailPanel 稳定回调 ============
  const panelUpdateFeatures = useCallback((updater: (prev: GenBankFeature[]) => GenBankFeature[]) => {
    setData(prev => prev ? { ...prev, features: updater(prev.features) } : null)
  }, [])
  const panelMarkDirty = useCallback(() => setDirty(true), [])

  // 根据筛选器过滤酶切位点（必须在早期返回之前调用，遵守 Hooks 规则）
  const displayEnzymeSites = useMemo(() => {
    if (!data?.enzymeSites || !enzymeFilter.enabled) return []
    return data.enzymeSites.filter(site => {
      if (enzymeFilter.showUniqueOnly && !site.is_unique) return false
      if (enzymeFilter.overhangTypes.size > 0 && !enzymeFilter.overhangTypes.has(site.overhang_type || '')) return false
      if (enzymeFilter.subtypes.size > 0 && !enzymeFilter.subtypes.has(site.subtype || '')) return false
      if (enzymeFilter.selectedEnzymes.size > 0 && !enzymeFilter.selectedEnzymes.has(site.enzyme_name || '')) return false
      return true
    })
  }, [data?.enzymeSites, enzymeFilter])

  if (loading) {
    return <div className="flex items-center justify-center h-screen bg-slate-50"><div className="text-slate-400 text-sm">{t('editor.loading')}</div></div>
  }
  if (error || !data) {
    return <div className="flex items-center justify-center h-screen bg-slate-50"><div className="text-red-500 text-sm">{error || t('editor.loadFailed')}</div></div>
  }
  // 经过上面的 guard，data 已确定存在
  // 注意：vector 必须用 var（而非 const），因为 var 会提升为 undefined，避免 TDZ 崩溃
  // （useCallback 依赖数组在声明时立即求值，const 在声明前访问会触发 ReferenceError）
  var vector = data.vector
  const { features, enzymeSites } = data
  const selectedFeat = selectedFeature !== null ? features[selectedFeature] : null

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* 精简顶栏：memo 隔离，仅核心 props 变化时重渲染 */}
      <EditorToolbar
        vectorName={vector.name}
        seqMode={seqMode}
        species={dataSource === 'gene' ? data?.geneInfo?.species : undefined}
        sizeBp={vector.size_bp || 0}
        viewMode={viewMode}
        topologyLabel={viewMode === 'circular' ? t('editor.topology.circular') : t('editor.topology.linear')}
        circularLabel={t('editor.view.circular')}
        linearLabel={t('editor.view.linear')}
        saveLabel={t('editor.saveSequence')}
        unsavedLabel={t('editor.unsaved')}
        hiddenCount={hiddenFeatures.size}
        dirty={dirty}
        saveMsg={saveMsg}
        onSetViewMode={toolbarSetViewMode}
        onSave={handleSave}
      />

      {/* 中间区域：侧边栏 + 主内容 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧工具侧边栏 */}
        <EditorSidebar
          seqMode={seqMode}
          debugMode={debugMode}
          activePanel={activePanel}
          showFeatureList={showFeatureList}
          showUnifiedSettings={showUnifiedSettings}
          showEnzymeSettings={showEnzymeSettings}
          smartAnnotationLoading={smartAnnotation.isAnnotating}
          smartAnnotationProgress={smartAnnotation.progress ? smartAnnotation.progress.percent : null}
          primerScanLoading={primerScanLoading}
          primerSitesCount={primerSites.length}
          showAlignmentDrawer={showAlignmentDrawer}
          onToggleFeatureList={sidebarToggleFeatureList}
          onToggleSettings={sidebarToggleSettings}
          onToggleEnzymeSettings={sidebarToggleEnzymeSettings}
          onSmartAnnotate={sidebarSmartAnnotate}
          onBatchImport={sidebarBatchImport}
          onPrimerScan={sidebarPrimerScan}
          onToggleAlignment={sidebarToggleAlignment}
          onTogglePanel={sidebarTogglePanel}
        />

        {/* 右侧主内容 */}
        <div className="flex-1 flex overflow-hidden">
        <div ref={containerRef} className={`flex-1 flex flex-col overflow-hidden ${isDragging ? 'cursor-row-resize' : ''}`}>
          {/* 图谱区域 */}
          <div data-map-pane className="overflow-auto bg-white" style={{ height: `${mapHeight * 100}%`, flexShrink: 0 }}>
            <VectorMapViewer
              sequence={vector.sequence || ''}
              size={vector.size_bp || 0}
              name={vector.name}
              topology={vector.topology || 'circular'}
              features={features}
              enzymeSites={displayEnzymeSites}
              enzymeFilter={enzymeFilter}
              onEnzymeFilterChange={setEnzymeFilter}
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
              enzymeFontSize={textStyles.enzyme.fontSize}
              mapFontSize={textStyles.title.fontSize}
              legendScale={legendScale}
              featureFontSize={textStyles.feature.fontSize}
              featureHeight={featureHeight}
              textStyles={textStyles}
              onSvgRef={handleSvgRef}
              hiddenFeatures={hiddenFeatures}
              onContextMenu={handleMapContextMenu}
            />
          </div>

          {/* 拖拽分隔条 */}
          <div
            onMouseDown={handleDragStart}
            className={`flex items-center justify-center h-4 border-t border-b cursor-row-resize flex-shrink-0 select-none transition-colors ${
              isDragging ? 'bg-violet-200 border-violet-300' : 'bg-slate-100 border-slate-200 hover:bg-violet-100 hover:border-violet-200'
            }`}>
            <GripHorizontal size={14} className={isDragging ? 'text-violet-500' : 'text-slate-400'} />
          </div>

          {/* 序列编辑器 */}
          <div className="flex-1 overflow-hidden">
            <SequenceEditor
              sequence={vector.sequence || ''}
              features={features}
              enzymeSites={displayEnzymeSites}
              primerSites={allPrimerSites}
              onSequenceChange={handleSequenceChange}
              onAddFeature={handleAddFeature}
              onDeleteFeature={handleDeleteFeature}
              selectedFeature={selectedFeature}
              onSelectFeature={setSelectedFeature}
              hoveredFeature={hoveredFeature}
              mapSelection={mapSelection}
              onClearMapSelection={handleClearMapSelection}
              onSelectionChange={handleSeqSelectionChange}
              onHoverPosition={handleSeqHoverPosition}
              onAlignSelection={handleAlignSelection}
              onDesignPrimers={handleDesignPrimers}
              onBlastSearch={handleBlastSearch}
              onTranslateSequence={handleTranslateSequence}
              onAddToComponentDb={handleAddToComponentDb}
            />
          </div>
        </div>

        {/* 右侧：元件面板 */}
        {showFeatureList && (
          <div
            onMouseDown={() => setIsResizingFeature(true)}
            className={`w-1 flex-shrink-0 cursor-col-resize hover:bg-violet-300 active:bg-violet-400 transition-colors ${
              isResizingFeature ? 'bg-violet-400' : 'bg-slate-200'
            }`} />
        )}
        {showFeatureList && (
          <FeatureDetailPanel
            features={features}
            selectedFeature={selectedFeature}
            hoveredFeature={hoveredFeature}
            width={featureListWidth}
            sequence={vector.sequence || ''}
            dragFeatureIdx={dragFeatureIdx}
            labels={{
              featureDetail: t('editor.featureDetail'),
              featureList: t('editor.featureList'),
              noFeatures: t('editor.noFeatures'),
              deleteFeature: t('editor.deleteFeature'),
              featureType: t('editor.featureType'),
              featurePosition: t('editor.featurePosition'),
              featureLength: t('editor.featureLength'),
              featureStrand: t('editor.featureStrand'),
              featureLocation: t('editor.featureLocation'),
              featureSequence: t('editor.featureSequence'),
              strandForward: t('editor.strand.forward'),
              strandReverse: t('editor.strand.reverse'),
            }}
            onSelectFeature={setSelectedFeature}
            onMapSelect={handleMapSelectFeature}
            onHoverFeature={setHoveredFeature}
            onDeleteFeature={handleDeleteFeature}
            onDragStart={setDragFeatureIdx}
            onReorder={handleFeatureReorder}
            onDragEnd={handleClearDragFeature}
            onUpdateFeatures={panelUpdateFeatures}
            onMarkDirty={panelMarkDirty}
          />
        )}
        </div>
      </div>

      {/* 统一设置对话框（合并图示设置+显示设置） */}
      {showUnifiedSettings && draftTextStyles && draftFeatureStyles && draftLegendScale !== null && draftFeatureHeight !== null && draftPrimerStyle !== null && draftPrimerColor !== null && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[9999]" onClick={closeUnifiedSettings}>
          <div className="bg-white rounded-xl p-0 w-[680px] shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h4 className="font-bold text-sm">{t('settings.title')}</h4>
              <button onClick={closeUnifiedSettings} className="p-1 text-slate-400 hover:text-slate-600"><X size={14} /></button>
            </div>
            {/* Tab 栏 */}
            <div className="flex border-b border-slate-200 px-5">
              {([
                { key: 'visibility' as const, icon: <Eye size={12} />, label: '显示控制' },
                { key: 'element' as const, icon: <Settings size={12} />, label: '元素样式' },
                { key: 'text' as const, icon: <Type size={12} />, label: '文字样式' },
              ]).map(tab => (
                <button key={tab.key} onClick={() => setSettingsTab(tab.key)}
                  className={`flex items-center gap-1 px-3 py-2 text-xs border-b-2 transition-colors ${
                    settingsTab === tab.key ? 'border-violet-600 text-violet-700 font-semibold' : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}>
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>
            {/* Tab 内容 */}
            <div className="flex-1 overflow-auto px-5 py-3">
              {/* ====== 显示控制 Tab ====== */}
              {settingsTab === 'visibility' && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-700">元件显示控制</span>
                    <button onClick={() => setHiddenFeatures(new Set())} className="text-[10px] text-violet-600 hover:underline">全部显示</button>
                  </div>
                  {(() => {
                    const typeGroups = new Map<string, Array<{ idx: number; label: string }>>()
                    features.forEach((f, i) => {
                      if (f.type === 'source') return
                      if (!typeGroups.has(f.type)) typeGroups.set(f.type, [])
                      const lbl = f.qualifiers.label || f.qualifiers.gene || f.qualifiers.product || f.type
                      typeGroups.get(f.type)!.push({ idx: i, label: lbl })
                    })
                    return [...typeGroups.entries()].map(([type, items]) => {
                      const allHidden = items.every((it: { idx: number; label: string }) => hiddenFeatures.has(it.idx))
                      const someHidden = items.some((it: { idx: number; label: string }) => hiddenFeatures.has(it.idx))
                      return (
                        <div key={type} className="mb-1">
                          <label className="flex items-center gap-1.5 px-1 py-0.5 cursor-pointer text-[10px] font-semibold text-slate-500 uppercase">
                            <input type="checkbox" className="accent-violet-600"
                              checked={!allHidden} ref={el => { if (el) el.indeterminate = someHidden && !allHidden }}
                              onChange={e => {
                                const next = new Set(hiddenFeatures)
                                if (e.target.checked) items.forEach((it: { idx: number; label: string }) => next.delete(it.idx))
                                else items.forEach((it: { idx: number; label: string }) => next.add(it.idx))
                                setHiddenFeatures(next)
                              }} />
                            {featureTypeName(type)} ({items.length})
                          </label>
                          {items.map((it: { idx: number; label: string }) => (
                            <label key={it.idx} className="flex items-center gap-1.5 pl-4 pr-1 py-0.5 cursor-pointer text-xs text-slate-700 hover:bg-slate-50 rounded">
                              <input type="checkbox" className="accent-violet-600" checked={!hiddenFeatures.has(it.idx)}
                                onChange={() => {
                                  const next = new Set(hiddenFeatures)
                                  if (next.has(it.idx)) next.delete(it.idx); else next.add(it.idx)
                                  setHiddenFeatures(next)
                                }} />
                              <span className="truncate">{it.label}</span>
                            </label>
                          ))}
                        </div>
                      )
                    })
                  })()}
                </div>
              )}
              {/* ====== 元素样式 Tab ====== */}
              {settingsTab === 'element' && (
                <div className="space-y-4">
                  {/* 元件粗细 */}
                  <div className="p-3 bg-violet-50 rounded-lg">
                    <label className="text-xs font-medium text-slate-700 block mb-2">{t('settings.featureHeight')}</label>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-slate-400">细</span>
                      <input type="range" min={10} max={80} step={1} value={draftFeatureHeight}
                        onChange={e => setDraftFeatureHeight(Number(e.target.value))} className="flex-1" />
                      <span className="text-[10px] text-slate-400">粗</span>
                      <span className="text-xs text-slate-500 w-10 text-right">{draftFeatureHeight}px</span>
                    </div>
                  </div>
                  {/* 图例大小 */}
                  <div className="p-3 bg-violet-50 rounded-lg">
                    <label className="text-xs font-medium text-slate-700 block mb-2">{t('settings.legendScale')}</label>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-slate-400">小</span>
                      <input type="range" min={0.5} max={2} step={0.1} value={draftLegendScale}
                        onChange={e => setDraftLegendScale(Number(e.target.value))} className="flex-1" />
                      <span className="text-[10px] text-slate-400">大</span>
                      <span className="text-xs text-slate-500 w-10 text-right">{(draftLegendScale * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                  {/* 引物图示样式 */}
                  <div className="p-3 bg-cyan-50 rounded-lg">
                    <label className="text-xs font-medium text-slate-700 block mb-2">{t('settings.primerStyleTitle')}</label>
                    <div className="flex items-center gap-4">
                      <select value={draftPrimerStyle} onChange={e => setDraftPrimerStyle(e.target.value)}
                        className="text-xs border rounded px-2 py-1">
                        <option value="arrow">箭头</option>
                        <option value="line">直线</option>
                        <option value="triangle">三角</option>
                        <option value="flag">旗帜</option>
                      </select>
                      <input type="color" value={draftPrimerColor} onChange={e => setDraftPrimerColor(e.target.value)}
                        className="w-7 h-7 rounded border cursor-pointer" />
                    </div>
                  </div>
                  {/* 元件类型样式 */}
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-2">元件类型样式</label>
                    <div className="space-y-2">
                      {[...new Set(features.map(f => f.type))].map(type => {
                        const style = draftFeatureStyles[type] || { color: '#cbd5e1', shape: 'box' as FeatureShape, fill: 'solid' as FillPattern }
                        return (
                          <div key={type} className="flex items-center gap-3 p-2 bg-slate-50 rounded">
                            <span className="w-24 text-xs font-medium text-slate-700 truncate">{featureTypeLabel(type)}</span>
                            <input type="color" value={style.color}
                              onChange={e => setDraftFeatureStyles({ ...draftFeatureStyles, [type]: { ...style, color: e.target.value } })}
                              className="w-6 h-6 rounded border cursor-pointer" />
                            <select value={style.shape}
                              onChange={e => setDraftFeatureStyles({ ...draftFeatureStyles, [type]: { ...style, shape: e.target.value as FeatureShape } })}
                              className="text-[10px] border rounded px-1 py-0.5">
                              <option value="arrow">箭头</option><option value="box">方块</option><option value="box-arrow">方块箭头</option>
                              <option value="bent-arrow">弯箭头</option><option value="bent-arrow-up">上弯箭头</option><option value="big-arrow">粗箭头</option>
                              <option value="wave">波浪</option><option value="line">线</option>
                            </select>
                            <select value={style.fill}
                              onChange={e => setDraftFeatureStyles({ ...draftFeatureStyles, [type]: { ...style, fill: e.target.value as FillPattern } })}
                              className="text-[10px] border rounded px-1 py-0.5">
                              <option value="solid">实心</option><option value="striped">条纹</option><option value="hollow">空心</option>
                              <option value="dotted">点状</option><option value="crosshatch">交叉线</option><option value="horizontal">横线</option>
                            </select>
                            <svg width="36" height="14" viewBox="0 0 36 14">
                              <FeaturePreview shape={style.shape} color={style.color} fill={style.fill} />
                            </svg>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
              {/* ====== 文字样式 Tab ====== */}
              {settingsTab === 'text' && (
                <div className="space-y-3">
                  {([
                    { key: 'feature', label: '元件标签', desc: '弧内标签和外部折线标注' },
                    { key: 'enzyme', label: '酶切位点标签', desc: '限制性内切酶名称' },
                    { key: 'primer', label: '引物标签', desc: '引物结合位点名称' },
                    { key: 'ruler', label: '标尺刻度文字', desc: 'bp 刻度数字' },
                    { key: 'title', label: '标题文字', desc: '质粒名称和碱基总数' },
                    { key: 'legend', label: '图例文字', desc: '图例中的元件类型名称' },
                  ] as const).map(({ key, label, desc }) => {
                    const ts = draftTextStyles[key] || DEFAULT_TEXT_STYLES[key]
                    const update = (partial: Partial<TextStyle>) => {
                      setDraftTextStyles(prev => prev ? { ...prev, [key]: { ...prev[key], ...partial } } : prev)
                    }
                    return (
                      <div key={key} className="p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-slate-700">{label}</span>
                          <span className="text-[10px] text-slate-400">{desc}</span>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <div className="flex items-center gap-1">
                            <label className="text-[10px] text-slate-500">字体</label>
                            <select value={ts.fontFamily} onChange={e => update({ fontFamily: e.target.value as TextStyle['fontFamily'] })}
                              className="text-[10px] border rounded px-1.5 py-0.5">
                              <option value="sans-serif">Sans-serif</option>
                              <option value="serif">Serif</option>
                              <option value="monospace">Monospace</option>
                            </select>
                          </div>
                          <div className="flex items-center gap-1">
                            <label className="text-[10px] text-slate-500">大小</label>
                            <input type="range" min={5} max={48} step={0.5} value={ts.fontSize}
                              onChange={e => update({ fontSize: Number(e.target.value) })} className="w-20" />
                            <span className="text-[10px] text-slate-500 w-8 text-right">{ts.fontSize}px</span>
                          </div>
                          <button onClick={() => update({ fontWeight: ts.fontWeight === 'bold' ? 'normal' : 'bold' })}
                            className={`px-1.5 py-0.5 text-[10px] rounded border ${ts.fontWeight === 'bold' ? 'bg-violet-100 text-violet-700 border-violet-300' : 'text-slate-500 border-slate-200'}`}>
                            <strong>B</strong>
                          </button>
                          <button onClick={() => update({ fontStyle: ts.fontStyle === 'italic' ? 'normal' : 'italic' })}
                            className={`px-1.5 py-0.5 text-[10px] rounded border ${ts.fontStyle === 'italic' ? 'bg-violet-100 text-violet-700 border-violet-300' : 'text-slate-500 border-slate-200'}`}>
                            <em>I</em>
                          </button>
                          {/* 实时预览 */}
                          <span style={{ fontFamily: ts.fontFamily, fontSize: `${ts.fontSize}px`, fontWeight: ts.fontWeight, fontStyle: ts.fontStyle }}
                            className="text-slate-700 truncate max-w-[120px]">
                            {label === '标题文字' ? vector.name : 'AaBb123'}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            {/* 底部按钮 */}
            <div className="flex justify-between items-center px-5 py-3 border-t border-slate-200">
              <button onClick={() => {
                setDraftTextStyles({ ...DEFAULT_TEXT_STYLES })
                setDraftFeatureStyles({ ...defaultFeatureStyles })
                setDraftLegendScale(1)
                setDraftFeatureHeight(22)
                setDraftPrimerStyle('arrow')
                setDraftPrimerColor('#0891b2')
              }} className="px-3 py-1.5 text-xs border rounded text-slate-600 hover:bg-slate-50">{t('settings.resetDefaults')}</button>
              <div className="flex gap-2">
                <button onClick={closeUnifiedSettings}
                  className="px-3 py-1.5 text-xs border rounded text-slate-600 hover:bg-slate-50">取消</button>
                <button onClick={commitUnifiedSettings}
                  className="px-3 py-1.5 text-xs bg-violet-600 text-white rounded hover:bg-violet-500">应用</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showEnzymeSettings && draftFilter && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[9999]" onClick={() => closeEnzymeSettings()}>
          <div className="bg-white rounded-xl p-5 w-[820px] shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            {/* 标题栏 */}
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-bold text-sm">{t('enzymeSettings.title')}</h4>
              <button onClick={closeEnzymeSettings} className="p-1 text-slate-400 hover:text-slate-600"><X size={14} /></button>
            </div>
            {/* 主区域：左右分栏 */}
            <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
            {/* ========== 左侧：酶选择区 ========== */}
            <div className="flex-1 flex flex-col min-w-0 overflow-auto pr-1">
            {/* 字体大小 */}
            <div className="mb-3">
              <label className="text-xs font-medium text-slate-700 block mb-2">{t('enzymeSettings.fontSize')}</label>
              <div className="flex items-center gap-3">
                <input type="range" min={5} max={64} step={0.5} value={enzymeFontSize}
                  onChange={e => throttledSliderSet('enzFs', setEnzymeFontSize, Number(e.target.value))}
                  className="flex-1" />
                <span className="text-xs text-slate-500 w-10 text-right">{enzymeFontSize}px</span>
              </div>
            </div>

            {/* 第一层：快捷预填充（可多选叠加，手动搜索始终可用） */}
            <div className="mb-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-[10px] font-semibold text-slate-500 block mb-2">快捷预填充（可叠加，去重）</span>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => {
                  setDraftFilter(prev => {
                    if (!prev) return prev
                    const next = new Set(prev.selectedEnzymes)
                    const sites = data?.enzymeSites || []
                    const siteEnzymes = new Set(sites.map(s => s.enzyme_name))
                    COMMERCIAL_ENZYMES.forEach(n => { if (siteEnzymes.has(n)) next.add(n) })
                    return { ...prev, selectedEnzymes: next }
                  })
                  setEnzymeSourceTags(prev => { const n = new Set(prev); n.add('commercial'); return n })
                }} className={`px-2 py-1 text-[10px] border rounded transition-colors ${
                  enzymeSourceTags.has('commercial') ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'
                }`}>🔧 常见商用酶 (61)</button>
                <button onClick={() => {
                  setDraftFilter(prev => {
                    if (!prev) return prev
                    const next = new Set(prev.selectedEnzymes)
                    const sites = data?.enzymeSites || []
                    const siteEnzymes = new Set(sites.map(s => s.enzyme_name))
                    labCommonEnzymes.forEach(n => { if (siteEnzymes.has(n)) next.add(n) })
                    return { ...prev, selectedEnzymes: next }
                  })
                  setEnzymeSourceTags(prev => { const n = new Set(prev); n.add('lab'); return n })
                }} className={`px-2 py-1 text-[10px] border rounded transition-colors ${
                  enzymeSourceTags.has('lab') ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'
                }`}>🧪 实验室常用酶 ({labCommonEnzymes.size})</button>
                <button onClick={() => updateDraftFilter({ selectedEnzymes: new Set() })}
                  className="px-2 py-1 text-[10px] border rounded text-amber-600 hover:bg-amber-50 bg-white border-slate-200" title="清空已选酶">🗑 清空已选</button>
              </div>
            </div>

            {/* 第二层：附加过滤条件 */}
            <div className="mb-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-[10px] font-semibold text-slate-500 block mb-2">附加过滤</span>
              {/* 仅单一切点位点 */}
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer mb-2">
                <input type="checkbox" checked={draftFilter.showUniqueOnly}
                  onChange={e => updateDraftFilter({ showUniqueOnly: e.target.checked })} className="accent-violet-600" />
                仅显示单一切割位点的酶
              </label>
              {/* Overhang 类型 */}
              <div className="mb-2">
                <span className="text-[10px] font-semibold text-slate-500 block mb-1">末端类型</span>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(OVERHANG_LABELS).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-1 text-[10px] text-slate-600 cursor-pointer">
                      <input type="checkbox" className="accent-violet-600"
                        checked={draftFilter.overhangTypes.has(key)}
                        onChange={e => {
                          const next = new Set(draftFilter.overhangTypes)
                          e.target.checked ? next.add(key) : next.delete(key)
                          updateDraftFilter({ overhangTypes: next })
                        }} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              {/* 亚型 */}
              <div>
                <span className="text-[10px] font-semibold text-slate-500 block mb-1">酶切亚型</span>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(SUBTYPE_LABELS).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-1 text-[10px] text-slate-600 cursor-pointer">
                      <input type="checkbox" className="accent-violet-600"
                        checked={draftFilter.subtypes.has(key)}
                        onChange={e => {
                          const next = new Set(draftFilter.subtypes)
                          e.target.checked ? next.add(key) : next.delete(key)
                          updateDraftFilter({ subtypes: next })
                        }} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* 搜索 + 分组酶列表（始终可见，支持手动微调） */}
              <div className="relative mb-2">
                <Search size={12} className="absolute left-2 top-1.5 text-slate-400" />
                <input type="text" placeholder="搜索酶名称..." value={draftFilter.searchQuery}
                  onChange={e => updateDraftFilter({ searchQuery: e.target.value })}
                  className="w-full pl-7 pr-2 py-1 text-xs border border-slate-200 rounded bg-white" />
              </div>
              <div className="flex-1 overflow-auto border border-slate-200 rounded bg-white max-h-[30vh]">
                {groupedEnzymes.map(group => {
                  const groupKey = `${group.overhang}|${group.subtype}`
                  const collapsed = collapsedGroups.has(groupKey)
                  const availableEnzymes = group.enzymes.filter(e => e.hasSites)
                  const allChecked = availableEnzymes.length > 0 && availableEnzymes.every(e => draftFilter.selectedEnzymes.has(e.name))
                  const someChecked = !allChecked && availableEnzymes.some(e => draftFilter.selectedEnzymes.has(e.name))
                  return (
                    <div key={groupKey}>
                      <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 border-b border-slate-100 cursor-pointer sticky top-0"
                        onClick={() => {
                          const next = new Set(collapsedGroups)
                          collapsed ? next.delete(groupKey) : next.add(groupKey)
                          setCollapsedGroups(next)
                        }}>
                        {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                        <input type="checkbox" className="accent-violet-600"
                          checked={allChecked} ref={el => { if (el) el.indeterminate = someChecked }}
                          onChange={e => toggleGroupEnzymes(group.enzymes, e.target.checked)}
                          onClick={e => e.stopPropagation()} />
                        <span className="text-[10px] font-semibold text-slate-600">{group.label}</span>
                        <span className="text-[9px] text-slate-400 ml-auto">{availableEnzymes.length} 有切点</span>
                      </div>
                      {!collapsed && group.enzymes.map(enz => (
                        <label key={enz.name} className="flex items-center gap-2 pl-6 pr-2 py-0.5 text-xs hover:bg-violet-50 cursor-pointer">
                          <input type="checkbox" className="accent-violet-600"
                            checked={draftFilter.selectedEnzymes.has(enz.name)}
                            disabled={!enz.hasSites}
                            onChange={() => toggleDraftEnzyme(enz.name)} />
                          <span className={enz.hasSites ? 'text-slate-700' : 'text-slate-300'}>{enz.name}</span>
                          {METHYLATION_SENSITIVE_ENZYMES[enz.name] && (
                            <span className={`text-[8px] px-1 py-0.5 rounded ${
                              METHYLATION_SENSITIVE_ENZYMES[enz.name].dam ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                            }`}>
                              {METHYLATION_SENSITIVE_ENZYMES[enz.name].dam ? 'Dam' : 'Dcm'}敏感
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400 ml-auto">
                            {enzymeSites.filter(s => s.enzyme_name === enz.name).length} {t('enzymeSettings.sites')}
                          </span>
                        </label>
                      ))}
                    </div>
                  )
                })}
                {groupedEnzymes.length === 0 && (
                  <div className="text-center text-[10px] text-slate-400 py-4">无匹配结果</div>
                )}
              </div>

            {/* 甲基化摘要 */}
            {(() => {
              const seq = data?.vector.sequence || ''
              if (seq.length < 10) return null
              const metSites = findMethylationSites(seq)
              const dam = metSites.filter(s => s.type === 'Dam').length
              const dcm = metSites.filter(s => s.type === 'Dcm').length
              const cpg = metSites.filter(s => s.type === 'CpG').length
              if (dam + dcm + cpg === 0) return null
              return (
                <div className="mt-2 p-2 bg-amber-50 rounded text-[10px] text-amber-700">
                  甲基化位点统计: Dam(GATC)={dam} | Dcm(CCWGG)={dcm} | CpG(CG)={cpg}
                  <div className="text-[9px] text-amber-500 mt-0.5">
                    Dam+ 菌株中 Dam 敏感酶可能无法切割，建议使用 dam-/dcm- 菌株制备的 DNA
                  </div>
                </div>
              )
            })()}
            </div>

            {/* ========== 右侧：已选酶切位点面板 ========== */}
            <div className="w-[240px] flex-shrink-0 flex flex-col border-l border-slate-200 pl-4 overflow-hidden">
              {/* 汇总信息 */}
              {(() => {
                const sites = data?.enzymeSites || []
                const selected = draftFilter.selectedEnzymes
                const selectedList = Array.from(selected).map(name => {
                  const enzSites = sites.filter(s => s.enzyme_name === name)
                  const recogSeq = enzSites[0]?.recognition_sequence || enzymes.find(e => e.name === name)?.recognition_sequence || ''
                  return { name, recogSeq, siteCount: enzSites.length, positions: enzSites.map(s => s.position).sort((a, b) => a - b) }
                }).filter(e => e.siteCount > 0)
                const totalSites = selectedList.reduce((s, e) => s + e.siteCount, 0)
                return (
                  <>
                    <div className="mb-3 p-2 bg-violet-50 rounded-lg border border-violet-200">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-semibold text-violet-700">已选汇总</span>
                        <button onClick={() => updateDraftFilter({ selectedEnzymes: new Set() })}
                          className="text-[9px] text-violet-400 hover:text-red-500">清空全部</button>
                      </div>
                      <div className="flex gap-3 text-[10px]">
                        <span className="text-violet-700"><strong>{selected.size}</strong> 种酶</span>
                        <span className="text-violet-700"><strong>{totalSites}</strong> 个切点</span>
                      </div>
                    </div>
                    {/* 已选酶列表 */}
                    <div className="text-[10px] font-semibold text-slate-500 mb-1">已选酶切位点</div>
                    <div className="flex-1 overflow-auto border border-slate-200 rounded bg-white">
                      {selectedList.length === 0 ? (
                        <div className="text-center text-[10px] text-slate-400 py-6">未选择任何酶</div>
                      ) : (
                        <table className="w-full text-[10px]">
                          <thead className="bg-slate-50 sticky top-0 z-10">
                            <tr>
                              <th className="text-left px-2 py-1 font-medium text-slate-600">酶名</th>
                              <th className="text-left px-1 py-1 font-medium text-slate-600">识别序列</th>
                              <th className="text-right px-2 py-1 font-medium text-slate-600">位点</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedList.map(e => (
                              <tr key={e.name} className="border-t border-slate-100">
                                <td className="px-2 py-1 font-medium text-slate-700">{e.name}</td>
                                <td className="px-1 py-1 font-mono text-amber-600">{e.recogSeq.toUpperCase()}</td>
                                <td className="px-2 py-1 text-right text-slate-500" title={e.positions.join(', ')}>
                                  {e.siteCount}{e.siteCount === 1 ? '' : ` (${e.positions.slice(0, 3).join(',')}${e.siteCount > 3 ? '...' : ''})`}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </>
                )
              })()}
            </div>
            </div>

            {/* 底部按钮 */}
            <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-slate-200">
              <button onClick={closeEnzymeSettings}
                className="px-3 py-1.5 text-xs border rounded text-slate-600 hover:bg-slate-50">{t('export.cancel')}</button>
              <button onClick={commitEnzymeSettings}
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

      {/* 克隆设计面板 */}
      {activePanel === 'cloning' && (
        <ResizablePanel defaultWidth={420} minWidth={320}>
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200">
            <h4 className="text-sm font-bold text-emerald-700 flex items-center gap-2">
              <FlaskConical size={16} /> 克隆策略设计器
            </h4>
            <button onClick={() => setActivePanel('none')}
              className="p-1 text-slate-400 hover:text-slate-600"><X size={14} /></button>
          </div>
          <CloningDesigner
            vectorSequence={data?.vector.sequence || ''}
            className="flex-1"
          />
        </ResizablePanel>
      )}

      {/* 蛋白质分析面板 */}
      {activePanel === 'protein' && (
        <ResizablePanel defaultWidth={400} minWidth={320}>
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200">
            <h4 className="text-sm font-bold text-indigo-700 flex items-center gap-2">
              <Activity size={16} /> 蛋白质理化分析
            </h4>
            <button onClick={() => { setActivePanel('none'); setContextMenuSequence(null) }}
              className="p-1 text-slate-400 hover:text-slate-600"><X size={14} /></button>
          </div>
          <ProteinAnalysisPanel
            dnaSequence={contextMenuSequence || data?.vector.sequence || ''}
            className="flex-1"
          />
        </ResizablePanel>
      )}

      {/* 多序列比对面板 */}
      {activePanel === 'msa' && (
        <ResizablePanel defaultWidth={520} minWidth={400}>
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200">
            <h4 className="text-sm font-bold text-cyan-700 flex items-center gap-2">
              <GitBranch size={16} /> 多序列比对 (ClustalW)
            </h4>
            <button onClick={() => setActivePanel('none')}
              className="p-1 text-slate-400 hover:text-slate-600"><X size={14} /></button>
          </div>
          <MultiSeqAligner className="flex-1" />
        </ResizablePanel>
      )}

      {/* 模拟酶切鉴定面板（首次挂载后 CSS 显隐，保留内部状态） */}
      {digestMounted && (
        <div style={{ display: activePanel === 'digest' ? undefined : 'none' }} className="flex">
          <ResizablePanel defaultWidth={900} minWidth={600}>
            <DigestSimulationPanel
              sequence={data?.vector.sequence || ''}
              topology={(data?.vector.topology as 'circular' | 'linear') || 'circular'}
              onClose={() => setActivePanel('none')}
              className="flex-1"
            />
          </ResizablePanel>
        </div>
      )}

      {/* 高级克隆面板 */}
      {activePanel === 'extClone' && (
        <ResizablePanel defaultWidth={460} minWidth={360}>
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200">
            <h4 className="text-sm font-bold text-teal-700 flex items-center gap-2">
              <Sparkles size={16} /> 高级克隆与定点诱变
            </h4>
            <button onClick={() => setActivePanel('none')}
              className="p-1 text-slate-400 hover:text-slate-600"><X size={14} /></button>
          </div>
          <ExtendedCloningPanel
            vectorSequence={data?.vector.sequence}
            className="flex-1"
          />
        </ResizablePanel>
      )}

      {/* BLAST 搜索面板 */}
      {activePanel === 'blast' && (
        <ResizablePanel defaultWidth={400} minWidth={320}>
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200">
            <h4 className="text-sm font-bold text-sky-700 flex items-center gap-2">
              <Globe size={16} /> NCBI BLAST 在线搜索
            </h4>
            <button onClick={() => { setActivePanel('none'); setContextMenuSequence(null) }}
              className="p-1 text-slate-400 hover:text-slate-600"><X size={14} /></button>
          </div>
          <BlastSearchPanel
            initialSequence={contextMenuSequence || data?.vector.sequence}
            className="flex-1"
          />
        </ResizablePanel>
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

      {/* 序列比对输入对话框 */}
      {showAlignInputDialog && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[9999]" onClick={() => setShowAlignInputDialog(false)}>
          <div className="bg-white rounded-xl p-5 w-[520px] shadow-2xl" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            <h4 className="font-bold text-sm mb-3 flex items-center gap-2">
              <AlignLeft size={16} className="text-blue-600" /> {t('editor.alignSequence') || '序列比对'}
            </h4>
            {seqSelection && (
              <p className="text-xs text-slate-500 mb-3">
                选区: {seqSelection.start + 1}..{seqSelection.end + 1} ({seqSelection.end - seqSelection.start + 1} bp)
              </p>
            )}
            <div className="mb-3">
              <label className="text-xs text-slate-600 mb-1 block">比对类型</label>
              <select value={alignType} onChange={e => setAlignType(e.target.value as AlignmentType)}
                className="w-full px-2 py-1.5 border rounded text-xs">
                <option value="nucleotide-nw">核酸全局比对 (Needleman-Wunsch)</option>
                <option value="nucleotide-sw">核酸局部比对 (Smith-Waterman)</option>
                <option value="protein">蛋白质比对 (BLOSUM62)</option>
                <option value="nucleotide-protein">核酸-蛋白质 (六框翻译)</option>
              </select>
            </div>
            <div className="mb-3">
              <label className="text-xs text-slate-600 mb-1 block">序列名称（可选）</label>
              <input value={alignInputName} onChange={e => setAlignInputName(e.target.value)}
                placeholder="输入序列名称" className="w-full px-2 py-1.5 border rounded text-xs" />
            </div>
            <div className="mb-3">
              <label className="text-xs text-slate-600 mb-1 block">输入要比对的序列</label>
              <textarea value={alignInputSeq} onChange={e => setAlignInputSeq(e.target.value)}
                className="w-full h-32 px-3 py-2 border rounded font-mono text-xs resize-none focus:outline-none focus:ring-1 focus:ring-blue-300"
                placeholder={alignType === 'protein' ? '输入氨基酸序列 (如: MVLSPAD...)' : '输入核酸序列 (如: ATCGATCG...)'} />
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-slate-400">{alignInputSeq.replace(/\s/g, '').length} {alignType === 'protein' ? 'aa' : 'bp'}</span>
                <button onClick={() => {
                  try { navigator.clipboard.readText().then(t => setAlignInputSeq(t)).catch(() => {}) } catch {}
                }} className="text-[10px] text-blue-600 hover:underline">从剪贴板粘贴</button>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAlignInputDialog(false)}
                className="px-3 py-1.5 text-xs border rounded">取消</button>
              <button onClick={handleDoAlignment} disabled={!alignInputSeq || !seqSelection}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40">
                {alignment.status === 'running' ? '比对中...' : '开始比对'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 比对结果抽屉 */}
      {showAlignmentDrawer && (
        <ResizablePanel defaultWidth={600} minWidth={400}>
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200">
            <h4 className="text-sm font-bold text-blue-700 flex items-center gap-2">
              <AlignLeft size={14} /> 比对结果
            </h4>
            <button onClick={() => { setShowAlignmentDrawer(false); alignment.reset() }}
              className="p-1 text-slate-400 hover:text-slate-600"><X size={14} /></button>
          </div>
          {alignment.status === 'running' && (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
              <div className="animate-spin w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full mr-2" />
              比对计算中...
            </div>
          )}
          {alignment.status === 'error' && (
            <div className="flex-1 flex items-center justify-center text-red-500 text-sm">{alignment.error}</div>
          )}
          {alignment.status === 'done' && alignment.result && (
            <AlignmentViewer output={alignment.result} className="flex-1" />
          )}
          {alignment.status === 'idle' && (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">请在序列编辑器中选择区域后点击比对</div>
          )}
        </ResizablePanel>
      )}

      {/* 引物设计面板 */}
      {activePanel === 'primer' && (
        <ResizablePanel defaultWidth={380} minWidth={320}>
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200">
            <h4 className="text-sm font-bold text-violet-700 flex items-center gap-2">
              <FlaskConical size={14} /> 引物设计
            </h4>
            <button onClick={() => setActivePanel('none')}
              className="p-1 text-slate-400 hover:text-slate-600"><X size={14} /></button>
          </div>
          <PrimerDesignPanel
            templateSeq={data?.vector.sequence || ''}
            selectionStart={seqSelection?.start ?? 0}
            selectionEnd={seqSelection?.end ?? 0}
            status={primerDesign.status}
            result={primerDesign.result}
            error={primerDesign.error}
            onDesign={handlePrimerDesignRun}
            selectedPair={primerDesign.selectedPair}
            onSelectPair={primerDesign.setSelectedPair}
            onShowOnMap={handleShowPrimersOnSequence}
            onSaveToDatabase={handleSavePrimersToDb}
            className="flex-1"
          />
        </ResizablePanel>
      )}

      {/* 智能标注元件弹窗 */}
      {showNormalizationDialog && smartAnnotation.matches && smartAnnotation.matches.length > 0 && (
        <NormalizationDialog
          matches={smartAnnotation.matches}
          vectorName={vector.name}
          onAccept={async (accepted) => {
            console.log(`[SmartAnnotate] onAccept: ${accepted.length} 个匹配项待应用`, accepted.map(m => `${m.match_component_name}(${m.match_start}-${m.match_end})`))
            // 全序列扫描结果：所有 feature_index 均为 -1
            // 策略：对每个匹配，检查是否有现有 feature 重叠 → 更新该 feature；否则创建新 feature
            let updated = [...features]
            let matchedCount = 0
            let createdCount = 0
            for (const m of accepted) {
              // 检查是否有现有 feature 与此匹配坐标重叠
              const matchStart0 = m.match_start - 1 // 1-based → 0-based start
              const matchEnd0 = m.match_end - 1     // 1-based → 0-based inclusive end
              const matchLen = matchEnd0 - matchStart0 + 1 // 包含两端的长度
              let overlappingIdx = -1
              let bestOverlap = 0
              for (let i = 0; i < updated.length; i++) {
                const f = updated[i]
                const overlapStart = Math.max(f.start, matchStart0)
                const overlapEnd = Math.min(f.end, matchEnd0)
                const overlap = Math.max(0, overlapEnd - overlapStart)
                if (overlap > bestOverlap) {
                  bestOverlap = overlap
                  overlappingIdx = i
                }
              }
              // 如果重叠 >50% 的匹配长度，更新现有 feature
              if (overlappingIdx >= 0 && bestOverlap > matchLen * 0.5) {
                const f = { ...updated[overlappingIdx] }
                f.qualifiers = { ...f.qualifiers, label: m.match_component_name, normalized_type: m.component_type }
                const newType = COMP_TYPE_TO_GB[m.component_type]
                if (newType && f.type !== newType) {
                  f.type = newType
                }
                // 必须用匹配的精确坐标覆盖原 feature 的坐标和方向
                f.start = matchStart0
                f.end = matchEnd0
                f.strand = m.strand
                f.location = m.strand === -1
                  ? `complement(${m.match_start}..${m.match_end})`
                  : `${m.match_start}..${m.match_end}`
                updated[overlappingIdx] = f
                matchedCount++
                console.log(`[SmartAnnotate] 更新 feature[${overlappingIdx}]: ${m.match_component_name} (type=${f.type}, 新坐标 ${f.start}-${f.end}, strand=${f.strand})`)
              } else {
                // 无重叠或重叠不足，创建新 feature
                const gbType = COMP_TYPE_TO_GB[m.component_type] || 'misc_feature'
                const newFeature: GenBankFeature = {
                  type: gbType,
                  location: m.strand === -1
                    ? `complement(${m.match_start}..${m.match_end})`
                    : `${m.match_start}..${m.match_end}`,
                  start: matchStart0,
                  end: matchEnd0,
                  strand: m.strand,
                  qualifiers: { label: m.match_component_name, normalized_type: m.component_type }
                }
                updated.push(newFeature)
                createdCount++
                console.log(`[SmartAnnotate] 新增 feature: ${m.match_component_name} (${gbType}, ${m.match_start}-${m.match_end})`)
              }
            }
            console.log(`[SmartAnnotate] 更新 ${matchedCount} 个, 新增 ${createdCount} 个, 共 ${accepted.length} 个元件`)
            setData(prev => prev ? { ...prev, features: updated } : null)
            setDirty(true)

            // 同步标注结果到元件数据库
            try {
              const sourceOrganism = features
                .filter(f => f.type === 'source')
                .map(f => f.qualifiers?.organism || '')
                .find(s => s) || ''
              const seq = vector?.sequence || ''
              const syncMatches = accepted.map(m => ({
                component_id: m.match_component_id,
                standard_name: m.match_component_name,
                component_type: m.component_type,
                match_start: m.match_start,
                match_end: m.match_end,
                strand: m.strand,
                current_name: ''
              }))
              const result = await window.api.syncNormalizationToDb?.(syncMatches as any, seq, updated, sourceOrganism)
              if (result?.updated > 0) {
                console.log(`[SmartAnnotate] 同步更新了 ${result.updated} 个元件数据库记录`)
              }
            } catch (e) {
              console.warn('[SmartAnnotate] 同步元件数据库失败:', e)
            }

            setShowNormalizationDialog(false)
            smartAnnotation.reset()
          }}
          onClose={() => { setShowNormalizationDialog(false); smartAnnotation.reset() }}
        />
      )}

      {/* 批量导入预览弹窗 */}
      {showImportPreview && (
        <ImportPreviewDialog
          items={importPreviewItems}
          vectorName={vector.name}
          isLoading={importPreviewLoading}
          onConfirm={async (decisions: ImportDecision[]) => {
            try {
              const seq = vector?.sequence || ''
              const result = await window.api.executeBatchImport(features, seq, vector?.name, decisions)
              const parts: string[] = []
              if (result.imported > 0) parts.push(`已导入 ${result.imported} 个元件`)
              if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 个`)
              if (result.linked > 0) parts.push(`关联 ${result.linked} 个相似变体`)
              if (result.failed > 0) parts.push(`失败 ${result.failed} 个`)
              alert(parts.join('，') || '导入完成')
            } catch (e: any) {
              console.error('[VectorEditor] Batch import execute failed:', e)
              alert('批量导入执行失败: ' + (e.message || '未知错误'))
            }
            setShowImportPreview(false)
            setImportPreviewItems([])
          }}
          onClose={() => { setShowImportPreview(false); setImportPreviewItems([]) }}
        />
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

/** 元件列表项 memo 组件：避免父组件重渲染时所有列表项全部重新渲染 */
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
    // dragFeatureIdx is stored in parent; pass via custom event attribute
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
        <GripHorizontal size={10} className="text-slate-300 cursor-grab opacity-0 group-hover:opacity-100 flex-shrink-0" />
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
