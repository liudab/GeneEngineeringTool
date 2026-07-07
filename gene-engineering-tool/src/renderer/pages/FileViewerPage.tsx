import { useState, useEffect } from 'react'
import { FolderOpen, FileText, AlignLeft, FlaskConical, X } from 'lucide-react'
import type { GenBankRecord, FastaRecord } from '../../shared/types'
import PlasmidViewer from '../components/PlasmidViewer/PlasmidViewer'
import AlignmentViewer from '../components/AlignmentViewer/AlignmentViewer'
import PrimerDesignPanel from '../components/PrimerDesignPanel/PrimerDesignPanel'
import { useAlignment } from '../hooks/useAlignment'
import { usePrimerDesign } from '../hooks/usePrimerDesign'
import type { AlignmentType } from '../engine/alignment/types'

export default function FileViewerPage() {
  const [fileResult, setFileResult] = useState<any>(null)
  const [genBankData, setGenBankData] = useState<GenBankRecord | null>(null)
  const [fastaData, setFastaData] = useState<FastaRecord[] | null>(null)
  const [viewMode, setViewMode] = useState<'circular' | 'linear'>('circular')

  // 比对 & 引物设计
  const alignment = useAlignment()
  const primerDesign = usePrimerDesign()
  const [showAlignDialog, setShowAlignDialog] = useState(false)
  const [showPrimerDialog, setShowPrimerDialog] = useState(false)
  const [alignSeq1, setAlignSeq1] = useState('')
  const [alignSeq2, setAlignSeq2] = useState('')
  const [alignName1, setAlignName1] = useState('')
  const [alignName2, setAlignName2] = useState('')
  const [alignType, setAlignType] = useState<AlignmentType>('nucleotide-nw')

  useEffect(() => {
    // Listen for file open results from sidebar button
    const handleFileOpen = async () => {
      const result = await window.api.openFile()
      if (result) {
        setFileResult(result)
        if (result.type === 'genbank') {
          setGenBankData(result.data)
          setFastaData(null)
        } else if (result.type === 'fasta') {
          setFastaData(result.data)
          setGenBankData(null)
        }
      }
    }
    // Expose via window for sidebar button
    ;(window as any).__openFileViewer = handleFileOpen

    return () => { delete (window as any).__openFileViewer }
  }, [])

  const handleOpenFile = async () => {
    const result = await window.api.openFile()
    if (result) {
      setFileResult(result)
      if (result.type === 'genbank') {
        setGenBankData(result.data)
        setFastaData(null)
      } else if (result.type === 'fasta') {
        setFastaData(result.data)
        setGenBankData(null)
      }
    }
  }

  if (!genBankData && !fastaData) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <FolderOpen size={64} className="mb-4" />
        <p className="text-lg mb-2">打开序列文件</p>
        <p className="text-sm mb-4">支持 GenBank (.gb)、FASTA (.fasta) 和 SnapGene (.dna) 格式</p>
        <button onClick={handleOpenFile}
          className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-500 flex items-center gap-2">
          <FolderOpen size={20} /> 选择文件
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <FileText size={16} />
          <span className="font-medium">{fileResult?.filePath?.split(/[/\\]/).pop()}</span>
          <span className="text-slate-400">({fileResult?.type === 'genbank' ? 'GenBank' : 'FASTA'})</span>
        </div>
        <div className="flex gap-1 bg-white border rounded-lg p-0.5">
          <button onClick={() => setViewMode('circular')}
            className={`px-3 py-1 rounded text-xs ${viewMode === 'circular' ? 'bg-slate-800 text-white' : 'text-slate-600'}`}>
            环形视图
          </button>
          <button onClick={() => setViewMode('linear')}
            className={`px-3 py-1 rounded text-xs ${viewMode === 'linear' ? 'bg-slate-800 text-white' : 'text-slate-600'}`}>
            线性视图
          </button>
        </div>
        <button onClick={handleOpenFile} className="ml-auto px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-500">
          打开其他文件
        </button>
        {genBankData && (
          <>
            <button onClick={() => {
              setAlignSeq1(genBankData.sequence)
              setAlignName1(genBankData.name)
              setShowAlignDialog(true)
            }} className="px-3 py-1.5 border rounded text-sm text-blue-600 hover:bg-blue-50 flex items-center gap-1">
              <AlignLeft size={14} /> 序列比对
            </button>
            <button onClick={() => setShowPrimerDialog(true)}
              className="px-3 py-1.5 border rounded text-sm text-violet-600 hover:bg-violet-50 flex items-center gap-1">
              <FlaskConical size={14} /> 引物设计
            </button>
          </>
        )}
      </div>

      {genBankData && (
        <div className="flex-1 flex gap-6 overflow-hidden">
          {/* SVG Viewer */}
          <div className="flex-1 bg-white rounded-lg border border-slate-200 overflow-auto">
            <PlasmidViewer record={genBankData} viewMode={viewMode} />
          </div>

          {/* Feature list */}
          <div className="w-72 bg-white rounded-lg border border-slate-200 flex flex-col flex-shrink-0">
            <div className="p-3 border-b border-slate-100">
              <h4 className="text-sm font-bold text-slate-800">{genBankData.name}</h4>
              <p className="text-xs text-slate-500 mt-1">{genBankData.size.toLocaleString()} bp | {genBankData.topology === 'circular' ? '环形' : '线性'}</p>
              {genBankData.description && <p className="text-xs text-slate-400 mt-1">{genBankData.description}</p>}
            </div>
            <div className="flex-1 overflow-auto p-2">
              <h5 className="text-xs font-medium text-slate-500 uppercase px-2 mb-1">元件 ({genBankData.features.length})</h5>
              {genBankData.features.map((f, i) => (
                <div key={i} className="px-2 py-1.5 rounded text-xs hover:bg-slate-50 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${getFeatureColor(f.type)}`} />
                    <span className="font-medium text-slate-700">{f.qualifiers.label || f.qualifiers.gene || f.qualifiers.product || f.type}</span>
                  </div>
                  <div className="text-slate-400 ml-4">
                    {f.type} | {f.start + 1}..{f.end + 1} {f.strand === -1 ? '(互补)' : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {fastaData && (
        <div className="flex-1 bg-white rounded-lg border border-slate-200 overflow-auto p-4">
          {fastaData.map((record, i) => (
            <div key={i} className="mb-6">
              <h4 className="text-sm font-bold text-slate-800">&gt;{record.id} {record.description}</h4>
              <div className="sequence-display mt-2 bg-slate-50 rounded p-3 text-xs">
                {record.sequence.match(/.{1,80}/g)?.map((line, j) => (
                  <div key={j}>{line}</div>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-1">{record.sequence.length.toLocaleString()} {record.sequence.match(/[^ATGCatgc]/) ? 'aa' : 'bp'}</p>
            </div>
          ))}
        </div>
      )}

      {/* 序列比对对话框 */}
      {showAlignDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999]" onClick={() => { setShowAlignDialog(false); alignment.reset() }}>
          <div className="bg-white rounded-xl w-[700px] max-h-[85vh] shadow-2xl flex flex-col" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <h4 className="text-sm font-bold text-blue-700 flex items-center gap-2"><AlignLeft size={14} /> 序列比对</h4>
              <button onClick={() => { setShowAlignDialog(false); alignment.reset() }} className="p-1 text-slate-400 hover:text-slate-600"><X size={14} /></button>
            </div>
            {alignment.status !== 'done' || !alignment.result ? (
              <div className="p-4 space-y-3 overflow-auto">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-600 mb-1 block">序列1名称</label>
                    <input value={alignName1} onChange={e => setAlignName1(e.target.value)} className="w-full px-2 py-1 border rounded text-xs" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600 mb-1 block">序列2名称</label>
                    <input value={alignName2} onChange={e => setAlignName2(e.target.value)} className="w-full px-2 py-1 border rounded text-xs" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-600 mb-1 block">比对类型</label>
                  <select value={alignType} onChange={e => setAlignType(e.target.value as AlignmentType)} className="w-full px-2 py-1 border rounded text-xs">
                    <option value="nucleotide-nw">核酸全局比对 (NW)</option>
                    <option value="nucleotide-sw">核酸局部比对 (SW)</option>
                    <option value="protein">蛋白质比对 (BLOSUM62)</option>
                    <option value="nucleotide-protein">核酸-蛋白质 (六框翻译)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-600 mb-1 block">序列1</label>
                  <textarea value={alignSeq1} onChange={e => setAlignSeq1(e.target.value)} className="w-full h-20 px-2 py-1 border rounded font-mono text-[10px] resize-none" />
                </div>
                <div>
                  <label className="text-xs text-slate-600 mb-1 block">序列2</label>
                  <textarea value={alignSeq2} onChange={e => setAlignSeq2(e.target.value)} className="w-full h-20 px-2 py-1 border rounded font-mono text-[10px] resize-none" />
                </div>
                <div className="flex justify-end">
                  <button onClick={() => {
                    alignment.align(
                      alignSeq1.replace(/\s/g, ''), alignSeq2.replace(/\s/g, ''),
                      alignType, undefined, alignName1 || 'Seq1', alignName2 || 'Seq2'
                    )
                  }} disabled={!alignSeq1 || !alignSeq2 || alignment.status === 'running'}
                    className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40">
                    {alignment.status === 'running' ? '比对中...' : '开始比对'}
                  </button>
                </div>
                {alignment.status === 'error' && <p className="text-xs text-red-500">{alignment.error}</p>}
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                <AlignmentViewer output={alignment.result} className="flex-1" />
                <div className="p-2 border-t flex justify-end">
                  <button onClick={() => { alignment.reset() }}
                    className="px-3 py-1 text-xs border rounded text-slate-600 hover:bg-slate-50">重新比对</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 引物设计对话框 */}
      {showPrimerDialog && genBankData && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999]" onClick={() => setShowPrimerDialog(false)}>
          <div className="bg-white rounded-xl w-[420px] max-h-[85vh] shadow-2xl flex flex-col" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <h4 className="text-sm font-bold text-violet-700 flex items-center gap-2"><FlaskConical size={14} /> 引物设计</h4>
              <button onClick={() => setShowPrimerDialog(false)} className="p-1 text-slate-400 hover:text-slate-600"><X size={14} /></button>
            </div>
            <p className="text-xs text-slate-500 px-4 py-2">请选择要设计引物的区域，然后开始设计。默认使用整个序列。</p>
            <PrimerDesignPanel
              templateSeq={genBankData.sequence}
              selectionStart={0}
              selectionEnd={genBankData.sequence.length - 1}
              status={primerDesign.status}
              result={primerDesign.result}
              error={primerDesign.error}
              onDesign={(mode, params) => primerDesign.design(genBankData.sequence, 0, genBankData.sequence.length - 1, mode, params)}
              selectedPair={primerDesign.selectedPair}
              onSelectPair={primerDesign.setSelectedPair}
              className="flex-1 overflow-hidden"
            />
          </div>
        </div>
      )}
    </div>
  )
}

function getFeatureColor(type: string): string {
  const colors: Record<string, string> = {
    gene: 'bg-emerald-500',
    CDS: 'bg-blue-500',
    mRNA: 'bg-cyan-500',
    promoter: 'bg-amber-500',
    terminator: 'bg-red-500',
    rep_origin: 'bg-purple-500',
    misc_feature: 'bg-slate-400',
    primer_bind: 'bg-pink-500',
    protein_bind: 'bg-indigo-500',
    regulatory: 'bg-orange-500',
    source: 'bg-gray-400',
    exon: 'bg-teal-500',
    intron: 'bg-gray-400',
    five_prime_UTR: 'bg-lime-500',
    three_prime_UTR: 'bg-fuchsia-400',
    enhancer: 'bg-amber-400',
    sig_peptide: 'bg-orange-500',
    polyA_signal: 'bg-yellow-500',
    STS: 'bg-slate-500',
    ncRNA: 'bg-cyan-500',
    misc_RNA: 'bg-cyan-500',
    misc_binding: 'bg-slate-500',
    misc_difference: 'bg-slate-400',
    misc_recomb: 'bg-purple-500'
  }
  return colors[type] || 'bg-slate-300'
}
