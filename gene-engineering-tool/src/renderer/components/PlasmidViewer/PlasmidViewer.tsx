import { useState, useMemo, useRef, useCallback } from 'react'
import type { GenBankRecord, GenBankFeature } from '../../../shared/types'

interface Props {
  record: GenBankRecord
  viewMode: 'circular' | 'linear'
}

const FEATURE_COLORS: Record<string, string> = {
  gene: '#10b981',
  CDS: '#3b82f6',
  mRNA: '#06b6d4',
  promoter: '#f59e0b',
  terminator: '#ef4444',
  rep_origin: '#8b5cf6',
  misc_feature: '#94a3b8',
  primer_bind: '#ec4899',
  protein_bind: '#6366f1',
  regulatory: '#f97316',
  source: '#9ca3af',
  exon: '#14b8a6',
  intron: '#a3a3a3',
  five_prime_UTR: '#84cc16',
  three_prime_UTR: '#e879f9',
  enhancer: '#fbbf24',
  sig_peptide: '#f97316',
  polyA_signal: '#eab308',
  STS: '#64748b',
  ncRNA: '#06b6d4',
  misc_RNA: '#06b6d4',
  misc_binding: '#64748b',
  misc_difference: '#94a3b8',
  misc_recomb: '#8b5cf6',
  ori: '#8b5cf6',
  antibiotic_resistance: '#ef4444'
}

function getColor(type: string): string {
  return FEATURE_COLORS[type] || '#cbd5e1'
}

export default function PlasmidViewer({ record, viewMode }: Props) {
  const [hoveredFeature, setHoveredFeature] = useState<number | null>(null)
  const [hoveredTick, setHoveredTick] = useState<number | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const size = record.size
  const visibleFeatures = useMemo(() =>
    record.features.filter(f => f.type !== 'source' && (f.end - f.start) > 0),
    [record.features]
  )

  if (viewMode === 'circular') {
    return <CircularView
      record={record}
      features={visibleFeatures}
      hoveredFeature={hoveredFeature}
      setHoveredFeature={setHoveredFeature}
      hoveredTick={hoveredTick}
      setHoveredTick={setHoveredTick}
      tooltip={tooltip}
      setTooltip={setTooltip}
      svgRef={svgRef}
    />
  }

  return <LinearView
    record={record}
    features={visibleFeatures}
    hoveredFeature={hoveredFeature}
    setHoveredFeature={setHoveredFeature}
    tooltip={tooltip}
    setTooltip={setTooltip}
    svgRef={svgRef}
  />
}

