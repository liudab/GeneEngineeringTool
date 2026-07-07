// ============ 限制性内切酶 ============
export interface RestrictionEnzyme {
  id: number
  name: string
  source_organism: string
  recognition_sequence: string
  cut_position: number
  optimal_temp: number
  is_palindromic: boolean
}

// ============ 载体 ============
export type VectorType = 'plasmid' | 'phage' | 'cosmid' | 'bac' | 'yac' | 'other'

// 基因工程目的
export type VectorPurpose = 'expression' | 'cloning' | 'shuttle' | 'reporter' | 'knockout' | 'knockin' | 'crispr' | 'other'

// 宿主类型
export type VectorHostType = 'ecoli' | 'mammalian' | 'yeast' | 'plant' | 'insect' | 'bacillus' | 'other'

// 启动子类型
export type VectorPromoterType = 'constitutive' | 'inducible' | 'tissue_specific' | 'none' | 'other'

export interface Vector {
  id: number
  name: string
  type: VectorType
  size_bp: number
  description: string
  sequence: string
  backbone_id: number | null
  // 新增分类字段
  purpose: VectorPurpose
  host_type: VectorHostType
  promoter_type: VectorPromoterType
  is_recombinant: boolean
  antibiotic_resistance: string
  copy_number: string
  file_path: string
  topology: 'circular' | 'linear'
  source_file: string
}

export interface VectorEnzymeSite {
  id: number
  vector_id: number
  enzyme_id: number
  position: number
  is_unique: boolean
  enzyme?: RestrictionEnzyme
}

// ============ 基因序列 ============
export type GeneSequenceType = 'mrna' | 'cdna' | 'genomic' | 'protein'

export interface GeneSequence {
  id: number
  gene_name: string
  type: GeneSequenceType
  species: string
  sequence: string
  accession_number: string
  description: string
  features_json?: string          // JSON 序列化的 GenBankFeature[]
  topology?: 'circular' | 'linear'
  file_path?: string
}

export interface GeneRelation {
  id: number
  gene_id: number
  related_gene_id: number
  relation_type: string
}

// ============ 实验室载体库 ============
export interface LabVector {
  id: number
  vector_id: number
  name: string
  insert_gene_id: number | null
  empty_vector_id: number | null
  notes: string
  created_at: string
  vector?: Vector
  insert_gene?: GeneSequence
  empty_vector?: LabVector
}

// ============ 引物数据库 ============
export type PrimerCategory = 'universal' | 'lab'

export interface Primer {
  id: number
  name: string
  sequence: string
  category: PrimerCategory
  tm?: number          // 熔解温度
  gc_content?: number  // GC含量百分比
  description?: string
  source?: string              // 来源（测序公司提供/用户添加）
  added_by?: string            // 添加人
  added_at?: string            // 添加时间
  target_gene_id?: number | null  // 实验室引物关联的基因
  alignment_result?: string       // 序列比对结果(JSON)
  created_at: string
}

/** 引物在载体序列上的匹配位点（编辑器图谱用） */
export interface PrimerSiteInfo {
  primer_id: number
  primer_name: string
  sequence: string
  position: number     // 序列上的位置
  recog_start: number  // 结合区起始
  recog_end: number    // 结合区结束
  strand: 1 | -1       // 1=正向, -1=反向互补
}

export interface PrimerAlignmentHit {
  gene_id: number
  gene_name: string
  match_start: number
  match_end: number
  strand: 1 | -1       // 1=正向匹配, -1=反向互补
  identity: number     // 匹配度百分比
}

// ============ GenBank 解析结果 ============
export interface GenBankFeature {
  type: string
  location: string
  start: number
  end: number
  strand: 1 | -1
  qualifiers: Record<string, string>
}

// ============ 元件自定义样式 ============
export type FeatureShape = 'arrow' | 'box' | 'box-arrow' | 'bent-arrow' | 'bent-arrow-up' | 'big-arrow' | 'wave' | 'line'
export type FillPattern = 'solid' | 'striped' | 'crosshatch' | 'horizontal' | 'hollow' | 'dotted'

export interface FeatureStyle {
  color: string
  shape: FeatureShape
  fill: FillPattern
}

export type FeatureStyles = Record<string, FeatureStyle>

export interface GenBankRecord {
  name: string
  description: string
  sequence: string
  size: number
  features: GenBankFeature[]
  accession: string
  version: string
  topology: 'linear' | 'circular'
}

export interface FastaRecord {
  id: string
  description: string
  sequence: string
}

// ============ 测序文件数据库 ============
export type SequencingFileType = 'ab1' | 'seq' | 'fasta'

export type SequencingDirection = 'forward' | 'reverse'

