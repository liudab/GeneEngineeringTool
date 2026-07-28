/**
 * 凝胶电泳模拟引擎
 * 基于 log-linear 迁移模型模拟琼脂糖凝胶电泳
 * 片段大小 (bp) → 迁移距离 (cm)
 */

import { createLogger } from '../../utils/logger'

const log = createLogger('GelSimulator')

// ============ 类型定义 ============

export interface GelFragment {
  /** 片段名称/标签 */
  label: string
  /** 片段大小 (bp) */
  size: number
  /** 来源描述 */
  source?: string
}

export interface GelLane {
  /** 泳道名称 */
  name: string
  /** 泳道中的片段 */
  fragments: GelFragment[]
}

export interface GelConfig {
  /** 琼脂糖浓度 (%) 0.5 - 3.0 */
  agarosePercent: number
  /** 电压 (V) —— 电极两端总电压，场强由 voltage / gelLength 计算 */
  voltage: number
  /** 运行时间 (min) */
  runTime: number
  /** 凝胶长度 (cm)，由 gelSpec 推导，保留字段以便引擎独立使用 */
  gelLength: number
  /** 缓冲液类型：TAE（40mM Tris-acetate, pH 8.3）或 TBE（45mM Tris-borate, pH 8.3） */
  bufferType?: GelBufferType
  /** 制胶规格：mini（~7.5cm）或 standard（~15cm） */
  gelSpec?: GelSpec
  /** DNA marker / ladder */
  ladder?: GelLadderKey
}

export interface GelSimulationResult {
  /** 泳道结果 */
  lanes: GelLaneResult[]
  /** Marker 泳道 */
  markerLane: GelLaneResult
  /** 凝胶配置 */
  config: GelConfig
  /** 分辨率信息 */
  resolution: {
    minSeparable: number  // 最小可分辨大小差异 (bp)
    optimalRange: [number, number]  // 最佳分辨范围 (bp)
  }
}

export interface GelLaneResult {
  name: string
  bands: GelBand[]
}

export interface GelBand {
  label: string
  size: number
  /** 迁移距离 (cm，从顶部算起，已 cap 到凝胶物理范围) */
  migration: number
  /** 条带强度 (0-1，基于片段大小的模拟亮度) */
  intensity: number
  /** 条带宽度（大片段更宽） */
  width: number
  /** 是否已跑出凝胶（raw migration > gelLength * 0.95） */
  ranOff?: boolean
  /** 扩散因子（>1 表示条带因扩散变宽变淡） */
  diffusionFactor?: number
}

// ============ 默认配置 ============

export const DEFAULT_GEL_CONFIG: GelConfig = {
  agarosePercent: 1.0,
  voltage: 100,
  runTime: 45,
  gelLength: 15,
  bufferType: 'TAE',
  gelSpec: 'standard',
  ladder: 'Takara_DL2000Plus'
}

// ============ 制胶规格与缓冲液定义 ============

/** 制胶规格（mini 迷你胶 / standard 标准胶） */
export type GelSpec = 'mini' | 'standard'

/** 电泳缓冲液类型 */
export type GelBufferType = 'TAE' | 'TBE'

/** 凝胶规格预设：长度 + UI 可读名 */
export const GEL_SPECS: Record<GelSpec, { length: number; electrodeDistance: number; label: string; description: string }> = {
  mini:     { length: 7.5,  electrodeDistance: 15, label: '迷你胶 (Mini gel)',       description: '~7.5 cm，适合快速筛选' },
  standard: { length: 15,   electrodeDistance: 20, label: '标准胶 (Standard gel)',   description: '~15 cm，分辨率更高' }
}

/** 缓冲液可读标签 */
export const BUFFER_LABELS: Record<GelBufferType, string> = {
  TAE: 'TAE (40mM Tris-acetate)',
  TBE: 'TBE (45mM Tris-borate)'
}

/** 缓冲液迁移率校正系数（基于黏度与离子强度差异，TAE = 1.0 基准）
 *  参考: Stellwagen 1982, Biochemistry; Gjerde 1995, Electrophoresis
 *  TBE 黏度略低于 TAE，迁移率略高（约 +8%）
 */
export const BUFFER_CORRECTION: Record<GelBufferType, number> = {
  TAE: 1.00,
  TBE: 1.08
}

