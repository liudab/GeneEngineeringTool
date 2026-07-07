import { useState, useMemo, useRef, useCallback, memo } from 'react'
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react'
import type { GenBankFeature, FeatureStyles, FeatureShape, FillPattern } from '../../shared/types'

interface PrimerSiteInfo {
  primer_id: number
  primer_name: string
  sequence: string
  position: number
  recog_start: number
  recog_end: number
  strand: 1 | -1
}
import { FEATURE_TYPE_NAMES, enzymeColor } from '../SequenceEditor/SequenceEditor'

interface EnzymeSiteInfo {
  id: number
  enzyme_name?: string
  recognition_sequence?: string
  cut_position?: number
  position: number
  is_unique: boolean
  recog_start?: number
  recog_end?: number
  strand?: 1 | -1
}

interface Props {
  sequence: string
  size: number
  name: string
  topology: 'circular' | 'linear'
  features: GenBankFeature[]
  enzymeSites: EnzymeSiteInfo[]
  primerSites?: PrimerSiteInfo[]
  primerStyle?: 'arrow' | 'line' | 'triangle' | 'flag'
  primerColor?: string
  viewMode: 'circular' | 'linear'
  selectedFeature: number | null
  onSelectFeature: (i: number | null) => void
  hoveredFeature: number | null
  onHoverFeature: (i: number | null) => void
  onSelectEnzymeSite?: (site: EnzymeSiteInfo | null) => void
  featureStyles?: FeatureStyles
  sequenceSelection?: { start: number; end: number } | null
  sequenceInsertPos?: number | null
  enzymeFontSize?: number
  mapFontSize?: number
  legendScale?: number
  featureFontSize?: number
  featureHeight?: number
  onSvgRef?: (el: SVGSVGElement | null) => void
  zoom?: number
  onZoomChange?: (z: number) => void
}

// 元件类型 → 颜色
const FEATURE_COLORS: Record<string, string> = {
  gene: '#10b981', CDS: '#3b82f6', mRNA: '#06b6d4', promoter: '#f59e0b',
  terminator: '#ef4444', rep_origin: '#8b5cf6', misc_feature: '#94a3b8',
  primer_bind: '#ec4899', protein_bind: '#6366f1', regulatory: '#f97316',
  source: '#9ca3af', exon: '#14b8a6', intron: '#a3a3a3',
  five_prime_UTR: '#84cc16', three_prime_UTR: '#e879f9', enhancer: '#fbbf24',
  ori: '#8b5cf6', antibiotic_resistance: '#ef4444', misc_binding: '#64748b',
  sig_peptide: '#f97316', polyA_signal: '#eab308', STS: '#64748b',
  ncRNA: '#06b6d4', misc_RNA: '#06b6d4', misc_difference: '#94a3b8',
  misc_recomb: '#8b5cf6'
}

// 元件类型 → 图标形状标识
const FEATURE_ICONS: Record<string, string> = {
  gene: 'arrow-right', CDS: 'arrow-right', mRNA: 'wave',
  promoter: 'flag', terminator: 'stop', rep_origin: 'circle',
  primer_bind: 'pin', protein_bind: 'diamond', regulatory: 'gear',
  enhancer: 'star', misc_feature: 'square'
}

function getColor(type: string): string { return FEATURE_COLORS[type] || '#cbd5e1' }

export default function VectorMapViewer({
  sequence, size, name, topology, features, enzymeSites, primerSites = [],
  primerStyle: pStyle = 'arrow', primerColor: pColor = '#0891b2', viewMode,
  selectedFeature, onSelectFeature, hoveredFeature, onHoverFeature, onSelectEnzymeSite,
  featureStyles, sequenceSelection, sequenceInsertPos, enzymeFontSize,
  mapFontSize, legendScale,
  featureFontSize, featureHeight,
  onSvgRef, zoom: controlledZoom, onZoomChange
}: Props) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; lines: string[] } | null>(null)
  const [showEnzymeSites, setShowEnzymeSites] = useState(true)
  const [showPrimerSites, setShowPrimerSites] = useState(true)
  const [internalZoom, setInternalZoom] = useState(1)
  const svgRef = useRef<SVGSVGElement>(null)

  // Controlled or uncontrolled zoom
  const zoom = controlledZoom ?? internalZoom
  const setZoom = useCallback((z: number | ((prev: number) => number)) => {
    const newZ = typeof z === 'function' ? z(controlledZoom ?? internalZoom) : z
    setInternalZoom(newZ)
    onZoomChange?.(newZ)
  }, [controlledZoom, internalZoom, onZoomChange])

  // SVG ref callback
  const handleSvgRef = useCallback((el: SVGSVGElement | null) => {
    (svgRef as any).current = el
    onSvgRef?.(el)
  }, [onSvgRef])

  // 可见元件计数（不过滤，保留原始索引以确保点选精确）
  const visibleCount = useMemo(() =>
    features.filter(f => f.type !== 'source' && (f.end - f.start) > 0).length,
    [features]
  )

  // 计算环形视图动态H和W（与CircularView内部逻辑同步，用于HoverOverlay对齐）
  const circularLayout = useMemo(() => {
    const R = 250, cx = 480, cy = 460, eOuter = R + 35
    const fInner = R - 30, fOuter = R + 10
    const midR = (fInner + fOuter) / 2
    const featFs = Math.max(5, featureFontSize || 10)
    const sorted = enzymeSites.map((es, i) => ({ i, angle: (es.position / size) * 360 - 90 }))
      .sort((a, b) => a.angle - b.angle)
    const st: number[] = new Array(enzymeSites.length).fill(0)
    for (let k = 1; k < sorted.length; k++) {
      let diff = sorted[k].angle - sorted[k - 1].angle
      if (diff < 0) diff += 360
      if (diff < 6) st[sorted[k].i] = st[sorted[k - 1].i] + 1
    }
    const maxSt = Math.max(0, ...st)
    const fs = enzymeFontSize || 7
    const enzStep = fs + 5
    const rulerR = R + 45
    const clearR = rulerR + 26
    const baseFoldR = Math.max(clearR, eOuter + enzStep)
    const maxLabelW = enzymeSites.reduce((m, e) => Math.max(m, (e.enzyme_name || '').length), 0) * fs * 0.6
    const enzLabelRadius = baseFoldR + maxSt * enzStep + maxLabelW + 10
    // 元件外部标注空间估算
    let extCount = 0
    features.forEach(f => {
      if (f.type === 'source' || (f.end - f.start) <= 0) return
      const sa_ = (f.start / size) * 360 - 90
      let ea_ = (f.end / size) * 360 - 90; if (ea_ < sa_) ea_ += 360
      const span = ea_ - sa_
      const arcLen = (span * Math.PI / 180) * midR
      const maxChars = Math.floor((arcLen - 4) / (featFs * 0.55))
      const label = FEATURE_TYPE_NAMES[f.type] || f.type
      if (maxChars < label.length) extCount++
    })
    if (extCount > 0) {
      const featExtBaseR = baseFoldR + (maxSt + 1) * enzStep + 8
      const featLabelStep = featFs + 8
      const maxStack = Math.min(extCount, 5)
      const maxFeatExtR = featExtBaseR + (maxStack + 1) * featLabelStep + 10
      var estMaxRadius = Math.max(enzLabelRadius, maxFeatExtR)
      // SVG 宽度计算（与 CircularView 内部一致）
      var maxFoldR = featExtBaseR + maxStack * featLabelStep
      var maxHExtent = Math.min(maxFoldR * 0.35, 80)
      const maxLabelChars = Math.max(2, Math.floor((maxHExtent - 3) / (featFs * 0.55)))
      var maxTextW = maxLabelChars * featFs * 0.55
    } else {
      var estMaxRadius = enzLabelRadius
      var maxFoldR = 0, maxHExtent = 0, maxTextW = 0
    }
    const enzMaxHExt = enzymeSites.reduce((m, e) => Math.max(m, (e.enzyme_name || '').length * fs * 0.6), 0) + fs
    const maxCenterExtent = Math.max(
      maxFoldR + maxHExtent + maxTextW + featFs + 20,
      enzLabelRadius + enzMaxHExt + 10,
      rulerR + 30
    )
    const W = Math.max(960, Math.ceil(maxCenterExtent * 2))
    const enzBottomY = cy + estMaxRadius
    const enzRows = enzymeSites.length > 0 ? 1 : 0
    const legendTypes = new Set(features.filter(f => f.type !== 'source' && (f.end - f.start) > 0).map(f => f.type))
    const legendRows = Math.ceil(legendTypes.size / 7) + enzRows
    const H = enzBottomY + 20 + legendRows * 20 + 10 + 20
    return { H, W }
  }, [enzymeSites, features, size, featureFontSize, enzymeFontSize])

  // 计算线性视图动态H和trackY（与LinearView内部逻辑同步，用于HoverOverlay对齐）
  const linearLayout = useMemo(() => {
    const W = 1200, ML = 80, MR = 80
    const usable = W - ML - MR
    const sorted = enzymeSites.map((es, i) => ({ i, px: ML + (es.position / size) * usable }))
      .sort((a, b) => a.px - b.px)
    const st: number[] = new Array(enzymeSites.length).fill(0)
    const fs = enzymeFontSize || 7 // 与 LinearView 实际字号同步
    const maxLabelW = enzymeSites.reduce((m, e) => Math.max(m, (e.enzyme_name || '').length), 0) * fs * 0.6
    const gap = Math.max(24, maxLabelW * 2 + fs * 2)
    for (let k = 1; k < sorted.length; k++) {
      if (sorted[k].px - sorted[k - 1].px < gap) st[sorted[k].i] = st[sorted[k - 1].i] + 1
    }
    const maxSt = Math.max(0, ...st)
    const step = fs + 5
    const enzH = (maxSt + 1) * step + maxLabelW + 20
    const trackY = 65 + enzH
    const visible = features.filter(f => f.type !== 'source' && (f.end - f.start) > 0)
    const sortedF = [...visible].sort((a, b) => a.start - b.start)
    const rowEnds: number[] = []
    sortedF.forEach(f => {
      let row = 0
      while (row < rowEnds.length && rowEnds[row] > f.start) row++
      rowEnds[row] = f.end
    })
    const maxRow = Math.max(0, ...rowEnds.map((_, i) => i))
    const featH = featureHeight || 22
    const rowSpacing = featH + 8
    // 外部标注空间估算（用实际字号和多行容量判断）
    const featFsL = Math.max(5, featureFontSize || 10)
    const labelFs = Math.min(featH - 2, featFsL)
    const charW = labelFs * 0.55
    const maxLines = Math.max(1, Math.floor((featH - 2) / (labelFs * 1.2)))
    let extCount = 0
    visible.forEach(f => {
      const bw = Math.max((W - ML - MR) / size * (f.end - f.start), 6)
      const maxCharsPerLine = Math.max(0, Math.floor((bw - 4) / charW))
      const label = FEATURE_TYPE_NAMES[f.type] || f.type
      if (maxCharsPerLine * maxLines < label.length) extCount++
    })
    const maxExtStack = Math.min(extCount, 5)
    const extFeatH = extCount > 0 ? (maxExtStack + 1) * (featFsL + 12) + 15 : 0
    const H = Math.max(500, trackY + 70 + (maxRow + 1) * rowSpacing + 90 + extFeatH)
    // renderW 计算（与 LinearView 内部一致）
    const LINEAR_MAX_H_LINE = 80
    const linearMaxChars = Math.max(2, Math.floor((LINEAR_MAX_H_LINE - 3) / (featFsL * 0.55)))
    const maxLabelRightExtent = visible.reduce((m, f) => {
      const x1 = ML + (f.start / size) * usable, x2 = ML + (f.end / size) * usable
      const charW2 = featFsL * 0.55
      const label2 = FEATURE_TYPE_NAMES[f.type] || f.type
      const truncatedLen = Math.min(label2.length, linearMaxChars)
      const textW2 = truncatedLen * charW2
      const lineLen = Math.min(LINEAR_MAX_H_LINE, textW2 + featFsL * 0.5)
      return Math.max(m, (x1 + x2) / 2 + lineLen + 3 + textW2)
    }, 0)
    const enzMaxRight = enzymeSites.reduce((m, es) => {
      const x = ML + (es.position / size) * usable
      const nameW = (es.enzyme_name || '').length * fs * 0.6
      return Math.max(m, x + nameW + 5)
    }, 0)
    const renderW = Math.max(W, maxLabelRightExtent + 20, enzMaxRight + 20)
    return { H, trackY, renderW }
  }, [enzymeSites, features, size, featureHeight, featureFontSize, enzymeFontSize])

  // 缩放控件
  const zoomControls = (
    <div className="flex items-center gap-1 ml-auto">
      <button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} className="p-1 text-slate-500 hover:bg-slate-100 rounded" title="缩小"><ZoomOut size={14} /></button>
      <span className="text-[10px] text-slate-400 w-10 text-center">{Math.round(zoom * 100)}%</span>
      <button onClick={() => setZoom(z => Math.min(3, z + 0.25))} className="p-1 text-slate-500 hover:bg-slate-100 rounded" title="放大"><ZoomIn size={14} /></button>
      <button onClick={() => setZoom(1)} className="p-1 text-slate-500 hover:bg-slate-100 rounded" title="重置"><Maximize size={14} /></button>
    </div>
  )

  if (viewMode === 'circular') {
    return (
      <div className="flex flex-col">
        <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-slate-200">
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={showEnzymeSites} onChange={e => setShowEnzymeSites(e.target.checked)} className="rounded" />
            显示酶切位点
          </label>
          {primerSites.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-cyan-600 cursor-pointer">
              <input type="checkbox" checked={showPrimerSites} onChange={e => setShowPrimerSites(e.target.checked)} className="rounded" />
              显示通用引物
            </label>
          )}
          <span className="text-xs text-slate-400">共 {visibleCount} 个元件, {enzymeSites.length} 个酶切位点{primerSites.length > 0 ? `, ${primerSites.length} 个通用引物` : ''}</span>
          {zoomControls}
        </div>
        <div className="p-2 relative">
          <MemoCircularView
            svgRef={svgRef} size={size} name={name} topology={topology}
            features={features} enzymeSites={enzymeSites} showEnzymeSites={showEnzymeSites}
            primerSites={primerSites} showPrimerSites={showPrimerSites}
            primerStyle={pStyle} primerColor={pColor}
            selectedFeature={selectedFeature} onSelectFeature={onSelectFeature}
            hoveredFeature={hoveredFeature} onHoverFeature={onHoverFeature}
            tooltip={tooltip} setTooltip={setTooltip}
            onSelectEnzymeSite={onSelectEnzymeSite}
            zoom={zoom}
            featureStyles={featureStyles}
            sequenceSelection={sequenceSelection}
            enzymeFontSize={enzymeFontSize}
            mapFontSize={mapFontSize}
            legendScale={legendScale}
            featureFontSize={featureFontSize}
            featureHeight={featureHeight}
            onSvgRef={handleSvgRef}
          />
          <HoverOverlay viewMode="circular" insertPos={sequenceInsertPos} size={size} svgH={circularLayout.H} svgW={circularLayout.W} zoom={zoom} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-slate-200">
        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
          <input type="checkbox" checked={showEnzymeSites} onChange={e => setShowEnzymeSites(e.target.checked)} className="rounded" />
          显示酶切位点
        </label>
        {primerSites.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-cyan-600 cursor-pointer">
            <input type="checkbox" checked={showPrimerSites} onChange={e => setShowPrimerSites(e.target.checked)} className="rounded" />
            显示通用引物
          </label>
        )}
        <span className="text-xs text-slate-400">共 {visibleCount} 个元件, {enzymeSites.length} 个酶切位点{primerSites.length > 0 ? `, ${primerSites.length} 个通用引物` : ''}</span>
        {zoomControls}
      </div>
      <div className="p-2 relative">
        <MemoLinearView
          svgRef={svgRef} size={size} name={name}
          features={features} enzymeSites={enzymeSites} showEnzymeSites={showEnzymeSites}
          primerSites={primerSites} showPrimerSites={showPrimerSites}
          primerStyle={pStyle} primerColor={pColor}
          selectedFeature={selectedFeature} onSelectFeature={onSelectFeature}
          hoveredFeature={hoveredFeature} onHoverFeature={onHoverFeature}
          tooltip={tooltip} setTooltip={setTooltip}
          onSelectEnzymeSite={onSelectEnzymeSite}
          zoom={zoom}
          featureStyles={featureStyles}
          sequenceSelection={sequenceSelection}
          enzymeFontSize={enzymeFontSize}
          mapFontSize={mapFontSize}
          legendScale={legendScale}
          featureFontSize={featureFontSize}
          featureHeight={featureHeight}
          onSvgRef={handleSvgRef}
        />
        <HoverOverlay viewMode="linear" insertPos={sequenceInsertPos} size={size} svgH={linearLayout.H} svgW={linearLayout.renderW} linearTrackY={linearLayout.trackY} zoom={zoom} />
      </div>
    </div>
  )
}

