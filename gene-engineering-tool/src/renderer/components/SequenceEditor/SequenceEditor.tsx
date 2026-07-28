import { useState, useRef, useMemo, useCallback, useEffect, useLayoutEffect, memo } from 'react'
import { Search, Copy, Clipboard, Bookmark, ArrowUp, ArrowDown, Undo2, Redo2, ChevronDown, X, AlignLeft, FlaskConical, Palette, Dna } from 'lucide-react'
import type { GenBankFeature } from '../../../shared/types'
import { useLifecycleLog } from '../../hooks/useDebugLog'
import { useContextMenu } from '../ui/ContextMenu'

interface EnzymeSiteInfo {
  id: number
  enzyme_name?: string
  recognition_sequence?: string
  cut_position?: number
  position: number
  is_unique: boolean
  recog_start: number
  recog_end: number
  strand: 1 | -1
}

interface PrimerSiteInfo {
  primer_id: number
  primer_name: string
  sequence: string
  position: number
  recog_start: number
  recog_end: number
  strand: 1 | -1
}

interface Props {
  sequence: string
  features: GenBankFeature[]
  enzymeSites: EnzymeSiteInfo[]
  primerSites?: PrimerSiteInfo[]
  onSequenceChange: (seq: string, adjustment?: {
    type: 'delete', start: number, end: number, keepFeatures: boolean
  } | {
    type: 'insert', position: number, length: number
  }) => void
  onAddFeature: (feature: GenBankFeature) => void
  onDeleteFeature: (index: number) => void
  selectedFeature: number | null
  onSelectFeature: (i: number | null) => void
  hoveredFeature: number | null
  mapSelection: { start: number; end: number } | null
  onClearMapSelection: () => void
  onSelectionChange?: (sel: { start: number; end: number } | null, insertPos: number | null) => void
  onHoverPosition?: (pos: number | null) => void
  /** 比对选区回调（传入时显示比对按钮） */
  onAlignSelection?: () => void
  /** 设计引物回调（传入时显示设计引物按钮） */
  onDesignPrimers?: () => void
  /** BLAST 搜索回调 */
  onBlastSearch?: () => void
  /** 翻译选区序列为蛋白质 */
  onTranslateSequence?: () => void
  /** 添加选区到元件数据库 */
  onAddToComponentDb?: () => void
}

const FEATURE_COLORS: Record<string, string> = {
  gene: '#10b981', CDS: '#3b82f6', mRNA: '#06b6d4', promoter: '#f59e0b',
  terminator: '#ef4444', rep_origin: '#8b5cf6', misc_feature: '#94a3b8',
  primer_bind: '#ec4899', protein_bind: '#6366f1', regulatory: '#f97316',
  enhancer: '#fbbf24', exon: '#14b8a6', intron: '#a3a3a3',
  five_prime_UTR: '#84cc16', three_prime_UTR: '#e879f9',
  sig_peptide: '#f97316', polyA_signal: '#eab308',
  STS: '#64748b', ncRNA: '#06b6d4', misc_RNA: '#06b6d4',
  misc_binding: '#64748b', misc_difference: '#94a3b8',
  misc_recomb: '#8b5cf6', source: '#9ca3af'
}
function getColor(t: string): string { return FEATURE_COLORS[t] || '#cbd5e1' }

import { getFeatureTypeName } from '../../../shared/i18n'

/** 元件类型名称映射 - 动态代理，根据当前语言返回翻译 */
export const FEATURE_TYPE_NAMES: Record<string, string> = new Proxy({} as Record<string, string>, {
  get(_target, prop: string) {
    if (typeof prop !== 'string') return undefined
    return getFeatureTypeName(prop)
  }
})
export function featureTypeName(type: string): string {
  const name = getFeatureTypeName(type)
  return name === type ? type : `${name} (${type})`
}

/** 元件组件类型中文名（规范化后用） */
export const COMPONENT_TYPE_ZH: Record<string, string> = {
  resistance: '抗性基因', CDS: '编码序列', promoter: '启动子',
  origin: '复制子', terminator: '终止子', enhancer: '增强子',
  reporter: '报告基因', tag: '标签序列', regulatory: '调控元件', other: '其他'
}

/** 生成元件显示标签：规范化元件返回“名称 (类型)”，普通元件返回原有格式 */
export function getFeatureDisplayLabel(f: { type: string; qualifiers?: Record<string, string> }): string {
  const nt = f.qualifiers?.normalized_type
  if (nt && COMPONENT_TYPE_ZH[nt]) {
    const name = f.qualifiers?.label || f.qualifiers?.gene || ''
    return name ? `${name} (${COMPONENT_TYPE_ZH[nt]})` : COMPONENT_TYPE_ZH[nt]
  }
  // 普通元件：原有逻辑
  const typeZh = FEATURE_TYPE_NAMES[f.type] || f.type
  const note = f.qualifiers?.note || ''
  if (note) return `${typeZh} ${note}`
  // exon/intron 带 number 限定符时显示编号
  const num = f.qualifiers?.number
  if (num && (f.type === 'exon' || f.type === 'intron')) return `${typeZh} ${num}`
  return typeZh
}

const COMP: Record<string, string> = { a:'t',t:'a',c:'g',g:'c',r:'y',y:'r',s:'s',w:'w',k:'m',m:'k',b:'v',v:'b',d:'h',h:'d',n:'n' }
function comp(b: string): string { return COMP[b] || b }
function revComp(seq: string): string { return seq.split('').map(c => comp(c.toLowerCase())).reverse().join('') }

/** IUPAC 模糊碱基映射 */
const IUPAC_MAP: Record<string, string> = {
  R: '[ag]', Y: '[ct]', S: '[gc]', W: '[at]', K: '[gt]', M: '[ac]',
  B: '[cgt]', D: '[agt]', H: '[act]', V: '[acg]', N: '[acgt]'
}

/** 碱基着色方案（与 index.css .nucleotide-* 保持一致） */
const BASE_COLORS: Record<string, string> = { a: '#22c55e', t: '#ef4444', g: '#f59e0b', c: '#3b82f6' }

/** 密码子阅读框背景色（交替三色，浅色不干扰碱基文字可读性） */
const CODON_BG = ['#dbeafe', '#fef3c7', '#f3e8ff'] // 蓝/黄/紫 淡色

/** 为每个酶分配不同颜色 */
const ENZYME_PALETTE = [
  '#e6194b','#3cb44b','#4363d8','#f58231','#911eb4','#42d4f4','#f032e6',
  '#bfef45','#fabebe','#469990','#dcbeff','#9A6324','#800000','#aaffc3',
  '#808000','#ffd8b1','#000075','#a9a9a9','#e6beff','#1abc9c','#e74c3c',
  '#2ecc71','#3498db','#9b59b6','#f39c12','#16a085','#c0392b','#27ae60'
]
export function enzymeColor(name: string): string {
  let h = 0; for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0
  return ENZYME_PALETTE[Math.abs(h) % ENZYME_PALETTE.length]
}

const CURSOR_STYLE = `
@keyframes seq-cursor-blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }
.seq-cursor-line { animation: seq-cursor-blink 1s step-end infinite; }
`

// 布局常量
const BASE_W = 7.2 // 单碱基宽度(px)
const GAP_W = 3    // 间隙宽度(px)
const STEP = BASE_W + GAP_W // 每个碱基的步长
const ENZYME_LANE_H = 13 // 酶切位点每层高度
const ENZYME_LINE_H = 2   // 划线高度
const ENZYME_GAP = 1      // 划线与文字间距

/** 计算重叠酶切位点的分层 */
function computeLanes(sites: EnzymeSiteInfo[]): Map<number, number> {
  const laneEnds: number[] = []
  const result = new Map<number, number>()
  const sorted = [...sites].sort((a, b) => a.recog_start - b.recog_start)
  for (const site of sorted) {
    let lane = 0
    while (lane < laneEnds.length && laneEnds[lane] > site.recog_start) lane++
    if (lane >= laneEnds.length) laneEnds.push(0)
    laneEnds[lane] = site.recog_end + 3
    result.set(site.id, lane)
  }
  return result
}

/** 计算重叠引物的分层 */
function computePrimerLanes(sites: PrimerSiteInfo[]): Map<number, number> {
  const laneEnds: number[] = []
  const result = new Map<number, number>()
  const sorted = sites.map((s, i) => ({ s, idx: i })).sort((a, b) => a.s.recog_start - b.s.recog_start)
  for (const { s, idx } of sorted) {
    let lane = 0
    while (lane < laneEnds.length && laneEnds[lane] > s.recog_start) lane++
    if (lane >= laneEnds.length) laneEnds.push(0)
    laneEnds[lane] = s.recog_end + 3
    result.set(idx, lane)
  }
  return result
}