// ============ Circular View ============
function CircularView({
  record, features, hoveredFeature, setHoveredFeature, hoveredTick, setHoveredTick, tooltip, setTooltip, svgRef
}: {
  record: GenBankRecord
  features: GenBankFeature[]
  hoveredFeature: number | null
  setHoveredFeature: (i: number | null) => void
  hoveredTick: number | null
  setHoveredTick: (i: number | null) => void
  tooltip: { x: number; y: number; text: string } | null
  setTooltip: (t: { x: number; y: number; text: string } | null) => void
  svgRef: React.RefObject<SVGSVGElement>
}) {
  const cx = 400, cy = 380, radius = 240
  const featureRadiusOuter = 280
  const featureRadiusInner = 250

  const posToAngle = useCallback((pos: number) => {
    return (pos / record.size) * 360 - 90
  }, [record.size])

  const polarToCart = useCallback((angleDeg: number, r: number) => {
    const rad = (angleDeg * Math.PI) / 180
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
  }, [cx, cy])

  const describeArc = useCallback((startAngle: number, endAngle: number, innerR: number, outerR: number) => {
    const start1 = polarToCart(startAngle, outerR)
    const end1 = polarToCart(endAngle, outerR)
    const start2 = polarToCart(endAngle, innerR)
    const end2 = polarToCart(startAngle, innerR)
    const largeArc = endAngle - startAngle > 180 ? 1 : 0

    return [
      `M ${start1.x} ${start1.y}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${end1.x} ${end1.y}`,
      `L ${start2.x} ${start2.y}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${end2.x} ${end2.y}`,
      'Z'
    ].join(' ')
  }, [polarToCart])

  // Scale ticks
  const ticks = useMemo(() => {
    const interval = record.size > 20000 ? 5000 : record.size > 5000 ? 1000 : record.size > 1000 ? 500 : 100
    const result: { pos: number; angle: number }[] = []
    for (let p = 0; p < record.size; p += interval) {
      result.push({ pos: p, angle: posToAngle(p) })
    }
    return result
  }, [record.size, posToAngle])

  return (
    <svg ref={svgRef} viewBox="0 0 800 760" className="w-full h-full" style={{ minHeight: '600px' }}>
      {/* Background circle (backbone) */}
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#e2e8f0" strokeWidth={3} />

      {/* Scale ticks */}
      {ticks.map((tick, i) => {
        const p1 = polarToCart(tick.angle, radius - 8)
        const p2 = polarToCart(tick.angle, radius + 8)
        const labelPos = polarToCart(tick.angle, radius - 25)
        const isHovered = hoveredTick === i
        return (
          <g key={i}
            onMouseEnter={() => { setHoveredTick(i); setTooltip({ x: p2.x, y: p2.y - 15, text: `${tick.pos.toLocaleString()} bp` }) }}
            onMouseLeave={() => { setHoveredTick(null); setTooltip(null) }}>
            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={isHovered ? '#3b82f6' : '#94a3b8'} strokeWidth={isHovered ? 2 : 1} />
            <text x={labelPos.x} y={labelPos.y} textAnchor="middle" dominantBaseline="middle"
              className="text-[9px] fill-slate-400 select-none">{tick.pos >= 1000 ? `${(tick.pos/1000).toFixed(tick.pos % 1000 ? 1 : 0)}k` : tick.pos}</text>
          </g>
        )
      })}

      {/* Features */}
      {features.map((feature, i) => {
        const startAngle = posToAngle(feature.start)
        const endAngle = posToAngle(feature.end)
        const isHovered = hoveredFeature === i

        // Handle wrap-around
        let ea = endAngle
        if (ea < startAngle) ea += 360

        const strandOffset = feature.strand === -1 ? 4 : 0
        const innerR = featureRadiusInner + strandOffset
        const outerR = featureRadiusOuter + strandOffset

        const color = getColor(feature.type)
        const label = feature.qualifiers.label || feature.qualifiers.gene || feature.qualifiers.product || feature.type

        // Direction arrow at midpoint
        const midAngle = (startAngle + ea) / 2
        const arrowR = (innerR + outerR) / 2
        const arrowPos = polarToCart(midAngle, arrowR)

        const path = describeArc(startAngle, ea, innerR, outerR)

        return (
          <g key={i}
            onMouseEnter={() => { setHoveredFeature(i); setTooltip({ x: arrowPos.x, y: arrowPos.y - 20, text: `${label} (${feature.type})\n${feature.start + 1}..${feature.end + 1} bp` }) }}
            onMouseLeave={() => { setHoveredFeature(null); setTooltip(null) }}
            className="cursor-pointer">
            <path d={path} fill={color} opacity={isHovered ? 0.95 : 0.7} stroke={isHovered ? '#1e293b' : color} strokeWidth={isHovered ? 1.5 : 0.5} />
            {/* Arrow for direction */}
            {(ea - startAngle) > 10 && (
              <polygon
                points={getArrowPoints(arrowPos, midAngle, feature.strand, 6)}
                fill="white" opacity={0.8}
              />
            )}
          </g>
        )
      })}

      {/* Center info */}
      <text x={cx} y={cy - 15} textAnchor="middle" className="text-sm font-bold fill-slate-700">{record.name}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" className="text-xs fill-slate-400">{record.size.toLocaleString()} bp</text>
      <text x={cx} y={cy + 28} textAnchor="middle" className="text-[10px] fill-slate-400">{record.topology === 'circular' ? '环形' : '线性'}</text>

      {/* Feature legend */}
      <Legend features={features} x={20} y={650} />

      {/* Tooltip */}
      {tooltip && (
        <g>
          <rect x={tooltip.x - 80} y={tooltip.y - 25} width={160} height={35} rx={4} fill="#1e293b" opacity={0.9} />
          {tooltip.text.split('\n').map((line, i) => (
            <text key={i} x={tooltip.x} y={tooltip.y - 12 + i * 14} textAnchor="middle" className="text-[10px] fill-white">{line}</text>
          ))}
        </g>
      )}
    </svg>
  )
}

