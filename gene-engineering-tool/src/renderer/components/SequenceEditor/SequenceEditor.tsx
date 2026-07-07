import { useState, useRef, useMemo, useCallback, useEffect, useLayoutEffect } from 'react'
import { Search, Copy, Clipboard, Bookmark, ArrowUp, ArrowDown, Undo2, Redo2, ChevronDown, X } from 'lucide-react'
import type { GenBankFeature } from '../../shared/types'

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
}

const FEATURE_COLORS: Record<string, string> = {
  gene: '#10b981', CDS: '#3b82f6', mRNA: '#06b6d4', promoter: '#f59e0b',
  terminator: '#ef4444', rep_origin: '#8b5cf6', misc_feature: '#94a3b8',
  primer_bind: '#ec4899', protein_bind: '#6366f1', regulatory: '#f97316',
  enhancer: '#fbbf24', exon: '#14b8a6'
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

const COMP: Record<string, string> = { a:'t',t:'a',c:'g',g:'c',r:'y',y:'r',s:'s',w:'w',k:'m',m:'k',b:'v',v:'b',d:'h',h:'d',n:'n' }
function comp(b: string): string { return COMP[b] || b }
function revComp(seq: string): string { return seq.split('').map(c => comp(c.toLowerCase())).reverse().join('') }

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

export default function SequenceEditor({
  sequence, features, enzymeSites, primerSites = [], onSequenceChange, onAddFeature,
  selectedFeature, onSelectFeature, hoveredFeature, mapSelection, onClearMapSelection,
  onSelectionChange, onHoverPosition
}: Props) {
  const seqRef = useRef<HTMLDivElement>(null)
  const [lineWidth, setLineWidth] = useState(60)

  // 光标状态
  const [cursorMode, setCursorMode] = useState<'select' | 'insert'>('insert')
  const [selStart, setSelStart] = useState(0)
  const [selEnd, setSelEnd] = useState(0)
  const [insertPos, setInsertPos] = useState(0)
  const dragStartRef = useRef<number | null>(null)
  const isDraggingRef = useRef(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{pos: number, strand: 1|-1}[]>([])
  const [searchIdx, setSearchIdx] = useState(0)
  const [undoStack, setUndoStack] = useState<string[]>([])
  const [redoStack, setRedoStack] = useState<string[]>([])
  const [showCopyMenu, setShowCopyMenu] = useState(false)

  const [showMarkDialog, setShowMarkDialog] = useState(false)
  const [showInsertDialog, setShowInsertDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [pendingInsert, setPendingInsert] = useState('')
  const [pendingInsertPos, setPendingInsertPos] = useState(0)
  const [pendingDelete, setPendingDelete] = useState<{ start: number; end: number } | null>(null)
  const [keepAffectedFeatures, setKeepAffectedFeatures] = useState(true) // 删除时是否保留受影响元件
  const [featureForm, setFeatureForm] = useState({ type: 'misc_feature', start: 1, end: 1, strand: 1 as 1 | -1, label: '', gene: '' })

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
      seqRef.current?.querySelector(`[data-line="${ln}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [mapSelection, lineWidth])

  // ============ 序列选择 → 图谱联动 ============
  useEffect(() => {
    if (!onSelectionChange) return
    if (cursorMode === 'select' && hasSelection) {
      onSelectionChange({ start: selLo, end: selHi }, null)
    } else if (cursorMode === 'insert') {
      onSelectionChange(null, insertPos)
    }
  }, [cursorMode, selLo, selHi, insertPos, hasSelection, onSelectionChange])

  // ============ 搜索（双向：正向 + 反向互补） ============
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) { setSearchResults([]); setSearchIdx(0); return }
    const r: {pos: number, strand: 1|-1}[] = []
    const seq = sequence.toLowerCase(); const q = searchQuery.toLowerCase()
    // 正向搜索
    let i = seq.indexOf(q); while (i !== -1) { r.push({pos: i, strand: 1}); i = seq.indexOf(q, i + 1) }
    // 反向互补搜索
    const rc = revComp(q)
    if (rc !== q) { // 避免回文序列重复
      let j = seq.indexOf(rc); while (j !== -1) { r.push({pos: j, strand: -1}); j = seq.indexOf(rc, j + 1) }
    }
    // 按位置排序
    r.sort((a, b) => a.pos - b.pos)
    setSearchResults(r); setSearchIdx(0)
  }, [searchQuery, sequence])

  const scrollSearch = useCallback((d: number) => {
    if (!searchResults.length) return
    const ni = (searchIdx + d + searchResults.length) % searchResults.length
    setSearchIdx(ni)
    const ln = Math.floor(searchResults[ni].pos / lineWidth)
    seqRef.current?.querySelector(`[data-line="${ln}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [searchResults, searchIdx, lineWidth])

  // ============ 计算 ============
  const bottomStrand = useMemo(() => sequence.split('').map(c => comp(c.toLowerCase())).join(''), [sequence])

  const searchHL = useMemo(() => { const s = new Set<number>(); searchResults.forEach(r => { for (let i = r.pos; i < r.pos + searchQuery.length; i++) s.add(i) }); return s }, [searchResults, searchQuery])
  const searchRCHL = useMemo(() => { const s = new Set<number>(); searchResults.filter(r => r.strand === -1).forEach(r => { for (let i = r.pos; i < r.pos + searchQuery.length; i++) s.add(i) }); return s }, [searchResults, searchQuery])
  const curSearch = useMemo(() => { const s = new Set<number>(); if (searchResults.length) { const r = searchResults[searchIdx]; for (let i = r.pos; i < r.pos + searchQuery.length; i++) s.add(i) }; return s }, [searchResults, searchIdx, searchQuery])
  const curSearchRC = useMemo(() => { if (searchResults.length && searchResults[searchIdx]?.strand === -1) return true; return false }, [searchResults, searchIdx])
  const hovSet = useMemo(() => { if (hoveredFeature === null || !features[hoveredFeature]) return new Set<number>(); const f = features[hoveredFeature]; const s = new Set<number>(); for (let i = f.start; i <= f.end; i++) s.add(i); return s }, [hoveredFeature, features])
  const featSet = useMemo(() => { if (selectedFeature === null || !features[selectedFeature]) return new Set<number>(); const f = features[selectedFeature]; const s = new Set<number>(); for (let i = f.start; i <= f.end; i++) s.add(i); return s }, [selectedFeature, features])

  // ============ Undo/Redo ============
  const pushUndo = () => { setUndoStack(p => [...p.slice(-20), sequence]); setRedoStack([]) }
  const doUndo = () => { if (!undoStack.length) return; const p = undoStack[undoStack.length - 1]; setRedoStack(r => [...r, sequence]); setUndoStack(u => u.slice(0, -1)); onSequenceChange(p) }
  const doRedo = () => { if (!redoStack.length) return; const n = redoStack[redoStack.length - 1]; setUndoStack(u => [...u, sequence]); setRedoStack(r => r.slice(0, -1)); onSequenceChange(n) }

  // ============ 复制 ============
  const copyStrand = useCallback((strand: 'top' | 'bottom' | 'both') => {
    if (!hasSelection) return
    const top = sequence.substring(selLo, selHi + 1)
    const bot = top.split('').map(c => comp(c.toLowerCase())).reverse().join('')
    let text = ''
    if (strand === 'top') text = top
    else if (strand === 'bottom') text = bot
    else text = `5' ${top} 3'\n3' ${bot} 5'`
    navigator.clipboard.writeText(text)
    setShowCopyMenu(false)
  }, [hasSelection, selLo, selHi, sequence])

  // ============ 粘贴 → 弹窗 ============
  const handlePaste = useCallback(async () => {
    const clip = await navigator.clipboard.readText()
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
  }, [pendingInsert, pendingInsertPos, hasSelection, selLo, selHi, sequence, onSequenceChange, onAddFeature, featureForm])

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
  }, [pendingDelete, sequence, onSequenceChange, keepAffectedFeatures])

  // ============ 标记元件 ============
  const openMarkDialog = () => {
    if (!hasSelection) return
    setFeatureForm(f => ({ ...f, start: selLo + 1, end: selHi + 1 }))
    setShowMarkDialog(true)
  }
  const confirmMark = () => {
    if (featureForm.start < 1 || featureForm.end > sequence.length || featureForm.start > featureForm.end) return
    const q: Record<string, string> = {}
    if (featureForm.label) q.label = featureForm.label
    if (featureForm.gene) q.gene = featureForm.gene
    onAddFeature({ type: featureForm.type, location: `${featureForm.start}..${featureForm.end}`,
      start: featureForm.start - 1, end: featureForm.end - 1, strand: featureForm.strand, qualifiers: q })
    setShowMarkDialog(false)
  }

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
  const onBaseMouseDown = (baseIdx: number, e: React.MouseEvent) => {
    e.preventDefault()
    onClearMapSelection()
    if (e.shiftKey) {
      setCursorMode('select')
      setSelEnd(baseIdx)
    } else {
      dragStartRef.current = baseIdx
      isDraggingRef.current = true
      setCursorMode('select')
      setSelStart(baseIdx)
      setSelEnd(baseIdx)
    }
    const fi = features.findIndex(f => baseIdx >= f.start && baseIdx <= f.end)
    onSelectFeature(fi >= 0 ? fi : null)
  }
  const onBaseMouseOver = (baseIdx: number) => {
    if (isDraggingRef.current && dragStartRef.current !== null) {
      setSelEnd(baseIdx)
    } else {
      onHoverPosition?.(baseIdx)
    }
  }
  // 根据鼠标坐标计算碱基位置（用于平滑拖选和 hover）
  const posFromMouseEvent = useCallback((e: React.MouseEvent, lineStart: number, lineEnd: number) => {
    const target = e.currentTarget as HTMLElement
    const rect = target.getBoundingClientRect()
    const x = e.clientX - rect.left
    const idx = Math.floor(x / STEP)
    return Math.max(lineStart, Math.min(lineEnd - 1, lineStart + idx))
  }, [])
  const onGapClick = (pos: number) => {
    onClearMapSelection()
    setCursorMode('insert')
    setInsertPos(pos)
  }
  useEffect(() => {
    const onUp = () => {
      isDraggingRef.current = false
      dragStartRef.current = null
    }
    document.addEventListener('mouseup', onUp)
    return () => document.removeEventListener('mouseup', onUp)
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
            className="text-xs w-20 focus:outline-none" onMouseDown={e => e.stopPropagation()} />
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
        <div className="flex-1" />
        <span className="text-[10px] text-slate-400">每行 {lineWidth} bp | 共 {sequence.length.toLocaleString()} bp</span>
        {hasSelection && <span className="text-[10px] text-blue-500">选中: {selLo + 1}..{selHi + 1} ({selHi - selLo + 1} bp)</span>}
        {cursorMode === 'insert' && !hasSelection && <span className="text-[10px] text-slate-400">光标: {insertPos}</span>}
      </div>

      {/* 序列显示区 */}
      <div ref={seqRef} className="flex-1 overflow-auto p-3 bg-slate-50 select-none"
        onMouseLeave={() => onHoverPosition?.(null)}>
        {lines.length === 0 && (
          <div className="text-slate-400 text-center py-8 text-xs cursor-text"
            onClick={() => { setCursorMode('insert'); setInsertPos(0) }}>
            暂无序列数据（点击此处定位光标，输入碱基或粘贴）
          </div>
        )}
        {lines.map((start, idx) => {
          const end = Math.min(start + lineWidth, sequence.length)
          const topBases = sequence.substring(start, end)
          const botBases = bottomStrand.substring(start, end)

          // 本行的酶切位点（正链和反链）
          const fwdSites = enzymeSites.filter(es => es.strand === 1 && es.recog_start >= start && es.recog_end < end)
          const revSites = enzymeSites.filter(es => es.strand === -1 && es.recog_start >= start && es.recog_end < end)
          const fwdLanes = fwdSites.length > 0 ? computeLanes(fwdSites) : new Map()
          const revLanes = revSites.length > 0 ? computeLanes(revSites) : new Map()
          const maxFwdLane = fwdLanes.size > 0 ? Math.max(0, ...Array.from(fwdLanes.values())) : -1
          const maxRevLane = revLanes.size > 0 ? Math.max(0, ...Array.from(revLanes.values())) : -1
          const fwdH = maxFwdLane >= 0 ? (maxFwdLane + 1) * ENZYME_LANE_H : 0
          const revH = maxRevLane >= 0 ? (maxRevLane + 1) * ENZYME_LANE_H : 0

          // 本行的引物位点
          const fwdPrimers = primerSites.filter(ps => ps.strand === 1 && ps.recog_start >= start && ps.recog_end < end)
          const revPrimers = primerSites.filter(ps => ps.strand === -1 && ps.recog_start >= start && ps.recog_end < end)
          const fwdPrimerLanes = fwdPrimers.length > 0 ? computePrimerLanes(fwdPrimers) : new Map()
          const revPrimerLanes = revPrimers.length > 0 ? computePrimerLanes(revPrimers) : new Map()
          const maxFwdPrimerLane = fwdPrimerLanes.size > 0 ? Math.max(0, ...Array.from(fwdPrimerLanes.values())) : -1
          const maxRevPrimerLane = revPrimerLanes.size > 0 ? Math.max(0, ...Array.from(revPrimerLanes.values())) : -1
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
                      const left = (ps.recog_start - start) * STEP + GAP_W
                      const w = (ps.recog_end - ps.recog_start + 1) * STEP - GAP_W
                      const lane = fwdPrimerLanes.get(pi) || 0
                      return (
                        <span key={`fp${pi}`} className="absolute flex items-center" style={{ left, top: lane * primerLaneH, height: primerLaneH }}>
                          <span className="block h-[2px]" style={{ width: Math.max(w, 12), backgroundColor: primerColor }} />
                          <span style={{ color: primerColor, fontSize: '10px', lineHeight: '1' }}>▶</span>
                          <span className="text-[8px] font-semibold whitespace-nowrap ml-0.5" style={{ color: primerColor }}>
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
                  onMouseMove={(e) => {
                    const pos = posFromMouseEvent(e, start, end)
                    if (isDraggingRef.current && dragStartRef.current !== null) {
                      setSelEnd(pos)
                    } else {
                      onHoverPosition?.(pos)
                    }
                  }}
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
                    // 元件下划线颜色始终显示，不受选择/悬停影响
                    const cover = features.filter(f => gp >= f.start && gp <= f.end)
                    if (cover.length) {
                      const featColor = getColor(cover[cover.length - 1].type)
                      borderStyle = { borderBottom: `2px solid ${featColor}` }
                    }
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
                            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
                            className="hover:bg-violet-200/60 cursor-text flex-shrink-0 self-stretch transition-colors"
                            style={{ width: GAP_W }} />
                        )}
                        {/* 碱基 */}
                        <span onMouseDown={(e) => { e.stopPropagation(); onBaseMouseDown(gp, e) }}
                          className={`cursor-default flex-shrink-0 ${bgCls}`}
                          style={{ width: BASE_W, textAlign: 'center', ...borderStyle }}
                          title={`${gp + 1}: ${b.toUpperCase()}`}>{b}</span>
                        {showEndCursor && <span className="seq-cursor-line bg-violet-500 self-stretch flex-shrink-0" style={{ width: GAP_W }}
                          onMouseDown={(e) => { e.stopPropagation(); onBaseMouseDown(gp, e) }} />}
                        {isLineEnd && (
                          <span onClick={(e) => { e.stopPropagation(); onGapClick(end) }}
                            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
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
                <span className="w-14 text-right pr-2 text-[10px] text-slate-300 flex-shrink-0 leading-[20px]">{sequence.length - start}</span>
                <div className="flex items-center font-mono text-[12px] leading-[20px]">
                  {botBases.split('').map((b, ci) => (
                    <span key={ci} className="flex items-stretch flex-shrink-0">
                      {ci > 0 && <span className="flex-shrink-0 self-stretch" style={{ width: GAP_W }} />}
                      <span className="flex-shrink-0 text-slate-400" style={{ width: BASE_W, textAlign: 'center' }}>{b}</span>
                    </span>
                  ))}
                </div>
                <span className="ml-2 text-[10px] text-slate-300 flex-shrink-0 leading-[20px]">{sequence.length - end + 1}</span>
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

              {/* 反向引物标注（◀ + 划线 + 名称） */}
              {revPrimers.length > 0 && (
                <div className="flex items-start">
                  <span className="w-14 flex-shrink-0" />
                  <div className="relative" style={{ width: seqRowWidth, height: revPrimerH }}>
                    {revPrimers.map((ps, pi) => {
                      const left = (ps.recog_start - start) * STEP + GAP_W
                      const w = (ps.recog_end - ps.recog_start + 1) * STEP - GAP_W
                      const arrowOffset = Math.max(w, 12)
                      const lane = revPrimerLanes.get(pi) || 0
                      return (
                        <span key={`rp${pi}`} className="absolute flex items-center" style={{ left, top: lane * primerLaneH, height: primerLaneH }}>
                          <span className="text-[8px] font-semibold whitespace-nowrap mr-0.5" style={{ color: primerColor }}>
                            {ps.primer_name}
                          </span>
                          <span style={{ color: primerColor, fontSize: '10px', lineHeight: '1' }}>◀</span>
                          <span className="block h-[2px]" style={{ width: arrowOffset, backgroundColor: primerColor }} />
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })}

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
                placeholder="输入 ATCG 碱基序列..." autoFocus onMouseDown={e => e.stopPropagation()} />
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-slate-400">{pendingInsert.length} bp</span>
                <button onClick={() => { navigator.clipboard.readText().then(t => {
                  const c = t.toLowerCase().replace(/[^atcgn]/g, ''); setPendingInsert(c)
                  setFeatureForm(f => ({ ...f, end: pendingInsertPos + c.length }))
                }) }} className="text-[10px] text-violet-600 hover:underline">从剪贴板粘贴</button>
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
                    placeholder="可选" className="w-full mt-0.5 px-2 py-1 border rounded text-xs" /></div>
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
                  className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs" /></div>
              <div><label className="text-xs text-slate-600">基因名</label>
                <input value={featureForm.gene} onChange={e => setFeatureForm({...featureForm, gene: e.target.value})}
                  className="w-full mt-0.5 px-2 py-1.5 border rounded text-xs" /></div>
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