// ====================== Circular View ======================
function CircularView({
  svgRef, size, name, topology, features, enzymeSites, showEnzymeSites,
  primerSites, showPrimerSites, primerStyle, primerColor,
  selectedFeature, onSelectFeature, hoveredFeature, onHoverFeature,
  tooltip, setTooltip, onSelectEnzymeSite, zoom, featureStyles,
  sequenceSelection, enzymeFontSize, mapFontSize, legendScale,
  featureFontSize, featureHeight, onSvgRef
}: {
  svgRef: React.RefObject<SVGSVGElement>
  size: number; name: string; topology: string
  features: GenBankFeature[]; enzymeSites: EnzymeSiteInfo[]; showEnzymeSites: boolean
  primerSites: PrimerSiteInfo[]; showPrimerSites: boolean
  primerStyle: string; primerColor: string
  selectedFeature: number | null; onSelectFeature: (i: number | null) => void
  hoveredFeature: number | null; onHoverFeature: (i: number | null) => void
  tooltip: { x: number; y: number; lines: string[] } | null
  setTooltip: (t: { x: number; y: number; lines: string[] } | null) => void
  onSelectEnzymeSite?: (site: EnzymeSiteInfo | null) => void
  zoom: number
  featureStyles?: FeatureStyles
  sequenceSelection?: { start: number; end: number } | null
  enzymeFontSize?: number
  mapFontSize?: number
  legendScale?: number
  featureFontSize?: number
  featureHeight?: number
  onSvgRef?: (el: SVGSVGElement | null) => void
}) {
  const R = 250
  const cx = 480, cy = 460 // 圆心位置（固定）
  const fInner = R - 30, fOuter = R + 10
  const eInner = R + 18, eOuter = R + 35
  const cMidR = (fInner + fOuter) / 2 // 组件级 midR（供 useMemo 使用）

  const posToAngle = useCallback((pos: number) => (pos / size) * 360 - 90, [size])
  const polar = useCallback((a: number, r: number) => {
    const rad = (a * Math.PI) / 180
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
  }, [cx, cy])

  const arcPath = useCallback((sa: number, ea: number, ir: number, or_: number) => {
    let end = ea
    if (end < sa) end += 360
    const s1 = polar(sa, or_), e1 = polar(end, or_)
    const s2 = polar(end, ir), e2 = polar(sa, ir)
    const large = (end - sa) > 180 ? 1 : 0
    return `M ${s1.x} ${s1.y} A ${or_} ${or_} 0 ${large} 1 ${e1.x} ${e1.y} L ${s2.x} ${s2.y} A ${ir} ${ir} 0 ${large} 0 ${e2.x} ${e2.y} Z`
  }, [polar])

  // 刻度（标尺）
  const ticks = useMemo(() => {
    const majorInterval = size > 20000 ? 5000 : size > 5000 ? 1000 : size > 1000 ? 500 : 100
    const minorInterval = majorInterval / 5
    const result: { pos: number; angle: number; isMajor: boolean }[] = []
    for (let p = 0; p < size; p += minorInterval) {
      result.push({ pos: p, angle: posToAngle(p), isMajor: p % majorInterval === 0 })
    }
    return result
  }, [size, posToAngle])

  const rulerR = R + 45 // 标尺环半径

  // 酶切位点堆叠计算（相近角度的依次堆叠）
  const enzymeStacks = useMemo(() => {
    const sorted = enzymeSites.map((es, i) => ({ i, angle: posToAngle(es.position) }))
      .sort((a, b) => a.angle - b.angle)
    const st: number[] = new Array(enzymeSites.length).fill(0)
    const MIN_ANGLE_GAP = 6
    for (let k = 1; k < sorted.length; k++) {
      const prev = sorted[k - 1], cur = sorted[k]
      let diff = cur.angle - prev.angle
      if (diff < 0) diff += 360
      if (diff < MIN_ANGLE_GAP) st[cur.i] = st[prev.i] + 1
    }
    return st
  }, [enzymeSites, posToAngle])

  // 动态计算酶标签最大延伸距离和图例位置（折线布局）
  const maxEnzStack = Math.max(0, ...enzymeStacks)
  const fs = enzymeFontSize || 7
  const enzStep = fs + 5 // 每级堆叠的径向步长
  const clearR = rulerR + 26 // 标尺标签外侧 + 安全间距（标尺标签在 rulerR+16 处）
  const baseFoldR = Math.max(clearR, eOuter + enzStep) // 折线基点必须超过标尺标签
  const maxNameLen = enzymeSites.reduce((m, e) => Math.max(m, (e.enzyme_name || '').length), 0)
  const maxLabelW = maxNameLen * fs * 0.6 // 最长标签估计宽度
  const enzLabelRadius = baseFoldR + maxEnzStack * enzStep + maxLabelW + 10 // 折线最大延伸半径

  // 元件外部标注堆叠（文字放不下时用折线标注）
  const featFsDesired = Math.max(5, featureFontSize || 10) // 用户期望字号（不受环带宽度限制）
  const featFsC = Math.min(fOuter - fInner - 4, featFsDesired) // 内部渲染字号（受环带宽度限制）
  const extFeats = useMemo(() => {
    const result: { i: number; angle: number; label: string; color: string; fill: string }[] = []
    features.forEach((f, i) => {
      if (f.type === 'source' || (f.end - f.start) <= 0) return
      const sa_ = posToAngle(f.start)
      let ea_ = posToAngle(f.end); if (ea_ < sa_) ea_ += 360
      const span = ea_ - sa_
      const arcLen = (span * Math.PI / 180) * cMidR
      const maxChars = Math.max(0, Math.floor((arcLen - 4) / (featFsDesired * 0.55)))
      const note = f.qualifiers.note || ''
      const label = note ? `${FEATURE_TYPE_NAMES[f.type] || f.type} ${note}` : FEATURE_TYPE_NAMES[f.type] || f.type
      if (maxChars < label.length) {
        const midA_ = (sa_ + ea_) / 2
        const style = featureStyles?.[f.type]
        const color = style?.color || getColor(f.type)
        result.push({ i, angle: midA_, label, color, fill: style?.fill || 'solid' })
      }
    })
    return result
  }, [features, featureStyles, posToAngle, featFsDesired])

  const featLabelStacks = useMemo(() => {
    const sorted = [...extFeats].sort((a, b) => a.angle - b.angle)
    const st: Record<number, number> = {}
    // 动态角度阈值：基于字号和估计半径，确保文字不重叠
    const estR = baseFoldR + 20 // 估计折点半径
    const charW = featFsDesired * 0.55
    const avgLabelLen = extFeats.reduce((sum, ef) => sum + ef.label.length, 0) / Math.max(1, extFeats.length)
    const avgLabelAngle = (avgLabelLen * charW) / (estR * Math.PI / 180) // 平均标签宽度对应的角度
    const minAngleGap = Math.max(avgLabelAngle * 1.2, 12) // 至少12度或平均宽度的1.2倍
    
    for (let k = 0; k < sorted.length; k++) {
      let stack = 0
      for (let j = 0; j < k; j++) {
        let diff = sorted[k].angle - sorted[j].angle
        if (diff < 0) diff += 360
        // 只有当与已分配的更低层级重叠时，才需要提升层级
        const prevStack = st[sorted[j].i] ?? 0
        if (diff < minAngleGap && prevStack >= stack) {
          stack = prevStack + 1
        }
      }
      st[sorted[k].i] = stack
    }
    return st
  }, [extFeats, featFsDesired, baseFoldR])

  const maxFeatStack = extFeats.length > 0 ? Math.max(...Object.values(featLabelStacks), 0) : 0
  const featLabelStep = featFsDesired + 12 // 增加间距，避免视觉拥挤
  const featExtBaseR = baseFoldR + (maxEnzStack + 1) * enzStep + 12 // 增加与酶切标注的间距

  // 折线水平段上限：150px，给长标签更多空间
  const MAX_H_LINE = 150
  const maxFoldR = featExtBaseR + maxFeatStack * featLabelStep
  const maxHExtent = extFeats.length > 0 ? Math.min(maxFoldR * 0.35, MAX_H_LINE) : 0

  // 最大标签可见字符数（由水平段上限决定）
  const maxLabelChars = extFeats.length > 0 ? Math.max(2, Math.floor((maxHExtent - 3) / (featFsDesired * 0.55))) : 0
  const maxTextW = maxLabelChars * featFsDesired * 0.55

  // 酶切标注最大水平延伸
  const enzMaxHExt = enzymeSites.reduce((m, e) => Math.max(m, (e.enzyme_name || '').length * (enzymeFontSize || 7) * 0.6), 0) + (enzymeFontSize || 7)

  // SVG 宽度：考虑圆心到两侧最远元素
  const maxCenterExtent = Math.max(
    maxFoldR + maxHExtent + maxTextW + featFsDesired + 20, // 元件折线标注
    enzLabelRadius + enzMaxHExt + 10, // 酶切标注
    rulerR + 30 // 标尺
  )
  const W = Math.max(960, Math.ceil(maxCenterExtent * 2))

  // SVG 高度：考虑底部元素
  const featLabelMaxR = featExtBaseR + (maxFeatStack + 1) * featLabelStep + 10
  const maxRadius = Math.max(enzLabelRadius, featLabelMaxR)
  const enzBottomY = cy + maxRadius
  const enzRows = enzymeSites.length > 0 ? 1 : 0
  const legendTypes = [...new Set(features.filter(f => f.type !== 'source' && (f.end - f.start) > 0).map(f => f.type))]
  const legendRows = Math.ceil(legendTypes.length / 7) + enzRows
  const legendH = legendRows * 20 + 10
  const legendY = enzBottomY + 20
  const H = legendY + legendH + 20

  // 引物堆叠计算（相近角度的依次向外径向偏移）
  const primerStep = 10
  const primerStacks: number[] = (() => {
    if (primerSites.length === 0) return []
    const sorted = primerSites.map((ps, i) => ({ i, angle: posToAngle(ps.position - 1) }))
      .sort((a, b) => a.angle - b.angle)
    const st: number[] = new Array(primerSites.length).fill(0)
    const MIN_GAP = 5
    for (let k = 1; k < sorted.length; k++) {
      const prev = sorted[k - 1], cur = sorted[k]
      let diff = cur.angle - prev.angle
      if (diff < 0) diff += 360
      if (diff < MIN_GAP) st[cur.i] = st[prev.i] + 1
    }
    return st
  })()

  return (
    <svg ref={onSvgRef || svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: `${zoom * 100}%`, minHeight: '500px' }}>
      {/* 标尺外环 */}
      <circle cx={cx} cy={cy} r={rulerR} fill="none" stroke="#e2e8f0" strokeWidth={0.5} />
      {/* 主骨架环 */}
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="#cbd5e1" strokeWidth={4} />
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="#e2e8f0" strokeWidth={2} />

      {/* 标尺刻度 */}
      {ticks.map((t, i) => {
        const tickOuter = polar(t.angle, rulerR)
        const tickInner = polar(t.angle, t.isMajor ? R + 12 : R + 22)
        const labelP = polar(t.angle, rulerR + 16)
        return (
          <g key={i}>
            <line x1={tickInner.x} y1={tickInner.y} x2={tickOuter.x} y2={tickOuter.y}
              stroke={t.isMajor ? '#64748b' : '#cbd5e1'} strokeWidth={t.isMajor ? 1.5 : 0.5} />
            {t.isMajor && (
              <text x={labelP.x} y={labelP.y} textAnchor="middle" dominantBaseline="middle"
                className="fill-slate-500 select-none font-medium" style={{ fontSize: `${(mapFontSize || 12) * 0.58}px` }}>
                {t.pos >= 1000 ? `${(t.pos / 1000).toFixed(t.pos % 1000 ? 1 : 0)}k` : t.pos}
              </text>
            )}
          </g>
        )
      })}
      {/* 标题 */}
      <text x={cx} y={26} textAnchor="middle"
        className="font-bold fill-slate-700" style={{ fontSize: `${(mapFontSize || 12) * 1.17}px` }}>{name}</text>
      <text x={cx} y={42} textAnchor="middle"
        className="fill-slate-400 select-none" style={{ fontSize: `${(mapFontSize || 12) * 0.75}px` }}>
        {size.toLocaleString()} bp 标尺
      </text>

      {/* 元件 */}
      {features.map((f, i) => {
        if (f.type === 'source' || (f.end - f.start) <= 0) return null
        const sa = posToAngle(f.start), ea = posToAngle(f.end)
        const isHovered = hoveredFeature === i
        const isSelected = selectedFeature === i
        const style = featureStyles?.[f.type]
        const color = style?.color || getColor(f.type)
        const fill = style?.fill || 'solid'
        const shape: FeatureShape = style?.shape || 'box'
        const opacity = isSelected ? 1 : isHovered ? 0.9 : 0.7
        const typeZh = FEATURE_TYPE_NAMES[f.type] || f.type
        const note = f.qualifiers.note || ''
        const label = note ? `${typeZh} ${note}` : typeZh
        const midA = (sa + (ea < sa ? ea + 360 : ea)) / 2
        const midR = (fInner + fOuter) / 2
        const mp = polar(midA, midR)
        const patternId = `circ-${f.type}-${i}`

        return (
          <g key={i}
            onClick={() => onSelectFeature(i)}
            onMouseEnter={() => { onHoverFeature(i); setTooltip({ x: mp.x, y: mp.y - 25, lines: [label, `${f.start + 1}..${f.end + 1} bp`, f.strand === 1 ? '→ 正向' : '← 反向'] }) }}
            onMouseLeave={() => { onHoverFeature(null); setTooltip(null) }}
            className="cursor-pointer">
            {/* 填充图案定义 */}
            {fill === 'striped' && (
              <defs><pattern id={patternId} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="3" />
              </pattern></defs>
            )}
            {fill === 'dotted' && (
              <defs><pattern id={patternId} patternUnits="userSpaceOnUse" width="6" height="6">
                <circle cx="3" cy="3" r="1.5" fill={color} />
              </pattern></defs>
            )}
            {fill === 'crosshatch' && (
              <defs><pattern id={patternId} patternUnits="userSpaceOnUse" width="6" height="6">
                <line x1="0" y1="0" x2="6" y2="6" stroke={color} strokeWidth="1" />
                <line x1="6" y1="0" x2="0" y2="6" stroke={color} strokeWidth="1" />
              </pattern></defs>
            )}
            {fill === 'horizontal' && (
              <defs><pattern id={patternId} patternUnits="userSpaceOnUse" width="6" height="6">
                <line x1="0" y1="3" x2="6" y2="3" stroke={color} strokeWidth="2" />
              </pattern></defs>
            )}
            {/* 弧形主体 */}
            {shape === 'line' ? (
              <path d={arcPath(sa, ea, (fInner + fOuter) / 2 - 1, (fInner + fOuter) / 2 + 1)}
                fill="none" stroke={color} strokeWidth={3} opacity={opacity} />
            ) : shape === 'wave' ? (
              (() => {
                let end = ea; if (end < sa) end += 360
                const wMr = (fInner + fOuter) / 2, wAmp = (fOuter - fInner) / 3, steps = 24
                const span = end - sa
                const pts = Array.from({ length: steps + 1 }, (_, j) => {
                  const a = sa + (j / steps) * span
                  const r = wMr + wAmp * Math.sin((j / steps) * Math.PI * 5)
                  return polar(a, r)
                })
                return <path d={pts.map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}
                  fill="none" stroke={color} strokeWidth={2.5} opacity={opacity} strokeLinecap="round" />
              })()
            ) : shape === 'box-arrow' ? (
              (() => {
                let end = ea; if (end < sa) end += 360
                const span = end - sa
                const bw = fOuter - fInner
                const midR = (fOuter + fInner) / 2
                
                // 箭头角度宽度：参照线性视图 max=14px，环形 midR=250 时 3°≈13px
                const awDeg = Math.min(Math.round(span * 0.3), 5)
                const bodySpan = Math.max(span - awDeg, 3)
                
                // 三角形底部径向延伸（参照线性视图 h*0.35）
                const triExt = Math.round(bw * 0.35)
                
                if (f.strand === 1) {
                  // 正向：方框从sa到bodyEnd，箭头尖端在 bodyEnd+awDeg 处
                  const bodyEnd = sa + bodySpan
                  const fillVal = fill === 'hollow' ? 'white' : (fill === 'striped' || fill === 'dotted' || fill === 'crosshatch' || fill === 'horizontal') ? `url(#${patternId})` : color
                  
                  const tip = polar(bodyEnd + awDeg, midR)
                  const baseOuter = polar(bodyEnd, fOuter + triExt)
                  const baseInner = polar(bodyEnd, fInner - triExt)
                  
                  return (
                    <>
                      {/* 方框主体 */}
                      <path d={arcPath(sa, bodyEnd, fInner, fOuter)}
                        fill={fillVal} opacity={opacity}
                        stroke={isSelected ? '#1e293b' : isHovered ? '#475569' : color}
                        strokeWidth={fill === 'hollow' ? 2 : isSelected ? 2 : isHovered ? 1.5 : 0.5} />
                      {/* 三角形箭头：底部在bodyEnd处内外展开，尖端在bodyEnd+awDeg处 */}
                      <polygon points={`${baseInner.x},${baseInner.y} ${tip.x},${tip.y} ${baseOuter.x},${baseOuter.y}`}
                        fill={color} opacity={opacity} stroke={isSelected ? '#1e293b' : isHovered ? '#475569' : color} strokeWidth={isSelected ? 1.5 : 0.5} />
                    </>
                  )
                } else {
                  // 反向：方框从bodyStart到ea，箭头尖端在 bodyStart-awDeg 处
                  const bodyStart = sa + awDeg
                  const fillVal = fill === 'hollow' ? 'white' : (fill === 'striped' || fill === 'dotted' || fill === 'crosshatch' || fill === 'horizontal') ? `url(#${patternId})` : color
                  
                  const tip = polar(bodyStart - awDeg, midR)
                  const baseOuter = polar(bodyStart, fOuter + triExt)
                  const baseInner = polar(bodyStart, fInner - triExt)
                  
                  return (
                    <>
                      {/* 方框主体 */}
                      <path d={arcPath(bodyStart, ea, fInner, fOuter)}
                        fill={fillVal} opacity={opacity}
                        stroke={isSelected ? '#1e293b' : isHovered ? '#475569' : color}
                        strokeWidth={fill === 'hollow' ? 2 : isSelected ? 2 : isHovered ? 1.5 : 0.5} />
                      {/* 三角形箭头：底部在bodyStart处内外展开，尖端在bodyStart-awDeg处 */}
                      <polygon points={`${baseInner.x},${baseInner.y} ${tip.x},${tip.y} ${baseOuter.x},${baseOuter.y}`}
                        fill={color} opacity={opacity} stroke={isSelected ? '#1e293b' : isHovered ? '#475569' : color} strokeWidth={isSelected ? 1.5 : 0.5} />
                    </>
                  )
                }
              })()
            ) : (
              // 默认形状：普通弧形
              <path d={arcPath(sa, ea, fInner, fOuter)}
                fill={fill === 'hollow' ? 'white' : (fill === 'striped' || fill === 'dotted' || fill === 'crosshatch' || fill === 'horizontal') ? `url(#${patternId})` : color}
                opacity={opacity}
                stroke={isSelected ? '#1e293b' : isHovered ? '#475569' : color}
                strokeWidth={fill === 'hollow' ? 2 : isSelected ? 2 : isHovered ? 1.5 : 0.5} />
            )}
            {/* 方向箭头（非箭头形状时显示） */}
            {shape !== 'arrow' && shape !== 'box-arrow' && shape !== 'big-arrow' &&
              (ea - sa > 8 || (ea + 360 - sa) > 8) && (
              <polygon
                points={arrowPoints(mp, midA + (f.strand === 1 ? 0 : 180), 7)}
                fill={fill === 'hollow' ? color : 'white'} opacity={0.85} />
            )}
            {/* 弧形文字标签（沿环形结构方向，完整标签放不下时由外部折线标注渲染） */}
            {(() => {
              const featFs = Math.min(fOuter - fInner - 4, Math.max(5, featureFontSize || 10))
              let end = ea; if (end < sa) end += 360
              const span = end - sa
              const textR = midR
              const arcLen = (span * Math.PI / 180) * textR
              const charW = featFsDesired * 0.55 // 用用户期望字号判断是否放得下
              const maxChars = Math.max(0, Math.floor((arcLen - 4) / charW))
              // 完整标签放不下时不显示内部文字，由外部标注渲染
              if (maxChars < label.length) return null
              if (maxChars < 2) return null
              const displayLabel = label.length <= maxChars ? label : label.substring(0, maxChars)
              const pathId = `ct-${i}`
              const isBottom = midA > 0 && midA < 180
              const pS = isBottom ? polar(end, textR) : polar(sa, textR)
              const pE = isBottom ? polar(sa, textR) : polar(end, textR)
              const large = span > 180 ? 1 : 0
              const sweep = isBottom ? 0 : 1
              const d = `M ${pS.x} ${pS.y} A ${textR} ${textR} 0 ${large} ${sweep} ${pE.x} ${pE.y}`
              return (
                <>
                  <defs><path id={pathId} d={d} /></defs>
                  <text className={`font-medium select-none ${fill === 'hollow' ? 'fill-slate-700' : 'fill-white'}`}
                    style={{ fontSize: `${featFs}px`, pointerEvents: 'none' }}>
                    <textPath href={`#${pathId}`} startOffset="50%" textAnchor="middle">{displayLabel}</textPath>
                  </text>
                </>
              )
            })()}
          </g>
        )
      })}

      {/* 酶切位点折线标注：径向线 + 水平折线 + 文字（堆叠逐级外移，不重叠） */}
      {showEnzymeSites && enzymeSites.map((es, i) => {
        const a = posToAngle(es.position)
        const stack = enzymeStacks[i]
        const foldR = baseFoldR + stack * enzStep // 折点半径（基点已超出标尺标签）
        const p1 = polar(a, eOuter) // 径向起点（环形外缘）
        const pFold = polar(a, foldR) // 折点
        const isUnique = es.is_unique
        const color = enzymeColor(es.enzyme_name || '')
        const rad = (a * Math.PI) / 180
        const cosA = Math.cos(rad)
        const hDir = cosA >= 0 ? 1 : -1 // 水平方向：右侧(cos>0)向右，左侧(cos<0)向左
        const nameLen = (es.enzyme_name || '').length
        const textW = nameLen * fs * 0.6
        const lineLen = textW + fs * 0.8 // 水平折线段长度
        const textStartX = pFold.x + hDir * (lineLen + 3) // 文字起始X（折线外侧+3px间距）
        const hEndX = pFold.x + hDir * lineLen // 水平段终点X
        return (
          <g key={`el${i}`}
            onClick={() => onSelectEnzymeSite?.(es)}
            onMouseEnter={() => setTooltip({ x: pFold.x, y: pFold.y - 15, lines: [es.enzyme_name || `Site ${i}`, `识别: ${es.recognition_sequence || ''}`, `位置: ${es.position + 1} bp`, isUnique ? '✓ 唯一位点' : '✗ 多位点'] })}
            onMouseLeave={() => setTooltip(null)}
            className="cursor-pointer">
            {/* 径向线段 */}
            <line x1={p1.x} y1={p1.y} x2={pFold.x} y2={pFold.y}
              stroke={color} strokeWidth={isUnique ? 1.5 : 1} />
            {/* 水平折线段 */}
            <line x1={pFold.x} y1={pFold.y} x2={hEndX} y2={pFold.y}
              stroke={color} strokeWidth={1} opacity={0.7} />
            {/* 酶切名称文字（在折线外侧） */}
            <text x={textStartX} y={pFold.y}
              textAnchor={hDir > 0 ? 'start' : 'end'} dominantBaseline="middle"
              className="select-none font-medium" fill={color}
              style={{ pointerEvents: 'none', fontSize: `${fs}px` }}>
              {es.enzyme_name || ''}
            </text>
          </g>
        )
      })}

      {/* 通用引物标注（支持多种样式，沿环形切线方向） */}
      {showPrimerSites && primerSites.map((ps, i) => {
        const a = posToAngle(ps.position - 1) // position是1-based
        const primerFs = fs * 0.9 // 引物字号稍小
        const pColor = primerColor || '#0891b2'
        const rad = (a * Math.PI) / 180
        // 切线方向：顺时针=(sin, -cos)，逆时针=(-sin, cos)
        // 序列正向（strand=1）应该沿顺时针方向延伸
        const tx = Math.sin(rad)
        const ty = -Math.cos(rad)
        const dir = ps.strand === 1 ? 1 : -1 // 引物方向：正向=顺时针，反向=逆时针
        // 从环形外缘沿切线向外延伸（堆叠偏移）
        const lineStart = polar(a, eOuter + 4 + (primerStacks[i] || 0) * primerStep)
        const lineLen = 20 + primerFs * 0.8
        const lineEnd = {
          x: lineStart.x + dir * tx * lineLen,
          y: lineStart.y + dir * ty * lineLen
        }
        const arrowSize = 5
        // 垂直于切线方向（用于箭头多边形展开）
        const perpX = -dir * ty
        const perpY = dir * tx
      
        // 根据不同样式渲染
        const renderMarker = () => {
          if (primerStyle === 'line') {
            return (
              <line x1={lineStart.x} y1={lineStart.y} x2={lineEnd.x} y2={lineEnd.y}
                stroke={pColor} strokeWidth={2} />
            )
          }
          if (primerStyle === 'triangle') {
            const tSize = arrowSize * 1.2
            return (
              <>
                <line x1={lineStart.x} y1={lineStart.y} x2={lineEnd.x} y2={lineEnd.y}
                  stroke={pColor} strokeWidth={1} />
                <polygon
                  points={`${lineEnd.x + dir * tx * tSize},${lineEnd.y + dir * ty * tSize} ${lineEnd.x + perpX * tSize},${lineEnd.y + perpY * tSize} ${lineEnd.x - perpX * tSize},${lineEnd.y - perpY * tSize}`}
                  fill={pColor} />
              </>
            )
          }
          if (primerStyle === 'flag') {
            const flagW = 8
            return (
              <>
                <line x1={lineStart.x} y1={lineStart.y} x2={lineEnd.x} y2={lineEnd.y}
                  stroke={pColor} strokeWidth={1.5} />
                {/* 垂直于引物方向的端线（旗帜） */}
                <line x1={lineEnd.x - dir * ty * flagW} y1={lineEnd.y + dir * tx * flagW}
                      x2={lineEnd.x + dir * ty * flagW} y2={lineEnd.y - dir * tx * flagW}
                      stroke={pColor} strokeWidth={2.5} />
              </>
            )
          }
          // 默认 arrow
          return (
            <>
              <line x1={lineStart.x} y1={lineStart.y} x2={lineEnd.x} y2={lineEnd.y}
                stroke={pColor} strokeWidth={1.5} />
              <polygon
                points={`${lineEnd.x + dir * tx * arrowSize},${lineEnd.y + dir * ty * arrowSize} ${lineEnd.x + perpX * arrowSize},${lineEnd.y + perpY * arrowSize} ${lineEnd.x - perpX * arrowSize},${lineEnd.y - perpY * arrowSize}`}
                fill={pColor} />
            </>
          )
        }
      
        const textPos = {
          x: lineEnd.x + dir * tx * (arrowSize + 6),
          y: lineEnd.y + dir * ty * (arrowSize + 6)
        }
      
        return (
          <g key={`primer${i}`}
            onMouseEnter={() => setTooltip({ x: lineEnd.x, y: lineEnd.y - 15, lines: [
              ps.primer_name,
              `序列: ${ps.sequence}`,
              `位置: ${ps.position} bp`,
              `方向: ${ps.strand === 1 ? '正向' : '反向互补'}`
            ] })}
            onMouseLeave={() => setTooltip(null)}
            className="cursor-pointer">
            {renderMarker()}
            {/* 引物名称文字 */}
            <text x={textPos.x} y={textPos.y}
              textAnchor="start" dominantBaseline="middle"
              className="select-none font-medium" fill={pColor}
              style={{ pointerEvents: 'none', fontSize: `${primerFs}px` }}>
              {ps.primer_name}
            </text>
          </g>
        )
      })}

      {/* 元件外部折线标注（文字放不下时用，圆心发散向外） */}
      {extFeats.map((ef) => {
        const a = ef.angle
        const stack = featLabelStacks[ef.i] ?? 0
        const foldR = featExtBaseR + stack * featLabelStep
        const p1 = polar(a, fOuter + 2) // 起点：元件环外缘
        const pFold = polar(a, foldR) // 折点
        const rad = (a * Math.PI) / 180
        const cosA = Math.cos(rad)
        const hDir = cosA >= 0 ? 1 : -1
        // 限制水平段长度，截断过长标签
        const charW = featFsDesired * 0.55
        const maxChars = Math.max(2, Math.floor((maxHExtent - 3) / charW))
        const truncated = ef.label.length > maxChars ? ef.label.slice(0, maxChars - 1) + '…' : ef.label
        const lineLen = Math.min(maxHExtent, truncated.length * charW + featFsDesired * 0.5)
        const textStartX = pFold.x + hDir * (lineLen + 3)
        const hEndX = pFold.x + hDir * lineLen
        return (
          <g key={`ext-f-${ef.i}`}>
            {/* 径向线段 */}
            <line x1={p1.x} y1={p1.y} x2={pFold.x} y2={pFold.y}
              stroke={ef.color} strokeWidth={1} />
            {/* 水平折线段 */}
            <line x1={pFold.x} y1={pFold.y} x2={hEndX} y2={pFold.y}
              stroke={ef.color} strokeWidth={1} opacity={0.7} />
            {/* 元件名称文字（颜色与元件一致） */}
            <text x={textStartX} y={pFold.y}
              textAnchor={hDir > 0 ? 'start' : 'end'} dominantBaseline="middle"
              className="select-none font-medium" fill={ef.color}
              style={{ pointerEvents: 'none', fontSize: `${featFsDesired}px` }}>
              {truncated}
            </text>
          </g>
        )
      })}

      {/* 序列选择标记 */}
      {sequenceSelection && (() => {
        const sa = posToAngle(sequenceSelection.start)
        const ea = posToAngle(sequenceSelection.end)
        const p1 = polar(sa, fInner - 10)
        const p2 = polar(sa, eOuter + 15)
        const p3 = polar(ea, fInner - 10)
        const p4 = polar(ea, eOuter + 15)
        return (
          <g>
            {/* 透明红色弧形覆盖选区 */}
            <path d={arcPath(sa, ea, fInner, fOuter)}
              fill="#f43f5e" opacity={0.2} />
            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
              stroke="#f43f5e" strokeWidth={1.5} strokeDasharray="4,2" opacity={0.8} />
            <line x1={p3.x} y1={p3.y} x2={p4.x} y2={p4.y}
              stroke="#f43f5e" strokeWidth={1.5} strokeDasharray="4,2" opacity={0.8} />
          </g>
        )
      })()}

      {/* 酶切位点文字已合并到折线标注中 */}

      {/* 中心信息 */}
      <text x={cx} y={cy - 20} textAnchor="middle" className="font-bold fill-slate-700" style={{ fontSize: `${(mapFontSize || 12) * 1.17}px` }}>{name}</text>
      <text x={cx} y={cy + 5} textAnchor="middle" className="fill-slate-400" style={{ fontSize: `${(mapFontSize || 12) * 0.83}px` }}>{size.toLocaleString()} bp</text>
      <text x={cx} y={cy + 22} textAnchor="middle" className="fill-slate-400" style={{ fontSize: `${(mapFontSize || 12) * 0.83}px` }}>{topology === 'circular' ? '环形' : '线性'}</text>

      {/* 图例 */}
      <Legend features={features} enzymeSites={enzymeSites} x={30} y={legendY} featureStyles={featureStyles} scale={legendScale} />

      {/* Tooltip */}
      {tooltip && (
        <g>
          <rect x={tooltip.x - 95} y={tooltip.y - 10 - tooltip.lines.length * 14} width={190} height={tooltip.lines.length * 14 + 10} rx={5} fill="#1e293b" opacity={0.92} />
          {tooltip.lines.map((line, i) => (
            <text key={i} x={tooltip.x} y={tooltip.y - tooltip.lines.length * 14 + 8 + i * 14} textAnchor="middle" className="text-[10px] fill-white">{line}</text>
          ))}
        </g>
      )}
    </svg>
  )
}
// eslint-disable-next-line react/display-name
const MemoCircularView = memo(CircularView)

