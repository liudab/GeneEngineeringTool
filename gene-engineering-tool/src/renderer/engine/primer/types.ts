/**
 * 引物设计模块 — 类型定义
 */

/** 引物设计模式 */
export type PrimerDesignMode = 'amplify-region' | 'within-selection' | 'flanking-selection'

/**
 * 筛选权重（0-10，各维度严格度）
 * 语义定义：
 * - 0 = 完全忽略该维度（不计入评分，相当于放开限制）
 * - 1-9 = 渐进严格度（数值越大，惩罚系数越高，对排序影响越大）
 * - 10 = 最严格（该维度以最大系数计入总分）
 * 评分公式：pairScore = Σ(dimScore_i × weight_i) / Σ(100 × weight_i) × 100
 */
export interface ScoringWeights {
  tm: number             // Tm偏差权重 (default 9)
  tmDiff: number         // Tm差异权重 (default 9)
  gc: number             // GC偏差权重 (default 9)
  gcDiff: number         // GC差异权重 (default 9)
  hairpin: number        // 发夹权重 (default 9)
  dimer: number          // 二聚体权重 (default 9)
  palindrome: number     // 回文权重 (default 9)
  homopolymer: number    // 同聚物权重 (default 9)
  selfComplementarity: number  // 自互补权重 (default 9)
  threePrime: number     // 3'端稳定性权重 (default 9)
  gcClamp: number        // GC Clamp权重 (default 9)
  specificity: number    // 特异性权重 (default 9)
}

/**
 * 默认筛选权重：所有维度设为 9（高严格度）
 * 用户可通过 UI 滑块调整：0=忽略该维度，10=最严格
 */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  tm: 9, tmDiff: 9, gc: 9, gcDiff: 9,
  hairpin: 9, dimer: 9, palindrome: 9, homopolymer: 9,
  selfComplementarity: 9, threePrime: 9, gcClamp: 9, specificity: 9
}

/** 引物设计参数 */
export interface PrimerDesignParams {
  /** 最小引物长度 (default 18) */
  minLength: number
  /** 最大引物长度 (default 30) */
  maxLength: number
  /** 最低 Tm °C (default 55) */
  minTm: number
  /** 最高 Tm °C (default 65) */
  maxTm: number
  /** 最佳 Tm °C (default 60) */
  optimalTm: number
  /** 最低 GC% (default 40) */
  minGc: number
  /** 最高 GC% (default 60) */
  maxGc: number
  /** 最大同聚物连续碱基数 (default 4) */
  maxHomopolymer: number
  /** 发夹 ΔG 阈值 kcal/mol (default -3) */
  hairpinThreshold: number
  /** 二聚体 ΔG 阈值 kcal/mol (default -6) */
  dimerThreshold: number
  /** 侧翼搜索范围 bp (default 300, 兼容旧参数) */
  flankRange: number
  /** 上游侧翼搜索范围 bp (default 300) */
  upstreamFlankRange: number
  /** 下游侧翼搜索范围 bp (default 300) */
  downstreamFlankRange: number
  /** 最佳产物长度 (default 300) */
  optimalProductLength: number
  /** 最大产物长度 (default 1000) */
  maxProductLength: number
  /** 最小产物长度 (default 100) */
  minProductLength: number
  /** 返回的引物对数量 (default 20) */
  topN: number
  /** 最大自身互补性 (default 8) */
  maxSelfComplementarity: number
  /** 最大 3'端自身互补性 (default 3) */
  maxSelfThreePrimeComplementarity: number
  /** 最大引物对 3'端互补性 (default 3) */
  maxPairThreePrimeComplementarity: number
  /** 最大 off-target 数量 (default 3) */
  maxOffTargets: number
  /** 启用特异性检查 (default true) */
  enableSpecificityCheck: boolean
  /** 启用 in-silico PCR 验证 (default true) */
  enableInSilicoPcr: boolean
  /** 引物搜索深度 bp — amplify-region 模式下引物结合位点距选区边缘的最大偏移 (default 5) */
  edgeSearchDepth: number
  /** 放宽产物长度限制以换取更高质量引物 — 仅 within-selection / flanking-selection 模式生效 (default false) */
  relaxedProductLength: boolean
  /** 引物枚举数量上限 — 控制 enumerateCandidates 返回的候选数 (default 200, 范围 40-9999) */
  maxCandidates: number

