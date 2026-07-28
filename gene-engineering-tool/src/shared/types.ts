// ============ 限制性内切酶 ============
export interface RestrictionEnzyme {
  id: number
  name: string
  source_organism: string
  recognition_sequence: string
  cut_position: number
  optimal_temp: number
  is_palindromic: boolean
  // 突出端信息
  overhang_type?: '5prime' | '3prime' | 'blunt'
  overhang_length?: number
  top_cut_offset?: number
  bottom_cut_offset?: number
  // 缓冲液与反应条件
  optimal_buffer?: string
  heat_inactivation_temp?: number | null
  // 甲基化敏感性（'dam' / 'dcm' / 'CpG'，多个逗号分隔）
  methylation_sensitive?: string | null
  // 特殊属性
  is_time_saver?: boolean
  is_high_fidelity?: boolean
  star_activity_note?: string | null
  ligation_note?: string | null

  // ===== NEB Excel 新增字段 =====
  cut_sequence?: string | null            // 切割序列标注，如 G^AATTC
  subtype?: string | null                 // Type II 亚型：P(回文)/S(移位)/A(异常)
  rebase_id?: string | null               // REBASE 数据库编号
  prototype?: string | null               // 原型酶名称
  source_organism_cn?: string | null      // 物种中文名
  organism_type?: string | null           // 物种类型：bacteria/archaea/virus/plasmid 等
  growth_temp?: number | null             // 生长温度 °C（区别于 optimal_temp 反应温度）
  molecular_weight?: number | null        // 分子量 Da
  clean_recognition_seq?: string | null   // 纯识别序列（去除标注符号）
  seq_length?: number | null              // 识别序列长度 bp
  has_ambiguous_bases?: boolean | null    // 是否含简并碱基
  gc_content?: number | null              // GC 含量 %
  sites_lambda?: number | null            // Lambda 切点数
  sites_pbr322?: number | null            // pBR322 切点数
  sites_adeno2?: number | null            // Adeno2 切点数
  sites_phix174?: number | null           // PhiX174 切点数
  sites_sv40?: number | null              // SV40 切点数
  gene_cloned?: boolean | null            // 基因已克隆
  gene_sequenced?: boolean | null         // 基因已测序
  crystal_data?: boolean | null           // 有晶体结构数据
  kinetics_data?: boolean | null          // 有动力学数据
  ss_cleavage?: boolean | null            // 单链切割能力
  has_isoschizomers?: boolean | null      // 是否有同切酶
  date_entered?: string | null            // 录入日期
  date_modified?: string | null           // 修改日期
  rebase_url?: string | null              // REBASE 数据库链接
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
  // 分类字段
  purpose: string                    // 自由文本（如"荧光蛋白表达"、"CRISPR"等）
  host_type: string                  // JSON数组字符串 ["大肠杆菌","哺乳动物"]
  promoter_type: VectorPromoterType  // 简单分类标记
  promoters: string                  // JSON数组字符串 ["大肠杆菌 T7","人 CMV"]
  reporter_gene: string              // 逗号分隔字符串 "GFP, mCherry"
  is_recombinant: boolean
  antibiotic_resistance: string
  copy_number: string
  file_path: string
  topology: 'circular' | 'linear'
  source_file: string
  features_json?: string  // 存储编辑器修改后的 features
}

export interface VectorEnzymeSite {
  id: number
  vector_id: number
  enzyme_id: number
  position: number
  is_unique: boolean
  enzyme?: RestrictionEnzyme
}

// ============ 载体元件数据库 ============
export type VectorComponentType =
  | 'resistance'    // 抗性基因
  | 'CDS'           // 编码序列
  | 'promoter'      // 启动子
  | 'origin'        // 复制子
  | 'terminator'    // 终止子
  | 'enhancer'      // 增强子
  | 'reporter'      // 报告基因
  | 'tag'           // 标签序列
  | 'regulatory'    // 调控元件
  | 'other'         // 其他

export type ComponentTag =
  // 原有标签（14个）
  | 'fluorescent-protein' | 'bioluminescent' | 'affinity-tag'
  | 'selectable-marker' | 'auxotrophic-marker' | 'reporter-gene'
  | 'regulatory' | 'cloning' | 'expression'
  | 'genome-editing' | 'protein-expression' | 'drug-resistance'
  | 'viral' | 'metabolic'
  // 复制子细分（4个）
  | 'bacterial-origin' | 'yeast-origin' | 'mammalian-origin' | 'plant-origin'
  // 启动子细分（3个）
  | 'constitutive-promoter' | 'inducible-promoter' | 'tissue-specific-promoter'
  // 抗性细分（2个）
  | 'antibiotic-resistance' | 'herbicide-resistance'
  // T-DNA/农杆菌（1个）
  | 'tdna-border'
  // 蛋白质纯化标签（4个）
  | 'his-tag' | 'flag-tag' | 'gst-tag' | 'mbp-tag'
  // 分泌/定位（3个）
  | 'signal-peptide' | 'nls' | 'nes'
  // 载体骨架（1个）
  | 'backbone-element'