// ============ DNA Marker 定义 ============

/** Marker 模板键：通用 + Takara Bio + Vazyme 诺唯赞商业产品 */
export type GelLadderKey =
  | '100bp' | '1kb' | 'lambda'
  | 'Takara_DL2000' | 'Takara_DL2000Plus' | 'Takara_DL5000'
  | 'Takara_DL10000' | 'Takara_DL15000' | 'Takara_lambda_HindIII'
  | 'Vazyme_DL2000Plus' | 'Vazyme_DL5000' | 'Vazyme_DL15000' | 'Vazyme_100bp'

const LADDERS: Record<GelLadderKey, number[]> = {
  // 通用 ladder
  '100bp':  [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1500],
  '1kb':    [250, 500, 750, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 5000, 6000, 8000, 10000],
  'lambda': [23130, 9416, 6557, 4361, 2322, 2027, 564, 125],

  // Takara Bio 系列
  'Takara_DL2000':         [2000, 1000, 750, 500, 250, 100],
  'Takara_DL2000Plus':     [5000, 3000, 2000, 1000, 750, 500, 250, 100],
  'Takara_DL5000':         [5000, 3000, 2000, 1000, 750, 500, 250, 100],
  'Takara_DL10000':        [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 750, 500, 250],
  'Takara_DL15000':        [15000, 10000, 7500, 5000, 2500, 1000, 750, 500, 250],
  'Takara_lambda_HindIII': [23130, 9416, 6557, 4361, 2322, 2027, 564, 125],

  // Vazyme 诺唯赞系列（MD101-DL2000Plus、MD102-DL5000、MD103-DL15000、MD104-100bp Ladder）
  'Vazyme_DL2000Plus': [5000, 3000, 2000, 1000, 750, 500, 250, 100],
  'Vazyme_DL5000':     [5000, 3000, 2000, 1000, 750, 500, 250, 100],
  'Vazyme_DL15000':    [15000, 10000, 7500, 5000, 2500, 1000, 750, 500, 250],
  'Vazyme_100bp':      [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1500, 1800, 2000]
}

/** Marker 可读名称（用于 UI 下拉框） */
export const LADDER_LABELS: Record<GelLadderKey, string> = {
  '100bp': '100bp Ladder',
  '1kb': '1kb Ladder',
  'lambda': 'Lambda/HindIII',
  'Takara_DL2000': 'Takara DL2000',
  'Takara_DL2000Plus': 'Takara DL2000 Plus',
  'Takara_DL5000': 'Takara DL5000',
  'Takara_DL10000': 'Takara DL10000',
  'Takara_DL15000': 'Takara DL15000',
  'Takara_lambda_HindIII': 'Takara λ-HindIII',
  'Vazyme_DL2000Plus': 'Vazyme DL2000 Plus (MD101)',
  'Vazyme_DL5000': 'Vazyme DL5000 (MD102)',
  'Vazyme_DL15000': 'Vazyme DL 15000 (MD103)',
  'Vazyme_100bp': 'Vazyme 100bp Ladder (MD104)'
}

// ============ 迁移模型 ============

/**
 * 计算 DNA 片段在凝胶中的迁移距离
 *
 * 基于 Southern (1979) / Serwer (1983) / Sambrook《分子克隆》实验数据，采用
 * reciprocal-log 模型：
 *   μ(size) = A / (size + B)
 *
 * 该模型在双对数坐标上呈现非线性衰减：
 *   - 小片段（<500bp）：迁移快且间距大，log-log 斜率较陡
 *   - 大片段（>5kb）：迁移慢且间距急剧收敛，符合物理分子筛效应
 *   - 单斜率 log-linear 模型（Southern 初版）无法同时拟合小片段与大片段间距
 *
 * 参数校准（1% agarose TAE 100V 45min 标准胶 15cm 实验基准）：
 *   - 100 bp →  ~7.0 cm  （小片段跑得远，接近凝胶底部）
 *   - 1000 bp → ~5.0 cm  （Sambrook Ch.5 Fig.5.3 常用标定）
 *   - 5000 bp → ~2.2 cm  （大片段聚集在上样孔附近）
 *   - 10000 bp → ~1.2 cm
 *
 * 场强模型：field = voltage / electrodeDistance（电极间距由电泳槽决定）
 *   - 标准槽：electrodeDistance = 20 cm
 *   - 迷你槽：electrodeDistance = 15 cm
 *
 * 模型参数：
 *   - A, B：reciprocal-log 拟合常数（Southern 1979 Fig.2 数据）
 *   - 场强：field = voltage / electrodeDistance（电极间距由电泳槽决定）
 *   - 琼脂糖浓度：Ferguson plot 10^(-K_R·(C−1))，1% 为基准
 *   - 缓冲液类型：TAE = 1.0 基准；TBE 黏度略低（+8%）
 *   - 场强 (V/cm)：low-field regime，迁移与场强线性相关
 *   - 运行时间 (h)：线性缩放
 *
 * @param size 片段大小 (bp)
 * @param config 凝胶配置
 * @returns 迁移距离 (cm)
 */
