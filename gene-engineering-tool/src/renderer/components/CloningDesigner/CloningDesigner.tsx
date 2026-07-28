/**
 * CloningDesigner — 克隆策略设计器 (P0)
 * 规格书: optimization-spec.md §2.2.1, 基因工程软件优化规格说明书.md §4.1.1
 *
 * 支持: 限制性酶切克隆 / Gibson Assembly / In-Fusion
 */

import { useState, useMemo, useCallback } from 'react'
import { FlaskConical, Play, AlertTriangle, CheckCircle, XCircle, ChevronDown, Copy, Download, Info } from 'lucide-react'
import {
  COMMON_ENZYMES,
  digestVector,
  ligate,
  simulateGibson,
  simulateInFusion,
  checkEnzymeCompatibility,
  calculateDigestFragments,
  type CloningMethod,
  type CloningResult,
  type EnzymeDef,
  type CloneFragment,
} from '../../engine/cloning'

interface Props {
  /** 预填充的载体序列 */
  vectorSequence?: string
  /** 预填充的插入片段 */
  insertSequence?: string
  className?: string
}

const METHOD_LABELS: Record<CloningMethod, string> = {
  restriction: '限制性酶切克隆',
  gibson: 'Gibson Assembly',
  infusion: 'In-Fusion 克隆'
}

const METHOD_DESC: Record<CloningMethod, string> = {
  restriction: '使用两种限制酶切割载体和插入片段，通过粘性末端连接',
  gibson: '利用 15-40bp 重叠区，通过外切酶/聚合酶/连接酶一步组装多片段',
  infusion: '利用 15bp 重叠区和 In-Fusion 酶实现无缝克隆'
}

