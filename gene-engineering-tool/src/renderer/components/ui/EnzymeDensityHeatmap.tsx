import { useMemo, useState, useRef, useEffect, useCallback } from 'react'

interface EnzymeSite {
  position: number
  enzyme_name?: string
  is_unique: boolean
}

interface Props {
  /** 序列总长度 (bp) */
  sequenceLength: number
  /** 酶切位点列表 */
  enzymeSites: EnzymeSite[]
  /** 滑动窗口大小 (bp)，默认 100 */
  windowSize?: number
  /** 宽度 (px) */
  width?: number
  /** 高度 (px) */
  height?: number
  /** 点击某个窗口区域的回调 */
  onRegionClick?: (start: number, end: number) => void
}

/** 热力图颜色插值：0=白 → 低密度=蓝 → 中=黄 → 高=红 */
function densityColor(value: number, maxVal: number): string {
  if (maxVal <= 0 || value <= 0) return '#f8fafc'
  const t = Math.min(1, value / maxVal)
  if (t < 0.25) {
    const s = t / 0.25
    return `rgb(${Math.round(248 - s * 119)}, ${Math.round(250 - s * 67)}, ${Math.round(252 - s * 15)})`
  }
  if (t < 0.5) {
    const s = (t - 0.25) / 0.25
    return `rgb(${Math.round(129 + s * 126)}, ${Math.round(183 + s * 20)}, ${Math.round(237 - s * 128)})`
  }
  if (t < 0.75) {
    const s = (t - 0.5) / 0.25
    return `rgb(${Math.round(255 - s * 12)}, ${Math.round(203 - s * 50)}, ${Math.round(109 - s * 67)})`
  }
  const s = (t - 0.75) / 0.25
  return `rgb(${Math.round(243 - s * 24)}, ${Math.round(153 - s * 114)}, ${Math.round(42 - s * 4)})`
}