export const COMPONENT_TAG_LABELS: Record<ComponentTag, { zh: string; en: string; color: string }> = {
  // 原有标签
  'fluorescent-protein': { zh: '荧光蛋白', en: 'Fluorescent Protein', color: 'bg-green-100 text-green-800' },
  'bioluminescent': { zh: '生物发光', en: 'Bioluminescent', color: 'bg-yellow-100 text-yellow-800' },
  'affinity-tag': { zh: '亲和标签', en: 'Affinity Tag', color: 'bg-purple-100 text-purple-800' },
  'selectable-marker': { zh: '筛选标记', en: 'Selectable Marker', color: 'bg-red-100 text-red-800' },
  'auxotrophic-marker': { zh: '营养缺陷标记', en: 'Auxotrophic Marker', color: 'bg-orange-100 text-orange-800' },
  'reporter-gene': { zh: '报告基因', en: 'Reporter Gene', color: 'bg-blue-100 text-blue-800' },
  'regulatory': { zh: '调控元件', en: 'Regulatory', color: 'bg-cyan-100 text-cyan-800' },
  'cloning': { zh: '克隆元件', en: 'Cloning', color: 'bg-slate-100 text-slate-800' },
  'expression': { zh: '表达元件', en: 'Expression', color: 'bg-indigo-100 text-indigo-800' },
  'genome-editing': { zh: '基因组编辑', en: 'Genome Editing', color: 'bg-pink-100 text-pink-800' },
  'protein-expression': { zh: '蛋白表达', en: 'Protein Expression', color: 'bg-teal-100 text-teal-800' },
  'drug-resistance': { zh: '药物抗性', en: 'Drug Resistance', color: 'bg-rose-100 text-rose-800' },
  'viral': { zh: '病毒元件', en: 'Viral', color: 'bg-amber-100 text-amber-800' },
  'metabolic': { zh: '代谢相关', en: 'Metabolic', color: 'bg-lime-100 text-lime-800' },
  // 复制子细分
  'bacterial-origin': { zh: '细菌复制子', en: 'Bacterial Origin', color: 'bg-emerald-100 text-emerald-800' },
  'yeast-origin': { zh: '酵母复制子', en: 'Yeast Origin', color: 'bg-lime-100 text-lime-800' },
  'mammalian-origin': { zh: '哺乳动物复制子', en: 'Mammalian Origin', color: 'bg-violet-100 text-violet-800' },
  'plant-origin': { zh: '植物复制子', en: 'Plant Origin', color: 'bg-green-100 text-green-800' },
  // 启动子细分
  'constitutive-promoter': { zh: '组成型启动子', en: 'Constitutive Promoter', color: 'bg-amber-100 text-amber-800' },
  'inducible-promoter': { zh: '诱导型启动子', en: 'Inducible Promoter', color: 'bg-orange-100 text-orange-800' },
  'tissue-specific-promoter': { zh: '组织特异性启动子', en: 'Tissue-Specific Promoter', color: 'bg-red-100 text-red-800' },
  // 抗性细分
  'antibiotic-resistance': { zh: '抗生素抗性', en: 'Antibiotic Resistance', color: 'bg-rose-100 text-rose-800' },
  'herbicide-resistance': { zh: '除草剂抗性', en: 'Herbicide Resistance', color: 'bg-pink-100 text-pink-800' },
  // T-DNA/农杆菌
  'tdna-border': { zh: 'T-DNA边界', en: 'T-DNA Border', color: 'bg-green-100 text-green-800' },
  // 蛋白质纯化标签
  'his-tag': { zh: 'His标签', en: 'His Tag', color: 'bg-purple-100 text-purple-800' },
  'flag-tag': { zh: 'FLAG标签', en: 'FLAG Tag', color: 'bg-fuchsia-100 text-fuchsia-800' },
  'gst-tag': { zh: 'GST标签', en: 'GST Tag', color: 'bg-indigo-100 text-indigo-800' },
  'mbp-tag': { zh: 'MBP标签', en: 'MBP Tag', color: 'bg-cyan-100 text-cyan-800' },
  // 分泌/定位
  'signal-peptide': { zh: '信号肽', en: 'Signal Peptide', color: 'bg-sky-100 text-sky-800' },
  'nls': { zh: '核定位信号', en: 'Nuclear Localization Signal', color: 'bg-blue-100 text-blue-800' },
  'nes': { zh: '核输出信号', en: 'Nuclear Export Signal', color: 'bg-indigo-100 text-indigo-800' },
  // 载体骨架
  'backbone-element': { zh: '骨架元件', en: 'Backbone Element', color: 'bg-gray-100 text-gray-800' },
}

