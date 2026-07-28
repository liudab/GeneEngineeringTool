const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'HelixCraft', 'gene-engineering.db');

initSqlJs().then(SQL => {
  const d = new SQL.Database(fs.readFileSync(dbPath));

  console.log('=== 基因相关表记录数 ===');
  const tables = [
    'gene_sequences',
    'gene_transcripts',
    'gene_exons',
    'gene_cross_refs',
    'gene_relations',
    'gene_related_sequences'
  ];
  for (const t of tables) {
    try {
      const r = d.exec(`SELECT COUNT(*) FROM ${t}`);
      console.log(`  ${t}: ${r[0].values[0][0]}`);
    } catch (e) {
      console.log(`  ${t}: ERROR - ${e.message}`);
    }
  }

  console.log('\n=== 物种注释表 ===');
  const ann = d.exec("SELECT COUNT(*) FROM species_gene_annotations");
  console.log(`  species_gene_annotations: ${ann[0].values[0][0]}`);
  const annWithGene = d.exec("SELECT COUNT(*) FROM species_gene_annotations WHERE gene_id IS NOT NULL");
  console.log(`  with gene_id (should be 0 or NULL): ${annWithGene[0].values[0][0]}`);

  console.log('\n=== 物种插件表 ===');
  const plugins = d.exec("SELECT id, species_name, enabled FROM species_plugins");
  if (plugins.length > 0) {
    for (const v of plugins[0].values) {
      console.log(`  Plugin: id=${v[0]}, name=${v[1]}, enabled=${v[2]}`);
    }
  }

  console.log('\n=== 检查残留 gene_id 引用 ===');
  // Check if any annotation still references deleted gene IDs
  const orphaned = d.exec("SELECT COUNT(*) FROM species_gene_annotations WHERE gene_id IS NOT NULL AND gene_id NOT IN (SELECT id FROM gene_sequences)");
  console.log(`  Orphaned annotations (gene_id points to non-existent gene): ${orphaned[0].values[0][0]}`);

  d.close();
});