export default function EnzymeDensityHeatmap({
  sequenceLength, enzymeSites, windowSize = 100,
  width: propWidth, height = 80, onRegionClick
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(600)
  const [hoveredBin, setHoveredBin] = useState<number | null>(null)

  const width = propWidth || containerWidth
  const yAxisW = 36
  const plotW = width - yAxisW
  const barH = 24
  const legendH = 16
  const axisH = height - barH - legendH - 4

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

  // 分箱计算
  const { bins, maxDensity } = useMemo(() => {
    if (sequenceLength <= 0) return { bins: [], maxDensity: 0 }
    const numBins = Math.max(1, Math.ceil(sequenceLength / windowSize))
    const bins = new Array(numBins).fill(0)
    for (const site of enzymeSites) {
      const binIdx = Math.min(numBins - 1, Math.floor(site.position / windowSize))
      bins[binIdx]++
    }
    const maxDensity = Math.max(...bins, 1)
    return { bins, maxDensity }
  }, [sequenceLength, enzymeSites, windowSize])

  const binWidth = plotW / bins.length

  // 鼠标交互
  const getBinFromX = useCallback((clientX: number) => {
    const el = containerRef.current?.querySelector('svg')
    if (!el) return -1
    const rect = el.getBoundingClientRect()
    const x = clientX - rect.left - yAxisW
    const idx = Math.floor(x / binWidth)
    return idx >= 0 && idx < bins.length ? idx : -1
  }, [binWidth, bins.length])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const idx = getBinFromX(e.clientX)
    setHoveredBin(idx)
  }, [getBinFromX])

  const handleClick = useCallback((e: React.MouseEvent) => {
    const idx = getBinFromX(e.clientX)
    if (idx >= 0 && onRegionClick) {
      onRegionClick(idx * windowSize, Math.min((idx + 1) * windowSize, sequenceLength))
    }
  }, [getBinFromX, onRegionClick, windowSize, sequenceLength])

  // 刻度标签
  const ticks = useMemo(() => {
    const result: { x: number; label: string }[] = []
    if (bins.length <= 0) return result
    const step = bins.length < 10 ? 1 : bins.length < 30 ? 5 : bins.length < 60 ? 10 : 25
    for (let i = 0; i < bins.length; i += step) {
      result.push({
        x: yAxisW + i * binWidth + binWidth / 2,
        label: String(i * windowSize + 1)
      })
    }
    return result
  }, [bins.length, binWidth, windowSize])

  if (sequenceLength <= 0 || enzymeSites.length === 0) {
    return (
      <div className="text-xs text-slate-400 text-center py-2">
        无酶切位点数据
      </div>
    )
  }

  return (
    <div ref={containerRef} className="w-full select-none">
      <svg
        width={width}
        height={height}
        className="bg-white"
        style={{ cursor: hoveredBin !== null ? 'pointer' : 'default' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredBin(null)}
        onClick={handleClick}
      >
        {/* Y轴标签 */}
        <text x={yAxisW - 4} y={barH / 2 + 4} textAnchor="end" fontSize={8} fill="#94a3b8">
          密度
        </text>

        {/* 热力图条 */}
        {bins.map((count, i) => {
          const x = yAxisW + i * binWidth
          const color = densityColor(count, maxDensity)
          const isHovered = i === hoveredBin
          return (
            <g key={i}>
              <rect
                x={x} y={0}
                width={Math.max(0.5, binWidth - (bins.length > 100 ? 0 : 0.5))}
                height={barH}
                fill={color}
                stroke={isHovered ? '#1e293b' : 'none'}
                strokeWidth={isHovered ? 1.5 : 0}
              />
              {/* 高密度区域显示数字 */}
              {(binWidth > 14 || isHovered) && count > 0 && (
                <text
                  x={x + binWidth / 2}
                  y={barH / 2 + 3}
                  textAnchor="middle"
                  fontSize={binWidth > 18 ? 9 : 7}
                  fill={count / maxDensity > 0.6 ? 'white' : '#475569'}
                  fontWeight={isHovered ? 'bold' : 'normal'}
                >
                  {count}
                </text>
              )}
            </g>
          )
        })}

        {/* X轴刻度 */}
        {ticks.map((tick, i) => (
          <text key={i} x={tick.x} y={barH + axisH - 2}
            textAnchor="middle" fontSize={8} fill="#94a3b8">
            {tick.label}
          </text>
        ))}

        {/* 悬停信息 */}
        {hoveredBin !== null && hoveredBin < bins.length && (
          <g>
            <rect
              x={Math.min(yAxisW + hoveredBin * binWidth + binWidth + 4, width - 130)}
              y={0} width={125} height={barH}
              rx={3} fill="white" stroke="#e2e8f0" strokeWidth={1} opacity={0.95}
            />
            <text
              x={Math.min(yAxisW + hoveredBin * binWidth + binWidth + 8, width - 126)}
              y={10} fontSize={9} fill="#334155" fontFamily="monospace"
            >
              {hoveredBin * windowSize + 1}-{Math.min((hoveredBin + 1) * windowSize, sequenceLength)} bp
            </text>
            <text
              x={Math.min(yAxisW + hoveredBin * binWidth + binWidth + 8, width - 126)}
              y={20} fontSize={9} fill="#334155"
            >
              {bins[hoveredBin]} 个切点
            </text>
          </g>
        )}

        {/* 颜色图例 */}
        <g transform={`translate(${yAxisW}, ${barH + 2})`}>
          {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
            <rect key={i} x={plotW - 60 + i * 12} y={0} width={12} height={8}
              fill={densityColor(t * maxDensity, maxDensity)} stroke="#e2e8f0" strokeWidth={0.3} />
          ))}
          <text x={plotW - 64} y={7} textAnchor="end" fontSize={7} fill="#94a3b8">低</text>
          <text x={plotW - 60 + 60 + 2} y={7} fontSize={7} fill="#94a3b8">高</text>
        </g>
      </svg>
    </div>
  )
}
