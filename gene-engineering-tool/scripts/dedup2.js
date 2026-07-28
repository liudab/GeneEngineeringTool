const initSqlJs = require('sql.js');
const f = require('fs');
const p = require('path').join(process.env.APPDATA, 'HelixCraft', 'gene-engineering.db');

initSqlJs().then(SQL => {
  const d = new SQL.Database(f.readFileSync(p));
  
  // Check plugin IDs
  const plugins = d.exec("SELECT id, species_name FROM species_plugins");
  console.log('Plugins:');
  if (plugins.length > 0) plugins[0].values.forEach(v => console.log('  id=' + v[0] + ' name=' + v[1]));
  
  // Check LOC4350574 annotations with all plugin_ids
  const r = d.exec("SELECT id, plugin_id, source_database, source_accession, ncbi_gene_id FROM species_gene_annotations WHERE source_accession IN ('Os11g0512000', 'LOC_Os11g31330')");
  if (r.length > 0) {
    console.log('\nAnnotations for Os11g0512000/LOC_Os11g31330 (' + r[0].values.length + '):');
    r[0].values.forEach(v => console.log('  id=' + v[0] + ' plugin_id=' + v[1] + ' src=' + v[2] + ' acc=' + v[3] + ' ncbi=' + v[4]));
  }
  
  // Delete all duplicates - keep only the first (lowest id) per plugin_id + source_database + source_accession
  const del = d.exec(`
    SELECT MIN(id), plugin_id, source_database, source_accession, COUNT(*) 
    FROM species_gene_annotations 
    GROUP BY plugin_id, source_database, source_accession 
    HAVING COUNT(*) > 1
  `);
  
  let deleted = 0;
  if (del.length > 0 && del[0].values.length > 0) {
    for (const row of del[0].values) {
      const keepId = row[0];
      const pid = row[1];
      const srcDb = row[2];
      const srcAcc = row[3];
      d.run('DELETE FROM species_gene_annotations WHERE plugin_id = ? AND source_database = ? AND source_accession = ? AND id != ?', [pid, srcDb, srcAcc, keepId]);
      deleted += row[4] - 1;
    }
  }
  console.log('\nDeleted ' + deleted + ' duplicates');
  
  // Verify
  const r2 = d.exec("SELECT id, plugin_id, source_database, source_accession FROM species_gene_annotations WHERE source_accession IN ('Os11g0512000', 'LOC_Os11g31330')");
  if (r2.length > 0) {
    console.log('\nAfter dedup (' + r2[0].values.length + '):');
    r2[0].values.forEach(v => console.log('  id=' + v[0] + ' plugin_id=' + v[1] + ' src=' + v[2] + ' acc=' + v[3]));
  }
  
  const data = d.export();
  f.writeFileSync(p, Buffer.from(data));
  console.log('\nSaved!');
  d.close();
});