// ====================== Linear View ======================
function LinearView({
  svgRef, size, name, features, enzymeSites, showEnzymeSites,
  primerSites, showPrimerSites, primerStyle, primerColor,
  selectedFeature, onSelectFeature, hoveredFeature, onHoverFeature,
  tooltip, setTooltip, onSelectEnzymeSite, zoom, featureStyles,
  sequenceSelection, enzymeFontSize, mapFontSize, legendScale,
  featureFontSize, featureHeight, onSvgRef
}: {
  svgRef: React.RefObject<SVGSVGElement>
  size: number; name: string
  features: GenBankFeature[]; enzymeSites: EnzymeSiteInfo[]; showEnzymeSites: boolean
  primerSites: PrimerSiteInfo[]; showPrimerSites: boolean
  primerStyle: string; primerColor: string
  selectedFeature: number | null; onSelectFeature: (i: number | null) => void
  hoveredFeature: number | null; onHoverFeature: (i: number | null) => void
  tooltip: { x: number; y: number; lines: string[] } | null
  setTooltip: (t: { x: number; y: number; lines: string[] } | null) => void
  onSelectEnzymeSite?: (site: EnzymeSiteInfo | null) => void
  zoom: number
  featureStyles?: FeatureStyles
  sequenceSelection?: { start: number; end: number } | null
  enzymeFontSize?: number
  mapFontSize?: number
  legendScale?: number
  featureFontSize?: number
  featureHeight?: number
  onSvgRef?: (el: SVGSVGElement | null) => void
}) {
  const W = 1200, ML = 80, MR = 80
  const trackH = 8
  const usable = W - ML - MR

  const posToX = useCallback((p: number) => ML + (p / size) * usable, [size, usable])

  const ticks = useMemo(() => {
    const interval = size > 20000 ? 5000 : size > 5000 ? 1000 : size > 1000 ? 500 : 100
    const r: { pos: number; x: number }[] = []
    for (let p = 0; p <= size; p += interval) r.push({ pos: p, x: posToX(p) })
    return r
  }, [size, posToX])

  // 分行避免重叠（过滤source类型和零长度元件，保留原始索引）
  const featureRows = useMemo(() => {
    const visible = features
      .map((f, i) => ({ f, origIdx: i }))
      .filter(({ f }) => f.type !== 'source' && (f.end - f.start) > 0)
    const sorted = [...visible].sort((a, b) => a.f.start - b.f.start)
    const rowEnds: number[] = []
    const rows: number[] = []
    sorted.forEach(({ f }, idx) => {
      let row = 0
      while (row < rowEnds.length && rowEnds[row] > f.start) row++
      rows[idx] = row
      rowEnds[row] = f.end
    })
    return sorted.map((item, i) => ({ feature: item.f, row: rows[i], origIdx: item.origIdx }))
  }, [features])

  const maxRow = Math.max(0, ...featureRows.map(r => r.row))

  // 酶切位点堆叠计算（像素距离太近的依次堆叠）
  const enzymeStacks = useMemo(() => {
    const sorted = enzymeSites.map((es, i) => ({ i, px: posToX(es.position) }))
      .sort((a, b) => a.px - b.px)
    const st: number[] = new Array(enzymeSites.length).fill(0)
    const fs = enzymeFontSize || 7
    // 动态堆叠阈值：取最大标签视觉宽度*2（折线向左+文字向左延伸），确保任何字号下都不重叠
    const maxLabelW = enzymeSites.reduce((m, e) => Math.max(m, (e.enzyme_name || '').length), 0) * fs * 0.6
    const MIN_PX_GAP = Math.max(24, maxLabelW * 2 + fs * 2)
    for (let k = 1; k < sorted.length; k++) {
      const prev = sorted[k - 1], cur = sorted[k]
      if (cur.px - prev.px < MIN_PX_GAP) st[cur.i] = st[prev.i] + 1
    }
    return st
  }, [enzymeSites, posToX])

  // 酶切标签所需上方空间（折线布局）
  const maxEnzStack = Math.max(0, ...enzymeStacks)
  const fs = enzymeFontSize || 7
  const enzStep = fs + 5 // 每级堆叠的垂直步长
  const enzH = (maxEnzStack + 1) * enzStep + fs + 10
  const trackY = 65 + enzH
  const featH = featureHeight || 22
  const rowSpacing = featH + 8

  // 元件外部标注（线性视图向下折线，与酶切向上反向）
  const featFsL = Math.max(5, featureFontSize || 10)
  const extFeatLabels = useMemo(() => {
    const result: { i: number; x: number; row: number; label: string; color: string; fill: string }[] = []
    features.forEach((f, i) => {
      if (f.type === 'source' || (f.end - f.start) <= 0) return
      const x1 = posToX(f.start), x2 = posToX(f.end)
      const bw = Math.max(x2 - x1, 6)
      const labelFs = Math.min(featH - 2, featFsL)
      const charW = labelFs * 0.55
      const maxCharsPerLine = Math.max(0, Math.floor((bw - 4) / charW))
      const maxLines = Math.max(1, Math.floor((featH - 2) / (labelFs * 1.2)))
      const note = f.qualifiers.note || ''
      const label = note ? `${FEATURE_TYPE_NAMES[f.type] || f.type} ${note}` : FEATURE_TYPE_NAMES[f.type] || f.type
      // 多行换行仍放不下时启用外部折线标注
      if (maxCharsPerLine < 1 || maxCharsPerLine * maxLines < label.length) {
        const style = featureStyles?.[f.type]
        const color = style?.color || getColor(f.type)
        // 查找该元件在哪个行
        const rowInfo = featureRows.find(r => r.origIdx === i)
        result.push({ i, x: (x1 + x2) / 2, row: rowInfo?.row ?? 0, label, color, fill: style?.fill || 'solid' })
      }
    })
    // 堆叠：相近X的依次下移，阈值基于字号+标签宽度
    const sorted = [...result].sort((a, b) => a.x - b.x)
    const stacks: Record<number, number> = {}
    const minGap = Math.max(60, featFsL * 4) // 动态阈值
    for (let k = 0; k < sorted.length; k++) {
      let stack = 0
      for (let j = 0; j < k; j++) {
        if (Math.abs(sorted[k].x - sorted[j].x) < minGap && (stacks[sorted[j].i] ?? 0) >= stack) {
          stack = (stacks[sorted[j].i] ?? 0) + 1
        }
      }
      stacks[sorted[k].i] = stack
    }
    return result.map(r => ({ ...r, stack: stacks[r.i] ?? 0 }))
  }, [features, featureStyles, posToX, featFsL, featH, featureRows])

  const maxExtFeatStack = extFeatLabels.length > 0 ? Math.max(...extFeatLabels.map(f => f.stack), 0) : 0
  const extFeatH = (maxExtFeatStack + 1) * (featFsL + 12) + 15

  // 折线水平段上限：80px，超出则截断文字
  const LINEAR_MAX_H_LINE = 80
  const linearMaxChars = Math.max(2, Math.floor((LINEAR_MAX_H_LINE - 3) / (featFsL * 0.55)))

  // 线性视图实际渲染宽度（考虑右侧溢出）
  const maxLabelRightExtent = extFeatLabels.reduce((m, ef) => {
    const charW = featFsL * 0.55
    const truncatedLen = Math.min(ef.label.length, linearMaxChars)
    const textW = truncatedLen * charW
    const lineLen = Math.min(LINEAR_MAX_H_LINE, textW + featFsL * 0.5)
    return Math.max(m, ef.x + lineLen + 3 + textW)
  }, 0)
  const enzMaxRight = enzymeSites.reduce((m, es) => {
    const x = posToX(es.position)
    const nameW = (es.enzyme_name || '').length * (enzymeFontSize || 7) * 0.6
    return Math.max(m, x + nameW + 5)
  }, 0)
  const renderW = Math.max(W, maxLabelRightExtent + 20, enzMaxRight + 20, W)

  const H = Math.max(500, trackY + 70 + (maxRow + 1) * rowSpacing + 90 + (extFeatLabels.length > 0 ? extFeatH : 0))

  // 引物堆叠计算（相近位置的依次向上偏移）
  const primerStep = 16
  const primerStacks: number[] = (() => {
    if (primerSites.length === 0) return []
    const sorted = primerSites.map((ps, i) => ({ i, x: posToX(ps.position - 1) }))
      .sort((a, b) => a.x - b.x)
    const st: number[] = new Array(primerSites.length).fill(0)
    const MIN_GAP = 25
    for (let k = 1; k < sorted.length; k++) {
      const prev = sorted[k - 1], cur = sorted[k]
      if (cur.x - prev.x < MIN_GAP) st[cur.i] = st[prev.i] + 1
    }
    return st
  })()

  return (
    <svg ref={onSvgRef || svgRef} viewBox={`0 0 ${renderW} ${H}`} style={{ width: `${zoom * 100}%`, minHeight: '350px' }}>
      {/* 标题 */}
      <text x={renderW / 2} y={30} textAnchor="middle" className="font-bold fill-slate-700" style={{ fontSize: `${(mapFontSize || 12) * 1.17}px` }}>
        {name} — {size.toLocaleString()} bp (线性视图)
      </text>

      {/* 刻度 */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={t.x} y1={trackY - 12} x2={t.x} y2={trackY + trackH + 12} stroke="#cbd5e1" strokeWidth={1} />
          <text x={t.x} y={trackY - 18} textAnchor="middle" className="fill-slate-400" style={{ fontSize: `${(mapFontSize || 12) * 0.67}px` }}>
            {t.pos >= 1000 ? `${(t.pos / 1000).toFixed(t.pos % 1000 ? 1 : 0)}k` : t.pos}
          </text>
        </g>
      ))}

      {/* 骨架线 */}
      <line x1={ML} y1={trackY + trackH / 2} x2={W - MR} y2={trackY + trackH / 2}
        stroke="#64748b" strokeWidth={trackH} strokeLinecap="round" />

      {/* 酶切位点折线标注：垂直线 + 水平折线 + 文字（堆叠逐级上移，不重叠） */}
      {showEnzymeSites && enzymeSites.map((es, i) => {
        const x = posToX(es.position)
        const isUnique = es.is_unique
        const stack = enzymeStacks[i]
        const color = enzymeColor(es.enzyme_name || '')
        const foldY = trackY - (stack + 1) * enzStep // 折点Y（越高层越高）
        const nameLen = (es.enzyme_name || '').length
        const textW = nameLen * fs * 0.6
        const hLen = textW + fs * 0.8 // 水平段长度
        return (
          <g key={`el${i}`}
            onClick={() => onSelectEnzymeSite?.(es)}
            onMouseEnter={() => setTooltip({ x, y: foldY - 15, lines: [es.enzyme_name || `Site ${i}`, `识别: ${es.recognition_sequence || ''}`, `位置: ${es.position + 1} bp`, isUnique ? '✓ 唯一位点' : '✗ 多位点'] })}
            onMouseLeave={() => setTooltip(null)}
            className="cursor-pointer">
            {/* 垂直线段 */}
            <line x1={x} y1={trackY + trackH / 2} x2={x} y2={foldY}
              stroke={color} strokeWidth={isUnique ? 1.5 : 1} strokeDasharray={isUnique ? '' : '3,2'} />
            {/* 水平折线段（向左延伸） */}
            <line x1={x} y1={foldY} x2={x - hLen} y2={foldY}
              stroke={color} strokeWidth={1} opacity={0.7} />
            {/* 酶切名称文字 */}
            <text x={x - hLen - 2} y={foldY} textAnchor="end" dominantBaseline="middle"
              className="select-none font-medium" fill={color}
              style={{ pointerEvents: 'none', fontSize: `${fs}px` }}>
              {es.enzyme_name || ''}
            </text>
          </g>
        )
      })}

      {/* 通用引物标注（支持多种样式，沿序列方向水平排列） */}
      {showPrimerSites && primerSites.map((ps, i) => {
        const x = posToX(ps.position - 1) // position是1-based
        const primerFs = fs * 0.9
        const pColor = primerColor || '#0891b2'
        const arrowSize = 5
        const dir = ps.strand === 1 ? 1 : -1 // 引物方向：正向→右，反向→左
        // 沿序列方向水平延伸（轨道上方固定高度，堆叠偏移）
        const lineY = trackY - 12 - (primerStacks[i] || 0) * primerStep
        const lineLen = 20 + primerFs * 0.6
        const lineStart = { x, y: lineY }
        const lineEnd = { x: x + dir * lineLen, y: lineY }

        const renderMarker = () => {
          if (primerStyle === 'line') {
            return (
              <line x1={lineStart.x} y1={lineStart.y} x2={lineEnd.x} y2={lineEnd.y}
                stroke={pColor} strokeWidth={2} />
            )
          }
          if (primerStyle === 'triangle') {
            const tSize = arrowSize * 1.2
            return (
              <>
                <line x1={lineStart.x} y1={lineStart.y} x2={lineEnd.x} y2={lineEnd.y}
                  stroke={pColor} strokeWidth={1} />
                <polygon
                  points={`${lineEnd.x + dir * tSize},${lineEnd.y} ${lineEnd.x},${lineEnd.y - tSize} ${lineEnd.x},${lineEnd.y + tSize}`}
                  fill={pColor} />
              </>
            )
          }
          if (primerStyle === 'flag') {
            const flagW = 10, flagH = 7
            return (
              <>
                <line x1={lineStart.x} y1={lineStart.y} x2={lineEnd.x} y2={lineEnd.y}
                  stroke={pColor} strokeWidth={1.5} />
                <rect x={lineEnd.x} y={lineEnd.y - flagH / 2}
                  width={dir > 0 ? flagW : -flagW} height={flagH}
                  fill={pColor} rx={1} />
              </>
            )
          }
          // 默认 arrow
          return (
            <>
              <line x1={lineStart.x} y1={lineStart.y} x2={lineEnd.x} y2={lineEnd.y}
                stroke={pColor} strokeWidth={1.5} />
              <polygon
                points={`${lineEnd.x + dir * arrowSize},${lineEnd.y} ${lineEnd.x},${lineEnd.y - arrowSize} ${lineEnd.x},${lineEnd.y + arrowSize}`}
                fill={pColor} />
            </>
          )
        }

        const textX = lineEnd.x + dir * (arrowSize + 4)
        const textAnchor = dir > 0 ? 'start' : 'end'

        return (
          <g key={`primer${i}`}
            onMouseEnter={() => setTooltip({ x: lineEnd.x, y: lineEnd.y - 15, lines: [
              ps.primer_name,
              `序列: ${ps.sequence}`,
              `位置: ${ps.position} bp`,
              `方向: ${ps.strand === 1 ? '正向' : '反向互补'}`
            ] })}
            onMouseLeave={() => setTooltip(null)}
            className="cursor-pointer">
            {renderMarker()}
            {/* 引物名称文字 */}
            <text x={textX} y={lineEnd.y}
              textAnchor={textAnchor} dominantBaseline="middle"
              className="select-none font-medium" fill={pColor}
              style={{ pointerEvents: 'none', fontSize: `${primerFs}px` }}>
              {ps.primer_name}
            </text>
          </g>
        )
      })}

      {/* 元件 */}
      {featureRows.map(({ feature, row, origIdx }, i) => {
        const x1 = posToX(feature.start), x2 = posToX(feature.end)
        const y = trackY + 75 + row * rowSpacing
        const isHovered = hoveredFeature === origIdx
        const isSelected = selectedFeature === origIdx
        const style = featureStyles?.[feature.type]
        const color = style?.color || getColor(feature.type)
        const shape: FeatureShape = style?.shape || 'box'
        const fill: FillPattern = style?.fill || 'solid'
        const typeZh = FEATURE_TYPE_NAMES[feature.type] || feature.type
        const note = feature.qualifiers.note || ''
        const label = note ? `${typeZh} ${note}` : typeZh
        const bw = Math.max(x2 - x1, 6)
        const h = featH
        const mp = { x: (x1 + x2) / 2, y: y + h / 2 }
        const opacity = isSelected ? 1 : isHovered ? 0.9 : 0.7
        const strokeColor = isSelected ? '#1e293b' : isHovered ? '#475569' : color
        const strokeW = isSelected ? 2 : 1.5
        const patId = `lin-${feature.type}-${i}`
        const fillVal = fill === 'hollow' ? 'white' : (fill === 'striped' || fill === 'dotted' || fill === 'crosshatch' || fill === 'horizontal') ? `url(#${patId})` : color
        const fwd = feature.strand === 1

        return (
          <g key={i}
            onClick={() => onSelectFeature(origIdx)}
            onMouseEnter={() => { onHoverFeature(origIdx); setTooltip({ x: mp.x, y: y - 5, lines: [label, `${feature.start + 1}..${feature.end + 1} bp`, fwd ? '→ 正向' : '← 反向'] }) }}
            onMouseLeave={() => { onHoverFeature(null); setTooltip(null) }}
            className="cursor-pointer">
            {/* 连接线 */}
            <line x1={mp.x} y1={trackY + trackH} x2={mp.x} y2={y} stroke="#e2e8f0" strokeWidth={1} strokeDasharray="2,2" />
            {/* 填充图案定义 */}
            {fill === 'striped' && (
              <defs><pattern id={patId} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="3" />
              </pattern></defs>
            )}
            {fill === 'dotted' && (
              <defs><pattern id={patId} patternUnits="userSpaceOnUse" width="6" height="6">
                <circle cx="3" cy="3" r="1.5" fill={color} />
              </pattern></defs>
            )}
            {fill === 'crosshatch' && (
              <defs><pattern id={patId} patternUnits="userSpaceOnUse" width="6" height="6">
                <line x1="0" y1="0" x2="6" y2="6" stroke={color} strokeWidth="1" />
                <line x1="6" y1="0" x2="0" y2="6" stroke={color} strokeWidth="1" />
              </pattern></defs>
            )}
            {fill === 'horizontal' && (
              <defs><pattern id={patId} patternUnits="userSpaceOnUse" width="6" height="6">
                <line x1="0" y1="3" x2="6" y2="3" stroke={color} strokeWidth="2" />
              </pattern></defs>
            )}
            {/* 根据形状渲染 */}
            {shape === 'arrow' && (
              <polygon
                points={fwd
                  ? `${x1},${y} ${x1 + bw - 10},${y} ${x1 + bw},${y + h / 2} ${x1 + bw - 10},${y + h} ${x1},${y + h}`
                  : `${x1 + 10},${y} ${x1 + bw},${y} ${x1 + bw},${y + h} ${x1 + 10},${y + h} ${x1},${y + h / 2}`}
                fill={fillVal} opacity={opacity} stroke={strokeColor} strokeWidth={strokeW} />
            )}
            {shape === 'box' && (
              <rect x={x1} y={y} width={bw} height={h} rx={3}
                fill={fillVal} opacity={opacity} stroke={strokeColor} strokeWidth={fill === 'hollow' ? 2 : strokeW} />
            )}
            {shape === 'box-arrow' && (() => {
              const aw = Math.min(Math.round(bw * 0.3), 14)
              const bodyW = Math.max(bw - aw, 4)
              const triExt = Math.round(h * 0.35)
              if (fwd) {
                return <>
                  <rect x={x1} y={y} width={bodyW} height={h} rx={1}
                    fill={fillVal} opacity={opacity} stroke={strokeColor} strokeWidth={strokeW} />
                  <polygon points={`${x1 + bodyW},${y - triExt} ${x1 + bw},${y + h / 2} ${x1 + bodyW},${y + h + triExt}`}
                    fill={color} opacity={opacity} stroke={strokeColor} strokeWidth={1} />
                </>
              } else {
                return <>
                  <rect x={x1 + aw} y={y} width={bodyW} height={h} rx={1}
                    fill={fillVal} opacity={opacity} stroke={strokeColor} strokeWidth={strokeW} />
                  <polygon points={`${x1 + aw},${y - triExt} ${x1},${y + h / 2} ${x1 + aw},${y + h + triExt}`}
                    fill={color} opacity={opacity} stroke={strokeColor} strokeWidth={1} />
                </>
              }
            })()}
            {shape === 'bent-arrow' && (
              <>
                <line x1={x1 + 4} y1={y + h} x2={x1 + 4} y2={y + 4} stroke={color} strokeWidth={2.5} opacity={opacity} />
                <line x1={x1 + 4} y1={y + 4} x2={x1 + bw - 8} y2={y + 4} stroke={color} strokeWidth={2.5} opacity={opacity} />
                <polygon points={fwd
                  ? `${x1 + bw - 8},${y} ${x1 + bw},${y + 4} ${x1 + bw - 8},${y + 8}`
                  : `${x1 + 8},${y} ${x1},${y + 4} ${x1 + 8},${y + 8}`}
                  fill={color} opacity={opacity} />
              </>
            )}
            {shape === 'wave' && (
              <path d={`M ${x1},${y + h / 2} Q ${x1 + bw * 0.25},${y} ${x1 + bw * 0.5},${y + h / 2} Q ${x1 + bw * 0.75},${y + h} ${x1 + bw},${y + h / 2}`}
                fill="none" stroke={color} strokeWidth={2.5} opacity={opacity} />
            )}
            {shape === 'line' && (
              <line x1={x1} y1={y + h / 2} x2={x1 + bw} y2={y + h / 2}
                stroke={color} strokeWidth={3} opacity={opacity} />
            )}
            {shape === 'big-arrow' && (() => {
              const bh = 30
              const by = y - (bh - h) / 2
              const ah = 20
              return <polygon
                points={fwd
                  ? `${x1},${by} ${x1 + bw - ah},${by} ${x1 + bw},${by + bh / 2} ${x1 + bw - ah},${by + bh} ${x1},${by + bh}`
                  : `${x1 + ah},${by} ${x1 + bw},${by} ${x1 + bw},${by + bh} ${x1 + ah},${by + bh} ${x1},${by + bh / 2}`}
                fill={fillVal} opacity={opacity} stroke={strokeColor} strokeWidth={strokeW + 0.5} />
            })()}
            {shape === 'bent-arrow-up' && (
              <>
                <line x1={x1 + 4} y1={y} x2={x1 + 4} y2={y + h - 4} stroke={color} strokeWidth={2.5} opacity={opacity} />
                <line x1={x1 + 4} y1={y + h - 4} x2={x1 + bw - 8} y2={y + h - 4} stroke={color} strokeWidth={2.5} opacity={opacity} />
                <polygon points={fwd
                  ? `${x1 + bw - 8},${y + h - 8} ${x1 + bw},${y + h - 4} ${x1 + bw - 8},${y + h}`
                  : `${x1 + 8},${y + h - 8} ${x1},${y + h - 4} ${x1 + 8},${y + h}`}
                  fill={color} opacity={opacity} />
              </>
            )}
            {/* 标签（自适应字号+多行截断，完整标签放不下时由外部折线标注渲染） */}
            {(() => {
              const labelFs = Math.min(h - 2, Math.max(5, featureFontSize || 10))
              const charW = labelFs * 0.55
              const maxCharsPerLine = Math.max(0, Math.floor((bw - 4) / charW))
              const maxLines = Math.max(1, Math.floor((h - 2) / (labelFs * 1.2)))
              // 完整标签多行换行仍放不下时，由外部标注渲染
              if (maxCharsPerLine * maxLines < label.length || maxCharsPerLine < 1 || shape === 'wave' || shape === 'bent-arrow' || shape === 'bent-arrow-up' || shape === 'line') return null
              const lines: string[] = []
              let remaining = label
              for (let li = 0; li < maxLines && remaining.length > 0; li++) {
                const chunk = remaining.substring(0, maxCharsPerLine)
                lines.push(chunk)
                remaining = remaining.substring(maxCharsPerLine)
              }
              if (lines.length === 0) return null
              const totalTextH = lines.length * labelFs * 1.2
              const startY = y + (h - totalTextH) / 2 + labelFs * 0.85
              return (
                <text textAnchor="middle"
                  className={`font-medium select-none ${fill === 'hollow' ? 'fill-slate-700' : 'fill-white'}`}
                  style={{ pointerEvents: 'none', fontSize: `${labelFs}px` }}>
                  {lines.map((line, li) => (
                    <tspan key={li} x={mp.x} y={startY + li * labelFs * 1.2}>{line}</tspan>
                  ))}
                </text>
              )
            })()}
          </g>
        )
      })}

      {/* 元件外部折线标注（线性视图向下，与酶切向上反向，颜色与元件一致） */}
      {extFeatLabels.map((ef) => {
        // 折线起点：元件盒底部（不是序列轨道）
        const featBoxBottomY = trackY + 75 + ef.row * rowSpacing + featH
        const baseY = trackY + 70 + (maxRow + 1) * rowSpacing + 5
        const foldY = Math.max(featBoxBottomY + 8, baseY + ef.stack * (featFsL + 12))
        // 限制水平段长度，截断过长标签
        const charW = featFsL * 0.55
        const truncatedLabel = ef.label.length > linearMaxChars ? ef.label.slice(0, linearMaxChars - 1) + '…' : ef.label
        const textW = truncatedLabel.length * charW
        const hLen = Math.min(LINEAR_MAX_H_LINE, textW + featFsL * 0.5)
        // 折线向右延伸（与酶切向左反向）
        return (
          <g key={`ext-f-${ef.i}`}>
            {/* 垂直线段（从元件盒底部向下） */}
            <line x1={ef.x} y1={featBoxBottomY} x2={ef.x} y2={foldY}
              stroke={ef.color} strokeWidth={1} />
            {/* 水平折线段（向右延伸） */}
            <line x1={ef.x} y1={foldY} x2={ef.x + hLen} y2={foldY}
              stroke={ef.color} strokeWidth={1} opacity={0.7} />
            {/* 元件名称文字（颜色与元件一致） */}
            <text x={ef.x + hLen + 3} y={foldY}
              textAnchor="start" dominantBaseline="middle"
              className="select-none font-medium" fill={ef.color}
              style={{ pointerEvents: 'none', fontSize: `${featFsL}px` }}>
              {truncatedLabel}
            </text>
          </g>
        )
      })}

      {/* 序列选择标记（向下延伸，避免与酶切标签重叠） */}
      {sequenceSelection && (() => {
        const x1 = posToX(sequenceSelection.start)
        const x2 = posToX(sequenceSelection.end)
        return (
          <g>
            <line x1={x1} y1={trackY} x2={x1} y2={trackY + trackH + 24}
              stroke="#f43f5e" strokeWidth={1.5} strokeDasharray="4,2" opacity={0.8} />
            <line x1={x2} y1={trackY} x2={x2} y2={trackY + trackH + 24}
              stroke="#f43f5e" strokeWidth={1.5} strokeDasharray="4,2" opacity={0.8} />
            <rect x={x1} y={trackY - 2} width={Math.max(x2 - x1, 2)} height={trackH + 4}
              fill="#f43f5e" opacity={0.2} rx={2}
              stroke="#f43f5e" strokeWidth={0.5} strokeOpacity={0.4} />
            <polygon points={`${x1},${trackY + trackH + 24} ${x1 - 4},${trackY + trackH + 32} ${x1 + 4},${trackY + trackH + 32}`}
              fill="#f43f5e" opacity={0.8} />
            <polygon points={`${x2},${trackY + trackH + 24} ${x2 - 4},${trackY + trackH + 32} ${x2 + 4},${trackY + trackH + 32}`}
              fill="#f43f5e" opacity={0.8} />
            <text x={x1} y={trackY + trackH + 42} textAnchor="middle" className="text-[8px] fill-rose-500 font-medium">
              {sequenceSelection.start + 1}
            </text>
            <text x={x2} y={trackY + trackH + 42} textAnchor="middle" className="text-[8px] fill-rose-500 font-medium">
              {sequenceSelection.end + 1}
            </text>
          </g>
        )
      })()}

      {/* 酶切位点文字已合并到折线标注中 */}

      {/* 图例 */}
      <Legend features={features} enzymeSites={enzymeSites} x={20} y={H - 60} featureStyles={featureStyles} scale={legendScale} />

      {/* Tooltip */}
      {tooltip && (
        <g>
          <rect x={tooltip.x - 95} y={tooltip.y - 10 - tooltip.lines.length * 14} width={190} height={tooltip.lines.length * 14 + 10} rx={5} fill="#1e293b" opacity={0.92} />
          {tooltip.lines.map((line, i) => (
            <text key={i} x={tooltip.x} y={tooltip.y - tooltip.lines.length * 14 + 8 + i * 14} textAnchor="middle" className="text-[10px] fill-white">{line}</text>
          ))}
        </g>
      )}
    </svg>
  )
}
// eslint-disable-next-line react/display-name
const MemoLinearView = memo(LinearView)