  // === 热力学计算基础 (Category 2) ===
  /** 盐离子浓度 mM (default 50) */
  saltConcentration: number
  /** 引物浓度 nM (default 250) */
  primerConcentration: number
  /** 自由能计算温度 °C (default 25, UI 展示用)
   *   注意: thermo.ts 中 ΔG 计算默认使用 37°C (SantaLucia 1998 标准参考温度)
   *   此参数用于 UI 显示，如需改变计算温度需同步传递给 thermo 函数 */
  freeEnergyTemp: number

  // === 扩增子属性 (Category 4) ===
  /** 扩增子最低 GC% (default 20) */
  minAmpliconGc: number
  /** 扩增子最高 GC% (default 85) */
  maxAmpliconGc: number

  // === 引物对兼容性 (Category 5) ===
  /** 上下游 Tm 差异上限 °C (default 5.0) */
  maxTmDiff: number
  /** 上下游 GC% 差异上限 (default 10.0) */
  maxGcDiff: number
  /** 引物间二聚体 dG 下限 kcal/mol (default -15.0) */
  maxPairDimerDG: number
  /** 引物对 3'端区域(10bp) dimer dG 下限 kcal/mol (default -15.0，因 10bp 窗口 NN 累积值可达 -10 以上) */
  maxPairThreePrimeDG: number

  // === 二级结构增强 (Category 6) ===
  /** 最大回文长度 bp (default 8) */
  maxPalindromeLength: number
  /** 发夹茎最小长度 (default 3) */
  hairpinStemMinLength: number
  /** 3'端10bp区域发夹 dG 阈值 kcal/mol (default -1.0) */
  hairpinThreePrimeDG: number
  /** 检查引物内酶切位点 (default false) */
  enableRestrictionSiteCheck: boolean

  // === 特异性增强 (Category 7) ===
  /** 序列相似性阈值% (default 75) */
  similarityThreshold: number
  /** 3'端严格匹配碱基数 (default 0=不启用) */
  threePrimeStrictMatch: number

  // === 筛选权重 (Category 8) ===
  /** 可配置权重对象 */
  weights: ScoringWeights

  // === 自定义扩展 (Category 9) ===
  /** 正向引物5'端附加序列 (default '') */
  fwdFivePrimeTail: string
  /** 反向引物5'端附加序列 (default '') */
  revFivePrimeTail: string
}

export const DEFAULT_PRIMER_PARAMS: PrimerDesignParams = {
  minLength: 18,
  maxLength: 30,
  minTm: 55,
  maxTm: 65,
  optimalTm: 60,
  minGc: 40,
  maxGc: 60,
  maxHomopolymer: 4,
  hairpinThreshold: -3,
  dimerThreshold: -6,
  flankRange: 300,
  upstreamFlankRange: 300,
  downstreamFlankRange: 300,
  optimalProductLength: 300,
  maxProductLength: 1000,
  minProductLength: 100,
  topN: 20,
  maxSelfComplementarity: 8,
  maxSelfThreePrimeComplementarity: 5,
  maxPairThreePrimeComplementarity: 3,
  maxOffTargets: 3,
  enableSpecificityCheck: true,
  enableInSilicoPcr: true,
  edgeSearchDepth: 5,
  relaxedProductLength: false,
  maxCandidates: 200,
  saltConcentration: 50,
  primerConcentration: 250,
  freeEnergyTemp: 25,
  minAmpliconGc: 20,
  maxAmpliconGc: 85,
  maxTmDiff: 5.0,
  maxGcDiff: 10.0,
  maxPairDimerDG: -15.0,
  maxPairThreePrimeDG: -15.0,
  maxPalindromeLength: 6,
  hairpinStemMinLength: 3,
  hairpinThreePrimeDG: -3.0,
  enableRestrictionSiteCheck: false,
  similarityThreshold: 75,
  threePrimeStrictMatch: 0,
  weights: { ...DEFAULT_SCORING_WEIGHTS },
  fwdFivePrimeTail: '',
  revFivePrimeTail: ''
}

