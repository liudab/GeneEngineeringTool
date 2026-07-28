const initSqlJs = require('sql.js');
const f = require('fs');
const p = require('path').join(process.env.APPDATA, 'HelixCraft', 'gene-engineering.db');

initSqlJs().then(SQL => {
  const d = new SQL.Database(f.readFileSync(p));
  
  // Get valid plugin IDs
  const plugins = d.exec("SELECT id FROM species_plugins");
  const validIds = plugins.length > 0 ? plugins[0].values.map(v => v[0]) : [];
  console.log('Valid plugin IDs:', validIds);
  
  // Count before
  const before = d.exec("SELECT COUNT(*) FROM species_gene_annotations");
  console.log('Total annotations before:', before[0].values[0][0]);
  
  // Delete orphaned annotations (plugin_id not in valid list)
  if (validIds.length > 0) {
    const placeholders = validIds.map(() => '?').join(',');
    d.run(`DELETE FROM species_gene_annotations WHERE plugin_id NOT IN (${placeholders})`, validIds);
  }
  
  // Count after
  const after = d.exec("SELECT COUNT(*) FROM species_gene_annotations");
  console.log('Total annotations after:', after[0].values[0][0]);
  console.log('Deleted:', before[0].values[0][0] - after[0].values[0][0], 'orphaned records');
  
  // Verify LOC4350574
  const r = d.exec("SELECT id, plugin_id, source_database, source_accession FROM species_gene_annotations WHERE ncbi_gene_id = '4350574'");
  if (r.length > 0) {
    console.log('\nLOC4350574 annotations (' + r[0].values.length + '):');
    r[0].values.forEach(v => console.log('  id=' + v[0] + ' plugin_id=' + v[1] + ' src=' + v[2] + ' acc=' + v[3]));
  }
  
  const data = d.export();
  f.writeFileSync(p, Buffer.from(data));
  console.log('\nSaved!');
  d.close();
});