/** 选区坐标直接输入组件 */
function SelectionCoordInput({ seqLength, hasSelection, selLo, selHi, insertPos, cursorMode, onSetSelection }: {
  seqLength: number
  hasSelection: boolean
  selLo: number
  selHi: number
  insertPos: number
  cursorMode: 'select' | 'insert'
  onSetSelection: (start: number, end: number) => void
}) {
  const [startVal, setStartVal] = useState('')
  const [endVal, setEndVal] = useState('')
  const [error, setError] = useState('')

  // 同步当前选区到输入框
  useEffect(() => {
    if (hasSelection) {
      setStartVal(String(selLo + 1))
      setEndVal(String(selHi + 1))
      setError('')
    } else if (cursorMode === 'insert') {
      setStartVal('')
      setEndVal('')
    }
  }, [hasSelection, selLo, selHi, cursorMode])

  const applySelection = useCallback(() => {
    const s = parseInt(startVal)
    const e = parseInt(endVal)
    if (isNaN(s) || isNaN(e)) { setError('请输入数字'); return }
    if (s < 1) { setError('起点不能小于 1'); return }
    if (e > seqLength) { setError(`终点不能超过 ${seqLength}`); return }
    if (s > e) { setError('起点不能大于终点'); return }
    setError('')
    onSetSelection(s - 1, e - 1) // 转换为 0-based
  }, [startVal, endVal, seqLength, onSetSelection])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter') applySelection()
  }, [applySelection])

  if (!seqLength) return null

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={startVal}
        onChange={e => setStartVal(e.target.value)}
        onBlur={applySelection}
        onKeyDown={handleKeyDown}
        placeholder="Start"
        min={1}
        max={seqLength}
        className="w-16 px-1.5 py-0.5 text-[10px] border border-slate-200 rounded focus:border-blue-400 focus:outline-none"
        onMouseDown={e => e.stopPropagation()}
      />
      <span className="text-[10px] text-slate-400">..</span>
      <input
        type="number"
        value={endVal}
        onChange={e => setEndVal(e.target.value)}
        onBlur={applySelection}
        onKeyDown={handleKeyDown}
        placeholder="End"
        min={1}
        max={seqLength}
        className="w-16 px-1.5 py-0.5 text-[10px] border border-slate-200 rounded focus:border-blue-400 focus:outline-none"
        onMouseDown={e => e.stopPropagation()}
      />
      {hasSelection && (
        <span className="text-[10px] text-blue-500">({selHi - selLo + 1} bp)</span>
      )}
      {cursorMode === 'insert' && !hasSelection && (
        <span className="text-[10px] text-slate-400">光标: {insertPos}</span>
      )}
      {error && <span className="text-[9px] text-red-500">{error}</span>}
    </div>
  )
}