/**
 * 严格学术级预设参数（"高要求"按钮使用）
 * 基于分子生物学文献与 Primer3/Primer-BLAST/IDT OligoAnalyzer 推荐标准：
 * - 引物长度 18-25nt，Tm 55-62°C（最优 58°C），GC 40-55%
 * - 同聚物≤3，自互补≤8（Primer3加权评分），3'端连续互补≤2bp
 * - 回文≤4bp（连续子串），3'端发夹 dG≥-2.0 kcal/mol
 * - 产物长度 200-600bp（适合 qPCR 和 Sanger 测序）
 * - 特异性：maxOffTargets≤2，3'端严格匹配 3bp
 * - 配对级：Tm差≤3°C，GC差≤5%，二聚体 dG≥-12 kcal/mol
 */
export const STRICT_ACADEMIC_PARAMS: Partial<PrimerDesignParams> = {
  // === 引物理化性质 ===
  minLength: 18,
  maxLength: 25,
  minTm: 55,
  maxTm: 62,
  optimalTm: 58,
  minGc: 40,
  maxGc: 55,

  // === 结构稳定性 ===
  maxHomopolymer: 3,
  maxSelfComplementarity: 8,
  maxSelfThreePrimeComplementarity: 2,
  maxPairThreePrimeComplementarity: 2,
  maxPalindromeLength: 4,
  hairpinThreshold: -2.0,
  dimerThreshold: -5.0,
  hairpinStemMinLength: 3,
  hairpinThreePrimeDG: -2.0,

  // === 产物长度 ===
  minProductLength: 200,
  maxProductLength: 600,
  optimalProductLength: 300,

  // === 配对级阈值 ===
  maxTmDiff: 3.0,
  maxGcDiff: 5.0,
  maxPairDimerDG: -12.0,
  maxPairThreePrimeDG: -10.0,
  minAmpliconGc: 30,
  maxAmpliconGc: 80,

  // === 特异性 ===
  maxOffTargets: 2,
  enableSpecificityCheck: true,
  enableInSilicoPcr: true,
  similarityThreshold: 80,
  threePrimeStrictMatch: 3,

  // === 权重恢复默认 ===
  weights: { ...DEFAULT_SCORING_WEIGHTS },
}

/** 单条引物详情 */
export interface PrimerDetail {
  /** 序列 5'→3' */
  sequence: string
  /** 在模板上的起始位置 (0-based) */
  position: number
  /** 长度 */
  length: number
  /** Tm (°C) */
  tm: number
  /** GC% */
  gc: number
  /** 3'端稳定性 ΔG */
  threePrimeDG: number
  /** 发夹 ΔG */
  hairpinDG: number
  /** 同源二聚体 ΔG */
  homodimerDG: number
  /** 自身互补性得分 (Primer3 self_complementarity) */
  selfComplementarity: number
  /** 自身 3'端互补性得分 (Primer3 self_3_complementarity) */
  selfThreePrimeComplementarity: number
  /** 3'端是否为 G/C (GC clamp) */
  gcClamp: boolean
  /** off-target 结合位点数量 */
  offTargetCount?: number
  /** 预计算的回文长度（枚举阶段计算，避免配对循环重复计算） */
  palindromeLength?: number
}

/** 推荐 PCR 反应条件 */
export interface RecommendedPcrConditions {
  /** 推荐退火温度 °C (基于 min(Tm_fwd, Tm_rev) - 3°C, 下限 48°C)
   *  文献: Rychlik 1990 NAR — Ta = Tm - 3~5°C 适用于常规 PCR */
  annealingTemp: number
  /** 延伸时间秒 (基于产物长度, Taq 聚合酶 ~1kb/min)
   *  文献: Saiki 1988 Science — 标准 Taq 延伸速率 */
  extensionTimeSec: number
  /** 推荐循环数 (基于产物长度: ≤500bp→30, ≤1kb→35, >1kb→40) */
  cycles: number
  /** 模板变性温度 °C (固定 95) */
  denaturationTemp: number
  /** 变性时间秒 (固定 30) */
  denaturationTimeSec: number
}