// ============ Linear View ============
function LinearView({
  record, features, hoveredFeature, setHoveredFeature, tooltip, setTooltip, svgRef
}: {
  record: GenBankRecord
  features: GenBankFeature[]
  hoveredFeature: number | null
  setHoveredFeature: (i: number | null) => void
  tooltip: { x: number; y: number; text: string } | null
  setTooltip: (t: { x: number; y: number; text: string } | null) => void
  svgRef: React.RefObject<SVGSVGElement>
}) {
  const width = 900
  const marginLeft = 50, marginRight = 50
  const trackY = 200, trackHeight = 6
  const usableWidth = width - marginLeft - marginRight

  const posToX = useCallback((pos: number) => {
    return marginLeft + (pos / record.size) * usableWidth
  }, [record.size, usableWidth, marginLeft])

  // Ticks
  const ticks = useMemo(() => {
    const interval = record.size > 20000 ? 5000 : record.size > 5000 ? 1000 : record.size > 1000 ? 500 : 100
    const result: { pos: number; x: number }[] = []
    for (let p = 0; p <= record.size; p += interval) {
      result.push({ pos: p, x: posToX(p) })
    }
    return result
  }, [record.size, posToX])

  // Assign feature rows to avoid overlap
  const featureRows = useMemo(() => {
    const rows: number[] = []
    const sorted = [...features].sort((a, b) => a.start - b.start)
    const rowEnds: number[] = []

    sorted.forEach((_, idx) => {
      const f = sorted[idx]
      let row = 0
      while (row < rowEnds.length && rowEnds[row] > f.start) row++
      rows[idx] = row
      rowEnds[row] = f.end
    })

    return sorted.map((f, i) => ({ feature: f, row: rows[i], origIdx: features.indexOf(f) }))
  }, [features])

  const maxRow = Math.max(0, ...featureRows.map(fr => fr.row))
  const svgHeight = Math.max(400, trackY + 60 + (maxRow + 1) * 28 + 80)

  return (
    <svg ref={svgRef} viewBox={`0 0 ${width} ${svgHeight}`} className="w-full h-full" style={{ minHeight: '400px' }}>
      {/* Title */}
      <text x={width / 2} y={30} textAnchor="middle" className="text-sm font-bold fill-slate-700">
        {record.name} - {record.size.toLocaleString()} bp
      </text>

      {/* Scale ticks */}
      {ticks.map((tick, i) => (
        <g key={i}>
          <line x1={tick.x} y1={trackY - 10} x2={tick.x} y2={trackY + trackHeight + 10} stroke="#cbd5e1" strokeWidth={1} />
          <text x={tick.x} y={trackY - 16} textAnchor="middle" className="text-[9px] fill-slate-400">
            {tick.pos >= 1000 ? `${(tick.pos/1000).toFixed(tick.pos % 1000 ? 1 : 0)}k` : tick.pos}
          </text>
        </g>
      ))}

      {/* Backbone line */}
      <line x1={marginLeft} y1={trackY + trackHeight / 2} x2={width - marginRight} y2={trackY + trackHeight / 2}
        stroke="#64748b" strokeWidth={trackHeight} strokeLinecap="round" />

      {/* Features below the backbone */}
      {featureRows.map(({ feature, row, origIdx }, i) => {
        const x1 = posToX(feature.start)
        const x2 = posToX(feature.end)
        const y = trackY + 50 + row * 28
        const isHovered = hoveredFeature === origIdx
        const color = getColor(feature.type)
        const label = feature.qualifiers.label || feature.qualifiers.gene || feature.qualifiers.product || feature.type
        const barWidth = Math.max(x2 - x1, 4)

        return (
          <g key={i}
            onMouseEnter={() => { setHoveredFeature(origIdx); setTooltip({ x: (x1 + x2) / 2, y: y - 12, text: `${label} (${feature.type})\n${feature.start + 1}..${feature.end + 1} bp` }) }}
            onMouseLeave={() => { setHoveredFeature(null); setTooltip(null) }}
            className="cursor-pointer">
            {/* Connector line */}
            <line x1={(x1 + x2) / 2} y1={trackY + trackHeight} x2={(x1 + x2) / 2} y2={y} stroke="#e2e8f0" strokeWidth={1} strokeDasharray="2,2" />
            {/* Feature bar */}
            <rect x={x1} y={y} width={barWidth} height={20} rx={3}
              fill={color} opacity={isHovered ? 0.95 : 0.7} stroke={isHovered ? '#1e293b' : 'none'} strokeWidth={1.5} />
            {/* Direction arrow */}
            {barWidth > 20 && (
              <polygon
                points={feature.strand === 1
                  ? `${x1 + barWidth - 8},${y + 10} ${x1 + barWidth - 2},${y + 5} ${x1 + barWidth - 2},${y + 15}`
                  : `${x1 + 8},${y + 10} ${x1 + 2},${y + 5} ${x1 + 2},${y + 15}`
                }
                fill="white" opacity={0.7}
              />
            )}
            {/* Label */}
            <text x={x1 + barWidth / 2} y={y + 14} textAnchor="middle" className="text-[9px] fill-white font-medium select-none"
              style={{ pointerEvents: 'none' }}>
              {barWidth > 40 ? label.substring(0, Math.floor(barWidth / 6)) : ''}
            </text>
          </g>
        )
      })}

      {/* Legend */}
      <Legend features={features} x={20} y={svgHeight - 50} />

      {/* Tooltip */}
      {tooltip && (
        <g>
          <rect x={tooltip.x - 90} y={tooltip.y - 25} width={180} height={35} rx={4} fill="#1e293b" opacity={0.9} />
          {tooltip.text.split('\n').map((line, i) => (
            <text key={i} x={tooltip.x} y={tooltip.y - 12 + i * 14} textAnchor="middle" className="text-[10px] fill-white">{line}</text>
          ))}
        </g>
      )}
    </svg>
  )
}

