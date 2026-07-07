/**
 * 引物设计面板组件
 * 三种模式 Tab + 参数配置 + Top 20 结果列表 + 保存/标注按钮
 */

import { useState, useCallback } from 'react'
import { FlaskConical, Settings2, Save, Eye, Download, ChevronDown, ChevronUp } from 'lucide-react'
import type { PrimerDesignMode, PrimerDesignParams, DesignedPrimer, PrimerDesignResult } from '../../engine/primer/types'
import { DEFAULT_PRIMER_PARAMS } from '../../engine/primer/types'

interface Props {
  /** 模板序列 */
  templateSeq: string
  /** 选区起始 (0-based) */
  selectionStart: number
  /** 选区结束 (0-based inclusive) */
  selectionEnd: number
  /** 设计状态 */
  status: 'idle' | 'running' | 'done' | 'error'
  /** 设计结果 */
  result: PrimerDesignResult | null
  /** 错误信息 */
  error: string
  /** 触发设计 */
  onDesign: (mode: PrimerDesignMode, params?: Partial<PrimerDesignParams>) => void
  /** 选中的引物对 */
  selectedPair: DesignedPrimer | null
  /** 设置选中引物对 */
  onSelectPair: (pair: DesignedPrimer | null) => void
  /** 在序列上显示引物 */
  onShowOnSequence?: (pair: DesignedPrimer) => void
  /** 保存引物到数据库 */
  onSaveToDatabase?: (pair: DesignedPrimer) => void
  className?: string
}

const MODE_LABELS: Record<PrimerDesignMode, string> = {
  'amplify-region': '扩增选区',
  'within-selection': '选区内片段',
  'flanking-selection': '侧翼扩展'
}

const MODE_DESC: Record<PrimerDesignMode, string> = {
  'amplify-region': '在选区两侧设计引物，PCR扩增覆盖整个选区',
  'within-selection': '在选区内部设计引物，扩增选区内的一段片段',
  'flanking-selection': '在选区外侧设计引物，扩增包含选区的更长片段'
}