/** 引物对 */
export interface DesignedPrimer {
  /** 正向引物 */
  forward: PrimerDetail
  /** 反向引物 */
  reverse: PrimerDetail
  /** 产物起始位置 (0-based) */
  productStart: number
  /** 产物结束位置 (0-based) */
  productEnd: number
  /** 产物长度 */
  productLength: number
  /** 配对总分 (0-100) */
  pairScore: number
  /** 评分明细 */
  scoreBreakdown: ScoreBreakdown
  /** 引物对 3'端互补性 */
  pairThreePrimeComplementarity: number
  /** PCR 适用性评分 (0-100) */
  pcrScore: number
  /** PCR 适用性等级 */
  pcrGrade: '优' | '良' | '差'
  /** 推荐 PCR 反应条件 */
  recommendedPcrConditions?: RecommendedPcrConditions
  /** 特异性信息 */
  specificity?: {
    fwdOffTargets: number
    revOffTargets: number
    isSpecific: boolean
  }
}

/** 评分明细 */
export interface ScoreBreakdown {
  /** Tm 偏差扣分 */
  tmPenalty: number
  /** 正反向 Tm 差异扣分 */
  tmDiffPenalty: number
  /** GC 偏差扣分 */
  gcPenalty: number
  /** 发夹惩罚 */
  hairpinPenalty: number
  /** 二聚体惩罚（同源二聚体） */
  dimerPenalty: number
  /** 交叉二聚体惩罚（正反向引物间） */
  crossDimerPenalty: number
  /** 产物长度偏好扣分 */
  productLengthPenalty: number
  /** 产物边界贴合度扣分（amplify-region 模式） */
  boundaryPenalty: number
  /** 3'端稳定性扣分 */
  threePrimePenalty: number
  /** 同聚物扣分 */
  homopolymerPenalty: number
  /** 自身互补性扣分 */
  selfComplPenalty: number
  /** 3'端互补性扣分 */
  threePrimeComplPenalty: number
  /** GC clamp 扣分 */
  gcClampPenalty: number
  /** 特异性扣分 */
  specificityPenalty: number
  /** 回文惩罚 */
  palindromePenalty: number
  /** 原始得分（扣分前） */
  rawScore: number
}

/** 引物设计结果 */
export interface PrimerDesignResult {
  /** 设计模式 */
  mode: PrimerDesignMode
  /** 使用的参数 */
  params: PrimerDesignParams
  /** 引物对列表（按评分降序） */
  pairs: DesignedPrimer[]
  /** 候选正向引物数 */
  forwardCandidates: number
  /** 候选反向引物数 */
  reverseCandidates: number
  /** 失败原因分析 */
  failureReasons?: FailureReasons
  /** 迭代信息（自动放宽参数时的多轮记录） */
  iterations?: IterationInfo[]
  /** 实际使用的轮次（1=首轮成功，2+=放宽后成功） */
  iterationCount?: number
  /** 正向引物筛选漏斗数据 */
  fwdFunnel?: FunnelStage[]
  /** 反向引物筛选漏斗数据 */
  revFunnel?: FunnelStage[]
  /** 配对阶段数据 */
  pairingFunnel?: PairingFunnelStage
  /** 诊断建议 */
  diagnostics?: DiagnosticSuggestion[]
}

/** 迭代轮次信息 */
export interface IterationInfo {
  /** 轮次编号 (1-based) */
  round: number
  /** 本轮使用的参数 */
  params: PrimerDesignParams
  /** 本轮结果对数 */
  pairsFound: number
  /** 本轮失败原因 */
  failureReasons?: FailureReasons
}

/** 筛选漏斗阶段 */
export interface FunnelStage {
  /** 阶段标签 */
  label: string
  /** 进入此阶段的数量 */
  input: number
  /** 通过此阶段的数量 */
  passed: number
  /** 被过滤数量 */
  filtered: number
  /** 过滤百分比 (0-100) */
  filterPercent: number
  /** 是否为瓶颈（过滤最多的阶段） */
  isBottleneck: boolean
}

/** 配对阶段漏斗 */
export interface PairingFunnelStage {
  /** 正向有效引物数 */
  validForward: number
  /** 反向有效引物数 */
  validReverse: number
  /** 总配对尝试数 */
  totalPairs: number
  /** 因产物长度过滤数 */
  filteredByProductLength: number
  /** 因产物边界偏离选区边缘过滤数（amplify-region 模式） */
  filteredByBoundary: number
  /** 因 Tm 差过滤数 */
  filteredByTmDiff: number
  /** 因 GC 差过滤数 */
  filteredByGcDiff: number
  /** 因异源二聚体 dG 过滤数 */
  filteredByDimerDG: number
  /** 因 3'端互补 dG 过滤数 */
  filteredByThreePrimeDG: number
  /** 因扩增子 GC 过滤数 */
  filteredByAmpliconGc: number
  /** 因互补性过滤数 */
  filteredByComplementarity: number
  /** 因 In-silico PCR 过滤数 */
  filteredByInSilicoPcr: number
  /** 成功配对数 */
  successfulPairs: number
}

