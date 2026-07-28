# RAP-DB 数据解析技术文档

## 1. 网站架构

RAP-DB (https://rapdb.dna.naro.go.jp) 是 **React SPA** 应用：
- 所有页面（locus/transcript/expression）均为 `<div id="root"></div>` + JS 客户端渲染
- **无法通过 HTTP GET 直接抓取 HTML 内容**
- 实际数据通过 JSON API 获取

## 2. API 端点

| 端点 | 用途 | 参数 |
|------|------|------|
| `/tools/Feature?name={locus}` | 基因座完整数据（序列+坐标+注释） | locus 名如 `Os03g0700400` |
| `/tools/Expression?id={locus}&rxp={rxpId}` | RiceXPro 表达数据 | locus + RXP 实验 ID |

### 不可用的端点（已验证 404）

- `/tools/Transcript?name=` — 404
- `/tools/Sequence?name=` — 404
- `/tools/Fasta?name=` — 404
- `/tools/CDS?name=` — 404
- `/tools/Protein?name=` — 404
- `/tools/Feature?name={transcript_id}` — 返回空 JSON `{}`（不支持 transcript 级别查询）

## 3. Feature API 响应结构

```json
{
  "locus_name": "Os03g0700400",
  "locus_title": "Lipoxygenase-3",
  "seqid": "chr03",
  "start_pos": 28090066,
  "end_pos": 28094467,
  "strand": "+",
  "sequence": "ATGCTGGG...(基因组序列，含内含子)",
  "transcripts_feature": [
    { "transcript_name": "Os03t0700400-01", "type": "mRNA", "start_pos": ..., "end_pos": ... },
    { "transcript_name": "Os03t0700400-01", "type": "CDS", "start_pos": ..., "end_pos": ..., "phase": 0 },
    ...
  ],
  "transcripts_attributes": [
    {
      "ID": "Os03t0700400-01",
      "Name": "Os03t0700400-01",
      "CGSNL Gene Symbol": "LOX3",
      "CGSNL Gene Name": "LIPOXYGENASE 3",
      "Oryzabase Gene Name Synonym(s)": "...",
      "Oryzabase Gene Symbol Synonym(s)": "...",
      "RAP-DB Gene Name Synonym(s)": "...",
      "RAP-DB Gene Symbol Synonym(s)": "...",
      "Note": "Lipoxygenase-3, Generation of stale flavor",
      "InterPro": ["Lipoxygenase (IPR000907)", ...],
      "GO": ["Biological Process: lipid oxidation (GO:0034440)", ...],
      "Literature_PMID": "DOI:10.1270/jsbbs.58.169",
      "Oryzabase": "182",
      "ORF_evidence": "Q7G794",
      "Transcript_evidence": "Inferred from literature",
      "Manual Curation": "May 16, 2018"
    }
  ]
}
```

## 4. 坐标系统（关键！）

**RAP-DB API 坐标为 1-based inclusive**（包含两端碱基）。

```
start_pos = 28090066, end_pos = 28090255
→ 实际碱基数 = end_pos - start_pos + 1 = 190 bp
→ sequence.substring(start_pos - locusStart, end_pos - locusStart + 1)
```

### 常见错误

```typescript
// ❌ 错误：按 0-based half-open 处理（每个外显子少 1bp）
sequence.substring(f.start_pos - startPos, f.end_pos - startPos)

// ✅ 正确：1-based inclusive
sequence.substring(f.start_pos - startPos, f.end_pos - startPos + 1)
```

**后果**：9 个外显子各少 1bp → CDS 少 9bp → 阅读框移位 → 蛋白翻译提前终止（80aa vs 正确 866aa）

## 5. 序列推导逻辑

RAP-DB 原站 transcript 页面（`transcript.*.js`）也使用完全相同的推导逻辑：

```
1. mRNA = 所有外显子序列拼接（当前 API 无独立 exon feature，CDS 段即外显子）
2. CDS = 所有 type="CDS" 的 feature 序列拼接
3. Protein = 翻译 CDS（标准遗传密码，遇终止密码子停止）
```

对于无 UTR 的基因：mRNA = CDS（长度相同）。

### 推导代码

```typescript
// 按 transcript_name 分组
for (const [variantId, group] of variantMap) {
  // CDS: 拼接所有 CDS 外显子（1-based inclusive +1）
  const cdsParts: string[] = []
  for (const cdsFeat of group.cds) {
    const relStart = cdsFeat.start_pos - startPos
    const relEnd = cdsFeat.end_pos - startPos + 1  // ← 关键 +1
    cdsParts.push(sequence.substring(relStart, relEnd))
  }
  const cds = cdsParts.join('')
  const mrna = cds  // 无 UTR 时 mRNA = CDS

  // Protein: 标准遗传密码翻译
  let protein = ''
  for (let i = 0; i + 2 < cds.length; i += 3) {
    const aa = codonTable[cds.substring(i, i+3).toUpperCase()] || 'X'
    if (aa === '*') break
    protein += aa
  }
}
```

## 6. 外部链接

| 用途 | URL |
|------|-----|
| 用户浏览（原站） | `https://rapdb.dna.naro.go.jp/locus/?name={accession}` |
| Transcript 详情 | `https://rapdb.dna.naro.go.jp/transcript/?name={variant_id}` |
| Oryzabase | `http://www.shigen.nig.ac.jp/rice/oryzabaseV4/gene/detail/{oryzabase_id}` |

## 7. 缓存字段

| 字段名 | 内容 |
|--------|------|
| `rapdb_locus_title` | 基因名称 |
| `rapdb_seqid` / `rapdb_start_pos` / `rapdb_end_pos` / `rapdb_strand` | 位置信息 |
| `rapdb_sequence` | 基因组序列 |
| `rapdb_exons` | 外显子坐标 JSON |
| `rapdb_transcripts` | 转录本元数据 JSON |
| `rapdb_oryzabase` | Oryzabase 完整信息 JSON |
| `rapdb_transcript_variants` | 转录本序列 JSON（mRNA/CDS/Protein） |
| `rapdb_expression_categories` | RiceXPro 图谱 URL JSON |
| `rapdb_expression_{rxpId}` | 单个图表型实验数值 |
| `rapdb_fetched_at` / `rapdb_updated_at` | 时间戳 |

## 8. 验证基准（Os03g0700400 / Os03t0700400-01）

| 序列 | 正确长度 |
|------|---------|
| Genomic | 4401 bp |
| mRNA | 2601 bp |
| CDS | 2601 bp |
| Protein | 866 aa |
