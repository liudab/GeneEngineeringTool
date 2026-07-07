/**
 * 引物设计模块 — 类型定义
 */

/** 引物设计模式 */
export type PrimerDesignMode = 'amplify-region' | 'within-selection' | 'flanking-selection'

/** 引物设计参数 */
export interface PrimerDesignParams {
  /** 最小引物长度 (default 18) */
  minLength: number
  /** 最大引物长度 (default 26) */
  maxLength: number
  /** 最低 Tm °C (default 55) */
  minTm: number
  /** 最高 Tm °C (default 65) */
  maxTm: number
  /** 最佳 Tm °C (default 60) */
  optimalTm: number
  /** 最低 GC% (default 30) */
  minGc: number
  /** 最高 GC% (default 70) */
  maxGc: number
  /** 最大同聚物连续碱基数 (default 5) */
  maxHomopolymer: number
  /** 发夹 ΔG 阈值 kcal/mol (default -2) */
  hairpinThreshold: number
  /** 二聚体 ΔG 阈值 kcal/mol (default -5) */
  dimerThreshold: number
  /** 侧翼搜索范围 bp (default 300) */
  flankRange: number
  /** 最佳产物长度 (default 500) */
  optimalProductLength: number
  /** 最大产物长度 (default 3000) */
  maxProductLength: number
  /** 最小产物长度 (default 100) */
  minProductLength: number
  /** 返回的引物对数量 (default 20) */
  topN: number
}

export const DEFAULT_PRIMER_PARAMS: PrimerDesignParams = {
  minLength: 18,
  maxLength: 26,
  minTm: 55,
  maxTm: 65,
  optimalTm: 60,
  minGc: 30,
  maxGc: 70,
  maxHomopolymer: 5,
  hairpinThreshold: -2,
  dimerThreshold: -5,
  flankRange: 300,
  optimalProductLength: 500,
  maxProductLength: 3000,
  minProductLength: 100,
  topN: 20
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
  /** 二聚体惩罚 */
  dimerPenalty: number
  /** 产物长度偏好扣分 */
  productLengthPenalty: number
  /** 3'端稳定性扣分 */
  threePrimePenalty: number
  /** 同聚物扣分 */
  homopolymerPenalty: number
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
}