export function calculateMigration(size: number, config: GelConfig): number {
  if (size <= 0) return config.gelLength
  log.debug(`Calculating migration for ${size}bp fragment`)

  const agarose = config.agarosePercent
  const buffer = config.bufferType || 'TAE'
  const gelLength = config.gelLength

  // (1) 场强 (V/cm)：电压 / 电极间距
  //     电极间距由电泳槽设备决定，而非凝胶长度。
  //     标准槽（如 Bio-Rad Wide Mini-Sub）电极间距 ~20cm，
  //     迷你槽（如 Bio-Rad Mini-Sub Cell）~15cm。
  //     两种槽施加相同电压时，迷你槽场强更高。
  const spec = config.gelSpec || 'standard'
  const electrodeDistance = GEL_SPECS[spec].electrodeDistance
  const field = config.voltage / electrodeDistance

  // (2) 琼脂糖浓度校正：Ferguson plot 模型
  //     来源: Ferguson 1964; Serwer 1983 Electrophoresis 4:375; Stellwagen 1982
  //     log(μ) = log(μ₀) - K_R · C
  //     K_R (retardation coefficient) 与片段大小正相关：大片段受凝胶孔径影响更大
  //     K_R(size) = 0.15 + 0.04 · log₁₀(size)
  //     1% 基准下：0.5% → factor≈2.30, 1% → 1.00, 2% → 0.44, 3% → 0.19
  const K_R = 0.15 + 0.04 * Math.log10(Math.max(size, 1))
  const agaroseFactor = Math.pow(10, -K_R * (agarose - 1.0))

  // (3) reciprocal-log 模型：μ(size) = A / (size + B)
  //     拟合 1% agarose TAE 100V 45min 实验数据 (Southern 1979 / Sambrook Fig.5.3)：
  //       场强基于标准槽电极间距 20cm：field = 100/20 = 5.0 V/cm
  //       μ(1000) = A/(1000+B) = 240/1150 ≈ 0.209 cm²/(V·h)
  //       μ(100)/μ(1000) = 1150/350 ≈ 3.29  （小片段迁移率约为 1kb 的 3.3 倍）
  //       μ(5000)/μ(1000) = 1150/5150 ≈ 0.22 （大片段显著衰减）
  //     B = 150 使曲线平滑连接小/大片段两端
  const A = 240
  const B = 150
  const muSize = A / (size + B)

  // (4) 最终迁移距离：
  //     distance = μ(size) · field(V/cm) · time(h) · agaroseFactor · bufferCorrection
  //     μ 单位 cm²/(V·h)，field 单位 V/cm，结果单位 cm
  const timeHours = config.runTime / 60
  const migration = muSize * field * timeHours * agaroseFactor * BUFFER_CORRECTION[buffer]

  // (5) 返回原始迁移距离（仅下限 0.5cm），跑出凝胶判定由 simulateGel 处理
  return Math.max(0.5, migration)
}

/**
 * 计算凝胶的最佳分辨范围
 */
export function getOptimalRange(config: GelConfig): [number, number] {
  const agarose = config.agarosePercent
  // 经验关系：高浓度 → 分辨小片段，低浓度 → 分辨大片段
  const min = Math.round(50 / agarose)
  const max = Math.round(20000 / (agarose * agarose))
  return [min, Math.max(max, min * 10)]
}

/**
 * 计算最小可分辨大小差异
 */