// ====================== Helpers ======================
function arrowPoints(pos: { x: number; y: number }, angleDeg: number, s: number): string {
  const rad = (angleDeg * Math.PI) / 180
  const tipX = pos.x + s * Math.cos(rad), tipY = pos.y + s * Math.sin(rad)
  const br = rad + Math.PI
  const lx = pos.x + s * 0.6 * Math.cos(br + 0.5), ly = pos.y + s * 0.6 * Math.sin(br + 0.5)
  const rx = pos.x + s * 0.6 * Math.cos(br - 0.5), ry = pos.y + s * 0.6 * Math.sin(br - 0.5)
  return `${tipX},${tipY} ${lx},${ly} ${rx},${ry}`
}

/** 根据元件类型渲染小图标 */
function renderFeatureIcon(x: number, y: number, type: string, s: number): React.ReactNode {
  const icon = FEATURE_ICONS[type] || 'square'
  const color = getColor(type)
  switch (icon) {
    case 'flag':
      return <polygon key="ic" points={`${x},${y - s / 2} ${x + s},${y} ${x},${y + s / 2}`} fill="white" opacity={0.6} />
    case 'stop':
      return <rect key="ic" x={x - s / 3} y={y - s / 3} width={s * 0.66} height={s * 0.66} fill="white" opacity={0.6} />
    case 'circle':
      return <circle key="ic" cx={x} cy={y} r={s / 3} fill="white" opacity={0.6} />
    case 'diamond':
      return <polygon key="ic" points={`${x},${y - s / 3} ${x + s / 3},${y} ${x},${y + s / 3} ${x - s / 3},${y}`} fill="white" opacity={0.6} />
    case 'star':
      return <polygon key="ic" points={`${x},${y - s / 3} ${x + s / 6},${y - s / 6} ${x + s / 3},${y} ${x + s / 6},${y + s / 6} ${x},${y + s / 3} ${x - s / 6},${y + s / 6} ${x - s / 3},${y} ${x - s / 6},${y - s / 6}`} fill="white" opacity={0.5} />
    case 'pin':
      return <circle key="ic" cx={x} cy={y} r={s / 4} fill="white" stroke="white" strokeWidth={1} opacity={0.6} />
    default:
      return <rect key="ic" x={x - s / 4} y={y - s / 4} width={s / 2} height={s / 2} rx={1} fill="white" opacity={0.5} />
  }
}

