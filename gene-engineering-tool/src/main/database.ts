/**
 * @module database
 * @description
 * 数据库统一导出入口（兼容层）— 从各 Repository 模块统一 re-export 所有公开 API。
 *
 * 架构设计意图：
 * - 保持向后兼容：外部调用方（ipc.ts, index.ts）无需修改导入路径
 * - 内部实现已拆分为独立的 Repository 模块（db/ 目录）
 * - 后续可逐步迁移 IPC handler 的导入源到具体 repo 模块
 *
 * 模块结构：
 * - db/base:        通用 DB 工具、Schema、备份恢复、序列工具
 * - db/enzyme-repo: 酶 CRUD + 种子数据
 * - db/vector-repo: 载体 + 实验室载体 CRUD
 * - db/gene-repo:   基因 CRUD + 关系管理
 * - db/primer-repo: 引物 CRUD + 比对 + XLSX 导入 + 种子数据
 * - db/sequencing-repo:    测序文件 CRUD
 * - db/component-repo:     元件 CRUD + 变体 + 去重 + 批量导入/导出
 * - db/component-matching: 元件匹配算法（scan + smart annotate + identify）
 * - db/seed-data:          种子数据编排
 * - db/species-repo:       物种插件 CRUD + 基因注释管理
 */

// ============ 基础设施 ============
export {
  getDb, getDbPath, saveDb, queryAll, queryOne, run, runNoSave, runBatch, lastInsertId,
  getDataDir, ensureFixedUserDataDir, migrateFromOldAppNames,
  initDatabase, exportDatabase, restoreDatabase, createAutoBackup,
  reverseComplement, translateDNA, CODON_TABLE, PROTEIN_TYPES, autoTranslate,
  calcGcContent, calcTm
} from './db/base'

// ============ 酶 Repository ============
export {
  getEnzymes, getEnzyme, searchEnzymes, createEnzyme, updateEnzyme, deleteEnzyme,
  seedEnzymes, updateEnzymeLibrary
} from './db/enzyme-repo'

// ============ 载体 Repository ============
export {
  getVectors, getVector, createVector, updateVector, deleteVector, saveVectorFeatures,
  getVectorEnzymeSites, addVectorEnzymeSite, removeVectorEnzymeSite,
  getLabVectors, getLabVector, createLabVector, updateLabVector, deleteLabVector
} from './db/vector-repo'

// ============ 基因 Repository ============
export {
  getGenes, getGene, searchGenes, createGene, updateGene, deleteGene,
  getGeneRelations, addGeneRelation, removeGeneRelation,
  searchGenesBySymbol, findGeneByNcbiId, findAllGenesByNcbiId, findGeneByNameAndType, getGeneWithDetails,
  getGeneTranscripts, getGeneTranscript, findGeneTranscriptByAccession, createGeneTranscript, updateGeneTranscript,
  deleteGeneTranscript, deleteGeneTranscriptsByGene,
  getGeneExons, createGeneExon, createGeneExons, deleteGeneExonsByTranscript,
  getGeneCrossRefs, findGeneCrossRefByAccession, createGeneCrossRef, updateGeneCrossRef, deleteGeneCrossRef,
  deleteGeneCrossRefsByGene,
  getSetting, setSetting, getAllSettings,
  getGeneRelatedSequences, getGeneRelatedSequence, findGeneRelatedSequenceByAccession,
  createGeneRelatedSequence, updateGeneRelatedSequenceContent
} from './db/gene-repo'

// ============ 引物 Repository ============
export {
  getPrimers, getPrimer, searchPrimers, createPrimer, updatePrimer, deletePrimer,
  alignPrimerToGenes, scanVectorForUniversalPrimers,
  importPrimersFromXlsx, seedUniversalPrimers
} from './db/primer-repo'

// ============ 测序文件 Repository ============
export {
  getSequencingFiles, getSequencingFile, searchSequencingFiles,
  createSequencingFile, updateSequencingFile, deleteSequencingFile
} from './db/sequencing-repo'

// ============ 元件 Repository ============
export {
  getComponents, getComponent, searchComponents, createComponent, updateComponent, deleteComponent,
  deleteComponents,
  getComponentVariants, findComponentVariant, setComponentVariants,
  deduplicateComponents, mergeComponentsBySimilarity,
  getComponentSpeciesList, backfillComponentSpecies, syncNormalizationToDb,
  batchImportComponentsFromFeatures, importComponentsFromFiles,
  exportComponentsToJson, importComponentsFromJson,
  autoAnnotateAllComponents, runTagsAutoAnnotation,
  previewBatchImport, executeBatchImport
} from './db/component-repo'

// ============ 元件匹配算法 ============
export {
  scanVectorForComponents, smartAnnotateComponents, identifyFeatureSequence
} from './db/component-matching'

// ============ 种子数据编排 ============
export {
  seedVectorComponents, purgeOldSeedComponents
} from './db/seed-data'

// ============ 物种插件 Repository ============
export {
  getSpeciesPlugins, getSpeciesPlugin, getEnabledPlugins,
  createSpeciesPlugin, deleteSpeciesPlugin, toggleSpeciesPlugin, updateSpeciesPlugin,
  getAnnotationsByGene, getAnnotationsByNcbiId,
  batchImportAnnotations, matchAnnotationsToGenes, linkAnnotationToGene,
  getPluginAnnotationStats, deletePluginAnnotations
} from './db/species-repo'