export default function PrimerDesignPanel({
  templateSeq, selectionStart, selectionEnd,
  status, result, error,
  onDesign, selectedPair, onSelectPair,
  onShowOnSequence, onSaveToDatabase,
  className = ''
}: Props) {
  const [mode, setMode] = useState<PrimerDesignMode>('amplify-region')
  const [showParams, setShowParams] = useState(false)
  const [params, setParams] = useState<PrimerDesignParams>({ ...DEFAULT_PRIMER_PARAMS })

  const handleDesign = useCallback(() => {
    onDesign(mode, params)
  }, [mode, params, onDesign])

  const hasSelection = selectionEnd > selectionStart

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* 模式选择 */}
      <div className="p-3 border-b border-slate-200">
        <div className="flex gap-1 mb-2">
          {(Object.keys(MODE_LABELS) as PrimerDesignMode[]).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-2 py-1 text-xs rounded flex-1 ${mode === m ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-slate-400">{MODE_DESC[mode]}</p>
        <p className="text-[10px] text-slate-500 mt-1">
          选区: {selectionStart + 1}..{selectionEnd + 1} ({selectionEnd - selectionStart + 1} bp)
        </p>
      </div>

      {/* 参数配置折叠区 */}
      <div className="border-b border-slate-200">
        <button onClick={() => setShowParams(!showParams)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">
          <span className="flex items-center gap-1"><Settings2 size={12} /> 参数配置</span>
          {showParams ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        {showParams && (
          <div className="px-3 pb-3 grid grid-cols-2 gap-2 text-xs">
            <ParamInput label="引物长度" min={params.minLength} max={params.maxLength}
              minLabel="最短" maxLabel="最长"
              onMinChange={v => setParams(p => ({ ...p, minLength: v }))}
              onMaxChange={v => setParams(p => ({ ...p, maxLength: v }))}
              range={[15, 34]} />
            <ParamInput label="Tm (°C)" min={params.minTm} max={params.maxTm}
              minLabel="最低" maxLabel="最高"
              onMinChange={v => setParams(p => ({ ...p, minTm: v }))}
              onMaxChange={v => setParams(p => ({ ...p, maxTm: v }))}
              range={[50, 70]} />
            <ParamInput label="GC (%)" min={params.minGc} max={params.maxGc}
              minLabel="最低" maxLabel="最高"
              onMinChange={v => setParams(p => ({ ...p, minGc: v }))}
              onMaxChange={v => setParams(p => ({ ...p, maxGc: v }))}
              range={[10, 90]} />
            <div>
              <label className="text-[10px] text-slate-500">最佳Tm</label>
              <input type="number" value={params.optimalTm} onChange={e => setParams(p => ({ ...p, optimalTm: Number(e.target.value) }))}
                className="w-full px-2 py-1 border rounded text-xs" min={50} max={70} />
            </div>
            <div>
              <label className="text-[10px] text-slate-500">侧翼范围 (bp)</label>
              <input type="number" value={params.flankRange} onChange={e => setParams(p => ({ ...p, flankRange: Number(e.target.value) }))}
                className="w-full px-2 py-1 border rounded text-xs" min={50} max={2000} />
            </div>
            <div>
              <label className="text-[10px] text-slate-500">最大同聚物</label>
              <input type="number" value={params.maxHomopolymer} onChange={e => setParams(p => ({ ...p, maxHomopolymer: Number(e.target.value) }))}
                className="w-full px-2 py-1 border rounded text-xs" min={3} max={8} />
            </div>
          </div>
        )}
      </div>

      {/* 设计按钮 */}
      <div className="px-3 py-2 border-b border-slate-200">
        <button onClick={handleDesign} disabled={!hasSelection || status === 'running'}
          className="w-full px-3 py-2 bg-violet-600 text-white rounded text-xs font-medium hover:bg-violet-500 disabled:opacity-40 flex items-center justify-center gap-1">
          <FlaskConical size={14} />
          {status === 'running' ? '设计中...' : '开始设计'}
        </button>
        {!hasSelection && <p className="text-[10px] text-amber-500 mt-1">请先在序列中选择一个区域</p>}
      </div>

      {/* 错误信息 */}
      {error && (
        <div className="px-3 py-2 bg-red-50 border-b border-red-100 text-xs text-red-600">{error}</div>
      )}

      {/* 结果列表 */}
      <div className="flex-1 overflow-auto">
        {result && result.pairs.length === 0 && (
          <div className="p-4 text-center text-slate-400 text-xs">未找到满足条件的引物对，请调整参数</div>
        )}
        {result && result.pairs.length > 0 && (
          <div className="p-2 text-[10px] text-slate-500 mb-1 px-3">
            候选: 正向 {result.forwardCandidates} × 反向 {result.reverseCandidates} → Top {result.pairs.length} 对
          </div>
        )}
        {result?.pairs.map((pair, i) => {
          const isSelected = selectedPair === pair
          return (
            <div key={i} onClick={() => onSelectPair(pair)}
              className={`px-3 py-2 border-b border-slate-100 cursor-pointer text-xs hover:bg-violet-50/50
                ${isSelected ? 'bg-violet-50 border-l-2 border-l-violet-500' : ''}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-violet-700">#{i + 1}</span>
                <span className={`font-bold ${pair.pairScore >= 80 ? 'text-emerald-600' : pair.pairScore >= 60 ? 'text-amber-600' : 'text-red-500'}`}>
                  {pair.pairScore}分
                </span>
                <span className="text-slate-400">{pair.productLength} bp</span>
              </div>
              {/* Forward */}
              <div className="bg-slate-50 rounded p-1.5 mb-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">F: {pair.forward.position + 1}</span>
                  <span className="text-[10px] text-slate-400">
                    Tm={pair.forward.tm.toFixed(1)}°C GC={pair.forward.gc.toFixed(0)}%
                  </span>
                </div>
                <div className="font-mono text-[10px] text-slate-700 break-all">{pair.forward.sequence}</div>
              </div>
              {/* Reverse */}
              <div className="bg-slate-50 rounded p-1.5 mb-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">R: {pair.reverse.position + 1}</span>
                  <span className="text-[10px] text-slate-400">
                    Tm={pair.reverse.tm.toFixed(1)}°C GC={pair.reverse.gc.toFixed(0)}%
                  </span>
                </div>
                <div className="font-mono text-[10px] text-slate-700 break-all">{pair.reverse.sequence}</div>
              </div>
              {/* 扣分详情 */}
              {pair.pairScore < 90 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {pair.scoreBreakdown.tmPenalty > 0 && <PenaltyBadge label="Tm" value={pair.scoreBreakdown.tmPenalty} />}
                  {pair.scoreBreakdown.tmDiffPenalty > 0 && <PenaltyBadge label="Tm差" value={pair.scoreBreakdown.tmDiffPenalty} />}
                  {pair.scoreBreakdown.gcPenalty > 0 && <PenaltyBadge label="GC" value={pair.scoreBreakdown.gcPenalty} />}
                  {pair.scoreBreakdown.hairpinPenalty > 0 && <PenaltyBadge label="发夹" value={pair.scoreBreakdown.hairpinPenalty} />}
                  {pair.scoreBreakdown.dimerPenalty > 0 && <PenaltyBadge label="二聚体" value={pair.scoreBreakdown.dimerPenalty} />}
                  {pair.scoreBreakdown.productLengthPenalty > 0 && <PenaltyBadge label="产物长" value={pair.scoreBreakdown.productLengthPenalty} />}
                </div>
              )}
              {/* 操作按钮 */}
              {isSelected && (
                <div className="flex gap-1 mt-2">
                  {onShowOnSequence && (
                    <button onClick={(e) => { e.stopPropagation(); onShowOnSequence(pair) }}
                      className="px-2 py-1 text-[10px] border rounded text-cyan-600 hover:bg-cyan-50 flex items-center gap-0.5">
                      <Eye size={10} /> 在序列上显示
                    </button>
                  )}
                  {onSaveToDatabase && (
                    <button onClick={(e) => { e.stopPropagation(); onSaveToDatabase(pair) }}
                      className="px-2 py-1 text-[10px] border rounded text-emerald-600 hover:bg-emerald-50 flex items-center gap-0.5">
                      <Save size={10} /> 保存到引物库
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ParamInput({ label, min, max, minLabel, maxLabel, onMinChange, onMaxChange, range }: {
  label: string; min: number; max: number; minLabel: string; maxLabel: string
  onMinChange: (v: number) => void; onMaxChange: (v: number) => void; range: [number, number]
}) {
  return (
    <div>
      <label className="text-[10px] text-slate-500">{label}</label>
      <div className="flex gap-1 mt-0.5">
        <input type="number" value={min} onChange={e => onMinChange(Number(e.target.value))}
          className="w-full px-1.5 py-0.5 border rounded text-xs" min={range[0]} max={range[1]} />
        <span className="text-slate-300 self-center">-</span>
        <input type="number" value={max} onChange={e => onMaxChange(Number(e.target.value))}
          className="w-full px-1.5 py-0.5 border rounded text-xs" min={range[0]} max={range[1]} />
      </div>
    </div>
  )
}

function PenaltyBadge({ label, value }: { label: string; value: number }) {
  return (
    <span className="px-1 py-0.5 bg-red-50 text-red-500 rounded text-[9px]">
      {label} -{value.toFixed(1)}
    </span>
  )
}
