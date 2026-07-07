import { useState, useRef, useCallback, useEffect, useMemo } from 'react'

interface TraceData {
  A: number[]
  C: number[]
  G: number[]
  T: number[]
}

interface Props {
  traces: TraceData
  peakPositions: number[]
  sequence: string
  qualityValues?: number[]
  /** 参考序列（来自 SEQ 文件），用于双序列对比 */
  referenceSequence?: string
  /** 参考序列来源文件名 */
  referenceSource?: string
  width?: number
  height?: number
}

const BASE_COLORS: Record<string, string> = {
  A: '#22c55e',
  C: '#3b82f6',
  G: '#1e293b',
  T: '#ef4444'
}

const QUALITY_COLOR = (q: number): string => {
  if (q >= 40) return '#22c55e'
  if (q >= 30) return '#3b82f6'
  if (q >= 20) return '#f59e0b'
  if (q >= 10) return '#f97316'
  return '#ef4444'
}

export default function ChromatogramViewer({
  traces, peakPositions, sequence, qualityValues,
  referenceSequence, referenceSource,
  width: propWidth, height = 380
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(800)
  // 视图范围使用数据点索引（与原始 trace 数据对齐）
  const [viewStart, setViewStart] = useState(0)
  const [viewEnd, setViewEnd] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStartX, setDragStartX] = useState(0)
  const [dragStartView, setDragStartView] = useState(0)
  const [selectedBase, setSelectedBase] = useState<number | null>(null)
  const [hoveredBase, setHoveredBase] = useState<number | null>(null)

  const width = propWidth || containerWidth
  const seqLen = sequence?.length || 0
  const hasRef = !!referenceSequence && referenceSequence.length > 0
  const hasPeaks = peakPositions && peakPositions.length > 0

  // 布局区域高度
  const bpLabelH = 22
  const refLabelH = hasRef ? 22 : 0
  const qualityH = 30
  const axisH = 18
  const plotTop = bpLabelH + refLabelH + 4
  const plotBottom = height - qualityH - axisH - 8
  const plotHeight = plotBottom - plotTop

  // 数据点总数
  const dataPoints = useMemo(() =>
    Math.max(traces.A?.length || 0, traces.C?.length || 0, traces.G?.length || 0, traces.T?.length || 0),
    [traces]
  )

  // ===== 核心：数据点索引 → 碱基位置（0-based）查找表 =====
  // 使用分段线性插值，在 peakPositions 之间线性映射
  const dpToBasePos = useMemo(() => {
    const total = traces.A?.length || 0
    if (total === 0 || !hasPeaks) return null
    const table = new Float64Array(total)
    const peaks = peakPositions
    const numPeaks = peaks.length
    for (let i = 0; i < total; i++) {
      if (i <= peaks[0]) {
        table[i] = 0
      } else if (i >= peaks[numPeaks - 1]) {
        table[i] = numPeaks - 1
      } else {
        // 二分查找 peakPositions 中 i 所在的区间
        let lo = 0, hi = numPeaks - 1
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1
          if (peaks[mid] <= i) lo = mid; else hi = mid
        }
        const frac = (i - peaks[lo]) / (peaks[hi] - peaks[lo])
        table[i] = lo + frac
      }
    }
    return table
  }, [traces, peakPositions, hasPeaks])

  // 自适应容器宽度
  useEffect(() => {
    if (propWidth) return
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width)
    })
    obs.observe(el)
    setContainerWidth(el.clientWidth)
    return () => obs.disconnect()
  }, [propWidth])

  // 初始化视图范围（数据点空间，显示前 80 个碱基对应的数据点范围）
  useEffect(() => {
    if (dataPoints > 0 && viewEnd === 0) {
      // 显示前 80 个碱基或全部
      const numBases = Math.min(seqLen || 80, 80)
      const endDp = hasPeaks && numBases < peakPositions.length
        ? Math.min(dataPoints, peakPositions[numBases] + 20)
        : Math.min(dataPoints, 2000)
      setViewStart(0)
      setViewEnd(endDp)
    }
  }, [dataPoints, seqLen])

  // X 坐标转换：数据点索引 → 像素
  const xScale = useCallback((dpIdx: number) => {
    return ((dpIdx - viewStart) / (viewEnd - viewStart)) * width
  }, [viewStart, viewEnd, width])

  // X 坐标反转换：像素 → 数据点索引
  const dpFromX = useCallback((x: number) => {
    return viewStart + (x / width) * (viewEnd - viewStart)
  }, [viewStart, viewEnd, width])

  // 碱基位置 → 像素（通过 peakPositions 映射到数据点空间）
  const baseToX = useCallback((baseIdx: number) => {
    if (!hasPeaks || baseIdx < 0 || baseIdx >= peakPositions.length) return -100
    return xScale(peakPositions[baseIdx])
  }, [xScale, peakPositions, hasPeaks])

  // 当前视图中的碱基范围
  const visibleBaseRange = useMemo(() => {
    if (!hasPeaks || peakPositions.length === 0) return { start: 0, end: 0 }
    let start = 0
    let end = peakPositions.length - 1
    for (let i = 0; i < peakPositions.length; i++) {
      if (peakPositions[i] >= viewStart) { start = Math.max(0, i - 1); break }
    }
    for (let i = peakPositions.length - 1; i >= 0; i--) {
      if (peakPositions[i] <= viewEnd) { end = Math.min(peakPositions.length - 1, i + 1); break }
    }
    return { start, end }
  }, [peakPositions, viewStart, viewEnd, hasPeaks])

  // 每碱基像素数
  const bpPerPixel = useMemo(() => {
    const range = visibleBaseRange.end - visibleBaseRange.start
    if (range <= 0) return width / 80
    return width / range
  }, [visibleBaseRange, width])

  const showBaseLabels = bpPerPixel > 6

  // 计算 Y 轴最大值
  const yMax = useMemo(() => {
    let max = 0
    const start = Math.max(0, Math.floor(viewStart))
    const end = Math.min(dataPoints, Math.ceil(viewEnd))
    for (let i = start; i < end; i++) {
      if (traces.A?.[i] > max) max = traces.A[i]
      if (traces.C?.[i] > max) max = traces.C[i]
      if (traces.G?.[i] > max) max = traces.G[i]
      if (traces.T?.[i] > max) max = traces.T[i]
    }
    return max * 1.1 || 1000
  }, [traces, viewStart, viewEnd, dataPoints])

  const yScale = useCallback((val: number) => {
    return plotBottom - (val / yMax) * plotHeight
  }, [yMax, plotBottom, plotHeight])

  // 生成 SVG path（使用查找表将数据点映射到碱基位置坐标）
  const makePath = useCallback((data: number[]) => {
    if (!data || data.length === 0 || !dpToBasePos) return ''
    const start = Math.max(0, Math.floor(viewStart))
    const end = Math.min(data.length, Math.ceil(viewEnd))
    const step = Math.max(1, Math.floor((end - start) / width))
    // 计算可见碱基范围用于像素映射
    const bStart = visibleBaseRange.start
    const bEnd = visibleBaseRange.end
    const bRange = bEnd - bStart || 1

    let d = ''
    let first = true
    for (let i = start; i < end; i += step) {
      const basePos = dpToBasePos[i]
      // 将碱基位置映射到像素（相对于可见碱基范围）
      const px = ((basePos - bStart) / bRange) * width
      const y = yScale(data[i])
      d += first ? `M${px},${y}` : `L${px},${y}`
      first = false
    }
    return d
  }, [viewStart, viewEnd, yScale, width, dpToBasePos, visibleBaseRange])

  // 可见碱基列表
  const visibleBases = useMemo(() => {
    if (!hasPeaks || !sequence) return []
    const bases: { idx: number; base: string; x: number }[] = []
    const { start, end } = visibleBaseRange
    for (let i = start; i <= end && i < seqLen; i++) {
      bases.push({ idx: i, base: sequence[i], x: baseToX(i) })
    }
    return bases
  }, [hasPeaks, sequence, visibleBaseRange, seqLen, baseToX])

  // 比对结果
  const mismatchMap = useMemo(() => {
    if (!referenceSequence || !sequence) return new Map<number, string>()
    const map = new Map<number, string>()
    const len = Math.min(sequence.length, referenceSequence.length)
    for (let i = 0; i < len; i++) {
      if (sequence[i].toUpperCase() !== referenceSequence[i].toUpperCase()) {
        map.set(i, referenceSequence[i])
      }
    }
    return map
  }, [sequence, referenceSequence])

  // 鼠标滚轮缩放（数据点空间）
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87
    const mouseDp = dpFromX(e.nativeEvent.offsetX)
    const range = viewEnd - viewStart
    const newRange = Math.max(50, Math.min(dataPoints, range * zoomFactor))
    const ratio = (mouseDp - viewStart) / range
    let newStart = mouseDp - ratio * newRange
    let newEnd = newStart + newRange
    if (newStart < 0) { newStart = 0; newEnd = newRange }
    if (newEnd > dataPoints) { newEnd = dataPoints; newStart = dataPoints - newRange }
    setViewStart(Math.max(0, newStart))
    setViewEnd(Math.min(dataPoints, newEnd))
  }, [viewStart, viewEnd, dataPoints, dpFromX])

  // 拖拽平移
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    setIsDragging(true)
    setDragStartX(e.clientX)
    setDragStartView(viewStart)
  }, [viewStart])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Hover 碱基
    const rect = (e.target as Element).closest('svg')?.getBoundingClientRect()
    if (rect && hasPeaks) {
      const x = e.clientX - rect.left
      const dpPos = dpFromX(x)
      // 找到最近的数据点对应的碱基
      const dpIdx = Math.round(dpPos)
      if (dpToBasePos && dpIdx >= 0 && dpIdx < dpToBasePos.length) {
        const baseIdx = Math.round(dpToBasePos[dpIdx])
        if (baseIdx >= 0 && baseIdx < seqLen) {
          const baseX = baseToX(baseIdx)
          if (Math.abs(baseX - x) < bpPerPixel * 0.6) {
            setHoveredBase(baseIdx)
          } else {
            setHoveredBase(null)
          }
        } else {
          setHoveredBase(null)
        }
      }
    }
    if (!isDragging) return
    const dx = e.clientX - dragStartX
    const dpDx = (dx / width) * (viewEnd - viewStart)
    const range = viewEnd - viewStart
    let newStart = dragStartView - dpDx
    let newEnd = newStart + range
    if (newStart < 0) { newStart = 0; newEnd = range }
    if (newEnd > dataPoints) { newEnd = dataPoints; newStart = dataPoints - range }
    setViewStart(Math.max(0, newStart))
    setViewEnd(Math.min(dataPoints, newEnd))
  }, [isDragging, dragStartX, dragStartView, viewStart, viewEnd, dataPoints, width, dpFromX, dpToBasePos, baseToX, bpPerPixel, seqLen, hasPeaks])

  const handleMouseUp = useCallback(() => { setIsDragging(false) }, [])

  const handleClick = useCallback(() => {
    if (hoveredBase !== null) {
      setSelectedBase(hoveredBase === selectedBase ? null : hoveredBase)
    }
  }, [hoveredBase, selectedBase])

  // X 轴刻度（碱基序号）
  const ticks = useMemo(() => {
    const result: { x: number; label: string }[] = []
    if (!hasPeaks) return result
    const { start, end } = visibleBaseRange
    const range = end - start
    const interval = range < 30 ? 5 : range < 80 ? 10 : range < 200 ? 25 : range < 500 ? 50 : 100
    const firstTick = Math.ceil((start + 1) / interval) * interval
    for (let b = firstTick; b <= end && b < peakPositions.length; b += interval) {
      result.push({ x: baseToX(b), label: String(b + 1) }) // 1-based
    }
    return result
  }, [visibleBaseRange, baseToX, peakPositions, hasPeaks])

  if (!traces || dataPoints === 0) {
    return <div className="text-sm text-slate-400 text-center py-4">无色谱数据</div>
  }

  const qualityBarH = qualityH - 6

  return (
    <div ref={containerRef} className="w-full select-none">
      <svg
        width={width}
        height={height}
        className="bg-white"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setIsDragging(false); setHoveredBase(null) }}
        onClick={handleClick}
      >
        {/* ===== 参考序列行（最顶部） ===== */}
        {hasRef && showBaseLabels && visibleBases.map(({ idx, x }) => {
          const refBase = idx < referenceSequence!.length ? referenceSequence![idx] : ''
          if (!refBase) return null
          const isMismatch = mismatchMap.has(idx)
          return (
            <text key={`ref-${idx}`}
              x={x} y={bpLabelH - 4}
              textAnchor="middle"
              fontSize={bpPerPixel < 9 ? 9 : 11}
              fontFamily="monospace"
              fontWeight={isMismatch ? 'bold' : 'normal'}
              fill={isMismatch ? '#dc2626' : '#94a3b8'}
            >
              {refBase.toUpperCase()}
            </text>
          )
        })}

        {/* ===== AB1 碱基字母行 ===== */}
        {showBaseLabels && visibleBases.map(({ idx, base, x }) => {
          const isMismatch = mismatchMap.has(idx)
          return (
            <text key={`base-${idx}`}
              x={x}
              y={bpLabelH + refLabelH - 4}
              textAnchor="middle"
              fontSize={bpPerPixel < 9 ? 10 : bpPerPixel < 14 ? 12 : 14}
              fontFamily="monospace"
              fontWeight="bold"
              fill={BASE_COLORS[base] || '#666'}
              opacity={idx === selectedBase ? 1 : idx === hoveredBase ? 0.9 : 0.75}
            >
              {base}
              {isMismatch && <tspan fill="#dc2626" fontSize={8}>✕</tspan>}
            </text>
          )
        })}

        {/* ===== 背景底线 ===== */}
        <line x1={0} y1={plotBottom} x2={width} y2={plotBottom} stroke="#e2e8f0" strokeWidth={1} />

        {/* ===== 峰位置竖线 ===== */}
        {showBaseLabels && visibleBases.map(({ idx, x }) => (
          <line key={`vl-${idx}`} x1={x} y1={plotTop} x2={x} y2={plotBottom}
            stroke={BASE_COLORS[sequence[idx]] || '#ccc'} strokeWidth={0.3} opacity={0.25} />
        ))}

        {/* ===== Trace 曲线 ===== */}
        {(['A', 'C', 'G', 'T'] as const).map(base => (
          <path key={base}
            d={makePath(traces[base])}
            fill="none"
            stroke={BASE_COLORS[base]}
            strokeWidth={1.3}
            opacity={0.85}
          />
        ))}

        {/* ===== 选中/悬停高亮 ===== */}
        {(selectedBase !== null || hoveredBase !== null) && (() => {
          const idx = selectedBase ?? hoveredBase
          if (idx === null || !hasPeaks || idx >= peakPositions.length) return null
          const x = baseToX(idx)
          return (
            <line x1={x} y1={0} x2={x} y2={height - axisH}
              stroke={BASE_COLORS[sequence[idx]] || '#666'} strokeWidth={1.5} opacity={0.5} strokeDasharray="3,2" />
          )
        })()}

        {/* ===== X 轴刻度（碱基序号） ===== */}
        {ticks.map((tick, i) => (
          <g key={i}>
            <line x1={tick.x} y1={plotBottom} x2={tick.x} y2={plotBottom + 4} stroke="#94a3b8" strokeWidth={0.5} />
            <text x={tick.x} y={plotBottom + axisH - 4} textAnchor="middle" fontSize={9} fill="#94a3b8">{tick.label}</text>
          </g>
        ))}

        {/* ===== 质量值条形图 ===== */}
        {qualityValues && qualityValues.length > 0 && showBaseLabels && visibleBases.map(({ idx, x }) => {
          const q = idx < qualityValues.length ? qualityValues[idx] : 0
          const barW = Math.max(2, bpPerPixel * 0.5)
          const barH = Math.max(1, (q / 60) * qualityBarH)
          return (
            <rect key={`q-${idx}`}
              x={x - barW / 2} y={height - axisH - barH}
              width={barW} height={barH}
              fill={QUALITY_COLOR(q)} opacity={0.6} rx={1}
            />
          )
        })}

        {/* ===== 质量值数字（放大时） ===== */}
        {qualityValues && qualityValues.length > 0 && bpPerPixel > 18 && visibleBases.map(({ idx, x }) => {
          const q = idx < qualityValues.length ? qualityValues[idx] : 0
          return (
            <text key={`qn-${idx}`} x={x} y={height - axisH - qualityBarH - 2}
              textAnchor="middle" fontSize={8} fill={QUALITY_COLOR(q)} fontWeight="bold">
              {q}
            </text>
          )
        })}

        {/* ===== 选中碱基信息气泡 ===== */}
        {selectedBase !== null && selectedBase < seqLen && (
          <g>
            <rect x={Math.min(baseToX(selectedBase) + 5, width - 200)} y={plotTop + 2}
              width={195} height={hasRef ? 42 : 26} rx={4} fill="white" stroke="#e2e8f0" strokeWidth={1} opacity={0.95} />
            <text x={Math.min(baseToX(selectedBase) + 10, width - 195)} y={plotTop + 16}
              fontSize={10} fontFamily="monospace" fill="#334155">
              #{selectedBase + 1} {sequence[selectedBase]}
              {qualityValues?.[selectedBase] != null ? `  Q:${qualityValues[selectedBase]}` : ''}
            </text>
            {hasRef && (
              <text x={Math.min(baseToX(selectedBase) + 10, width - 195)} y={plotTop + 34}
                fontSize={10} fontFamily="monospace"
                fill={mismatchMap.has(selectedBase) ? '#dc2626' : '#22c55e'}>
                Ref: {selectedBase < referenceSequence!.length ? referenceSequence![selectedBase] : '-'}
                {mismatchMap.has(selectedBase) ? ' (错配)' : ' (匹配)'}
              </text>
            )}
          </g>
        )}
      </svg>

      {/* 底部信息栏 */}
      <div className="flex items-center justify-between px-2 py-1 text-[10px] text-slate-400 bg-slate-50 rounded-b">
        <span>
          {seqLen} bases | 碱基 {visibleBaseRange.start + 1}-{visibleBaseRange.end + 1} / {dataPoints} 数据点
          {hasRef && <span className="ml-2 text-amber-600">Ref: {referenceSource} ({mismatchMap.size} 错配)</span>}
        </span>
        <div className="flex items-center gap-3">
          {(['A', 'C', 'G', 'T'] as const).map(base => (
            <span key={base} className="flex items-center gap-0.5">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: BASE_COLORS[base] }} />
              {base}
            </span>
          ))}
        </div>
        <span>滚轮缩放 | 拖拽平移 | 点击选中</span>
      </div>
    </div>
  )
}