function SequenceEditor({
  sequence, features, enzymeSites, primerSites = [], onSequenceChange, onAddFeature, onDeleteFeature,
  selectedFeature, onSelectFeature, hoveredFeature, mapSelection, onClearMapSelection,
  onSelectionChange, onHoverPosition, onAlignSelection, onDesignPrimers,
  onBlastSearch, onTranslateSequence, onAddToComponentDb
}: Props) {
  useLifecycleLog('SequenceEditor', { seqLen: sequence.length, features: features.length, enzymeSites: enzymeSites.length })
  const seqRef = useRef<HTMLDivElement>(null)
  const [lineWidth, setLineWidth] = useState(60)

  // 光标状态
  const [cursorMode, setCursorMode] = useState<'select' | 'insert'>('insert')
  const [selStart, setSelStart] = useState(0)
  const [selEnd, setSelEnd] = useState(0)
  const [insertPos, setInsertPos] = useState(0)
  const dragStartRef = useRef<number | null>(null)
  const isDraggingRef = useRef(false)
  // RAF 节流：拖选期间仅每帧更新一次 selEnd，避免高频重渲染
  const selEndRafRef = useRef<number>(0)
  const selEndPendingRef = useRef<number | null>(null)
  // 自动滚动 RAF
  const autoScrollRafRef = useRef<number>(0)
  const lastMouseYRef = useRef<number>(0)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchMode, setSearchMode] = useState<'exact' | 'iupac' | 'regex'>('exact')
  const [searchResults, setSearchResults] = useState<{pos: number, len: number, strand: 1|-1}[]>([])
  const [searchIdx, setSearchIdx] = useState(0)
  const [undoStack, setUndoStack] = useState<string[]>([])
  const [redoStack, setRedoStack] = useState<string[]>([])
  const [showCopyMenu, setShowCopyMenu] = useState(false)
  const [baseColoring, setBaseColoring] = useState(false)
  const [codonFrame, setCodonFrame] = useState<number | null>(null) // null=关闭, 0/1/2=阅读框偏移

  const [showMarkDialog, setShowMarkDialog] = useState(false)
  const [showInsertDialog, setShowInsertDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [pendingInsert, setPendingInsert] = useState('')
  const [pendingInsertPos, setPendingInsertPos] = useState(0)
  const [pendingDelete, setPendingDelete] = useState<{ start: number; end: number } | null>(null)
  const [keepAffectedFeatures, setKeepAffectedFeatures] = useState(true) // 删除时是否保留受影响元件
  const [featureForm, setFeatureForm] = useState({ type: 'misc_feature', start: 1, end: 1, strand: 1 as 1 | -1, label: '', gene: '' })

  // ESC 键关闭当前打开的对话框
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (showInsertDialog) { setShowInsertDialog(false); return }
      if (showDeleteDialog) { setShowDeleteDialog(false); return }
      if (showMarkDialog) { setShowMarkDialog(false); return }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [showInsertDialog, showDeleteDialog, showMarkDialog])

  // ============ 自适应行宽 ============
  useLayoutEffect(() => {
    const calc = () => {
      if (!seqRef.current) return
      const w = seqRef.current.clientWidth - 90
      const chars = Math.max(20, Math.floor(w / STEP))
      const rounded = Math.floor(chars / 10) * 10
      setLineWidth(Math.max(20, rounded))
    }
    calc()
    const ro = new ResizeObserver(calc)
    if (seqRef.current) ro.observe(seqRef.current)
    return () => ro.disconnect()
  }, [])

  // ============ 选区计算（提前声明，供 useEffect 使用） ============
  const hasSelection = cursorMode === 'select' && selStart !== selEnd
  const selLo = hasSelection ? Math.min(selStart, selEnd) : -1
  const selHi = hasSelection ? Math.max(selStart, selEnd) : -1

  // ============ 图谱联动 ============
  useEffect(() => {
    if (mapSelection) {
      setCursorMode('select')
      setSelStart(mapSelection.start)
      setSelEnd(mapSelection.end)
      const ln = Math.floor(mapSelection.start / lineWidth)
      // 虚拟滚动：估算滚动位置
      const avgH = 55
      const containerH = seqRef.current?.clientHeight || 600
      seqRef.current?.scrollTo({ top: Math.max(0, ln * avgH - containerH / 2), behavior: 'smooth' })
    }
  }, [mapSelection, lineWidth])

  // ============ 序列选择 → 图谱联动（拖选结束时才通知父组件，避免高频重渲染） ============
  const selectionChangeRafRef = useRef<number>(0)
  const lastCommittedSelRef = useRef<{ lo: number; hi: number } | null>(null)
  useEffect(() => {
    if (!onSelectionChange) return
    if (cursorMode === 'select' && hasSelection) {
      // 拖选进行中时延迟通知，仅在 RAF 中合并更新
      const lo = selLo, hi = selHi
      const last = lastCommittedSelRef.current
      if (last && last.lo === lo && last.hi === hi) return // 无变化不通知
      if (selectionChangeRafRef.current) return // 已有待执行
      selectionChangeRafRef.current = requestAnimationFrame(() => {
        selectionChangeRafRef.current = 0
        lastCommittedSelRef.current = { lo, hi }
        onSelectionChange({ start: lo, end: hi }, null)
      })
    } else if (cursorMode === 'insert') {
      lastCommittedSelRef.current = null
      onSelectionChange(null, insertPos)
    }
    return () => { if (selectionChangeRafRef.current) { cancelAnimationFrame(selectionChangeRafRef.current); selectionChangeRafRef.current = 0 } }
  }, [cursorMode, selLo, selHi, insertPos, hasSelection, onSelectionChange])

  // ============ IUPAC 模糊碱基映射 ============

  /** 将查询字符串转为正则（根据 searchMode） */
  const buildSearchRegex = useCallback((q: string): RegExp | null => {
    if (!q || q.length < 2) return null
    try {
      if (searchMode === 'regex') {
        return new RegExp(q, 'gi')
      }
      if (searchMode === 'iupac') {
        const pattern = q.toUpperCase().split('').map(c => IUPAC_MAP[c] || c.toLowerCase()).join('')
        return new RegExp(pattern, 'gi')
      }
      // exact: 转义特殊字符
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(escaped, 'gi')
    } catch { return null }
  }, [searchMode])

  // ============ 搜索（双向：正向 + 反向互补，支持 IUPAC / Regex） ============
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) { setSearchResults([]); setSearchIdx(0); return }
    const r: {pos: number, len: number, strand: 1|-1}[] = []
    const seq = sequence.toLowerCase()
    const re = buildSearchRegex(searchQuery)
    if (!re) { setSearchResults([]); setSearchIdx(0); return }
    // 正向搜索
    let m: RegExpExecArray | null
    re.lastIndex = 0
    while ((m = re.exec(seq)) !== null) {
      r.push({ pos: m.index, len: m[0].length, strand: 1 })
      if (m[0].length === 0) re.lastIndex++  // 防止零宽死循环
    }
    // 反向互补搜索（regex 模式下对 RC 序列也搜索）
    const rcSeq = revComp(seq)
    if (searchMode === 'exact') {
      const rc = revComp(searchQuery.toLowerCase())
      if (rc !== searchQuery.toLowerCase()) {
        const rcRe = new RegExp(rc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
        while ((m = rcRe.exec(seq)) !== null) {
          r.push({ pos: m.index, len: m[0].length, strand: -1 })
          if (m[0].length === 0) rcRe.lastIndex++
        }
      }
    } else {
      // IUPAC/regex: 对 RC 序列用相同正则
      re.lastIndex = 0
      while ((m = re.exec(rcSeq)) !== null) {
        // RC 序列的位置需要映射回正向序列
        const rcPos = seq.length - m.index - m[0].length
        r.push({ pos: rcPos, len: m[0].length, strand: -1 })
        if (m[0].length === 0) re.lastIndex++
      }
    }
    // 去重 + 排序
    const seen = new Set<string>()
    const deduped = r.filter(x => { const k = `${x.pos}:${x.strand}`; if (seen.has(k)) return false; seen.add(k); return true })
    deduped.sort((a, b) => a.pos - b.pos)
    setSearchResults(deduped); setSearchIdx(0)
  }, [searchQuery, searchMode, sequence, buildSearchRegex])

  const scrollSearch = useCallback((d: number) => {
    if (!searchResults.length) return
    const ni = (searchIdx + d + searchResults.length) % searchResults.length
    setSearchIdx(ni)
    const ln = Math.floor(searchResults[ni].pos / lineWidth)
    // 虚拟滚动：估算滚动位置，scroll 事件会触发精确渲染
    const avgH = 55
    const containerH = seqRef.current?.clientHeight || 600
    seqRef.current?.scrollTo({ top: Math.max(0, ln * avgH - containerH / 2), behavior: 'smooth' })
  }, [searchResults, searchIdx, lineWidth])

  // ============ 计算 ============
  const bottomStrand = useMemo(() => sequence.split('').map(c => comp(c.toLowerCase())).join(''), [sequence])

  const searchHL = useMemo(() => { const s = new Set<number>(); searchResults.forEach(r => { for (let i = r.pos; i < r.pos + r.len; i++) s.add(i) }); return s }, [searchResults])
  const searchRCHL = useMemo(() => { const s = new Set<number>(); searchResults.filter(r => r.strand === -1).forEach(r => { for (let i = r.pos; i < r.pos + r.len; i++) s.add(i) }); return s }, [searchResults])
  const curSearch = useMemo(() => { const s = new Set<number>(); if (searchResults.length) { const r = searchResults[searchIdx]; for (let i = r.pos; i < r.pos + r.len; i++) s.add(i) }; return s }, [searchResults, searchIdx])
  const curSearchRC = useMemo(() => { if (searchResults.length && searchResults[searchIdx]?.strand === -1) return true; return false }, [searchResults, searchIdx])
  const hovSet = useMemo(() => { if (hoveredFeature === null || !features[hoveredFeature]) return new Set<number>(); const f = features[hoveredFeature]; const s = new Set<number>(); for (let i = f.start; i <= f.end; i++) s.add(i); return s }, [hoveredFeature, features])
  const featSet = useMemo(() => { if (selectedFeature === null || !features[selectedFeature]) return new Set<number>(); const f = features[selectedFeature]; const s = new Set<number>(); for (let i = f.start; i <= f.end; i++) s.add(i); return s }, [selectedFeature, features])

  // ============ 预计算：元件覆盖映射（事件扫描 + 引用共享优化） ============
  const coverMap = useMemo(() => {
    const map = new Map<number, { indices: number[]; color: string; label: string }>()
    const validFeatures = features
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f.type !== 'source' && f.end >= f.start)
      .sort((a, b) => a.f.start - b.f.start)

    // 事件扫描：收集所有 start/end+1 事件点
    const events: { pos: number; type: number; idx: number }[] = [] // type: 0=start, 1=end
    for (const { f, i } of validFeatures) {
      events.push({ pos: f.start, type: 0, idx: i })
      events.push({ pos: f.end + 1, type: 1, idx: i })
    }
    events.sort((a, b) => a.pos - b.pos || a.type - b.type)

    const activeSet = new Set<number>()
    let eventIdx = 0
    // 引用缓存：相邻位置若覆盖相同元件，共享同一对象引用
    let cachedIndices: number[] = []
    let cachedColor = ''
    let cachedLabel = ''
    let cachedKey = ''

    for (let p = 0; p < sequence.length; p++) {
      let changed = false
      while (eventIdx < events.length && events[eventIdx].pos <= p) {
        const ev = events[eventIdx]
        if (ev.type === 0) { activeSet.add(ev.idx) } else { activeSet.delete(ev.idx) }
        changed = true
        eventIdx++
      }
      if (activeSet.size === 0) continue
      if (changed) {
        const sorted = Array.from(activeSet).sort((a, b) => a - b)
        const key = sorted.join(',')
        if (key !== cachedKey) {
          cachedKey = key
          cachedIndices = sorted
          const lastF = features[cachedIndices[cachedIndices.length - 1]]
          cachedColor = getColor(lastF.type)
          cachedLabel = ' | ' + cachedIndices.map(idx => getFeatureDisplayLabel(features[idx])).join(', ')
        }
      }
      map.set(p, { indices: cachedIndices, color: cachedColor, label: cachedLabel })
    }
    return map
  }, [features, sequence.length])

  // ============ 预计算：酶切/引物按行索引 + 分层（避免渲染循环内重复 computeLanes） ============
  const enzymeSitesByLine = useMemo(() => {
    const map = new Map<number, { fwd: EnzymeSiteInfo[]; rev: EnzymeSiteInfo[] }>()
    for (const site of enzymeSites) {
      const startLine = Math.floor(site.recog_start / lineWidth)
      const endLine = Math.floor(site.recog_end / lineWidth)
      for (let ln = startLine; ln <= endLine; ln++) {
        if (!map.has(ln)) map.set(ln, { fwd: [], rev: [] })
        const bucket = map.get(ln)!
        if (site.strand === 1) bucket.fwd.push(site)
        else bucket.rev.push(site)
      }
    }
    return map
  }, [enzymeSites, lineWidth])

  // 预计算每行酶切位点的分层（一次 computeLanes per line，替代渲染循环内重复调用）
  const enzymeLanesByLine = useMemo(() => {
    const fwdMap = new Map<number, Map<number, number>>()
    const revMap = new Map<number, Map<number, number>>()
    for (const [ln, { fwd, rev }] of enzymeSitesByLine) {
      if (fwd.length > 0) fwdMap.set(ln, computeLanes(fwd))
      if (rev.length > 0) revMap.set(ln, computeLanes(rev))
    }
    return { fwdMap, revMap }
  }, [enzymeSitesByLine])

  const primerSitesByLine = useMemo(() => {
    const map = new Map<number, { fwd: PrimerSiteInfo[]; rev: PrimerSiteInfo[] }>()
    for (const site of primerSites) {
      const startLine = Math.floor(site.recog_start / lineWidth)
      const endLine = Math.floor(site.recog_end / lineWidth)
      for (let ln = startLine; ln <= endLine; ln++) {
        if (!map.has(ln)) map.set(ln, { fwd: [], rev: [] })
        const bucket = map.get(ln)!
        if (site.strand === 1) bucket.fwd.push(site)
        else bucket.rev.push(site)
      }
    }
    return map
  }, [primerSites, lineWidth])

  // 预计算所有引物位点的分层
  const primerLanesByLineIdx = useMemo(() => {
    const fwdMap = new Map<number, Map<number, number>>()
    const revMap = new Map<number, Map<number, number>>()
    // 按行分组后计算分层
    for (const [ln, { fwd, rev }] of primerSitesByLine) {
      if (fwd.length > 0) fwdMap.set(ln, computePrimerLanes(fwd))
      if (rev.length > 0) revMap.set(ln, computePrimerLanes(rev))
    }
    return { fwdMap, revMap }
  }, [primerSitesByLine])

  // ============ 虚拟滚动：预计算每行高度 ============
  const LINE_H = 42 + 8 // 上下链 + margin
  const primerLaneH = 14
  const lineHeights = useMemo(() => {
    const totalLines = Math.ceil(sequence.length / lineWidth) || 1
    const heights: number[] = new Array(totalLines)
    for (let idx = 0; idx < totalLines; idx++) {
      const fwdLanes = enzymeLanesByLine.fwdMap.get(idx) || new Map()
      const revLanes = enzymeLanesByLine.revMap.get(idx) || new Map()
      const maxFwdLane = fwdLanes.size > 0 ? Math.max(0, ...fwdLanes.values()) : -1
      const maxRevLane = revLanes.size > 0 ? Math.max(0, ...revLanes.values()) : -1
      const fwdH = maxFwdLane >= 0 ? (maxFwdLane + 1) * ENZYME_LANE_H : 0
      const revH = maxRevLane >= 0 ? (maxRevLane + 1) * ENZYME_LANE_H : 0
      const fwdPrimerLanes2 = primerLanesByLineIdx.fwdMap.get(idx) || new Map()
      const revPrimerLanes2 = primerLanesByLineIdx.revMap.get(idx) || new Map()
      const maxFwdPL = fwdPrimerLanes2.size > 0 ? Math.max(0, ...fwdPrimerLanes2.values()) : -1
      const maxRevPL = revPrimerLanes2.size > 0 ? Math.max(0, ...revPrimerLanes2.values()) : -1
      const fwdPrimerH = maxFwdPL >= 0 ? (maxFwdPL + 1) * primerLaneH : 0
      const revPrimerH = maxRevPL >= 0 ? (maxRevPL + 1) * primerLaneH : 0
      heights[idx] = fwdH + fwdPrimerH + LINE_H + revH + revPrimerH
    }
    return heights
  }, [sequence.length, lineWidth, enzymeLanesByLine, primerLanesByLineIdx])

  // 滚动位置跟踪
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(600)
  const VIRTUAL_BUFFER = 8 // 可视区域上下各多渲染的行数

  // 监听滚动和容器尺寸
  useEffect(() => {
    const el = seqRef.current
    if (!el) return
    const onScroll = () => setScrollTop(el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight))
    ro.observe(el)
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect() }
  }, [])

  // 计算可见行范围
  const visibleRange = useMemo(() => {
    let accH = 0
    let startLine = 0
    for (let i = 0; i < lineHeights.length; i++) {
      if (accH + lineHeights[i] > scrollTop) { startLine = i; break }
      accH += lineHeights[i]
      if (i === lineHeights.length - 1) startLine = i
    }
    let endLine = startLine
    let visibleH = 0
    for (let i = startLine; i < lineHeights.length; i++) {
      visibleH += lineHeights[i]
      endLine = i
      if (accH + visibleH > scrollTop + viewportH) break
    }
    return {
      start: Math.max(0, startLine - VIRTUAL_BUFFER),
      end: Math.min(lineHeights.length - 1, endLine + VIRTUAL_BUFFER)
    }
  }, [lineHeights, scrollTop, viewportH])

  // 计算顶部占位高度
  const topSpacerH = useMemo(() => {
    let h = 0
    for (let i = 0; i < visibleRange.start; i++) h += lineHeights[i]
    return h
  }, [lineHeights, visibleRange.start])
  const bottomSpacerH = useMemo(() => {
    let h = 0
    for (let i = visibleRange.end + 1; i < lineHeights.length; i++) h += lineHeights[i]
    return h
  }, [lineHeights, visibleRange.end])

  // ============ Undo/Redo ============
  const pushUndo = useCallback(() => { setUndoStack(p => [...p.slice(-20), sequence]); setRedoStack([]) }, [sequence])
  const doUndo = useCallback(() => { if (!undoStack.length) return; const p = undoStack[undoStack.length - 1]; setRedoStack(r => [...r, sequence]); setUndoStack(u => u.slice(0, -1)); onSequenceChange(p) }, [undoStack, sequence, onSequenceChange])
  const doRedo = useCallback(() => { if (!redoStack.length) return; const n = redoStack[redoStack.length - 1]; setUndoStack(u => [...u, sequence]); setRedoStack(r => r.slice(0, -1)); onSequenceChange(n) }, [redoStack, sequence, onSequenceChange])

  // ============ 复制 ============
  const copyStrand = useCallback((strand: 'top' | 'bottom' | 'both') => {
    if (!hasSelection) return
    const top = sequence.substring(selLo, selHi + 1)
    const bot = top.split('').map(c => comp(c.toLowerCase())).reverse().join('')
    let text = ''
    if (strand === 'top') text = top
    else if (strand === 'bottom') text = bot
    else text = `5' ${top} 3'\n3' ${bot} 5'`
    navigator.clipboard.writeText(text).catch(() => {})
    setShowCopyMenu(false)
  }, [hasSelection, selLo, selHi, sequence])

  // ============ 粘贴 → 弹窗 ============
  const handlePaste = useCallback(async () => {
    let clip = ''
    try { clip = await navigator.clipboard.readText() } catch { return }
    if (!clip) return
    const cleaned = clip.toLowerCase().replace(/[^atcgn]/g, '')
    if (!cleaned) return
    const pos = cursorMode === 'insert' ? insertPos : (hasSelection ? selLo : insertPos)
    setPendingInsert(cleaned)
    setPendingInsertPos(pos)
    setFeatureForm(f => ({ ...f, start: pos + 1, end: pos + cleaned.length, strand: 1, label: '', gene: '' }))
    setShowInsertDialog(true)
  }, [cursorMode, insertPos, hasSelection, selLo])

  const confirmInsert = useCallback((markFeature: boolean) => {
    if (!pendingInsert) { setShowInsertDialog(false); return }
    pushUndo()
    const pos = pendingInsertPos
    let newSeq: string
    let adjustment: Parameters<Props['onSequenceChange']>[1]
    if (hasSelection) {
      // 替换选区：先删除再插入
      newSeq = sequence.substring(0, selLo) + pendingInsert + sequence.substring(selHi + 1)
      // 净调整：删除 selLen 碱基 + 插入 insertLen 碱基
      const selLen = selHi - selLo + 1
      const insertLen = pendingInsert.length
      const netChange = insertLen - selLen
      // 简化：将选区替换视为在 selLo 位置调整 netChange 个碱基
      adjustment = { type: 'insert', position: selLo, length: netChange }
    } else {
      newSeq = sequence.substring(0, pos) + pendingInsert + sequence.substring(pos)
      adjustment = { type: 'insert', position: pos, length: pendingInsert.length }
    }
    onSequenceChange(newSeq, adjustment)
    setCursorMode('insert')
    setInsertPos(pos + pendingInsert.length)
    setShowInsertDialog(false)
    if (markFeature) {
      const q: Record<string, string> = {}
      if (featureForm.label) q.label = featureForm.label
      if (featureForm.gene) q.gene = featureForm.gene
      onAddFeature({ type: featureForm.type, location: `${featureForm.start}..${featureForm.end}`,
        start: featureForm.start - 1, end: featureForm.end - 1, strand: featureForm.strand, qualifiers: q })
    }
    setPendingInsert('')
  }, [pendingInsert, pendingInsertPos, hasSelection, selLo, selHi, sequence, onSequenceChange, onAddFeature, featureForm, pushUndo])

  // ============ 删除 → 弹窗 ============
  const handleDelete = useCallback(() => {
    if (!hasSelection) return
    setPendingDelete({ start: selLo, end: selHi })
    setShowDeleteDialog(true)
  }, [hasSelection, selLo, selHi])

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) { setShowDeleteDialog(false); return }
    pushUndo()
    const { start: lo, end: hi } = pendingDelete
    const newSeq = sequence.substring(0, lo) + sequence.substring(hi + 1)
    onSequenceChange(newSeq, { type: 'delete', start: lo, end: hi, keepFeatures: keepAffectedFeatures })
    setCursorMode('insert')
    setInsertPos(lo)
    setShowDeleteDialog(false)
    setPendingDelete(null)
  }, [pendingDelete, sequence, onSequenceChange, keepAffectedFeatures, pushUndo])

  // ============ 标记元件 ============
  const openMarkDialog = useCallback(() => {
    if (!hasSelection) return
    setFeatureForm(f => ({ ...f, start: selLo + 1, end: selHi + 1 }))
    setShowMarkDialog(true)
  }, [hasSelection, selLo, selHi])
  const confirmMark = useCallback(() => {
    if (featureForm.start < 1 || featureForm.end > sequence.length || featureForm.start > featureForm.end) return
    const q: Record<string, string> = {}
    if (featureForm.label) q.label = featureForm.label
    if (featureForm.gene) q.gene = featureForm.gene
    onAddFeature({ type: featureForm.type, location: `${featureForm.start}..${featureForm.end}`,
      start: featureForm.start - 1, end: featureForm.end - 1, strand: featureForm.strand, qualifiers: q })
    setShowMarkDialog(false)
  }, [featureForm, sequence.length, onAddFeature])

  // ============ 键盘交互 ============
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'v') return
    if (e.ctrlKey && e.key === 'c') { copyStrand('top'); return }
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); doUndo(); return }
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); doRedo(); return }
    if (e.ctrlKey && e.key === 'a') { e.preventDefault(); setCursorMode('select'); setSelStart(0); setSelEnd(sequence.length - 1); return }
    if ((e.key === 'Delete' || e.key === 'Backspace') && hasSelection) { e.preventDefault(); handleDelete(); return }
    if (/^[atcgnATCGN]$/.test(e.key) && !e.ctrlKey && !e.altKey) {
      // 输入碱基字符 → 打开插入弹窗（不直接编辑序列，防止绕过元件自动调整）
      e.preventDefault()
      const base = e.key.toLowerCase()
      const pos = cursorMode === 'insert' ? insertPos : (hasSelection ? selLo : insertPos)
      setPendingInsert(base)
      setPendingInsertPos(pos)
      setFeatureForm(f => ({ ...f, start: pos + 1, end: pos + base.length, strand: 1, label: '', gene: '' }))
      setShowInsertDialog(true)
      return
    }
    if (e.key === 'ArrowLeft') { e.preventDefault(); const p = cursorMode === 'insert' ? Math.max(0, insertPos - 1) : Math.max(0, Math.min(selStart, selEnd) - 1); setCursorMode('insert'); setInsertPos(p) }
    if (e.key === 'ArrowRight') { e.preventDefault(); const p = cursorMode === 'insert' ? Math.min(sequence.length, insertPos + 1) : Math.min(sequence.length, Math.max(selStart, selEnd) + 1); setCursorMode('insert'); setInsertPos(p) }
    if (e.key === 'Home') { e.preventDefault(); setCursorMode('insert'); setInsertPos(0) }
    if (e.key === 'End') { e.preventDefault(); setCursorMode('insert'); setInsertPos(sequence.length) }
  }, [cursorMode, insertPos, hasSelection, selLo, selStart, selEnd, sequence, copyStrand, doUndo, doRedo, handleDelete])

  // ============ 粘贴事件 ============
  const handlePasteEvent = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault()
    const clip = e.clipboardData.getData('text')
    const cleaned = clip.toLowerCase().replace(/[^atcgn]/g, '')
    if (!cleaned) return
    const pos = cursorMode === 'insert' ? insertPos : (hasSelection ? selLo : insertPos)
    setPendingInsert(cleaned)
    setPendingInsertPos(pos)
    setFeatureForm(f => ({ ...f, start: pos + 1, end: pos + cleaned.length, strand: 1, label: '', gene: '' }))
    setShowInsertDialog(true)
  }, [cursorMode, insertPos, hasSelection, selLo])

  // ============ 鼠标交互 ============
  /** RAF 节流的 selEnd 更新：拖选期间每帧最多 setState 一次 */
  const scheduleSelEndUpdate = useCallback((pos: number) => {
    selEndPendingRef.current = pos
    if (selEndRafRef.current) return // 本帧已安排
    selEndRafRef.current = requestAnimationFrame(() => {
      selEndRafRef.current = 0
      if (selEndPendingRef.current !== null) {
        setSelEnd(selEndPendingRef.current)
        selEndPendingRef.current = null
      }
    })
  }, [])

  /** 自动滚动：拖选到容器边缘时自动滚动，并持续更新选区 */
  const startAutoScroll = useCallback(() => {
    if (autoScrollRafRef.current) return
    const AUTO_SCROLL_ZONE = 40 // px，距边缘多少像素开始自动滚动
    const AUTO_SCROLL_SPEED = 8 // 每帧滚动像素
    const tick = () => {
      const el = seqRef.current
      if (!el || !isDraggingRef.current) { autoScrollRafRef.current = 0; return }
      const rect = el.getBoundingClientRect()
      const mouseY = lastMouseYRef.current
      let scrolled = false
      if (mouseY < rect.top + AUTO_SCROLL_ZONE) {
        el.scrollTop -= AUTO_SCROLL_SPEED
        scrolled = true
      } else if (mouseY > rect.bottom - AUTO_SCROLL_ZONE) {
        el.scrollTop += AUTO_SCROLL_SPEED
        scrolled = true
      }
      if (scrolled) {
        // 滚动后根据鼠标 X 位置重新计算选区终点
        // 使用 document.elementFromPoint 找到当前行
        const elemAtPoint = document.elementFromPoint(lastMouseXRef.current, mouseY)
        const lineEl = elemAtPoint?.closest?.('[data-line]') as HTMLElement | null
        if (lineEl) {
          const lineIdx = Number(lineEl.getAttribute('data-line'))
          const lineStart = lineIdx * lineWidth
          const lineEnd = Math.min(lineStart + lineWidth, sequence.length)
          const baseRow = lineEl.querySelector('.font-mono') as HTMLElement | null
          if (baseRow) {
            const baseRect = baseRow.getBoundingClientRect()
            const x = lastMouseXRef.current - baseRect.left
            const idx = Math.floor(x / STEP)
            const pos = Math.max(lineStart, Math.min(lineEnd - 1, lineStart + idx))
            scheduleSelEndUpdate(pos)
          }
        }
      }
      autoScrollRafRef.current = requestAnimationFrame(tick)
    }
    autoScrollRafRef.current = requestAnimationFrame(tick)
  }, [lineWidth, sequence.length, scheduleSelEndUpdate])

  const lastMouseXRef = useRef<number>(0)

  const onBaseMouseDown = useCallback((baseIdx: number, e: React.MouseEvent) => {
    if (e.button !== 0) return // 只处理左键，右键不干扰选区
    e.preventDefault()
    onClearMapSelection()
    if (e.shiftKey) {
      // Shift+点击：从当前锚点扩展选区
      setCursorMode('select')
      setSelEnd(baseIdx)
    } else {
      // 普通按下：确定锚点，进入拖选就绪状态
      dragStartRef.current = baseIdx
      isDraggingRef.current = true
      setCursorMode('select')
      setSelStart(baseIdx)
      setSelEnd(baseIdx)
      lastMouseYRef.current = e.clientY
      lastMouseXRef.current = e.clientX
    }
    const fi = features.findIndex(f => baseIdx >= f.start && baseIdx <= f.end)
    onSelectFeature(fi >= 0 ? fi : null)
  }, [features, onClearMapSelection, onSelectFeature])

  // 根据鼠标坐标计算碱基位置（用于平滑拖选和 hover）
  const posFromMouseEvent = useCallback((e: React.MouseEvent | { clientX: number; currentTarget: HTMLElement }, lineStart: number, lineEnd: number) => {
    const target = (e as any).currentTarget as HTMLElement
    const rect = target.getBoundingClientRect()
    const x = e.clientX - rect.left
    const idx = Math.floor(x / STEP)
    return Math.max(lineStart, Math.min(lineEnd - 1, lineStart + idx))
  }, [])

  /** 行容器统一 mousemove 处理：拖选时 RAF 节流更新 selEnd + 触发自动滚动 */
  const handleRowMouseMove = useCallback((e: React.MouseEvent, lineStart: number, lineEnd: number) => {
    lastMouseYRef.current = e.clientY
    lastMouseXRef.current = e.clientX
    const pos = posFromMouseEvent(e, lineStart, lineEnd)
    if (isDraggingRef.current && dragStartRef.current !== null) {
      scheduleSelEndUpdate(pos)
      // 启动自动滚动循环（如果尚未启动）
      startAutoScroll()
    } else {
      onHoverPosition?.(pos)
    }
  }, [posFromMouseEvent, scheduleSelEndUpdate, startAutoScroll, onHoverPosition])

  const onGapClick = useCallback((pos: number) => {
    onClearMapSelection()
    setCursorMode('insert')
    setInsertPos(pos)
  }, [onClearMapSelection])

  /** 间隙 mousedown：也启动拖选（以间隙位置为锚点） */
  const onGapMouseDown = useCallback((pos: number, e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    onClearMapSelection()
    dragStartRef.current = pos
    isDraggingRef.current = true
    setCursorMode('select')
    setSelStart(pos)
    setSelEnd(pos)
    lastMouseYRef.current = e.clientY
    lastMouseXRef.current = e.clientX
  }, [onClearMapSelection])

  useEffect(() => {
    // document 级别 mousemove：拖选时跟踪鼠标位置（即使离开容器也能自动滚动）
    const onDocMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      lastMouseYRef.current = e.clientY
      lastMouseXRef.current = e.clientX
    }
    const onUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false
        dragStartRef.current = null
        // 拖选结束：刷新待处理的 selEnd
        if (selEndPendingRef.current !== null) {
          setSelEnd(selEndPendingRef.current)
          selEndPendingRef.current = null
        }
        if (selEndRafRef.current) { cancelAnimationFrame(selEndRafRef.current); selEndRafRef.current = 0 }
      }
      // 停止自动滚动
      if (autoScrollRafRef.current) { cancelAnimationFrame(autoScrollRafRef.current); autoScrollRafRef.current = 0 }
    }
    document.addEventListener('mousemove', onDocMove, { passive: true })
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onDocMove)
      document.removeEventListener('mouseup', onUp)
      if (autoScrollRafRef.current) cancelAnimationFrame(autoScrollRafRef.current)
      if (selEndRafRef.current) cancelAnimationFrame(selEndRafRef.current)
    }
  }, [])

  // ============ 删除弹窗：受影响元件 ============
  const affectedFeatures = useMemo(() => {
    if (!pendingDelete) return []
    const { start: lo, end: hi } = pendingDelete
    return features.filter(f => f.end >= lo && f.start <= hi).map(f => ({
      name: f.qualifiers.label || f.qualifiers.gene || f.type,
      type: f.type, start: f.start + 1, end: f.end + 1
    }))
  }, [pendingDelete, features])

  const { showContextMenu } = useContextMenu()

  // ============ 右键菜单 ============
  const handleSeqContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    // 计算右键点击的碱基位置
    const lineEl = (e.target as HTMLElement).closest('[data-line]')
    let pos = -1
    if (lineEl) {
      const lineIdx = Number(lineEl.getAttribute('data-line'))
      const lineStart = lineIdx * lineWidth
      const lineEnd = Math.min(lineStart + lineWidth, sequence.length)
      const baseRow = lineEl.querySelector('.font-mono') as HTMLElement | null
      if (baseRow) {
        pos = posFromMouseEvent({ ...e, currentTarget: baseRow } as any, lineStart, lineEnd)
      }
    }

    // 检查点击是否在元件上
    const clickedFeatures = pos >= 0 ? features.filter((f, i) => pos >= f.start && pos <= f.end) : []
    const hasSel = selEnd > selStart || (selStart > 0 && selEnd > 0)

    const items: any[] = []

    // 元件相关菜单
    if (clickedFeatures.length > 0) {
      const feat = clickedFeatures[clickedFeatures.length - 1]
      const featIdx = features.indexOf(feat)
      items.push({ id: 'feat-info', label: getFeatureDisplayLabel(feat), disabled: true })
      items.push({ id: 'feat-select', label: '选中此元件', onClick: () => { onSelectFeature(featIdx); onSelectionChange?.({ start: feat.start, end: feat.end }, null) } })
      items.push({ id: 'feat-delete', label: '删除元件', danger: true, onClick: () => onDeleteFeature(featIdx) })
      items.push({ id: 'sep1', separator: true })
    }

    // 选区相关菜单
    if (hasSel) {
      items.push({ id: 'sel-copy-top', label: '复制上链 (5\'→3\')', shortcut: 'Ctrl+C', onClick: () => copyStrand('top') })
      items.push({ id: 'sel-copy-bottom', label: '复制下链 (3\'→5\')', onClick: () => copyStrand('bottom') })
      items.push({ id: 'sel-copy-both', label: '复制双链', onClick: () => copyStrand('both') })
      items.push({ id: 'sep2', separator: true })
      items.push({ id: 'sel-mark', label: '标记为元件', shortcut: '', onClick: () => openMarkDialog() })
      if (onAlignSelection) items.push({ id: 'sel-align', label: '序列比对', onClick: () => onAlignSelection() })
      if (onDesignPrimers) items.push({ id: 'sel-primer', label: '设计引物', onClick: () => onDesignPrimers() })
      if (onBlastSearch) items.push({ id: 'sel-blast', label: 'BLAST 搜索', onClick: () => onBlastSearch() })
      if (onTranslateSequence) items.push({ id: 'sel-translate', label: '翻译成蛋白质', onClick: () => onTranslateSequence() })
      if (onAddToComponentDb) items.push({ id: 'sel-component-db', label: '添加到元件数据库', onClick: () => onAddToComponentDb() })
      items.push({ id: 'sel-delete', label: '删除选区', danger: true, shortcut: 'Del', onClick: () => handleDelete() })
      items.push({ id: 'sep3', separator: true })
    }

    // 通用菜单
    items.push({ id: 'paste', label: '粘贴', shortcut: 'Ctrl+V', onClick: () => handlePaste() })
    items.push({ id: 'undo', label: '撤销', shortcut: 'Ctrl+Z', disabled: !undoStack.length, onClick: () => doUndo() })
    items.push({ id: 'redo', label: '重做', shortcut: 'Ctrl+Y', disabled: !redoStack.length, onClick: () => doRedo() })

    showContextMenu(e.clientX, e.clientY, items, { position: pos })
  }, [features, sequence, lineWidth, selStart, selEnd, undoStack, redoStack, showContextMenu, onSelectFeature, onDeleteFeature, onSelectionChange, onAlignSelection, onDesignPrimers, onBlastSearch, onTranslateSequence, onAddToComponentDb, posFromMouseEvent, copyStrand, openMarkDialog, handleDelete, handlePaste, doUndo, doRedo])

  // ============ 渲染 ============
  const lines: number[] = []
  for (let i = 0; i < sequence.length; i += lineWidth) lines.push(i)
  const seqRowWidth = lineWidth * STEP + GAP_W // 总宽度

  return (
    <div className="flex flex-col h-full outline-none" tabIndex={0}
      onKeyDown={handleKeyDown} onPaste={handlePasteEvent}>
      <style>{CURSOR_STYLE}</style>

      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-white border-b border-slate-200 flex-wrap" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center gap-1 border border-slate-200 rounded px-2 py-1">
          <Search size={12} className="text-slate-400" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="查找..."
            className="text-xs w-20 focus:outline-none" onMouseDown={e => e.stopPropagation()} onPaste={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} />
          {/* 搜索模式切换 */}
          <div className="flex items-center gap-0.5 ml-1 border-l border-slate-200 pl-1">
            <button onClick={() => setSearchMode('exact')}
              className={`px-1 py-0.5 text-[9px] rounded ${searchMode === 'exact' ? 'bg-blue-500 text-white' : 'text-slate-400 hover:bg-slate-100'}`}
              title="精确匹配">Ex</button>
            <button onClick={() => setSearchMode('iupac')}
              className={`px-1 py-0.5 text-[9px] rounded ${searchMode === 'iupac' ? 'bg-blue-500 text-white' : 'text-slate-400 hover:bg-slate-100'}`}
              title="IUPAC模糊匹配 (R/Y/S/W/K/M/B/D/H/V/N)">IU</button>
            <button onClick={() => setSearchMode('regex')}
              className={`px-1 py-0.5 text-[9px] rounded ${searchMode === 'regex' ? 'bg-blue-500 text-white' : 'text-slate-400 hover:bg-slate-100'}`}
              title="正则表达式">Re</button>
          </div>
          {searchResults.length > 0 && (<>
            <span className="text-[10px] text-slate-400">{searchIdx + 1}/{searchResults.length}{searchResults[searchIdx]?.strand === -1 ? '(RC)' : ''}</span>
            <button onClick={() => scrollSearch(-1)} className="p-0.5 hover:bg-slate-100 rounded"><ArrowUp size={12} /></button>
            <button onClick={() => scrollSearch(1)} className="p-0.5 hover:bg-slate-100 rounded"><ArrowDown size={12} /></button>
          </>)}
        </div>
        <div className="w-px h-5 bg-slate-200" />
        <button onClick={doUndo} disabled={!undoStack.length} className="p-1 text-slate-500 hover:text-slate-700 disabled:opacity-30" title="撤销"><Undo2 size={14} /></button>
        <button onClick={doRedo} disabled={!redoStack.length} className="p-1 text-slate-500 hover:text-slate-700 disabled:opacity-30" title="重做"><Redo2 size={14} /></button>
        <div className="w-px h-5 bg-slate-200" />
        <div className="relative">
          <button onClick={() => setShowCopyMenu(!showCopyMenu)} disabled={!hasSelection}
            className="px-2 py-1 text-xs text-slate-600 border rounded flex items-center gap-1 hover:bg-slate-50 disabled:opacity-30">
            <Copy size={12} /> 复制 <ChevronDown size={10} />
          </button>
          {showCopyMenu && (
            <div className="absolute top-full left-0 mt-1 bg-white border rounded shadow-lg z-[100] text-xs min-w-[150px]">
              <button onClick={() => copyStrand('top')} className="w-full text-left px-3 py-1.5 hover:bg-slate-50">复制上链 (5'→3')</button>
              <button onClick={() => copyStrand('bottom')} className="w-full text-left px-3 py-1.5 hover:bg-slate-50">复制下链 (3'→5')</button>
              <button onClick={() => copyStrand('both')} className="w-full text-left px-3 py-1.5 hover:bg-slate-50">复制双链</button>
            </div>
          )}
        </div>
        <button onClick={handlePaste} className="px-2 py-1 text-xs text-slate-600 border rounded flex items-center gap-1 hover:bg-slate-50"><Clipboard size={12} /> 粘贴</button>
        <button onClick={handleDelete} disabled={!hasSelection}
          className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded flex items-center gap-1 hover:bg-red-50 disabled:opacity-30"><X size={12} /> 删除</button>
        <button onClick={openMarkDialog} disabled={!hasSelection}
          className="px-2 py-1 text-xs text-emerald-600 border border-emerald-200 rounded flex items-center gap-1 hover:bg-emerald-50 disabled:opacity-30"><Bookmark size={12} /> 标记元件</button>
        {onAlignSelection && (
          <button onClick={onAlignSelection} disabled={!hasSelection}
            className="px-2 py-1 text-xs text-blue-600 border border-blue-200 rounded flex items-center gap-1 hover:bg-blue-50 disabled:opacity-30">
            <AlignLeft size={12} /> 序列比对
          </button>
        )}
        {onDesignPrimers && (
          <button onClick={onDesignPrimers} disabled={!hasSelection}
            className="px-2 py-1 text-xs text-violet-600 border border-violet-200 rounded flex items-center gap-1 hover:bg-violet-50 disabled:opacity-30">
            <FlaskConical size={12} /> 设计引物
          </button>
        )}
        <div className="w-px h-5 bg-slate-200" />
        <button onClick={() => setBaseColoring(!baseColoring)}
          className={`px-2 py-1 text-xs border rounded flex items-center gap-1 transition-colors ${baseColoring ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-slate-600 border-slate-200 hover:bg-slate-50'}`}
          title="碱基着色 (A=绿 T=红 G=黄 C=蓝)">
          <Palette size={12} /> 碱基着色
        </button>
        <button onClick={() => setCodonFrame(codonFrame === null ? 0 : codonFrame === 0 ? 1 : codonFrame === 1 ? 2 : null)}
          className={`px-2 py-1 text-xs border rounded flex items-center gap-1 transition-colors ${codonFrame !== null ? 'text-violet-700 bg-violet-50 border-violet-200' : 'text-slate-600 border-slate-200 hover:bg-slate-50'}`}
          title={`密码子阅读框 (当前: ${codonFrame === null ? '关闭' : `+${codonFrame}`})`}>
          <Dna size={12} /> 密码子{codonFrame !== null ? ` +${codonFrame}` : ''}
        </button>
        <div className="flex-1" />
        <span className="text-[10px] text-slate-400">每行 {lineWidth} bp | 共 {sequence.length.toLocaleString()} bp</span>
        {/* 选区坐标直接输入 */}
        <SelectionCoordInput
          seqLength={sequence.length}
          hasSelection={hasSelection}
          selLo={selLo}
          selHi={selHi}
          insertPos={insertPos}
          cursorMode={cursorMode}
          onSetSelection={(start, end) => {
            setCursorMode('select')
            setSelStart(start)
            setSelEnd(end)
          }}
        />
      </div>

      {/* 序列显示区 */}
      <div ref={seqRef} className="flex-1 overflow-auto p-3 bg-slate-50 select-none"
        onContextMenu={handleSeqContextMenu}
        onMouseLeave={() => onHoverPosition?.(null)}>
        {lines.length === 0 && (
          <div className="text-slate-400 text-center py-8 text-xs cursor-text"
            onClick={() => { setCursorMode('insert'); setInsertPos(0) }}>
            暂无序列数据（点击此处定位光标，输入碱基或粘贴）
          </div>
        )}
        {/* 虚拟滚动顶部占位 */}
        {topSpacerH > 0 && <div style={{ height: topSpacerH }} />}
        {lines.slice(visibleRange.start, visibleRange.end + 1).map((start, sliceIdx) => {
          const idx = visibleRange.start + sliceIdx
          const end = Math.min(start + lineWidth, sequence.length)
          const topBases = sequence.substring(start, end)
          const botBases = bottomStrand.substring(start, end)

          // 本行的酶切位点（预计算索引查找，避免 O(N) filter）
          const lineEnz = enzymeSitesByLine.get(idx)
          const fwdSites = lineEnz?.fwd || []
          const revSites = lineEnz?.rev || []
          const fwdLanes = enzymeLanesByLine.fwdMap.get(idx) || new Map()
          const revLanes = enzymeLanesByLine.revMap.get(idx) || new Map()
          const maxFwdLane = fwdLanes.size > 0 ? Math.max(0, ...fwdLanes.values()) : -1
          const maxRevLane = revLanes.size > 0 ? Math.max(0, ...revLanes.values()) : -1
          const fwdH = maxFwdLane >= 0 ? (maxFwdLane + 1) * ENZYME_LANE_H : 0
          const revH = maxRevLane >= 0 ? (maxRevLane + 1) * ENZYME_LANE_H : 0

          // 本行的引物位点（预计算分层查找）
          const linePrimer = primerSitesByLine.get(idx)
          const fwdPrimers = linePrimer?.fwd || []
          const revPrimers = linePrimer?.rev || []
          const fwdPrimerLanes = primerLanesByLineIdx.fwdMap.get(idx) || new Map()
          const revPrimerLanes = primerLanesByLineIdx.revMap.get(idx) || new Map()
          const maxFwdPrimerLane = fwdPrimerLanes.size > 0 ? Math.max(0, ...fwdPrimerLanes.values()) : -1
          const maxRevPrimerLane = revPrimerLanes.size > 0 ? Math.max(0, ...revPrimerLanes.values()) : -1
          const primerLaneH = 14 // 引物行高
          const fwdPrimerH = maxFwdPrimerLane >= 0 ? (maxFwdPrimerLane + 1) * primerLaneH : 0
          const revPrimerH = maxRevPrimerLane >= 0 ? (maxRevPrimerLane + 1) * primerLaneH : 0
          const primerColor = '#0891b2' // cyan-600

          return (
            <div key={idx} data-line={idx} className="mb-2">
              {/* 正义链酶切位点（在序列上方，划线贴近序列底边，文字在上方） */}
              {fwdSites.length > 0 && (
                <div className="flex items-start">
                  <span className="w-14 flex-shrink-0" />
                  <div className="relative" style={{ width: seqRowWidth, height: fwdH }}>
                    {fwdSites.map((es, si) => {
                      const left = (es.recog_start - start) * STEP + GAP_W
                      const w = (es.recog_end - es.recog_start + 1) * STEP - GAP_W
                      const color = enzymeColor(es.enzyme_name || '')
                      const recogLen = es.recog_end - es.recog_start + 1
                      const lane = fwdLanes.get(es.id) || 0
                      return (
                        <span key={`f${si}`} className="absolute flex flex-col justify-end" style={{ left, bottom: lane * ENZYME_LANE_H, width: Math.max(w, 4), height: ENZYME_LANE_H }}>
                          <span className="text-[8px] font-bold whitespace-nowrap block text-center leading-tight" style={{ color, marginBottom: ENZYME_GAP }}>
                            {es.enzyme_name}({recogLen}bp)
                          </span>
                          <span className="block h-[2px]" style={{ width: Math.max(w, 4), backgroundColor: color }} />
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 正向引物标注（箭头 + 名称） */}
              {fwdPrimers.length > 0 && (
                <div className="flex items-start">
                  <span className="w-14 flex-shrink-0" />
                  <div className="relative" style={{ width: seqRowWidth, height: fwdPrimerH }}>
                    {fwdPrimers.map((ps, pi) => {
                      // 绝对定位：line 精确覆盖 [recog_start, recog_end]，▶ 在 3' 端，name 紧随箭头右侧
                      const lineLeft = (ps.recog_start - start) * STEP + GAP_W
                      const lineWidth = (ps.recog_end - ps.recog_start + 1) * STEP - GAP_W
                      const lane = fwdPrimerLanes.get(pi) || 0
                      const arrowX = lineLeft + Math.max(lineWidth, 12)
                      return (
                        <span key={`fp${pi}`} className="absolute" style={{ left: 0, top: lane * primerLaneH, height: primerLaneH, width: seqRowWidth }}>
                          <span className="absolute flex items-center" style={{ left: lineLeft, top: 0, height: primerLaneH }}>
                            <span className="block h-[2px]" style={{ width: Math.max(lineWidth, 12), backgroundColor: primerColor }} />
                          </span>
                          <span className="absolute" style={{ left: arrowX, top: 0, height: primerLaneH, lineHeight: `${primerLaneH}px`, color: primerColor, fontSize: '10px' }}>▶</span>
                          <span className="absolute whitespace-nowrap" style={{ left: arrowX + 10, top: 0, height: primerLaneH, lineHeight: `${primerLaneH}px`, color: primerColor, fontSize: '8px', fontWeight: 600 }}>
                            {ps.primer_name}
                          </span>
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 上链行 */}
              <div className="flex items-start">
                <span className="w-14 text-right pr-2 text-[10px] text-slate-400 flex-shrink-0 leading-[22px]">{start + 1}</span>
                <div className="flex items-center font-mono text-[12px] leading-[22px]" style={{ position: 'relative' }}
                  onMouseMove={(e) => handleRowMouseMove(e, start, end)}
                  onClick={(e) => {
                    // 兜底：点击碱基容器空白区域时定位到行首或行尾
                    const rect = e.currentTarget.getBoundingClientRect()
                    const x = e.clientX - rect.left
                    if (x < 0) { onGapClick(start) }
                    else if (x > rect.width) { onGapClick(end) }
                  }}>
                  {topBases.split('').map((b, ci) => {
                    const gp = start + ci
                    const isCS = curSearch.has(gp), isSHL = searchHL.has(gp)
                    const isRC = searchRCHL.has(gp), isCurRC = curSearchRC
                    const isSel = hasSelection && gp >= selLo && gp <= selHi
                    const isHov = hovSet.has(gp)
                    const isFeat = featSet.has(gp)
                    let bgCls = ''
                    let borderStyle: React.CSSProperties = {}
                    // 元件下划线颜色始终显示，不受选择/悬停影响（预计算查找，避免 O(M) filter）
                    const coverInfo = coverMap.get(gp)
                    if (coverInfo) {
                      borderStyle = { borderBottom: `2px solid ${coverInfo.color}` }
                    }
                    const coverLabel = coverInfo ? coverInfo.label : ''
                    // 背景色优先级：搜索(当前橙色/其他黄色，RC匹配用青色) > 选区 > 悬停
                    if (isCS) bgCls = isCurRC ? 'bg-cyan-500 text-white' : 'bg-orange-400 text-white'
                    else if (isSHL) bgCls = isRC ? 'bg-cyan-200' : 'bg-yellow-200'
                    else if (isSel) bgCls = 'bg-red-200/60'
                    else if (isHov) bgCls = 'bg-slate-200'
                    // 插入光标
                    const showCursor = cursorMode === 'insert' && insertPos === gp
                    const showEndCursor = cursorMode === 'insert' && insertPos === gp + 1 && gp === end - 1 && end === sequence.length
                    // 每行末尾都显示间隙点击区（含最后一行末尾）
                    const isLineEnd = ci === topBases.length - 1

                    return (
                      <span key={ci} className="flex items-stretch flex-shrink-0">
                        {showCursor && <span className="seq-cursor-line bg-violet-500 self-stretch flex-shrink-0" style={{ width: GAP_W }}
                          onMouseDown={(e) => { e.stopPropagation(); onBaseMouseDown(gp, e) }} />}
                        {/* 间隙点击区 */}
                        {ci > 0 && (
                          <span onClick={(e) => { e.stopPropagation(); onGapClick(gp) }}
                            onMouseDown={(e) => onGapMouseDown(gp, e)}
                            className="hover:bg-violet-200/60 cursor-text flex-shrink-0 self-stretch transition-colors"
                            style={{ width: GAP_W }} />
                        )}
                        {/* 碱基 */}
                        <span onMouseDown={(e) => { e.stopPropagation(); onBaseMouseDown(gp, e) }}
                          className={`cursor-default flex-shrink-0 ${bgCls}`}
                          style={{
                            width: BASE_W, textAlign: 'center',
                            ...(baseColoring && !bgCls ? { color: BASE_COLORS[b.toLowerCase()] } : {}),
                            ...(codonFrame !== null && !bgCls ? { backgroundColor: CODON_BG[(gp - codonFrame + sequence.length * 3) % 3] } : {}),
                            ...borderStyle
                          }}
                          title={`${gp + 1}: ${b.toUpperCase()}${codonFrame !== null ? ` (codon ${(gp - codonFrame >= 0 ? gp - codonFrame : gp - codonFrame + sequence.length) % 3 + 1}/3)` : ''}${coverLabel}`}>{b}</span>
                        {showEndCursor && <span className="seq-cursor-line bg-violet-500 self-stretch flex-shrink-0" style={{ width: GAP_W }}
                          onMouseDown={(e) => { e.stopPropagation(); onBaseMouseDown(gp, e) }} />}
                        {isLineEnd && (
                          <span onClick={(e) => { e.stopPropagation(); onGapClick(end) }}
                            onMouseDown={(e) => onGapMouseDown(end - 1, e)}
                            className="hover:bg-violet-200/60 cursor-text flex-shrink-0 self-stretch transition-colors"
                            style={{ width: GAP_W + 3 }} />
                        )}
                      </span>
                    )
                  })}
                </div>
                <span className="ml-2 text-[10px] text-slate-300 flex-shrink-0 leading-[22px]">{end}</span>
              </div>

              {/* 下链行 */}
              <div className="flex items-start">
                <span className="w-14 text-right pr-2 text-[10px] text-slate-300 flex-shrink-0 leading-[20px]">{start + 1}</span>
                <div className="flex items-center font-mono text-[12px] leading-[20px]">
                  {botBases.split('').map((b, ci) => {
                    const gp = start + ci
                    return (
                      <span key={ci} className="flex items-stretch flex-shrink-0">
                        {ci > 0 && <span className="flex-shrink-0 self-stretch" style={{ width: GAP_W }} />}
                        <span className="flex-shrink-0" style={{
                          width: BASE_W, textAlign: 'center',
                          color: baseColoring ? (BASE_COLORS[b.toLowerCase()] || '#94a3b8') : '#94a3b8',
                          ...(codonFrame !== null ? { backgroundColor: CODON_BG[(gp - codonFrame + sequence.length * 3) % 3] } : {})
                        }}>{b}</span>
                      </span>
                    )
                  })}
                </div>
                <span className="ml-2 text-[10px] text-slate-300 flex-shrink-0 leading-[20px]">{end}</span>
              </div>

              {/* 反义链酶切位点（在序列下方，划线贴近序列顶边，文字在下方） */}
              {revSites.length > 0 && (
                <div className="flex items-start">
                  <span className="w-14 flex-shrink-0" />
                  <div className="relative" style={{ width: seqRowWidth, height: revH }}>
                    {revSites.map((es, si) => {
                      const left = (es.recog_start - start) * STEP + GAP_W
                      const w = (es.recog_end - es.recog_start + 1) * STEP - GAP_W
                      const color = enzymeColor(es.enzyme_name || '')
                      const recogLen = es.recog_end - es.recog_start + 1
                      const lane = revLanes.get(es.id) || 0
                      return (
                        <span key={`r${si}`} className="absolute flex flex-col" style={{ left, top: lane * ENZYME_LANE_H, width: Math.max(w, 4), height: ENZYME_LANE_H }}>
                          <span className="block h-[2px]" style={{ width: Math.max(w, 4), backgroundColor: color }} />
                          <span className="text-[8px] font-bold whitespace-nowrap block text-center leading-tight" style={{ color, marginTop: ENZYME_GAP }}>
                            {es.enzyme_name}({recogLen}bp)
                          </span>
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 反向引物标注（name + ◀ + 划线 + ▶） */}
              {revPrimers.length > 0 && (
                <div className="flex items-start">
                  <span className="w-14 flex-shrink-0" />
                  <div className="relative" style={{ width: seqRowWidth, height: revPrimerH }}>
                    {revPrimers.map((ps, pi) => {
                      // 绝对定位：line 精确覆盖 [recog_start, recog_end]
                      // ◀ 在 5' 端（line 左端点），name 在 ◀ 左侧（可向左延伸超出结合区）
                      // ▶ 在 3' 端（line 右端点），name 在 ▶ 右侧（可向右延伸超出结合区）
                      const lineLeft = (ps.recog_start - start) * STEP + GAP_W
                      const lineWidth = (ps.recog_end - ps.recog_start + 1) * STEP - GAP_W
                      const lane = revPrimerLanes.get(pi) || 0
                      const nameWidth = ps.primer_name.length * 5.5 + 2
                      return (
                        <span key={`rp${pi}`} className="absolute" style={{ left: 0, top: lane * primerLaneH, height: primerLaneH, width: seqRowWidth }}>
                          {/* line: 精确覆盖结合区 */}
                          <span className="absolute flex items-center" style={{ left: lineLeft, top: 0, height: primerLaneH }}>
                            <span className="block h-[2px]" style={{ width: Math.max(lineWidth, 12), backgroundColor: primerColor }} />
                          </span>
                          {/* 5' 端标注: [name][◀] 紧贴在 line 左端点，name 允许向左延伸 */}
                          <span className="absolute whitespace-nowrap" style={{ left: lineLeft - nameWidth - 2, top: 0, height: primerLaneH, lineHeight: `${primerLaneH}px`, color: primerColor, fontSize: '8px', fontWeight: 600 }}>
                            {ps.primer_name}
                          </span>
                          <span className="absolute" style={{ left: lineLeft, top: 0, height: primerLaneH, lineHeight: `${primerLaneH}px`, color: primerColor, fontSize: '10px' }}>◀</span>
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {/* 虚拟滚动底部占位 */}
        {bottomSpacerH > 0 && <div style={{ height: bottomSpacerH }} />}

        {sequence.length === 0 && (
          <div className="flex items-center gap-1 font-mono text-sm text-slate-400 pl-16">
            <span className="seq-cursor-line bg-violet-500" style={{ width: GAP_W, height: 20 }} />
            <span>在此输入或粘贴序列</span>
          </div>
        )}
      </div>

      {/* ============ 弹窗 ============ */}
      {showInsertDialog && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[9999]" onClick={() => setShowInsertDialog(false)}>
          <div className="bg-white rounded-xl p-5 w-[480px] shadow-2xl" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            <h4 className="font-bold text-sm mb-1">插入序列</h4>
            <p className="text-xs text-slate-500 mb-3">
              在位置 <b>{pendingInsertPos}</b> {hasSelection ? `处插入（将替换选中的 ${selHi - selLo + 1} bp）` : '处插入'}
            </p>
            <div className="mb-3">
              <label className="text-xs text-slate-600 mb-1 block">输入序列（仅 ATCGN）</label>
              <textarea value={pendingInsert} onChange={e => {
                const val = e.target.value.toLowerCase().replace(/[^atcgn]/g, '')
                setPendingInsert(val)
                setFeatureForm(f => ({ ...f, end: pendingInsertPos + val.length }))
              }} className="w-full h-24 px-3 py-2 border rounded font-mono text-xs resize-none focus:outline-none focus:ring-1 focus:ring-violet-300"
                placeholder="输入 ATCG 碱基序列..." autoFocus onMouseDown={e => e.stopPropagation()} onPaste={e => e.stopPropagation()} />
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-slate-400">{pendingInsert.length} bp</span>
                <button onClick={() => { try { navigator.clipboard.readText().then(t => {
                  const c = t.toLowerCase().replace(/[^atcgn]/g, ''); setPendingInsert(c)
                  setFeatureForm(f => ({ ...f, end: pendingInsertPos + c.length }))
                }).catch(() => {}) } catch {} }} className="text-[10px] text-violet-600 hover:underline">从剪贴板粘贴</button>
              </div>
            </div>
            <div className="border-t pt-3">
              <p className="text-xs font-medium text-slate-700 mb-2">可选：标记为元件</p>
              <div className="space-y-2 bg-slate-50 p-3 rounded">
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-[10px] text-slate-500">元件类型</label>
                    <select value={featureForm.type} onChange={e => setFeatureForm({...featureForm, type: e.target.value})}
                      className="w-full mt-0.5 px-2 py-1 border rounded text-xs">
                      {Object.keys(FEATURE_COLORS).map(t => <option key={t} value={t}>{featureTypeName(t)}</option>)}
                    </select></div>
                  <div><label className="text-[10px] text-slate-500">链方向</label>
                    <select value={featureForm.strand} onChange={e => setFeatureForm({...featureForm, strand: parseInt(e.target.value) as 1 | -1})}
                      className="w-full mt-0.5 px-2 py-1 border rounded text-xs">
                      <option value={1}>正向 (5'→3')</option>
                      <option value={-1}>反向 (3'→5')</option>
                    </select></div>
                </div>
                <div><label className="text-[10px] text-slate-500">标签</label>
                  <input value={featureForm.label} onChange={e => setFeatureForm({...featureForm, label: e.target.value})}
                    placeholder="可选" className="w-full mt-0.5 px-2 py-1 border rounded text-xs" onPaste={e => e.stopPropagation()} /></div>
              </div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setShowInsertDialog(false)} className="px-3 py-1.5 text-xs border rounded">取消</button>
              <button onClick={() => confirmInsert(false)} disabled={!pendingInsert}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40">仅插入</button>
              <button onClick={() => confirmInsert(true)} disabled={!pendingInsert}
                className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-500 disabled:opacity-40">插入并标记</button>
            </div>
          </div>
        </div>
      )}

      {showDeleteDialog && pendingDelete && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[9999]" onClick={() => setShowDeleteDialog(false)}>
          <div className="bg-white rounded-xl p-5 w-[440px] shadow-2xl" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            <h4 className="font-bold text-sm mb-3 text-red-600">确认删除序列</h4>
            <p className="text-xs text-slate-600 mb-2">
              将删除位置 <b>{pendingDelete.start + 1}..{pendingDelete.end + 1}</b>，共 <b>{pendingDelete.end - pendingDelete.start + 1}</b> bp
            </p>
            {affectedFeatures.length > 0 ? (
              <div className="mb-3">
                <p className="text-xs text-amber-600 font-medium mb-1">⚠ 以下 {affectedFeatures.length} 个元件将受影响：</p>
                <div className="bg-amber-50 rounded p-2 max-h-24 overflow-auto">
                  {affectedFeatures.map((af, i) => (
                    <div key={i} className="text-xs text-slate-700 flex items-center gap-2 py-0.5">
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: getColor(af.type) }} />
                      <span className="font-medium">{af.name}</span>
                      <span className="text-slate-400">{featureTypeName(af.type)} | {af.start}..{af.end}</span>
                    </div>
                  ))}
                </div>
                {/* 保留/删除元件选项 */}
                <div className="mt-3 space-y-1.5">
                  <label className="flex items-start gap-2 text-xs cursor-pointer">
                    <input type="radio" name="featureHandling" checked={keepAffectedFeatures}
                      onChange={() => setKeepAffectedFeatures(true)} className="mt-0.5" />
                    <div>
                      <span className="font-medium text-slate-700">保留受影响元件（自动调整位置和大小）</span>
                      <p className="text-[10px] text-slate-400">元件位置将随序列变化自动偏移，完全在删除区内的元件将被移除</p>
                    </div>
                  </label>
                  <label className="flex items-start gap-2 text-xs cursor-pointer">
                    <input type="radio" name="featureHandling" checked={!keepAffectedFeatures}
                      onChange={() => setKeepAffectedFeatures(false)} className="mt-0.5" />
                    <div>
                      <span className="font-medium text-red-600">同时删除所有受影响元件</span>
                      <p className="text-[10px] text-slate-400">删除区域覆盖到的元件将被完全移除，图谱同步更新</p>
                    </div>
                  </label>
                </div>
              </div>
            ) : (
              <p className="text-xs text-green-600 mb-3">该区域没有元件覆盖</p>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowDeleteDialog(false)} className="px-3 py-1.5 text-xs border rounded">取消</button>
              <button onClick={confirmDelete} className="px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-500">确认删除</button>
            </div>
          </div>
        </div>
      )}

      {showMarkDialog && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[9999]" onClick={() => setShowMarkDialog(false)}>
          <div className="bg-white rounded-xl p-5 w-[400px] shadow-2xl" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            <h4 className="font-bold text-sm mb-3">标记新元件</h4>
            <div className="space-y-2">
              <div><label className="text-xs text-slate-600">元件类型</label>
                <select value={featureForm.type} onChange={e => setFeatureForm({...featureForm, type: e.target.value})}
                  className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs">
                  {Object.keys(FEATURE_COLORS).map(t => <option key={t} value={t}>{featureTypeName(t)}</option>)}
                </select></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-slate-600">起始</label>
                  <input type="number" value={featureForm.start} onChange={e => setFeatureForm({...featureForm, start: parseInt(e.target.value) || 1})}
                    className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs" /></div>
                <div><label className="text-xs text-slate-600">终止</label>
                  <input type="number" value={featureForm.end} onChange={e => setFeatureForm({...featureForm, end: parseInt(e.target.value) || 1})}
                    className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs" /></div>
              </div>
              <div><label className="text-xs text-slate-600">链方向</label>
                <select value={featureForm.strand} onChange={e => setFeatureForm({...featureForm, strand: parseInt(e.target.value) as 1 | -1})}
                  className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs">
                  <option value={1}>正向 (上链 5'→3')</option>
                  <option value={-1}>反向 (下链 3'→5')</option>
                </select></div>
              <div><label className="text-xs text-slate-600">标签</label>
                <input value={featureForm.label} onChange={e => setFeatureForm({...featureForm, label: e.target.value})}
                  className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs" onPaste={e => e.stopPropagation()} /></div>
              <div><label className="text-xs text-slate-600">基因名</label>
                <input value={featureForm.gene} onChange={e => setFeatureForm({...featureForm, gene: e.target.value})}
                  className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs" onPaste={e => e.stopPropagation()} /></div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setShowMarkDialog(false)} className="px-3 py-1.5 text-xs border rounded">取消</button>
              <button onClick={confirmMark} className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-500">确认添加</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(SequenceEditor)
