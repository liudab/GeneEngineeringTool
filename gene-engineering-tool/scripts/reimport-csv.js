const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'HelixCraft', 'gene-engineering.db');
const pluginJsonPath = path.join(__dirname, '..', 'plugins', 'species-rice', 'plugin.json');
const csvPath = path.join(__dirname, '..', 'plugins', 'species-rice', 'data', 'ricedata.clean.csv');

/**
 * 解析 CSV 文件，正确处理多行引号字段
 * CSV 规范：引号内可包含换行符、逗号、引号（用 "" 转义）
 */
function parseCSV(content) {
  const rows = [];
  let i = 0;
  const len = content.length;

  while (i < len) {
    const row = [];
    let field = '';
    let inQuotes = false;

    while (i < len) {
      const ch = content[i];

      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < len && content[i + 1] === '"') {
            // 转义引号 ""
            field += '"';
            i += 2;
          } else {
            // 结束引号
            inQuotes = false;
            i++;
          }
        } else {
          // 引号内的任何字符（包括换行）
          field += ch;
          i++;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
          i++;
        } else if (ch === ',') {
          row.push(field.trim());
          field = '';
          i++;
        } else if (ch === '\n' || ch === '\r') {
          // 行结束
          if (ch === '\r' && i + 1 < len && content[i + 1] === '\n') {
            i++; // skip \n after \r
          }
          row.push(field.trim());
          field = '';
          i++;
          break; // 一行结束
        } else {
          field += ch;
          i++;
        }
      }
    }

    // 处理文件末尾没有换行的情况
    if (i >= len && field.length > 0) {
      row.push(field.trim());
    }

    // 跳过空行
    if (row.length > 1 || (row.length === 1 && row[0].length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

/**
 * 清洗参考文献字段：将多行松散格式压缩为紧凑格式
 * 利用原始 \n\n 结构识别 authors / title / journal 边界
 */
function cleanReferences(raw) {
  if (!raw) return raw;

  // 预处理：将 "数字\n     \n     ." 合并为 "数字."
  let text = raw.replace(/(\d+)\s*\n\s*\n\s*\.\s*/g, '$1. ');

  // 按 "数字." 模式分割（不捕获，避免交替问题）
  const entries = text.split(/(?:^|\n)\s*\d+\.\s*/).filter(s => s.trim().length > 0);

  const formatted = [];

  for (let i = 0; i < entries.length; i++) {
    const num = i + 1;
    const entryText = entries[i].trim();
    if (!entryText) continue;

    // 用 \n\n（空行）分割结构段落
    const chunks = entryText.split(/\n\s*\n/).map(s =>
      s.replace(/\s+/g, ' ').trim()
    ).filter(s => s.length > 0);

    // 识别 authors：包含分号的第一个 chunk
    let authors = '';
    let restChunks = chunks;
    if (chunks.length > 0 && chunks[0].includes(';')) {
      authors = chunks[0].replace(/;\s*/g, ';');
      restChunks = chunks.slice(1);
    }

    // 合并剩余 chunk，定位年份以分离 title 和 journal
    const combined = restChunks.join(' ');
    const yearMatch = combined.match(/,\s*((?:19|20)\d{2})/);

    let title = combined;
    let journal = '';

    if (yearMatch) {
      const yearIdx = yearMatch.index;
      // afterYear = yearMatch 之后的内容（如 ", 9: 851"）
      const afterYear = combined.substring(yearIdx + yearMatch[0].length);

      // beforeYear = 年份逗号之前的所有内容（如 "Nature Communications"）
      const beforeYear = combined.substring(0, yearIdx).trim();
      const words = beforeYear.split(/\s+/);
      const connectors = new Set(['in', 'of', 'the', 'and', '&']);
      let journalStart = words.length;

      for (let j = words.length - 1; j >= 0; j--) {
        const w = words[j].replace(/[^a-zA-Z&]/g, '');
        if (!w) continue;
        if (connectors.has(w.toLowerCase())) {
          journalStart = j;
        } else if (w[0] === w[0].toUpperCase() && /[A-Z]/.test(w[0])) {
          journalStart = j;
        } else {
          break;
        }
      }

      // 处理 "Plant, Cell & Environment" 类型：检查 journalStart 前面是否还有逗号连接的期刊名部分
      if (journalStart > 0) {
        const rawPrev = words[journalStart - 1];
        if (rawPrev.endsWith(',')) {
          const prevWord = rawPrev.replace(/[^a-zA-Z]/g, '');
          if (prevWord && prevWord[0] === prevWord[0].toUpperCase() && /[A-Z]/.test(prevWord[0])) {
            for (let j = journalStart - 1; j >= 0; j--) {
              const w = words[j].replace(/[^a-zA-Z&]/g, '');
              if (!w) { journalStart = j + 1; break; }
              if (connectors.has(w.toLowerCase()) || (w[0] === w[0].toUpperCase() && /[A-Z]/.test(w[0]))) {
                journalStart = j;
              } else {
                break;
              }
            }
          }
        }
      }

      title = words.slice(0, journalStart).join(' ').trim();
      // 期刊名 + ", 年份" + 后续信息
      journal = words.slice(journalStart).join(' ') + yearMatch[0] + afterYear;
      journal = journal.trim();
    }

    // 格式化输出
    const parts = [];
    if (authors) parts.push(authors + '.');
    if (title) parts.push(title + '.');
    if (journal) parts.push(journal);

    formatted.push(num + '.' + parts.join(' '));
  }

  // 全局后处理：修复括号/冒号周围多余空格（保留换行符）
  let result = formatted.join('\n');
  result = result.replace(/[^\S\n]*\([^\S\n]*/g, '(');    // "( 2 )" → "(2)"
  result = result.replace(/[^\S\n]*\)[^\S\n]*/g, ')');    // "2 ) :" → "2):"
  result = result.replace(/[^\S\n]*:[^\S\n]*/g, ': ');     // "2): 451" → "2): 451"
  result = result.replace(/\([^\S\n]+/g, '(');
  result = result.replace(/[^\S\n]+\)/g, ')');
  result = result.replace(/[^\S\n]+,/g, ',');               // " ," → ","
  result = result.replace(/,([^\s])/g, ', $1');             // ",2018" → ", 2018"
  result = result.replace(/\.[^\S\n]*\./g, '.');            // ".." → "."
  result = result.replace(/[^\S\n]+/g, ' ');               // 水平多重空格 → 单空格（保留换行）
  return result;
}

async function reimport() {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(dbPath);
  const db = new SQL.Database(buf);

  // Get plugin ID
  const pluginResult = db.exec("SELECT id FROM species_plugins WHERE species_name = '水稻'");
  if (pluginResult.length === 0 || pluginResult[0].values.length === 0) {
    console.error('Plugin not found!');
    process.exit(1);
  }
  const pluginId = pluginResult[0].values[0][0];
  console.log('Plugin ID:', pluginId);

  // Read plugin config
  const config = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
  const rapDbSource = config.dataSources.find(d => d.name === 'RAP-DB');
  const msuSource = config.dataSources.find(d => d.name === 'MSU');

  // Delete old annotations for this plugin
  const beforeCount = db.exec("SELECT COUNT(*) FROM species_gene_annotations WHERE plugin_id = ?");
  console.log('Old annotations:', beforeCount[0].values[0][0]);

  db.run("DELETE FROM species_gene_annotations WHERE plugin_id = ?", [pluginId]);
  console.log('Deleted old annotations');

  // Read and parse CSV
  console.log('Reading CSV...');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const allRows = parseCSV(csvContent);
  console.log('Total rows (including header):', allRows.length);

  // First row is header
  const header = allRows[0];
  const dataRows = allRows.slice(1);

  let imported = 0;
  let skipped = 0;
  const batchSize = 500;
  let batch = [];

  function insertBatch() {
    for (const row of batch) {
      try {
        db.run(
          `INSERT INTO species_gene_annotations 
            (plugin_id, source_database, source_accession, ncbi_gene_id, gene_symbol, gene_name, annotation_data, external_links, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          row
        );
        imported++;
      } catch (e) {
        skipped++;
      }
    }
    batch = [];
  }

  // Process each data row
  for (let i = 0; i < dataRows.length; i++) {
    const fields = dataRows[i];
    const ncbiRaw = fields[8] || '';
    const ncbiGeneId = ncbiRaw.replace(/^LOC/i, '').trim();
    if (!ncbiGeneId) { skipped++; continue; }

    const now = new Date().toISOString();

    // RAP-DB
    const rapAccession = fields[rapDbSource.csvColumn] || '';
    if (rapAccession) {
      const annData = {};
      const extLinks = {};
      for (const col of rapDbSource.importColumns) {
        const val = (fields[col.csvColumn] || '').trim();
        if (val) {
          // 参考文献字段专门清洗格式
          if (col.fieldName === 'references') {
            annData[col.fieldName] = cleanReferences(val);
          } else {
            annData[col.fieldName] = val;
          }
        }
      }
      batch.push([
        pluginId, 'RAP-DB', rapAccession, ncbiGeneId,
        annData.gene_symbol || '', annData.gene_chinese_name || '',
        JSON.stringify(annData), JSON.stringify(extLinks), now
      ]);
    }

    // MSU
    const msuAccession = fields[msuSource.csvColumn] || '';
    if (msuAccession) {
      const annData = {};
      for (const col of msuSource.importColumns) {
        const val = (fields[col.csvColumn] || '').trim();
        if (val) annData[col.fieldName] = val;
      }
      batch.push([
        pluginId, 'MSU', msuAccession, ncbiGeneId,
        annData.gene_symbol || '', annData.gene_chinese_name || '',
        JSON.stringify(annData), '{}', now
      ]);
    }

    if (batch.length >= batchSize) insertBatch();
    if (i % 10000 === 0) process.stdout.write(`  Progress: ${i}/${dataRows.length}\r`);
  }

  if (batch.length > 0) insertBatch();

  console.log(`\nImported: ${imported}, Skipped: ${skipped}`);

  // Match to gene_sequences
  db.run(`
    UPDATE species_gene_annotations 
    SET gene_id = (SELECT id FROM gene_sequences WHERE ncbi_gene_id = species_gene_annotations.ncbi_gene_id LIMIT 1)
    WHERE gene_id IS NULL AND ncbi_gene_id IN (SELECT ncbi_gene_id FROM gene_sequences WHERE ncbi_gene_id IS NOT NULL AND ncbi_gene_id != '')
  `);
  const matched = db.exec("SELECT COUNT(*) FROM species_gene_annotations WHERE plugin_id = ? AND gene_id IS NOT NULL");
  console.log('Matched annotations:', matched[0].values[0][0]);

  // Verify LOC4338448
  const verify = db.exec("SELECT source_database, source_accession, annotation_data FROM species_gene_annotations WHERE ncbi_gene_id = '4338448'");
  if (verify.length > 0) {
    console.log('\nLOC4338448 annotations:');
    for (const row of verify[0].values) {
      console.log(`  ${row[0]} ${row[1]}`);
      const data = JSON.parse(row[2]);
      console.log(`    keys: ${Object.keys(data).join(', ')}`);
      if (data.references) console.log(`    references: ${data.references.substring(0, 100)}...`);
      if (data.expression_pattern) console.log(`    expression_pattern: ${data.expression_pattern.substring(0, 60)}`);
      if (data.subcellular_location) console.log(`    subcellular_location: ${data.subcellular_location.substring(0, 60)}`);
    }
  }

  // Save
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  console.log('\nDatabase saved!');
  db.close();
}

reimport().catch(err => { console.error('Error:', err.message); process.exit(1); });
