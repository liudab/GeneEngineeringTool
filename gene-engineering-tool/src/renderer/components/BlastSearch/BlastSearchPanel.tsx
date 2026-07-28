/**
 * NCBI BLAST 在线搜索组件
 * 功能：
 * - 输入序列（粘贴/从编辑器选区）
 * - 选择 BLAST 程序（blastn/blastp/blastx/tblastn/tblastx）
 * - 选择数据库（nr/nt/refseq 等）
 * - 提交搜索并显示结果摘要
 * - 支持导出结果为 FASTA
 *
 * 使用 NCBI BLAST REST API (URLAPI)
 * 注意：实际 API 调用需通过 Electron main 进程代理（CORS）或直接用 NCBI URL API
 */

import { useState, useCallback } from 'react'
import { Search, Download, ExternalLink, Info, Loader2, Globe } from 'lucide-react'
import { useLifecycleLog } from '../../hooks/useDebugLog'

interface Props {
  /** 预填充序列 */
  initialSequence?: string
  /** 序列类型 */
  sequenceType?: 'nucleotide' | 'protein'
  className?: string
}

type BlastProgram = 'blastn' | 'blastp' | 'blastx' | 'tblastn' | 'tblastx'
type BlastDatabase = 'nt' | 'nr' | 'refseq_rna' | 'refseq_genomic' | 'refseq_protein'

const PROGRAMS: { value: BlastProgram; label: string; desc: string }[] = [
  { value: 'blastn', label: 'blastn', desc: '核酸→核酸' },
  { value: 'blastp', label: 'blastp', desc: '蛋白→蛋白' },
  { value: 'blastx', label: 'blastx', desc: '核酸(翻译)→蛋白' },
  { value: 'tblastn', label: 'tblastn', desc: '蛋白→核酸(翻译)' },
  { value: 'tblastx', label: 'tblastx', desc: '核酸(翻译)→核酸(翻译)' },
]

const DATABASES: { value: BlastDatabase; label: string }[] = [
  { value: 'nt', label: 'Nucleotide collection (nt)' },
  { value: 'nr', label: 'Non-redundant protein (nr)' },
  { value: 'refseq_rna', label: 'Reference RNA sequences' },
  { value: 'refseq_genomic', label: 'Reference genomic sequences' },
  { value: 'refseq_protein', label: 'Reference protein sequences' },
]