export default function CloningDesigner({ vectorSequence = '', insertSequence = '', className = '' }: Props) {
  const [method, setMethod] = useState<CloningMethod>('restriction')
  const [vecSeq, setVecSeq] = useState(vectorSequence)
  const [insSeq, setInsSeq] = useState(insertSequence)
  const [enzyme5Name, setEnzyme5Name] = useState('EcoRI')
  const [enzyme3Name, setEnzyme3Name] = useState('BamHI')
  const [result, setResult] = useState<CloningResult | null>(null)
  const [showEnzymeList5, setShowEnzymeList5] = useState(false)
  const [showEnzymeList3, setShowEnzymeList3] = useState(false)
  const [showMethodMenu, setShowMethodMenu] = useState(false)

  // Gibson 多片段模式
  const [gibsonFragments, setGibsonFragments] = useState<{ name: string; sequence: string; overlap5: string; overlap3: string }[]>([
    { name: '载体', sequence: '', overlap5: '', overlap3: '' },
    { name: '插入片段', sequence: '', overlap5: '', overlap3: '' }
  ])

  const enzyme5 = useMemo(() => COMMON_ENZYMES.find(e => e.name === enzyme5Name) || COMMON_ENZYMES[0], [enzyme5Name])
  const enzyme3 = useMemo(() => COMMON_ENZYMES.find(e => e.name === enzyme3Name) || COMMON_ENZYMES[1], [enzyme3Name])

  // 双酶切兼容性预检
  const compatibility = useMemo(() => {
    if (method !== 'restriction' || !vecSeq || vecSeq.length < 10) return null
    return checkEnzymeCompatibility(enzyme5, enzyme3, vecSeq)
  }, [method, vecSeq, enzyme5, enzyme3])

  // 酶切片段预览
  const digestPreview = useMemo(() => {
    if (method !== 'restriction' || !vecSeq || vecSeq.length < 10) return null
    return calculateDigestFragments(vecSeq, [enzyme5, enzyme3])
  }, [method, vecSeq, enzyme5, enzyme3])

  const handleSimulate = useCallback(() => {
    if (method === 'restriction') {
      const digestResult = digestVector(vecSeq.toUpperCase(), enzyme5, enzyme3)
      if ('error' in digestResult) {
        setResult({
          success: false, method: 'restriction', productSequence: '', productLength: 0,
          fragmentMap: [], junctions: [], warnings: [], errors: [digestResult.error]
        })
        return
      }
      // 检查插入片段是否有匹配的末端
      const result = ligate(
        digestResult.linearizedVector,
        insSeq.toUpperCase(),
        digestResult.fivePrimeOverhang,
        digestResult.threePrimeOverhang,
        digestResult.fivePrimeOverhang, // 插入片段应有匹配的5'突出
        digestResult.threePrimeOverhang, // 插入片段应有匹配的3'突出
      )
      setResult(result)
    } else if (method === 'gibson') {
      const frags: CloneFragment[] = gibsonFragments
        .filter(f => f.sequence.length > 0)
        .map(f => ({
          id: f.name, name: f.name, sequence: f.sequence.toUpperCase(),
          fivePrimeOverlap: f.overlap5 || f.sequence.slice(0, 20).toUpperCase(),
          threePrimeOverlap: f.overlap3 || f.sequence.slice(-20).toUpperCase()
        }))
      const r = simulateGibson(frags)
      setResult(r)
    } else if (method === 'infusion') {
      const r = simulateInFusion(vecSeq.toUpperCase(), insSeq.toUpperCase())
      setResult(r)
    }
  }, [method, vecSeq, insSeq, enzyme5, enzyme3, gibsonFragments])

  const copyProduct = useCallback(() => {
    if (result?.productSequence) { try { navigator.clipboard.writeText(result.productSequence) } catch {} }
  }, [result])

  const downloadGenBank = useCallback(() => {
    if (!result?.productSequence) return
    const header = `LOCUS       CloneProduct    ${result.productLength} bp    DNA     circular\n`
    const seq = result.productSequence.match(/.{1,60}/g)?.join('\n') || result.productSequence
    const features = result.fragmentMap.map(f =>
      `     feature       ${f.start + 1}..${f.end}\n                     /label="${f.name}"`
    ).join('\n')
    const gb = `${header}FEATURES             Location/Qualifiers\n${features}\nORIGIN\n${seq}\n//\n`
    const blob = new Blob([gb], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'clone_product.gb'; a.click()
    URL.revokeObjectURL(url)
  }, [result])

  return (
    <div className={`bg-white rounded-lg border border-slate-200 ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
        <FlaskConical size={18} className="text-blue-500" />
        <h3 className="text-sm font-semibold text-slate-700">克隆策略设计器</h3>
        {/* 方法选择 */}
        <div className="relative ml-auto">
          <button onClick={() => setShowMethodMenu(!showMethodMenu)}
            className="px-3 py-1 text-xs border rounded flex items-center gap-1 hover:bg-slate-50">
            {METHOD_LABELS[method]} <ChevronDown size={10} />
          </button>
          {showMethodMenu && (
            <div className="absolute right-0 top-full mt-1 bg-white border rounded shadow-lg z-50 min-w-[200px]">
              {(['restriction', 'gibson', 'infusion'] as CloningMethod[]).map(m => (
                <button key={m} onClick={() => { setMethod(m); setShowMethodMenu(false); setResult(null) }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 ${method === m ? 'bg-blue-50 text-blue-600' : ''}`}>
                  <div className="font-medium">{METHOD_LABELS[m]}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{METHOD_DESC[m]}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* ===== 限制性酶切克隆 ===== */}
        {method === 'restriction' && (
          <>
            {/* 酶选择 */}
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-[10px] text-slate-400 mb-1 block">5' 端限制酶</label>
                <div className="relative">
                  <button onClick={() => { setShowEnzymeList5(!showEnzymeList5); setShowEnzymeList3(false) }}
                    className="w-full px-2 py-1.5 text-xs border rounded flex items-center justify-between hover:bg-slate-50">
                    <span>{enzyme5.name} ({enzyme5.recognition})</span>
                    <ChevronDown size={10} />
                  </button>
                  {showEnzymeList5 && (
                    <div className="absolute z-50 top-full mt-1 w-full max-h-[200px] overflow-y-auto bg-white border rounded shadow-lg">
                      {COMMON_ENZYMES.map(e => (
                        <button key={e.name} onClick={() => { setEnzyme5Name(e.name); setShowEnzymeList5(false) }}
                          className={`w-full text-left px-2 py-1 text-xs hover:bg-blue-50 ${enzyme5Name === e.name ? 'bg-blue-50' : ''}`}>
                          {e.name} <span className="text-slate-400 ml-1">{e.recognition}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-slate-400 mb-1 block">3' 端限制酶</label>
                <div className="relative">
                  <button onClick={() => { setShowEnzymeList3(!showEnzymeList3); setShowEnzymeList5(false) }}
                    className="w-full px-2 py-1.5 text-xs border rounded flex items-center justify-between hover:bg-slate-50">
                    <span>{enzyme3.name} ({enzyme3.recognition})</span>
                    <ChevronDown size={10} />
                  </button>
                  {showEnzymeList3 && (
                    <div className="absolute z-50 top-full mt-1 w-full max-h-[200px] overflow-y-auto bg-white border rounded shadow-lg">
                      {COMMON_ENZYMES.map(e => (
                        <button key={e.name} onClick={() => { setEnzyme3Name(e.name); setShowEnzymeList3(false) }}
                          className={`w-full text-left px-2 py-1 text-xs hover:bg-blue-50 ${enzyme3Name === e.name ? 'bg-blue-50' : ''}`}>
                          {e.name} <span className="text-slate-400 ml-1">{e.recognition}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 兼容性提示 */}
            {compatibility && (
              <div className={`p-2 rounded text-xs ${compatibility.compatible ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                <div className="flex items-center gap-1">
                  {compatibility.compatible ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                  <span>位点距离: {compatibility.distance}bp</span>
                </div>
                {compatibility.warnings.map((w, i) => <div key={i} className="mt-0.5 text-[10px]">{w}</div>)}
                <div className="text-[10px] mt-1 text-slate-500">{compatibility.bufferRecommendation}</div>
              </div>
            )}

            {/* 片段预览 */}
            {digestPreview && digestPreview.length > 1 && (
              <div className="p-2 bg-slate-50 rounded text-xs">
                <div className="text-[10px] text-slate-400 mb-1">酶切片段预览:</div>
                {digestPreview.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px]">
                    <span className="text-slate-500">#{i + 1}</span>
                    <span>{f.length} bp</span>
                    <div className="flex-1 h-2 bg-slate-200 rounded overflow-hidden">
                      <div className="h-full bg-blue-300" style={{ width: `${(f.length / vecSeq.length) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* 序列输入 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-slate-400 mb-1 block">
              载体序列 ({vecSeq.length} bp)
            </label>
            <textarea value={vecSeq} onChange={e => setVecSeq(e.target.value.replace(/[^a-zA-Z\n]/g, '').replace(/\n/g, ''))}
              placeholder="粘贴载体 DNA 序列..."
              className="w-full h-20 text-[10px] font-mono border rounded p-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-300" />
          </div>
          <div>
            <label className="text-[10px] text-slate-400 mb-1 block">
              {method === 'gibson' ? '片段' : '插入片段'}序列 ({insSeq.length} bp)
            </label>
            <textarea value={insSeq} onChange={e => setInsSeq(e.target.value.replace(/[^a-zA-Z\n]/g, '').replace(/\n/g, ''))}
              placeholder="粘贴插入片段 DNA 序列..."
              className="w-full h-20 text-[10px] font-mono border rounded p-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-300" />
          </div>
        </div>

        {/* Gibson 多片段管理 */}
        {method === 'gibson' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400">组装片段:</span>
              <button onClick={() => setGibsonFragments([...gibsonFragments, {
                name: `片段${gibsonFragments.length + 1}`, sequence: '', overlap5: '', overlap3: ''
              }])}
                className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">
                + 添加片段
              </button>
            </div>
            {gibsonFragments.map((frag, i) => (
              <div key={i} className="flex items-center gap-2 p-2 bg-slate-50 rounded text-xs">
                <input value={frag.name} onChange={e => {
                  const copy = [...gibsonFragments]; copy[i].name = e.target.value; setGibsonFragments(copy)
                }} className="w-16 text-xs border rounded px-1 py-0.5" />
                <input value={frag.sequence.slice(0, 30)} onChange={e => {
                  const copy = [...gibsonFragments]; copy[i].sequence = e.target.value; setGibsonFragments(copy)
                }} placeholder="序列..." className="flex-1 text-[10px] font-mono border rounded px-1 py-0.5" />
                <span className="text-[10px] text-slate-400">{frag.sequence.length} bp</span>
                {gibsonFragments.length > 2 && (
                  <button onClick={() => setGibsonFragments(gibsonFragments.filter((_, j) => j !== i))}
                    className="text-red-400 hover:text-red-600 text-[10px]">×</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 模拟按钮 */}
        <button onClick={handleSimulate}
          disabled={!vecSeq || (!insSeq && method !== 'gibson')}
          className="w-full py-2 bg-blue-500 text-white text-xs font-medium rounded hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
          <Play size={14} /> 模拟克隆
        </button>

        {/* ===== 结果展示 ===== */}
        {result && (
          <div className={`border rounded-lg p-3 ${result.success ? 'border-green-200 bg-green-50/50' : 'border-red-200 bg-red-50/50'}`}>
            <div className="flex items-center gap-2 mb-2">
              {result.success ? <CheckCircle size={16} className="text-green-500" /> : <XCircle size={16} className="text-red-500" />}
              <span className={`text-sm font-medium ${result.success ? 'text-green-700' : 'text-red-700'}`}>
                {result.success ? '克隆模拟成功' : '克隆模拟失败'}
              </span>
              {result.success && <span className="text-xs text-slate-400 ml-auto">{result.productLength} bp</span>}
            </div>

            {/* 错误 */}
            {result.errors.length > 0 && (
              <div className="space-y-1 mb-2">
                {result.errors.map((e, i) => (
                  <div key={i} className="text-[10px] text-red-600 flex items-center gap-1">
                    <XCircle size={10} /> {e}
                  </div>
                ))}
              </div>
            )}

            {/* 警告 */}
            {result.warnings.length > 0 && (
              <div className="space-y-1 mb-2">
                {result.warnings.map((w, i) => (
                  <div key={i} className="text-[10px] text-amber-600 flex items-center gap-1">
                    <AlertTriangle size={10} /> {w}
                  </div>
                ))}
              </div>
            )}

            {/* 构建图谱 */}
            {result.success && (
              <>
                {/* 线性图谱 */}
                <div className="bg-white rounded p-2 mb-2">
                  <div className="text-[10px] text-slate-400 mb-1">构建产物图谱:</div>
                  <div className="relative h-8 bg-slate-100 rounded overflow-hidden">
                    {result.fragmentMap.map((frag, i) => (
                      <div key={i} className="absolute top-0 h-full flex items-center justify-center text-[9px] text-white font-medium border-r border-white/30"
                        style={{
                          left: `${(frag.start / result.productLength) * 100}%`,
                          width: `${((frag.end - frag.start) / result.productLength) * 100}%`,
                          backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][i % 5]
                        }}>
                        {frag.name}
                      </div>
                    ))}
                  </div>
                  {/* 连接位点标注 */}
                  <div className="flex gap-1 mt-1">
                    {result.junctions.map((j, i) => (
                      <span key={i} className={`text-[9px] px-1 py-0.5 rounded ${j.compatible ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {j.type} @{j.position}bp
                      </span>
                    ))}
                  </div>
                </div>

                {/* 片段详情 */}
                <div className="grid grid-cols-2 gap-1 text-[10px]">
                  {result.fragmentMap.map((frag, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][i % 5] }} />
                      <span className="text-slate-600">{frag.name}</span>
                      <span className="text-slate-400">{frag.start + 1}..{frag.end} ({frag.end - frag.start} bp)</span>
                    </div>
                  ))}
                </div>

                {/* 操作按钮 */}
                <div className="flex gap-2 mt-3">
                  <button onClick={copyProduct}
                    className="flex items-center gap-1 px-3 py-1.5 text-[10px] border rounded hover:bg-slate-50">
                    <Copy size={10} /> 复制产物序列
                  </button>
                  <button onClick={downloadGenBank}
                    className="flex items-center gap-1 px-3 py-1.5 text-[10px] border rounded hover:bg-slate-50">
                    <Download size={10} /> 导出 GenBank
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* 帮助信息 */}
        <div className="flex items-start gap-1.5 text-[10px] text-slate-400 pt-2 border-t border-slate-100">
          <Info size={12} className="flex-shrink-0 mt-0.5" />
          <div>
            {method === 'restriction' && '限制性克隆: 选择两种不同的限制酶消化载体，插入片段需带有匹配的粘性末端。酶切位点不应过近（≥10bp）。'}
            {method === 'gibson' && 'Gibson Assembly: 相邻片段需要 15-40bp 的重叠区。所有片段按顺序组装成环形或线性产物。'}
            {method === 'infusion' && "In-Fusion: 载体和插入片段需要 15bp 重叠区。使用 In-Fusion 酶（5'→3'外切酶）实现无缝连接。"}
          </div>
        </div>
      </div>
    </div>
  )
}
