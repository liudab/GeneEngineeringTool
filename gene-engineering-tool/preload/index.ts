import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../src/shared/types'

// ============ IPC 调用超时包装 ============
const IPC_TIMEOUT = 30000 // 30秒默认超时
const IPC_TIMEOUT_LONG = 300000 // 5分钟长时操作超时（插件安装+自动导入）

/** 带超时的 IPC 调用包装 */
function invokeWithTimeout<T = any>(channel: string, timeoutMs: number = IPC_TIMEOUT, ...args: any[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`IPC timeout after ${timeoutMs}ms: ${channel}`))
    }, timeoutMs)
    ipcRenderer.invoke(channel, ...args)
      .then(result => {
        clearTimeout(timer)
        resolve(result)
      })
      .catch(err => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

/** 安全包装 IPC 调用，返回结构化错误对象 */
async function safeInvoke<T = any>(channel: string, ...args: any[]): Promise<T> {
  try {
    return await invokeWithTimeout<T>(channel, IPC_TIMEOUT, ...args)
  } catch (err: any) {
    console.error(`[Preload] IPC error: ${channel}`, err?.message || err)
    throw err
  }
}

const api = {  // 酶
  getEnzymes: () => safeInvoke(IPC_CHANNELS.ENZYME_LIST),
  getEnzyme: (id: number) => safeInvoke(IPC_CHANNELS.ENZYME_GET, id),
  searchEnzymes: (query: string) => safeInvoke(IPC_CHANNELS.ENZYME_SEARCH, query),
  createEnzyme: (data: any) => safeInvoke(IPC_CHANNELS.ENZYME_CREATE, data),
  updateEnzyme: (id: number, data: any) => safeInvoke(IPC_CHANNELS.ENZYME_UPDATE, id, data),
  deleteEnzyme: (id: number) => safeInvoke(IPC_CHANNELS.ENZYME_DELETE, id),
  updateEnzymeLibrary: () => safeInvoke(IPC_CHANNELS.ENZYME_UPDATE_LIBRARY),

  // 载体
  getVectors: () => safeInvoke(IPC_CHANNELS.VECTOR_LIST),
  getVector: (id: number) => safeInvoke(IPC_CHANNELS.VECTOR_GET, id),
  createVector: (data: any) => safeInvoke(IPC_CHANNELS.VECTOR_CREATE, data),
  updateVector: (id: number, data: any) => safeInvoke(IPC_CHANNELS.VECTOR_UPDATE, id, data),
  deleteVector: (id: number) => safeInvoke(IPC_CHANNELS.VECTOR_DELETE, id),
  getVectorEnzymeSites: (vectorId: number) => safeInvoke(IPC_CHANNELS.VECTOR_ENZYME_SITES, vectorId),
  importVectors: () => safeInvoke(IPC_CHANNELS.VECTOR_IMPORT),

  // 基因序列
  getGenes: (type?: string) => safeInvoke(IPC_CHANNELS.GENE_LIST, type),
  getGene: (id: number) => safeInvoke(IPC_CHANNELS.GENE_GET, id),
  searchGenes: (query: string, type?: string) => safeInvoke(IPC_CHANNELS.GENE_SEARCH, query, type),
  createGene: (data: any) => safeInvoke(IPC_CHANNELS.GENE_CREATE, data),
  updateGene: (id: number, data: any) => safeInvoke(IPC_CHANNELS.GENE_UPDATE, id, data),
  deleteGene: (id: number) => safeInvoke(IPC_CHANNELS.GENE_DELETE, id),
  getGeneRelations: (geneId: number) => safeInvoke(IPC_CHANNELS.GENE_RELATIONS, geneId),
  getGeneWithDetails: (id: number) => safeInvoke(IPC_CHANNELS.GENE_GET_DETAILS, id),
  getGeneTranscripts: (geneId: number) => safeInvoke(IPC_CHANNELS.GENE_TRANSCRIPTS, geneId),
  getGeneCrossRefs: (geneId: number) => safeInvoke(IPC_CHANNELS.GENE_CROSS_REFS, geneId),
  getGeneExons: (transcriptId: number) => safeInvoke('db:gene:exons', transcriptId),
  searchGenesBySymbol: (symbol: string) => safeInvoke(IPC_CHANNELS.GENE_SEARCH_SYMBOL, symbol),
  importGeneFromNCBI: (geneId: string) => invokeWithTimeout(IPC_CHANNELS.GENE_IMPORT_NCBI, 120000, geneId),
  exportGene: (geneId: number, format: string) => safeInvoke(IPC_CHANNELS.GENE_EXPORT, geneId, format),
  importGeneFiles: () => safeInvoke(IPC_CHANNELS.GENE_IMPORT_FILE),
  openGeneEditor: (geneId: number) => safeInvoke(IPC_CHANNELS.GENE_EDITOR_OPEN, geneId),
  openGeneTranscriptEditor: (geneId: number, transcriptId: number, seqType: 'mrna' | 'protein') => safeInvoke(IPC_CHANNELS.GENE_EDITOR_OPEN_TRANSCRIPT, geneId, transcriptId, seqType),
  getGeneEditorData: (geneId: number, transcriptId?: number, seqType?: 'mrna' | 'protein') => safeInvoke(IPC_CHANNELS.GENE_EDITOR_GET_DATA, geneId, transcriptId, seqType),
  saveGeneSequence: (geneId: number, sequence: string) => safeInvoke(IPC_CHANNELS.GENE_EDITOR_SAVE_SEQUENCE, geneId, sequence),
  getGeneRelatedSequences: (geneId: number) => safeInvoke(IPC_CHANNELS.GENE_GET_RELATED_SEQUENCES, geneId),
  openRelatedSeqEditor: (geneId: number, relatedSeqId: number, seqType: string) => safeInvoke(IPC_CHANNELS.GENE_RELATED_SEQ_OPEN_EDITOR, geneId, relatedSeqId, seqType),
  getRelatedSeqEditorData: (relatedSeqId: number) => safeInvoke(IPC_CHANNELS.GENE_RELATED_SEQ_GET_DATA, relatedSeqId),

  // 物种基因数据库插件
  getSpeciesPlugins: () => safeInvoke(IPC_CHANNELS.SPECIES_PLUGIN_LIST),
  installSpeciesPlugin: () => invokeWithTimeout(IPC_CHANNELS.SPECIES_PLUGIN_INSTALL, IPC_TIMEOUT_LONG),
  uninstallSpeciesPlugin: (id: number) => safeInvoke(IPC_CHANNELS.SPECIES_PLUGIN_UNINSTALL, id),
  toggleSpeciesPlugin: (id: number, enabled: boolean) => safeInvoke(IPC_CHANNELS.SPECIES_PLUGIN_TOGGLE, id, enabled),
  importSpeciesPluginData: (pluginId: number) => invokeWithTimeout(IPC_CHANNELS.SPECIES_PLUGIN_IMPORT_DATA, IPC_TIMEOUT_LONG, pluginId),
  exportSpeciesPlugin: (pluginId: number) => safeInvoke(IPC_CHANNELS.SPECIES_PLUGIN_EXPORT, pluginId),
  onSpeciesPluginProgress: (callback: (data: { message: string; percent: number }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.SPECIES_PLUGIN_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SPECIES_PLUGIN_PROGRESS, handler)
  },
  getSpeciesGeneAnnotations: (geneId: number) => safeInvoke(IPC_CHANNELS.SPECIES_GET_ANNOTATIONS, geneId),

  // MSU 在线数据获取（网站响应较慢，使用 120 秒超时）
  fetchMSUGeneInfo: (accession: string) => invokeWithTimeout(IPC_CHANNELS.SPECIES_FETCH_MSU_INFO, 120000, accession),
  fetchMSUSequences: (accession: string, variants?: Array<{ id: string; url: string }>) => invokeWithTimeout(IPC_CHANNELS.SPECIES_FETCH_MSU_SEQUENCES, 120000, accession, variants),

  // RiceData 在线数据获取
  fetchRiceDataGeneInfo: (ricedataId: string) => safeInvoke(IPC_CHANNELS.SPECIES_FETCH_RICEDATA_INFO, ricedataId),
  updateRiceDataAnnotation: (annotationIds: number[], data: any) => safeInvoke(IPC_CHANNELS.SPECIES_UPDATE_RICEDATA, annotationIds, data),

  // MSU 在线数据缓存
  cacheMSUInfo: (annotationId: number, msuData: any) => safeInvoke(IPC_CHANNELS.SPECIES_CACHE_MSU_INFO, annotationId, msuData),

  // RAP-DB 在线数据获取
  fetchRAPDBLocusInfo: (accession: string) => safeInvoke(IPC_CHANNELS.SPECIES_FETCH_RAPDB_INFO, accession),
  fetchRAPDBTranscript: (accession: string) => safeInvoke(IPC_CHANNELS.SPECIES_FETCH_RAPDB_TRANSCRIPT, accession),
  fetchRAPDBExpression: (accession: string, rxpId: string) => safeInvoke(IPC_CHANNELS.SPECIES_FETCH_RAPDB_EXPRESSION, accession, rxpId),
  fetchRAPDBExpressionImages: (accession: string) => safeInvoke(IPC_CHANNELS.SPECIES_FETCH_RAPDB_EXPRESSION_IMAGES, accession),
  saveRAPDBGenBank: (accession: string, data: any) => safeInvoke(IPC_CHANNELS.SPECIES_SAVE_RAPDB_GENBANK, accession, data),
  saveRAPDBFasta: (transcriptId: string, sequences: any) => safeInvoke(IPC_CHANNELS.SPECIES_SAVE_RAPDB_FASTA, transcriptId, sequences),
  cacheRAPDBInfo: (annotationId: number, data: any) => safeInvoke(IPC_CHANNELS.SPECIES_CACHE_RAPDB_INFO, annotationId, data),
  cacheRAPDBExpressionData: (annotationId: number, rxpId: string, data: any) => safeInvoke(IPC_CHANNELS.SPECIES_CACHE_RAPDB_EXPRESSION, annotationId, rxpId, data),
  fetchAllRAPDBExpressionData: (accession: string, annotationId: number) => safeInvoke(IPC_CHANNELS.SPECIES_FETCH_ALL_RAPDB_EXPRESSION, accession, annotationId, 120000),
  searchSpeciesAnnotations: (keyword: string) => safeInvoke(IPC_CHANNELS.SPECIES_SEARCH_ANNOTATIONS, keyword),
  createGeneFromAnnotation: (annotationIds: number[], geneName: string) => invokeWithTimeout(IPC_CHANNELS.SPECIES_CREATE_GENE_FROM_ANNOTATION, 180000, annotationIds, geneName),
    regenerateGeneHtml: () => safeInvoke(IPC_CHANNELS.GENE_REGENERATE_HTML),
  exportGenePackage: (geneId: number) => safeInvoke(IPC_CHANNELS.GENE_EXPORT_PACKAGE, geneId),
  importGenePackage: () => invokeWithTimeout(IPC_CHANNELS.GENE_IMPORT_PACKAGE, 120000),

  // 应用设置
  getSetting: (key: string) => safeInvoke(IPC_CHANNELS.SETTINGS_GET, key),
  setSetting: (key: string, value: string) => safeInvoke(IPC_CHANNELS.SETTINGS_SET, key, value),

  // 实验室载体
  getLabVectors: () => safeInvoke(IPC_CHANNELS.LAB_VECTOR_LIST),
  getLabVector: (id: number) => safeInvoke(IPC_CHANNELS.LAB_VECTOR_GET, id),
  createLabVector: (data: any) => safeInvoke(IPC_CHANNELS.LAB_VECTOR_CREATE, data),
  updateLabVector: (id: number, data: any) => safeInvoke(IPC_CHANNELS.LAB_VECTOR_UPDATE, id, data),
  deleteLabVector: (id: number) => safeInvoke(IPC_CHANNELS.LAB_VECTOR_DELETE, id),
  importLabVectorFiles: () => safeInvoke(IPC_CHANNELS.LAB_VECTOR_IMPORT_FILE),

  // 文件
  openFile: () => safeInvoke(IPC_CHANNELS.FILE_OPEN),
  parseGenBank: (content: string) => safeInvoke(IPC_CHANNELS.FILE_PARSE_GENBANK, content),
  parseFasta: (content: string) => safeInvoke(IPC_CHANNELS.FILE_PARSE_FASTA, content),

  // 编辑器
  openEditor: (vectorId: number) => safeInvoke(IPC_CHANNELS.EDITOR_OPEN, vectorId),
  getEditorData: (vectorId: number) => safeInvoke(IPC_CHANNELS.EDITOR_GET_DATA, vectorId),
  saveSequence: (vectorId: number, sequence: string) => safeInvoke(IPC_CHANNELS.EDITOR_SAVE_SEQUENCE, vectorId, sequence),
  addFeature: (vectorId: number, feature: any) => safeInvoke(IPC_CHANNELS.EDITOR_ADD_FEATURE, vectorId, feature),
  deleteFeature: (vectorId: number, index: number) => safeInvoke(IPC_CHANNELS.EDITOR_DELETE_FEATURE, vectorId, index),
  updateFeature: (vectorId: number, index: number, feature: any) => safeInvoke(IPC_CHANNELS.EDITOR_UPDATE_FEATURE, vectorId, index, feature),
  saveFeatures: (vectorId: number, features: any[]) => safeInvoke(IPC_CHANNELS.EDITOR_SAVE_FEATURES, vectorId, features),
  setEditorDirty: (dirty: boolean) => ipcRenderer.send(IPC_CHANNELS.EDITOR_SET_DIRTY, dirty),
  onSaveAndClose: (callback: () => void) => {
    ipcRenderer.on('editor:save-and-close', callback)
    return () => ipcRenderer.removeListener('editor:save-and-close', callback)
  },

  // 菜单操作
  onMenuAction: (callback: (action: string) => void) => {
    const handler = (_event: any, action: string) => callback(action)
    ipcRenderer.on(IPC_CHANNELS.MENU_ACTION, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.MENU_ACTION, handler)
  },
  setMenuLanguage: (lang: 'zh' | 'en') => ipcRenderer.send(IPC_CHANNELS.MENU_SET_LANGUAGE, lang),

  // 文件保存
  saveAsGenBank: (vectorId: number) => safeInvoke(IPC_CHANNELS.FILE_SAVE_GENBANK, vectorId),
  exportGenBankData: (data: { name: string; sequence: string; features: any[]; topology?: string }) => safeInvoke(IPC_CHANNELS.FILE_EXPORT_GENBANK_DATA, data),
  importProteinFasta: () => safeInvoke(IPC_CHANNELS.PROTEIN_IMPORT_FASTA),
  getProteinEditorData: (proteinKey: string) => safeInvoke(IPC_CHANNELS.PROTEIN_EDITOR_GET_DATA, proteinKey),
  saveAsFasta: (vectorId: number) => safeInvoke(IPC_CHANNELS.FILE_SAVE_FASTA, vectorId),
  batchExportVectors: (vectorIds: number[], format: string) => safeInvoke(IPC_CHANNELS.VECTOR_BATCH_EXPORT, vectorIds, format),

  // 图谱导出
  exportSvg: (svgContent: string, defaultName: string) => safeInvoke(IPC_CHANNELS.EXPORT_SVG, svgContent, defaultName),
  exportPdf: (svgContent: string, defaultName: string) => safeInvoke(IPC_CHANNELS.EXPORT_PDF, svgContent, defaultName),
  exportImage: (format: string, dataUrl: string, defaultName: string) => safeInvoke(IPC_CHANNELS.EXPORT_IMAGE, format, dataUrl, defaultName),

  // 引物
  getPrimers: (category?: string) => safeInvoke(IPC_CHANNELS.PRIMER_LIST, category),
  getPrimer: (id: number) => safeInvoke(IPC_CHANNELS.PRIMER_GET, id),
  searchPrimers: (query: string, category?: string) => safeInvoke(IPC_CHANNELS.PRIMER_SEARCH, query, category),
  createPrimer: (data: any) => safeInvoke(IPC_CHANNELS.PRIMER_CREATE, data),
  updatePrimer: (id: number, data: any) => safeInvoke(IPC_CHANNELS.PRIMER_UPDATE, id, data),
  deletePrimer: (id: number) => safeInvoke(IPC_CHANNELS.PRIMER_DELETE, id),
  alignPrimer: (primerId: number) => safeInvoke(IPC_CHANNELS.PRIMER_ALIGN, primerId),
  scanVectorForPrimers: (vectorSeq: string) => safeInvoke(IPC_CHANNELS.PRIMER_SCAN_VECTOR, vectorSeq),
  importPrimersFromXlsx: () => safeInvoke(IPC_CHANNELS.PRIMER_IMPORT_XLSX),

  // 测序文件
  getSequencingFiles: () => safeInvoke(IPC_CHANNELS.SEQUENCING_FILE_LIST),
  getSequencingFile: (id: number) => safeInvoke(IPC_CHANNELS.SEQUENCING_FILE_GET, id),
  searchSequencingFiles: (query: string) => safeInvoke(IPC_CHANNELS.SEQUENCING_FILE_SEARCH, query),
  createSequencingFile: (data: any) => safeInvoke(IPC_CHANNELS.SEQUENCING_FILE_CREATE, data),
  updateSequencingFile: (id: number, data: any) => safeInvoke(IPC_CHANNELS.SEQUENCING_FILE_UPDATE, id, data),
  deleteSequencingFile: (id: number) => safeInvoke(IPC_CHANNELS.SEQUENCING_FILE_DELETE, id),
  importSequencingFiles: () => safeInvoke(IPC_CHANNELS.SEQUENCING_FILE_IMPORT),
  readSequencingFile: (id: number) => safeInvoke(IPC_CHANNELS.SEQUENCING_FILE_READ, id),

  // 数据库备份/恢复
  backupDatabase: () => safeInvoke(IPC_CHANNELS.DB_BACKUP),
  restoreDatabase: () => safeInvoke(IPC_CHANNELS.DB_RESTORE),
  autoBackup: () => safeInvoke(IPC_CHANNELS.DB_AUTO_BACKUP),

  // 载体元件数据库
  getComponents: () => safeInvoke(IPC_CHANNELS.COMPONENT_LIST),
  getComponent: (id: number) => safeInvoke(IPC_CHANNELS.COMPONENT_GET, id),
  searchComponents: (query: string) => safeInvoke(IPC_CHANNELS.COMPONENT_SEARCH, query),
  createComponent: (data: any) => safeInvoke(IPC_CHANNELS.COMPONENT_CREATE, data),
  updateComponent: (id: number, data: any) => safeInvoke(IPC_CHANNELS.COMPONENT_UPDATE, id, data),
  deleteComponent: (id: number) => safeInvoke(IPC_CHANNELS.COMPONENT_DELETE, id),
  scanVectorComponents: (vectorSeq: string, features: any[]) => safeInvoke(IPC_CHANNELS.COMPONENT_SCAN_VECTOR, vectorSeq, features),
  smartAnnotateComponents: (vectorSequence: string) => safeInvoke(IPC_CHANNELS.COMPONENT_SMART_ANNOTATE, vectorSequence),
  getComponentSnapshot: () => safeInvoke(IPC_CHANNELS.COMPONENT_GET_SNAPSHOT),
  batchImportComponents: (features: any[], vectorSeq: string, sourceVectorName?: string) => safeInvoke(IPC_CHANNELS.COMPONENT_BATCH_IMPORT_FEATURES, features, vectorSeq, sourceVectorName),
  previewBatchImport: (features: any[], vectorSeq: string, sourceVectorName?: string) => safeInvoke(IPC_CHANNELS.COMPONENT_BATCH_IMPORT_PREVIEW, features, vectorSeq, sourceVectorName),
  executeBatchImport: (features: any[], vectorSeq: string, sourceVectorName: string | undefined, decisions: any[]) => safeInvoke(IPC_CHANNELS.COMPONENT_BATCH_IMPORT_EXECUTE, features, vectorSeq, sourceVectorName, decisions),
  getComponentSpeciesList: () => safeInvoke(IPC_CHANNELS.COMPONENT_SPECIES_LIST),
  backfillComponentSpecies: () => safeInvoke(IPC_CHANNELS.COMPONENT_BACKFILL_SPECIES),
  syncNormalizationToDb: (matches: any[], vectorSeq: string, features: any[], sourceOrganism?: string) => safeInvoke(IPC_CHANNELS.COMPONENT_SYNC_NORMALIZATION, matches, vectorSeq, features, sourceOrganism),
  identifyFeatureSequence: (featureSeq: string) => safeInvoke(IPC_CHANNELS.COMPONENT_IDENTIFY_FEATURE, featureSeq),
  deduplicateComponents: () => safeInvoke(IPC_CHANNELS.COMPONENT_DEDUPLICATE),
  purgeSeedComponents: () => safeInvoke(IPC_CHANNELS.COMPONENT_PURGE_SEED_DATA),
  getComponentVariants: (id: number) => safeInvoke(IPC_CHANNELS.COMPONENT_GET_VARIANTS, id),
  batchDeleteComponents: (ids: number[]) => safeInvoke(IPC_CHANNELS.COMPONENT_BATCH_DELETE, ids),
  mergeComponentVariants: (ids: number[]) => safeInvoke(IPC_CHANNELS.COMPONENT_MERGE_VARIANTS, ids),
  importComponentFiles: () => safeInvoke(IPC_CHANNELS.COMPONENT_IMPORT_FILE),
  exportComponentsJson: () => safeInvoke(IPC_CHANNELS.COMPONENT_EXPORT_JSON),
  importComponentsJson: () => safeInvoke(IPC_CHANNELS.COMPONENT_IMPORT_JSON),
  autoAnnotateComponents: () => safeInvoke(IPC_CHANNELS.COMPONENT_AUTO_ANNOTATE),

  // 调试与诊断
  getDebugLogs: () => safeInvoke(IPC_CHANNELS.DEBUG_GET_LOGS),
  exportDebugLogs: () => safeInvoke(IPC_CHANNELS.DEBUG_EXPORT_LOGS),
  openLogFolder: () => safeInvoke(IPC_CHANNELS.DEBUG_OPEN_LOG_FOLDER),
  getSystemStatus: () => safeInvoke(IPC_CHANNELS.DEBUG_GET_SYSTEM_STATUS),
  __logToMain: (level: number, module: string, message: string, detail?: string) => {
    ipcRenderer.send(IPC_CHANNELS.LOG_FROM_RENDERER, level, module, message, detail)
  },

  // 系统
  openExternal: (url: string) => safeInvoke(IPC_CHANNELS.OPEN_EXTERNAL, url),
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
