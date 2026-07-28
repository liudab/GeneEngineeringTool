/**
 * @module SpeciesAnnotationTab
 * @description
 * 物种基因注释标签页组件 — 展示来自特定数据源的基因注释信息。
 *
 * 功能：
 * - 显示基因标识符和基本信息
 * - 渲染自定义字段（文本、标签、长文本）
 * - 提供外部数据库链接
 * - MSU 数据源：显示从 MSU 网站获取的基因信息和序列下载
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { ExternalLink, Download, RefreshCw, Loader2, ZoomIn, ZoomOut, Maximize2, Copy, Check } from 'lucide-react'
import type { SpeciesGeneAnnotation, FieldDefinition } from '../../../shared/types'
import { useI18n } from '../../hooks/useI18n'
import { translateRxpLabel, translateMsuSample } from './rxp-label-i18n'

/** 序列复制按钮：点击复制 FASTA 格式文本到剪贴板，成功后短暂显示勾选 */
function SeqCopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }
  return (
    <button onClick={handleCopy} className={`p-0.5 rounded hover:bg-slate-200 transition-colors ${copied ? 'text-green-600' : 'text-slate-400 hover:text-slate-600'}`} title="复制 FASTA 序列">
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}
import JSZip from 'jszip'

// ============ 导出工具函数 ============
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function exportChartCSV(data: number[], labels: string[], label: string, boxData?: number[][] | null) {
  const lines: string[] = ['Sample,Label,Value,Rep1,Rep2,Rep3,Mean,Median']
  data.forEach((v, i) => {
    const lbl = labels[i] || String(i + 1)
    if (boxData && boxData[i] && boxData[i].length > 1) {
      const reps = boxData[i]
      const mean = reps.reduce((s, x) => s + x, 0) / reps.length
      const sorted = [...reps].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      lines.push(`${i + 1},"${lbl}",${v.toFixed(2)},${reps.join(',')},${mean.toFixed(2)},${median.toFixed(2)}`)
    } else {
      lines.push(`${i + 1},"${lbl}",${v.toFixed(2)},,,,${v.toFixed(2)},${v.toFixed(2)}`)
    }
  })
  downloadBlob(new Blob([lines.join('\n')], { type: 'text/csv' }), `${label.replace(/[\\/:*?"<>|]/g, '_')}.csv`)
}

function exportChartSVG(container: HTMLElement | null, label: string) {
  if (!container) return
  const svg = container.querySelector('svg')
  if (!svg) return
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const data = new XMLSerializer().serializeToString(clone)
  downloadBlob(new Blob([data], { type: 'image/svg+xml' }), `${label.replace(/[\\/:*?"<>|]/g, '_')}.svg`)
}

function exportChartPNG(container: HTMLElement | null, label: string) {
  if (!container) return
  const svg = container.querySelector('svg')
  if (!svg) return
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const data = new XMLSerializer().serializeToString(clone)
  const w = svg.viewBox.baseVal.width || svg.clientWidth || 960
  const h = svg.viewBox.baseVal.height || svg.clientHeight || 480
  const canvas = document.createElement('canvas')
  canvas.width = w * 2; canvas.height = h * 2
  const ctx = canvas.getContext('2d')!
  ctx.scale(2, 2)
  const img = new Image()
  img.onload = () => {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    canvas.toBlob(blob => { if (blob) downloadBlob(blob, `${label.replace(/[\\/:*?"<>|]/g, '_')}.png`) })
  }
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(data)))
}

