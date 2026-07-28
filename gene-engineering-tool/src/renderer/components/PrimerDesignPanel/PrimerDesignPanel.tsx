/**
 * 引物设计面板组件
 * 三种模式 Tab + 参数配置 + Top 20 结果列表 + 保存/标注按钮
 */

import { useState, useCallback, useMemo, useRef, useEffect, memo } from 'react'
import { FlaskConical, Settings2, Save, Eye, Download, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, XCircle, Scissors, Copy, MapPin, Dna, BarChart3, RotateCcw, Sparkles, Thermometer } from 'lucide-react'
import { useLifecycleLog } from '../../hooks/useDebugLog'
import type { PrimerDesignMode, PrimerDesignParams, DesignedPrimer, PrimerDesignResult, FunnelStage, PairingFunnelStage, DiagnosticSuggestion, ScoringWeights } from '../../engine/primer/types'
import { DEFAULT_PRIMER_PARAMS, DEFAULT_SCORING_WEIGHTS, STRICT_ACADEMIC_PARAMS } from '../../engine/primer/types'
import { calcDimerDG, calcHairpinDG } from '../../engine/primer/thermo'
import { COMMON_ENZYMES } from '../../engine/cloning'

interface Props {
  templateSeq: string
  selectionStart: number
  selectionEnd: number
  status: 'idle' | 'running' | 'done' | 'error'
  result: PrimerDesignResult | null
  error: string
  onDesign: (mode: PrimerDesignMode, params?: Partial<PrimerDesignParams>) => void
  selectedPair: DesignedPrimer | null
  onSelectPair: (pair: DesignedPrimer | null) => void
  onShowOnMap?: (pair: DesignedPrimer) => void
  onSaveToDatabase?: (pair: DesignedPrimer) => void
  className?: string
}

const MODE_LABELS: Record<PrimerDesignMode, string> = {
  'amplify-region': '扩增选区',
  'within-selection': '选区内片段',
  'flanking-selection': '侧翼扩展'
}

const MODE_DESC: Record<PrimerDesignMode, string> = {
  'amplify-region': '在选区两端内侧设计引物，PCR扩增产物覆盖整个选区',
  'within-selection': '在选区内部设计引物，扩增选区内的一段片段',
  'flanking-selection': '在选区外侧设计引物，扩增包含选区的更长片段'
}

/** 单个权重滑块行 - memo 避免其他滑块变化时重渲染，本地状态 + RAF 节流向父组件同步 */
const WeightSliderRow = memo(function WeightSliderRow({
  k, label, value, totalW, onChange
}: { k: string; label: string; value: number; totalW: number; onChange: (key: string, v: number) => void }) {
  const [localVal, setLocalVal] = useState(value)
  const rafRef = useRef(0)
  // 外部 value 变化时同步本地状态
  useEffect(() => { setLocalVal(value) }, [value])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value)
    setLocalVal(v)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      onChange(k, v)
      rafRef.current = 0
    })
  }, [k, onChange])

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  const pct = totalW > 0 ? ((localVal / totalW) * 100).toFixed(1) : '0'
  const isIgnored = localVal === 0
  return (
    <div className="flex items-center gap-2">
      <span className={`text-[9px] w-14 shrink-0 ${isIgnored ? 'text-slate-400' : 'text-slate-500'}`}>{label}</span>
      <input type="range" min={0} max={10} step={1}
        value={localVal}
        onChange={handleChange}
        className={`flex-1 h-1 rounded-lg appearance-none cursor-pointer bg-slate-200 ${isIgnored ? 'accent-slate-400' : 'accent-violet-600'}`} />
      <span className={`text-[9px] font-mono w-4 text-right ${isIgnored ? 'text-slate-300' : 'text-slate-600'}`}>{localVal}</span>
      <span className={`text-[8px] w-10 text-right ${isIgnored ? 'text-orange-500 font-medium' : 'text-slate-400'}`}>
        {isIgnored ? '忽略' : `${pct}%`}
      </span>
    </div>
  )
})