/** 标签功能分组（用于编辑表单 UI） */
export const COMPONENT_TAG_GROUPS: { label: string; tags: ComponentTag[] }[] = [
  {
    label: '功能属性',
    tags: [
      'fluorescent-protein', 'bioluminescent', 'reporter-gene',
      'selectable-marker', 'auxotrophic-marker', 'drug-resistance',
      'antibiotic-resistance', 'herbicide-resistance',
      'regulatory', 'expression', 'protein-expression',
      'genome-editing', 'metabolic',
    ],
  },
  {
    label: '复制子来源',
    tags: ['bacterial-origin', 'yeast-origin', 'mammalian-origin', 'plant-origin', 'cloning'],
  },
  {
    label: '启动子类型',
    tags: ['constitutive-promoter', 'inducible-promoter', 'tissue-specific-promoter'],
  },
  {
    label: '蛋白质标签',
    tags: ['affinity-tag', 'his-tag', 'flag-tag', 'gst-tag', 'mbp-tag'],
  },
  {
    label: '定位信号',
    tags: ['signal-peptide', 'nls', 'nes'],
  },
  {
    label: '载体骨架/特殊元件',
    tags: ['backbone-element', 'tdna-border', 'viral'],
  },
]

/** 序列变体类型 */
export type ComponentSeqType = 'DNA' | 'Protein'

/** 元件数据库中的单个序列变体 */
export interface ComponentVariant {
  id?: number
  component_id?: number
  variant_id: string          // ref / variant1 / variant2 ...
  seq_type: ComponentSeqType
  sequence: string
  length: number
  is_reference: boolean
  sources: string
}

/** 外部来源的完整元件元数据 */
export interface ComponentMetadata {
  feature_id?: string
  direction?: 'forward' | 'reverse' | 'bidirectional' | 'none'
  species_short?: string
  species_latin?: string
  species_cn?: string
  taxonomic_category?: 'Bacteria' | 'Eukaryota' | 'Virus' | 'Archaea' | 'Synthetic'
  ref_protein_sequence?: string
  molecular_weight?: number
  dna_variant_count?: number
  aa_variant_count?: number
  product_description?: string
  gene?: string
  bound_moiety?: string
  source_databases?: string
  total_occurrences?: number
  annotation_method?: 'exact' | 'pattern' | 'description'
}

/** 相似变体记录（批量导入时检测到相似元件时记录） */
export interface SimilarVariant {
  name: string          // 相似元件的名称
  identity: number      // 相似度百分比 (0-100)
  length_new: number    // 新元件序列长度
  length_existing: number // 已有元件序列长度
  length_diff_pct: number // 长度差异百分比
  source_vector: string  // 来源载体名称
  detected_at: string    // 检测时间
}

/** 批量导入预扫描单项结果 */
export interface ImportPreviewItem {
  featureIndex: number
  name: string
  type: string
  dnaLength: number
  aaLength: number
  strand: 1 | -1
  status: 'new' | 'duplicate' | 'variant' | 'ambiguous'
  /** 匹配的已有元件（duplicate/variant/ambiguous 时有值） */
  matchComponentId?: number
  matchComponentName?: string
  matchComponentType?: string
  /** DNA identity (0-100) */
  dnaIdentity?: number
  /** AA identity (0-100) */
  aaIdentity?: number
  /** 比对模式 */
  alignmentMode?: 'nt-nt' | 'nt-aa' | 'aa-aa'
  /** 跳过原因说明（duplicate 时） */
  skipReason?: string
  /** 候选列表（ambiguous 时，多个候选匹配） */
  candidates?: Array<{
    componentId: number
    componentName: string
    componentType: string
    dnaIdentity: number
    aaIdentity: number
    alignmentMode: string
  }>
}

/** 用户导入决策 */
export interface ImportDecision {
  featureIndex: number
  action: 'import-new' | 'skip' | 'import-as-variant' | 'import-as-variant-of'
  /** action=import-as-variant-of 时指定关联到的元件 ID */
  variantOfComponentId?: number
  /** action=import-as-variant-of 时覆盖名称 */
  overrideName?: string
}