/** 可缩放视口：滚轮缩放（以鼠标为中心）+ 拖拽平移 + 重置。图片与 SVG 图表复用 */
function ZoomableViewport({ children, resetKey, maxHeight = 480 }: {
  children: React.ReactNode
  resetKey?: string | number
  maxHeight?: number
}) {
  const [scale, setScale] = useState(1)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ dragging: boolean; startX: number; startY: number; origX: number; origY: number }>({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0 })

  const MIN_SCALE = 0.5
  const MAX_SCALE = 8

  // 内容切换时重置视图
  useEffect(() => {
    setScale(1)
    setTranslate({ x: 0, y: 0 })
  }, [resetKey])

  // 滚轮缩放（以鼠标位置为中心）——原生非 passive 监听器以阻止页面滚动
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = container.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      setScale(prev => {
        const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev * delta))
        const ratio = next / prev
        setTranslate(t => ({
          x: mouseX - ratio * (mouseX - t.x),
          y: mouseY - ratio * (mouseY - t.y)
        }))
        return next
      })
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [])

  // 拖拽平移
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragState.current = { dragging: true, startX: e.clientX, startY: e.clientY, origX: translate.x, origY: translate.y }
  }, [translate])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragState.current.dragging) return
      const dx = e.clientX - dragState.current.startX
      const dy = e.clientY - dragState.current.startY
      setTranslate({ x: dragState.current.origX + dx, y: dragState.current.origY + dy })
    }
    const onUp = () => { dragState.current.dragging = false }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  const resetView = useCallback(() => {
    setScale(1)
    setTranslate({ x: 0, y: 0 })
  }, [])

  return (
    <div className="relative">
      {/* 缩放工具栏 */}
      <div className="absolute top-1 right-1 z-10 flex items-center gap-1 bg-white/90 border border-slate-200 rounded px-1 py-0.5 shadow-sm">
        <button onClick={() => setScale(s => Math.max(MIN_SCALE, s * 0.8))} className="p-0.5 text-slate-500 hover:text-slate-800" title="缩小"><ZoomOut size={13} /></button>
        <span className="text-[10px] text-slate-600 font-mono w-9 text-center">{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale(s => Math.min(MAX_SCALE, s * 1.25))} className="p-0.5 text-slate-500 hover:text-slate-800" title="放大"><ZoomIn size={13} /></button>
        <button onClick={resetView} className="p-0.5 text-slate-500 hover:text-slate-800" title="重置（适应宽度）"><Maximize2 size={13} /></button>
      </div>
      {/* 视口 */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        className="overflow-hidden cursor-grab active:cursor-grabbing bg-white select-none"
        style={{ maxHeight: `${maxHeight}px` }}
      >
        <div style={{ transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`, transformOrigin: '0 0', width: 'fit-content' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

/** 可缩放图片查看器（复用 ZoomableViewport） */
function ZoomableImage({ src, alt, footerUrl, onImgError }: { src: string; alt: string; footerUrl?: string; onImgError?: () => void }) {
  return (
    <ZoomableViewport resetKey={src} maxHeight={480}>
      <img src={src} alt={alt} className="block" draggable={false} onError={onImgError} style={{ width: '640px', maxWidth: 'none' }} />
      {footerUrl && <img src={footerUrl} alt="" className="block" draggable={false} style={{ width: '640px', maxWidth: 'none' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />}
    </ZoomableViewport>
  )
}

/** 计算“整齐”的刻度步长（1/2/5 × 10^k） */
function niceStep(maxVal: number, targetTicks: number): number {
  if (maxVal <= 0) return 1
  const rough = maxVal / targetTicks
  const pow = Math.pow(10, Math.floor(Math.log10(rough)))
  const norm = rough / pow
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return step * pow
}

/** 计算箱型图统计量：min, q1, median, q3, max, mean, sd */
function boxStats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const min = sorted[0]
  const max = sorted[n - 1]
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)]
  const q1Idx = (n - 1) * 0.25
  const q3Idx = (n - 1) * 0.75
  const q1 = sorted[Math.floor(q1Idx)] + (q1Idx % 1) * (sorted[Math.ceil(q1Idx)] - sorted[Math.floor(q1Idx)])
  const q3 = sorted[Math.floor(q3Idx)] + (q3Idx % 1) * (sorted[Math.ceil(q3Idx)] - sorted[Math.floor(q3Idx)])
  const mean = values.reduce((s, v) => s + v, 0) / n
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / n)
  return { min, q1, median, q3, max, mean, sd }
}

/** 表达箱型图/柱状图：大画布 SVG + 完整坐标轴 + 刻度标签 + 悬停高亮，包裹在可缩放视口中 */
function ExpressionBarChart({ data, labels, label, boxData }: { data: number[]; labels?: string[]; label: string; boxData?: number[][] | null }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const { language } = useI18n()
  if (!data || data.length === 0) return null

  // 判断是否有箱型图数据（每个样本多个重复值）
  const hasBox = !!boxData && boxData.length > 0 && boxData.some(d => d.length > 1)

  // 计算全局最大值（用于 Y 轴范围）
  const maxVal = hasBox
    ? Math.max(...boxData.map(d => Math.max(...d)))
    : Math.max(...data)

  // 画布与边距
  const W = 960, H = 480
  const mL = 90, mR = 30, mT = 30, mB = 110
  const plotW = W - mL - mR
  const plotH = H - mT - mB
  const n = data.length
  const band = plotW / n
  const boxW = Math.min(band * 0.55, 36) // 箱体宽度
  const hasLabels = !!labels && labels.length > 0
  const xLabel = (i: number) => {
    const raw = hasLabels && labels[i] ? labels[i] : String(i + 1)
    return translateRxpLabel(raw, language)
  }

  // Y 轴刻度
  const step = niceStep(maxVal, 5)
  const yMax = Math.ceil(maxVal / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= yMax + 1e-9; v += step) ticks.push(v)
  const yScale = (v: number) => mT + plotH - (yMax > 0 ? (v / yMax) * plotH : 0)

  // X 轴标签旋转逻辑
  const rotate = hasLabels || n > 12
  const labelEvery = n > 80 ? Math.ceil(n / 80) : 1

  return (
    <ZoomableViewport resetKey={label} maxHeight={480}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', background: '#fff' }}>
        {/* 标题 */}
        <text x={mL} y={18} fontSize={15} fontWeight={600} fill="#334155">{label}</text>
        <text x={mL + 340} y={18} fontSize={11} fill="#94a3b8">
          {n} 个样本{hasBox ? ` · ${boxData[0].length} 次重复 · 箱型图` : ''} · 滚轮缩放 / 拖拽平移
        </text>

        {/* 水平网格线 + Y 轴刻度标签 */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={mL} y1={yScale(t)} x2={mL + plotW} y2={yScale(t)} stroke="#e2e8f0" strokeWidth={1} strokeDasharray={t === 0 ? '0' : '3,3'} />
            <text x={mL - 8} y={yScale(t) + 4} fontSize={12} textAnchor="end" fill="#64748b">{t >= 1000 ? (t / 1000).toFixed(1) + 'k' : Number(t.toFixed(2))}</text>
          </g>
        ))}

        {/* 箱型图或柱状图 */}
        {hasBox ? (
          /* === 箱型图模式 === */
          boxData.map((values, i) => {
            const cx = mL + i * band + band / 2
            const stats = boxStats(values)
            const isHover = hoverIdx === i
            const opacity = hoverIdx === null || isHover ? 1 : 0.4
            return (
              <g key={i}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                opacity={opacity}
                style={{ transition: 'opacity 120ms' }}
              >
                {/* 须线（min → max） */}
                <line x1={cx} y1={yScale(stats.max)} x2={cx} y2={yScale(stats.min)} stroke={isHover ? '#4338ca' : '#6366f1'} strokeWidth={1.5} />
                {/* 须线端点（min/max 横线） */}
                <line x1={cx - boxW * 0.3} y1={yScale(stats.max)} x2={cx + boxW * 0.3} y2={yScale(stats.max)} stroke={isHover ? '#4338ca' : '#6366f1'} strokeWidth={1.5} />
                <line x1={cx - boxW * 0.3} y1={yScale(stats.min)} x2={cx + boxW * 0.3} y2={yScale(stats.min)} stroke={isHover ? '#4338ca' : '#6366f1'} strokeWidth={1.5} />
                {/* 箱体（Q1 → Q3） */}
                <rect
                  x={cx - boxW / 2}
                  y={yScale(stats.q3)}
                  width={boxW}
                  height={Math.max(1, yScale(stats.q1) - yScale(stats.q3))}
                  rx={2}
                  fill={isHover ? '#c7d2fe' : '#e0e7ff'}
                  stroke={isHover ? '#4338ca' : '#6366f1'}
                  strokeWidth={1.5}
                />
                {/* 中位数线 */}
                <line x1={cx - boxW / 2} y1={yScale(stats.median)} x2={cx + boxW / 2} y2={yScale(stats.median)} stroke={isHover ? '#312e81' : '#4338ca'} strokeWidth={2.5} />
                {/*  individual 数据点（带微小水平抖动） */}
                {values.map((v, j) => {
                  const jitter = (j - (values.length - 1) / 2) * (boxW * 0.22)
                  return (
                    <circle key={j} cx={cx + jitter} cy={yScale(v)} r={3} fill={isHover ? '#4338ca' : '#818cf8'} opacity={0.85} />
                  )
                })}
                {/* 悬停提示：统计信息 */}
                {isHover && (
                  <text x={cx} y={yScale(stats.max) - 10} fontSize={12} fontWeight={700} textAnchor="middle" fill="#312e81">
                    {xLabel(i)}: {stats.mean.toFixed(1)} ± {stats.sd.toFixed(1)}
                  </text>
                )}
                {/* 透明热区 */}
                <rect x={mL + i * band} y={mT} width={band} height={plotH} fill="transparent" />
              </g>
            )
          })
        ) : (
          /* === 柱状图回退模式（无重复数据时） === */
          data.map((v, i) => {
            const cx = mL + i * band + band / 2
            const h = yMax > 0 ? (v / yMax) * plotH : 0
            const barW = Math.min(band * 0.68, 46)
            const isHover = hoverIdx === i
            return (
              <g key={i}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
              >
                <rect
                  x={cx - barW / 2}
                  y={yScale(v)}
                  width={barW}
                  height={h}
                  rx={2}
                  fill={isHover ? '#4338ca' : '#6366f1'}
                  opacity={hoverIdx === null || isHover ? 0.92 : 0.45}
                  style={{ transition: 'opacity 120ms, fill 120ms' }}
                />
                {isHover && (
                  <text x={cx} y={yScale(v) - 8} fontSize={13} fontWeight={700} textAnchor="middle" fill="#312e81">{xLabel(i)}: {v.toFixed(1)}</text>
                )}
                <rect x={mL + i * band} y={mT} width={band} height={plotH} fill="transparent" />
              </g>
            )
          })
        )}

        {/* X 轴样本标签 */}
        {data.map((_, i) => {
          if (i % labelEvery !== 0) return null
          const cx = mL + i * band + band / 2
          return rotate ? (
            <text key={i} x={cx} y={mT + plotH + 12} fontSize={11} fill="#64748b" textAnchor="end" transform={`rotate(-45 ${cx} ${mT + plotH + 12})`}>{xLabel(i)}</text>
          ) : (
            <text key={i} x={cx} y={mT + plotH + 18} fontSize={12} textAnchor="middle" fill="#64748b">{xLabel(i)}</text>
          )
        })}

        {/* 坐标轴线 */}
        <line x1={mL} y1={mT} x2={mL} y2={mT + plotH} stroke="#94a3b8" strokeWidth={1.5} />
        <line x1={mL} y1={mT + plotH} x2={mL + plotW} y2={mT + plotH} stroke="#94a3b8" strokeWidth={1.5} />

        {/* 轴标题 */}
        <text x={22} y={mT + plotH / 2} fontSize={13} fontWeight={600} fill="#475569" textAnchor="middle" transform={`rotate(-90 22 ${mT + plotH / 2})`}>表达水平 (Expression level)</text>
        <text x={mL + plotW / 2} y={H - 12} fontSize={13} fontWeight={600} fill="#475569" textAnchor="middle">样本 (Sample)</text>
      </svg>
    </ZoomableViewport>
  )
}

interface SpeciesAnnotationTabProps {
  annotation: SpeciesGeneAnnotation
  fieldDefinitions: FieldDefinition[]
  urlTemplates: Record<string, string>
}

export default function SpeciesAnnotationTab({
  annotation,
  fieldDefinitions,
  urlTemplates
}: SpeciesAnnotationTabProps) {
  const { language } = useI18n()
  // 解析 annotation_data JSON
  let annotationData: Record<string, any> = {}
  try {
    annotationData = JSON.parse(annotation.annotation_data || '{}')
  } catch (e) {
    console.warn('Failed to parse annotation_data:', e)
  }

  // 从缓存初始化 MSU 在线数据
  const getCachedMsuInfo = () => {
    if (annotation.source_database !== 'MSU') return null
    if (annotationData['msu_gene_product_name'] || annotationData['msu_go_terms'] || annotationData['msu_splice_variants']) {
      const cached: any = {}
      if (annotationData['msu_gene_product_name']) cached.gene_product_name = annotationData['msu_gene_product_name']
      if (annotationData['msu_locus_name']) cached.locus_name = annotationData['msu_locus_name']
      if (annotationData['msu_go_terms']) {
        try { cached.go_terms = JSON.parse(annotationData['msu_go_terms']) } catch {}
      }
      if (annotationData['msu_coexpression_modules']) {
        try { cached.coexpression_modules = JSON.parse(annotationData['msu_coexpression_modules']) } catch {}
      }
      if (annotationData['msu_splice_variants']) {
        try { cached.splice_variants = JSON.parse(annotationData['msu_splice_variants']) } catch {}
      }
      if (annotationData['msu_rnaseq_tpm']) {
        try { cached.rnaseq_tpm = JSON.parse(annotationData['msu_rnaseq_tpm']) } catch {}
      }
      return cached
    }
    return null
  }

  // 从缓存初始化 MSU 序列数据
  const getCachedMsuSequences = () => {
    if (annotation.source_database !== 'MSU') return null
    if (annotationData['msu_sequences']) {
      try { return JSON.parse(annotationData['msu_sequences']) } catch {}
    }
    return null
  }

  // 从缓存初始化 RAP-DB 在线数据
  const getCachedRapdbInfo = () => {
    if (annotation.source_database !== 'RAP-DB') return null
    if (annotationData['rapdb_sequence'] || annotationData['rapdb_exons']) {
      const cached: any = {}
      if (annotationData['rapdb_locus_title']) cached.locus_title = annotationData['rapdb_locus_title']
      if (annotationData['rapdb_seqid']) cached.seqid = annotationData['rapdb_seqid']
      if (annotationData['rapdb_start_pos']) cached.start_pos = Number(annotationData['rapdb_start_pos'])
      if (annotationData['rapdb_end_pos']) cached.end_pos = Number(annotationData['rapdb_end_pos'])
      if (annotationData['rapdb_strand']) cached.strand = annotationData['rapdb_strand']
      if (annotationData['rapdb_sequence']) cached.sequence = annotationData['rapdb_sequence']
      if (annotationData['rapdb_exons']) {
        try { cached.exons = JSON.parse(annotationData['rapdb_exons']) } catch {}
      }
      if (annotationData['rapdb_transcripts']) {
        try { cached.transcripts = JSON.parse(annotationData['rapdb_transcripts']) } catch {}
      }
      if (annotationData['rapdb_expression_data']) cached.expression_data = annotationData['rapdb_expression_data']
      if (annotationData['rapdb_expression_rxp_name']) cached.expression_rxp_name = annotationData['rapdb_expression_rxp_name']
      if (annotationData['rapdb_expression_images']) {
        try { cached.expression_images = JSON.parse(annotationData['rapdb_expression_images']) } catch {}
      }
      if (annotationData['rapdb_expression_categories']) {
        try { cached.expression_categories = JSON.parse(annotationData['rapdb_expression_categories']) } catch {}
      }
      if (annotationData['rapdb_oryzabase']) {
        try { cached.oryzabase = JSON.parse(annotationData['rapdb_oryzabase']) } catch {}
      }
      if (annotationData['rapdb_transcript_variants']) {
        try { cached.transcript_variants = JSON.parse(annotationData['rapdb_transcript_variants']) } catch {}
      }
      return cached
    }
    return null
  }

  // MSU 在线数据获取状态（从缓存初始化）
  const [msuInfo, setMsuInfo] = useState<any>(getCachedMsuInfo())
  const [msuSequences, setMsuSequences] = useState<any>(getCachedMsuSequences())
  const [loadingInfo, setLoadingInfo] = useState(false)
  const [loadingSequences, setLoadingSequences] = useState(false)
  const [msuError, setMsuError] = useState<string | null>(null)

  // RAP-DB 在线数据获取状态（从缓存初始化）
  const [rapdbInfo, setRapdbInfo] = useState<any>(getCachedRapdbInfo())
  const [loadingRapdb, setLoadingRapdb] = useState(false)
  const [rapdbError, setRapdbError] = useState<string | null>(null)
  // RiceXPro 图谱下拉选择状态（大类索引 + 具体图谱索引）
  const [rxpCatIdx, setRxpCatIdx] = useState(0)
  const [rxpImgIdx, setRxpImgIdx] = useState(0)
  const [rxpImgFailed, setRxpImgFailed] = useState(false)
  // 图表型实验的数值数据（按需获取）
  const [chartData, setChartData] = useState<number[] | null>(null)
  const [chartLabels, setChartLabels] = useState<string[]>([])
  /** 箱型图数据：每个样本的多次重复值（raw 处理） */
  const [chartBoxData, setChartBoxData] = useState<number[][] | null>(null)
  const [chartLoading, setChartLoading] = useState(false)
  const chartContainerRef = useRef<HTMLDivElement>(null)

  // 解析 external_links JSON
  let externalLinks: Record<string, string> = {}
  try {
    externalLinks = JSON.parse(annotation.external_links || '{}')
  } catch (e) {
    console.warn('Failed to parse external_links:', e)
  }

  // 生成外部链接 URL
  const getExternalUrl = (database: string, accession: string): string => {
    // RAP-DB 使用正确的原站链接
    if (database === 'RAP-DB') return `https://rapdb.dna.naro.go.jp/locus/?name=${accession}`
    const template = urlTemplates[database]
    if (!template) return ''
    return template.replace('{accession}', encodeURIComponent(accession))
  }

  // 获取 MSU 基因信息
  // 获取 MSU 全部数据（信息 + 序列）
  const fetchAllMSUData = async () => {
    if (annotation.source_database !== 'MSU') return
    setLoadingInfo(true)
    setLoadingSequences(true)
    setMsuError(null)
    try {
      // 第一步：获取基因信息
      const infoResult = await window.api.fetchMSUGeneInfo(annotation.source_accession)
      if (infoResult.success) {
        setMsuInfo(infoResult.data)
        window.api.cacheMSUInfo(annotation.id, infoResult.data).catch(() => {})
        // 第二步：获取序列（传递剪接形式列表）
        const variants = infoResult.data?.splice_variants || undefined
        const seqResult = await window.api.fetchMSUSequences(annotation.source_accession, variants)
        if (seqResult.success) {
          setMsuSequences(seqResult.data)
          // 序列数据持久化缓存
          window.api.cacheMSUInfo(annotation.id, { msu_sequences: seqResult.data }).catch(() => {})
        } else {
          setMsuError(seqResult.error || '获取序列失败')
        }
      } else {
        setMsuError(infoResult.error || '获取信息失败')
      }
    } catch (err: any) {
      setMsuError(err.message || '获取 MSU 数据失败')
    } finally {
      setLoadingInfo(false)
      setLoadingSequences(false)
    }
  }

  // 图表型实验按需获取数值数据（缓存优先：先检查 annotationData，无缓存再调 API 并写入缓存）
  useEffect(() => {
    const cats = rapdbInfo?.expression_categories
    if (!cats || cats.length === 0) return
    const cat = cats[Math.min(rxpCatIdx, cats.length - 1)]
    const views = cat.views || cat.images || []
    if (views.length === 0) {
      setChartData(null)
      return
    }
    const view = views[Math.min(rxpImgIdx, views.length - 1)]
    if (!view || (view.type || 'image') !== 'chart' || !view.rxpId) {
      setChartData(null)
      return
    }

    // 缓存键：rapdb_expression_{rxpId}
    const cacheKey = `rapdb_expression_${view.rxpId}`
    const cachedRaw = annotationData[cacheKey]
    if (cachedRaw) {
      // 从本地缓存加载（无网络请求）
      try {
        const cached = typeof cachedRaw === 'string' ? JSON.parse(cachedRaw) : cachedRaw
        const nums: number[] = cached.data || []
        const labels: string[] = cached.sample_labels || []
        setChartData(nums)
        setChartLabels(labels)
        // 重建箱型图数据
        if (cached.repeats && Array.isArray(cached.repeats)) {
          const rawReps = cached.repeats.filter((r: any) => r.data_processing === 'raw')
          if (rawReps.length > 1 && nums.length > 0) {
            const boxData: number[][] = Array.from({ length: nums.length }, () => [])
            for (const rep of rawReps) {
              const vals: number[] = rep.values || []
              for (let i = 0; i < Math.min(vals.length, nums.length); i++) boxData[i].push(vals[i])
            }
            setChartBoxData(boxData)
          } else setChartBoxData(null)
        } else setChartBoxData(null)
        setChartLoading(false)
        return
      } catch {}
    }

    // 无缓存：从 API 获取并写入缓存
    let cancelled = false
    setChartLoading(true)
    setChartData(null)
    setChartLabels([])
    setChartBoxData(null)
    window.api.fetchRAPDBExpression(annotation.source_accession, view.rxpId)
      .then((res: any) => {
        if (cancelled) return
        if (res.success && res.data.data) {
          const nums = res.data.data.split(' ').filter(Boolean).map(Number).filter((n: number) => !isNaN(n))
          const labels = Array.isArray(res.data.sample_labels) ? res.data.sample_labels : []
          setChartData(nums)
          setChartLabels(labels)
          // 解析重复数据构建箱型图
          const repeats: Array<{ repeat_number: string; data_processing: string; data: string }> = res.data.repeats || []
          const rawReps = repeats.filter(r => r.data_processing === 'raw')
          let boxData: number[][] | null = null
          if (rawReps.length > 1 && nums.length > 0) {
            boxData = Array.from({ length: nums.length }, () => [])
            for (const rep of rawReps) {
              const vals = rep.data.split(' ').filter(Boolean).map(Number).filter((n: number) => !isNaN(n))
              for (let i = 0; i < Math.min(vals.length, nums.length); i++) boxData[i].push(vals[i])
            }
            setChartBoxData(boxData)
          } else {
            setChartBoxData(null)
          }
          // 写入本地缓存（持久化到 annotation_data）
          const cachePayload: any = { data: nums, sample_labels: labels }
          if (rawReps.length > 1) {
            cachePayload.repeats = rawReps.map(r => ({
              data_processing: r.data_processing,
              values: r.data.split(' ').filter(Boolean).map(Number).filter((n: number) => !isNaN(n))
            }))
          }
          window.api.cacheRAPDBExpressionData(annotation.id, view.rxpId, cachePayload).catch(() => {})
        } else {
          setChartData([])
        }
      })
      .catch(() => { if (!cancelled) setChartData([]) })
      .finally(() => { if (!cancelled) setChartLoading(false) })
    return () => { cancelled = true }
  }, [rapdbInfo, rxpCatIdx, rxpImgIdx, annotation.source_accession])

  // 获取 RAP-DB 基因座信息
  const fetchRAPDBInfo = async () => {
    if (annotation.source_database !== 'RAP-DB') return
    setLoadingRapdb(true)
    setRapdbError(null)
    try {
      const result = await window.api.fetchRAPDBLocusInfo(annotation.source_accession)
      if (result.success) {
        const info = result.data
        // 尝试获取表达数据（数值）
        try {
          const exprResult = await window.api.fetchRAPDBExpression(annotation.source_accession, 'RXP_3001')
          if (exprResult.success && exprResult.data.data) {
            info.expression_data = exprResult.data.data
            info.expression_rxp_name = exprResult.data.rxp_name
          }
        } catch {}
        // 获取 RiceXPro 表达图片 URL（全部 5 大类）
        try {
          const imgResult = await window.api.fetchRAPDBExpressionImages(annotation.source_accession)
          if (imgResult.success && imgResult.data.categories) {
            info.expression_categories = imgResult.data.categories
          }
        } catch {}
        setRapdbInfo(info)
        // 持久化缓存
        window.api.cacheRAPDBInfo(annotation.id, info).catch(() => {})
        // 批量获取全部 25 个图表型实验数据并缓存（后台执行，不阻塞 UI）
        window.api.fetchAllRAPDBExpressionData(annotation.source_accession, annotation.id)
          .then((res: any) => {
            if (res.success) console.log(`[RAP-DB] 表达数据批量获取完成：成功 ${res.success}，失败 ${res.failed}`)
          })
          .catch(() => {})
      } else {
        setRapdbError(result.error || '获取 RAP-DB 信息失败')
      }
    } catch (err: any) {
      setRapdbError(err.message || '获取 RAP-DB 信息失败')
    } finally {
      setLoadingRapdb(false)
    }
  }

  // 保存 RAP-DB GenBank
  const saveRAPDBGenBank = async () => {
    if (!rapdbInfo) return
    try {
      await window.api.saveRAPDBGenBank(annotation.source_accession, rapdbInfo)
    } catch (err: any) {
      console.error('Failed to save RAP-DB GenBank:', err)
    }
  }

  // 保存 RAP-DB FASTA（从基因组序列 + 外显子推导 CDS）
  const saveRAPDBFasta = async () => {
    if (!rapdbInfo || !rapdbInfo.exons || !rapdbInfo.sequence) return
    try {
      // 从基因组序列和外显子坐标推导 CDS
      const cdsParts: string[] = []
      for (const exon of rapdbInfo.exons) {
        const relStart = exon.start - rapdbInfo.start_pos
        const relEnd = exon.end - rapdbInfo.start_pos
        cdsParts.push(rapdbInfo.sequence.substring(relStart, relEnd))
      }
      const cds = cdsParts.join('')
      const transcriptName = rapdbInfo.transcripts?.[0]?.name || annotation.source_accession
      await window.api.saveRAPDBFasta(transcriptName, { mrna: rapdbInfo.sequence, cds })
    } catch (err: any) {
      console.error('Failed to save RAP-DB FASTA:', err)
    }
  }

  // 渲染字段值
  const renderFieldValue = (field: FieldDefinition, value: string) => {
    if (!value || value.trim().length === 0) return null

    switch (field.type) {
      case 'tags':
        // 分号分隔的标签
        const tags = value.split(/[;；]/).map(s => s.trim()).filter(Boolean)
        return (
          <div className="flex flex-wrap gap-1 mt-1">
            {tags.map((tag, i) => (
              <span
                key={i}
                className="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-xs"
              >
                {tag}
              </span>
            ))}
          </div>
        )

      case 'longtext':
        // 长文本（保留换行）
        return (
          <div className="mt-1 p-3 bg-slate-50 rounded-lg text-xs text-slate-700 whitespace-pre-wrap max-h-64 overflow-auto">
            {value}
          </div>
        )

      case 'link':
        // 链接
        return (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs text-cyan-600 hover:text-cyan-700"
          >
            {value}
            <ExternalLink size={10} />
          </a>
        )

      default:
        // 普通文本
        return <p className="mt-1 text-xs text-slate-700">{value}</p>
    }
  }

  // 数据时效性提示（始终显示获取时间，超过 180 天时柔和提示可更新）
  const CACHE_MAX_AGE_DAYS = 180
  const getCacheAgeInfo = (): { text: string; stale: boolean } | null => {
    const tsKey = annotation.source_database === 'RAP-DB' ? 'rapdb_updated_at'
      : annotation.source_database === 'MSU' ? 'msu_updated_at'
      : 'fetched_at'
    const ts = annotationData[tsKey] || annotationData['rapdb_fetched_at'] || annotationData['msu_fetched_at']
    if (!ts) return null
    const dateStr = new Date(ts).toLocaleDateString('zh-CN')
    const age = Date.now() - new Date(ts).getTime()
    const stale = age > CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
    return { text: stale ? `数据获取于 ${dateStr}，可点击“在线更新”获取最新版本` : `数据获取于 ${dateStr}`, stale }
  }
  const cacheAgeInfo = getCacheAgeInfo()

  return (
    <div className="space-y-4">
      {/* 数据时效性提示 */}
      {cacheAgeInfo && (
        <div className={`px-3 py-1.5 rounded-lg text-[11px] ${cacheAgeInfo.stale ? 'bg-slate-50 text-slate-400' : 'bg-slate-50 text-slate-400'}`}>
          {cacheAgeInfo.text}
        </div>
      )}
      {/* 解析警告提示 */}
      {(() => {
        try {
          const w = annotationData['_parse_warnings']
          const arr = typeof w === 'string' ? JSON.parse(w || '[]') : (Array.isArray(w) ? w : [])
          if (arr.length > 0) return (
            <div className="px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-700">
              ⚠️ 部分字段解析失败：{arr.join('、')}
            </div>
          )
        } catch {}
        return null
      })()}
      {/* 标识符信息 */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-slate-800 mb-3">标识符信息</h4>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-slate-500 font-medium">数据源</span>
            <p className="text-slate-800">{annotation.source_database}</p>
          </div>
          <div>
            <span className="text-slate-500 font-medium">存取号</span>
            <p className="text-slate-800 font-mono">{annotation.source_accession}</p>
          </div>
          {annotation.gene_symbol && (
            <div>
              <span className="text-slate-500 font-medium">基因符号</span>
              <p className="text-slate-800">{annotation.gene_symbol}</p>
            </div>
          )}
        </div>

        {/* 外部链接 */}
        <div className="mt-4 pt-3 border-t border-slate-100">
          <span className="text-xs text-slate-500 font-medium">外部链接</span>
          <div className="flex flex-wrap gap-2 mt-2">
            {getExternalUrl(annotation.source_database, annotation.source_accession) && (
              <a
                href={getExternalUrl(annotation.source_database, annotation.source_accession)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-cyan-50 text-cyan-700 border border-cyan-200 rounded-md text-xs hover:bg-cyan-100 transition-colors"
              >
                {annotation.source_database}
                <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* MSU 在线数据获取区域 */}
      {annotation.source_database === 'MSU' && (
        <div className="bg-white border border-blue-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-blue-900">MSU 基因信息（在线）</h4>
            <div className="flex gap-2">
              <button
                onClick={fetchAllMSUData}
                disabled={loadingInfo || loadingSequences}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-md text-xs hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {(loadingInfo || loadingSequences) ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {loadingSequences ? '获取序列中...' : '获取全部数据'}
              </button>
            </div>
          </div>

          {msuError && (
            <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              {msuError}
            </div>
          )}

          {msuInfo && (
            <div className="space-y-2 text-xs">
              {msuInfo.gene_product_name && (
                <div>
                  <span className="text-slate-500 font-medium">基因产物名称:</span>
                  <p className="text-slate-800 mt-0.5">{msuInfo.gene_product_name}</p>
                </div>
              )}
              {msuInfo.locus_name && (
                <div>
                  <span className="text-slate-500 font-medium">基因座名称:</span>
                  <p className="text-slate-800 font-mono mt-0.5">{msuInfo.locus_name}</p>
                </div>
              )}
              {msuInfo.chromosome && (
                <div>
                  <span className="text-slate-500 font-medium">染色体位置:</span>
                  <p className="text-slate-800 mt-0.5">Chr{msuInfo.chromosome}: {msuInfo.start_position}-{msuInfo.end_position} ({msuInfo.strand === '+' ? '正向' : '反向'})</p>
                </div>
              )}
              {msuInfo.go_terms && msuInfo.go_terms.length > 0 && (
                <div>
                  <span className="text-slate-500 font-medium">Gene Ontology 注释:</span>
                  <div className="mt-1 space-y-1">
                    {msuInfo.go_terms.map((go: any, i: number) => (
                      <div key={i} className="text-slate-700">
                        <span className="font-mono text-blue-600">{go.go_id}</span> - {go.name} ({go.type})
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {msuInfo.coexpression_modules && msuInfo.coexpression_modules.length > 0 && (
                <div>
                  <span className="text-slate-500 font-medium">Coexpression Module Assignment:</span>
                  <div className="mt-1 space-y-1">
                    {msuInfo.coexpression_modules.map((mod: any, i: number) => (
                      <div key={i} className="text-slate-700">
                        <span className="font-mono text-purple-600">Module {mod.module_id}</span> - Peak Expression: {mod.peak_expression}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* 可变剪接形式 */}
              {msuInfo.splice_variants && msuInfo.splice_variants.length > 1 && (
                <div>
                  <span className="text-slate-500 font-medium">可变剪接形式 ({msuInfo.splice_variants.length}):</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {msuInfo.splice_variants.map((v: any, i: number) => (
                      <span key={i} className="px-1.5 py-0.5 bg-cyan-50 text-cyan-700 border border-cyan-200 rounded font-mono text-[10px]">{v.id}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {msuSequences && (
            <div className="mt-4 pt-3 border-t border-blue-100">
              <span className="text-xs text-slate-500 font-medium">序列信息{msuSequences.transcripts?.length > 1 ? `（${msuSequences.transcripts.length} 个剪接形式）` : ''}:</span>
              <div className="mt-2 space-y-1 text-xs">
                {/* Genomic 可折叠 */}
                <details className="group">
                  <summary className="flex items-center justify-between p-1.5 bg-slate-50 rounded cursor-pointer hover:bg-slate-100 list-none">
                    <span className="text-slate-600">🧬 Genomic — {annotation.source_accession}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-slate-800 font-mono">{(msuSequences.genomic_sequence || '').replace(/\s+/g, '').length || msuSequences.genomic_length} bp</span>
                      <SeqCopyBtn text={`>${annotation.source_accession} genomic\n${(msuSequences.genomic_sequence || '').replace(/\s+/g, '')}`} />
                    </span>
                  </summary>
                  <pre className="mt-1 p-2 bg-slate-50 rounded font-mono text-[10px] text-slate-700 whitespace-pre-wrap break-all max-h-[200px] overflow-auto">{`>${annotation.source_accession} genomic\n${((msuSequences.genomic_sequence || '').replace(/\s+/g, '').match(/.{1,60}/g) || []).join('\n') || '无序列数据'}`}</pre>
                </details>
                {/* 每个剪接形式的 CDS + Protein */}
                {(msuSequences.transcripts || [{ variant_id: annotation.source_accession, cds_sequence: msuSequences.cds_sequence, protein_sequence: msuSequences.protein_sequence, cds_length: msuSequences.cds_length, protein_length: msuSequences.protein_length }]).map((tx: any, i: number) => (
                  <div key={i} className="pl-2 border-l-2 border-blue-200 space-y-1">
                    <details className="group">
                      <summary className="flex items-center justify-between p-1.5 bg-blue-50/50 rounded cursor-pointer hover:bg-blue-100/50 list-none">
                        <span className="text-slate-600">🟦 CDS — {tx.variant_id}</span>
                        <span className="flex items-center gap-1.5">
                          <span className="text-slate-800 font-mono">{(tx.cds_sequence || '').replace(/\s+/g, '').length || tx.cds_length} bp</span>
                          <SeqCopyBtn text={`>${tx.variant_id} CDS\n${(tx.cds_sequence || '').replace(/\s+/g, '')}`} />
                        </span>
                      </summary>
                      <pre className="mt-1 p-2 bg-slate-50 rounded font-mono text-[10px] text-slate-700 whitespace-pre-wrap break-all max-h-[200px] overflow-auto">{`>${tx.variant_id} CDS\n${((tx.cds_sequence || '').replace(/\s+/g, '').match(/.{1,60}/g) || []).join('\n') || '无序列数据'}`}</pre>
                    </details>
                    <details className="group">
                      <summary className="flex items-center justify-between p-1.5 bg-amber-50/50 rounded cursor-pointer hover:bg-amber-100/50 list-none">
                        <span className="text-slate-600">🟨 Protein — {tx.variant_id}</span>
                        <span className="flex items-center gap-1.5">
                          <span className="text-slate-800 font-mono">{(tx.protein_sequence || '').replace(/\s+/g, '').length || tx.protein_length} aa</span>
                          <SeqCopyBtn text={`>${tx.variant_id} protein\n${(tx.protein_sequence || '').replace(/\s+/g, '')}`} />
                        </span>
                      </summary>
                      <pre className="mt-1 p-2 bg-slate-50 rounded font-mono text-[10px] text-slate-700 whitespace-pre-wrap break-all max-h-[200px] overflow-auto">{`>${tx.variant_id} protein\n${((tx.protein_sequence || '').replace(/\s+/g, '').match(/.{1,60}/g) || []).join('\n') || '无序列数据'}`}</pre>
                    </details>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* RNA-Seq TPM 表达值表格 */}
          {msuInfo?.rnaseq_tpm && msuInfo.rnaseq_tpm.length > 0 && (
            <div className="mt-4 pt-3 border-t border-blue-100">
              <span className="text-xs text-slate-500 font-medium">{language === 'zh' ? 'RNA-Seq TPM 表达值' : 'RNA-Seq TPM Expression Values'}:</span>
              <div className="mt-2 max-h-[300px] overflow-auto border border-slate-200 rounded">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-100 sticky top-0">
                      <th className="text-left px-2 py-1 font-medium text-slate-600">SRA Run</th>
                      <th className="text-left px-2 py-1 font-medium text-slate-600">{language === 'zh' ? '样本' : 'Sample'}</th>
                      <th className="text-right px-2 py-1 font-medium text-slate-600">TPM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {msuInfo.rnaseq_tpm.map((row: any, i: number) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                        <td className="px-2 py-0.5">
                          <a href={row.sra_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 hover:underline font-mono">{row.sra_run}</a>
                        </td>
                        <td className="px-2 py-0.5 text-slate-700">{translateMsuSample(row.sample, language)}</td>
                        <td className="px-2 py-0.5 text-right font-mono text-slate-800">{row.tpm.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* RAP-DB 在线数据获取区域 */}
      {annotation.source_database === 'RAP-DB' && (
        <div className="bg-white border border-indigo-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-indigo-900">RAP-DB 基因信息（在线）</h4>
            <div className="flex gap-2">
              <a
                href={`https://rapdb.dna.naro.go.jp/locus/?name=${annotation.source_accession}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-cyan-50 text-cyan-700 border border-cyan-200 rounded-md text-xs hover:bg-cyan-100 transition-colors"
              >
                <ExternalLink size={12} /> RAP-DB 原站
              </a>
              <button
                onClick={fetchRAPDBInfo}
                disabled={loadingRapdb}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md text-xs hover:bg-indigo-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingRapdb ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                在线更新 RAP-DB 信息
              </button>
            </div>
          </div>

          {rapdbError && (
            <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{rapdbError}</div>
          )}

          {rapdbInfo && (
            <div className="space-y-3 text-xs">
              {/* 基本信息 */}
              <div className="grid grid-cols-2 gap-2">
                {rapdbInfo.locus_title && (
                  <div><span className="text-slate-500 font-medium">基因名称:</span> <span className="text-slate-800">{rapdbInfo.locus_title}</span></div>
                )}
                <div><span className="text-slate-500 font-medium">位置:</span> <span className="text-slate-800 font-mono">{rapdbInfo.seqid}:{rapdbInfo.start_pos}..{rapdbInfo.end_pos} ({rapdbInfo.strand})</span></div>
                {rapdbInfo.sequence && (
                  <div><span className="text-slate-500 font-medium">基因组序列:</span> <span className="text-slate-800 font-mono">{rapdbInfo.sequence.length} bp</span></div>
                )}
                {rapdbInfo.exons && (
                  <div><span className="text-slate-500 font-medium">外显子数:</span> <span className="text-slate-800">{rapdbInfo.exons.length}</span></div>
                )}
              </div>

              {/* 外显子坐标 */}
              {rapdbInfo.exons && rapdbInfo.exons.length > 0 && (
                <div>
                  <span className="text-slate-500 font-medium">外显子坐标:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {rapdbInfo.exons.map((exon: any, i: number) => (
                      <span key={i} className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-[10px] font-mono">
                        E{i + 1}: {exon.start - rapdbInfo.start_pos + 1}..{exon.end - rapdbInfo.start_pos + 1}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 转录本信息 */}
              {rapdbInfo.transcripts && rapdbInfo.transcripts.length > 0 && (
                <div>
                  <span className="text-slate-500 font-medium">转录本:</span>
                  {rapdbInfo.transcripts.map((tx: any, i: number) => (
                    <div key={i} className="mt-1 text-slate-700">
                      <span className="font-mono text-indigo-600">{tx.name}</span>
                      {tx.symbol && <span className="ml-2 text-slate-500">({tx.symbol})</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* Oryzabase 信息 */}
              {rapdbInfo.oryzabase && Object.keys(rapdbInfo.oryzabase).length > 0 && (
                <div className="pt-2 border-t border-indigo-100">
                  <span className="text-slate-500 font-medium">Oryzabase 信息:</span>
                  <div className="mt-1 grid grid-cols-1 gap-1 text-[11px]">
                    {rapdbInfo.oryzabase.gene_symbol && (
                      <div><span className="text-slate-400">基因符号:</span> <span className="font-mono text-indigo-700 font-medium">{rapdbInfo.oryzabase.gene_symbol}</span></div>
                    )}
                    {rapdbInfo.oryzabase.gene_name && (
                      <div><span className="text-slate-400">基因名称:</span> <span className="text-slate-700">{rapdbInfo.oryzabase.gene_name}</span></div>
                    )}
                    {rapdbInfo.oryzabase.note && (
                      <div><span className="text-slate-400">功能描述:</span> <span className="text-slate-700">{rapdbInfo.oryzabase.note}</span></div>
                    )}
                    {rapdbInfo.oryzabase.oryzabase_gene_synonyms && (
                      <div><span className="text-slate-400">基因别名:</span> <span className="text-slate-600">{rapdbInfo.oryzabase.oryzabase_gene_synonyms}</span></div>
                    )}
                    {rapdbInfo.oryzabase.oryzabase_symbol_synonyms && (
                      <div><span className="text-slate-400">符号别名:</span> <span className="text-slate-600">{rapdbInfo.oryzabase.oryzabase_symbol_synonyms}</span></div>
                    )}
                    {rapdbInfo.oryzabase.literature && (
                      <div><span className="text-slate-400">文献:</span> <span className="text-slate-600 font-mono text-[10px]">{rapdbInfo.oryzabase.literature}</span></div>
                    )}
                    {rapdbInfo.oryzabase.interpro && (() => {
                      const interproArr = Array.isArray(rapdbInfo.oryzabase.interpro) ? rapdbInfo.oryzabase.interpro : String(rapdbInfo.oryzabase.interpro).split(/[;,]/).map((s: string) => s.trim()).filter(Boolean)
                      if (interproArr.length === 0) return null
                      return (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {interproArr.slice(0, 5).map((ip: string, i: number) => (
                            <span key={i} className="px-1 py-0.5 bg-purple-50 text-purple-600 border border-purple-200 rounded text-[9px]">{ip}</span>
                          ))}
                          {interproArr.length > 5 && <span className="text-[9px] text-slate-400">+{interproArr.length - 5} more</span>}
                        </div>
                      )
                    })()}
                    {rapdbInfo.oryzabase.go_terms && (() => {
                      const goArr = Array.isArray(rapdbInfo.oryzabase.go_terms) ? rapdbInfo.oryzabase.go_terms : String(rapdbInfo.oryzabase.go_terms).split(/[;,]/).map((s: string) => s.trim()).filter(Boolean)
                      if (goArr.length === 0) return null
                      return (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {goArr.slice(0, 4).map((go: string, i: number) => (
                            <span key={i} className="px-1 py-0.5 bg-blue-50 text-blue-600 border border-blue-200 rounded text-[9px]">{go}</span>
                          ))}
                          {goArr.length > 4 && <span className="text-[9px] text-slate-400">+{goArr.length - 4} more</span>}
                        </div>
                      )
                    })()}
                  </div>
                </div>
              )}

              {/* 表达数据（RiceXPro 图谱，下拉选择单个展示：图片可缩放 / 图表柱状图） */}
              {rapdbInfo.expression_categories && rapdbInfo.expression_categories.length > 0 && (() => {
                const categories = rapdbInfo.expression_categories
                const safeCatIdx = Math.min(rxpCatIdx, categories.length - 1)
                const currentCat = categories[safeCatIdx]
                const views = currentCat.views || currentCat.images || []
                const safeViewIdx = Math.min(rxpImgIdx, Math.max(0, views.length - 1))
                const currentView = views[safeViewIdx]
                const viewType = currentView?.type || 'image'
                return (
                  <div>
                    <span className="text-slate-500 font-medium">Expression (RiceXPro) 时空表达图谱（{categories.reduce((s: number, c: any) => s + ((c.views || c.images)?.length || 0), 0)} 个实验）:</span>
                    <button
                      onClick={async () => {
                        const zip = new JSZip()
                        const chartViews: Array<{ label: string; rxpId: string }> = []
                        categories.forEach((cat: any) => {
                          (cat.views || cat.images || []).forEach((v: any) => {
                            if ((v.type || 'image') === 'chart' && v.rxpId) chartViews.push({ label: v.label || v.id, rxpId: v.rxpId })
                          })
                        })
                        if (chartViews.length === 0) { alert('无图表型实验可导出'); return }
                        if (!window.confirm(`将导出 ${chartViews.length} 个图表型实验的 CSV 数据，确认？`)) return
                        for (const cv of chartViews) {
                          try {
                            const res: any = await window.api.fetchRAPDBExpression(annotation.source_accession, cv.rxpId)
                            if (res.success && res.data.data) {
                              const nums = res.data.data.split(' ').filter(Boolean).map(Number).filter((n: number) => !isNaN(n))
                              const lbls: string[] = res.data.sample_labels || []
                              const lines = ['Sample,Label,Value']
                              nums.forEach((v: number, i: number) => lines.push(`${i + 1},"${lbls[i] || i + 1}",${v.toFixed(2)}`))
                              zip.file(`${cv.rxpId}_${cv.label.replace(/[\\/:*?"<>|]/g, '_')}.csv`, lines.join('\n'))
                            }
                          } catch {}
                        }
                        const blob = await zip.generateAsync({ type: 'blob' })
                        downloadBlob(blob, `RiceXPro_${annotation.source_accession}_all.zip`)
                      }}
                      className="ml-2 px-1.5 py-0.5 text-[10px] text-indigo-600 border border-indigo-200 rounded hover:bg-indigo-50 inline-flex items-center gap-0.5"
                      title="批量导出所有图表型实验数据为 CSV（ZIP 打包）"
                    >
                      <Download size={10} /> 批量导出 ZIP
                    </button>
                    {/* 两级下拉选择器 */}
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <select
                        value={safeCatIdx}
                        onChange={(e) => { setRxpCatIdx(Number(e.target.value)); setRxpImgIdx(0); setRxpImgFailed(false) }}
                        className="px-2 py-1 text-xs border border-slate-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      >
                        {categories.map((cat: any, i: number) => (
                          <option key={cat.id} value={i}>{cat.name}</option>
                        ))}
                      </select>
                      <select
                        value={safeViewIdx}
                        onChange={(e) => { setRxpImgIdx(Number(e.target.value)); setRxpImgFailed(false) }}
                        className="px-2 py-1 text-xs border border-slate-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 max-w-[280px]"
                      >
                        {views.map((v: any, i: number) => (
                          <option key={v.id || i} value={i}>{v.label}</option>
                        ))}
                      </select>
                      {viewType === 'image' && <span className="text-[10px] text-slate-400">滚轮缩放 · 拖拽平移</span>}
                    </div>
                    {/* 当前选中的图谱 */}
                    <div className="mt-2 border border-slate-200 rounded-lg overflow-hidden">
                      {viewType === 'image' ? (
                        rxpImgFailed ? (
                          <div className="p-6 text-center text-xs text-slate-400">该图谱暂无数据（图片加载失败）</div>
                        ) : (
                          <ZoomableImage
                            key={`${safeCatIdx}-${safeViewIdx}`}
                            src={currentView.url}
                            alt={currentView.label}
                            footerUrl={currentView.footerUrl}
                            onImgError={() => setRxpImgFailed(true)}
                          />
                        )
                      ) : viewType === 'chart' ? (
                        chartLoading ? (
                          <div className="p-6 flex items-center justify-center gap-2 text-xs text-slate-400">
                            <Loader2 size={14} className="animate-spin" /> 加载表达数据...
                          </div>
                        ) : chartData && chartData.length > 0 ? (
                          <div>
                            <div className="flex items-center gap-1 mb-1 justify-end">
                              <button onClick={() => exportChartSVG(chartContainerRef.current, currentView.label)} className="px-1.5 py-0.5 text-[10px] text-slate-500 border rounded hover:bg-slate-50" title="导出 SVG">SVG</button>
                              <button onClick={() => exportChartPNG(chartContainerRef.current, currentView.label)} className="px-1.5 py-0.5 text-[10px] text-slate-500 border rounded hover:bg-slate-50" title="导出 PNG (2x)">PNG</button>
                              <button onClick={() => exportChartCSV(chartData, chartLabels, currentView.label, chartBoxData)} className="px-1.5 py-0.5 text-[10px] text-slate-500 border rounded hover:bg-slate-50" title="导出 CSV 数据">CSV</button>
                            </div>
                            <div ref={chartContainerRef}>
                              <ExpressionBarChart data={chartData} labels={chartLabels} label={currentView.label} boxData={chartBoxData} />
                            </div>
                          </div>
                        ) : (
                          <div className="p-6 text-center text-xs text-slate-400">该实验暂无表达数据</div>
                        )
                      ) : null}
                    </div>
                  </div>
                )
              })()}

              {/* 表达数值数据（补充） */}
              {rapdbInfo.expression_data && (
                <div>
                  <span className="text-slate-500 font-medium">表达数值 ({rapdbInfo.expression_rxp_name || 'RiceXPro'}):</span>
                  <p className="mt-1 p-2 bg-slate-50 rounded text-[10px] text-slate-600 font-mono max-h-20 overflow-auto">
                    {rapdbInfo.expression_data.split(' ').slice(0, 20).join(', ')}...
                  </p>
                </div>
              )}

              {/* 序列数据（FASTA 格式折叠面板） */}
              {rapdbInfo.sequence && (
                <div className="space-y-1 pt-2 border-t border-indigo-100">
                  <span className="text-slate-500 font-medium">序列数据:</span>
                  <details className="group">
                    <summary className="flex items-center justify-between p-1.5 bg-slate-50 rounded cursor-pointer hover:bg-slate-100 list-none">
                      <span className="text-slate-600">🧬 Genomic — {annotation.source_accession}</span>
                      <span className="flex items-center gap-1.5">
                        <span className="text-slate-800 font-mono">{rapdbInfo.sequence.length} bp</span>
                        <SeqCopyBtn text={`>${annotation.source_accession} genomic\n${rapdbInfo.sequence}`} />
                      </span>
                    </summary>
                    <pre className="mt-1 p-2 bg-slate-50 rounded font-mono text-[10px] text-slate-700 whitespace-pre-wrap break-all max-h-[200px] overflow-auto">{`>${annotation.source_accession} genomic\n${(rapdbInfo.sequence.match(/.{1,60}/g) || []).join('\n')}`}</pre>
                  </details>
                  {/* Transcript Variants 序列 */}
                  {rapdbInfo.transcript_variants && rapdbInfo.transcript_variants.length > 0 && rapdbInfo.transcript_variants.map((tv: any, vi: number) => (
                    <div key={vi} className="pl-2 border-l-2 border-indigo-200 space-y-1">
                      <details className="group">
                        <summary className="flex items-center justify-between p-1.5 bg-slate-50 rounded cursor-pointer hover:bg-slate-100 list-none">
                          <span className="text-slate-600">🧬 mRNA — {tv.variant_id}</span>
                          <span className="flex items-center gap-1.5">
                            <span className="text-slate-800 font-mono">{tv.mrna_length} bp</span>
                            <SeqCopyBtn text={`>${tv.variant_id} mRNA\n${tv.mrna_sequence}`} />
                          </span>
                        </summary>
                        <pre className="mt-1 p-2 bg-slate-50 rounded font-mono text-[10px] text-slate-700 whitespace-pre-wrap break-all max-h-[200px] overflow-auto">{`>${tv.variant_id} mRNA\n${(tv.mrna_sequence.match(/.{1,60}/g) || []).join('\n')}`}</pre>
                      </details>
                      <details className="group">
                        <summary className="flex items-center justify-between p-1.5 bg-indigo-50/50 rounded cursor-pointer hover:bg-indigo-100/50 list-none">
                          <span className="text-slate-600">🟦 CDS — {tv.variant_id}</span>
                          <span className="flex items-center gap-1.5">
                            <span className="text-slate-800 font-mono">{tv.cds_length} bp</span>
                            <SeqCopyBtn text={`>${tv.variant_id} CDS\n${tv.cds_sequence}`} />
                          </span>
                        </summary>
                        <pre className="mt-1 p-2 bg-slate-50 rounded font-mono text-[10px] text-slate-700 whitespace-pre-wrap break-all max-h-[200px] overflow-auto">{`>${tv.variant_id} CDS\n${(tv.cds_sequence.match(/.{1,60}/g) || []).join('\n')}`}</pre>
                      </details>
                      <details className="group">
                        <summary className="flex items-center justify-between p-1.5 bg-amber-50/50 rounded cursor-pointer hover:bg-amber-100/50 list-none">
                          <span className="text-slate-600">🟨 Protein — {tv.variant_id}</span>
                          <span className="flex items-center gap-1.5">
                            <span className="text-slate-800 font-mono">{tv.protein_length} aa</span>
                            <SeqCopyBtn text={`>${tv.variant_id} protein\n${tv.protein_sequence}`} />
                          </span>
                        </summary>
                        <pre className="mt-1 p-2 bg-slate-50 rounded font-mono text-[10px] text-slate-700 whitespace-pre-wrap break-all max-h-[200px] overflow-auto">{`>${tv.variant_id} protein\n${(tv.protein_sequence.match(/.{1,60}/g) || []).join('\n')}`}</pre>
                      </details>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 注释字段（仅显示 displayLocation=tab 的字段） */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-slate-800 mb-3">基因注释</h4>
        <div className="space-y-4">
          {fieldDefinitions
            .filter(field => !field.displayLocation || field.displayLocation === 'tab')
            .map(field => {
            const value = annotationData[field.name]
            if (!value || value.trim().length === 0) return null

            return (
              <div key={field.name}>
                <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                  {field.label}
                </label>
                {renderFieldValue(field, value)}
              </div>
            )
          })}
        </div>
      </div>

      {/* 额外外部链接（来自 external_links JSON） */}
      {Object.keys(externalLinks).length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-slate-800 mb-3">相关数据库</h4>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(externalLinks).map(([key, value]) => {
              if (!value || value.trim().length === 0) return null
              return (
                <div key={key}>
                  <span className="text-xs text-slate-500 font-medium">{key}</span>
                  <p className="text-xs text-slate-700 font-mono mt-0.5">{value}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