export interface SequencingFile {
  id: number
  file_name: string
  file_path: string
  file_type: SequencingFileType
  sample_name: string
  direction: SequencingDirection   // 测序方向: forward(正向)/reverse(反向)
  primer_id: number | null         // 关联引物表
  primer_name?: string             // 引物名称(查询时带出)
  sequence: string
  trace_data: string               // JSON: 四通道 trace 数据
  peak_positions: string           // JSON: 峰位置数组
  quality_values: string           // JSON: 质量值数组
  run_info: string
  notes: string
  created_at: string
  updated_at: string
}

// ============ IPC 通道定义 ============
export const IPC_CHANNELS = {
  // 酶
  ENZYME_LIST: 'db:enzyme:list',
  ENZYME_GET: 'db:enzyme:get',
  ENZYME_CREATE: 'db:enzyme:create',
  ENZYME_UPDATE: 'db:enzyme:update',
  ENZYME_DELETE: 'db:enzyme:delete',
  ENZYME_SEARCH: 'db:enzyme:search',

  // 载体
  VECTOR_LIST: 'db:vector:list',
  VECTOR_GET: 'db:vector:get',
  VECTOR_CREATE: 'db:vector:create',
  VECTOR_UPDATE: 'db:vector:update',
  VECTOR_DELETE: 'db:vector:delete',
  VECTOR_ENZYME_SITES: 'db:vector:enzyme-sites',
  VECTOR_IMPORT: 'db:vector:import',

  // 基因序列
  GENE_LIST: 'db:gene:list',
  GENE_GET: 'db:gene:get',
  GENE_CREATE: 'db:gene:create',
  GENE_UPDATE: 'db:gene:update',
  GENE_DELETE: 'db:gene:delete',
  GENE_SEARCH: 'db:gene:search',
  GENE_RELATIONS: 'db:gene:relations',

  // 实验室载体
  LAB_VECTOR_LIST: 'db:lab-vector:list',
  LAB_VECTOR_GET: 'db:lab-vector:get',
  LAB_VECTOR_CREATE: 'db:lab-vector:create',
  LAB_VECTOR_UPDATE: 'db:lab-vector:update',
  LAB_VECTOR_DELETE: 'db:lab-vector:delete',

  // 文件操作
  FILE_OPEN: 'file:open',
  FILE_PARSE_GENBANK: 'file:parse-genbank',
  FILE_PARSE_FASTA: 'file:parse-fasta',

  // 编辑器窗口
  EDITOR_OPEN: 'editor:open',
  EDITOR_GET_DATA: 'editor:get-data',
  EDITOR_SAVE_SEQUENCE: 'editor:save-sequence',
  EDITOR_ADD_FEATURE: 'editor:add-feature',
  EDITOR_DELETE_FEATURE: 'editor:delete-feature',
  EDITOR_UPDATE_FEATURE: 'editor:update-feature',
  EDITOR_SET_DIRTY: 'editor:set-dirty',

  // 菜单操作
  MENU_ACTION: 'menu:action',
  MENU_SET_LANGUAGE: 'menu:set-language',

  // 文件操作（新增）
  FILE_SAVE_GENBANK: 'file:save-genbank',
  FILE_SAVE_FASTA: 'file:save-fasta',

  // 图谱导出
  EXPORT_SVG: 'export:svg',
  EXPORT_PDF: 'export:pdf',
  EXPORT_IMAGE: 'export:image',
  // 引物
  PRIMER_LIST: 'db:primer:list',
  PRIMER_GET: 'db:primer:get',
  PRIMER_CREATE: 'db:primer:create',
  PRIMER_UPDATE: 'db:primer:update',
  PRIMER_DELETE: 'db:primer:delete',
  PRIMER_SEARCH: 'db:primer:search',
  PRIMER_IMPORT_XLSX: 'db:primer:import-xlsx',
  PRIMER_ALIGN: 'db:primer:align',
  PRIMER_SCAN_VECTOR: 'db:primer:scan-vector',
  PRIMER_SEED_UNIVERSAL: 'db:primer:seed-universal',

  // 测序文件
  SEQUENCING_FILE_LIST: 'db:sequencing:list',
  SEQUENCING_FILE_GET: 'db:sequencing:get',
  SEQUENCING_FILE_CREATE: 'db:sequencing:create',
  SEQUENCING_FILE_UPDATE: 'db:sequencing:update',
  SEQUENCING_FILE_DELETE: 'db:sequencing:delete',
  SEQUENCING_FILE_SEARCH: 'db:sequencing:search',
  SEQUENCING_FILE_IMPORT: 'db:sequencing:import',
  SEQUENCING_FILE_READ: 'db:sequencing:read',

  // 基因序列文件导入
  GENE_IMPORT_FILE: 'db:gene:import-file',

  // 基因编辑器窗口
  GENE_EDITOR_OPEN: 'gene-editor:open',
  GENE_EDITOR_GET_DATA: 'gene-editor:get-data',
  GENE_EDITOR_SAVE_SEQUENCE: 'gene-editor:save-sequence',

  // 实验室载体文件导入
  LAB_VECTOR_IMPORT_FILE: 'db:lab-vector:import-file'
} as const
