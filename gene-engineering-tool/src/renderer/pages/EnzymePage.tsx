import { useState, useMemo, useEffect, useCallback } from 'react'
import { Search, Plus, Trash2, Edit2, X, Thermometer, RefreshCw, Dna, Shield, Clock, Zap, AlertTriangle, ArrowLeftRight, Scissors, Check, XCircle, Globe, ExternalLink, FlaskConical, Database, Calendar, Beaker } from 'lucide-react'
import type { RestrictionEnzyme } from '../../shared/types'
import { useLifecycleLog, useModuleLogger } from '../hooks/useDebugLog'

// 互补碱基映射
const complementMap: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G', R: 'Y', Y: 'R', M: 'K', K: 'M', S: 'S', W: 'W', B: 'V', V: 'B', D: 'H', H: 'D', N: 'N' }
function getComplement(seq: string): string {
  return seq.split('').map(c => complementMap[c.toUpperCase()] ?? c).reverse().join('')
}

function overhangLabel(type?: string): string {
  if (type === '5prime') return "5' 粘性"
  if (type === '3prime') return "3' 粘性"
  if (type === 'blunt') return '平端'
  return '—'
}

// Subtype badge config
function subtypeBadge(subtype?: string | null): { label: string; color: string; title: string } | null {
  if (subtype === 'P') return { label: 'P', color: 'bg-emerald-100 text-emerald-700', title: '回文型 (Palindromic)' }
  if (subtype === 'S') return { label: 'S', color: 'bg-orange-100 text-orange-700', title: '移位型 (Shifted)' }
  if (subtype === 'A') return { label: 'A', color: 'bg-red-100 text-red-700', title: '异常型 (Aberrant)' }
  return null
}

// Organism type icon label
function orgTypeLabel(type?: string | null): string {
  if (!type) return ''
  const map: Record<string, string> = { bacteria: '🦠 细菌', archaea: '🧬 古菌', virus: '🦠 病毒', plasmid: '💊 质粒', unclassified: '❓ 未分类' }
  return map[type] || type
}

type FilterKey = 'hf' | 'timeSaver' | '6bp' | 'sticky' | 'blunt' | 'methyl' | 'buffer' | 'ambiguous' | 'isoschizomers' | 'subP' | 'subS' | 'subA' | 'orgBacteria' | 'orgArchaea' | 'orgVirus'

// localStorage 键名与默认实验室常用酶列表
const LAB_COMMON_STORAGE_KEY = 'lab_common_enzymes'
const DEFAULT_LAB_COMMON: string[] = [
  'ApaI', 'BamHI', 'BbsI', 'BsaI', 'ClaI', 'DpnI', 'EcoRI', 'HindIII', 'KpnI', 'NcoI',
  'NdeI', 'NheI', 'NotI', 'PacI', 'PstI', 'SacI', 'SalI', 'SmaI', 'SpeI', 'SphI', 'XbaI', 'XhoI'
]
function loadLabCommonFromStorage(): string[] {
  try {
    const raw = localStorage.getItem(LAB_COMMON_STORAGE_KEY)
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr }
  } catch {}
  return DEFAULT_LAB_COMMON
}

