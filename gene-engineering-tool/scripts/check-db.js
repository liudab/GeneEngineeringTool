const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'HelixCraft', 'gene-engineering.db');

async function checkDb() {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(dbPath);
  const db = new SQL.Database(buf);
  
  console.log('=== 1. 插件列表 ===');
  const plugins = db.exec('SELECT id, species_name, enabled, mode, fields_config FROM species_plugins');
  if (plugins.length > 0 && plugins[0].values.length > 0) {
    for (const row of plugins[0].values) {
      console.log(`Plugin: id=${row[0]}, name=${row[1]}, enabled=${row[2]}, mode=${row[3]}`);
      try {
        const fieldsConfig = JSON.parse(row[4] || '[]');
        console.log(`  fields_config (${fieldsConfig.length} fields):`);
        for (const f of fieldsConfig) {
          console.log(`    - ${f.name}: displayLocation=${f.displayLocation || 'tab'}, type=${f.type}`);
        }
      } catch (e) {
        console.log('  Failed to parse fields_config');
      }
    }
  } else {
    console.log('No plugins found');
  }
  
  console.log('\n=== 2. 检查 LOC4350574 基因 ===');
  const genes = db.exec("SELECT id, gene_name, gene_symbol, ncbi_gene_id FROM gene_sequences WHERE ncbi_gene_id = '4350574' OR gene_name LIKE '%4350574%'");
  if (genes.length > 0 && genes[0].values.length > 0) {
    for (const row of genes[0].values) {
      console.log(`Gene: id=${row[0]}, name=${row[1]}, symbol=${row[2]}, ncbi_id=${row[3]}`);
    }
  } else {
    console.log('Gene LOC4350574 not found in database');
  }
  
  console.log('\n=== 3. 检查物种注释 ===');
  const annotations = db.exec("SELECT sa.id, sa.source_database, sa.source_accession, sa.ncbi_gene_id, sa.annotation_data FROM species_gene_annotations sa WHERE sa.ncbi_gene_id = '4350574' LIMIT 5");
  if (annotations.length > 0 && annotations[0].values.length > 0) {
    console.log(`Found ${annotations[0].values.length} annotations for LOC4350574:`);
    for (const row of annotations[0].values) {
      console.log(`  Annotation: id=${row[0]}, source=${row[1]}, accession=${row[2]}, ncbi=${row[3]}`);
      try {
        const annData = JSON.parse(row[4] || '{}');
        console.log(`    annotation_data keys: ${Object.keys(annData).join(', ')}`);
      } catch (e) {
        console.log('    Failed to parse annotation_data');
      }
    }
  } else {
    console.log('No annotations found for LOC4350574');
  }
  
  db.close();
}

checkDb().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
