/**
 * 多序列比对可视化组件 (MultiSeqAligner)
 * 功能：
 * - 序列输入管理（添加/删除/粘贴）
 * - ClustalW 比对触发（UPGMA/NJ 树）
 * - 比对结果着色显示
 * - 保守性条形图
 * - 一致性序列
 * - 引导树可视化
 * - 导出 Clustal / FASTA / Newick
 */

import { useState, useMemo, useCallback } from 'react'
import { Play, Download, Trash2, Plus, ChevronDown, ChevronRight, TreePine, AlignLeft, Copy, Info, X } from 'lucide-react'
import { useLifecycleLog } from '../../hooks/useDebugLog'
import { useMSA } from '../../hooks/useMSA'
import { exportMSAToClustal, exportMSAToFasta, type MSAInput, type MSAOutput } from '../../engine/alignment/clustalW'
import { treeToNewick, flattenTree } from '../../engine/alignment/phylogeneticTree'
import type { TreeMethod } from '../../engine/alignment/clustalW'

interface Props {
  /** 预填充序列（可选） */
  initialSequences?: MSAInput[]
  /** 默认序列类型 */
  isProtein?: boolean
  className?: string
}

const BLOCK = 60 // 每行显示字符数
const NAME_WIDTH = 16 // 序列名宽度

/** 核酸着色 */
const NT_COLORS: Record<string, string> = {
  A: '#22c55e', T: '#ef4444', G: '#f59e0b', C: '#3b82f6',
  a: '#22c55e', t: '#ef4444', g: '#f59e0b', c: '#3b82f6'
}

/** 氨基酸性质着色 */
const AA_COLORS: Record<string, string> = {
  // 疏水
  A: '#f59e0b', V: '#f59e0b', I: '#f59e0b', L: '#f59e0b', M: '#f59e0b', F: '#f59e0b', W: '#f59e0b',
  // 极性
  S: '#22c55e', T: '#22c55e', N: '#22c55e', Q: '#22c55e',
  // 正电
  K: '#3b82f6', R: '#3b82f6', H: '#3b82f6',
  // 负电
  D: '#ef4444', E: '#ef4444',
  // 特殊
  C: '#eab308', P: '#a855f7', G: '#ec4899', Y: '#14b8a6'
}

