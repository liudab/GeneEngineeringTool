/**
 * 凝胶电泳模拟可视化组件
 * 模拟琼脂糖凝胶电泳，显示 DNA 片段迁移
 * 支持：
 * - 多泳道（Marker + 样品）
 * - 琼脂糖浓度/电压/时间调节
 * - 片段大小标注
 * - 酶切结果直接导入
 * - 截图/导出
 */

import { useState, useMemo, useCallback } from 'react'
import { Play, Settings, Download, Trash2, Plus, Info } from 'lucide-react'
import { useLifecycleLog } from '../../hooks/useDebugLog'
import {
  simulateGel, type GelLane, type GelConfig, type GelSimulationResult, type GelBand, type GelLadderKey,
  type GelSpec, type GelBufferType,
  DEFAULT_GEL_CONFIG, LADDER_LABELS, GEL_SPECS, BUFFER_LABELS
} from '../../engine/gel/electrophoresis'

interface Props {
  /** 预填充泳道数据 */
  initialLanes?: GelLane[]
  className?: string
}

export default function GelElectrophoresis({ initialLanes, className = '' }: Props) {
  useLifecycleLog('GelElectrophoresis')

  // 输入管理
  const [lanes, setLanes] = useState<GelLane[]>(initialLanes || [
    { name: 'Lane 1', fragments: [{ label: 'Band 1', size: 1000 }] }
  ])

  // 凝胶配置
  const [config, setConfig] = useState<GelConfig>({ ...DEFAULT_GEL_CONFIG })
  const [showConfig, setShowConfig] = useState(false)

  // 结果
  const [result, setResult] = useState<GelSimulationResult | null>(null)
  const [error, setError] = useState('')

  // 添加泳道
  const addLane = useCallback(() => {
    setLanes(prev => [...prev, { name: `Lane ${prev.length + 1}`, fragments: [] }])
  }, [])

  // 删除泳道
  const removeLane = useCallback((idx: number) => {
    setLanes(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev)
  }, [])

  // 更新泳道
  const updateLaneName = useCallback((idx: number, name: string) => {
    setLanes(prev => prev.map((l, i) => i === idx ? { ...l, name } : l))
  }, [])

  // 更新片段
  const updateFragments = useCallback((laneIdx: number, frags: { label: string; size: number }[]) => {
    setLanes(prev => prev.map((l, i) => i === laneIdx ? { ...l, fragments: frags } : l))
  }, [])

  // 添加片段
  const addFragment = useCallback((laneIdx: number) => {
    setLanes(prev => prev.map((l, i) => {
      if (i !== laneIdx) return l
      return { ...l, fragments: [...l.fragments, { label: `Band ${l.fragments.length + 1}`, size: 500 }] }
    }))
  }, [])

  // 运行模拟
  const runSimulation = useCallback(() => {
    setError('')
    const validLanes = lanes.filter(l => l.fragments.some(f => f.size > 0))
    if (validLanes.length === 0) {
      setError('请至少添加一个有效片段')
      return
    }
    try {
      const simResult = simulateGel(validLanes, config)
      setResult(simResult)
    } catch (e: any) {
      setError(e.message || '模拟失败')
    }
  }, [lanes, config])

  // SVG 尺寸
  const svgWidth = useMemo(() => {
    if (!result) return 0
    const totalLanes = 1 + result.lanes.length // marker + samples
    return Math.max(300, totalLanes * 60 + 80)
  }, [result])

  // 当前凝胶规格长度（cm）：由 config.gelSpec 决定
  const gelLength = useMemo(() => {
    const spec = config.gelSpec || 'standard'
    return GEL_SPECS[spec].length
  }, [config.gelSpec])

  // SVG 高度随凝胶规格调整：standard 胶更长，需要更大画布
  const svgHeight = useMemo(() => {
    return config.gelSpec === 'mini' ? 480 : 680
  }, [config.gelSpec])

  // 场强 (V/cm)：电压 / 电极间距（由设备决定，非凝胶长度）
  const fieldStrength = useMemo(() => {
    const spec = config.gelSpec || 'standard'
    return config.voltage / GEL_SPECS[spec].electrodeDistance
  }, [config.voltage, config.gelSpec])

  // 凝胶布局常量
  const gelTop = 40
  const gelLeft = 65   // 为左侧 cm 标尺留空间
  const gelBottom = svgHeight - 30   // 为底部泳道标签留空间
  const gelHeight = gelBottom - gelTop
  const laneWidth = 50

  // 纵轴标尺刻度间隔（mini 用 1cm，standard 用 2cm）
  const tickInterval = useMemo(() => {
    return config.gelSpec === 'mini' ? 1 : 2
  }, [config.gelSpec])

  return (
    <div className={`flex flex-col h-full bg-white ${className}`}>
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-slate-50 flex-wrap">
        <button onClick={runSimulation}
          className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded hover:bg-emerald-700 flex items-center gap-1.5">
          <Play size={12} /> 模拟电泳
        </button>

        <button onClick={() => setShowConfig(!showConfig)}
          className={`text-xs px-2 py-1.5 border rounded flex items-center gap-1 ${showConfig ? 'bg-emerald-50 border-emerald-300' : 'hover:bg-white'}`}>
          <Settings size={12} /> 凝胶参数
        </button>

        {result && (
          <>
            <div className="flex-1" />
            <div className="text-[10px] text-slate-500">
              最佳范围: {result.resolution.optimalRange[0]}bp - {(result.resolution.optimalRange[1] / 1000).toFixed(1)}kb
            </div>
          </>
        )}
      </div>

      {/* 配置面板 */}
      {showConfig && (
        <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-xs flex gap-4 flex-wrap items-center">
          <label className="flex items-center gap-1">
            琼脂糖%:
            <input type="range" min={0.5} max={3} step={0.1} value={config.agarosePercent}
              onChange={e => setConfig(c => ({ ...c, agarosePercent: +e.target.value }))}
              className="w-20" />
            <span className="w-8 text-slate-600">{config.agarosePercent.toFixed(1)}</span>
          </label>
          <label className="flex items-center gap-1">
            电压(V):
            <input type="number" min={30} max={300} value={config.voltage}
              onChange={e => setConfig(c => ({ ...c, voltage: +e.target.value }))}
              className="w-14 border rounded px-1 py-0.5" />
            <span className="text-[10px] text-slate-500">({fieldStrength.toFixed(1)} V/cm)</span>
          </label>
          <label className="flex items-center gap-1">
            时间(min):
            <input type="number" min={10} max={240} value={config.runTime}
              onChange={e => setConfig(c => ({ ...c, runTime: +e.target.value }))}
              className="w-14 border rounded px-1 py-0.5" />
          </label>
          <label className="flex items-center gap-1">
            凝胶规格:
            <select value={config.gelSpec || 'standard'}
              onChange={e => {
                const spec = e.target.value as GelSpec
                setConfig(c => ({ ...c, gelSpec: spec, gelLength: GEL_SPECS[spec].length }))
              }}
              className="border rounded px-1 py-0.5">
              {(Object.keys(GEL_SPECS) as GelSpec[]).map(k =>
                <option key={k} value={k}>{GEL_SPECS[k].label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">
            缓冲液:
            <select value={config.bufferType || 'TAE'}
              onChange={e => setConfig(c => ({ ...c, bufferType: e.target.value as GelBufferType }))}
              className="border rounded px-1 py-0.5">
              {(Object.keys(BUFFER_LABELS) as GelBufferType[]).map(k =>
                <option key={k} value={k}>{BUFFER_LABELS[k]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">
            Marker:
            <select value={config.ladder}
              onChange={e => setConfig(c => ({ ...c, ladder: e.target.value as GelLadderKey }))}
              className="border rounded px-1 py-0.5">
              <optgroup label="通用">
                {(['100bp', '1kb', 'lambda'] as GelLadderKey[]).map(k =>
                  <option key={k} value={k}>{LADDER_LABELS[k]}</option>)}
              </optgroup>
              <optgroup label="Takara Bio">
                {(['Takara_DL2000', 'Takara_DL2000Plus', 'Takara_DL5000', 'Takara_DL10000',
                   'Takara_DL15000', 'Takara_lambda_HindIII'] as GelLadderKey[]).map(k =>
                  <option key={k} value={k}>{LADDER_LABELS[k]}</option>)}
              </optgroup>
              <optgroup label="Vazyme 诺唯赞">
                {(['Vazyme_DL2000Plus', 'Vazyme_DL5000', 'Vazyme_DL15000',
                   'Vazyme_100bp'] as GelLadderKey[]).map(k =>
                  <option key={k} value={k}>{LADDER_LABELS[k]}</option>)}
              </optgroup>
            </select>
          </label>
        </div>
      )}

      {error && (
        <div className="px-3 py-2 bg-red-50 border-b border-red-200 text-red-600 text-xs flex items-center gap-2">
          <Info size={12} /> {error}
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 左侧：泳道输入 */}
        <div className="w-64 flex-shrink-0 border-r border-slate-200 overflow-auto p-2 space-y-2">
          {lanes.map((lane, li) => (
            <div key={li} className="border border-slate-200 rounded p-2 bg-slate-50">
              <div className="flex items-center gap-1 mb-1">
                <input type="text" value={lane.name} onChange={e => updateLaneName(li, e.target.value)}
                  className="flex-1 text-xs font-medium border-b border-transparent hover:border-slate-300 focus:border-violet-400 bg-transparent px-1" />
                {lanes.length > 1 && (
                  <button onClick={() => removeLane(li)} className="p-0.5 text-slate-400 hover:text-red-500">
                    <Trash2 size={10} />
                  </button>
                )}
              </div>
              {lane.fragments.map((frag, fi) => (
                <div key={fi} className="flex items-center gap-1 mb-0.5">
                  <input type="text" value={frag.label}
                    onChange={e => {
                      const newFrags = [...lane.fragments]
                      newFrags[fi] = { ...newFrags[fi], label: e.target.value }
                      updateFragments(li, newFrags)
                    }}
                    className="flex-1 text-[10px] border rounded px-1 py-0.5 w-0"
                    placeholder="标签" />
                  <input type="number" value={frag.size}
                    onChange={e => {
                      const newFrags = [...lane.fragments]
                      newFrags[fi] = { ...newFrags[fi], size: +e.target.value || 0 }
                      updateFragments(li, newFrags)
                    }}
                    className="w-16 text-[10px] border rounded px-1 py-0.5"
                    placeholder="bp" min={1} />
                  <button onClick={() => {
                    const newFrags = lane.fragments.filter((_, i) => i !== fi)
                    updateFragments(li, newFrags)
                  }} className="p-0.5 text-slate-300 hover:text-red-500">
                    <Trash2 size={8} />
                  </button>
                </div>
              ))}
              <button onClick={() => addFragment(li)}
                className="text-[10px] text-slate-400 hover:text-emerald-600 flex items-center gap-0.5 mt-0.5">
                <Plus size={8} /> 添加片段
              </button>
            </div>
          ))}
          <button onClick={addLane}
            className="text-xs text-slate-500 hover:text-emerald-600 flex items-center gap-1">
            <Plus size={12} /> 添加泳道
          </button>
        </div>

        {/* 右侧：凝胶可视化 */}
        <div className="flex-1 overflow-auto bg-slate-100 p-3 min-h-[400px]">
          {!result ? (
            <div className="flex items-center justify-center h-full text-slate-400 text-sm">
              点击"模拟电泳"查看结果
            </div>
          ) : (
            <svg width={svgWidth} height={svgHeight} className="block mx-auto">
              {/* 凝胶背景 */}
              <rect x={gelLeft} y={gelTop} width={svgWidth - gelLeft - 20} height={gelHeight}
                fill="#1a1a2e" rx={4} />

              {/* 纵轴（迁移距离 cm）：从 0 到 gelLength */}
              <line x1={gelLeft - 8} y1={gelTop} x2={gelLeft - 8} y2={gelTop + gelHeight}
                stroke="#94a3b8" strokeWidth={1} />
              {/* 纵轴刻度与标签 */}
              {Array.from({ length: Math.floor(gelLength / tickInterval) + 1 }).map((_, i) => {
                const cm = i * tickInterval
                if (cm > gelLength) return null
                const y = gelTop + (cm / gelLength) * gelHeight
                return (
                  <g key={`yt-${cm}`}>
                    <line x1={gelLeft - 12} y1={y} x2={gelLeft - 8} y2={y}
                      stroke="#94a3b8" strokeWidth={1} />
                    <text x={gelLeft - 14} y={y + 3} textAnchor="end"
                      className="text-[9px] fill-slate-500 font-mono">
                      {cm}
                    </text>
                  </g>
                )
              })}
              {/* 纵轴单位 */}
              <text x={12} y={gelTop + gelHeight / 2} textAnchor="middle"
                transform={`rotate(-90 12 ${gelTop + gelHeight / 2})`}
                className="text-[10px] fill-slate-500 font-mono">
                迁移距离 (cm)
              </text>

              {/* 横轴（泳道编号） */}
              <line x1={gelLeft} y1={gelBottom + 2} x2={gelLeft + svgWidth - gelLeft - 20} y2={gelBottom + 2}
                stroke="#94a3b8" strokeWidth={1} />

              {/* Marker 泳道 */}
              {renderLane(result.markerLane, gelLeft + 10, gelTop, gelHeight, laneWidth, svgHeight, gelLength, 0)}

              {/* 样品泳道 */}
              {result.lanes.map((lane, i) =>
                renderLane(lane, gelLeft + 10 + (i + 1) * (laneWidth + 10), gelTop, gelHeight, laneWidth, svgHeight, gelLength, i + 1)
              )}

              {/* 正极/负极标注 */}
              <text x={gelLeft + 2} y={gelTop - 8} textAnchor="start" className="text-[10px] fill-slate-500">
                负极 (-)
              </text>
              <text x={gelLeft + 2} y={gelBottom + 18} textAnchor="start" className="text-[10px] fill-slate-500">
                正极 (+)
              </text>
            </svg>
          )}
        </div>
      </div>

      {/* 底部：重新模拟 */}
      {result && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-slate-200 bg-slate-50">
          <button onClick={() => setResult(null)}
            className="text-xs text-slate-500 hover:text-emerald-600">
            修改参数
          </button>
          <div className="flex-1" />
          <button onClick={runSimulation}
            className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-1">
            <Play size={10} /> 重新模拟
          </button>
        </div>
      )}
    </div>
  )
}

// ============ 泳道渲染 ============

function renderLane(
  lane: { name: string; bands: GelBand[] },
  x: number, gelTop: number, gelHeight: number, laneW: number, svgH: number,
  gelLength: number, laneIndex: number
): JSX.Element {
  const isMarker = lane.name === 'Marker'
  return (
    <g key={lane.name}>
      {/* 泳道标签 */}
      <text x={x + laneW / 2} y={gelTop - 2} textAnchor="middle"
        className={`text-[9px] ${isMarker ? 'fill-amber-500' : 'fill-slate-400'} font-mono`}>
        {lane.name}
      </text>
      {/* 条带（按迁移距离升序排列，从上到下：小片段→大片段） */}
      {lane.bands
        .slice()
        .sort((a, b) => a.migration - b.migration)
        .map((band, i, arr) => {
          // 迁移距离映射到凝胶 Y 坐标
          // migration 是 cm，除以实际 gelLength(cm) 得到 0-1 比例
          const yRatio = band.migration / gelLength
          const by = gelTop + yRatio * gelHeight
          const bw = laneW * band.width * 0.8
          const bx = x + (laneW - bw) / 2

          // 标签防重叠：计算与上一标签的像素间距，不足 10px 则跳过标注
          const prevBy = i > 0
            ? gelTop + (arr[i - 1].migration / gelLength) * gelHeight
            : -Infinity
          const showLabel = (by - prevBy) >= 10

          // 扩散因子：影响条带宽度和强度
          const df = band.diffusionFactor || 1

          if (band.ranOff) {
            // 跑出凝胶的条带：虚线描边 + 低透明度 + 红色"跑出"标注
            return (
              <g key={i}>
                <rect x={bx} y={by - 2} width={bw} height={4} rx={1}
                  fill="none"
                  stroke={isMarker ? '#fbbf24' : '#22d3ee'}
                  strokeWidth={1} strokeDasharray="3,2"
                  opacity={0.4}
                />
                {showLabel && (
                  <text x={isMarker ? bx - 2 : bx + bw + 2} y={by + 2}
                    textAnchor={isMarker ? 'end' : 'start'}
                    className="text-[7px] fill-red-400 font-mono italic">
                    {formatBandSize(band.size)} (跑出)
                  </text>
                )}
              </g>
            )
          }

          // 正常条带：应用扩散因子调整宽度和强度
          const effectiveW = bw * df
          const effectiveX = x + (laneW - effectiveW) / 2
          const effectiveOpacity = Math.max(0.15, band.intensity / df)

          return (
            <g key={i}>
              {/* 条带 */}
              <rect x={effectiveX} y={by - 2} width={effectiveW} height={4} rx={1}
                fill={isMarker ? '#fbbf24' : '#22d3ee'}
                opacity={effectiveOpacity}
              />
              {/* 大小标注（只在间距足够时显示，避免重叠） */}
              {showLabel && (isMarker || lane.bands.length <= 10) && (
                <text x={isMarker ? effectiveX - 2 : effectiveX + effectiveW + 2} y={by + 2}
                  textAnchor={isMarker ? 'end' : 'start'}
                  className="text-[8px] fill-slate-400 font-mono">
                  {formatBandSize(band.size)}
                </text>
              )}
            </g>
          )
        })}
      {/* 横轴标签：泳道编号 */}
      <text x={x + laneW / 2} y={gelTop + gelHeight + 14} textAnchor="middle"
        className={`text-[9px] ${isMarker ? 'fill-amber-500' : 'fill-slate-500'} font-mono`}>
        {isMarker ? 'M' : `L${laneIndex}`}
      </text>
    </g>
  )
}

function formatBandSize(bp: number): string {
  if (bp >= 1000) return `${(bp / 1000).toFixed(bp % 1000 === 0 ? 0 : 1)}k`
  return `${bp}`
}
