/**
 * 凝胶电泳模拟引擎 — 导出
 */
export { simulateGel, fragmentsToLane, simulateMultiDigestGel, calculateMigration, getOptimalRange, DEFAULT_GEL_CONFIG, LADDER_LABELS, GEL_SPECS, BUFFER_LABELS, BUFFER_CORRECTION } from './electrophoresis'
export type { GelFragment, GelLane, GelConfig, GelSimulationResult, GelLaneResult, GelBand, GelLadderKey, GelSpec, GelBufferType } from './electrophoresis'