/** 图例中的小形状图标 */
function LegendShapeIcon({ shape, color, fill }: { shape: FeatureShape; color: string; fill: FillPattern }) {
  const fv = fill === 'hollow' ? 'white' : color
  const sw = fill === 'hollow' ? 1.5 : 0.5
  switch (shape) {
    case 'arrow':
      return <polygon points="0,3 10,3 14,6 10,9 0,9" fill={fv} stroke={color} strokeWidth={sw} />
    case 'box-arrow':
      return <>
        <rect x={0} y={2} width={8} height={8} rx={1} fill={fv} stroke={color} strokeWidth={sw} />
        <polygon points="8,1 14,6 8,11" fill={color} opacity={0.8} />
      </>
    case 'big-arrow':
      return <polygon points="0,1 9,1 14,6 9,11 0,11" fill={fv} stroke={color} strokeWidth={sw} />
    case 'bent-arrow':
      return <>
        <line x1={2} y1={10} x2={2} y2={3} stroke={color} strokeWidth={1.5} />
        <line x1={2} y1={3} x2={11} y2={3} stroke={color} strokeWidth={1.5} />
        <polygon points="11,1 14,3 11,5" fill={color} />
      </>
    case 'bent-arrow-up':
      return <>
        <line x1={2} y1={2} x2={2} y2={9} stroke={color} strokeWidth={1.5} />
        <line x1={2} y1={9} x2={11} y2={9} stroke={color} strokeWidth={1.5} />
        <polygon points="11,7 14,9 11,11" fill={color} />
      </>
    case 'wave':
      return <path d="M 0,6 Q 4,2 7,6 Q 10,10 14,6" fill="none" stroke={color} strokeWidth={1.5} />
    case 'line':
      return <line x1={0} y1={6} x2={14} y2={6} stroke={color} strokeWidth={2.5} />
    default: // box
      return <rect x={0} y={2} width={14} height={8} rx={2} fill={fv} stroke={color} strokeWidth={sw} />
  }
}