export interface VectorComponent {
  id: number
  sequence: string
  standard_name: string
  aliases: string             // JSON 字符串化的 string[]
  type: VectorComponentType
  species: string
  notes: string
  amino_acid_sequence: string  // 自动翻译的氨基酸序列
  similar_variants: string     // JSON 字符串化的 SimilarVariant[]
  created_at: string
  // 扩展字段（外部来源）
  feature_id?: string
  direction?: 'forward' | 'reverse' | 'bidirectional' | 'none'
  species_short?: string
  species_latin?: string
  species_cn?: string
  taxonomic_category?: 'Bacteria' | 'Eukaryota' | 'Virus' | 'Archaea' | 'Synthetic'
  ref_protein_sequence?: string
  molecular_weight?: number
  dna_variant_count?: number
  aa_variant_count?: number
  product_description?: string
  gene?: string
  bound_moiety?: string
  source_databases?: string
  total_occurrences?: number
  annotation_method?: 'exact' | 'pattern' | 'description'
  // 变体（JSON 字符串化的 ComponentVariant[]）
  variants?: string
  // 标签（JSON 字符串化的 ComponentTag[]）
  tags?: string
}

/** 载体序列元件匹配结果（规范化用） */
export interface ComponentMatch {
  component_id: number
  standard_name: string
  current_name: string
  match_type: 'exact' | 'partial'
  identity: number            // 匹配度百分比 (0-100)
  match_start: number
  match_end: number
  strand: 1 | -1
  component_type: VectorComponentType
  metadata?: Partial<VectorComponent> // 附加的元件元数据，用于 UI 展示
}

/** 智能标注元件匹配结果 */
/** 智能标注候选元件（歧义匹配时的备选） */
export interface SmartMatchCandidate {
  component_id: number
  standard_name: string
  similarity: number
  component_type: VectorComponentType
  alignment_mode: string
  tags?: string
  /** 元件序列被比对覆盖的百分比 (0-100) */
  query_coverage?: number
  /** 匹配区间在载体上的起始位置（1-based） */
  match_start?: number
  /** 匹配区间在载体上的结束位置（1-based） */
  match_end?: number
  /** 元件数据库中的序列长度（bp） */
  component_seq_length?: number
  /** 匹配区间在元件序列上的起始位置（1-based） */
  component_match_start?: number
  /** 匹配区间在元件序列上的结束位置（1-based） */
  component_match_end?: number
}

export interface SmartMatchResult {
  feature_index: number        // feature 在载体中的索引
  feature_name: string         // 当前 feature 名称
  feature_type: string         // feature 类型
  feature_sequence: string     // feature DNA 序列
  match_component_id: number   // 匹配的数据库元件 ID
  match_component_name: string // 匹配的元件标准名
  match_type: 'exact' | 'partial'
  similarity: number           // 相似度百分比 (0-100)
  alignment_mode: 'nt-nt' | 'nt-aa' | 'aa-nt' | 'aa-aa' | 'name-match' // 比对模式
  match_start: number          // 在载体序列中的起始位置（1-based）
  match_end: number            // 在载体序列中的结束位置（1-based）
  strand: 1 | -1               // 1=正义链, -1=反义链
  component_type: VectorComponentType
  tags?: string                // 元件标签 (JSON ComponentTag[])
  /** 歧义匹配候选列表：当同一 feature 区域有多个元件匹配时填充（按 similarity 降序，最多5个） */
  candidates?: SmartMatchCandidate[]
  /** 元件序列被比对覆盖的百分比 (0-100)，与 similarity 一起作为匹配质量综合评判 */
  query_coverage?: number
  /** 部分匹配提示：当 query_coverage < 50% 时自动填充，说明仅元件的部分序列被匹配 */
  partial_match_note?: string
  /** 匹配区间在元件序列上的起始位置（1-based） */
  component_match_start?: number
  /** 匹配区间在元件序列上的结束位置（1-based） */
  component_match_end?: number
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
  // 扩展字段（NCBI集成 + 基因浏览器）
  gene_symbol?: string             // 基因符号 (e.g. Os01g0100100)
  chromosome?: string              // 染色体位置
  strand?: 1 | -1                  // 链方向
  biotype?: string                 // protein_coding / lncRNA / etc.
  ncbi_gene_id?: string            // NCBI Gene ID (LOC号)
  genomic_start?: number           // 基因组起始坐标
  genomic_end?: number             // 基因组结束坐标
  summary?: string                 // 功能描述
  ncbi_imported_at?: string        // NCBI导入时间
}

/** 基因转录本 */
export interface GeneTranscript {
  id: number
  gene_id: number
  transcript_id: string            // NCBI transcript accession (e.g. NM_001256789)
  name: string                     // 转录本名称
  is_primary: boolean              // 是否主要转录本
  mrna_sequence: string
  cds_sequence: string
  protein_sequence: string
  exon_count: number
  strand: 1 | -1
  source: string                   // 'NCBI' | 'manual' | 'file-import'
  cds_start: number                // CDS 在 mRNA 上的起始位置（1-based）
  cds_end: number                  // CDS 在 mRNA 上的结束位置（1-based）
}

