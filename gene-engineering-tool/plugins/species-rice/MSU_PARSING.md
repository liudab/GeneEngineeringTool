# MSU 数据解析技术文档

## 1. 网站架构

MSU Rice Genome Annotation Project (https://rice.uga.edu) 是**传统服务端渲染**网站：
- 页面为静态 HTML，可直接通过 HTTP GET 抓取并正则解析
- 无 SPA/JS 渲染依赖
- 编码：UTF-8

## 2. 页面 URL

| 页面 | URL | 用途 |
|------|-----|------|
| 基因信息页 | `https://rice.uga.edu/cgi-bin/ORF_infopage.cgi?orf={accession}` | 基因名称、GO、共表达、RNA-Seq、剪接变体链接 |
| 序列展示页 | `https://rice.uga.edu/cgi-bin/sequence_display.cgi?orf={variant_id}` | Genomic/CDS/Protein FASTA 序列 |

## 3. 信息页解析（fetchMSUGeneInfo）

### 3.1 Gene Product Name / Locus Name

```html
<td>Gene Product Name:</td> <td>xxx</td>
<td>Locus Name:</td> <td>xxx</td>
```
正则：`/Gene Product Name:<\/td>\s*<td[^>]*>([^<]+)</i`

### 3.2 可变剪接形式（Splice Variants）

链接格式：`<a href="...ORF_infopage.cgi?orf=LOC_Os05g06280.1">...</a>`

正则：`/<a\s+href="[^"]*(?:ORF_infopage|sequence_display)\.cgi\?orf=([^"]+)"[^>]*>[^<]*<\/a>/gi`

**注意**：
- 只收集带 `.N` 后缀的变体（如 `.1`, `.2`, `.3`）
- 无变体时将当前基因本身作为唯一形式
- 变体链接可能指向 `ORF_infopage.cgi` 或 `sequence_display.cgi`（两种都需匹配）

### 3.3 Gene Ontology

```html
<tr><td>GO:0003677</td><td>molecular_function</td><td>DNA binding</td><td>IEA</td></tr>
```
正则：`/<tr[^>]*>\s*<td[^>]*>(GO:\d+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>/gi`

### 3.4 RNA-Seq TPM Expression Values

**页面结构**（关键！标题在 `<table>` 内部）：
```html
<table>
  <tr><td colspan="3" class="header">RNA-Seq TPM Expression Values</td></tr>
  <tr><th>SRA Run</th><th>Sample</th><th>TPM</th></tr>
  <tr>
    <td class="centersmall"><a href='...'>SRR10991573</a></td>
    <td class="centersmall">Seedling-Control-Rep1</td>
    <td class="centersmall">10.4891</td>
  </tr>
</table>
```

**表格定位**：`/RNA-Seq TPM Expression[\s\S]*?<\/table>/i`（从标题文本到最近 `</table>`）

**行解析**（3列：第1列含 `<a>` 链接）：
```
/<td[^>]*>\s*<a\s+href='([^']+)'[^>]*>([^<]+)<\/a>\s*<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([\d.]+)<\/td>/gi
```

**踩坑记录**：
- 标题在 table 内部而非之前，不能用 `/标题[\s\S]*?<table>/` 匹配
- 第1列含 `<a>` 标签，不能用 `[^<]+` 匹配，需用 `[\s\S]*?<\/td>` 跳过
- 非贪婪匹配防止跨越多个表格

### 3.5 Coexpression Module

正则：`/Coexpression Module Assignment[\s\S]*?<\/tr>\s*<tr>\s*<th[^>]*>Module ID<\/th>...<\/tr>([\s\S]*?)<\/table>/i`

## 4. 序列页解析（fetchMSUSequences）

### 4.1 FASTA 序列提取

页面结构：
```html
<p>Genomic Sequence</p>
<pre>>LOC_Os05g06280 genomic
ATGGCGCGG...
</pre>
```

正则：`/Genomic Sequence<\/p>\s*<pre>\s*>([^<]+)<\/pre>/i`

**关键处理**（踩坑！）：
```typescript
// ❌ 错误：直接去空白会导致 header 与序列粘连
match[1].replace(/\s+/g, '')  // → "LOC_Os05g06280genomicATGGCG..."

// ✅ 正确：先删首行 FASTA header，再去空白
match[1].replace(/^[^\n]*\n/, '').replace(/\s+/g, '').trim()
```

### 4.2 序列长度

```html
<b>Genomic sequence length: </b>11075 nucleotides
```

正则：`/Genomic sequence length:\s*<\/b>\s*(\d+)/i`

**注意**：`</b>` 与数字之间有空格，必须加 `\s*`

### 4.3 多变体获取策略

1. Genomic 序列只从第一个变体页面获取一次（所有变体共享）
2. CDS/Protein 按每个变体分别请求 `sequence_display.cgi?orf={variant_id}`
3. 每次请求间隔 300ms 避免过快
4. 单个变体获取失败不阻断其他变体

## 5. 缓存字段

| 字段名 | 内容 |
|--------|------|
| `msu_gene_product_name` | 基因产物名称 |
| `msu_locus_name` | 基因座名称 |
| `msu_go_terms` | GO 分类 JSON |
| `msu_coexpression_modules` | 共表达模块 JSON |
| `msu_splice_variants` | 剪接变体列表 JSON |
| `msu_rnaseq_tpm` | RNA-Seq TPM 数据 JSON |
| `msu_sequences` | 序列数据 JSON（genomic + transcripts[]） |

## 6. 防御性校验

- 页面有效性：`html.length < 100` 或包含 "No information available" → 抛出错误
- 每个字段解析失败 → push 到 `_parse_warnings`
- 所有序列缺失 → 追加"页面结构可能已变更"总结警告
- 前端检测 `_parse_warnings` 非空时显示黄色警告条

## 7. 外部链接

| 用途 | URL |
|------|-----|
| 基因信息原站 | `https://rice.uga.edu/cgi-bin/ORF_infopage.cgi?orf={accession}` |
| 序列展示 | `https://rice.uga.edu/cgi-bin/sequence_display.cgi?orf={variant_id}` |