function Legend({ features, enzymeSites, x, y, featureStyles, scale = 1 }: { features: GenBankFeature[]; enzymeSites: EnzymeSiteInfo[]; x: number; y: number; featureStyles?: FeatureStyles; scale?: number }) {
  const types = [...new Set(features.filter(f => f.type !== 'source' && (f.end - f.start) > 0).map(f => f.type))]
  const hasUnique = enzymeSites.some(e => e.is_unique)
  const hasMulti = enzymeSites.some(e => !e.is_unique)
  const perRow = 7
  const itemW = 130 * scale
  const rowH = 18 * scale
  const iconW = 14 * scale, iconH = 12 * scale

  return (
    <g>
      <text x={x} y={y} style={{ fontSize: `${10 * scale}px` }} className="fill-slate-500 font-medium">图例:</text>
      {types.slice(0, 14).map((type, i) => {
        const row = Math.floor(i / perRow)
        const col = i % perRow
        const displayName = FEATURE_TYPE_NAMES[type] ? `${FEATURE_TYPE_NAMES[type]}(${type})` : type
        const style = featureStyles?.[type]
        const color = style?.color || getColor(type)
        const shape: FeatureShape = style?.shape || 'box'
        const fill: FillPattern = style?.fill || 'solid'
        return (
          <g key={type} transform={`translate(${x + 35 * scale + col * itemW}, ${y + row * rowH})`}>
            <svg x={0} y={0} width={iconW} height={iconH} viewBox="0 0 14 12">
              <LegendShapeIcon shape={shape} color={color} fill={fill} />
            </svg>
            <text x={18 * scale} y={10 * scale} style={{ fontSize: `${8 * scale}px` }} className="fill-slate-600">{displayName}</text>
          </g>
        )
      })}
      {/* 酶切位点图例 */}
      {(hasUnique || hasMulti) && (() => {
        const enzRow = Math.ceil(Math.min(types.length, 14) / perRow)
        return (
          <g transform={`translate(${x + 35 * scale}, ${y + enzRow * rowH})`}>
            <line x1={0} y1={6 * scale} x2={12 * scale} y2={6 * scale} stroke="#6366f1" strokeWidth={1.5} />
            <circle cx={6 * scale} cy={6 * scale} r={3 * scale} fill="#6366f1" />
            <text x={16 * scale} y={10 * scale} style={{ fontSize: `${9 * scale}px` }} className="fill-slate-600">酶切位点（每种酶不同颜色）</text>
          </g>
        )
      })()}
    </g>
  )
}