/** 基因外显子 */
export interface GeneExon {
  id: number
  transcript_id: number            // FK -> gene_transcripts.id
  exon_number: number
  start: number                    // 基因组坐标
  end: number
  strand: 1 | -1
  utr_type: '5prime' | '3prime' | null  // null = coding exon
}

/** 基因数据库交叉引用 */
export interface GeneCrossRef {
  id: number
  gene_id: number
  database: string                 // 'NCBI' | 'Ensembl' | 'UniProt' | 'RAP-DB' | 'MSULOC' 等
  accession: string
  url: string
  is_primary: boolean
}

/** 相关序列（来自 NCBI Related Sequences） */
export interface GeneRelatedSequence {
  id: number
  gene_id: number
  seq_type: string                 // 'genomic' | 'mRNA' | 'protein'
  nucleotide_accession: string     // 核酸存取号（如 CP132245.1）
  protein_accession: string | null // 蛋白存取号（可能为 NULL）
  genomic_range: string | null     // 基因组范围（如 "20211701..20214089"，可能为 NULL）
  description: string              // 描述信息
  ncbi_content: string             // 缓存的完整 GenBank/FASTA 内容
  ncbi_imported_at: string         // 导入时间（ISO 格式）
}

// ============ 物种基因数据库插件系统 ============

/** 插件运行模式 */
export type PluginMode = 'offline' | 'online' | 'hybrid'

/** 插件规范接口（plugin.json 需实现） */
export interface SpeciesPluginSpec {
  name: string
  speciesName: string
  speciesLatin: string
  version: string
  description: string
  /** 插件运行模式：offline=预存数据, online=在线获取, hybrid=混合 */
  mode: PluginMode
  /** 预存数据源配置（mode=offline 或 hybrid 时必需） */
  dataSources?: DataSourceConfig[]
  /** 字段定义列表 */
  fieldDefinitions: FieldDefinition[]
  /** 外部链接 URL 模板 */
  urlTemplates: Record<string, string>
  /** 在线数据获取配置（mode=online 或 hybrid 时必需） */
  onlineSources?: OnlineSourceConfig[]
  /** 限速策略配置 */
  rateLimit?: RateLimitConfig
}

/** 预存数据源配置（CSV 列映射） */
export interface DataSourceConfig {
  name: string
  keyField: string
  csvColumn: number
  ncbiColumn: number
  importColumns: ImportColumnMapping[]
}

export interface ImportColumnMapping {
  csvColumn: number
  fieldName: string
  fieldType: 'text' | 'link' | 'tags'
}

/** 在线数据源配置 */
export interface OnlineSourceConfig {
  /** 数据源名称（显示在标签页标题，如 'RAP-DB'） */
  name: string
  /** 数据源唯一标识（用于缓存键名，如 'rapdb'） */
  id: string
  /** 数据获取类型：api=REST API, web=网页抓取, genbank=GenBank 格式下载 */
  fetchType: 'api' | 'web' | 'genbank' | 'fasta'
  /** 数据获取 URL 模板（支持 {accession}、{geneId}、{ncbiGeneId} 等动态参数） */
  urlTemplate: string
  /** HTTP 方法 */
  method?: 'GET' | 'POST'
  /** 请求头 */
  headers?: Record<string, string>
  /** 请求体模板（POST 时使用） */
  bodyTemplate?: string
  /** 响应解析规则 */
  responseParser: ResponseParserConfig
  /** 缓存策略 */
  cache?: CacheConfig
  /** 触发时机：ncbi_import=NCBI导入后自动触发, manual=仅手动触发, both=两者皆可 */
  triggerOn?: 'ncbi_import' | 'manual' | 'both'
  /** 数据源描述 */
  description?: string
}

/** 响应解析规则 */
export interface ResponseParserConfig {
  /** 解析类型：json=JSON 路径映射, html=CSS 选择器提取, text=纯文本正则, raw=原始数据 */
  type: 'json' | 'html' | 'text' | 'raw'
  /** JSON 路径映射（type=json 时）：{ fieldName: 'json.path.to.value' } */
  jsonPaths?: Record<string, string>
  /** HTML 选择器映射（type=html 时）：{ fieldName: 'CSS selector' } */
  htmlSelectors?: Record<string, string>
  /** 正则表达式映射（type=text 时）：{ fieldName: 'regex pattern with group' } */
  regexPatterns?: Record<string, string>
  /** 字段类型映射：{ fieldName: 'text' | 'longtext' | 'tags' | 'link' | 'sequence' } */
  fieldTypes?: Record<string, FieldDefinition['type'] | 'sequence'>
}

