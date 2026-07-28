/**
 * ProteinAnalysisPanel — 蛋白质理化性质分析面板 (P1)
 * 规格书: optimization-spec.md §2.2.4, 基因工程软件优化规格说明书.md §4.1
 *
 * 功能: MW/pI/疏水性图/氨基酸组成/脂肪族指数/GRAVY
 */

import { useState, useMemo } from 'react'
import { Dna, Activity, ChevronDown, ChevronUp, Copy } from 'lucide-react'
import { analyzeProtein, translateDNA, type ProteinAnalysisResult } from '../../engine/protein'

interface Props {
  /** DNA 序列（可选，用于翻译） */
  dnaSequence?: string
  /** 直接输入蛋白质序列 */
  proteinSequence?: string
  className?: string
}

export default function ProteinAnalysisPanel({ dnaSequence = '', proteinSequence = '', className = '' }: Props) {
  const [inputSeq, setInputSeq] = useState(proteinSequence)
  const [inputMode, setInputMode] = useState<'protein' | 'dna'>('protein')
  const [frame, setFrame] = useState(0)
  const [showComposition, setShowComposition] = useState(false)

  // 翻译或分析
  const result = useMemo(() => {
    let seq = inputSeq
    if (inputMode === 'dna') {
      seq = translateDNA(dnaSequence || inputSeq, frame)
    }
    if (!seq || seq.length < 2) return null
    return analyzeProtein(seq)
  }, [inputSeq, inputMode, dnaSequence, frame])

  return (
    <div className={`bg-white rounded-lg border border-slate-200 ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
        <Activity size={18} className="text-indigo-500" />
        <h3 className="text-sm font-semibold text-slate-700">蛋白质分析</h3>
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => setInputMode('protein')}
            className={`px-2 py-0.5 text-[10px] rounded ${inputMode === 'protein' ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
            蛋白质
          </button>
          <button onClick={() => setInputMode('dna')}
            className={`px-2 py-0.5 text-[10px] rounded ${inputMode === 'dna' ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
            DNA翻译
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* 输入区 */}
        {inputMode === 'protein' ? (
          <textarea value={inputSeq} onChange={e => setInputSeq(e.target.value.replace(/[^a-zA-Z\n*]/g, '').replace(/\n/g, ''))}
            placeholder="粘贴蛋白质序列（单字母氨基酸代码）..."
            className="w-full h-16 text-[10px] font-mono border rounded p-2 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-300" />
        ) : (
          <div className="space-y-2">
            <textarea value={inputSeq} onChange={e => setInputSeq(e.target.value.replace(/[^a-zA-Z\n]/g, '').replace(/\n/g, ''))}
              placeholder="粘贴 DNA 序列..."
              className="w-full h-16 text-[10px] font-mono border rounded p-2 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-300" />
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-slate-500">阅读框:</span>
              {[0, 1, 2].map(f => (
                <button key={f} onClick={() => setFrame(f)}
                  className={`px-2 py-0.5 rounded ${frame === f ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-50 text-slate-500'}`}>
                  +{f + 1}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 结果 */}
        {result ? (
          <div className="space-y-3">
            {/* 核心参数卡片 */}
            <div className="grid grid-cols-2 gap-2">
              <MetricCard label="分子量 (MW)" value={`${formatMW(result.molecularWeight)}`} unit="Da" />
              <MetricCard label="等电点 (pI)" value={result.isoelectricPoint.toFixed(2)} />
              <MetricCard label="氨基酸数" value={String(result.length)} />
              <MetricCard label="GRAVY" value={result.gravy.toFixed(3)} />
            </div>

            {/* 稳定性指标 */}
            <div className="p-2 bg-slate-50 rounded text-[10px] space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">不稳定指数:</span>
                <span className={result.instabilityIndex > 40 ? 'text-red-600 font-medium' : 'text-green-600'}>
                  {result.instabilityIndex.toFixed(1)} {result.instabilityIndex > 40 ? '(不稳定)' : '(稳定)'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">脂肪族指数:</span>
                <span className="text-slate-700">{result.aliphaticIndex.toFixed(1)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">净电荷 (pH 7):</span>
                <span className="text-slate-700">+{result.totalPositiveCharge} / -{result.totalNegativeCharge}</span>
              </div>
            </div>

            {/* 疏水性图 */}
            <div>
              <div className="text-[10px] text-slate-400 mb-1">Kyte-Doolittle 疏水性 (窗口=7)</div>
              <HydrophobicityPlot data={result.hydrophobicity} width={340} height={80} />
            </div>

            {/* 氨基酸组成 */}
            <div>
              <button onClick={() => setShowComposition(!showComposition)}
                className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-700">
                氨基酸组成 {showComposition ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              </button>
              {showComposition && (
                <div className="mt-1 grid grid-cols-5 gap-1 text-[9px]">
                  {Object.entries(result.compositionPercent)
                    .sort((a, b) => b[1] - a[1])
                    .map(([aa, pct]) => (
                      <div key={aa} className="flex items-center gap-1 p-1 bg-slate-50 rounded">
                        <span className="font-mono font-bold text-indigo-600">{aa}</span>
                        <span className="text-slate-400">{result.composition[aa]}</span>
                        <span className="text-slate-500 ml-auto">{pct}%</span>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* 翻译后的蛋白质序列 */}
            {inputMode === 'dna' && (
              <div className="p-2 bg-indigo-50 rounded text-[9px]">
                <div className="text-indigo-400 mb-0.5">翻译产物 ({result.length} aa):</div>
                <div className="font-mono text-indigo-700 break-all max-h-16 overflow-auto">{result.sequence}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center text-slate-400 text-xs py-8">
            {inputMode === 'protein' ? '请输入蛋白质序列' : '请输入 DNA 序列并选择阅读框'}
          </div>
        )}
      </div>
    </div>
  )
}

// ============ 子组件 ============

function MetricCard({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="p-2 bg-white border rounded">
      <div className="text-[9px] text-slate-400">{label}</div>
      <div className="text-sm font-bold text-slate-700">
        {value}
        {unit && <span className="text-[10px] text-slate-400 ml-1">{unit}</span>}
      </div>
    </div>
  )
}

function HydrophobicityPlot({ data, width, height }: { data: number[]; width: number; height: number }) {
  if (data.length === 0) return <div className="text-[10px] text-slate-400">无数据</div>

  const maxVal = Math.max(...data.map(Math.abs), 0.1)
  const midY = height / 2
  const stepX = data.length > 1 ? width / (data.length - 1) : width

  // 构建 SVG path
  let path = ''
  for (let i = 0; i < data.length; i++) {
    const x = i * stepX
    const y = midY - (data[i] / maxVal) * (midY - 4)
    path += (i === 0 ? 'M' : 'L') + `${x.toFixed(1)},${y.toFixed(1)} `
  }

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="border rounded bg-white">
      {/* 零线 */}
      <line x1={0} y1={midY} x2={width} y2={midY} stroke="#e2e8f0" strokeWidth={0.5} strokeDasharray="3,3" />
      {/* 正区域填充 */}
      <path d={`${path} L${width},${midY} L0,${midY} Z`} fill="#3b82f6" opacity={0.1} />
      {/* 线 */}
      <path d={path} fill="none" stroke="#3b82f6" strokeWidth={1} />
      {/* 标签 */}
      <text x={2} y={10} fontSize={8} fill="#94a3b8">疏水</text>
      <text x={2} y={height - 2} fontSize={8} fill="#94a3b8">亲水</text>
    </svg>
  )
}

// ============ 工具函数 ============

function formatMW(mw: number): string {
  if (mw >= 1000000) return (mw / 1000000).toFixed(1) + 'M'
  if (mw >= 1000) return (mw / 1000).toFixed(1) + 'k'
  return mw.toFixed(0)
}