export default function MultiSeqAligner({ initialSequences, isProtein = false, className = '' }: Props) {
  useLifecycleLog('MultiSeqAligner')

  // MSA Worker Hook
  const { result, progress, isRunning, align, cancel, reset: resetMSA, error } = useMSA()

  // 输入管理
  const [sequences, setSequences] = useState<MSAInput[]>(
    initialSequences || [
      { name: 'Seq1', sequence: '' },
      { name: 'Seq2', sequence: '' }
    ]
  )

  // 比对参数
  const [treeMethod, setTreeMethod] = useState<TreeMethod>('upgma')
  const [showParams, setShowParams] = useState(false)

  // 视图状态
  const [showTree, setShowTree] = useState(false)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [showConservation, setShowConservation] = useState(true)

  // 添加序列
  const addSequence = useCallback(() => {
    setSequences(prev => [...prev, { name: `Seq${prev.length + 1}`, sequence: '' }])
  }, [])

  // 删除序列
  const removeSequence = useCallback((idx: number) => {
    setSequences(prev => prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev)
  }, [])

  // 更新序列
  const updateSequence = useCallback((idx: number, field: 'name' | 'sequence', value: string) => {
    setSequences(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
  }, [])

  // 运行比对（通过 Worker）
  const runAlignment = useCallback(() => {
    const valid = sequences.filter(s => s.sequence.trim().length > 0)
    if (valid.length < 2) {
      return
    }
    if (valid.some(s => s.name.trim() === '')) {
      return
    }

    align({
      sequences: valid.map(s => ({ name: s.name.trim(), sequence: s.sequence.trim() })),
      isProtein,
      treeMethod
    })
  }, [sequences, isProtein, treeMethod, align])

  // 导出
  const handleExport = useCallback((format: 'clustal' | 'fasta' | 'newick') => {
    if (!result) return
    let content: string
    let ext: string
    let filename: string

    if (format === 'clustal') {
      content = exportMSAToClustal(result)
      ext = 'aln'
      filename = 'alignment.aln'
    } else if (format === 'fasta') {
      content = exportMSAToFasta(result)
      ext = 'fasta'
      filename = 'alignment.fasta'
    } else {
      content = treeToNewick(result.guideTree)
      ext = 'nwk'
      filename = 'guide_tree.nwk'
    }

    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }, [result])

  // 复制一致性序列
  const copyConsensus = useCallback(() => {
    if (!result) return
    try { navigator.clipboard.writeText(result.consensus.replace(/-/g, '')) } catch {}
  }, [result])

  return (
    <div className={`flex flex-col h-full bg-white ${className}`}>
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-slate-50 flex-wrap">
        <button
          onClick={runAlignment}
          disabled={isRunning || sequences.length < 2}
          className="px-3 py-1.5 bg-violet-600 text-white text-xs font-medium rounded hover:bg-violet-700 disabled:opacity-40 flex items-center gap-1.5"
        >
          <Play size={12} />
          {isRunning ? '比对中...' : '运行比对'}
        </button>

        {isRunning && (
          <button
            onClick={cancel}
            className="px-2 py-1.5 bg-red-500 text-white text-xs font-medium rounded hover:bg-red-600 flex items-center gap-1"
          >
            <X size={12} /> 取消
          </button>
        )}

        <select
          value={treeMethod}
          onChange={e => setTreeMethod(e.target.value as TreeMethod)}
          className="text-xs border rounded px-2 py-1.5"
        >
          <option value="upgma">UPGMA 树</option>
          <option value="nj">Neighbor-Joining</option>
        </select>

        <button onClick={() => setShowParams(!showParams)} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
          {showParams ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          参数
        </button>

        {result && (
          <>
            <div className="flex-1" />
            <button onClick={() => setShowTree(!showTree)}
              className={`text-xs px-2 py-1 border rounded flex items-center gap-1 ${showTree ? 'bg-violet-50 border-violet-300' : 'hover:bg-white'}`}>
              <TreePine size={12} /> 引导树
            </button>
            <button onClick={() => setShowConservation(!showConservation)}
              className={`text-xs px-2 py-1 border rounded ${showConservation ? 'bg-violet-50 border-violet-300' : 'hover:bg-white'}`}>
              保守性
            </button>
            <button onClick={() => handleExport('clustal')} className="text-xs px-2 py-1 border rounded hover:bg-white flex items-center gap-1">
              <Download size={10} /> Clustal
            </button>
            <button onClick={() => handleExport('fasta')} className="text-xs px-2 py-1 border rounded hover:bg-white flex items-center gap-1">
              <Download size={10} /> FASTA
            </button>
            <button onClick={() => handleExport('newick')} className="text-xs px-2 py-1 border rounded hover:bg-white flex items-center gap-1">
              <Download size={10} /> Newick
            </button>
          </>
        )}
      </div>

      {/* 参数面板 */}
      {showParams && (
        <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-xs text-slate-600 flex gap-4 flex-wrap">
          <span>匹配: {isProtein ? 'BLOSUM62' : '+2'}</span>
          <span>错配: {isProtein ? '矩阵' : '-3'}</span>
          <span>Gap开放: {isProtein ? '-10' : '-5'}</span>
          <span>Gap延伸: {isProtein ? '-1' : '-2'}</span>
          <span className="text-amber-700">引导树: {treeMethod.toUpperCase()}</span>
        </div>
      )}

      {/* 进度条 */}
      {isRunning && progress.percent > 0 && (
        <div className="px-3 py-2 bg-violet-50 border-b border-violet-200">
          <div className="flex items-center gap-2 mb-1">
            <div className="flex-1 bg-violet-200 rounded-full h-2 overflow-hidden">
              <div
                className="bg-violet-600 h-full rounded-full transition-all duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <span className="text-xs text-violet-700 font-medium min-w-[3rem] text-right">
              {progress.percent}%
            </span>
          </div>
          <div className="text-[10px] text-violet-600">{progress.message}</div>
        </div>
      )}

      {/* 错误信息 */}
      {error && (
        <div className="px-3 py-2 bg-red-50 border-b border-red-200 text-red-600 text-xs flex items-center gap-2">
          <Info size={12} /> {error}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* 左侧：序列输入 / 比对结果 */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {!result ? (
            /* 序列输入区 */
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {sequences.map((seq, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <input
                    type="text"
                    value={seq.name}
                    onChange={e => updateSequence(i, 'name', e.target.value)}
                    className="w-20 text-xs font-mono border rounded px-2 py-1.5 flex-shrink-0"
                    placeholder="名称"
                  />
                  <textarea
                    value={seq.sequence}
                    onChange={e => updateSequence(i, 'sequence', e.target.value)}
                    className="flex-1 text-xs font-mono border rounded px-2 py-1.5 min-h-[60px] resize-y"
                    placeholder={`粘贴${isProtein ? '蛋白质' : '核酸'}序列...`}
                    rows={3}
                  />
                  {sequences.length > 2 && (
                    <button onClick={() => removeSequence(i)}
                      className="p-1 text-slate-400 hover:text-red-500 flex-shrink-0 mt-1">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              <button onClick={addSequence}
                className="text-xs text-slate-500 hover:text-violet-600 flex items-center gap-1 mt-1">
                <Plus size={12} /> 添加序列
              </button>
            </div>
          ) : (
            /* 比对结果区 */
            <div className="flex-1 overflow-auto p-2 font-mono text-[11px] leading-[15px]">
              {/* 引导树 */}
              {showTree && result.guideTree && (
                <div className="mb-3 p-2 bg-slate-50 rounded border border-slate-200">
                  <div className="text-xs font-sans font-medium text-slate-600 mb-1">引导树 (Guide Tree)</div>
                  <TreeVisualization tree={result.guideTree} />
                  <div className="text-[10px] text-slate-400 mt-1 font-sans break-all">
                    Newick: {treeToNewick(result.guideTree)}
                  </div>
                </div>
              )}

              {/* 统计摘要 */}
              <div className="flex gap-3 text-[10px] text-slate-500 mb-2 font-sans flex-wrap">
                <span>对齐长度: <b className="text-violet-600">{result.stats.totalLength}</b></span>
                <span>平均一致性: <b className="text-emerald-600">{result.stats.meanIdentity}%</b></span>
                <span>Gap比例: <b>{result.stats.gapRatio}%</b></span>
                <span>序列数: <b>{result.alignedSequences.length}</b></span>
              </div>

              {/* 比对块 */}
              {(() => {
                const len = result.stats.totalLength
                const blocks: JSX.Element[] = []
                for (let start = 0; start < len; start += BLOCK) {
                  const end = Math.min(start + BLOCK, len)
                  blocks.push(
                    <div key={start} className="mb-3">
                      {result.alignedSequences.map((seq, si) => (
                        <div key={si} className="flex">
                          <span className="text-slate-500 flex-shrink-0" style={{ width: `${NAME_WIDTH * 6}px` }}>
                            {seq.name.substring(0, NAME_WIDTH).padEnd(NAME_WIDTH)}
                          </span>
                          <span className="flex-1">
                            {seq.sequence.substring(start, end).split('').map((c, j) => (
                              <span key={j} style={{ color: getColor(c, isProtein) }}>
                                {c === '-' ? '\u00B7' : c}
                              </span>
                            ))}
                          </span>
                        </div>
                      ))}
                      {/* 一致性行 */}
                      <div className="flex">
                        <span className="text-emerald-600 flex-shrink-0" style={{ width: `${NAME_WIDTH * 6}px` }}>
                          {'Consensus'.padEnd(NAME_WIDTH)}
                        </span>
                        <span className="flex-1 text-emerald-700">
                          {result.consensus.substring(start, end)}
                        </span>
                      </div>
                      {/* 保守性标记行 */}
                      <div className="flex">
                        <span className="flex-shrink-0" style={{ width: `${NAME_WIDTH * 6}px` }} />
                        <span className="flex-1">
                          {result.conservation.slice(start, end).map((v, j) => (
                            <span key={j} className={
                              v >= 0.9 ? 'text-emerald-500' : v >= 0.7 ? 'text-amber-500' : v >= 0.5 ? 'text-slate-400' : 'text-slate-200'
                            }>
                              {v >= 0.9 ? '*' : v >= 0.7 ? ':' : v >= 0.5 ? '.' : ' '}
                            </span>
                          ))}
                        </span>
                      </div>
                    </div>
                  )
                }
                return blocks
              })()}

              {/* 保守性条形图 */}
              {showConservation && result.stats.totalLength > 0 && (
                <div className="mt-3 p-2 bg-slate-50 rounded border border-slate-200">
                  <div className="text-xs font-sans font-medium text-slate-600 mb-1">保守性分布</div>
                  <ConservationBar conservation={result.conservation} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 底部：重置按钮 */}
      {result && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-slate-200 bg-slate-50">
          <button onClick={() => resetMSA()}
            className="text-xs text-slate-500 hover:text-violet-600 flex items-center gap-1">
            <AlignLeft size={12} /> 修改输入
          </button>
          <button onClick={copyConsensus}
            className="text-xs text-slate-500 hover:text-violet-600 flex items-center gap-1">
            <Copy size={12} /> 复制一致性序列
          </button>
          <div className="flex-1" />
          <button onClick={() => { resetMSA(); setSequences([{ name: 'Seq1', sequence: '' }, { name: 'Seq2', sequence: '' }]) }}
            className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
            <Trash2 size={12} /> 清除
          </button>
        </div>
      )}
    </div>
  )
}

// ============ 着色 ============

function getColor(c: string, isProtein: boolean): string {
  if (c === '-') return '#cbd5e1'
  if (isProtein) return AA_COLORS[c.toUpperCase()] || '#64748b'
  return NT_COLORS[c] || '#64748b'
}

// ============ 保守性条形图 ============

function ConservationBar({ conservation }: { conservation: number[] }) {
  const width = Math.min(800, conservation.length * 2)
  const height = 40
  const barW = Math.max(1, width / conservation.length)

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      {conservation.map((v, i) => (
        <rect
          key={i}
          x={i * barW}
          y={height * (1 - v)}
          width={Math.max(1, barW - 0.5)}
          height={height * v}
          fill={v >= 0.9 ? '#22c55e' : v >= 0.7 ? '#f59e0b' : v >= 0.5 ? '#94a3b8' : '#e2e8f0'}
        />
      ))}
      {/* 基线 */}
      <line x1={0} y1={height} x2={width} y2={height} stroke="#94a3b8" strokeWidth={0.5} />
    </svg>
  )
}

// ============ 引导树简易可视化 ============

function TreeVisualization({ tree }: { tree: any }) {
  const flat = useMemo(() => flattenTree(tree), [tree])
  const leaves = flat.filter(n => n.isLeaf)
  if (leaves.length === 0) return null

  const maxX = Math.max(...flat.map(n => n.x)) || 1
  const minY = Math.min(...flat.map(n => n.y))
  const maxY = Math.max(...flat.map(n => n.y))
  const yRange = maxY - minY || 1

  const svgW = 300
  const svgH = Math.max(60, leaves.length * 20)
  const padL = 10, padR = 80
  const plotW = svgW - padL - padR

  const toSvgX = (x: number) => padL + (maxX > 0 ? (x / maxX) * plotW : 0)
  const toSvgY = (y: number) => 10 + ((y - minY) / yRange) * (svgH - 20)

  return (
    <svg width={svgW} height={svgH} className="block">
      {/* 分支线 */}
      {flat.filter(n => n.parentId !== undefined).map(n => {
        const parent = flat.find(p => p.id === n.parentId)
        if (!parent) return null
        const px = toSvgX(parent.x)
        const py = toSvgY(parent.y)
        const cx = toSvgX(n.x)
        const cy = toSvgY(n.y)
        return (
          <g key={`b-${n.id}`}>
            <line x1={px} y1={py} x2={px} y2={cy} stroke="#94a3b8" strokeWidth={1} />
            <line x1={px} y1={cy} x2={cx} y2={cy} stroke="#94a3b8" strokeWidth={1} />
          </g>
        )
      })}
      {/* 叶标签 */}
      {leaves.map(n => (
        <text key={`l-${n.id}`} x={toSvgX(n.x) + 4} y={toSvgY(n.y) + 3}
          className="text-[10px] fill-slate-700 font-mono">
          {n.label}
        </text>
      ))}
    </svg>
  )
}