/** 缓存策略 */
export interface CacheConfig {
  /** 缓存有效期（毫秒），默认 24 小时 */
  ttl?: number
  /** 是否持久化到本地数据库，默认 true */
  persist?: boolean
  /** 更新触发条件：on_demand=按需更新, periodic=定期更新, manual=仅手动 */
  updateStrategy?: 'on_demand' | 'periodic' | 'manual'
}

/** 限速策略 */
export interface RateLimitConfig {
  /** 请求间隔（毫秒），默认 500ms */
  interval?: number
  /** 最大并发请求数，默认 3 */
  maxConcurrent?: number
  /** API Key 配置键名（从 app_settings 中读取） */
  apiKeySetting?: string
  /** 每日请求上限 */
  dailyLimit?: number
}

/** 字段在界面上的显示位置 */
export type FieldDisplayLocation = 'tab' | 'gene_aliases' | 'gene_accession' | 'gene_chinese_name' | 'gene_description' | 'hidden'

export interface FieldDefinition {
  name: string
  label: string
  type: 'text' | 'link' | 'tags' | 'longtext' | 'sequence'
  description?: string
  /** 字段显示位置：tab=物种标签页内(默认), gene_aliases=基因主页别名区, gene_description=基因主页描述区, hidden=隐藏 */
  displayLocation?: FieldDisplayLocation
  /** 在主界面中显示该字段时的中文标签（覆盖 label） */
  displayLabel?: string
}

/** 物种插件（数据库记录） */
export interface SpeciesPlugin {
  id: number
  species_name: string
  species_latin: string
  package_name: string
  version: string
  data_file: string
  fields_config: string
  url_templates: string
  enabled: boolean
  installed_at: string
  updated_at: string
  /** 插件运行模式 */
  mode?: PluginMode
  /** 在线数据源配置（JSON 字符串） */
  online_sources_config?: string
  annotation_count?: number     // 注释总数（运行时计算）
  annotation_matched?: number   // 已匹配的注释数（运行时计算）
}

/** 物种基因注释（数据库记录） */
export interface SpeciesGeneAnnotation {
  id: number
  plugin_id: number
  gene_id: number | null
  source_database: string
  source_accession: string
  ncbi_gene_id: string
  gene_symbol: string
  gene_name: string
  annotation_data: string
  external_links: string
  created_at: string
  /** 数据来源：csv_import=CSV导入, online_fetch=在线获取 */
  source_type?: 'csv_import' | 'online_fetch'
  /** 缓存过期时间（在线获取数据使用） */
  cache_expires_at?: string
}

/** 在线数据获取请求上下文 */
export interface OnlineFetchRequest {
  /** 基因 ID（本地数据库 ID） */
  geneId: number
  /** NCBI Gene ID */
  ncbiGeneId?: string
  /** 基因符号 */
  geneSymbol?: string
  /** 需要获取的在线数据源 ID 列表 */
  sourceIds: string[]
  /** 是否强制刷新缓存 */
  forceRefresh?: boolean
}

/** 在线数据获取响应 */
export interface OnlineFetchResponse {
  /** 数据源 ID */
  sourceId: string
  /** 获取是否成功 */
  success: boolean
  /** 错误信息 */
  error?: string
  /** 获取到的注释数据 */
  annotations?: Partial<SpeciesGeneAnnotation>[]
  /** 获取耗时（毫秒） */
  fetchDuration?: number
}

/** 插件扩展钩子接口（主系统提供，插件可注册回调） */
export interface PluginHooks {
  /** NCBI 导入完成后触发，传入新导入的基因信息 */
  onNcbiImportComplete?: (gene: GeneSequence) => Promise<void>
  /** 基因详情面板加载时触发，插件可注册自定义标签页 */
  onGeneDetailLoad?: (geneId: number) => Promise<PluginTabData[]>
  /** 序列编辑器打开时触发，插件可提供额外序列数据 */
  onSequenceEditorOpen?: (geneId: number) => Promise<PluginSequenceData | null>
}

/** 插件注册的标签页数据 */
export interface PluginTabData {
  /** 标签页标题 */
  title: string
  /** 标签页标识（唯一） */
  id: string
  /** 数据源名称 */
  sourceName: string
  /** 注释内容 */
  annotations: SpeciesGeneAnnotation[]
  /** 是否正在加载 */
  loading?: boolean
  /** 错误信息 */
  error?: string
}

/** 插件提供的序列数据 */
export interface PluginSequenceData {
  /** 序列类型 */
  type: 'genomic' | 'mRNA' | 'protein'
  /** 序列内容 */
  sequence: string
  /** 序列来源描述 */
  source: string
  /** 序列上的 features */
  features?: any[]
}

/** 基因详情聚合对象（含转录本+交叉引用） */
export interface GeneWithDetails extends GeneSequence {
  transcripts: GeneTranscript[]
  cross_refs: GeneCrossRef[]
}

