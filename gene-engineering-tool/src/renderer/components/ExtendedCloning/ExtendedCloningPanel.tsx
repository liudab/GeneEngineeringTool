/**
 * 扩展克隆与定点诱变面板
 * 整合 Golden Gate / TA / TOPO / Gateway BP-LR / 定点诱变
 */

import { useState, useCallback } from 'react'
import { FlaskConical, Scissors, GitBranch, Dna, AlertCircle, Check, Copy, Play } from 'lucide-react'
import { useLifecycleLog } from '../../hooks/useDebugLog'
import {
  simulateGoldenGate, simulateTACloning, simulateTOPOCloning,
  simulateGatewayBP, simulateGatewayLR, simulateMutagenesis,
  type GoldenGateResult, type TACloneResult, type TOPOCloneResult,
  type GatewayResult, type MutagenesisResult
} from '../../engine/cloning/extendedCloning'

type PanelMode = 'golden-gate' | 'ta' | 'topo' | 'gateway' | 'mutagenesis'

interface Props {
  /** 当前载体序列 */
  vectorSequence?: string
  className?: string
}

const MODES: { value: PanelMode; label: string; icon: any; desc: string }[] = [
  { value: 'golden-gate', label: 'Golden Gate', icon: Scissors, desc: 'Type IIS 酶切 + 4bp 突出组装' },
  { value: 'ta', label: 'TA 克隆', icon: Dna, desc: 'Taq A-tail + T-vector' },
  { value: 'topo', label: 'TOPO 克隆', icon: FlaskConical, desc: '拓扑异构酶介导连接' },
  { value: 'gateway', label: 'Gateway', icon: GitBranch, desc: 'BP/LR 重组克隆' },
  { value: 'mutagenesis', label: '定点诱变', icon: Scissors, desc: '位点特异性突变' },
]

