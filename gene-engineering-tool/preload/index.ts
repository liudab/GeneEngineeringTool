import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../src/shared/types'

const api = {  // 酶
  getEnzymes: () => ipcRenderer.invoke(IPC_CHANNELS.ENZYME_LIST),
  getEnzyme: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.ENZYME_GET, id),
  searchEnzymes: (query: string) => ipcRenderer.invoke(IPC_CHANNELS.ENZYME_SEARCH, query),
  createEnzyme: (data: any) => ipcRenderer.invoke(IPC_CHANNELS.ENZYME_CREATE, data),
  updateEnzyme: (id: number, data: any) => ipcRenderer.invoke(IPC_CHANNELS.ENZYME_UPDATE, id, data),
  deleteEnzyme: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.ENZYME_DELETE, id),

  // 载体
  getVectors: () => ipcRenderer.invoke(IPC_CHANNELS.VECTOR_LIST),
  getVector: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.VECTOR_GET, id),
  createVector: (data: any) => ipcRenderer.invoke(IPC_CHANNELS.VECTOR_CREATE, data),
  updateVector: (id: number, data: any) => ipcRenderer.invoke(IPC_CHANNELS.VECTOR_UPDATE, id, data),
  deleteVector: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.VECTOR_DELETE, id),
  getVectorEnzymeSites: (vectorId: number) => ipcRenderer.invoke(IPC_CHANNELS.VECTOR_ENZYME_SITES, vectorId),
  importVectors: () => ipcRenderer.invoke(IPC_CHANNELS.VECTOR_IMPORT),

  // 基因序列
  getGenes: (type?: string) => ipcRenderer.invoke(IPC_CHANNELS.GENE_LIST, type),
  getGene: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.GENE_GET, id),
  searchGenes: (query: string, type?: string) => ipcRenderer.invoke(IPC_CHANNELS.GENE_SEARCH, query, type),
  createGene: (data: any) => ipcRenderer.invoke(IPC_CHANNELS.GENE_CREATE, data),
  updateGene: (id: number, data: any) => ipcRenderer.invoke(IPC_CHANNELS.GENE_UPDATE, id, data),
  deleteGene: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.GENE_DELETE, id),
  getGeneRelations: (geneId: number) => ipcRenderer.invoke(IPC_CHANNELS.GENE_RELATIONS, geneId),
  importGeneFiles: () => ipcRenderer.invoke(IPC_CHANNELS.GENE_IMPORT_FILE),
  openGeneEditor: (geneId: number) => ipcRenderer.invoke(IPC_CHANNELS.GENE_EDITOR_OPEN, geneId),
  getGeneEditorData: (geneId: number) => ipcRenderer.invoke(IPC_CHANNELS.GENE_EDITOR_GET_DATA, geneId),
  saveGeneSequence: (geneId: number, sequence: string) => ipcRenderer.invoke(IPC_CHANNELS.GENE_EDITOR_SAVE_SEQUENCE, geneId, sequence),

  // 实验室载体
  getLabVectors: () => ipcRenderer.invoke(IPC_CHANNELS.LAB_VECTOR_LIST),
  getLabVector: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.LAB_VECTOR_GET, id),
  createLabVector: (data: any) => ipcRenderer.invoke(IPC_CHANNELS.LAB_VECTOR_CREATE, data),
  updateLabVector: (id: number, data: any) => ipcRenderer.invoke(IPC_CHANNELS.LAB_VECTOR_UPDATE, id, data),
  deleteLabVector: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.LAB_VECTOR_DELETE, id),
  importLabVectorFiles: () => ipcRenderer.invoke(IPC_CHANNELS.LAB_VECTOR_IMPORT_FILE),

  // 文件
  openFile: () => ipcRenderer.invoke(IPC_CHANNELS.FILE_OPEN),
  parseGenBank: (content: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_PARSE_GENBANK, content),
  parseFasta: (content: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_PARSE_FASTA, content),

  // 编辑器
  openEditor: (vectorId: number) => ipcRenderer.invoke(IPC_CHANNELS.EDITOR_OPEN, vectorId),
  getEditorData: (vectorId: number) => ipcRenderer.invoke(IPC_CHANNELS.EDITOR_GET_DATA, vectorId),
  saveSequence: (vectorId: number, sequence: string) => ipcRenderer.invoke(IPC_CHANNELS.EDITOR_SAVE_SEQUENCE, vectorId, sequence),
  addFeature: (vectorId: number, feature: any) => ipcRenderer.invoke(IPC_CHANNELS.EDITOR_ADD_FEATURE, vectorId, feature),
  deleteFeature: (vectorId: number, index: number) => ipcRenderer.invoke(IPC_CHANNELS.EDITOR_DELETE_FEATURE, vectorId, index),
  updateFeature: (vectorId: number, index: number, feature: any) => ipcRenderer.invoke(IPC_CHANNELS.EDITOR_UPDATE_FEATURE, vectorId, index, feature),
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
  saveAsGenBank: (vectorId: number) => ipcRenderer.invoke(IPC_CHANNELS.FILE_SAVE_GENBANK, vectorId),
  saveAsFasta: (vectorId: number) => ipcRenderer.invoke(IPC_CHANNELS.FILE_SAVE_FASTA, vectorId),

  // 图谱导出
  exportSvg: (svgContent: string, defaultName: string) => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_SVG, svgContent, defaultName),
  exportPdf: (svgContent: string, defaultName: string) => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_PDF, svgContent, defaultName),
  exportImage: (format: string, dataUrl: string, defaultName: string) => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_IMAGE, format, dataUrl, defaultName),

  // 引物
  getPrimers: (category?: string) => ipcRenderer.invoke(IPC_CHANNELS.PRIMER_LIST, category),
  getPrimer: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.PRIMER_GET, id),
  searchPrimers: (query: string, category?: string) => ipcRenderer.invoke(IPC_CHANNELS.PRIMER_SEARCH, query, category),
  createPrimer: (data: any) => ipcRenderer.invoke(IPC_CHANNELS.PRIMER_CREATE, data),
  updatePrimer: (id: number, data: any) => ipcRenderer.invoke(IPC_CHANNELS.PRIMER_UPDATE, id, data),
  deletePrimer: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.PRIMER_DELETE, id),
  alignPrimer: (primerId: number) => ipcRenderer.invoke(IPC_CHANNELS.PRIMER_ALIGN, primerId),
  scanVectorForPrimers: (vectorSeq: string) => ipcRenderer.invoke(IPC_CHANNELS.PRIMER_SCAN_VECTOR, vectorSeq),
  importPrimersFromXlsx: () => ipcRenderer.invoke(IPC_CHANNELS.PRIMER_IMPORT_XLSX),

  // 测序文件
  getSequencingFiles: () => ipcRenderer.invoke(IPC_CHANNELS.SEQUENCING_FILE_LIST),
  getSequencingFile: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.SEQUENCING_FILE_GET, id),
  searchSequencingFiles: (query: string) => ipcRenderer.invoke(IPC_CHANNELS.SEQUENCING_FILE_SEARCH, query),
  createSequencingFile: (data: any) => ipcRenderer.invoke(IPC_CHANNELS.SEQUENCING_FILE_CREATE, data),
  updateSequencingFile: (id: number, data: any) => ipcRenderer.invoke(IPC_CHANNELS.SEQUENCING_FILE_UPDATE, id, data),
  deleteSequencingFile: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.SEQUENCING_FILE_DELETE, id),
  importSequencingFiles: () => ipcRenderer.invoke(IPC_CHANNELS.SEQUENCING_FILE_IMPORT),
  readSequencingFile: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.SEQUENCING_FILE_READ, id)
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