/** NCBI 导入进度回调 */
export interface NCBImportProgress {
  stage: 'fetching-metadata' | 'downloading-sequence' | 'parsing' | 'saving' | 'done' | 'error'
  message: string
  percent: number
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

// ============ 文字样式精细控制 ============
export interface TextStyle {
  fontFamily: 'sans-serif' | 'serif' | 'monospace'
  fontSize: number
  fontWeight: 'normal' | 'bold'
  fontStyle: 'normal' | 'italic'
}

export type TextStyles = Record<string, TextStyle>

export const DEFAULT_TEXT_STYLES: TextStyles = {
  feature:  { fontFamily: 'sans-serif', fontSize: 10, fontWeight: 'normal', fontStyle: 'normal' },
  enzyme:   { fontFamily: 'sans-serif', fontSize: 7,  fontWeight: 'normal', fontStyle: 'normal' },
  primer:   { fontFamily: 'sans-serif', fontSize: 7,  fontWeight: 'normal', fontStyle: 'normal' },
  ruler:    { fontFamily: 'sans-serif', fontSize: 7,  fontWeight: 'normal', fontStyle: 'normal' },
  title:    { fontFamily: 'sans-serif', fontSize: 14, fontWeight: 'bold',   fontStyle: 'normal' },
  legend:   { fontFamily: 'sans-serif', fontSize: 10, fontWeight: 'normal', fontStyle: 'normal' },
}

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
  ENZYME_UPDATE_LIBRARY: 'db:enzyme:update-library',

  // 载体
  VECTOR_LIST: 'db:vector:list',
  VECTOR_GET: 'db:vector:get',
  VECTOR_CREATE: 'db:vector:create',
  VECTOR_UPDATE: 'db:vector:update',
  VECTOR_DELETE: 'db:vector:delete',
  VECTOR_ENZYME_SITES: 'db:vector:enzyme-sites',
  VECTOR_IMPORT: 'db:vector:import',
  VECTOR_BATCH_EXPORT: 'db:vector:batch-export',

  // 基因序列
  GENE_LIST: 'db:gene:list',
  GENE_GET: 'db:gene:get',
  GENE_CREATE: 'db:gene:create',
  GENE_UPDATE: 'db:gene:update',
  GENE_DELETE: 'db:gene:delete',
  GENE_SEARCH: 'db:gene:search',
  GENE_RELATIONS: 'db:gene:relations',
  GENE_GET_DETAILS: 'db:gene:get-details',
  GENE_TRANSCRIPTS: 'db:gene:transcripts',
  GENE_CROSS_REFS: 'db:gene:cross-refs',
  GENE_IMPORT_NCBI: 'db:gene:import-ncbi',
  GENE_SEARCH_SYMBOL: 'db:gene:search-symbol',
  GENE_EXPORT: 'db:gene:export',

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
  EDITOR_SAVE_FEATURES: 'editor:save-features',
  EDITOR_SET_DIRTY: 'editor:set-dirty',

  // 菜单操作
  MENU_ACTION: 'menu:action',
  MENU_SET_LANGUAGE: 'menu:set-language',

  // 文件操作（新增）
  FILE_SAVE_GENBANK: 'file:save-genbank',
  FILE_EXPORT_GENBANK_DATA: 'file:export-genbank-data',
  PROTEIN_IMPORT_FASTA: 'protein:import-fasta',
  PROTEIN_EDITOR_GET_DATA: 'protein:editor-get-data',
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
  GENE_EDITOR_OPEN_TRANSCRIPT: 'gene-editor:open-transcript',
  GENE_EDITOR_GET_DATA: 'gene-editor:get-data',
  GENE_EDITOR_SAVE_SEQUENCE: 'gene-editor:save-sequence',
  GENE_GET_RELATED_SEQUENCES: 'gene:get-related-sequences',
  GENE_RELATED_SEQ_OPEN_EDITOR: 'gene:related-seq-open-editor',
  GENE_RELATED_SEQ_GET_DATA: 'gene:related-seq-get-data',

  // 实验室载体文件导入
  LAB_VECTOR_IMPORT_FILE: 'db:lab-vector:import-file',

  // 数据库备份/恢复
  DB_BACKUP: 'db:backup',
  DB_RESTORE: 'db:restore',
  DB_AUTO_BACKUP: 'db:auto-backup',