export default function PrimerDesignPanel({
  templateSeq, selectionStart, selectionEnd,
  status, result, error,
  onDesign, selectedPair, onSelectPair,
  onShowOnMap, onSaveToDatabase,
  className = ''
}: Props) {
  useLifecycleLog('PrimerDesignPanel', { status, templateLen: templateSeq.length, selectionLen: selectionEnd - selectionStart + 1 })
  const [mode, setMode] = useState<PrimerDesignMode>('amplify-region')
  const [showParams, setShowParams] = useState(false)
  const [params, setParams] = useState<PrimerDesignParams>({ ...DEFAULT_PRIMER_PARAMS })

  const handleDesign = useCallback(() => {
    onDesign(mode, params)
  }, [mode, params, onDesign])

  // 稳定的权重更新回调，避免内联函数破坏 memo
  const handleWeightChange = useCallback((key: string, value: number) => {
    setParams(p => ({ ...p, weights: { ...p.weights, [key]: value } }))
  }, [])

  // 预计算权重总和（避免在 map 内重复计算）
  const totalWeight = useMemo(() => Object.values(params.weights).reduce((s, v) => s + v, 0), [params.weights])

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
        <div className="flex items-center justify-between px-3 py-2">
          <button onClick={() => setShowParams(!showParams)}
            className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-800">
            <Settings2 size={12} /> 参数配置
            {showParams ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {showParams && (
            <div className="flex gap-1">
              <button onClick={() => setParams(p => ({ ...DEFAULT_PRIMER_PARAMS, weights: { ...DEFAULT_SCORING_WEIGHTS } }))}
                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded" title="恢复默认">
                <RotateCcw size={9} /> 默认
              </button>
              <button onClick={() => setParams(p => ({ ...DEFAULT_PRIMER_PARAMS, ...STRICT_ACADEMIC_PARAMS }))}
                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] text-violet-600 hover:text-violet-700 bg-violet-50 hover:bg-violet-100 rounded" title="严格学术级参数预设">
                <Sparkles size={9} /> 高要求
              </button>
            </div>
          )}
        </div>
        {showParams && (
          <div className="px-3 pb-2 space-y-0.5 text-xs max-h-[50vh] overflow-y-auto scrollbar-thin">
            {/* 1. 扩增目标与输出 */}
            <Section title="1. 扩增目标与输出" defaultOpen>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                {mode === 'amplify-region' && (
                  <div className="col-span-2">
                    <p className="text-[9px] text-slate-400">引物紧贴选区边缘，产物大小与选区一致</p>
                  </div>
                )}
                {mode === 'within-selection' && (
                  <>
                    <ParamInput label="产物长度 (bp)" min={params.minProductLength} max={params.maxProductLength}
                      minLabel="最短" maxLabel="最长"
                      onMinChange={v => setParams(p => ({ ...p, minProductLength: v }))}
                      onMaxChange={v => setParams(p => ({ ...p, maxProductLength: v }))}
                      range={[50, 5000]} />
                    <div>
                      <label className="text-[10px] text-slate-500">最佳产物长度</label>
                      <input type="number" value={params.optimalProductLength} onChange={e => setParams(p => ({ ...p, optimalProductLength: Number(e.target.value) }))}
                        className="w-full px-2 py-1 border rounded text-xs" min={50} max={5000} />
                    </div>
                  </>
                )}
                {mode === 'flanking-selection' && (
                  <>
                    <div>
                      <label className="text-[10px] text-slate-500">上游扩展 (bp)</label>
                      <input type="number" value={params.upstreamFlankRange} onChange={e => setParams(p => ({ ...p, upstreamFlankRange: Number(e.target.value) }))}
                        className="w-full px-2 py-1 border rounded text-xs" min={20} max={5000} />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500">下游扩展 (bp)</label>
                      <input type="number" value={params.downstreamFlankRange} onChange={e => setParams(p => ({ ...p, downstreamFlankRange: Number(e.target.value) }))}
                        className="w-full px-2 py-1 border rounded text-xs" min={20} max={5000} />
                    </div>
                    <div className="col-span-2">
                      <p className="text-[9px] text-slate-400">产物长度由侧翼范围决定，无需额外设置</p>
                    </div>
                  </>
                )}
                {mode === 'within-selection' && (
                  <div className="col-span-2">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={params.relaxedProductLength}
                        onChange={e => setParams(p => ({ ...p, relaxedProductLength: e.target.checked }))}
                        className="w-3.5 h-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                      <span className="text-[10px] text-slate-600">平衡引物质量与产物长度</span>
                    </label>
                  </div>
                )}
                <div className="col-span-2">
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-[10px] text-slate-500">返回引物对数</label>
                    <span className="text-[10px] font-mono text-slate-600 font-medium">{params.topN}</span>
                  </div>
                  <input type="range" min={1} max={999} step={1} value={params.topN}
                    onChange={e => setParams(p => ({ ...p, topN: Number(e.target.value) }))}
                    className="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-emerald-600 bg-slate-200" />
                </div>
                <div className="col-span-2">
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-[10px] text-slate-500">引物枚举上限</label>
                    <span className="text-[10px] font-mono text-slate-600 font-medium">{params.maxCandidates}</span>
                  </div>
                  <input type="range" min={40} max={9999} step={10} value={params.maxCandidates}
                    onChange={e => setParams(p => ({ ...p, maxCandidates: Number(e.target.value) }))}
                    className="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-emerald-600 bg-slate-200" />
                </div>
              </div>
            </Section>

            {/* 2. 热力学基础 */}
            <Section title="2. 热力学计算基础">
              <div className="grid grid-cols-3 gap-x-2 gap-y-1">
                <div>
                  <label className="text-[10px] text-slate-500">盐浓度 mM</label>
                  <input type="number" value={params.saltConcentration} onChange={e => setParams(p => ({ ...p, saltConcentration: Number(e.target.value) }))}
                    className="w-full px-2 py-1 border rounded text-xs" min={1} max={500} />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">引物浓度 nM</label>
                  <input type="number" value={params.primerConcentration} onChange={e => setParams(p => ({ ...p, primerConcentration: Number(e.target.value) }))}
                    className="w-full px-2 py-1 border rounded text-xs" min={1} max={5000} />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">自由能温度</label>
                  <input type="number" value={params.freeEnergyTemp} onChange={e => setParams(p => ({ ...p, freeEnergyTemp: Number(e.target.value) }))}
                    className="w-full px-2 py-1 border rounded text-xs" min={0} max={70} />
                </div>
              </div>
            </Section>

            {/* 3. 单引物理化 */}
            <Section title="3. 单引物理化参数" defaultOpen>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                <ParamInput label="引物长度" min={params.minLength} max={params.maxLength}
                  minLabel="最短" maxLabel="最长"
                  onMinChange={v => setParams(p => ({ ...p, minLength: v }))}
                  onMaxChange={v => setParams(p => ({ ...p, maxLength: v }))}
                  range={[15, 34]} />
                <ParamInput label="Tm (°C)" min={params.minTm} max={params.maxTm}
                  minLabel="最低" maxLabel="最高"
                  onMinChange={v => setParams(p => ({ ...p, minTm: v }))}
                  onMaxChange={v => setParams(p => ({ ...p, maxTm: v }))}
                  range={[40, 80]} />
                <ParamInput label="GC (%)" min={params.minGc} max={params.maxGc}
                  minLabel="最低" maxLabel="最高"
                  onMinChange={v => setParams(p => ({ ...p, minGc: v }))}
                  onMaxChange={v => setParams(p => ({ ...p, maxGc: v }))}
                  range={[10, 90]} />
                <div>
                  <label className="text-[10px] text-slate-500">最佳Tm</label>
                  <input type="number" value={params.optimalTm} onChange={e => setParams(p => ({ ...p, optimalTm: Number(e.target.value) }))}
                    className="w-full px-2 py-1 border rounded text-xs" min={40} max={80} />
                </div>
              </div>
            </Section>

            {/* 4. 扩增子属性 */}
            <Section title="4. 扩增子属性">
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                <ParamInput label="扩增子 GC%" min={params.minAmpliconGc} max={params.maxAmpliconGc}
                  minLabel="最低" maxLabel="最高"
                  onMinChange={v => setParams(p => ({ ...p, minAmpliconGc: v }))}
                  onMaxChange={v => setParams(p => ({ ...p, maxAmpliconGc: v }))}
                  range={[0, 100]} />
              </div>
            </Section>

            {/* 5. 引物对兼容性 */}
            <Section title="5. 引物对兼容性">
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                <div>
                  <label className="text-[10px] text-slate-500">Tm 差上限 °C</label>
                  <input type="number" value={params.maxTmDiff} onChange={e => setParams(p => ({ ...p, maxTmDiff: Number(e.target.value) }))}
                    className="w-full px-2 py-1 border rounded text-xs" min={1} max={20} step={0.5} />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">GC 差上限 %</label>
                  <input type="number" value={params.maxGcDiff} onChange={e => setParams(p => ({ ...p, maxGcDiff: Number(e.target.value) }))}
                    className="w-full px-2 py-1 border rounded text-xs" min={1} max={30} step={0.5} />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">二聚体 dG 下限</label>
                  <input type="number" value={params.maxPairDimerDG} onChange={e => setParams(p => ({ ...p, maxPairDimerDG: Number(e.target.value) }))}
                    className="w-full px-2 py-1 border rounded text-xs" min={-30} max={0} step={0.5} />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">3'端 dG 下限</label>
                  <input type="number" value={params.maxPairThreePrimeDG} onChange={e => setParams(p => ({ ...p, maxPairThreePrimeDG: Number(e.target.value) }))}
                    className="w-full px-2 py-1 border rounded text-xs" min={-10} max={0} step={0.5} />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">3'端互补上限</label>
                  <input type="number" value={params.maxPairThreePrimeComplementarity} onChange={e => setParams(p => ({ ...p, maxPairThreePrimeComplementarity: Number(e.target.value) }))}
                    className="w-full px-2 py-1 border rounded text-xs" min={0} max={10} />
                </div>
              </div>
            </Section>

            {/* 6. 二级结构 */}
            <Section title="6. 二级结构">
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                <div>
                  <label className="text-[10px] text-slate-500">最大同聚物</label>
                  <input type="number" value={params.maxHomopolymer} onChange={e => setParams(p => ({ ...p, maxHomopolymer: Number(e.target.value) }))}
                    className="w-full px-2 py-1 border rounded text-xs" min={3} max={8} />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">回文长度上限</label>
                  <input type="number" value={params.maxPalindromeLength} onChange={e => setParams(p => ({ ...p, maxPalindromeLength: Number(e.target.value) }))}
                    className="w-full px-2 py-1 border rounded text-xs" min={4} max={20} />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">发夹 dG 阈值</label>
                  <input type="number" value={params.hairpinThreshold} onChange={e => setParams(p => ({ ...p, hairpinThreshold: Number(e.target.value) }))}
                    className="w-full px-2 py-1 border rounded text-xs" min={-10} max={0} step={0.5} />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">3'端发夹 dG</label>
                  <input type="number" value={params.hairpinThreePrimeDG} onChange={e => setParams(p => ({ ...p, hairpinThreePrimeDG: Number(e.target.value) }))}
                    className="w-full px-2 py-1 border rounded text-xs" min={-5} max={0} step={0.5} />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">自互补上限</label>
                  <input type="number" value={params.maxSelfComplementarity} onChange={e => setParams(p => ({ ...p, maxSelfComplementarity: Number(e.target.value) }))}
                    className="w-full px-2 py-1 border rounded text-xs" min={4} max={12} />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">二聚体 dG 阈值</label>
                  <input type="number" value={params.dimerThreshold} onChange={e => setParams(p => ({ ...p, dimerThreshold: Number(e.target.value) }))}
                    className="w-full px-2 py-1 border rounded text-xs" min={-15} max={0} step={0.5} />
                </div>
                <div className="col-span-2">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={params.enableRestrictionSiteCheck}
                      onChange={e => setParams(p => ({ ...p, enableRestrictionSiteCheck: e.target.checked }))}
                      className="rounded" />
                    <span className="text-[10px] text-slate-600">检查引物内酶切位点</span>
                  </label>
                </div>
              </div>
            </Section>

            {/* 7. 特异性 */}
            <Section title="7. 特异性与唯一性">
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                <label className="flex items-center gap-1.5 text-[10px] text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={params.enableSpecificityCheck}
                    onChange={e => setParams(p => ({ ...p, enableSpecificityCheck: e.target.checked }))}
                    className="rounded" />
                  启用特异性预检
                </label>
                <label className="flex items-center gap-1.5 text-[10px] text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={params.enableInSilicoPcr}
                    onChange={e => setParams(p => ({ ...p, enableInSilicoPcr: e.target.checked }))}
                    className="rounded" />
                  In-silico PCR
                </label>
                <div>
                  <label className="text-[10px] text-slate-500">最大 Off-target</label>
                  <input type="number" value={params.maxOffTargets} onChange={e => setParams(p => ({ ...p, maxOffTargets: Number(e.target.value) }))}
                    className="w-full px-2 py-1 border rounded text-xs" min={0} max={10} disabled={!params.enableSpecificityCheck} />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">相似性阈值 %</label>
                  <input type="number" value={params.similarityThreshold} onChange={e => setParams(p => ({ ...p, similarityThreshold: Number(e.target.value) }))}
                    className="w-full px-2 py-1 border rounded text-xs" min={50} max={100} />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">3'端严格匹配</label>
                  <input type="number" value={params.threePrimeStrictMatch} onChange={e => setParams(p => ({ ...p, threePrimeStrictMatch: Number(e.target.value) }))}
                    className="w-full px-2 py-1 border rounded text-xs" min={0} max={10} />
                  <p className="text-[8px] text-slate-400 mt-0.5">0=不启用</p>
                </div>
              </div>
            </Section>

            {/* 8. 筛选权重 (0=忽略该维度, 1-10=渐进严格度) */}
            <Section title="8. 筛选权重">
              <p className="text-[8px] text-slate-400 mb-1">0 = 完全忽略该维度（不计入评分），10 = 最严格</p>
              <div className="space-y-0.5">
                {([['tm','Tm偏差'],['tmDiff','Tm差异'],['gc','GC偏差'],['gcDiff','GC差异'],['hairpin','发夹'],['dimer','二聚体'],['palindrome','回文'],['homopolymer','同聚物'],['selfComplementarity','自互补'],['threePrime','3\'端'],['gcClamp','GC Clamp'],['specificity','特异性']] as const).map(([key, label]) => (
                  <WeightSliderRow key={key} k={key} label={label}
                    value={params.weights[key]}
                    totalW={totalWeight}
                    onChange={handleWeightChange} />
                ))}
              </div>
            </Section>

            {/* 9. 自定义扩展 */}
            <Section title="9. 自定义扩展">
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-slate-500">正向引物 5'端附加序列</label>
                  <input type="text" value={params.fwdFivePrimeTail} onChange={e => setParams(p => ({ ...p, fwdFivePrimeTail: e.target.value.toUpperCase().replace(/[^ATCG]/g, '') }))}
                    className="w-full px-2 py-1 border rounded text-xs font-mono" placeholder="可选，如酶切位点/标签序列" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">反向引物 5'端附加序列</label>
                  <input type="text" value={params.revFivePrimeTail} onChange={e => setParams(p => ({ ...p, revFivePrimeTail: e.target.value.toUpperCase().replace(/[^ATCG]/g, '') }))}
                    className="w-full px-2 py-1 border rounded text-xs font-mono" placeholder="可选，如酶切位点/标签序列" />
                </div>
              </div>
            </Section>
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

      {/* 双漏斗图 + 配对漏斗 + 诊断建议 */}
      {(result?.fwdFunnel || result?.revFunnel) && result.pairs.length === 0 && (
        <DualFunnelChart fwdFunnel={result.fwdFunnel} revFunnel={result.revFunnel}
          pairingFunnel={result.pairingFunnel}
          diagnostics={result.diagnostics} onApplySuggestion={(key, value) => {
            if (key && value !== undefined) setParams(p => ({ ...p, [key]: value } as PrimerDesignParams))
          }} />
      )}

      {/* 迭代信息 */}
      {result?.iterations && result.iterations.length > 1 && (
        <div className="px-3 py-1.5 bg-blue-50 border-b border-blue-100 text-[10px] text-blue-600 flex items-center gap-1">
          <BarChart3 size={10} />
          {result.pairs.length > 0
            ? `第 ${result.iterationCount} 轮迭代成功（参数放宽后找到 ${result.pairs.length} 对引物）`
            : `经过 ${result.iterations.length} 轮迭代仍未找到引物对`
          }
        </div>
      )}

      {/* 失败诊断建议 */}
      {result?.diagnostics && result.pairs.length === 0 && (
        <div className="px-3 py-2 bg-amber-50 border-b border-amber-100 text-xs max-h-[40vh] overflow-y-auto scrollbar-thin">
          <div className="flex items-center gap-1 text-amber-700 font-medium mb-1">
            <AlertCircle size={12} /> 诊断建议
          </div>
          {result.diagnostics.map((d, i) => (
            <div key={i} className="flex items-start gap-1.5 mb-1 text-amber-600">
              <span className="text-[9px] bg-amber-100 px-1 rounded mt-0.5 shrink-0">{d.filterPercent}%</span>
              <span className="text-[10px]">{d.suggestion}</span>
              {d.paramKey && d.suggestedValue !== undefined && (
                <button onClick={() => setParams(p => ({ ...p, [d.paramKey!]: d.suggestedValue } as PrimerDesignParams))}
                  className="text-[9px] px-1 py-0.5 bg-amber-200 hover:bg-amber-300 rounded text-amber-800 shrink-0">应用</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 结果列表 */}
      <div className="flex-1 overflow-auto">
        {result && result.pairs.length === 0 && !result.failureReasons && (
          <div className="p-4 text-center text-slate-400 text-xs">未找到满足条件的引物对，请调整参数</div>
        )}
        {result && result.pairs.length > 0 && (
          <div className="p-2 text-[10px] text-slate-500 mb-1 px-3">
            候选: 正向 {result.forwardCandidates} × 反向 {result.reverseCandidates} → Top {result.pairs.length} 对
            {result.iterationCount && result.iterationCount > 1 && <span className="ml-1 text-blue-500">(第{result.iterationCount}轮)</span>}
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
                <div className="flex items-center gap-2">
                  <span className={`font-bold ${pair.pcrScore >= 80 ? 'text-emerald-600' : pair.pcrScore >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                    PCR: {pair.pcrScore} ({pair.pcrGrade})
                  </span>
                  <span className="text-slate-300">|</span>
                  <span className={`font-bold ${pair.pairScore >= 80 ? 'text-indigo-600' : pair.pairScore >= 60 ? 'text-amber-600' : 'text-red-500'}`}>
                    评分: {pair.pairScore}
                  </span>
                </div>
                <span className="text-slate-400">{pair.productLength} bp</span>
              </div>
              <div className="text-[9px] text-slate-400 mb-1">
                位置: {pair.productStart + 1}..{pair.productEnd} ({pair.productLength} bp)
              </div>
              <div className="bg-slate-50 rounded p-1.5 mb-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">F: {pair.forward.position + 1}</span>
                  <span className="text-[10px] text-slate-400">Tm={pair.forward.tm.toFixed(1)}°C GC={pair.forward.gc.toFixed(0)}%</span>
                </div>
                <div className="font-mono text-[10px] text-slate-700 break-all">{pair.forward.sequence}</div>
              </div>
              <div className="bg-slate-50 rounded p-1.5 mb-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">R: {pair.reverse.position + 1}</span>
                  <span className="text-[10px] text-slate-400">Tm={pair.reverse.tm.toFixed(1)}°C GC={pair.reverse.gc.toFixed(0)}%</span>
                </div>
                <div className="font-mono text-[10px] text-slate-700 break-all">{pair.reverse.sequence}</div>
              </div>
              {pair.pairScore < 90 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {pair.scoreBreakdown.tmPenalty > 0 && <PenaltyBadge label="Tm" value={pair.scoreBreakdown.tmPenalty} />}
                  {pair.scoreBreakdown.tmDiffPenalty > 0 && <PenaltyBadge label="Tm差" value={pair.scoreBreakdown.tmDiffPenalty} />}
                  {pair.scoreBreakdown.gcPenalty > 0 && <PenaltyBadge label="GC" value={pair.scoreBreakdown.gcPenalty} />}
                  {pair.scoreBreakdown.hairpinPenalty > 0 && <PenaltyBadge label="发夹" value={pair.scoreBreakdown.hairpinPenalty} />}
                  {pair.scoreBreakdown.dimerPenalty > 0 && <PenaltyBadge label="二聚体" value={pair.scoreBreakdown.dimerPenalty} />}
                                    {pair.scoreBreakdown.crossDimerPenalty > 0 && <PenaltyBadge label="交叉二聚" value={pair.scoreBreakdown.crossDimerPenalty} />}
                  {pair.scoreBreakdown.productLengthPenalty > 0 && <PenaltyBadge label="产物长" value={pair.scoreBreakdown.productLengthPenalty} />}
                  {pair.scoreBreakdown.boundaryPenalty > 0 && <PenaltyBadge label="边界" value={pair.scoreBreakdown.boundaryPenalty} />}
                  {pair.scoreBreakdown.selfComplPenalty > 0 && <PenaltyBadge label="自互补" value={pair.scoreBreakdown.selfComplPenalty} />}
                  {pair.scoreBreakdown.threePrimeComplPenalty > 0 && <PenaltyBadge label="3'互补" value={pair.scoreBreakdown.threePrimeComplPenalty} />}
                  {pair.scoreBreakdown.specificityPenalty > 0 && <PenaltyBadge label="特异性" value={pair.scoreBreakdown.specificityPenalty} />}
                  {pair.scoreBreakdown.palindromePenalty > 0 && <PenaltyBadge label="回文" value={pair.scoreBreakdown.palindromePenalty} />}
                </div>
              )}
              <QualityMetrics pair={pair} />
              {isSelected && pair.recommendedPcrConditions && (
                <div className="mt-1.5 p-1.5 bg-amber-50/50 rounded border border-amber-100 text-[9px]">
                  <div className="flex items-center gap-1 text-amber-700 font-medium mb-0.5">
                    <Thermometer size={10} />
                    推荐 PCR 条件
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-slate-600">
                    <span>退火: <b className="text-amber-700">{pair.recommendedPcrConditions.annealingTemp}°C</b></span>
                    <span>延伸: <b>{pair.recommendedPcrConditions.extensionTimeSec}s</b></span>
                    <span>循环: <b>{pair.recommendedPcrConditions.cycles}</b></span>
                    <span>变性: {pair.recommendedPcrConditions.denaturationTemp}°C/{pair.recommendedPcrConditions.denaturationTimeSec}s</span>
                  </div>
                </div>
              )}
              {isSelected && <RestrictionSiteAdder forwardSeq={pair.forward.sequence} reverseSeq={pair.reverse.sequence} />}
              {isSelected && <PcrQualityPanel pair={pair} />}
              {isSelected && (
                <div className="flex gap-1 mt-2">
                  {onShowOnMap && (
                    <button onClick={(e) => { e.stopPropagation(); onShowOnMap(pair) }}
                      className="px-2 py-1 text-[10px] border rounded text-cyan-600 hover:bg-cyan-50 flex items-center gap-0.5">
                      <MapPin size={10} /> 显示在图谱上
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

function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-slate-100 rounded">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-2 py-1 text-[10px] text-slate-600 hover:bg-slate-50 font-medium">
        <span>{title}</span>
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>
      {open && <div className="px-2 pb-1.5">{children}</div>}
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

function QualityMetrics({ pair }: { pair: DesignedPrimer }) {
  const hasSpecificity = pair.specificity !== undefined
  const isSpecific = pair.specificity?.isSpecific ?? true
  return (
    <div className="flex flex-wrap gap-1 mt-1 text-[9px]">
      {pair.forward.gcClamp && pair.reverse.gcClamp ? (
        <span className="px-1 py-0.5 bg-emerald-50 text-emerald-600 rounded flex items-center gap-0.5"><CheckCircle2 size={9} /> GC Clamp</span>
      ) : (
        <span className="px-1 py-0.5 bg-amber-50 text-amber-600 rounded flex items-center gap-0.5"><XCircle size={9} /> GC Clamp</span>
      )}
      <span className="px-1 py-0.5 bg-slate-50 text-slate-500 rounded">Self: {pair.forward.selfComplementarity}/{pair.reverse.selfComplementarity}</span>
      <span className="px-1 py-0.5 bg-slate-50 text-slate-500 rounded">3': {pair.pairThreePrimeComplementarity}</span>
      {hasSpecificity && (
        isSpecific
          ? <span className="px-1 py-0.5 bg-emerald-50 text-emerald-600 rounded flex items-center gap-0.5"><CheckCircle2 size={9} /> 特异</span>
          : <span className="px-1 py-0.5 bg-red-50 text-red-500 rounded flex items-center gap-0.5"><XCircle size={9} /> 非特异</span>
      )}
      {hasSpecificity && (pair.specificity?.fwdOffTargets || pair.specificity?.revOffTargets) && (
        <span className="px-1 py-0.5 bg-amber-50 text-amber-600 rounded">Off-target: {pair.specificity?.fwdOffTargets}/{pair.specificity?.revOffTargets}</span>
      )}
    </div>
  )
}

function RestrictionSiteAdder({ forwardSeq, reverseSeq }: { forwardSeq: string; reverseSeq: string }) {
  const [expanded, setExpanded] = useState(false)
  const [fwdEnzyme, setFwdEnzyme] = useState('')
  const [revEnzyme, setRevEnzyme] = useState('')
  const [protectionBases, setProtectionBases] = useState(4)

  const getModifiedPrimer = (primerSeq: string, enzymeName: string): string => {
    const enzyme = COMMON_ENZYMES.find(e => e.name === enzymeName)
    if (!enzyme) return primerSeq
    const protection = 'GGCC'.slice(0, protectionBases)
    return protection + enzyme.recognition + primerSeq
  }

  const fwdModified = fwdEnzyme ? getModifiedPrimer(forwardSeq, fwdEnzyme) : ''
  const revModified = revEnzyme ? getModifiedPrimer(reverseSeq, revEnzyme) : ''

  return (
    <div className="mt-1.5">
      <button onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
        className="flex items-center gap-1 text-[10px] text-orange-600 hover:text-orange-700">
        <Scissors size={10} /> 添加酶切位点 {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>
      {expanded && (
        <div className="mt-1 p-2 bg-orange-50/50 rounded border border-orange-100 space-y-2" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-slate-500">保护碱基:</span>
            <input type="number" value={protectionBases} min={2} max={6}
              onChange={e => setProtectionBases(Number(e.target.value))}
              className="w-10 px-1 py-0.5 text-[10px] border rounded" />
            <span className="text-[9px] text-slate-400">{'GGCC'.slice(0, protectionBases)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-slate-500 w-6">F:</span>
            <select value={fwdEnzyme} onChange={e => setFwdEnzyme(e.target.value)}
              className="flex-1 px-1 py-0.5 text-[10px] border rounded">
              <option value="">-- 选择限制酶 --</option>
              {COMMON_ENZYMES.map(e => (
                <option key={e.name} value={e.name}>{e.name} ({e.recognition})</option>
              ))}
            </select>
            {fwdModified && (
              <button onClick={() => navigator.clipboard.writeText(fwdModified)}
                className="p-0.5 text-slate-400 hover:text-slate-600" title="复制"><Copy size={10} /></button>
            )}
          </div>
          {fwdModified && (
            <div className="font-mono text-[9px] break-all p-1 bg-white rounded border">
              <span className="text-orange-600">{'GGCC'.slice(0, protectionBases)}</span>
              <span className="text-red-600 font-bold">{COMMON_ENZYMES.find(e => e.name === fwdEnzyme)?.recognition}</span>
              <span className="text-slate-700">{forwardSeq}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-slate-500 w-6">R:</span>
            <select value={revEnzyme} onChange={e => setRevEnzyme(e.target.value)}
              className="flex-1 px-1 py-0.5 text-[10px] border rounded">
              <option value="">-- 选择限制酶 --</option>
              {COMMON_ENZYMES.map(e => (
                <option key={e.name} value={e.name}>{e.name} ({e.recognition})</option>
              ))}
            </select>
            {revModified && (
              <button onClick={() => navigator.clipboard.writeText(revModified)}
                className="p-0.5 text-slate-400 hover:text-slate-600" title="复制"><Copy size={10} /></button>
            )}
          </div>
          {revModified && (
            <div className="font-mono text-[9px] break-all p-1 bg-white rounded border">
              <span className="text-orange-600">{'GGCC'.slice(0, protectionBases)}</span>
              <span className="text-red-600 font-bold">{COMMON_ENZYMES.find(e => e.name === revEnzyme)?.recognition}</span>
              <span className="text-slate-700">{reverseSeq}</span>
            </div>
          )}
          <p className="text-[8px] text-slate-400">结构: [保护碱基] + [酶切识别序列] + [引物序列]</p>
        </div>
      )}
    </div>
  )
}

/** 双漏斗图 + 配对阶段 */
function DualFunnelChart({ fwdFunnel, revFunnel, pairingFunnel, diagnostics, onApplySuggestion }: {
  fwdFunnel?: FunnelStage[]
  revFunnel?: FunnelStage[]
  pairingFunnel?: PairingFunnelStage
  diagnostics?: DiagnosticSuggestion[]
  onApplySuggestion: (key?: keyof PrimerDesignParams, value?: number | boolean) => void
}) {
  return (
    <div className="px-3 py-2 border-b border-slate-200 max-h-[50vh] overflow-y-auto scrollbar-thin">
      <div className="flex items-center gap-1 text-[10px] font-medium text-slate-600 mb-2">
        <BarChart3 size={12} /> 筛选漏斗
      </div>
      <div className="grid grid-cols-2 gap-2">
        {fwdFunnel && <SingleFunnel title="正向引物" funnel={fwdFunnel} color="emerald" />}
        {revFunnel && <SingleFunnel title="反向引物" funnel={revFunnel} color="blue" />}
      </div>
      {/* 配对阶段 - 使用与SingleFunnel相同的柱状图风格 */}
      {pairingFunnel && (() => {
        // 收集所有过滤条件并按数量降序排列
        const filters = [
          { count: pairingFunnel.filteredByProductLength, label: '产物长度', hint: '控制参数: minProductLength / maxProductLength' },
          { count: pairingFunnel.filteredByBoundary, label: '边界贴合', hint: 'amplify-region模式已在枚举阶段保证边界贴合，配对阶段无需过滤。若此项>0说明枚举约束未生效' },
          { count: pairingFunnel.filteredByTmDiff, label: 'Tm 差异', hint: '控制参数: weights.tmDiff + maxTmDiff' },
          { count: pairingFunnel.filteredByGcDiff, label: 'GC 差异', hint: '控制参数: weights.gcDiff + maxGcDiff' },
          { count: pairingFunnel.filteredByDimerDG, label: '二聚体 dG', hint: '控制参数: weights.dimer + maxPairDimerDG' },
          { count: pairingFunnel.filteredByThreePrimeDG, label: '3\'端 dG', hint: '控制参数: weights.threePrime + maxPairThreePrimeDG' },
          { count: pairingFunnel.filteredByAmpliconGc, label: '扩增子 GC', hint: '控制参数: weights.gc + minAmpliconGc / maxAmpliconGc' },
          { count: pairingFunnel.filteredByComplementarity, label: '3\'端互补性', hint: '控制参数: weights.threePrime + maxPairThreePrimeComplementarity' },
          { count: pairingFunnel.filteredByInSilicoPcr, label: 'In-silico PCR', hint: '控制参数: enableInSilicoPcr' },
        ].filter(f => f.count > 0).sort((a, b) => b.count - a.count)
        const maxFiltered = filters.length > 0 ? filters[0].count : 0
        // 计算初始值（总尝试数 - 所有过滤数 = 成功数）
        const passed = pairingFunnel.successfulPairs
        const totalFiltered = filters.reduce((sum, f) => sum + f.count, 0)

        return (
          <div className="mt-2 pt-2 border-t border-slate-100">
            <div className="text-[9px] text-slate-500 mb-1 font-medium">配对阶段 ({passed} 对成功)</div>
            <div className="flex items-center gap-2 text-[9px] mb-1">
              <span className="text-emerald-600">F: {pairingFunnel.validForward}</span>
              <span className="text-slate-300">×</span>
              <span className="text-blue-600">R: {pairingFunnel.validReverse}</span>
              <span className="text-slate-300">=</span>
              <span className="text-slate-500">{pairingFunnel.totalPairs}</span>
            </div>
            {filters.length > 0 ? (
              filters.map((f, i) => {
                const isBottleneck = f.count === maxFiltered && filters.length > 1
                // 使用与SingleFunnel相同的柱状图风格：passed比例
                const remainingAfterThis = Math.max(0, pairingFunnel.totalPairs - filters.slice(0, i + 1).reduce((s, x) => s + x.count, 0))
                const widthPct = Math.max(8, (remainingAfterThis / pairingFunnel.totalPairs) * 100)
                return (
                  <div key={i} className="flex items-center gap-1 mb-0.5" title={f.hint}>
                    <div className="w-16 text-[8px] text-slate-400 text-right shrink-0 truncate">{f.label}</div>
                    <div className="flex-1 relative h-3">
                      <div
                        className={`h-full rounded-sm transition-all ${isBottleneck ? 'bg-red-400' : 'bg-amber-200'}`}
                        style={{ width: `${widthPct}%` }}
                      />
                      <span className="absolute inset-0 flex items-center pl-1 text-[7px] text-slate-600">
                        {remainingAfterThis}
                        <span className="ml-0.5 text-red-400">-{f.count}</span>
                      </span>
                    </div>
                    <span className={`text-[7px] shrink-0 w-8 ${isBottleneck ? 'text-red-500 font-bold' : 'text-slate-400'}`}>
                      {Math.round((f.count / pairingFunnel.totalPairs) * 100)}%
                    </span>
                  </div>
                )
              })
            ) : (
              <div className="text-[8px] text-emerald-500">所有配对均通过筛选</div>
            )}
          </div>
        )
      })()}
      {/* 瓶颈诊断 */}
      {diagnostics && diagnostics.length > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-100">
          {diagnostics.slice(0, 3).map((d, i) => (
            <div key={i} className="flex items-center gap-1 mb-0.5">
              <span className="text-[8px] bg-red-100 text-red-600 px-1 rounded">{d.stage}</span>
              <span className="text-[8px] text-slate-500 truncate flex-1">{d.suggestion}</span>
              {d.paramKey && d.suggestedValue !== undefined && (
                <button onClick={() => onApplySuggestion(d.paramKey, d.suggestedValue)}
                  className="text-[8px] px-1 bg-red-100 hover:bg-red-200 text-red-700 rounded shrink-0">调整</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 单方向漏斗图 */
function SingleFunnel({ title, funnel, color }: { title: string; funnel: FunnelStage[]; color: string }) {
  const maxInput = funnel[0]?.input || 1
  const barColor = color === 'emerald' ? 'bg-emerald-300' : 'bg-blue-300'
  // 每个过滤阶段对应的控制参数提示
  const paramHints: Record<string, string> = {
    '长度过滤': 'minLength / maxLength',
    'Tm 过滤': 'minTm / maxTm + 权重 Tm偏差',
    'GC% 过滤': 'minGc / maxGc + 权重 GC偏差',
    '同聚物过滤': 'maxHomopolymer + 权重 同聚物',
    '互补性过滤': 'maxSelfComplementarity + 权重 自互补',
    '自互补过滤': 'maxSelfComplementarity + 权重 自互补',
    '3\'端互补过滤': 'maxSelfThreePrimeComplementarity + 权重 3\'端',
    '回文过滤': 'maxPalindromeLength + 权重 回文',
    '3\'端发夹过滤': 'hairpinThreePrimeDG + 权重 发夹',
    '特异性过滤': 'maxOffTargets + 权重 特异性',
  }
  return (
    <div>
      <div className="text-[9px] text-slate-500 mb-1 font-medium">{title} ({funnel[funnel.length - 1]?.passed ?? 0})</div>
      {funnel.map((stage, i) => {
        const widthPct = Math.max(8, (stage.passed / maxInput) * 100)
        const isBottleneck = stage.isBottleneck
        const hint = paramHints[stage.label]
        return (
          <div key={i} className="flex items-center gap-1 mb-0.5" title={hint ? `控制参数: ${hint}` : undefined}>
            <div className="w-12 text-[8px] text-slate-400 text-right shrink-0 truncate">{stage.label}</div>
            <div className="flex-1 relative h-3">
              <div
                className={`h-full rounded-sm transition-all ${isBottleneck ? 'bg-red-400' : i === 0 ? barColor : 'bg-emerald-200'}`}
                style={{ width: `${widthPct}%` }}
              />
              <span className="absolute inset-0 flex items-center pl-1 text-[7px] text-slate-600">
                {stage.passed}
                {stage.filtered > 0 && <span className="ml-0.5 text-red-400">-{stage.filtered}</span>}
              </span>
            </div>
            {stage.filterPercent > 0 && (
              <span className={`text-[7px] shrink-0 w-6 ${isBottleneck ? 'text-red-500 font-bold' : 'text-slate-400'}`}>
                {stage.filterPercent}%
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** PCR 质量评估面板（展开时显示 ΔG 明细，摘要分数已在卡片顶部显示） */
function PcrQualityPanel({ pair }: { pair: DesignedPrimer }) {
  const [expanded, setExpanded] = useState(false)

  // 仅展开时才计算 ΔG 明细，摘要分数直接使用 pair.pcrScore
  const details = useMemo(() => {
    if (!expanded) return null
    // 3'端二聚体：仅取两条引物 3'端最后 10bp 计算
    const fwdTail = pair.forward.sequence.substring(Math.max(0, pair.forward.sequence.length - 10))
    const revTail = pair.reverse.sequence.substring(Math.max(0, pair.reverse.sequence.length - 10))
    return {
      fwdSelfDimerDG: calcDimerDG(pair.forward.sequence, pair.forward.sequence),
      revSelfDimerDG: calcDimerDG(pair.reverse.sequence, pair.reverse.sequence),
      heteroDimerDG: calcDimerDG(pair.forward.sequence, pair.reverse.sequence),
      fwdHairpinDG: calcHairpinDG(pair.forward.sequence),
      revHairpinDG: calcHairpinDG(pair.reverse.sequence),
      threePrimeDimerDG: calcDimerDG(fwdTail, revTail),
    }
  }, [pair, expanded])

  const gradeColor = pair.pcrGrade === '优' ? 'text-emerald-600' : pair.pcrGrade === '良' ? 'text-amber-600' : 'text-red-500'

  return (
    <div className="mt-1.5">
      <button onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
        className="flex items-center gap-1 text-[10px] text-indigo-600 hover:text-indigo-700">
        <Dna size={10} />
        PCR 适用性明细: {pair.pcrScore}/100 ({pair.pcrGrade})
        {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>
      {expanded && details && (
        <div className="mt-1 p-2 bg-indigo-50/50 rounded border border-indigo-100 space-y-2" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <span className={`text-sm font-bold ${gradeColor}`}>{pair.pcrScore}</span>
            <span className="text-[9px] text-slate-400">/100</span>
            <span className={`text-xs font-medium ${gradeColor}`}>{pair.pcrGrade}</span>
          </div>
          <div className="space-y-1.5">
            <DimerRow label="F自二聚体" dg={details.fwdSelfDimerDG} seq1={pair.forward.sequence} seq2={pair.forward.sequence} />
            <DimerRow label="R自二聚体" dg={details.revSelfDimerDG} seq1={pair.reverse.sequence} seq2={pair.reverse.sequence} />
            <DimerRow label="交叉二聚体" dg={details.heteroDimerDG} seq1={pair.forward.sequence} seq2={pair.reverse.sequence} />
            <DimerRow label="3'端二聚体" dg={details.threePrimeDimerDG} seq1={pair.forward.sequence.substring(Math.max(0, pair.forward.sequence.length - 10))} seq2={pair.reverse.sequence.substring(Math.max(0, pair.reverse.sequence.length - 10))} isThreePrime />
            <DimerRow label="F发夹" dg={details.fwdHairpinDG} seq1={pair.forward.sequence} seq2={''} isHairpin />
            <DimerRow label="R发夹" dg={details.revHairpinDG} seq1={pair.reverse.sequence} seq2={''} isHairpin />
          </div>
        </div>
      )}
    </div>
  )
}

function DimerRow({ label, dg, seq1, seq2, isHairpin, isThreePrime }: {
  label: string; dg: number; seq1: string; seq2: string; isHairpin?: boolean; isThreePrime?: boolean
}) {
  const [showDiagram, setShowDiagram] = useState(false)
  // 3'端二聚体阈值更严格: -4 kcal/mol (SantaLucia 2004)
  const badThreshold = isThreePrime ? -4 : -6
  const warnThreshold = isThreePrime ? -2 : -3
  const dgColor = dg < badThreshold ? 'text-red-500' : dg < warnThreshold ? 'text-amber-500' : 'text-emerald-600'
  const rating = dg < badThreshold ? '差' : dg < warnThreshold ? '良' : '优'

  const pairs = useMemo(() => {
    if (isHairpin) return calcHairpinPairs(seq1)
    return calcDimerPairs(seq1, seq2)
  }, [seq1, seq2, isHairpin])

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-slate-500 w-14 shrink-0">{label}</span>
        <span className={`text-[10px] font-mono font-bold ${dgColor}`}>{dg.toFixed(1)}</span>
        <span className="text-[9px] text-slate-400">kcal/mol</span>
        <span className={`text-[9px] ${dgColor}`}>{rating}</span>
        {dg < -6 && <span className="text-[8px] px-1 bg-red-100 text-red-600 rounded">警告</span>}
        <button onClick={() => setShowDiagram(!showDiagram)}
          className="text-[8px] px-1 text-indigo-500 hover:text-indigo-700">{showDiagram ? '收起' : '图示'}</button>
      </div>
      {showDiagram && (
        <div className="mt-1 p-1.5 bg-white rounded border" onClick={e => e.stopPropagation()}>
          {isHairpin
            ? <HairpinDiagram seq={seq1} pairs={pairs} />
            : <DimerDiagram seq1={seq1} seq2={seq2} pairs={pairs} />
          }
        </div>
      )}
    </div>
  )
}

function calcDimerPairs(seq1: string, seq2: string): boolean[] {
  const comp: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' }
  const revSeq2 = seq2.split('').reverse()
  const maxLen = Math.max(seq1.length, revSeq2.length)
  const pairs: boolean[] = []
  for (let i = 0; i < maxLen; i++) {
    const a = seq1[i] || ''
    const b = revSeq2[i] || ''
    pairs.push(!!(a && b && comp[a] === b))
  }
  return pairs
}

function calcHairpinPairs(seq: string): boolean[] {
  const comp: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' }
  const n = seq.length
  const minLoop = 4
  let bestStem = 0
  let bestStart = 0
  for (let start = 0; start < n - minLoop - 2; start++) {
    for (let stemLen = 2; stemLen <= Math.min(start + 1, (n - minLoop - start) / 2); stemLen++) {
      const end = n - 1 - (stemLen - 1 - start)
      if (end - (start + stemLen) < minLoop) break
      let matched = 0
      for (let k = 0; k < stemLen; k++) {
        if (comp[seq[start + k]] === seq[end - k]) matched++
      }
      if (matched > bestStem) { bestStem = matched; bestStart = start }
    }
  }
  const pairs: boolean[] = new Array(n).fill(false)
  if (bestStem > 0) {
    for (let stemLen = 2; stemLen <= Math.min(bestStart + 1, (n - minLoop - bestStart) / 2); stemLen++) {
      const end = n - 1 - (stemLen - 1 - bestStart)
      if (end - (bestStart + stemLen) < minLoop) break
      let matched = 0
      for (let k = 0; k < stemLen; k++) {
        if (comp[seq[bestStart + k]] === seq[end - k]) matched++
      }
      if (matched === bestStem) {
        for (let k = 0; k < stemLen; k++) {
          if (comp[seq[bestStart + k]] === seq[end - k]) {
            pairs[bestStart + k] = true
            pairs[end - k] = true
          }
        }
        break
      }
    }
  }
  return pairs
}

function DimerDiagram({ seq1, seq2, pairs }: { seq1: string; seq2: string; pairs: boolean[] }) {
  const revSeq2 = seq2.split('').reverse()
  const maxLen = Math.max(seq1.length, revSeq2.length)
  const cw = 10
  const pad = 20
  const w = maxLen * cw + pad * 2
  const h = 68
  const pairCount = pairs.filter(Boolean).length
  return (
    <svg width={w} height={h} className="block">
      <text x={2} y={14} fontSize={7} fill="#6366f1">5'</text>
      <text x={w - 12} y={14} fontSize={7} fill="#6366f1">3'</text>
      <text x={2} y={56} fontSize={7} fill="#0891b2">3'</text>
      <text x={w - 12} y={56} fontSize={7} fill="#0891b2">5'</text>
      {seq1.split('').map((b, i) => (
        <text key={`s1-${i}`} x={pad + i * cw + cw / 2} y={16} fontSize={8}
          textAnchor="middle" fontFamily="monospace" fill={pairs[i] ? '#059669' : '#64748b'}>{b}</text>
      ))}
      {revSeq2.map((b, i) => (
        <text key={`s2-${i}`} x={pad + i * cw + cw / 2} y={54} fontSize={8}
          textAnchor="middle" fontFamily="monospace" fill={pairs[i] ? '#059669' : '#64748b'}>{b}</text>
      ))}
      {pairs.map((paired, i) => {
        if (!paired) return null
        const x = pad + i * cw + cw / 2
        return <line key={`p-${i}`} x1={x} y1={20} x2={x} y2={44} stroke="#059669" strokeWidth={1.5} opacity={0.7} />
      })}
      <text x={w / 2} y={h - 2} fontSize={7} textAnchor="middle" fill="#94a3b8">{pairCount} 个碱基配对</text>
    </svg>
  )
}

function HairpinDiagram({ seq, pairs }: { seq: string; pairs: boolean[] }) {
  const n = seq.length
  const cw = 10
  const pad = 20
  const w = n * cw + pad * 2
  const h = 50
  const pairCount = pairs.filter(Boolean).length
  const pairedIndices = pairs.reduce<number[]>((acc, v, i) => { if (v) acc.push(i); return acc }, [])
  const stemMin = pairedIndices.length > 0 ? Math.min(...pairedIndices) : -1
  const stemMax = pairedIndices.length > 0 ? Math.max(...pairedIndices) : -1
  return (
    <svg width={w} height={h} className="block">
      <text x={2} y={24} fontSize={7} fill="#6366f1">5'</text>
      <text x={w - 12} y={24} fontSize={7} fill="#6366f1">3'</text>
      {seq.split('').map((b, i) => (
        <text key={i} x={pad + i * cw + cw / 2} y={26} fontSize={8}
          textAnchor="middle" fontFamily="monospace"
          fill={pairs[i] ? '#059669' : '#64748b'}>{b}</text>
      ))}
      {pairs.map((paired, i) => {
        if (!paired) return null
        const partner = pairedIndices.find(j => j !== i && pairs[j] && Math.abs(j - i) > 3)
        if (partner === undefined || partner <= i) return null
        const x1 = pad + i * cw + cw / 2
        const x2 = pad + partner * cw + cw / 2
        const midX = (x1 + x2) / 2
        const arcH = Math.min(18, (x2 - x1) * 0.25)
        return (
          <path key={`arc-${i}`} d={`M${x1},30 Q${midX},${30 + arcH} ${x2},30`}
            fill="none" stroke="#059669" strokeWidth={1} opacity={0.5} />
        )
      })}
      {stemMin >= 0 && (
        <text x={pad + ((stemMin + stemMax) / 2) * cw + cw / 2} y={h - 2}
          fontSize={7} textAnchor="middle" fill="#94a3b8">
          茎: {stemMin + 1}..{stemMax + 1} | {pairCount} 个配对
        </text>
      )}
    </svg>
  )
}
