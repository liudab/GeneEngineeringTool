import { useState, useEffect } from 'react'
import { FolderOpen, FileText } from 'lucide-react'
import type { GenBankRecord, FastaRecord } from '../../shared/types'
import PlasmidViewer from '../components/PlasmidViewer/PlasmidViewer'

export default function FileViewerPage() {
  const [fileResult, setFileResult] = useState<any>(null)
  const [genBankData, setGenBankData] = useState<GenBankRecord | null>(null)
  const [fastaData, setFastaData] = useState<FastaRecord[] | null>(null)
  const [viewMode, setViewMode] = useState<'circular' | 'linear'>('circular')

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
    source: 'bg-gray-400'
  }
  return colors[type] || 'bg-slate-300'
}