  // 载体元件数据库
  COMPONENT_LIST: 'db:component:list',
  COMPONENT_GET: 'db:component:get',
  COMPONENT_CREATE: 'db:component:create',
  COMPONENT_UPDATE: 'db:component:update',
  COMPONENT_DELETE: 'db:component:delete',
  COMPONENT_SEARCH: 'db:component:search',
  COMPONENT_SCAN_VECTOR: 'db:component:scan-vector',
  COMPONENT_BATCH_IMPORT_FEATURES: 'db:component:batch-import-features',
  COMPONENT_BATCH_IMPORT_PREVIEW: 'db:component:batch-import-preview',
  COMPONENT_BATCH_IMPORT_EXECUTE: 'db:component:batch-import-execute',
  COMPONENT_SPECIES_LIST: 'db:component:species-list',
  COMPONENT_BACKFILL_SPECIES: 'db:component:backfill-species',
  COMPONENT_SYNC_NORMALIZATION: 'db:component:sync-normalization',
  COMPONENT_IDENTIFY_FEATURE: 'db:component:identify-feature',
  COMPONENT_DEDUPLICATE: 'db:component:deduplicate',
  COMPONENT_PURGE_SEED_DATA: 'db:component:purge-seed-data',
  COMPONENT_GET_VARIANTS: 'db:component:get-variants',
  COMPONENT_BATCH_DELETE: 'db:component:batch-delete',
  COMPONENT_MERGE_VARIANTS: 'db:component:merge-variants',
  COMPONENT_IMPORT_FILE: 'db:component:import-file',
  COMPONENT_EXPORT_JSON: 'db:component:export-json',
  COMPONENT_IMPORT_JSON: 'db:component:import-json',
  COMPONENT_AUTO_ANNOTATE: 'db:component:auto-annotate',
  COMPONENT_SMART_ANNOTATE: 'db:component:smart-annotate',
  COMPONENT_GET_SNAPSHOT: 'db:component:get-snapshot',

  // 调试与诊断
  DEBUG_GET_LOGS: 'debug:get-logs',
  DEBUG_EXPORT_LOGS: 'debug:export-logs',
  DEBUG_OPEN_LOG_FOLDER: 'debug:open-log-folder',
  DEBUG_GET_SYSTEM_STATUS: 'debug:get-system-status',
  LOG_FROM_RENDERER: 'debug:log-from-renderer',
  DEBUG_TOGGLE_PANEL: 'debug:toggle-panel',

  // 系统
  OPEN_EXTERNAL: 'system:open-external',

  // 应用设置
  SETTINGS_GET: 'app:settings:get',
  SETTINGS_SET: 'app:settings:set',

  // 物种基因数据库插件
  SPECIES_PLUGIN_LIST: 'species:plugin:list',
  SPECIES_PLUGIN_INSTALL: 'species:plugin:install',
  SPECIES_PLUGIN_UNINSTALL: 'species:plugin:uninstall',
  SPECIES_PLUGIN_TOGGLE: 'species:plugin:toggle',
  SPECIES_PLUGIN_IMPORT_DATA: 'species:plugin:import-data',
  SPECIES_PLUGIN_EXPORT: 'species:plugin:export',
  SPECIES_PLUGIN_PROGRESS: 'species:plugin:progress',
  SPECIES_GET_ANNOTATIONS: 'species:get-annotations',
  SPECIES_FETCH_MSU_INFO: 'species:fetch-msu-info',
  SPECIES_FETCH_MSU_SEQUENCES: 'species:fetch-msu-sequences',
  SPECIES_FETCH_RICEDATA_INFO: 'species:fetch-ricedata-info',
  SPECIES_UPDATE_RICEDATA: 'species:update-ricedata',
  SPECIES_CACHE_MSU_INFO: 'species:cache-msu-info',
  SPECIES_FETCH_RAPDB_INFO: 'species:fetch-rapdb-info',
  SPECIES_FETCH_RAPDB_TRANSCRIPT: 'species:fetch-rapdb-transcript',
  SPECIES_FETCH_RAPDB_EXPRESSION: 'species:fetch-rapdb-expression',
  SPECIES_FETCH_RAPDB_EXPRESSION_IMAGES: 'species:fetch-rapdb-expression-images',
  SPECIES_SAVE_RAPDB_GENBANK: 'species:save-rapdb-genbank',
  SPECIES_SAVE_RAPDB_FASTA: 'species:save-rapdb-fasta',
  SPECIES_CACHE_RAPDB_INFO: 'species:cache-rapdb-info',
  SPECIES_CACHE_RAPDB_EXPRESSION: 'species:cache-rapdb-expression',
  SPECIES_SEARCH_ANNOTATIONS: 'species:search-annotations',
  SPECIES_CREATE_GENE_FROM_ANNOTATION: 'species:create-gene-from-annotation',
    GENE_REGENERATE_HTML: 'gene:regenerate-html',
  GENE_EXPORT_PACKAGE: 'gene:export-package',
  GENE_IMPORT_PACKAGE: 'gene:import-package',
  SPECIES_FETCH_ALL_RAPDB_EXPRESSION: 'species:fetch-all-rapdb-expression'
} as const
