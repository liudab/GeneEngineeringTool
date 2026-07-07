/**
 * 比对结果可视化组件
 * 双行对齐显示 + midline，等宽字体
 * 颜色：匹配绿、相似黄、错配红、gap灰
 * 每行60字符 + 行号 + 统计摘要
 * 导出：FASTA / CSV
 */

import { useState, useMemo } from 'react'
import { Download, ChevronLeft, ChevronRight } from 'lucide-react'
import type { AlignmentOutput, AlignmentResult } from '../../engine/alignment/types'
import { exportAlignmentToFasta, exportAlignmentToCSV } from '../../engine/alignment/index'

interface Props {
  output: AlignmentOutput
  className?: string
}

const CHARS_PER_LINE = 60

export default function AlignmentViewer({ output, className = '' }: Props) {
  const [currentResult, setCurrentResult] = useState(0)
  const result = output.results[currentResult]

  if (!result) {
    return (
      <div className={`p-4 text-center text-slate-400 text-sm ${className}`}>
        无比对结果
      </div>
    )
  }

  const lines = useMemo(() => formatAlignment(result, output.seq1Name, output.seq2Name), [result, output.seq1Name, output.seq2Name])

  const handleExport = (format: 'fasta' | 'csv') => {
    const content = format === 'fasta' ? exportAlignmentToFasta(output) : exportAlignmentToCSV(output)
    const ext = format === 'fasta' ? 'fasta' : 'csv'
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `alignment.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={`flex flex-col ${className}`}>
      {/* 统计摘要 */}
      <div className="flex items-center gap-3 px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs flex-wrap">
        <span className="font-medium text-slate-700">
          {output.seq1Name || 'Sequence 1'} vs {output.seq2Name || 'Sequence 2'}
        </span>
        <span className="text-slate-400">|</span>
        <span>得分: <b className="text-violet-600">{result.score}</b></span>
        <span>一致性: <b className="text-emerald-600">{result.identity}%</b></span>
        <span>相似性: <b className="text-amber-600">{result.similarity}%</b></span>
        <span>空位: <b>{result.gaps}</b></span>
        {output.results.length > 1 && (
          <>
            <span className="text-slate-400">|</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setCurrentResult(Math.max(0, currentResult - 1))}
                disabled={currentResult === 0} className="p-0.5 hover:bg-slate-200 rounded disabled:opacity-30">
                <ChevronLeft size={12} />
              </button>
              <span>{currentResult + 1}/{output.results.length}</span>
              <button onClick={() => setCurrentResult(Math.min(output.results.length - 1, currentResult + 1))}
                disabled={currentResult === output.results.length - 1} className="p-0.5 hover:bg-slate-200 rounded disabled:opacity-30">
                <ChevronRight size={12} />
              </button>
            </div>
          </>
        )}
        <div className="flex-1" />
        <button onClick={() => handleExport('fasta')}
          className="px-2 py-0.5 border rounded text-slate-600 hover:bg-white flex items-center gap-1">
          <Download size={10} /> FASTA
        </button>
        <button onClick={() => handleExport('csv')}
          className="px-2 py-0.5 border rounded text-slate-600 hover:bg-white flex items-center gap-1">
          <Download size={10} /> CSV
        </button>
      </div>

      {/* 比对显示区 */}
      <div className="flex-1 overflow-auto p-3 bg-white font-mono text-[11px] leading-[16px]">
        {lines.map((block, i) => (
          <div key={i} className="mb-3">
            {/* Seq1 */}
            <div className="flex">
              <span className="w-12 text-right pr-2 text-slate-400 select-none flex-shrink-0">{block.seq1Start}</span>
              <span className="flex-1">
                {block.seq1.split('').map((c, j) => (
                  <span key={j} className={getCharClass(c, block.midline[j], 'seq1')}>{c}</span>
                ))}
              </span>
              <span className="w-10 pl-1 text-slate-400 select-none flex-shrink-0">{block.seq1End}</span>
            </div>
            {/* Midline */}
            <div className="flex">
              <span className="w-12 flex-shrink-0" />
              <span className="flex-1 text-slate-400">{block.midline}</span>
            </div>
            {/* Seq2 */}
            <div className="flex">
              <span className="w-12 text-right pr-2 text-slate-400 select-none flex-shrink-0">{block.seq2Start}</span>
              <span className="flex-1">
                {block.seq2.split('').map((c, j) => (
                  <span key={j} className={getCharClass(c, block.midline[j], 'seq2')}>{c}</span>
                ))}
              </span>
              <span className="w-10 pl-1 text-slate-400 select-none flex-shrink-0">{block.seq2End}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function getCharClass(c: string, mid: string, seq: 'seq1' | 'seq2'): string {
  if (c === '-') return 'text-slate-300 bg-slate-50'
  if (mid === '|') return 'text-emerald-700 bg-emerald-50'
  if (mid === ':') return 'text-amber-700 bg-amber-50'
  if (mid === ' ' && c !== '-') return 'text-red-600'
  return 'text-slate-700'
}

interface AlignmentBlock {
  seq1: string
  seq2: string
  midline: string
  seq1Start: number
  seq1End: number
  seq2Start: number
  seq2End: number
}

function formatAlignment(result: AlignmentResult, name1?: string, name2?: string): AlignmentBlock[] {
  const { alignedSeq1, alignedSeq2, midline } = result
  const blocks: AlignmentBlock[] = []
  const totalLen = alignedSeq1.length

  let s1Pos = result.seq1Range[0]
  let s2Pos = result.seq2Range[0]

  for (let i = 0; i < totalLen; i += CHARS_PER_LINE) {
    const end = Math.min(i + CHARS_PER_LINE, totalLen)
    const s1Chunk = alignedSeq1.substring(i, end)
    const s2Chunk = alignedSeq2.substring(i, end)
    const midChunk = midline.substring(i, end)

    const s1Start = s1Pos + 1 // 1-based display
    const s2Start = s2Pos + 1

    // Count non-gap characters to advance position
    let s1NonGap = 0, s2NonGap = 0
    for (const c of s1Chunk) { if (c !== '-') s1NonGap++ }
    for (const c of s2Chunk) { if (c !== '-') s2NonGap++ }

    blocks.push({
      seq1: s1Chunk,
      seq2: s2Chunk,
      midline: midChunk,
      seq1Start: s1Start,
      seq1End: s1Pos + s1NonGap,
      seq2Start: s2Start,
      seq2End: s2Pos + s2NonGap
    })

    s1Pos += s1NonGap
    s2Pos += s2NonGap
  }

  return blocks
}
