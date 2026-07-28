# RiceData 数据解析技术文档

## 1. 网站架构

国家水稻数据中心 (https://www.ricedata.cn) 是**传统服务端渲染**网站：
- 页面为静态 HTML，可直接 HTTP GET 抓取
- **编码不统一**：部分页面 UTF-8，部分页面 GB2312（同一网站！）
- 必须在 `httpsGet()` 中自动检测编码

## 2. 页面 URL

```
https://www.ricedata.cn/gene/list/{ricedata_id}.htm
```

示例：`https://www.ricedata.cn/gene/list/618.htm`

## 3. 编码检测（关键！）

**问题**：同一网站不同页面编码不同（如 id=1 是 UTF-8，id=618 是 GB2312）

**解决**：`httpsGet()` 在 `res.on('end')` 中自动检测：
```typescript
const head = buf.slice(0, 1024).toString('ascii')
const charsetMatch = head.match(/charset=["']?\s*([^"'\s;>]+)/i)
const charset = (charsetMatch?.[1] || '').toLowerCase()
if (charset.includes('gb2312') || charset.includes('gbk') || charset.includes('gb18030')) {
  resolve(new TextDecoder('gbk').decode(buf))
} else {
  resolve(buf.toString('utf-8'))
}
```

**后果**：若 GB2312 页面用 UTF-8 解码，中文乱码 → "参考文献"等正则全部失配 → 数据为空

## 4. 页面结构与解析

### 4.1 基因名称

```html
<th>基因(座)名称</th>
<td>中文名称<br><font face='Times New Roman'><i>英文名称</i></font></td>
```

正则：`/基因[\(（]座[\)）]名称[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i`
- 第一行：中文名称
- 第二行：英文名称（斜体）

### 4.2 基因符号

```html
<th>基因符号</th><td>LOX3</td>
```

正则：`/基因符号[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i`

### 4.3 各 Section 内容

页面结构：`<h5>【sectionName】</h5>` 后跟 `<p>` 段落

```html
<h5>【基本信息】</h5>
<p>内容...</p>
<h5>【突变体表型】</h5>
<p>内容...</p>
```

解析函数 `parseSection(sectionName)`：
```typescript
// 模式1（主）：匹配 h3/h4/h5 标签
const pattern1 = new RegExp(`<h[345]>[^<]*【${sectionName}】[^<]*<\\/h[345]>([\\s\\S]*?)(?=<h[345]>|<\\/td>)`, 'i')

// 模式2（回退）：匹配 <td> 结构
const pattern2 = new RegExp(`${sectionName}[\\s\\S]*?<td[^>]*>([\\s\\S]*?)<\\/td>`, 'i')
```

**Section 列表**：基本信息、突变体表型、定位与克隆、时空表达谱、亚细胞定位、生物学功能

### 4.4 参考文献（踩坑重点！）

**页面结构**：
```html
<tr><th>·<b>参考文献</b></th></tr>
<tr><td>1. Author; Author<br>&nbsp;&nbsp;Title<br>&nbsp;&nbsp;Journal, Year</td></tr>
<tr><td>2. ...</td></tr>
```

**正则**：`/参考文献[\s\S]{0,50}<\/th>([\s\S]*?)<\/table>/i`

**踩坑记录**：
1. `<th>` 内含 `<b>` 标签：`<th>·<b>参考文献</b></th>`
   - ❌ `/^<th[^>]*>[^<]*参考文献/` — `[^<]*` 无法跨越 `<b>` 标签
   - ✅ `/参考文献[\s\S]{0,50}<\/th>/` — 允许中间有任意 HTML
2. 非贪婪 `[\s\S]*?` 匹配到最近 `</table>`，防止跨越多个表格
3. 条目分隔：`</td></tr><tr><td>` 替换为换行

**清洗流程**：
```typescript
rawReferences
  .replace(/<br\s*\/?>/gi, '\n')           // <br> → 换行
  .replace(/<\/td>\s*<\/tr>\s*<tr>\s*<td[^>]*>/gi, '\n')  // 条目分隔
  .replace(/<[^>]+>/g, '')                  // 去 HTML 标签
  .replace(/&nbsp;/g, ' ')                  // 实体
  .replace(/&amp;/g, '&')
```

之后调用 `cleanReferences()` 进行结构化格式化（按编号分割、识别作者/标题/期刊）。

### 4.5 ONTOLOGY 区块

```html
<th>表型特征</th><td>内容</td>
<th>分子功能</th><td>内容</td>
<th>生物进程</th><td>内容</td>
<th>细胞结构</th><td>内容</td>
```

正则：`/<th[^>]*>[^<]*${fieldName}[^<]*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i`

## 5. 缓存字段

RiceData 获取的数据通过 `updateRiceDataAnnotation()` 写入所有关联注释的 `annotation_data`：

| 字段名 | 内容 |
|--------|------|
| `gene_chinese_name` | 基因中文名称 |
| `gene_english_name` | 基因英文名称 |
| `gene_symbol` | 基因符号 |
| `basic_info` | 基本信息 |
| `mutant_phenotype` | 突变体表型 |
| `mapping_cloning` | 定位与克隆 |
| `expression_pattern` | 时空表达谱 |
| `subcellular_location` | 亚细胞定位 |
| `biological_function` | 生物学功能 |
| `references` | 参考文献（格式化后） |
| `ontology_*` | ONTOLOGY 四分类 |
| `fetched_at` / `updated_at` | 时间戳 |

## 6. 防御性校验

- 页面有效性：`html.length < 200` → 抛出错误
- 每个 section 解析失败 → push 字段名到 warnings
- 基因名称 + 4个以上 section 全部失败 → "页面结构可能已变更"
- 前端显示黄色警告条

## 7. 外部链接

| 用途 | URL |
|------|-----|
| 基因详情原站 | `https://www.ricedata.cn/gene/list/{ricedata_id}.htm` |