export default function ExtendedCloningPanel({ vectorSequence, className = '' }: Props) {
  useLifecycleLog('ExtendedCloningPanel')
  const [mode, setMode] = useState<PanelMode>('golden-gate')

  // Golden Gate 状态
  const [ggFragments, setGgFragments] = useState<{ name: string; sequence: string; fivePrimeOverhang: string; threePrimeOverhang: string }[]>([
    { name: 'Fragment 1', sequence: '', fivePrimeOverhang: 'GGAG', threePrimeOverhang: 'AATG' },
    { name: 'Fragment 2', sequence: '', fivePrimeOverhang: 'AATG', threePrimeOverhang: 'GGAG' },
  ])
  const [ggResult, setGgResult] = useState<GoldenGateResult | null>(null)

  // TA/TOPO 状态
  const [taInsert, setTaInsert] = useState('')
  const [taVector, setTaVector] = useState('')
  const [topoType, setTopoType] = useState<'TA' | 'Blunt'>('TA')
  const [taResult, setTaResult] = useState<TACloneResult | null>(null)
  const [topoResult, setTopoResult] = useState<TOPOCloneResult | null>(null)

  // Gateway 状态
  const [gwType, setGwType] = useState<'BP' | 'LR'>('BP')
  const [gwInsert, setGwInsert] = useState('')
  const [gwVector, setGwVector] = useState('')
  const [gwResult, setGwResult] = useState<GatewayResult | null>(null)

  // Mutagenesis 状态
  const [mutTemplate, setMutTemplate] = useState('')
  const [mutPosition, setMutPosition] = useState(0)
  const [mutType, setMutType] = useState<'substitution' | 'insertion' | 'deletion'>('substitution')
  const [mutSequence, setMutSequence] = useState('')
  const [mutDelLen, setMutDelLen] = useState(1)
  const [mutResult, setMutResult] = useState<MutagenesisResult | null>(null)

  // 运行 Golden Gate
  const runGoldenGate = useCallback(() => {
    const result = simulateGoldenGate(ggFragments)
    setGgResult(result)
  }, [ggFragments])

  // 运行 TA 克隆
  const runTA = useCallback(() => {
    const result = simulateTACloning(taInsert, taVector || vectorSequence || '')
    setTaResult(result)
  }, [taInsert, taVector, vectorSequence])

  // 运行 TOPO
  const runTOPO = useCallback(() => {
    const result = simulateTOPOCloning(taInsert, taVector || vectorSequence || '', topoType)
    setTopoResult(result)
  }, [taInsert, taVector, vectorSequence, topoType])

  // 运行 Gateway
  const runGateway = useCallback(() => {
    const result = gwType === 'BP'
      ? simulateGatewayBP(gwInsert, gwVector || vectorSequence || '')
      : simulateGatewayLR(gwInsert, gwVector || vectorSequence || '')
    setGwResult(result)
  }, [gwType, gwInsert, gwVector, vectorSequence])

  // 运行定点诱变
  const runMutagenesis = useCallback(() => {
    const result = simulateMutagenesis(
      mutTemplate || vectorSequence || '',
      mutPosition, mutSequence, mutType, mutDelLen
    )
    setMutResult(result)
  }, [mutTemplate, vectorSequence, mutPosition, mutSequence, mutType, mutDelLen])

  // 复制结果序列
  const copySeq = useCallback((seq: string) => {
    try { navigator.clipboard.writeText(seq) } catch {}
  }, [])

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* 模式切换 */}
      <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-slate-200 bg-slate-50">
        {MODES.map(m => (
          <button key={m.value} onClick={() => setMode(m.value)}
            className={`px-2 py-1 text-[10px] rounded border flex items-center gap-1 transition-colors ${
              mode === m.value ? 'bg-violet-100 text-violet-700 border-violet-300' : 'text-slate-500 hover:bg-white'
            }`}>
            <m.icon size={10} /> {m.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* ============ Golden Gate ============ */}
        {mode === 'golden-gate' && (
          <>
            <div className="text-xs text-slate-500 bg-amber-50 p-2 rounded">
              Golden Gate 使用 Type IIS 限制酶（如 BsaI）产生 4bp 突出，多片段按顺序组装。
            </div>
            {ggFragments.map((f, i) => (
              <div key={i} className="border rounded p-2 space-y-1">
                <div className="flex items-center gap-2">
                  <input type="text" value={f.name} onChange={e => {
                    const updated = [...ggFragments]; updated[i] = { ...updated[i], name: e.target.value }; setGgFragments(updated)
                  }} className="flex-1 text-xs font-medium border-b border-transparent hover:border-slate-300 bg-transparent" />
                  <span className="text-[10px] text-slate-400">{f.sequence.length} bp</span>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] text-slate-400">5' Overhang (4bp)</label>
                    <input type="text" value={f.fivePrimeOverhang} maxLength={4}
                      onChange={e => { const updated = [...ggFragments]; updated[i] = { ...updated[i], fivePrimeOverhang: e.target.value.toUpperCase() }; setGgFragments(updated) }}
                      className="w-full text-xs font-mono border rounded px-1 py-0.5" />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-slate-400">3' Overhang (4bp)</label>
                    <input type="text" value={f.threePrimeOverhang} maxLength={4}
                      onChange={e => { const updated = [...ggFragments]; updated[i] = { ...updated[i], threePrimeOverhang: e.target.value.toUpperCase() }; setGgFragments(updated) }}
                      className="w-full text-xs font-mono border rounded px-1 py-0.5" />
                  </div>
                </div>
                <textarea value={f.sequence} onChange={e => {
                  const updated = [...ggFragments]; updated[i] = { ...updated[i], sequence: e.target.value }; setGgFragments(updated)
                }} className="w-full text-xs font-mono border rounded px-2 py-1 min-h-[40px]" placeholder="片段序列..." rows={2} />
              </div>
            ))}
            <button onClick={() => setGgFragments([...ggFragments, { name: `Fragment ${ggFragments.length + 1}`, sequence: '', fivePrimeOverhang: 'GGAG', threePrimeOverhang: 'AATG' }])}
              className="text-xs text-slate-500 hover:text-violet-600">+ 添加片段</button>
            <button onClick={runGoldenGate}
              className="w-full px-3 py-1.5 bg-violet-600 text-white text-xs rounded hover:bg-violet-700 flex items-center justify-center gap-1">
              <Play size={12} /> 模拟 Golden Gate
            </button>
            {ggResult && <ResultCard success={ggResult.success} length={ggResult.productLength}
              warnings={ggResult.warnings} errors={ggResult.errors} onCopy={() => copySeq(ggResult.productSequence)} />}
          </>
        )}

        {/* ============ TA 克隆 ============ */}
        {mode === 'ta' && (
          <>
            <div className="text-xs text-slate-500 bg-green-50 p-2 rounded">
              TA 克隆利用 Taq 聚合酶 PCR 产物 3' 端的 A 突出，与 T-vector 的 T 突出互补连接。
            </div>
            <SeqInput label="PCR 产物 (不含 A 尾)" value={taInsert} onChange={setTaInsert} rows={3} />
            <SeqInput label="T-vector 序列" value={taVector} onChange={setTaVector} rows={2} placeholder={vectorSequence ? '使用当前载体' : '粘贴 T-vector...'} />
            <button onClick={runTA}
              className="w-full px-3 py-1.5 bg-green-600 text-white text-xs rounded hover:bg-green-700 flex items-center justify-center gap-1">
              <Play size={12} /> 模拟 TA 克隆
            </button>
            {taResult && <ResultCard success={taResult.success} length={taResult.productLength}
              warnings={taResult.warnings} errors={taResult.errors} onCopy={() => copySeq(taResult.productSequence)} />}
          </>
        )}

        {/* ============ TOPO 克隆 ============ */}
        {mode === 'topo' && (
          <>
            <div className="text-xs text-slate-500 bg-blue-50 p-2 rounded">
              TOPO 克隆使用拓扑异构酶 I 实现高效连接，支持 TA 和平端两种方式。
            </div>
            <div className="flex gap-2">
              <label className="flex items-center gap-1 text-xs">
                <input type="radio" checked={topoType === 'TA'} onChange={() => setTopoType('TA')} /> TOPO-TA
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input type="radio" checked={topoType === 'Blunt'} onChange={() => setTopoType('Blunt')} /> TOPO-Blunt
              </label>
            </div>
            <SeqInput label="插入片段" value={taInsert} onChange={setTaInsert} rows={3} />
            <SeqInput label="载体序列" value={taVector} onChange={setTaVector} rows={2} placeholder={vectorSequence ? '使用当前载体' : '粘贴载体...'} />
            <button onClick={runTOPO}
              className="w-full px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 flex items-center justify-center gap-1">
              <Play size={12} /> 模拟 TOPO 克隆
            </button>
            {topoResult && <ResultCard success={topoResult.success} length={topoResult.productLength}
              warnings={topoResult.warnings} errors={topoResult.errors} onCopy={() => copySeq(topoResult.productSequence)} />}
          </>
        )}

        {/* ============ Gateway ============ */}
        {mode === 'gateway' && (
          <>
            <div className="text-xs text-slate-500 bg-purple-50 p-2 rounded">
              Gateway 使用位点特异性重组（att 位点）实现无缝克隆，无需限制酶。
            </div>
            <div className="flex gap-2">
              <button onClick={() => setGwType('BP')}
                className={`flex-1 px-2 py-1 text-xs border rounded ${gwType === 'BP' ? 'bg-purple-100 border-purple-300' : 'hover:bg-white'}`}>
                BP 反应 (attB × attP)
              </button>
              <button onClick={() => setGwType('LR')}
                className={`flex-1 px-2 py-1 text-xs border rounded ${gwType === 'LR' ? 'bg-purple-100 border-purple-300' : 'hover:bg-white'}`}>
                LR 反应 (attL × attR)
              </button>
            </div>
            <SeqInput label={gwType === 'BP' ? 'attB 插入片段' : 'Entry 克隆插入片段'} value={gwInsert} onChange={setGwInsert} rows={3} />
            <SeqInput label={gwType === 'BP' ? '供体载体 (attP)' : '目的载体 (attR)'} value={gwVector} onChange={setGwVector} rows={2} placeholder={vectorSequence ? '使用当前载体' : '粘贴载体...'} />
            <button onClick={runGateway}
              className="w-full px-3 py-1.5 bg-purple-600 text-white text-xs rounded hover:bg-purple-700 flex items-center justify-center gap-1">
              <Play size={12} /> 模拟 Gateway {gwType}
            </button>
            {gwResult && <ResultCard success={gwResult.success} length={gwResult.productLength}
              warnings={gwResult.warnings} errors={gwResult.errors} onCopy={() => copySeq(gwResult.productSequence)} />}
          </>
        )}

        {/* ============ 定点诱变 ============ */}
        {mode === 'mutagenesis' && (
          <>
            <div className="text-xs text-slate-500 bg-red-50 p-2 rounded">
              定点诱变通过 PCR 引入精确的点突变、插入或删除。
            </div>
            <SeqInput label="模板序列" value={mutTemplate} onChange={setMutTemplate} rows={3} placeholder={vectorSequence ? '使用当前载体序列' : '粘贴模板...'} />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">突变类型</label>
                <select value={mutType} onChange={e => setMutType(e.target.value as any)}
                  className="w-full text-xs border rounded px-2 py-1.5">
                  <option value="substitution">替换</option>
                  <option value="insertion">插入</option>
                  <option value="deletion">删除</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">位置 (0-based)</label>
                <input type="number" value={mutPosition} onChange={e => setMutPosition(+e.target.value)} min={0}
                  className="w-full text-xs border rounded px-2 py-1.5" />
              </div>
            </div>
            {mutType !== 'deletion' && (
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">{mutType === 'substitution' ? '替换序列' : '插入序列'}</label>
                <input type="text" value={mutSequence} onChange={e => setMutSequence(e.target.value.toUpperCase())}
                  className="w-full text-xs font-mono border rounded px-2 py-1.5" placeholder="例如: GATC" />
              </div>
            )}
            {mutType === 'deletion' && (
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">删除长度 (bp)</label>
                <input type="number" value={mutDelLen} onChange={e => setMutDelLen(+e.target.value)} min={1}
                  className="w-full text-xs border rounded px-2 py-1.5" />
              </div>
            )}
            <button onClick={runMutagenesis}
              className="w-full px-3 py-1.5 bg-red-600 text-white text-xs rounded hover:bg-red-700 flex items-center justify-center gap-1">
              <Play size={12} /> 模拟定点诱变
            </button>
            {mutResult && (
              <>
                <ResultCard success={mutResult.success} length={mutResult.productLength}
                  warnings={mutResult.warnings} errors={mutResult.errors} onCopy={() => copySeq(mutResult.productSequence)} />
                {mutResult.primers.forward && (
                  <div className="text-xs bg-slate-50 p-2 rounded border space-y-1">
                    <div className="font-medium text-slate-600">建议引物：</div>
                    <div className="font-mono text-[10px] break-all">
                      <span className="text-emerald-600">Fwd:</span> {mutResult.primers.forward}
                    </div>
                    <div className="font-mono text-[10px] break-all">
                      <span className="text-red-600">Rev:</span> {mutResult.primers.reverse}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ============ 共用子组件 ============

function SeqInput({ label, value, onChange, rows = 3, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string
}) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-600 block mb-1">{label}</label>
      <textarea value={value} onChange={e => onChange(e.target.value)}
        className="w-full text-xs font-mono border rounded px-2 py-1.5 resize-y"
        rows={rows} placeholder={placeholder || '粘贴序列...'} />
      <span className="text-[10px] text-slate-400">{value.replace(/[\s]/g, '').length} bp</span>
    </div>
  )
}

function ResultCard({ success, length, warnings, errors, onCopy }: {
  success: boolean; length: number; warnings: string[]; errors: string[]; onCopy: () => void
}) {
  return (
    <div className={`text-xs border rounded p-2 ${success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
      <div className="flex items-center gap-2 mb-1">
        {success ? <Check size={14} className="text-green-600" /> : <AlertCircle size={14} className="text-red-600" />}
        <span className={success ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}>
          {success ? '模拟成功' : '模拟失败'}
        </span>
        {success && <span className="text-slate-500">产物: {length.toLocaleString()} bp</span>}
        {success && <button onClick={onCopy} className="ml-auto text-slate-500 hover:text-violet-600 flex items-center gap-0.5">
          <Copy size={10} /> 复制
        </button>}
      </div>
      {warnings.map((w, i) => <div key={`w${i}`} className="text-amber-600 text-[10px] ml-5">⚠ {w}</div>)}
      {errors.map((e, i) => <div key={`e${i}`} className="text-red-600 text-[10px] ml-5">✗ {e}</div>)}
    </div>
  )
}
