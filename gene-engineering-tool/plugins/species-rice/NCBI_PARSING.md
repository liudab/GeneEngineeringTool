# NCBI 数据解析技术文档

## 1. 架构概述

NCBI 数据获取通过 **E-utilities REST API** 实现：
- 纯 JSON API，无需 HTML 解析
- 需要速率限制（无 API Key: 3次/秒，有 Key: 10次/秒）
- 导入流程为多步骤异步操作（元数据→转录本→序列→外显子→交叉引用→插件匹配）

## 2. API 端点

| 端点 | 用途 |
|------|------|
| `eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=gene&id={geneId}` | 基因元数据（名称、物种、染色体、坐标） |
| `eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nucleotide&id={accession}` | mRNA 序列（GenBank 格式） |
| `eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=protein&id={proteinId}` | 蛋白质序列（FASTA 格式） |
| `eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi` | 相关序列链接（Gene → nuccore） |

## 3. 导入流程（importGeneFromNCBI）

```
1. fetchGeneSummary(geneId) → 元数据（名称/物种/染色体/坐标/链方向）
2. 检查是否已存在（findGeneByNcbiId）→ 决定创建/更新
3. 采集相关序列（elink → nuccore  accession 列表）
4. 创建/更新 gene_sequences 记录
5. 对每个 mRNA accession：
   a. efetch 获取 GenBank 格式 mRNA
   b. 解析序列、CDS feature、外显子结构
   c. 获取蛋白序列（若有 protein ID）
   d. 创建 gene_transcripts + gene_exons
   e. 创建交叉引用（NCBI-RefSeq / NCBI-Protein）
6. 匹配物种插件注释（getAnnotationsByNcbiId → linkAnnotationToGene）
```

## 4. 坐标系统（关键！）

### 4.1 NCBI esummary 坐标

- `chrstart` / `chrstop`：**0-based interbase** 坐标
- 正向链：chrstart < chrstop
- 反向链：chrstart > chrstop

### 4.2 Strand 判断（踩坑！）

```typescript
// NCBI 对某些基因不返回 strand 字段（如 LOC4327046）
const strandField = genomicInfo.strand  // 可能为空字符串！
let isMinusStrand = strandField === 'minus'
if (!strandField || strandField === '') {
  // strand 缺失，用坐标方向推断
  isMinusStrand = chrstart0 > chrstop0
}
```

**规则**：
- `strand === 'minus'` → 反向链
- `strand` 为空 + `chrstart > chrstop` → 反向链（可靠推断）
- 必须用**值比较**（`=== 'minus'`），不能用存在性判断（`if (strand)`）

### 4.3 GenBank mRNA 坐标

- mRNA GenBank 的 feature 坐标是 **mRNA 局部坐标**（1-based）
- 不是基因组坐标
- CDS `join()` 中的各段是相对于 mRNA 序列的

## 5. 关键解析逻辑

### 5.1 基因名称（踩坑！）

```typescript
// ❌ 错误：nomenclature_symbol 可能返回染色体存取号（如 NC_029256.1）
gene_symbol = data.nomenclature?.symbol

// ✅ 正确：优先使用 description，回退到 name
gene_name = data.description || data.name
```

### 5.2 mRNA GenBank 解析

从 efetch 返回的 GenBank 文本中解析：
- 序列（ORIGIN 区块）
- CDS feature（可能是 `join()` 或简单范围）
- 外显子推断（从 mRNA join() 或 CDS join()）

### 5.3 外显子推断（inferExonIntronFeatures）

NCBI RefSeq GenBank 通常无显式 exon/intron 标注，需从 `join()` 推断：
```
mRNA  join(1..200,500..800,1000..1200)  → 3 个外显子
CDS   join(50..200,500..750)            → CDS 外显子（mRNA 外显子子集）
```

**4种情况**（按优先级）：
1. 显式 `exon` features
2. mRNA 的 `join()` 位置
3. CDS 的 `join()` 位置
4. 简单范围 CDS（单外显子基因）→ 推断 5'UTR + 编码区 + 3'UTR

### 5.4 填空式更新（不覆盖用户数据）

重复导入同一基因时，只补充缺失字段：
```typescript
const updateData = {}
if (!existingGene.gene_symbol) updateData.gene_symbol = newSymbol
if (!existingGene.chromosome) updateData.chromosome = newChr
// 不覆盖已有数据
```

## 6. 速率限制

```typescript
const RATE_LIMIT_NO_KEY = 334  // ms between requests (3/sec)
const RATE_LIMIT_WITH_KEY = 100  // ms (10/sec)
```

每次 API 调用前 `await rateLimit(apiKey)` 等待。

## 7. 超时配置

| 操作 | 超时 |
|------|------|
| importGeneFromNCBI（前端调用） | 120s |
| createGeneFromAnnotation（含 NCBI 导入） | 180s |
| 单次 efetch/esummary | 默认 30s |

## 8. 物种插件匹配

导入完成后自动匹配物种插件注释：
```typescript
const annotations = speciesRepo.getAnnotationsByNcbiId(geneId, plugin.id)
// 多格式兼容：纯数字 / LOC前缀 / LOC_前缀
for (const ann of annotations) {
  if (!ann.gene_id) speciesRepo.linkAnnotationToGene(ann.id, geneSeqId)
}
```

## 9. 数据存储

| 表 | 内容 |
|----|------|
| `gene_sequences` | 基因主记录（名称/物种/染色体/坐标/链方向/ncbi_gene_id） |
| `gene_transcripts` | 转录本（mRNA/CDS/蛋白序列、外显子数） |
| `gene_exons` | 外显子坐标 |
| `gene_cross_refs` | 交叉引用（NCBI Gene/RefSeq/Protein） |
| `gene_related_sequences` | 相关序列（其他 mRNA 变体） |

## 10. 外部链接

| 用途 | URL |
|------|-----|
| Gene 详情 | `https://www.ncbi.nlm.nih.gov/gene/{geneId}` |
| 核苷酸序列 | `https://www.ncbi.nlm.nih.gov/nuccore/{accession}` |
| 蛋白质 | `https://www.ncbi.nlm.nih.gov/protein/{proteinId}` |