// ====================== Hover Overlay (lightweight, only renders marker) ======================
const HoverOverlay = memo(function HoverOverlay({
  viewMode, insertPos, size, svgH, svgW, linearTrackY, zoom
}: {
  viewMode: 'circular' | 'linear'
  insertPos?: number | null
  size: number
  svgH?: number
  svgW?: number
  linearTrackY?: number
  zoom?: number
}) {
  if (insertPos == null) return null
  const z = zoom ?? 1

  if (viewMode === 'circular') {
    const W = svgW || 960, H = svgH || 1000
    const cx = W / 2, cy = 460, R = 250
    const fInner = R - 30, eOuter = R + 35
    const a = (insertPos / size) * 360 - 90
    const rad = (a * Math.PI) / 180
    const p1 = { x: cx + (fInner - 10) * Math.cos(rad), y: cy + (fInner - 10) * Math.sin(rad) }
    const p2 = { x: cx + (eOuter + 15) * Math.cos(rad), y: cy + (eOuter + 15) * Math.sin(rad) }
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute left-0 top-0 pointer-events-none" style={{ width: `${z * 100}%`, height: 'auto' }}>
        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
          stroke="#f43f5e" strokeWidth={1.5} strokeDasharray="4,2" opacity={0.8} />
        <circle cx={p2.x} cy={p2.y} r={2.5} fill="#f43f5e" />
      </svg>
    )
  }

  // linear
  const W = svgW || 1200, H = svgH || 500, ML = 80, MR = 80
  const trackY = linearTrackY || 180, trackH = 8
  const usable = W - ML - MR
  const x = ML + (insertPos / size) * usable
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="absolute left-0 top-0 pointer-events-none" style={{ width: `${z * 100}%`, height: 'auto' }}>
      <line x1={x} y1={trackY - 3} x2={x} y2={trackY + trackH + 3}
        stroke="#f43f5e" strokeWidth={1.5} strokeDasharray="4,2" opacity={0.8} />
      <polygon points={`${x},${trackY - 3} ${x - 4},${trackY - 11} ${x + 4},${trackY - 11}`}
        fill="#f43f5e" opacity={0.8} />
      <text x={x} y={trackY - 15} textAnchor="middle" className="text-[8px] fill-rose-500 font-medium">
        {insertPos}
      </text>
    </svg>
  )
})
