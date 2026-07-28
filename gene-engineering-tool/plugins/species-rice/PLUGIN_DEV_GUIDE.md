# 物种基因数据库插件开发指南

## 概述

物种基因数据库插件系统允许为 HelixCraft 基因序列数据库模块添加物种特异性的注释数据。插件支持三种运行模式，满足不同数据获取场景。

## 插件运行模式

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `offline` | 预存数据型：插件包内捆绑 CSV 等数据文件，安装时导入本地数据库 | 稳定的、不频繁更新的注释数据 |
| `online` | 在线获取型：插件不包含预存数据，通过 API/网页实时获取数据 | 需要实时获取最新数据、数据量巨大无法预存 |
| `hybrid` | 混合型：同时包含预存数据和在线获取能力 | 预存基础数据 + 在线获取更新/补充数据 |

## 插件目录结构

```
plugins/species-<name>/
├── package.json          # npm 包元数据（必需）
├── plugin.json           # 插件规范配置（必需）
├── data/                 # 数据文件目录
│   └── <data>.csv        # CSV 数据文件（必需）
└── src/                  # 源代码（可选）
    ├── index.ts          # 插件入口
    └── ...
```

### package.json

```json
{
  "name": "@helixcraft/species-rice",
  "version": "1.0.0",
  "description": "HelixCraft 水稻基因数据库增强插件",
  "main": "plugin.json",
  "keywords": ["helixcraft", "species-plugin", "rice"],
  "author": "Your Name",
  "license": "MIT"
}
```

### plugin.json（核心配置文件）

```json
{
  "name": "species-rice",
  "speciesName": "水稻",
  "speciesLatin": "Oryza sativa",
  "version": "1.0.0",
  "description": "水稻基因数据库增强插件",
  "mode": "offline",
  "dataSources": [...],
  "fieldDefinitions": [...],
  "urlTemplates": {...}
}
```

## plugin.json 详细规范

### 顶层字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 插件唯一标识符 |
| `speciesName` | string | ✅ | 物种中文名 |
| `speciesLatin` | string | ❌ | 物种拉丁学名 |
| `version` | string | ✅ | 语义化版本号 |
| `description` | string | ❌ | 插件描述 |
| `mode` | string | ✅ | 插件运行模式：`offline` / `online` / `hybrid` |
| `dataSources` | DataSourceConfig[] | 条件 | 预存数据源配置（mode=offline 或 hybrid 时必需） |
| `fieldDefinitions` | FieldDefinition[] | ✅ | 字段定义列表 |
| `urlTemplates` | Record<string, string> | ❌ | 外部链接 URL 模板 |
| `onlineSources` | OnlineSourceConfig[] | 条件 | 在线数据源配置（mode=online 或 hybrid 时必需） |
| `rateLimit` | RateLimitConfig | ❌ | 限速策略配置 |

### DataSourceConfig

每个数据源代表一个外部数据库（如 RAP-DB、MSU）。

```json
{
  "name": "RAP-DB",
  "keyField": "RAP_Locus",
  "csvColumn": 3,
  "ncbiColumn": 8,
  "importColumns": [
    { "csvColumn": 1, "fieldName": "gene_name", "fieldType": "text" },
    { "csvColumn": 2, "fieldName": "gene_symbol", "fieldType": "tags" }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 数据源名称（显示在标签页标题） |
| `keyField` | string | 主标识字段名（描述性名称） |
| `csvColumn` | number | CSV 中该数据源存取号所在列索引（0-based） |
| `ncbiColumn` | number | CSV 中 NCBI Gene ID 所在列索引（0-based） |
| `importColumns` | ImportColumnMapping[] | 需要导入的列映射 |

### ImportColumnMapping

```json
{ "csvColumn": 9, "fieldName": "basic_info", "fieldType": "longtext" }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `csvColumn` | number | CSV 列索引（0-based） |
| `fieldName` | string | 字段名（对应 fieldDefinitions 中的 name） |
| `fieldType` | string | 字段类型：`text` / `link` / `tags` |

- `text`：普通文本，单行显示
- `longtext`：长文本，保留换行，最大高度 256px 可滚动
- `tags`：分号分隔的标签，渲染为彩色标签组
- `link`：超链接，可点击跳转