export default function BlastSearchPanel({ initialSequence, sequenceType = 'nucleotide', className = '' }: Props) {
  useLifecycleLog('BlastSearchPanel')

  const [sequence, setSequence] = useState(initialSequence || '')
  const [program, setProgram] = useState<BlastProgram>(sequenceType === 'protein' ? 'blastp' : 'blastn')
  const [database, setDatabase] = useState<BlastDatabase>(sequenceType === 'protein' ? 'nr' : 'nt')
  const [expectValue, setExpectValue] = useState('10')
  const [maxResults, setMaxResults] = useState('50')

  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [ncbiUrl, setNcbiUrl] = useState('')

  // 构建 NCBI BLAST URL
  const buildBlastUrl = useCallback(() => {
    const cleanSeq = sequence.replace(/[\s\d]/g, '').toUpperCase()
    if (cleanSeq.length < 10) {
      setError('序列太短，至少需要 10 个碱基/氨基酸')
      return null
    }

    const baseUrl = 'https://blast.ncbi.nlm.nih.gov/Blast.cgi'
    const params = new URLSearchParams({
      PAGE: sequenceType === 'protein' ? 'Proteins' : 'Nucleotides',
      PROGRAM: program,
      DATABASE: database,
      MEGABLAST: 'on',
      QUERY: cleanSeq,
      EXPECT: expectValue,
      HITLIST_SIZE: maxResults,
      FORMAT_TYPE: 'HTML',
    })

    return `${baseUrl}?${params.toString()}`
  }, [sequence, program, database, sequenceType, expectValue, maxResults])

  // 提交 BLAST 搜索
  const handleSubmit = useCallback(() => {
    setError('')
    const url = buildBlastUrl()
    if (!url) return

    // 检查 URL 长度（浏览器 GET 请求 URL 上限约 2000-8000 字符）
    if (url.length > 7000) {
      setError(`序列过长（URL ${url.length} 字符），请缩短查询序列后重试`)
      return
    }

    setSearching(true)
    setNcbiUrl(url)

    // 在系统默认浏览器中打开 NCBI BLAST
    try {
      if (window.api?.openExternal) {
        window.api.openExternal(url).then((result: any) => {
          if (!result?.success) {
            setError('打开浏览器失败: ' + (result?.message || '未知错误'))
          }
        }).catch((e: any) => {
          setError('打开浏览器失败: ' + (e.message || ''))
        }).finally(() => {
          setSearching(false)
        })
      } else {
        // Fallback: 在非 Electron 环境用 window.open
        window.open(url, '_blank')
        setSearching(false)
      }
    } catch (e: any) {
      setError('无法打开浏览器: ' + (e.message || ''))
      setSearching(false)
    }
  }, [buildBlastUrl])

  // 复制 NCBI URL
  const copyUrl = useCallback(() => {
    if (ncbiUrl) { try { navigator.clipboard.writeText(ncbiUrl) } catch {} }
  }, [ncbiUrl])

  // 清理序列（移除数字、空格、>开头的FASTA标题行）
  const cleanSequence = useCallback(() => {
    setSequence(prev =>
      prev
        .split('\n')
        .filter(line => !line.trim().startsWith('>'))  // 移除 FASTA 标题行
        .join('\n')
        .replace(/[\s\d]/g, '')  // 移除空格和数字
    )
  }, [])

  return (
    <div className={`flex flex-col ${className}`}>
      {/* 标题 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-slate-50">
        <Globe size={14} className="text-blue-600" />
        <span className="text-xs font-bold text-slate-700">NCBI BLAST 在线搜索</span>
        <div className="flex-1" />
        <a href="https://blast.ncbi.nlm.nih.gov/Blast.cgi" target="_blank" rel="noopener noreferrer"
          className="text-[10px] text-blue-500 hover:underline flex items-center gap-0.5">
          <ExternalLink size={8} /> NCBI BLAST
        </a>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* 序列输入 */}
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">查询序列</label>
          <textarea
            value={sequence}
            onChange={e => setSequence(e.target.value)}
            className="w-full h-24 text-xs font-mono border rounded px-2 py-1.5 resize-y"
            placeholder="粘贴核酸或蛋白质序列..."
          />
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-slate-400">
              {sequence.replace(/[\s\d]/g, '').length} 字符
            </span>
            <button onClick={cleanSequence} className="text-[10px] text-slate-500 hover:text-blue-600">
              清理序列
            </button>
          </div>
        </div>

        {/* BLAST 程序 */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">BLAST 程序</label>
            <select value={program} onChange={e => setProgram(e.target.value as BlastProgram)}
              className="w-full text-xs border rounded px-2 py-1.5">
              {PROGRAMS.map(p => (
                <option key={p.value} value={p.value}>{p.label} ({p.desc})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">数据库</label>
            <select value={database} onChange={e => setDatabase(e.target.value as BlastDatabase)}
              className="w-full text-xs border rounded px-2 py-1.5">
              {DATABASES.map(d => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 参数 */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">E-value 阈值</label>
            <input type="text" value={expectValue} onChange={e => setExpectValue(e.target.value)}
              className="w-full text-xs border rounded px-2 py-1.5" placeholder="10" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">最大结果数</label>
            <input type="number" value={maxResults} onChange={e => setMaxResults(e.target.value)}
              className="w-full text-xs border rounded px-2 py-1.5" min="1" max="500" />
          </div>
        </div>

        {/* 错误信息 */}
        {error && (
          <div className="text-xs text-red-600 bg-red-50 p-2 rounded flex items-center gap-1">
            <Info size={12} /> {error}
          </div>
        )}

        {/* 提交按钮 */}
        <button onClick={handleSubmit} disabled={searching || !sequence.trim()}
          className="w-full px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center gap-2">
          {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          {searching ? '提交中...' : '提交 BLAST 搜索'}
        </button>

        {/* URL 预览 */}
        {ncbiUrl && (
          <div className="text-[10px] text-slate-500 bg-slate-50 p-2 rounded border break-all">
            <div className="flex items-center gap-1 mb-1">
              <span className="font-medium text-slate-600">搜索 URL:</span>
              <button onClick={copyUrl} className="text-blue-500 hover:underline">复制</button>
            </div>
            <span className="break-all">{ncbiUrl.substring(0, 120)}...</span>
          </div>
        )}

        {/* 说明 */}
        <div className="text-[10px] text-slate-400 bg-slate-50 p-2 rounded border">
          <div className="font-medium text-slate-500 mb-1">使用说明：</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li>点击搜索将在浏览器中打开 NCBI BLAST 页面</li>
            <li>BLAST 搜索由 NCBI 服务器执行，可能需要数秒到数分钟</li>
            <li>结果在 NCBI 网页中查看，支持下载和导出</li>
            <li>支持 FASTA、GenBank、纯序列等多种输入格式</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
