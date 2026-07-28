import { useMemo } from 'react'

interface Props {
  /** 综合评分 0-100 */
  score: number
  /** 各维度分数 0-100 */
  details?: {
    tmScore?: number
    gcScore?: number
    hairpinScore?: number
    dimerScore?: number
    specificityScore?: number
  }
  /** 尺寸（直径px） */
  size?: number
}

/**
 * 引物评分仪表盘 SVG 组件
 * - 半圆弧形仪表盘（0-100）
 * - 颜色渐变：红(0-30) → 橙(30-60) → 黄(60-80) → 绿(80-100)
 * - 各维度分数雷达图（可选）
 */
export default function PrimerScoreGauge({ score, details, size = 120 }: Props) {
  const cx = size / 2
  const cy = size * 0.55
  const R = size * 0.38
  const strokeW = size * 0.08

  // 弧形路径（从150°到30°，即-120°到120°范围）
  const startAngle = 150 // 左下角
  const endAngle = 30 // 右下角
  const totalAngle = startAngle - endAngle // 120°

  const polar = (angle: number, r: number) => {
    const rad = (angle * Math.PI) / 180
    return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) }
  }

  // 背景弧
  const bgArc = useMemo(() => {
    const s = polar(startAngle, R)
    const e = polar(endAngle, R)
    return `M ${s.x} ${s.y} A ${R} ${R} 0 1 1 ${e.x} ${e.y}`
  }, [cx, cy, R])

  // 分数弧
  const scoreArc = useMemo(() => {
    const clampedScore = Math.max(0, Math.min(100, score))
    const scoreAngle = startAngle - (clampedScore / 100) * totalAngle
    const s = polar(startAngle, R)
    const e = polar(scoreAngle, R)
    const largeArc = (startAngle - scoreAngle) > 180 ? 1 : 0
    return `M ${s.x} ${s.y} A ${R} ${R} 0 ${largeArc} 1 ${e.x} ${e.y}`
  }, [score, cx, cy, R, startAngle, totalAngle])

  // 分数颜色
  const scoreColor = useMemo(() => {
    if (score >= 80) return '#22c55e' // green
    if (score >= 60) return '#f59e0b' // amber
    if (score >= 30) return '#f97316' // orange
    return '#ef4444' // red
  }, [score])

  // 分数等级文字
  const grade = useMemo(() => {
    if (score >= 90) return '优秀'
    if (score >= 80) return '良好'
    if (score >= 60) return '可用'
    if (score >= 30) return '较差'
    return '不可用'
  }, [score])

  // 维度指标雷达图（小尺寸，位于仪表盘下方）
  const radarData = useMemo(() => {
    if (!details) return null
    const dims = [
      { label: 'Tm', value: details.tmScore ?? 0 },
      { label: 'GC', value: details.gcScore ?? 0 },
      { label: '发卡', value: details.hairpinScore ?? 0 },
      { label: '二聚体', value: details.dimerScore ?? 0 },
      { label: '特异性', value: details.specificityScore ?? 0 },
    ]
    const rR = size * 0.15 // 雷达图半径
    const rCx = cx
    const rCy = cy + size * 0.22
    const n = dims.length
    const points = dims.map((d, i) => {
      const angle = (i / n) * 360 - 90
      const rad = (angle * Math.PI) / 180
      const r = (d.value / 100) * rR
      return {
        x: rCx + r * Math.cos(rad),
        y: rCy + r * Math.sin(rad),
        labelX: rCx + (rR + 10) * Math.cos(rad),
        labelY: rCy + (rR + 10) * Math.sin(rad),
        label: d.label,
        value: d.value,
      }
    })
    // 雷达多边形
    const polygon = points.map(p => `${p.x},${p.y}`).join(' ')
    // 背景网格（3圈）
    const gridCircles = [0.33, 0.66, 1].map(scale => {
      const pts = Array.from({ length: n }, (_, i) => {
        const angle = (i / n) * 360 - 90
        const rad = (angle * Math.PI) / 180
        return `${rCx + rR * scale * Math.cos(rad)},${rCy + rR * scale * Math.sin(rad)}`
      })
      return pts.join(' ')
    })
    return { points, polygon, gridCircles, rR, rCx, rCy }
  }, [details, cx, cy, size])

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }}>
      {/* 背景弧 */}
      <path d={bgArc} fill="none" stroke="#e2e8f0" strokeWidth={strokeW} strokeLinecap="round" />

      {/* 分数弧 */}
      {score > 0 && (
        <path d={scoreArc} fill="none" stroke={scoreColor} strokeWidth={strokeW} strokeLinecap="round"
          className="transition-all duration-500 ease-out" />
      )}

      {/* 分数数字 */}
      <text x={cx} y={cy - 4} textAnchor="middle" dominantBaseline="middle"
        className="font-bold select-none" fill={scoreColor} style={{ fontSize: size * 0.22 }}>
        {Math.round(score)}
      </text>

      {/* 等级文字 */}
      <text x={cx} y={cy + size * 0.12} textAnchor="middle" dominantBaseline="middle"
        className="select-none" fill="#94a3b8" style={{ fontSize: size * 0.1 }}>
        {grade}
      </text>

      {/* 雷达图（如果有维度数据） */}
      {radarData && (
        <g>
          {/* 背景网格 */}
          {radarData.gridCircles.map((pts, i) => (
            <polygon key={i} points={pts} fill="none" stroke="#e2e8f0" strokeWidth={0.5} />
          ))}
          {/* 轴线 */}
          {radarData.points.map((p, i) => {
            const angle = (i / radarData.points.length) * 360 - 90
            const rad = (angle * Math.PI) / 180
            return (
              <line key={i} x1={radarData.rCx} y1={radarData.rCy}
                x2={radarData.rCx + radarData.rR * Math.cos(rad)}
                y2={radarData.rCy + radarData.rR * Math.sin(rad)}
                stroke="#e2e8f0" strokeWidth={0.5} />
            )
          })}
          {/* 数据多边形 */}
          <polygon points={radarData.polygon} fill={scoreColor} fillOpacity={0.15} stroke={scoreColor} strokeWidth={1.5} />
          {/* 数据点 */}
          {radarData.points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={2} fill={scoreColor} />
          ))}
          {/* 标签 */}
          {radarData.points.map((p, i) => (
            <text key={i} x={p.labelX} y={p.labelY} textAnchor="middle" dominantBaseline="middle"
              className="select-none" fill="#64748b" style={{ fontSize: size * 0.07 }}>
              {p.label}
            </text>
          ))}
        </g>
      )}
    </svg>
  )
}