### FieldDefinition

定义注释字段的显示属性。

```json
{ "name": "gene_name", "label": "基因名称", "type": "text" }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 字段名（对应 importColumns 的 fieldName） |
| `label` | string | 显示标签 |
| `type` | string | 渲染类型：`text` / `link` / `tags` / `longtext` |
| `description` | string | 可选的字段描述 |
| `displayLocation` | string | 字段在界面上的显示位置（见下方说明） |
| `displayLabel` | string | 在主界面中显示时的中文标签（覆盖 label） |

#### displayLocation 字段显示位置

`displayLocation` 控制字段在基因详情面板中的显示位置：

| 值 | 说明 |
|------|------|
| `tab` | 仅在物种标签页内显示（默认值） |
| `gene_aliases` | 合并到基因主页的别名区域，与用户自定义的别名一起显示 |
| `gene_description` | 显示在基因主页功能描述下方，以可折叠区块形式展示 |
| `hidden` | 不在物种标签页中显示（用于内部数据或计算字段） |

**示例**：

```json
[
  { "name": "gene_name", "label": "基因名称", "type": "text", "displayLocation": "gene_aliases", "displayLabel": "别名" },
  { "name": "gene_symbol", "label": "基因符号", "type": "tags", "displayLocation": "gene_aliases", "displayLabel": "符号" },
  { "name": "cDNAs", "label": "cDNA", "type": "text", "displayLocation": "tab" },
  { "name": "basic_info", "label": "基本信息", "type": "longtext", "displayLocation": "gene_description", "displayLabel": "基本信息" },
  { "name": "internal_id", "label": "内部ID", "type": "text", "displayLocation": "hidden" }
]
```

**最佳实践**：
- 基因符号、别名等标识性字段使用 `gene_aliases`，使其与用户自定义的别名统一展示
- 功能描述、表型信息等详细内容使用 `gene_description`，以可折叠区块展示
- 常规注释数据（如 cDNA、UniProt ID）使用 `tab`，仅在物种标签页内显示
- 内部计算字段或不需要展示的字段使用 `hidden`

### urlTemplates

外部数据库链接模板，`{accession}` 会被替换为实际存取号。

```json
{
  "RAP-DB": "https://rapdb.dna.affrc.go.jp/viewer/gbrowse_details/irgsp1?name={accession}",
  "MSU": "http://rice.uga.org/cgi-bin/ORF_infopage.cgi?orf={accession}",
  "NCBI": "https://www.ncbi.nlm.nih.gov/gene/{accession}"
}
```

## CSV 数据格式要求

1. **编码**：UTF-8（推荐）或 UTF-8 with BOM
2. **分隔符**：逗号（`,`）
3. **引号**：包含逗号或换行符的字段用双引号包裹
4. **表头**：第一行为列名
5. **NCBI Gene ID 列**：可以包含 `LOC` 前缀（导入时自动去除）

## 数据导入流程

1. CSV 按行解析
2. 对每个 `dataSource`，提取 `csvColumn` 指定的存取号
3. 如果存取号为空，跳过该数据源
4. 提取 `ncbiColumn` 指定的 NCBI Gene ID（去除 LOC 前缀）
5. 按 `importColumns` 映射提取字段值，存入 `annotation_data` JSON
6. 写入 `species_gene_annotations` 表
7. 导入完成后，自动匹配已有基因记录（通过 ncbi_gene_id）

## 插件分发格式

插件使用 `.plugin` 单文件分发，本质是 **ZIP 压缩包**，内部包含完整的插件目录结构。

### .plugin 文件内部结构

```
species-<物种名>/
├── package.json
├── plugin.json
├── data/
│   └── <data>.csv
└── ...（其他文件）
```

### 打包流程

1. 准备插件目录（包含 plugin.json、package.json、data/ 等）
2. 将整个目录压缩为 ZIP 格式
3. 将文件扩展名从 `.zip` 改为 `.plugin`
4. 分发给其他用户

> **注意**：ZIP 内的顶层目录名建议为 `species-<物种名>`，安装时会自动识别。

## 安装与调试

### 安装插件

1. 获取 `.plugin` 插件文件
2. 在 HelixCraft 设置页面 → 物种数据插件 → 点击“安装插件”
3. 选择 `.plugin` 文件
4. 系统自动解压、安装，并**自动导入 CSV 数据**
5. 如需重新导入（如数据已更新），可使用“导入数据”按钮

### 导出插件

1. 在插件卡片上点击“导出 .plugin”
2. 选择保存位置和文件名（默认为 `species-<物种名>-v<版本>.plugin`）
3. 系统将插件目录打包为 `.plugin` 文件
4. 导出的 `.plugin` 文件可直接传递给其他用户安装使用

### 调试技巧

- 查看主进程日志：`%APPDATA%\HelixCraft\logs\`
- 检查数据库：`%APPDATA%\HelixCraft\gene-engineering.db`
- 插件数据目录：`%APPDATA%\HelixCraft\species-plugins\<species_name>\`

## 示例：创建拟南芥插件

```json
{
  "name": "species-arabidopsis",
  "speciesName": "拟南芥",
  "speciesLatin": "Arabidopsis thaliana",
  "version": "1.0.0",
  "dataSources": [
    {
      "name": "TAIR",
      "keyField": "TAIR_Locus",
      "csvColumn": 0,
      "ncbiColumn": 5,
      "importColumns": [
        { "csvColumn": 1, "fieldName": "gene_name", "fieldType": "text" },
        { "csvColumn": 2, "fieldName": "gene_symbol", "fieldType": "tags" },
        { "csvColumn": 3, "fieldName": "description", "fieldType": "longtext" }
      ]
    }
  ],
  "fieldDefinitions": [
    { "name": "gene_name", "label": "基因名称", "type": "text" },
    { "name": "gene_symbol", "label": "基因符号", "type": "tags" },
    { "name": "description", "label": "功能描述", "type": "longtext" }
  ],
  "urlTemplates": {
    "TAIR": "https://www.arabidopsis.org/servlets/TairObject?accession={accession}",
    "NCBI": "https://www.ncbi.nlm.nih.gov/gene/{accession}"
  }
}
```

---

## 在线获取型插件开发

在线获取型插件不包含预存数据文件，而是通过定义数据获取方法，从互联网 API 或网页实时获取基因相关信息。

### OnlineSourceConfig 配置

每个在线数据源定义一个数据获取方法：

```json
{
  "name": "Ensembl Plants",
  "id": "ensembl_plants",
  "fetchType": "api",
  "urlTemplate": "https://rest.ensembl.org/lookup/symbol/osativa/{geneSymbol}?expand=0;content-type=application/json",
  "method": "GET",
  "headers": {
    "Content-Type": "application/json"
  },
  "responseParser": {
    "type": "json",
    "jsonPaths": {
      "gene_name": "description",
      "gene_id": "id",
      "biotype": "biotype",
      "chromosome": "seq_region_name"
    },
    "fieldTypes": {
      "gene_name": "text",
      "gene_id": "text",
      "biotype": "tags",
      "chromosome": "text"
    }
  },
  "cache": {
    "ttl": 86400000,
    "persist": true,
    "updateStrategy": "on_demand"
  },
  "triggerOn": "ncbi_import",
  "description": "从 Ensembl Plants 获取水稻基因注释"
}
```

#### OnlineSourceConfig 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 数据源名称（显示在标签页标题） |
| `id` | string | 唯一标识符（用于缓存键名） |
| `fetchType` | string | 获取类型：`api` / `web` / `genbank` / `fasta` |
| `urlTemplate` | string | URL 模板，支持动态参数替换 |
| `method` | string | HTTP 方法：`GET` / `POST` |
| `headers` | object | 请求头 |
| `bodyTemplate` | string | POST 请求体模板 |
| `responseParser` | object | 响应解析规则 |
| `cache` | object | 缓存策略 |
| `triggerOn` | string | 触发时机：`ncbi_import` / `manual` / `both` |

#### URL 模板动态参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `{accession}` | 数据存取号 | Os01g0100100 |
| `{geneId}` | 本地数据库基因 ID | 42 |
| `{ncbiGeneId}` | NCBI Gene ID | LOC4327046 |
| `{geneSymbol}` | 基因符号 | Os01g0100100 |
| `{species}` | 物种名 | rice |

#### ResponseParserConfig 响应解析规则

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string | 解析类型：`json` / `html` / `text` / `raw` |
| `jsonPaths` | object | JSON 路径映射（`{ fieldName: 'json.path.to.value' }`） |
| `htmlSelectors` | object | CSS 选择器映射（`{ fieldName: 'CSS selector' }`） |
| `regexPatterns` | object | 正则表达式映射（`{ fieldName: 'regex with (group)' }`） |
| `fieldTypes` | object | 字段类型映射 |

#### CacheConfig 缓存策略

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `ttl` | number | 86400000 (24h) | 缓存有效期（毫秒） |
| `persist` | boolean | true | 是否持久化到本地数据库 |
| `updateStrategy` | string | on_demand | 更新触发：`on_demand` / `periodic` / `manual` |

### RateLimitConfig 限速策略

```json
{
  "interval": 500,
  "maxConcurrent": 3,
  "apiKeySetting": "ensembl_api_key",
  "dailyLimit": 1000
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `interval` | number | 500 | 请求间隔（毫秒） |
| `maxConcurrent` | number | 3 | 最大并发请求数 |
| `apiKeySetting` | string | - | API Key 配置键名（从 app_settings 读取） |
| `dailyLimit` | number | - | 每日请求上限 |

---

## 主系统集成接口

主系统为插件提供以下扩展点和钩子接口：

### 1. 基因详情面板标签页注册

在线型插件可以在基因详情面板中注册自定义标签页。当用户选中一个基因时，系统自动触发已注册的在线数据源获取。

**触发流程**：
1. 用户在基因序列库页面选中一个基因
2. 右侧详情面板加载 NCBI 标签页
3. 系统检查启用的插件中是否有 `triggerOn: 'ncbi_import'` 的在线源
4. 异步获取在线数据，加载完成后显示对应标签页
5. 如果缓存未过期，直接使用缓存数据

### 2. NCBI 导入钩子

当用户通过 NCBI Gene ID 导入基因时，系统自动触发在线数据获取：

**触发流程**：
1. NCBI 导入完成，基因记录写入数据库
2. 系统遍历所有启用的混合/在线型插件
3. 对每个 `triggerOn: 'ncbi_import'` 或 `'both'` 的在线源
4. 使用新导入基因的 `ncbiGeneId` 和 `geneSymbol` 填充 URL 模板
5. 发起 HTTP 请求，解析响应，写入 `species_gene_annotations` 表
6. 基因详情面板自动显示新的标签页

### 3. 序列编辑器扩展

在线型插件可以为序列编辑器提供额外的序列数据：

- **基因组序列**：从在线数据库下载完整基因组序列
- **mRNA 序列**：从 RefSeq/GenBank 下载转录本序列
- **蛋白质序列**：从 UniProt 下载蛋白质序列

获取到的序列数据可传递给序列编辑器/图谱查看器进行可视化。

### 4. TypeScript 接口定义

```typescript
// 在线数据获取请求
interface OnlineFetchRequest {
  geneId: number           // 本地数据库基因 ID
  ncbiGeneId?: string      // NCBI Gene ID
  geneSymbol?: string      // 基因符号
  sourceIds: string[]      // 需要获取的在线源 ID 列表
  forceRefresh?: boolean   // 是否强制刷新缓存
}

// 在线数据获取响应
interface OnlineFetchResponse {
  sourceId: string
  success: boolean
  error?: string
  annotations?: Partial<SpeciesGeneAnnotation>[]
  fetchDuration?: number
}

// 插件扩展钩子
interface PluginHooks {
  onNcbiImportComplete?: (gene: GeneSequence) => Promise<void>
  onGeneDetailLoad?: (geneId: number) => Promise<PluginTabData[]>
  onSequenceEditorOpen?: (geneId: number) => Promise<PluginSequenceData | null>
}
```

---

## 在线型插件示例：从 Ensembl Plants 获取水稻基因注释

```json
{
  "name": "species-rice-online",
  "speciesName": "水稻",
  "speciesLatin": "Oryza sativa",
  "version": "1.0.0",
  "description": "水稻基因在线注释插件，从 Ensembl Plants 实时获取数据",
  "mode": "online",
  "onlineSources": [
    {
      "name": "Ensembl Plants",
      "id": "ensembl_plants",
      "fetchType": "api",
      "urlTemplate": "https://rest.ensembl.org/lookup/symbol/osativa/{geneSymbol}?expand=0;content-type=application/json",
      "method": "GET",
      "headers": { "Content-Type": "application/json" },
      "responseParser": {
        "type": "json",
        "jsonPaths": {
          "gene_name": "description",
          "ensembl_id": "id",
          "biotype": "biotype",
          "chromosome": "seq_region_name",
          "start": "start",
          "end": "end",
          "strand": "strand"
        },
        "fieldTypes": {
          "gene_name": "text",
          "ensembl_id": "text",
          "biotype": "tags",
          "chromosome": "text",
          "start": "text",
          "end": "text",
          "strand": "text"
        }
      },
      "cache": {
        "ttl": 86400000,
        "persist": true,
        "updateStrategy": "on_demand"
      },
      "triggerOn": "ncbi_import",
      "description": "Ensembl Plants REST API 水稻基因注释"
    }
  ],
  "fieldDefinitions": [
    { "name": "gene_name", "label": "基因名称", "type": "text" },
    { "name": "ensembl_id", "label": "Ensembl ID", "type": "text" },
    { "name": "biotype", "label": "生物类型", "type": "tags" },
    { "name": "chromosome", "label": "染色体", "type": "text" },
    { "name": "start", "label": "起始位置", "type": "text" },
    { "name": "end", "label": "结束位置", "type": "text" },
    { "name": "strand", "label": "链方向", "type": "text" }
  ],
  "urlTemplates": {
    "Ensembl": "https://plants.ensembl.org/Oryza_sativa/Gene/Summary?g={accession}",
    "NCBI": "https://www.ncbi.nlm.nih.gov/gene/{accession}"
  },
  "rateLimit": {
    "interval": 333,
    "maxConcurrent": 3,
    "dailyLimit": 5000
  }
}
```

---

## 混合型插件示例：预存 RAP-DB + 在线 Ensembl

混合型插件同时包含预存数据和在线获取能力：

```json
{
  "name": "species-rice-hybrid",
  "speciesName": "水稻",
  "speciesLatin": "Oryza sativa",
  "version": "1.0.0",
  "description": "水稻基因混合型插件：预存 RAP-DB 注释 + 在线 Ensembl 更新",
  "mode": "hybrid",
  "dataSources": [
    {
      "name": "RAP-DB",
      "keyField": "RAP_Locus",
      "csvColumn": 3,
      "ncbiColumn": 8,
      "importColumns": [
        { "csvColumn": 1, "fieldName": "gene_name", "fieldType": "text" },
        { "csvColumn": 2, "fieldName": "gene_symbol", "fieldType": "tags" }
      ]
    }
  ],
  "onlineSources": [
    {
      "name": "Ensembl Plants",
      "id": "ensembl_plants",
      "fetchType": "api",
      "urlTemplate": "https://rest.ensembl.org/lookup/symbol/osativa/{geneSymbol}?expand=0;content-type=application/json",
      "method": "GET",
      "headers": { "Content-Type": "application/json" },
      "responseParser": {
        "type": "json",
        "jsonPaths": { "gene_name": "description", "biotype": "biotype" },
        "fieldTypes": { "gene_name": "text", "biotype": "tags" }
      },
      "cache": { "ttl": 86400000, "persist": true },
      "triggerOn": "ncbi_import"
    }
  ],
  "fieldDefinitions": [
    { "name": "gene_name", "label": "基因名称", "type": "text" },
    { "name": "gene_symbol", "label": "基因符号", "type": "tags" },
    { "name": "biotype", "label": "生物类型", "type": "tags" }
  ],
  "urlTemplates": {
    "RAP-DB": "https://rapdb.dna.affrc.go.jp/viewer/gbrowse_details/irgsp1?name={accession}",
    "Ensembl": "https://plants.ensembl.org/Oryza_sativa/Gene/Summary?g={accession}"
  }
}
```