export default function EnzymePage() {
  useLifecycleLog('EnzymePage')
  const log = useModuleLogger('EnzymePage')

  const [enzymes, setEnzymes] = useState<RestrictionEnzyme[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEnzyme, setSelectedEnzyme] = useState<RestrictionEnzyme | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingEnzyme, setEditingEnzyme] = useState<RestrictionEnzyme | null>(null)
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(new Set())
  const [bufferFilter, setBufferFilter] = useState<string>('')
  const [gcMin, setGcMin] = useState<number>(0)
  const [gcMax, setGcMax] = useState<number>(100)
  const [gcActive, setGcActive] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateMsg, setUpdateMsg] = useState('')

  // === 实验室常用酶列表编辑对话框状态 ===
  const [showLabDialog, setShowLabDialog] = useState(false)
  const [labSearch, setLabSearch] = useState('')
  const [labOhFilter, setLabOhFilter] = useState<string>('')
  const [labSubFilter, setLabSubFilter] = useState<string>('')
  const [labSpecialFilter, setLabSpecialFilter] = useState<Set<string>>(new Set())
  const [labSelected, setLabSelected] = useState<Set<string>>(new Set())

  const openLabDialog = useCallback(() => {
    const saved = loadLabCommonFromStorage()
    setLabSelected(new Set(saved))
    setLabSearch('')
    setLabOhFilter('')
    setLabSubFilter('')
    setLabSpecialFilter(new Set())
    setShowLabDialog(true)
  }, [])

  const saveLabCommon = useCallback(() => {
    const arr = Array.from(labSelected).sort()
    localStorage.setItem(LAB_COMMON_STORAGE_KEY, JSON.stringify(arr))
    window.dispatchEvent(new CustomEvent('lab-common-enzymes-changed', { detail: arr }))
    setShowLabDialog(false)
    log.info(`Saved ${arr.length} lab common enzymes`)
  }, [labSelected, log])

  const labFilteredEnzymes = useMemo(() => {
    const q = labSearch.toLowerCase().trim()
    return enzymes.filter(e => {
      if (q && !e.name.toLowerCase().includes(q) && !e.recognition_sequence.toLowerCase().includes(q)) return false
      if (labOhFilter && e.overhang_type !== labOhFilter) return false
      if (labSubFilter && e.subtype !== labSubFilter) return false
      if (labSpecialFilter.has('hf') && !e.is_high_fidelity) return false
      if (labSpecialFilter.has('ts') && !e.is_time_saver) return false
      if (labSpecialFilter.has('methyl') && !e.methylation_sensitive) return false
      return true
    })
  }, [enzymes, labSearch, labOhFilter, labSubFilter, labSpecialFilter])

  const toggleLabEnzyme = useCallback((name: string) => {
    setLabSelected(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }, [])

  const selectAllLabFiltered = useCallback(() => {
    setLabSelected(prev => {
      const next = new Set(prev)
      labFilteredEnzymes.forEach(e => next.add(e.name))
      return next
    })
  }, [labFilteredEnzymes])

  const clearLabSelected = useCallback(() => setLabSelected(new Set()), [])
  const [formData, setFormData] = useState({
    name: '', source_organism: '', recognition_sequence: '', cut_position: 0, optimal_temp: 37, is_palindromic: true
  })

  useEffect(() => { loadEnzymes() }, [])

  const loadEnzymes = async () => {
    log.info('Loading enzymes...')
    try {
      const data = await window.api.getEnzymes()
      log.info(`Loaded ${data.length} enzymes`)
      setEnzymes(data)
    } catch (err) {
      log.error('Failed to load enzymes', err)
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) { loadEnzymes(); return }
    const data = await window.api.searchEnzymes(searchQuery)
    setEnzymes(data)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此酶？')) return
    log.info(`Deleting enzyme id=${id}`)
    await window.api.deleteEnzyme(id)
    loadEnzymes()
    if (selectedEnzyme?.id === id) setSelectedEnzyme(null)
  }

  const handleEdit = (enzyme: RestrictionEnzyme) => {
    setEditingEnzyme(enzyme)
    setFormData({
      name: enzyme.name, source_organism: enzyme.source_organism,
      recognition_sequence: enzyme.recognition_sequence, cut_position: enzyme.cut_position,
      optimal_temp: enzyme.optimal_temp, is_palindromic: enzyme.is_palindromic
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

  const handleUpdateLibrary = async () => {
    setUpdating(true)
    setUpdateMsg('')
    log.info('Updating enzyme library...')
    try {
      const res = await window.api.updateEnzymeLibrary()
      log.info(`Enzyme library updated: ${res.count} enzymes`)
      setUpdateMsg(`酶库已更新，共 ${res.count} 种酶`)
      await loadEnzymes()
    } catch (e: any) {
      log.error('Failed to update enzyme library', e)
      setUpdateMsg(`更新失败: ${e.message ?? e}`)
    } finally {
      setUpdating(false)
      setTimeout(() => setUpdateMsg(''), 5000)
    }
  }

  const toggleFilter = (key: FilterKey) => {
    setActiveFilters(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const availableBuffers = useMemo(() => {
    const set = new Set<string>()
    enzymes.forEach(e => { if (e.optimal_buffer) set.add(e.optimal_buffer) })
    return [...set].sort()
  }, [enzymes])

  const filteredEnzymes = useMemo(() => {
    return enzymes.filter(e => {
      if (activeFilters.has('hf') && !e.is_high_fidelity) return false
      if (activeFilters.has('timeSaver') && !e.is_time_saver) return false
      if (activeFilters.has('6bp') && (e.seq_length ?? e.recognition_sequence.length) !== 6) return false
      if (activeFilters.has('sticky') && e.overhang_type === 'blunt') return false
      if (activeFilters.has('blunt') && e.overhang_type !== 'blunt') return false
      if (activeFilters.has('methyl') && !e.methylation_sensitive) return false
      if (activeFilters.has('ambiguous') && !e.has_ambiguous_bases) return false
      if (activeFilters.has('isoschizomers') && !e.has_isoschizomers) return false
      if (activeFilters.has('subP') && e.subtype !== 'P') return false
      if (activeFilters.has('subS') && e.subtype !== 'S') return false
      if (activeFilters.has('subA') && e.subtype !== 'A') return false
      if (activeFilters.has('orgBacteria') && e.organism_type !== 'bacteria') return false
      if (activeFilters.has('orgArchaea') && e.organism_type !== 'archaea') return false
      if (activeFilters.has('orgVirus') && e.organism_type !== 'virus') return false
      if (bufferFilter && e.optimal_buffer !== bufferFilter) return false
      if (gcActive && e.gc_content != null) {
        if (e.gc_content < gcMin || e.gc_content > gcMax) return false
      }
      return true
    })
  }, [enzymes, activeFilters, bufferFilter, gcActive, gcMin, gcMax])

  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return <>{text}</>
    const idx = text.toLowerCase().indexOf(query.toLowerCase())
    if (idx < 0) return <>{text}</>
    return (
      <>{text.slice(0, idx)}<span className="bg-yellow-200 rounded px-0.5">{text.slice(idx, idx + query.length)}</span>{text.slice(idx + query.length)}</>
    )
  }

  const getBottomStrand = (seq: string): string => {
    return seq.split('').map(c => complementMap[c.toUpperCase()] ?? c).join('')
  }

  /** 检测负偏移：bottom_cut_offset < 0 或 top_cut_offset < 0 */
  const hasNegOff = (topOff?: number, botOff?: number): boolean =>
    (topOff != null && topOff < 0) || (botOff != null && botOff < 0)

  const renderDuplex = (seq: string, cutPos: number, topOff?: number, botOff?: number) => {
    const len = seq.length
    const tOff = topOff ?? cutPos
    const bOff = botOff ?? (len - cutPos)
    // 负偏移：在识别序列 5'端前方补充 N 碱基
    const leftN = Math.max(tOff < 0 ? -tOff : 0, bOff < 0 ? -bOff : 0)
    let topChars = [...Array(leftN).fill('N'), ...seq.toUpperCase().split('')]
    let botChars = [...Array(leftN).fill('N'), ...getBottomStrand(seq).split('')]
    let displayLen = len + leftN
    let topCutIdx = tOff + leftN
    let botCutIdx = bOff + leftN
    if (topCutIdx > displayLen || bOff > len || topCutIdx < 0 || botCutIdx < 0) {
      displayLen = Math.max(topCutIdx, bOff + leftN, len + leftN) + 1
      while (topChars.length < displayLen) { topChars.push('N'); botChars.push('N') }
    }
    const recogStart = leftN
    const recogEnd = leftN + len
    const baseCls = 'inline-block text-center font-bold'
    const baseW = displayLen > 10 ? 'w-3.5' : 'w-4'
    const gapW = displayLen > 10 ? 'w-1' : 'w-1.5'
    const topColor = (i: number) => (i >= recogStart && i < recogEnd)
      ? (i < topCutIdx ? 'text-emerald-600' : 'text-red-500') : 'text-slate-300'
    const botColor = (i: number) => (i >= recogStart && i < recogEnd)
      ? (i < botCutIdx ? 'text-blue-500' : 'text-amber-600') : 'text-slate-300'
    const buildRow = (chars: string[], cutIdx: number, arrow: string, colorFn: (i: number) => string) => (
      <div className="flex items-center">
        {cutIdx === 0 && (<span className={`${baseCls} ${gapW} text-rose-500 font-extrabold`}>{arrow}</span>)}
        {chars.map((c, i) => (
          <span key={`b${i}`} className="flex items-center">
            <span className={`${baseCls} ${baseW} ${colorFn(i)}`}>{c}</span>
            {i === cutIdx - 1 && (<span className={`${baseCls} ${gapW} text-rose-500 font-extrabold`}>{arrow}</span>)}
          </span>
        ))}
      </div>
    )
    return (
      <div className="font-mono text-xs space-y-0.5 overflow-x-auto">
        <div className="flex items-center gap-1">
          <span className="text-slate-400 w-5 text-right flex-shrink-0">5'</span>
          {buildRow(topChars, topCutIdx, '↓', topColor)}
          <span className="text-slate-400 flex-shrink-0">3'</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-slate-400 w-5 text-right flex-shrink-0">3'</span>
          {buildRow(botChars, botCutIdx, '↑', botColor)}
          <span className="text-slate-400 flex-shrink-0">5'</span>
        </div>
      </div>
    )
  }

  const renderCleavageProducts = (seq: string, topOff?: number, botOff?: number, ohType?: string, ohLen?: number) => {
    const len = seq.length
    const tOff = topOff ?? 0
    const bOff = botOff ?? len
    const isNeg = hasNegOff(tOff, bOff)
    let topChars = seq.toUpperCase().split('')
    let botChars = getBottomStrand(seq).split('')
    const topCutIdx = tOff
    let seqLen = len
    let botCutIdx = bOff
    if (topCutIdx > len || botCutIdx > len) {
      seqLen = Math.max(topCutIdx, botCutIdx, len) + 1
      while (topChars.length < seqLen) { topChars.push('N'); botChars.push('N') }
    }
    // === 负偏移酶专用切割产物分支 ===
    if (isNeg) {
      const leftPad = Math.max(tOff < 0 ? -tOff : 0, bOff < 0 ? -bOff : 0)
      const extTop = [...Array(leftPad).fill('N'), ...seq.toUpperCase().split('')]
      const extBot = [...Array(leftPad).fill('N'), ...getBottomStrand(seq).split('')]
      const tCut = tOff + leftPad
      const bCut = bOff + leftPad
      const lTop = extTop.slice(0, tCut)
      const lBot = extBot.slice(0, bCut)
      const rTop = extTop.slice(tCut)
      const rBot = extBot.slice(bCut)
      const isBluntN = ohType === 'blunt' || !ohLen
      const isFiveN = ohType === '5prime'
      const ohColorN = isFiveN ? 'text-red-500' : 'text-blue-500'
      const fb = 'inline-block text-center font-bold w-3.5'
      const dc = 'inline-block text-center font-bold w-3.5 text-slate-200'
      const mkHL = (arr: string[], from: number, to: number) =>
        arr.map((_, i) => i >= from && i < to)
      const lTHL = isBluntN ? lTop.map(() => false) : isFiveN
        ? lTop.map(() => false) : mkHL(lTop, Math.max(0, lTop.length - ohLen), lTop.length)
      const lBHL = isBluntN ? lBot.map(() => false) : isFiveN
        ? mkHL(lBot, Math.max(0, lBot.length - ohLen), lBot.length) : lBot.map(() => false)
      const rTHL = isBluntN ? rTop.map(() => false) : isFiveN
        ? mkHL(rTop, 0, Math.min(ohLen, rTop.length)) : rTop.map(() => false)
      const rBHL = isBluntN ? rBot.map(() => false) : isFiveN
        ? rBot.map(() => false) : mkHL(rBot, Math.max(0, rBot.length - ohLen), rBot.length)
      let lTP = 0, lBP = 0, rTP = 0, rBP = 0
      if (!isBluntN) {
        if (isFiveN) { if (lBot.length > lTop.length) lTP = lBot.length - lTop.length; if (rTop.length > rBot.length) rBP = rTop.length - rBot.length }
        else { if (lTop.length > lBot.length) lBP = lTop.length - lBot.length; if (rBot.length > rTop.length) rTP = rBot.length - rTop.length }
      }
      const nCls = 'text-slate-300 italic'
      const rFN = (topArr: string[], botArr: string[], topHL: boolean[], botHL: boolean[],
        tPL: number, tPR: number, bPL: number, bPR: number) => {
        const tP = [...Array(tPL).fill(null), ...topArr.map((c, i) => ({ c, hl: topHL[i] })), ...Array(tPR).fill(null)]
        const bP = [...Array(bPL).fill(null), ...botArr.map((c, i) => ({ c, hl: botHL[i] })), ...Array(bPR).fill(null)]
        return (
          <div className="space-y-0.5 font-mono text-[11px]">
            <div className="flex items-center gap-0.5">
              <span className="text-slate-400 text-[10px] w-4 text-right">5'</span>
              {tP.map((it, i) => it
                ? <span key={i} className={`${fb} ${it.hl ? ohColorN : it.c === 'N' ? nCls : 'text-slate-500'}`}>{it.c}</span>
                : <span key={i} className={dc}>-</span>
              )}
              <span className="text-slate-400 text-[10px]">3'</span>
            </div>
            <div className="flex items-center gap-0.5">
              <span className="text-slate-400 text-[10px] w-4 text-right">3'</span>
              {bP.map((it, i) => it
                ? <span key={i} className={`${fb} ${it.hl ? ohColorN : it.c === 'N' ? nCls : 'text-slate-500'}`}>{it.c}</span>
                : <span key={i} className={dc}>-</span>
              )}
              <span className="text-slate-400 text-[10px]">5'</span>
            </div>
          </div>
        )
      }
      return (
        <div className="space-y-2 mt-2">
          <h5 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">切割产物</h5>
          <p className="text-[9px] text-amber-600 italic">⚠ 该酶底链切割位点在识别序列上游，N 表示填充碱基</p>
          <div className="flex gap-4 flex-wrap">
            <div><span className="text-[10px] text-slate-400 block mb-1">左片段</span>{rFN(lTop, lBot, lTHL, lBHL, lTP, 0, lBP, 0)}</div>
            <div><span className="text-[10px] text-slate-400 block mb-1">右片段</span>{rFN(rTop, rBot, rTHL, rBHL, rTP, 0, rBP, 0)}</div>
          </div>
        </div>
      )
    }
    // === 正偏移：常规切割产物 ===
    const leftTop = topChars.slice(0, topCutIdx)
    const leftBot = botChars.slice(0, botCutIdx)
    const rightTop = topChars.slice(topCutIdx)
    const rightBot = botChars.slice(botCutIdx)
    const isFivePrime = ohType === '5prime'
    const isBlunt = ohType === 'blunt' || !ohLen
    const ohColor = isFivePrime ? 'text-red-500' : 'text-blue-500'
    const fragBase = 'inline-block text-center font-bold w-3.5'
    const dashCls = 'inline-block text-center font-bold w-3.5 text-slate-200'
    const renderFrag = (topArr: string[], botArr: string[], topHL: boolean[], botHL: boolean[],
      topPadLeft: number, topPadRight: number, botPadLeft: number, botPadRight: number) => {
      const topPadded = [...Array(topPadLeft).fill(null), ...topArr.map((c, i) => ({ c, hl: topHL[i] })), ...Array(topPadRight).fill(null)]
      const botPadded = [...Array(botPadLeft).fill(null), ...botArr.map((c, i) => ({ c, hl: botHL[i] })), ...Array(botPadRight).fill(null)]
      return (
        <div className="space-y-0.5 font-mono text-[11px]">
          <div className="flex items-center gap-0.5">
            <span className="text-slate-400 text-[10px] w-4 text-right">5'</span>
            {topPadded.map((item, i) => item
              ? <span key={i} className={`${fragBase} ${item.hl ? ohColor : 'text-slate-500'}`}>{item.c}</span>
              : <span key={i} className={dashCls}>-</span>
            )}
            <span className="text-slate-400 text-[10px]">3'</span>
          </div>
          <div className="flex items-center gap-0.5">
            <span className="text-slate-400 text-[10px] w-4 text-right">3'</span>
            {botPadded.map((item, i) => item
              ? <span key={i} className={`${fragBase} ${item.hl ? ohColor : 'text-slate-500'}`}>{item.c}</span>
              : <span key={i} className={dashCls}>-</span>
            )}
            <span className="text-slate-400 text-[10px]">5'</span>
          </div>
        </div>
      )
    }
    const leftTopLen = leftTop.length, leftBotLen = leftBot.length
    const rightTopLen = rightTop.length, rightBotLen = rightBot.length
    let lTopPL = 0, lTopPR = 0, lBotPL = 0, lBotPR = 0
    let rTopPL = 0, rTopPR = 0, rBotPL = 0, rBotPR = 0
    if (!isBlunt) {
      if (isFivePrime) {
        if (leftBotLen > leftTopLen) lTopPR = leftBotLen - leftTopLen
        if (rightTopLen > rightBotLen) rBotPL = rightTopLen - rightBotLen
      } else {
        if (leftTopLen > leftBotLen) lBotPR = leftTopLen - leftBotLen
        if (rightBotLen > rightTopLen) rTopPL = rightBotLen - rightTopLen
      }
    }
    const leftTopHLFinal = leftTop.map((_, i) => {
      if (isBlunt) return false
      if (isFivePrime) return false
      return i >= leftTopLen - (ohLen ?? 0)
    })
    const leftBotHL = leftBot.map((_, i) => {
      if (isBlunt) return false
      if (isFivePrime) return i >= leftBotLen - (ohLen ?? 0)
      return false
    })
    const rightTopHL = rightTop.map((_, i) => {
      if (isBlunt) return false
      if (isFivePrime) return i < (ohLen ?? 0)
      return false
    })
    const rightBotHL = rightBot.map((_, i) => {
      if (isBlunt) return false
      if (isFivePrime) return false
      return i >= rightBotLen - (ohLen ?? 0)
    })
    return (
      <div className="space-y-2 mt-2">
        <h5 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">切割产物</h5>
        <div className="flex gap-4 flex-wrap">
          <div><span className="text-[10px] text-slate-400 block mb-1">左片段</span>{renderFrag(leftTop, leftBot, leftTopHLFinal, leftBotHL, lTopPL, lTopPR, lBotPL, lBotPR)}</div>
          <div><span className="text-[10px] text-slate-400 block mb-1">右片段</span>{renderFrag(rightTop, rightBot, rightTopHL, rightBotHL, rTopPL, rTopPR, rBotPL, rBotPR)}</div>
        </div>
      </div>
    )
  }

  const Badge = ({ icon: Icon, label, color }: { icon: any; label: string; color: string }) => (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold ${color}`}>
      <Icon size={12} strokeWidth={2.5} />{label}
    </span>
  )

  const BoolIcon = ({ val, label }: { val: boolean | null | undefined; label: string }) => (
    <div className="flex items-center gap-1.5 text-xs">
      {val ? <Check size={14} className="text-emerald-500" /> : <XCircle size={14} className="text-slate-300" />}
      <span className={val ? 'text-slate-700' : 'text-slate-400'}>{label}</span>
    </div>
  )

  const filterDefs: { key: FilterKey; label: string; icon: any }[] = [
    { key: 'hf', label: 'HF 高保真', icon: Shield },
    { key: 'timeSaver', label: 'Time-Saver', icon: Clock },
    { key: '6bp', label: '6bp 识别', icon: Dna },
    { key: 'sticky', label: '粘性末端', icon: Scissors },
    { key: 'blunt', label: '平端', icon: ArrowLeftRight },
    { key: 'methyl', label: '甲基化敏感', icon: AlertTriangle },
    { key: 'subP', label: 'P 回文', icon: ArrowLeftRight },
    { key: 'subS', label: 'S 移位', icon: Zap },
    { key: 'ambiguous', label: '含简并碱基', icon: Dna },
    { key: 'isoschizomers', label: '有同切酶', icon: Database },
    { key: 'orgBacteria', label: '🦠 细菌', icon: Globe },
    { key: 'orgArchaea', label: '🧬 古菌', icon: Globe },
  ]

  const e = selectedEnzyme

  return (
    <div className="flex gap-6 h-full">
      {/* ========== 左侧：列表 ========== */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex gap-2 mb-2">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="搜索酶名称、物种、中文名或识别序列..."
              value={searchQuery} onChange={(ev) => setSearchQuery(ev.target.value)}
              onKeyDown={(ev) => ev.key === 'Enter' && handleSearch()}
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button onClick={handleSearch} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-500">搜索</button>
          <button onClick={handleCreate} className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-500 flex items-center gap-1">
            <Plus size={16} /> 添加
          </button>
         <button onClick={handleUpdateLibrary} disabled={updating}
            className="px-3 py-2 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-500 disabled:opacity-50 flex items-center gap-1">
            <RefreshCw size={14} className={updating ? 'animate-spin' : ''} /> {updating ? '更新中...' : '更新酶库'}
          </button>
          <button onClick={openLabDialog}
            className="px-3 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-500 flex items-center gap-1">
            <Beaker size={14} /> 实验室常用酶
          </button>
        </div>

        {updateMsg && (
          <div className={`mb-2 px-3 py-1.5 rounded text-xs ${updateMsg.includes('失败') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
            {updateMsg}
          </div>
        )}

        {/* 快速过滤标签 */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {filterDefs.map(f => (
            <button key={f.key} onClick={() => toggleFilter(f.key)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-colors ${
                activeFilters.has(f.key) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
              }`}>
              <f.icon size={12} />{f.label}
            </button>
          ))}
          {availableBuffers.length > 0 && (
            <select value={bufferFilter} onChange={(ev) => setBufferFilter(ev.target.value)}
              className="px-2 py-1 rounded-full text-xs border border-slate-200 bg-white text-slate-600 focus:outline-none focus:border-blue-400">
              <option value="">全部缓冲液</option>
              {availableBuffers.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          {/* GC 含量范围筛选 */}
          <div className="flex items-center gap-1 text-xs">
            <button onClick={() => setGcActive(!gcActive)}
              className={`px-2 py-1 rounded-full border transition-colors ${gcActive ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200'}`}>
              GC%
            </button>
            {gcActive && (
              <>
                <input type="number" value={gcMin} min={0} max={100} onChange={(ev) => setGcMin(Number(ev.target.value))}
                  className="w-12 px-1 py-0.5 border rounded text-xs" placeholder="Min" />
                <span>-</span>
                <input type="number" value={gcMax} min={0} max={100} onChange={(ev) => setGcMax(Number(ev.target.value))}
                  className="w-12 px-1 py-0.5 border rounded text-xs" placeholder="Max" />
              </>
            )}
          </div>
          {(activeFilters.size > 0 || bufferFilter || gcActive) && (
            <button onClick={() => { setActiveFilters(new Set()); setBufferFilter(''); setGcActive(false) }}
              className="px-2 py-1 text-xs text-slate-400 hover:text-red-500">清除筛选</button>
          )}
        </div>

        {/* 表格 */}
        <div className="flex-1 overflow-auto bg-white rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-600 min-w-[120px]">名称</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">识别序列</th>
                <th className="text-center px-2 py-2 font-medium text-slate-600">亚型</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">突出端</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">缓冲液</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">温度</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">标签</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600 w-20">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredEnzymes.map((enzyme) => {
                const sub = subtypeBadge(enzyme.subtype)
                return (
                <tr key={enzyme.id} onClick={() => setSelectedEnzyme(enzyme)}
                  className={`border-t border-slate-100 cursor-pointer transition-colors ${selectedEnzyme?.id === enzyme.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      {enzyme.organism_type && (
                        <span className="text-[10px]" title={orgTypeLabel(enzyme.organism_type)}>
                          {enzyme.organism_type === 'bacteria' ? '🦠' : enzyme.organism_type === 'archaea' ? '🧬' : enzyme.organism_type === 'virus' ? '🦠' : enzyme.organism_type === 'plasmid' ? '💊' : '❓'}
                        </span>
                      )}
                      <span className="font-medium text-slate-800">{highlightText(enzyme.name, searchQuery)}</span>
                      {!!enzyme.has_isoschizomers && <span className="text-[9px] text-indigo-400" title="有同切酶">≡</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs"><span className="text-amber-600">{enzyme.recognition_sequence.toUpperCase()}</span></td>
                  <td className="px-2 py-2 text-center">
                    {sub && <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${sub.color}`} title={sub.title}>{sub.label}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">{overhangLabel(enzyme.overhang_type)}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{enzyme.optimal_buffer ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{enzyme.optimal_temp}°C</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {!!enzyme.is_high_fidelity && <Badge icon={Shield} label="HF" color="bg-purple-100 text-purple-700" />}
                      {!!enzyme.is_time_saver && <Badge icon={Clock} label="TS" color="bg-sky-100 text-sky-700" />}
                      {!!enzyme.methylation_sensitive && <Badge icon={AlertTriangle} label="Me" color="bg-orange-100 text-orange-700" />}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={(ev) => { ev.stopPropagation(); handleEdit(enzyme) }} className="p-1 text-slate-400 hover:text-blue-600"><Edit2 size={14} /></button>
                    <button onClick={(ev) => { ev.stopPropagation(); handleDelete(enzyme.id) }} className="p-1 text-slate-400 hover:text-red-600 ml-1"><Trash2 size={14} /></button>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
          {filteredEnzymes.length === 0 && (
            <div className="text-center py-12 text-slate-400">{enzymes.length > 0 ? '无匹配筛选结果' : '暂无数据'}</div>
          )}
        </div>
        <div className="text-xs text-slate-400 mt-2">
          共 {enzymes.length} 种酶{filteredEnzymes.length !== enzymes.length && ` · 筛选显示 ${filteredEnzymes.length} 种`}
        </div>
      </div>

      {/* ========== 右侧：详情面板 ========== */}
      {e && (
        <div className="w-[420px] bg-white rounded-lg border border-slate-200 flex-shrink-0 overflow-auto">
          {/* 头部 */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-bold text-slate-800">{e.name}</h3>
              {(() => { const s = subtypeBadge(e.subtype); return s ? <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${s.color}`} title={s.title}>{s.label}</span> : null })()}
              {!!e.is_high_fidelity && <Badge icon={Shield} label="HF" color="bg-purple-100 text-purple-700" />}
              {!!e.is_time_saver && <Badge icon={Clock} label="TS" color="bg-sky-100 text-sky-700" />}
            </div>
            <button onClick={() => setSelectedEnzyme(null)} className="p-1 text-slate-400 hover:text-slate-600"><X size={16} /></button>
          </div>

          <div className="px-5 py-4 space-y-5">
            {/* ---- 1. 基本信息 ---- */}
            <section>
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><FlaskConical size={12} /> 基本信息</h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-xs text-slate-500">来源物种</span>
                  <p className="italic text-slate-700 text-xs mt-0.5">{e.source_organism || '—'}</p>
                  {e.source_organism_cn && <p className="text-slate-500 text-[10px] mt-0.5">{e.source_organism_cn}</p>}
                </div>
                {e.organism_type && (
                  <div>
                    <span className="text-xs text-slate-500">物种类型</span>
                    <p className="text-slate-700 mt-0.5 text-xs">{orgTypeLabel(e.organism_type)}</p>
                  </div>
                )}
                {e.rebase_id && (
                  <div>
                    <span className="text-xs text-slate-500">REBASE 编号</span>
                    <p className="text-slate-700 mt-0.5 text-xs">
                      {e.rebase_url ? (
                        <a href={e.rebase_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline flex items-center gap-1">
                          {e.rebase_id} <ExternalLink size={10} />
                        </a>
                      ) : e.rebase_id}
                    </p>
                  </div>
                )}
                {e.prototype && (
                  <div>
                    <span className="text-xs text-slate-500">原型酶</span>
                    <p className="text-slate-700 mt-0.5 text-xs">{e.prototype}</p>
                  </div>
                )}
                <div>
                  <span className="text-xs text-slate-500">回文序列</span>
                  <p className="text-slate-700 mt-0.5">{e.is_palindromic ? '✓ 是' : '✗ 否'}</p>
                </div>
                {e.molecular_weight != null && (
                  <div>
                    <span className="text-xs text-slate-500">分子量</span>
                    <p className="text-slate-700 mt-0.5 text-xs">{e.molecular_weight.toLocaleString()} Da</p>
                  </div>
                )}
              </div>
            </section>

            {/* ---- 2. 识别与切割 ---- */}
            <section>
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Scissors size={12} /> 识别与切割</h4>
              {/* 负偏移切割提示 */}
              {hasNegOff(e.top_cut_offset, e.bottom_cut_offset) && (
                <div className="bg-amber-50 border border-amber-200 rounded px-3 py-1.5 mb-2 text-xs text-amber-700 flex items-center gap-1.5">
                  <AlertTriangle size={12} className="flex-shrink-0" />
                  <span>该酶具有<strong>负偏移切割</strong>特性：底链切割位点位于识别序列上游（5'方向），切割偏移为负数</span>
                </div>
              )}
              {e.cut_sequence && (
                <div className="bg-indigo-50 rounded px-3 py-1.5 mb-2 text-xs font-mono text-indigo-700">
                  <span className="text-[10px] text-indigo-400 mr-2">切割标注</span>{e.cut_sequence}
                </div>
              )}
              <div className="bg-slate-50 rounded-lg p-3 mb-2">
                {renderDuplex(e.recognition_sequence, e.cut_position, e.top_cut_offset, e.bottom_cut_offset)}
              </div>
              <div className="bg-slate-50 rounded-lg p-3 mb-2">
                {renderCleavageProducts(e.recognition_sequence,
                  e.top_cut_offset ?? e.cut_position,
                  e.bottom_cut_offset ?? (e.recognition_sequence.length - e.cut_position),
                  e.overhang_type, e.overhang_length)}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-slate-500">切割位置</span><p className="text-slate-700 mt-0.5">第 {e.cut_position} 位</p></div>
                <div>
                  <span className="text-slate-500">突出端</span>
                  <p className="text-slate-700 mt-0.5">{overhangLabel(e.overhang_type)}
                    {e.overhang_length != null && e.overhang_type !== 'blunt' ? ` (${e.overhang_length}nt)` : ''}
                  </p>
                </div>
                {e.top_cut_offset != null && <div><span className="text-slate-500">上链切割</span><p className="text-slate-700 mt-0.5">{e.top_cut_offset}</p></div>}
                {e.bottom_cut_offset != null && <div><span className="text-slate-500">下链切割</span><p className="text-slate-700 mt-0.5">{e.bottom_cut_offset}</p></div>}
                {e.clean_recognition_seq && e.clean_recognition_seq !== e.recognition_sequence && (
                  <div><span className="text-slate-500">纯识别序列</span><p className="text-slate-700 mt-0.5 font-mono">{e.clean_recognition_seq}</p></div>
                )}
                {e.seq_length != null && <div><span className="text-slate-500">序列长度</span><p className="text-slate-700 mt-0.5">{e.seq_length} bp</p></div>}
                {e.gc_content != null && <div><span className="text-slate-500">GC 含量</span><p className="text-slate-700 mt-0.5">{e.gc_content}%</p></div>}
                {e.has_ambiguous_bases != null && (
                  <div><span className="text-slate-500">简并碱基</span><p className="text-slate-700 mt-0.5">{e.has_ambiguous_bases ? '⚠ 含' : '不含'}</p></div>
                )}
              </div>
            </section>

            {/* ---- 3. 反应条件 ---- */}
            <section>
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Thermometer size={12} /> 反应条件</h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-xs text-slate-500">推荐缓冲液</span><p className="text-slate-700 font-medium mt-0.5">{e.optimal_buffer ?? '—'}</p></div>
                <div><span className="text-xs text-slate-500">反应温度</span><p className="text-slate-700 mt-0.5 flex items-center gap-1"><Thermometer size={12} /> {e.optimal_temp}°C</p></div>
                {e.growth_temp != null && e.growth_temp !== e.optimal_temp && (
                  <div><span className="text-xs text-slate-500">生长温度</span><p className="text-slate-700 mt-0.5">{e.growth_temp}°C</p></div>
                )}
                {e.heat_inactivation_temp != null && (
                  <div><span className="text-xs text-slate-500">热失活</span><p className="text-slate-700 mt-0.5">{e.heat_inactivation_temp}°C (20min)</p></div>
                )}
              </div>
            </section>

            {/* ---- 4. 载体切点统计 ---- */}
            {(e.sites_lambda != null || e.sites_pbr322 != null || e.sites_adeno2 != null || e.sites_phix174 != null || e.sites_sv40 != null) && (
              <section>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Database size={12} /> 载体切点统计</h4>
                <div className="grid grid-cols-5 gap-1 text-center">
                  {[
                    { label: 'λ', val: e.sites_lambda },
                    { label: 'pBR322', val: e.sites_pbr322 },
                    { label: 'Adeno2', val: e.sites_adeno2 },
                    { label: 'ΦX174', val: e.sites_phix174 },
                    { label: 'SV40', val: e.sites_sv40 },
                  ].map(s => (
                    <div key={s.label} className="bg-slate-50 rounded p-1.5">
                      <div className="text-[10px] text-slate-400">{s.label}</div>
                      <div className="text-sm font-bold text-slate-700">{s.val ?? '—'}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ---- 5. 研究数据 ---- */}
            {(e.gene_cloned || e.gene_sequenced || e.crystal_data || e.kinetics_data) && (
              <section>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">研究数据</h4>
                <div className="grid grid-cols-2 gap-2">
                  <BoolIcon val={e.gene_cloned} label="基因已克隆" />
                  <BoolIcon val={e.gene_sequenced} label="基因已测序" />
                  <BoolIcon val={e.crystal_data} label="晶体结构" />
                  <BoolIcon val={e.kinetics_data} label="动力学数据" />
                </div>
              </section>
            )}

            {/* ---- 6. 特殊属性 ---- */}
            {(e.methylation_sensitive || e.star_activity_note || e.ligation_note || e.ss_cleavage) && (
              <section>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Zap size={12} /> 特殊属性</h4>
                <div className="space-y-2 text-xs">
                  {e.methylation_sensitive && (
                    <div className="flex items-start gap-2 bg-orange-50 rounded p-2">
                      <AlertTriangle size={14} className="text-orange-500 mt-0.5 flex-shrink-0" />
                      <div><span className="font-medium text-orange-800">甲基化敏感</span><p className="text-orange-700 mt-0.5">{e.methylation_sensitive}</p></div>
                    </div>
                  )}
                  {e.star_activity_note && (
                    <div className="flex items-start gap-2 bg-amber-50 rounded p-2">
                      <Zap size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
                      <div><span className="font-medium text-amber-800">星号活性</span><p className="text-amber-700 mt-0.5">{e.star_activity_note}</p></div>
                    </div>
                  )}
                  {!!e.ss_cleavage && (
                    <div className="flex items-start gap-2 bg-cyan-50 rounded p-2">
                      <Scissors size={14} className="text-cyan-500 mt-0.5 flex-shrink-0" />
                      <div><span className="font-medium text-cyan-800">单链切割</span><p className="text-cyan-700 mt-0.5">具备单链切割能力</p></div>
                    </div>
                  )}
                  {e.ligation_note && (
                    <div className="flex items-start gap-2 bg-blue-50 rounded p-2">
                      <Dna size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />
                      <div><span className="font-medium text-blue-800">连接注释</span><p className="text-blue-700 mt-0.5">{e.ligation_note}</p></div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* ---- 7. 元信息 ---- */}
            {(e.date_entered || e.date_modified || e.rebase_url) && (
              <section>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Calendar size={12} /> 元信息</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {e.date_entered && <div><span className="text-slate-500">录入日期</span><p className="text-slate-700 mt-0.5">{e.date_entered}</p></div>}
                  {e.date_modified && <div><span className="text-slate-500">修改日期</span><p className="text-slate-700 mt-0.5">{e.date_modified}</p></div>}
                  {e.rebase_url && (
                    <div className="col-span-2">
                      <a href={e.rebase_url} target="_blank" rel="noreferrer"
                        className="text-blue-600 hover:underline flex items-center gap-1 text-xs">
                        REBASE 数据库 <ExternalLink size={10} />
                      </a>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      {/* ========== 表单弹窗 ========== */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[480px] shadow-xl">
            <h3 className="text-lg font-bold mb-4">{editingEnzyme ? '编辑酶' : '添加酶'}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-slate-600">名称 *</label>
                <input value={formData.name} onChange={(ev) => setFormData({...formData, name: ev.target.value})}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-600">来源物种 *</label>
                <input value={formData.source_organism} onChange={(ev) => setFormData({...formData, source_organism: ev.target.value})}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-600">识别序列 *</label>
                <input value={formData.recognition_sequence} onChange={(ev) => setFormData({...formData, recognition_sequence: ev.target.value.toUpperCase()})}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-sm font-medium text-slate-600">切割位置</label>
                  <input type="number" value={formData.cut_position} onChange={(ev) => setFormData({...formData, cut_position: parseInt(ev.target.value) || 0})}
                    className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium text-slate-600">最适温度 (°C)</label>
                  <input type="number" value={formData.optimal_temp} onChange={(ev) => setFormData({...formData, optimal_temp: parseFloat(ev.target.value) || 37})}
                    className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={formData.is_palindromic} onChange={(ev) => setFormData({...formData, is_palindromic: ev.target.checked})} className="rounded" />
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

      {/* ========== 实验室常用酶列表编辑对话框 ========== */}
      {showLabDialog && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowLabDialog(false)}>
          <div className="bg-white rounded-xl p-5 w-[720px] shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            {/* 标题栏 */}
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm flex items-center gap-1.5"><Beaker size={16} className="text-teal-600" /> 实验室常用酶列表管理</h3>
              <button onClick={() => setShowLabDialog(false)} className="p-1 text-slate-400 hover:text-slate-600"><X size={14} /></button>
            </div>

            {/* 已选 chip 展示区 */}
            <div className="mb-3 p-2 bg-teal-50 rounded-lg border border-teal-200">
              <div className="flex items-center gap-1 mb-1.5">
                <span className="text-[10px] font-semibold text-teal-700">已选 {labSelected.size} 种酶</span>
                <button onClick={clearLabSelected} className="ml-auto text-[9px] text-teal-500 hover:text-red-500">全部清除</button>
              </div>
              <div className="flex flex-wrap gap-1 max-h-[60px] overflow-auto">
                {Array.from(labSelected).sort().map(name => (
                  <span key={name} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-teal-100 text-teal-800 rounded text-[10px] font-medium">
                    {name}
                    <button onClick={() => toggleLabEnzyme(name)} className="text-teal-400 hover:text-red-500 ml-0.5"><X size={8} /></button>
                  </span>
                ))}
                {labSelected.size === 0 && <span className="text-[10px] text-teal-400 italic">未选择任何酶</span>}
              </div>
            </div>

            {/* 搜索 + 筛选 */}
            <div className="mb-2 space-y-2">
              <div className="relative">
                <Search size={12} className="absolute left-2 top-2 text-slate-400" />
                <input type="text" placeholder="搜索酶名称或识别序列..." value={labSearch}
                  onChange={e => setLabSearch(e.target.value)}
                  className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded bg-white" />
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                {/* 末端类型 */}
                <select value={labOhFilter} onChange={e => setLabOhFilter(e.target.value)}
                  className="px-2 py-1 text-[10px] border rounded bg-white">
                  <option value="">全部末端类型</option>
                  <option value="5prime">粘性 5'</option>
                  <option value="3prime">粘性 3'</option>
                  <option value="blunt">平末端</option>
                </select>
                {/* 亚型 */}
                <select value={labSubFilter} onChange={e => setLabSubFilter(e.target.value)}
                  className="px-2 py-1 text-[10px] border rounded bg-white">
                  <option value="">全部亚型</option>
                  <option value="P">Type IIP</option>
                  <option value="S">Type IIS</option>
                  <option value="A">Type IIA</option>
                  <option value="B">Type IIB</option>
                  <option value="C">Type IIC</option>
                  <option value="F">Type IIF</option>
                </select>
                {/* 特殊属性 */}
                {(['hf', 'ts', 'methyl'] as const).map(key => {
                  const label = key === 'hf' ? 'HF 高保真' : key === 'ts' ? 'TS 快速' : '甲基化敏感'
                  return (
                    <button key={key} onClick={() => setLabSpecialFilter(prev => {
                      const next = new Set(prev)
                      next.has(key) ? next.delete(key) : next.add(key)
                      return next
                    })}
                      className={`px-2 py-1 text-[10px] border rounded transition-colors ${
                        labSpecialFilter.has(key) ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-slate-600 border-slate-200 hover:border-teal-300'
                      }`}>
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 快捷按钮 */}
            <div className="flex gap-2 mb-2">
              <button onClick={selectAllLabFiltered}
                className="px-2 py-0.5 text-[10px] border rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
                ✓ 全选当前筛选结果 ({labFilteredEnzymes.length})
              </button>
              <button onClick={clearLabSelected}
                className="px-2 py-0.5 text-[10px] border rounded text-slate-500 hover:bg-slate-100">
                ✕ 清空已选
              </button>
            </div>

            {/* 酶列表（复选框） */}
            <div className="flex-1 overflow-auto border border-slate-200 rounded bg-white">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0 z-10">
                  <tr>
                    <th className="w-8 px-2 py-1.5 text-center">✓</th>
                    <th className="text-left px-2 py-1.5 font-medium text-slate-600">名称</th>
                    <th className="text-left px-2 py-1.5 font-medium text-slate-600">识别序列</th>
                    <th className="text-left px-2 py-1.5 font-medium text-slate-600">末端</th>
                    <th className="text-center px-2 py-1.5 font-medium text-slate-600">亚型</th>
                    <th className="text-left px-2 py-1.5 font-medium text-slate-600">标签</th>
                  </tr>
                </thead>
                <tbody>
                  {labFilteredEnzymes.map(en => {
                    const checked = labSelected.has(en.name)
                    const sub = subtypeBadge(en.subtype)
                    return (
                      <tr key={en.id} onClick={() => toggleLabEnzyme(en.name)}
                        className={`border-t border-slate-100 cursor-pointer transition-colors ${checked ? 'bg-teal-50' : 'hover:bg-slate-50'}`}>
                        <td className="px-2 py-1 text-center">
                          <input type="checkbox" checked={checked} onChange={() => toggleLabEnzyme(en.name)}
                            className="accent-teal-600" onClick={e => e.stopPropagation()} />
                        </td>
                        <td className="px-2 py-1 font-medium text-slate-800">{en.name}</td>
                        <td className="px-2 py-1 font-mono text-amber-600">{en.recognition_sequence.toUpperCase()}</td>
                        <td className="px-2 py-1 text-slate-600">{overhangLabel(en.overhang_type)}</td>
                        <td className="px-2 py-1 text-center">
                          {sub && <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${sub.color}`}>{sub.label}</span>}
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex gap-0.5">
                            {!!en.is_high_fidelity && <span className="px-1 py-0.5 bg-purple-100 text-purple-700 rounded text-[8px]">HF</span>}
                            {!!en.is_time_saver && <span className="px-1 py-0.5 bg-sky-100 text-sky-700 rounded text-[8px]">TS</span>}
                            {!!en.methylation_sensitive && <span className="px-1 py-0.5 bg-orange-100 text-orange-700 rounded text-[8px]">Me</span>}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {labFilteredEnzymes.length === 0 && (
                <div className="text-center text-[10px] text-slate-400 py-6">无匹配结果</div>
              )}
            </div>

            {/* 底部按钮 */}
            <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-slate-200">
              <button onClick={() => setShowLabDialog(false)}
                className="px-3 py-1.5 text-xs border rounded text-slate-600 hover:bg-slate-50">取消</button>
              <button onClick={saveLabCommon}
                className="px-3 py-1.5 text-xs bg-teal-600 text-white rounded hover:bg-teal-500">
                保存 ({labSelected.size} 种酶)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
