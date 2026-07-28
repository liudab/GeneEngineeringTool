/**
 * 模拟酶切鉴定面板
 * 集成：
 *   - 单/双/多酶切模式选择
 *   - 数据库酶库搜索过滤
 *   - 实时片段计算（支持环形载体 wrap-around）
 *   - 一键导入凝胶电泳模拟（复用 GelElectrophoresis + fragmentsToLane）
 */

import { useState, useMemo, useEffect, useCallback } from 'react'
import { Search, Plus, X, Play, Beaker, Trash2, AlertTriangle, CheckCircle, Dna } from 'lucide-react'
import GelElectrophoresis from '../GelElectrophoresis/GelElectrophoresis'
import type { RestrictionEnzyme } from '../../../shared/types'
import { fragmentsToLane, type GelLane } from '../../engine/gel/electrophoresis'

type EnzymeMode = 'single' | 'double' | 'multi'

interface DigestFragment {
  start: number
  end: number
  length: number
}

interface Props {
  /** 当前序列（载体/基因） */
  sequence: string
  /** 拓扑：环形/线性 */
  topology?: 'circular' | 'linear'
  /** 面板关闭回调 */
  onClose?: () => void
  className?: string
}

export default function DigestSimulationPanel({ sequence, topology = 'circular', onClose, className = '' }: Props) {
  // ============ 酶库加载 ============
  const [enzymeDB, setEnzymeDB] = useState<RestrictionEnzyme[]>([])
  const [dbLoading, setDbLoading] = useState(true)

  useEffect(() => {
    setDbLoading(true)
    window.api.getEnzymes()
      .then((list: any[]) => setEnzymeDB(list || []))
      .catch(err => { console.error('加载酶库失败:', err); setEnzymeDB([]) })
      .finally(() => setDbLoading(false))
  }, [])

  // ============ 状态 ============
  const [mode, setMode] = useState<EnzymeMode>('single')
  const [selectedEnzymes, setSelectedEnzymes] = useState<RestrictionEnzyme[]>([])
  const [search, setSearch] = useState('')
  const [showGel, setShowGel] = useState(false)

  // ============ 酶库过滤 ============
  const filteredEnzymes = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return enzymeDB.slice(0, 50)
    return enzymeDB.filter(e =>
      (e.name || '').toLowerCase().includes(q) ||
      (e.recognition_sequence || '').toLowerCase().includes(q) ||
      (e.source_organism || '').toLowerCase().includes(q)
    ).slice(0, 100)
  }, [enzymeDB, search])

  // ============ 每个酶在当前序列中的识别位点数量 ============
  const enzymeSiteCounts = useMemo(() => {
    if (!sequence || enzymeDB.length === 0) return new Map<number, number>()
    const seqUpper = sequence.toUpperCase()
    const counts = new Map<number, number>()

    for (const enz of enzymeDB) {
      const recog = (enz.recognition_sequence || '').toUpperCase()
      if (recog.length < 4) { counts.set(enz.id, 0); continue }

      const regex = iupacToRegex(recog)
      let count = 0
      regex.lastIndex = 0
      while (regex.exec(seqUpper) !== null) count++

      // 反义链
      const rc = reverseComplement(recog)
      if (rc !== recog) {
        const rcRegex = iupacToRegex(rc)
        rcRegex.lastIndex = 0
        while (rcRegex.exec(seqUpper) !== null) count++
      }
      counts.set(enz.id, count)
    }
    return counts
  }, [sequence, enzymeDB])

  // ============ 模式约束：根据模式裁剪已选酶数 ============
  useEffect(() => {
    if (mode === 'single' && selectedEnzymes.length > 1) {
      setSelectedEnzymes(prev => prev.slice(0, 1))
    } else if (mode === 'double' && selectedEnzymes.length > 2) {
      setSelectedEnzymes(prev => prev.slice(0, 2))
    }
  }, [mode, selectedEnzymes.length])

  // 酶选择变化时关闭旧凝胶预览，避免残留旧结果
  useEffect(() => {
    setShowGel(false)
  }, [selectedEnzymes])

  const maxEnzymes = mode === 'single' ? 1 : mode === 'double' ? 2 : 20
  const canAddMore = selectedEnzymes.length < maxEnzymes

  // ============ 酶切片段计算 ============
  const digestResult = useMemo(() => {
    if (!sequence || selectedEnzymes.length === 0) {
      return { fragments: [] as DigestFragment[], allCuts: [] as { pos: number; enzyme: string }[], errors: [] as string[] }
    }
    const seqLen = sequence.length

    // 收集所有切割位点
    const cuts: { pos: number; enzyme: string }[] = []
    const errors: string[] = []

    for (const enz of selectedEnzymes) {
      const recog = (enz.recognition_sequence || '').toUpperCase()
      if (recog.length < 4) continue

      const regex = iupacToRegex(recog)
      const seqUpper = sequence.toUpperCase()
      const sites: number[] = []
      let m: RegExpExecArray | null
      regex.lastIndex = 0
      while ((m = regex.exec(seqUpper)) !== null) {
        sites.push(m.index)
      }
      // 反义链扫描（仅非回文）
      const rc = reverseComplement(recog)
      if (rc !== recog) {
        const rcRegex = iupacToRegex(rc)
        rcRegex.lastIndex = 0
        while ((m = rcRegex.exec(seqUpper)) !== null) {
          sites.push(m.index)
        }
      }

      if (sites.length === 0) {
        errors.push(`${enz.name} 在当前序列中无识别位点`)
        continue
      }

      // 将识别位点转换为切割位置
      for (const s of sites) {
        const cutPos = (s + (enz.cut_position || 0)) % seqLen
        cuts.push({ pos: cutPos, enzyme: enz.name })
      }
    }

    // 去重 + 排序
    const uniqueCuts: { pos: number; enzyme: string }[] = []
    const seen = new Set<number>()
    cuts.sort((a, b) => a.pos - b.pos).forEach(c => {
      if (!seen.has(c.pos)) { seen.add(c.pos); uniqueCuts.push(c) }
    })

    if (uniqueCuts.length === 0) {
      return { fragments: [{ start: 0, end: seqLen, length: seqLen }], allCuts: [], errors }
    }

    // 计算片段
    let fragments: DigestFragment[]
    if (topology === 'circular') {
      // 环形：N 个切点产生 N 个片段（wrap-around）
      fragments = []
      for (let i = 0; i < uniqueCuts.length; i++) {
        const start = uniqueCuts[i].pos
        const end = i + 1 < uniqueCuts.length ? uniqueCuts[i + 1].pos : uniqueCuts[0].pos
        const len = end > start ? end - start : seqLen - start + end
        fragments.push({ start, end, length: len })
      }
    } else {
      // 线性：N 个切点产生 N+1 个片段
      fragments = []
      let prev = 0
      for (const c of uniqueCuts) {
        if (c.pos > prev) fragments.push({ start: prev, end: c.pos, length: c.pos - prev })
        prev = c.pos
      }
      if (prev < seqLen) fragments.push({ start: prev, end: seqLen, length: seqLen - prev })
    }

    // 按长度降序
    fragments.sort((a, b) => b.length - a.length)
    return { fragments, allCuts: uniqueCuts, errors }
  }, [sequence, selectedEnzymes, topology])

  const totalLength = useMemo(() => digestResult.fragments.reduce((s, f) => s + f.length, 0), [digestResult])

  // ============ 操作 ============
  const toggleEnzyme = useCallback((e: RestrictionEnzyme) => {
    setSelectedEnzymes(prev => {
      const exists = prev.find(x => x.id === e.id)
      if (exists) return prev.filter(x => x.id !== e.id)
      if (prev.length >= maxEnzymes) {
        // 替换最后一个
        return [...prev.slice(0, -1), e]
      }
      return [...prev, e]
    })
  }, [maxEnzymes])

  const clearEnzymes = useCallback(() => setSelectedEnzymes([]), [])

  // 转换为凝胶泳道（按片段大小，每个片段作为一条带）
  const gelLanes = useMemo((): GelLane[] => {
    if (digestResult.fragments.length === 0) return []
    const enzymeNames = selectedEnzymes.map(e => e.name).join('+') || 'Digest'
    const frags = digestResult.fragments.map((f, i) => ({
      label: `Fragment ${i + 1} (${f.length} bp)`,
      size: f.length
    }))
    return [fragmentsToLane(enzymeNames, frags)]
  }, [digestResult, selectedEnzymes])

  const hasResult = digestResult.fragments.length > 0 && selectedEnzymes.length > 0

  // ============ UI ============
  return (
    <div className={`flex flex-col h-full bg-white ${className}`}>
      {/* 顶部标题 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-gradient-to-r from-rose-50 to-orange-50">
        <h3 className="text-sm font-bold text-rose-700 flex items-center gap-2">
          <Dna size={16} /> 模拟酶切鉴定
        </h3>
        {onClose && (
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        )}
      </div>

      {/* 主体：两栏布局 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 左侧：酶选择 */}
        <div className="w-[340px] flex-shrink-0 border-r border-slate-200 flex flex-col overflow-hidden">
          {/* 酶切模式 */}
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
            <div className="text-[10px] text-slate-500 mb-1 font-medium">酶切模式</div>
            <div className="flex gap-1">
              {(['single', 'double', 'multi'] as EnzymeMode[]).map(m => (
                <button key={m} onClick={() => setMode(m)}
                  className={`flex-1 text-xs py-1 rounded border transition ${mode === m ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
                  {m === 'single' ? '单酶切' : m === 'double' ? '双酶切' : '多酶切'}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              已选 {selectedEnzymes.length} / {maxEnzymes} 种酶
            </div>
          </div>

          {/* 酶搜索 */}
          <div className="px-3 py-2 border-b border-slate-100">
            <div className="flex items-center gap-1.5 border rounded px-2 py-1 bg-white focus-within:border-rose-300">
              <Search size={12} className="text-slate-400" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="搜索酶名称 / 识别序列..."
                className="flex-1 text-xs bg-transparent outline-none" />
              {search && (
                <button onClick={() => setSearch('')} className="p-0.5 text-slate-300 hover:text-slate-500">
                  <X size={10} />
                </button>
              )}
            </div>
          </div>

          {/* 已选酶 chips */}
          {selectedEnzymes.length > 0 && (
            <div className="px-3 py-1.5 border-b border-slate-100 bg-amber-50 flex flex-wrap gap-1 items-center">
              <span className="text-[10px] text-amber-700 mr-1">已选:</span>
              {selectedEnzymes.map(e => (
                <span key={e.id} className="inline-flex items-center gap-1 bg-amber-200 text-amber-900 rounded-full px-2 py-0.5 text-[10px] font-medium">
                  {e.name}
                  <button onClick={() => setSelectedEnzymes(prev => prev.filter(x => x.id !== e.id))}
                    className="hover:text-red-600"><X size={9} /></button>
                </span>
              ))}
              <button onClick={clearEnzymes} className="text-[10px] text-amber-700 hover:text-red-600 ml-1 flex items-center gap-0.5">
                <Trash2 size={9} /> 清空
              </button>
            </div>
          )}

          {/* 酶库列表 */}
          <div className="flex-1 overflow-auto">
            {dbLoading ? (
              <div className="p-3 text-xs text-slate-400">加载酶库中...</div>
            ) : filteredEnzymes.length === 0 ? (
              <div className="p-3 text-xs text-slate-400">未找到匹配的酶</div>
            ) : (
              <div className="divide-y divide-slate-50">
                {filteredEnzymes.map(e => {
                  const isSelected = selectedEnzymes.some(x => x.id === e.id)
                  const siteCount = enzymeSiteCounts.get(e.id) ?? 0
                  return (
                    <button key={e.id}
                      onClick={() => toggleEnzyme(e)}
                      disabled={(!isSelected && !canAddMore) || siteCount === 0}
                      className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed
                        ${isSelected ? 'bg-rose-50' : ''}`}>
                      <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border flex-shrink-0
                        ${isSelected ? 'bg-rose-600 border-rose-600' : 'border-slate-300'}`}>
                        {isSelected && <CheckCircle size={10} className="text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-slate-700 truncate">
                          {e.name}
                          <span className={`ml-1 text-[9px] font-normal ${siteCount > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                            {siteCount > 0 ? `(${siteCount} 个位点)` : '(无位点)'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono truncate">
                          {e.recognition_sequence} · {e.source_organism}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* 右侧：片段分析 + 凝胶 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 片段分析结果 */}
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Play size={11} /> 酶切分析
              </div>
              {hasResult && (
                <div className="text-[10px] text-slate-500">
                  {digestResult.fragments.length} 个片段 · 总长 {totalLength.toLocaleString()} bp
                </div>
              )}
            </div>

            {/* 错误/警告 */}
            {digestResult.errors.length > 0 && (
              <div className="mb-1.5 space-y-0.5">
                {digestResult.errors.map((err, i) => (
                  <div key={i} className="text-[10px] text-amber-700 bg-amber-100 rounded px-2 py-1 flex items-start gap-1">
                    <AlertTriangle size={10} className="mt-0.5 flex-shrink-0" /> {err}
                  </div>
                ))}
              </div>
            )}

            {/* 片段列表 */}
            {!hasResult ? (
              <div className="text-[10px] text-slate-400 py-4 text-center">
                选择酶后自动分析酶切片段
              </div>
            ) : (
              <div className="max-h-[200px] overflow-auto">
                <table className="w-full text-[10px]">
                  <thead className="text-slate-500 bg-slate-100 sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">#</th>
                      <th className="px-2 py-1 text-left font-medium">片段</th>
                      <th className="px-2 py-1 text-right font-medium">长度 (bp)</th>
                      <th className="px-2 py-1 text-left font-medium">位置</th>
                    </tr>
                  </thead>
                  <tbody>
                    {digestResult.fragments.map((f, i) => (
                      <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                        <td className="px-2 py-1 font-mono text-slate-700">
                          Fragment {i + 1}
                        </td>
                        <td className="px-2 py-1 text-right font-mono text-rose-700 font-bold">
                          {f.length.toLocaleString()}
                        </td>
                        <td className="px-2 py-1 font-mono text-slate-500">
                          {f.start + 1} → {f.end}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 查看模拟电泳按钮 */}
            {hasResult && (
              <button onClick={() => setShowGel(true)}
                className="mt-2 w-full py-1.5 bg-orange-600 text-white text-xs font-medium rounded hover:bg-orange-700 flex items-center justify-center gap-1.5">
                <Beaker size={12} /> 查看模拟电泳
              </button>
            )}
          </div>

          {/* 凝胶电泳预览区 */}
          {showGel && hasResult ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 bg-orange-50">
                <span className="text-xs font-medium text-orange-700">凝胶预览 · {selectedEnzymes.map(e => e.name).join(' + ')}</span>
                <button onClick={() => setShowGel(false)} className="text-[10px] text-slate-500 hover:text-slate-700">
                  收起
                </button>
              </div>
              <GelElectrophoresis
                key={gelLanes.map(l => l.fragments.map(f => f.size).join(',')).join('|')}
                initialLanes={gelLanes}
                className="flex-1 min-h-0"
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-slate-400 p-4">
              <div className="text-center">
                <Beaker size={32} className="mx-auto mb-2 text-slate-300" />
                <div>点击"查看模拟电泳"打开凝胶图谱</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============ 工具函数（内联，避免外部依赖） ============

const IUPAC_MAP: Record<string, string> = {
  a: 'a', t: 't', c: 'c', g: 'g',
  r: '[ag]', y: '[ct]', s: '[gc]', w: '[at]',
  k: '[gt]', m: '[ac]', b: '[cgt]', d: '[agt]',
  h: '[act]', v: '[acg]', n: '[atcg]'
}

function iupacToRegex(seq: string): RegExp {
  const pattern = seq.toLowerCase().split('').map(c => IUPAC_MAP[c] || c).join('')
  return new RegExp(pattern, 'gi')
}

const COMP: Record<string, string> = { a: 't', t: 'a', c: 'g', g: 'c' }
function reverseComplement(seq: string): string {
  return seq.toUpperCase().split('').map(c => (COMP[c.toLowerCase()] || c).toUpperCase()).reverse().join('')
}
