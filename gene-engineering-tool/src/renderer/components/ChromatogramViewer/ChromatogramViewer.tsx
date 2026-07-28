import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useLifecycleLog, useThrottledLog } from '../../hooks/useDebugLog'

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
  width: propWidth, height = 420
}: Props) {
  useLifecycleLog('ChromatogramViewer', { seqLen: sequence?.length, hasRef: !!referenceSequence })
  const throttledLog = useThrottledLog('ChromatogramViewer')
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

  const yAxisW = 42 // Y 轴预留宽度
  const width = propWidth || containerWidth
  const plotWidth = width - yAxisW // 实际绑图区宽度
  const seqLen = sequence?.length || 0
  const hasRef = !!referenceSequence && referenceSequence.length > 0
  const hasPeaks = peakPositions && peakPositions.length > 0

  // 布局区域高度（不再显示参考序列双行，只保留 AB1 碱基行）
  const bpLabelH = 22
  const refLabelH = 0
  const qualityH = 34 // 增加 4px 用于 Quality 标签
  const axisH = 18
  const plotTop = bpLabelH + refLabelH + 4
  const plotBottom = height - qualityH - axisH - 8
  const plotHeight = plotBottom - plotTop

  // 数据点总数
  const dataPoints = useMemo(() =>
    Math.max(traces.A?.length || 0, traces.C?.length || 0, traces.G?.length || 0, traces.T?.length || 0),
    [traces]
  )

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

  // 非 passive 的 wheel 事件监听（允许 preventDefault 阻止页面滚动）
  useEffect(() => {
    const svgEl = containerRef.current?.querySelector('svg')
    if (!svgEl) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87
      const rect = svgEl.getBoundingClientRect()
      const offsetX = e.clientX - rect.left
      const mouseDp = viewStart + ((offsetX - yAxisW) / plotWidth) * (viewEnd - viewStart)
      const range = viewEnd - viewStart
      const newRange = Math.max(50, Math.min(dataPoints, range * zoomFactor))
      const ratio = (mouseDp - viewStart) / range
      let newStart = mouseDp - ratio * newRange
      let newEnd = newStart + newRange
      if (newStart < 0) { newStart = 0; newEnd = newRange }
      if (newEnd > dataPoints) { newEnd = dataPoints; newStart = dataPoints - newRange }
      setViewStart(Math.max(0, newStart))
      setViewEnd(Math.min(dataPoints, newEnd))
    }
    svgEl.addEventListener('wheel', handler, { passive: false })
    return () => svgEl.removeEventListener('wheel', handler)
  }, [viewStart, viewEnd, dataPoints, yAxisW, plotWidth])

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

  // X 坐标转换：数据点索引 → 像素（相对于 Y 轴右侧绑图区）
  const xScale = useCallback((dpIdx: number) => {
    const range = viewEnd - viewStart
    if (range <= 0) return yAxisW // 视图未初始化时返回安全值
    return yAxisW + ((dpIdx - viewStart) / range) * plotWidth
  }, [viewStart, viewEnd, plotWidth, yAxisW])

  // X 坐标反转换：像素 → 数据点索引
  const dpFromX = useCallback((x: number) => {
    const range = viewEnd - viewStart
    if (range <= 0) return 0
    return viewStart + ((x - yAxisW) / plotWidth) * range
  }, [viewStart, viewEnd, plotWidth, yAxisW])

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
    if (range <= 0) return 0
    return plotWidth / range
  }, [visibleBaseRange, plotWidth])

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

  // 生成 SVG path — 自然曲线，逐点直线连接，真实反映原始 trace 信号
  const makePath = useCallback((data: number[]) => {
    if (!data || data.length === 0) return ''
    const start = Math.max(0, Math.floor(viewStart))
    const end = Math.min(data.length, Math.ceil(viewEnd))
    const range = viewEnd - viewStart
    if (range <= 0) return ''
    const step = Math.max(1, Math.floor((end - start) / plotWidth))

    let d = ''
    let first = true
    for (let i = start; i < end; i += step) {
      const px = xScale(i)
      const y = yScale(data[i])
      d += first ? `M${px},${y}` : `L${px},${y}`
      first = false
    }
    return d
  }, [viewStart, viewEnd, xScale, yScale, plotWidth])

  // 可见碱基列表 + 峰顶坐标（跳过 N 和 Q=0 被抑制峰）
  const visibleBases = useMemo(() => {
    if (!hasPeaks || !sequence) return []
    const bases: { idx: number; base: string; x: number; peakY: number }[] = []
    const { start, end } = visibleBaseRange
    for (let i = start; i <= end && i < seqLen; i++) {
      const base = sequence[i]
      if (base === 'N') continue
      if (qualityValues && qualityValues[i] === 0) continue // 套峰抑制
      const dpIdx = peakPositions[i]
      const traceVal = (traces as any)[base]?.[dpIdx] ?? 0
      bases.push({
        idx: i,
        base,
        x: baseToX(i),
        peakY: yScale(traceVal)
      })
    }
    return bases
  }, [hasPeaks, sequence, visibleBaseRange, seqLen, baseToX, peakPositions, traces, yScale, qualityValues])

  // 比对结果：局部对齐（查找最佳偏移量）
  const { mismatchMap, alignOffset } = useMemo(() => {
    if (!referenceSequence || !sequence) return { mismatchMap: new Map<number, string>(), alignOffset: -1 }

    const seqUp = sequence.toUpperCase()
    const refUp = referenceSequence.toUpperCase()
    const seqLen = sequence.length
    const refLen = referenceSequence.length

    let bestOffset = 0
    let bestScore = 0

    // 滑动窗口查找最佳偏移（AB1 序列中参考序列的起始位置）
    for (let offset = 0; offset <= seqLen - 30; offset++) {
      let score = 0
      const wLen = Math.min(50, refLen, seqLen - offset)
      for (let i = 0; i < wLen; i++) {
        if (seqUp[offset + i] === refUp[i]) score++
      }
      if (score > bestScore) { bestScore = score; bestOffset = offset }
    }

    // 也检查反向：参考序列中 AB1 的起始位置
    for (let offset = 1; offset <= refLen - 30; offset++) {
      let score = 0
      const wLen = Math.min(50, seqLen, refLen - offset)
      for (let i = 0; i < wLen; i++) {
        if (seqUp[i] === refUp[offset + i]) score++
      }
      if (score > bestScore) { bestScore = score; bestOffset = -offset }
    }

    // 阈值：至少 60% 匹配才认为比对成功
    if (bestScore < 18) return { mismatchMap: new Map<number, string>(), alignOffset: -1 }

    const map = new Map<number, string>()
    if (bestOffset >= 0) {
      // AB1[bestOffset + i] 对应 ref[i]
      for (let i = 0; i < refLen && (bestOffset + i) < seqLen; i++) {
        if (seqUp[bestOffset + i] !== refUp[i]) {
          map.set(bestOffset + i, refUp[i])
        }
      }
    } else {
      // ref[-bestOffset + i] 对应 AB1[i]
      const refStart = -bestOffset
      for (let i = 0; i < seqLen && (refStart + i) < refLen; i++) {
        if (seqUp[i] !== refUp[refStart + i]) {
          map.set(i, refUp[refStart + i])
        }
      }
    }

    return { mismatchMap: map, alignOffset: bestOffset }
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

  // 左右平移（按可见范围的 25%）
  const panBy = useCallback((direction: 'left' | 'right') => {
    const range = viewEnd - viewStart
    const step = range * 0.25 * (direction === 'left' ? -1 : 1)
    let newStart = viewStart + step
    let newEnd = viewEnd + step
    if (newStart < 0) { newStart = 0; newEnd = range }
    if (newEnd > dataPoints) { newEnd = dataPoints; newStart = dataPoints - range }
    setViewStart(Math.max(0, newStart))
    setViewEnd(Math.min(dataPoints, newEnd))
  }, [viewStart, viewEnd, dataPoints])

  // 缩放到指定碱基数（使用实际 peakPositions 计算数据点范围）
  const zoomToBases = useCallback((numBases: number) => {
    if (!hasPeaks || peakPositions.length === 0) return
    // 计算当前视图中心对应的碱基索引
    const centerDp = (viewStart + viewEnd) / 2
    // 找到中心最近的碱基
    let centerBaseIdx = 0
    for (let i = 0; i < peakPositions.length; i++) {
      if (peakPositions[i] >= centerDp) { centerBaseIdx = i; break }
    }
    const halfBases = Math.floor(numBases / 2)
    const startBase = Math.max(0, centerBaseIdx - halfBases)
    const endBase = Math.min(peakPositions.length - 1, startBase + numBases)
    let newStart = startBase > 0 ? peakPositions[startBase] - 10 : 0
    let newEnd = endBase < peakPositions.length - 1 ? peakPositions[endBase] + 10 : dataPoints
    if (newEnd - newStart < 50) newEnd = newStart + 50
    setViewStart(Math.max(0, newStart))
    setViewEnd(Math.min(dataPoints, newEnd))
  }, [viewStart, viewEnd, dataPoints, hasPeaks, peakPositions])

  // 键盘支持
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { panBy('left'); e.preventDefault() }
      else if (e.key === 'ArrowRight') { panBy('right'); e.preventDefault() }
      else if (e.key === '+' || e.key === '=') { handleWheel({ preventDefault: () => {}, deltaY: -100, nativeEvent: { offsetX: yAxisW + plotWidth / 2 } } as any); e.preventDefault() }
      else if (e.key === '-') { handleWheel({ preventDefault: () => {}, deltaY: 100, nativeEvent: { offsetX: yAxisW + plotWidth / 2 } } as any); e.preventDefault() }
    }
    el.addEventListener('keydown', handler)
    return () => el.removeEventListener('keydown', handler)
  }, [panBy, handleWheel, yAxisW, plotWidth])

  // 拖拽平移
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    setIsDragging(true)
    setDragStartX(e.clientX)
    setDragStartView(viewStart)
  }, [viewStart])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Hover 碱基：找到鼠标位置最近的数据点，再找最近的峰位
    const rect = (e.target as Element).closest('svg')?.getBoundingClientRect()
    if (rect && hasPeaks) {
      const x = e.clientX - rect.left
      const dpPos = dpFromX(x)
      // 二分查找最近的峰位
      let lo = 0, hi = peakPositions.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (peakPositions[mid] < dpPos) lo = mid + 1; else hi = mid
      }
      // 比较 lo 和 lo-1 哪个更近
      let baseIdx = lo
      if (lo > 0 && Math.abs(peakPositions[lo - 1] - dpPos) < Math.abs(peakPositions[lo] - dpPos)) {
        baseIdx = lo - 1
      }
      if (baseIdx >= 0 && baseIdx < seqLen) {
        const baseX = baseToX(baseIdx)
        if (Math.abs(baseX - x) < Math.max(bpPerPixel * 0.6, 8)) {
          setHoveredBase(baseIdx)
        } else {
          setHoveredBase(null)
        }
      } else {
        setHoveredBase(null)
      }
    }
    if (!isDragging) return
    const dx = e.clientX - dragStartX
    const dpDx = (dx / plotWidth) * (viewEnd - viewStart)
    const range = viewEnd - viewStart
    let newStart = dragStartView - dpDx
    let newEnd = newStart + range
    if (newStart < 0) { newStart = 0; newEnd = range }
    if (newEnd > dataPoints) { newEnd = dataPoints; newStart = dataPoints - range }
    setViewStart(Math.max(0, newStart))
    setViewEnd(Math.min(dataPoints, newEnd))
  }, [isDragging, dragStartX, dragStartView, viewStart, viewEnd, dataPoints, plotWidth, dpFromX, peakPositions, baseToX, bpPerPixel, seqLen, hasPeaks])

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

  // Y 轴刻度（荧光强度）
  const yTicks = useMemo(() => {
    const result: { y: number; label: string }[] = []
    if (yMax <= 0) return result
    // 计算合适的刻度间距
    const rawStep = yMax / 5
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)))
    const residual = rawStep / magnitude
    const niceStep = residual <= 1.5 ? magnitude : residual <= 3 ? 2 * magnitude : residual <= 7 ? 5 * magnitude : 10 * magnitude
    for (let v = 0; v <= yMax; v += niceStep) {
      result.push({ y: yScale(v), label: v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)) })
    }
    return result
  }, [yMax, yScale])

  if (!traces || dataPoints === 0) {
    return <div className="text-sm text-slate-400 text-center py-4">无色谱数据</div>
  }

  const qualityBarH = qualityH - 6

  return (
    <div ref={containerRef} className="w-full select-none" tabIndex={0} style={{ outline: 'none' }}>
      <svg
        width={width}
        height={height}
        className="bg-white"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setIsDragging(false); setHoveredBase(null) }}
        onClick={handleClick}
      >
        {/* ===== Y 轴（荧光强度） ===== */}
        <line x1={yAxisW} y1={plotTop} x2={yAxisW} y2={plotBottom} stroke="#cbd5e1" strokeWidth={1} />
        {yTicks.map((tick, i) => (
          <g key={`yt-${i}`}>
            <line x1={yAxisW - 4} y1={tick.y} x2={yAxisW} y2={tick.y} stroke="#94a3b8" strokeWidth={0.5} />
            <line x1={yAxisW} y1={tick.y} x2={width} y2={tick.y} stroke="#f1f5f9" strokeWidth={0.5} />
            <text x={yAxisW - 6} y={tick.y + 3} textAnchor="end" fontSize={9} fill="#94a3b8" fontFamily="monospace">{tick.label}</text>
          </g>
        ))}
        <text x={2} y={plotTop + plotHeight / 2} fontSize={9} fill="#94a3b8" transform={`rotate(-90, 8, ${plotTop + plotHeight / 2})`} textAnchor="middle">Intensity</text>

        {/* ===== AB1 碱基字母行（唯一的碱基行） ===== */}
        {showBaseLabels && visibleBases.map(({ idx, base, x }) => {
          return (
            <text key={`base-${idx}`}
              x={x}
              y={bpLabelH - 4}
              textAnchor="middle"
              fontSize={bpPerPixel < 9 ? 10 : bpPerPixel < 14 ? 12 : 14}
              fontFamily="monospace"
              fontWeight="bold"
              fill={BASE_COLORS[base] || '#666'}
              opacity={idx === selectedBase ? 1 : idx === hoveredBase ? 0.9 : 0.75}
            >
              {base}
            </text>
          )
        })}

        {/* ===== 背景底线 ===== */}
        <line x1={yAxisW} y1={plotBottom} x2={width} y2={plotBottom} stroke="#e2e8f0" strokeWidth={1} />
        {/* 顶部边界线 */}
        <line x1={yAxisW} y1={plotTop} x2={width} y2={plotTop} stroke="#f1f5f9" strokeWidth={0.5} />

        {/* ===== 峰位置竖线（曲线下方） ===== */}
        {visibleBases.map(({ idx, base, x }) => {
          const color = BASE_COLORS[base] || '#ccc'
          if (showBaseLabels) {
            // 放大时：细竖线标记每个碱基位置
            return <line key={`vl-${idx}`} x1={x} y1={plotTop} x2={x} y2={plotBottom}
              stroke={color} strokeWidth={0.3} opacity={0.15} />
          }
          // 缩小时：淡色峰位标记
          return <line key={`vl-${idx}`} x1={x} y1={plotTop} x2={x} y2={plotBottom}
            stroke={color} strokeWidth={0.4} opacity={0.12} />
        })}

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

        {/* ===== 峰顶标记点（渲染在曲线之上） ===== */}
        {visibleBases.map(({ idx, base, x, peakY }) => {
          const color = BASE_COLORS[base] || '#ccc'
          const isActive = idx === selectedBase || idx === hoveredBase
          if (!showBaseLabels) return null
          return (
            <g key={`pd-${idx}`}>
              <line x1={x} y1={peakY} x2={x} y2={bpLabelH + refLabelH}
                stroke={color} strokeWidth={isActive ? 1.2 : 0.6} opacity={isActive ? 0.7 : 0.3} strokeDasharray={isActive ? 'none' : '2,2'} />
              <circle cx={x} cy={peakY} r={isActive ? 4 : 2.5} fill={color} opacity={isActive ? 1 : 0.7} stroke="white" strokeWidth={isActive ? 1.5 : 0.8} />
            </g>
          )
        })}

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
          <g key={`xt-${i}`}>
            <line x1={tick.x} y1={plotBottom} x2={tick.x} y2={plotBottom + 4} stroke="#94a3b8" strokeWidth={0.5} />
            <text x={tick.x} y={plotBottom + axisH - 4} textAnchor="middle" fontSize={9} fill="#94a3b8">{tick.label}</text>
          </g>
        ))}

        {/* ===== 连续质量色带（始终可见，不依赖缩放级别） ===== */}
        {qualityValues && qualityValues.length > 0 && (() => {
          const bandY = height - axisH - qualityBarH
          const { start, end } = visibleBaseRange
          const rects: JSX.Element[] = []
          for (let i = start; i <= end && i < seqLen && i < qualityValues.length; i++) {
            const q = qualityValues[i]
            if (q === 0 && sequence?.[i] === 'N') continue
            const x1 = i > 0 ? (baseToX(i - 1) + baseToX(i)) / 2 : baseToX(i) - bpPerPixel / 2
            const x2 = i < end && i < seqLen - 1 ? (baseToX(i) + baseToX(i + 1)) / 2 : baseToX(i) + bpPerPixel / 2
            const rx = Math.max(yAxisW, Math.min(x1, width))
            const rw = Math.max(0.5, Math.min(x2, width) - rx)
            rects.push(
              <rect key={`qb-${i}`} x={rx} y={bandY} width={rw} height={qualityBarH}
                fill={QUALITY_COLOR(q)} opacity={0.35} />
            )
          }
          return (
            <g>
              {rects}
              {/* 色带边框 */}
              <rect x={yAxisW} y={bandY} width={plotWidth} height={qualityBarH}
                fill="none" stroke="#e2e8f0" strokeWidth={0.5} />
              {/* 质量阈值参考线 (Q20) */}
              <line x1={yAxisW} y1={bandY + qualityBarH * (1 - 20 / 60)}
                x2={width} y2={bandY + qualityBarH * (1 - 20 / 60)}
                stroke="#f59e0b" strokeWidth={0.5} strokeDasharray="3,3" opacity={0.5} />
            </g>
          )
        })()}

        {/* ===== 质量值标签 ===== */}
        {qualityValues && qualityValues.length > 0 && (
          <text x={yAxisW - 6} y={height - axisH - qualityBarH / 2 + 3} textAnchor="end" fontSize={8} fill="#94a3b8" fontFamily="monospace">Q</text>
        )}

        {/* ===== 质量值条形图（放大时叠加在色带上） ===== */}
        {qualityValues && qualityValues.length > 0 && showBaseLabels && visibleBases.map(({ idx, x }) => {
          const q = idx < qualityValues.length ? qualityValues[idx] : 0
          const barW = Math.max(2, bpPerPixel * 0.5)
          const barH = Math.max(1, (q / 60) * qualityBarH)
          return (
            <rect key={`q-${idx}`}
              x={x - barW / 2} y={height - axisH - barH}
              width={barW} height={barH}
              fill={QUALITY_COLOR(q)} opacity={0.7} rx={1}
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
            <rect x={Math.min(baseToX(selectedBase) + 5, width - 210)} y={plotTop + 2}
              width={200} height={hasRef && alignOffset >= 0 ? 42 : 26} rx={4} fill="white" stroke="#e2e8f0" strokeWidth={1} opacity={0.95} />
            <text x={Math.min(baseToX(selectedBase) + 10, width - 205)} y={plotTop + 16}
              fontSize={10} fontFamily="monospace" fill="#334155">
              #{selectedBase + 1} {sequence[selectedBase]}
              {qualityValues?.[selectedBase] != null ? `  Q:${qualityValues[selectedBase]}` : ''}
            </text>
            {hasRef && alignOffset >= 0 && (() => {
              const refIdx = selectedBase - alignOffset
              if (refIdx < 0 || refIdx >= referenceSequence!.length) return null
              return (
                <text x={Math.min(baseToX(selectedBase) + 10, width - 205)} y={plotTop + 34}
                  fontSize={10} fontFamily="monospace"
                  fill={mismatchMap.has(selectedBase) ? '#dc2626' : '#22c55e'}>
                  Ref: {referenceSequence![refIdx]}
                  {mismatchMap.has(selectedBase) ? ' (错配)' : ' (匹配)'}
                </text>
              )
            })()}
          </g>
        )}
      </svg>

      {/* 底部导航控制栏 */}
      <div className="flex items-center justify-between px-2 py-1.5 text-[10px] text-slate-500 bg-slate-50 border-t border-slate-100 gap-2">
        {/* 左侧：视图控制按钮 */}
        <div className="flex items-center gap-1">
          <button onClick={() => panBy('left')} className="px-2 py-0.5 rounded border border-slate-200 hover:bg-slate-100 active:bg-slate-200 text-slate-600" title="向左平移 (←)">
            ◀
          </button>
          <button onClick={() => panBy('right')} className="px-2 py-0.5 rounded border border-slate-200 hover:bg-slate-100 active:bg-slate-200 text-slate-600" title="向右平移 (→)">
            ▶
          </button>
          <div className="w-px h-4 bg-slate-200 mx-1" />
          <button onClick={() => zoomToBases(20)} className="px-1.5 py-0.5 rounded border border-slate-200 hover:bg-slate-100 active:bg-slate-200 text-slate-600 text-[9px]" title="缩放到 20bp">
            20bp
          </button>
          <button onClick={() => zoomToBases(50)} className="px-1.5 py-0.5 rounded border border-slate-200 hover:bg-slate-100 active:bg-slate-200 text-slate-600 text-[9px]" title="缩放到 50bp">
            50bp
          </button>
          <button onClick={() => zoomToBases(100)} className="px-1.5 py-0.5 rounded border border-slate-200 hover:bg-slate-100 active:bg-slate-200 text-slate-600 text-[9px]" title="缩放到 100bp">
            100bp
          </button>
          <button onClick={() => { setViewStart(0); setViewEnd(dataPoints) }} className="px-1.5 py-0.5 rounded border border-slate-200 hover:bg-slate-100 active:bg-slate-200 text-slate-600 text-[9px]" title="显示全部">
            全部
          </button>
        </div>

        {/* 中间：状态信息 */}
        <span className="truncate">
          {seqLen} bases | 碱基 {visibleBaseRange.start + 1}-{visibleBaseRange.end + 1} / {dataPoints} 数据点
          {hasRef && alignOffset >= 0 && <span className="ml-2 text-amber-600">Ref: {referenceSource} (偏移{alignOffset}, {mismatchMap.size} 错配)</span>}
          {hasRef && alignOffset < 0 && <span className="ml-2 text-slate-400">Ref: {referenceSource} (未比对)</span>}
        </span>

        {/* 右侧：图例 */}
        <div className="flex items-center gap-2">
          {(['A', 'C', 'G', 'T'] as const).map(base => (
            <span key={base} className="flex items-center gap-0.5">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: BASE_COLORS[base] }} />
              {base}
            </span>
          ))}
          {qualityValues && qualityValues.length > 0 && (
            <>
              <span className="w-px h-3 bg-slate-200" />
              <span className="flex items-center gap-0.5">
                <span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: '#22c55e' }} />Q≥40
              </span>
              <span className="flex items-center gap-0.5">
                <span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: '#3b82f6' }} />≥30
              </span>
              <span className="flex items-center gap-0.5">
                <span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: '#f59e0b' }} />≥20
              </span>
              <span className="flex items-center gap-0.5">
                <span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: '#ef4444' }} />&lt;10
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