/** 诊断建议 */
export interface DiagnosticSuggestion {
  /** 瓶颈阶段标签 */
  stage: string
  /** 过滤百分比 */
  filterPercent: number
  /** 建议文本 */
  suggestion: string
  /** 建议调整的参数键名 */
  paramKey?: keyof PrimerDesignParams
  /** 建议的新值 */
  suggestedValue?: number | boolean
}

/** PCR 质量评估 */
export interface PcrQuality {
  /** 正向自身二聚体 ΔG */
  fwdSelfDimerDG: number
  /** 反向自身二聚体 ΔG */
  revSelfDimerDG: number
  /** 正反向交叉二聚体 ΔG */
  heteroDimerDG: number
  /** 正向发夹 ΔG */
  fwdHairpinDG: number
  /** 反向发夹 ΔG */
  revHairpinDG: number
  /** 综合 PCR 适用性评分 (0-100) */
  pcrScore: number
  /** 评级: 优/良/差 */
  grade: '优' | '良' | '差'
}

/** 失败原因分析（正反向分离） */
export interface FailureReasons {
  /** 正向总枚举候选数 */
  fwdTotalEnumerated: number
  /** 反向总枚举候选数 */
  revTotalEnumerated: number
  /** 正向因长度过滤的数量 */
  fwdFilteredByLength: number
  /** 反向因长度过滤的数量 */
  revFilteredByLength: number
  /** 正向因 Tm 过滤的数量 */
  fwdFilteredByTm: number
  /** 反向因 Tm 过滤的数量 */
  revFilteredByTm: number
  /** 正向因 GC 过滤的数量 */
  fwdFilteredByGc: number
  /** 反向因 GC 过滤的数量 */
  revFilteredByGc: number
  /** 正向因同聚物过滤的数量 */
  fwdFilteredByHomopolymer: number
  /** 反向因同聚物过滤的数量 */
  revFilteredByHomopolymer: number
  /** 正向因互补性过滤的数量 */
  fwdFilteredByComplementarity: number
  /** 反向因互补性过滤的数量 */
  revFilteredByComplementarity: number
  /** 正向因特异性过滤的数量 */
  fwdFilteredBySpecificity: number
  /** 反向因特异性过滤的数量 */
  revFilteredBySpecificity: number
  /** 有效正向引物数 */
  validForward: number
  /** 有效反向引物数 */
  validReverse: number
  /** 配对阶段失败的数量 */
  failedPairing: number
  /** 因产物长度过滤的配对数量 */
  filteredByProductLength: number
  /** 因产物边界偏离选区边缘过滤的配对数量（amplify-region 模式） */
  filteredByBoundary: number
  /** 因 in-silico PCR 过滤的配对数量 */
  filteredByInSilicoPcr: number
  /** 因引物对互补性过滤的配对数量 */
  filteredByPairComplementarity: number
  /** 正向因回文过滤的数量 */
  fwdFilteredByPalindrome: number
  /** 反向因回文过滤的数量 */
  revFilteredByPalindrome: number
  /** 正向因 3'端自互补过滤的数量 */
  fwdFilteredByThreePrimeSelfCompl: number
  /** 反向因 3'端自互补过滤的数量 */
  revFilteredByThreePrimeSelfCompl: number
  /** 正向因 3'端发夹过滤的数量 */
  fwdFilteredByHairpinThreePrime?: number
  /** 反向因 3'端发夹过滤的数量 */
  revFilteredByHairpinThreePrime?: number
  /** 因 Tm 差过滤的配对数量 */
  filteredByTmDiff: number
  /** 因 GC 差过滤的配对数量 */
  filteredByGcDiff: number
  /** 因扩增子 GC 过滤的配对数量 */
  filteredByAmpliconGc: number
  /** 因异源二聚体 dG 过滤的配对数量 */
  filteredByPairDimerDG: number
  /** 因 3'端互补 dG 过滤的配对数量 */
  filteredByPairThreePrimeDG: number
}
