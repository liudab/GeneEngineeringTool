const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'HelixCraft', 'gene-engineering.db');

initSqlJs().then(SQL => {
  const d = new SQL.Database(fs.readFileSync(dbPath));

  // Count annotations with references
  const cnt = d.exec("SELECT COUNT(*) FROM species_gene_annotations WHERE annotation_data LIKE '%\"references\"%'");
  console.log('Annotations with references field:', cnt.length > 0 ? cnt[0].values[0][0] : 0);

  // Check LOC4327046
  const r = d.exec("SELECT source_database, source_accession, gene_id, annotation_data FROM species_gene_annotations WHERE ncbi_gene_id = '4327046'");
  if (r.length > 0) {
    console.log('\nLOC4327046 annotations (' + r[0].values.length + '):');
    for (const v of r[0].values) {
      console.log('  ' + v[0] + ' ' + v[1] + ' gene_id=' + v[2]);
      const data = JSON.parse(v[3]);
      console.log('    keys: ' + Object.keys(data).join(', '));
      if (data.references) console.log('    references: ' + data.references.substring(0, 80) + '...');
    }
  }

  // Find a gene with references
  const sample = d.exec("SELECT source_database, source_accession, ncbi_gene_id, annotation_data FROM species_gene_annotations WHERE annotation_data LIKE '%\"references\"%' LIMIT 3");
  if (sample.length > 0) {
    console.log('\nSample genes with references:');
    for (const v of sample[0].values) {
      const data = JSON.parse(v[3]);
      console.log('  ' + v[0] + ' ' + v[1] + ' (NCBI: ' + v[2] + ')');
      console.log('    references: ' + (data.references || '').substring(0, 100));
    }
  }

  d.close();
});