// ============ Helpers ============
function Legend({ features, x, y }: { features: GenBankFeature[]; x: number; y: number }) {
  const types = [...new Set(features.map(f => f.type))]
  return (
    <g>
      <text x={x} y={y} className="text-[10px] fill-slate-500 font-medium">图例:</text>
      {types.map((type, i) => (
        <g key={type} transform={`translate(${x + 40 + i * 100}, ${y})`}>
          <rect width={12} height={12} rx={2} fill={getColor(type)} />
          <text x={16} y={10} className="text-[10px] fill-slate-600">{type}</text>
        </g>
      ))}
    </g>
  )
}

function getArrowPoints(pos: { x: number; y: number }, angleDeg: number, strand: number, size: number): string {
  const rad = ((angleDeg + (strand === 1 ? 0 : 180)) * Math.PI) / 180
  const tipX = pos.x + size * Math.cos(rad)
  const tipY = pos.y + size * Math.sin(rad)
  const baseRad = rad + Math.PI
  const leftRad = baseRad + 0.5
  const rightRad = baseRad - 0.5
  const leftX = pos.x + size * 0.6 * Math.cos(leftRad)
  const leftY = pos.y + size * 0.6 * Math.sin(leftRad)
  const rightX = pos.x + size * 0.6 * Math.cos(rightRad)
  const rightY = pos.y + size * 0.6 * Math.sin(rightRad)
  return `${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}`
}