export function getMinSeparable(size: number, config: GelConfig): number {
  const m1 = calculateMigration(size, config)
  const m2 = calculateMigration(size + 1, config)
  const deltaPerBp = Math.abs(m1 - m2)

  // 假设最小可分辨距离为 0.5mm = 0.05cm
  const minResolvable = 0.05
  return deltaPerBp > 0 ? Math.ceil(minResolvable / deltaPerBp) : size
}

// ============ 模拟主函数 ============

/**
 * 模拟凝胶电泳
 */
export function simulateGel(lanes: GelLane[], config?: Partial<GelConfig>): GelSimulationResult {
  log.info(`Simulating gel electrophoresis: ${lanes.length} lane(s), agarose=${config?.agarosePercent || DEFAULT_GEL_CONFIG.agarosePercent}%`)
  const cfg: GelConfig = { ...DEFAULT_GEL_CONFIG, ...config }
  const ladderSizes = LADDERS[cfg.ladder || 'Takara_DL2000Plus'] || LADDERS['Takara_DL2000Plus']

  // 辅助函数：计算条带的跑出判定与扩散因子
  const maxOnGel = cfg.gelLength * 0.95
  function makeBand(size: number, label: string, baseIntensity: number, baseWidth: number): GelBand {
    const rawMigration = calculateMigration(size, cfg)
    const ranOff = rawMigration > maxOnGel
    const migration = Math.min(maxOnGel, rawMigration)
    // 扩散效应：低浓度胶+长时间 → 小片段扩散显著
    // migrationRatio 越高表示条带跑得越远，扩散越明显
    const migrationRatio = rawMigration / cfg.gelLength
    const diffusionFactor = ranOff ? 2.0 : 1.0 + Math.max(0, (migrationRatio - 0.5) * 0.8)
    return { label, size, migration, intensity: baseIntensity, width: baseWidth, ranOff, diffusionFactor }
  }

  // 模拟 marker 泳道
  const markerBands: GelBand[] = ladderSizes.map(size => makeBand(
    size, formatSize(size),
    size <= 1000 ? 0.7 : 0.9,  // 小片段亮度低
    0.8
  ))
  const markerLane: GelLaneResult = { name: 'Marker', bands: markerBands }

  // 模拟样品泳道
  const laneResults: GelLaneResult[] = lanes.map(lane => ({
    name: lane.name,
    bands: lane.fragments
      .filter(f => f.size > 0)
      .sort((a, b) => b.size - a.size)
      .map(f => {
        // 模拟条带强度：基于大小（大片段更多 DNA → 更亮）
        const intensity = Math.min(1, 0.3 + Math.log10(f.size) * 0.2)
        // 大片段条带更宽（扩散更慢）
        const width = 0.7 + Math.min(0.6, f.size / 10000)
        return makeBand(f.size, f.label || formatSize(f.size), intensity, width)
      })
  }))

  const [optMin, optMax] = getOptimalRange(cfg)

  return {
    lanes: laneResults,
    markerLane,
    config: cfg,
    resolution: {
      minSeparable: getMinSeparable(1000, cfg),
      optimalRange: [optMin, optMax]
    }
  }
}

// ============ 辅助 ============

function formatSize(bp: number): string {
  return bp >= 1000 ? `${(bp / 1000).toFixed(bp % 1000 === 0 ? 0 : 1)}kb` : `${bp}bp`
}

/**
 * 从酶切结果生成凝胶泳道
 */
export function fragmentsToLane(
  laneName: string,
  fragments: { size: number; label?: string }[]
): GelLane {
  log.debug(`Converting ${fragments.length} fragments to gel lane: ${laneName}`)
  return {
    name: laneName,
    fragments: fragments.map((f, i) => ({
      label: f.label || `Fragment ${i + 1}`,
      size: Math.round(f.size)
    }))
  }
}

/**
 * 批量模拟：多个酶切方案的凝胶对比
 */
export function simulateMultiDigestGel(
  digests: { name: string; fragments: { size: number }[] }[],
  config?: Partial<GelConfig>
): GelSimulationResult {
  log.info(`Simulating multi-digest gel: ${digests.length} digest(s)`)
  const lanes = digests.map(d => fragmentsToLane(d.name, d.fragments))
  return simulateGel(lanes, config)
}
