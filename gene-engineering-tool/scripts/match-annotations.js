const initSqlJs = require('sql.js');
const f = require('fs');
const p = require('path').join(process.env.APPDATA, 'HelixCraft', 'gene-engineering.db');

initSqlJs().then(SQL => {
  const d = new SQL.Database(f.readFileSync(p));

  // Check genes with ncbi_gene_id
  const g = d.exec("SELECT id, ncbi_gene_id FROM gene_sequences WHERE ncbi_gene_id IS NOT NULL AND ncbi_gene_id != ''");
  console.log('Genes with ncbi_id:', g.length > 0 ? g[0].values.length : 0);
  if (g.length > 0) {
    for (const r of g[0].values) {
      console.log('  gene id=' + r[0] + ' ncbi=' + r[1]);
    }
  }

  // Check annotations for 4350574
  const a = d.exec("SELECT id, ncbi_gene_id FROM species_gene_annotations WHERE ncbi_gene_id = '4350574'");
  console.log('Annotations for 4350574:', a.length > 0 ? a[0].values.length : 0);
  if (a.length > 0) {
    for (const r of a[0].values) console.log('  ann id=' + r[0] + ' ncbi=' + r[1]);
  }

  // Match annotations to genes
  d.run("UPDATE species_gene_annotations SET gene_id = (SELECT id FROM gene_sequences WHERE ncbi_gene_id = species_gene_annotations.ncbi_gene_id LIMIT 1) WHERE gene_id IS NULL");

  const m = d.exec("SELECT COUNT(*) FROM species_gene_annotations WHERE gene_id IS NOT NULL");
  console.log('Matched:', m[0].values[0][0]);

  const data = d.export();
  f.writeFileSync(p, Buffer.from(data));
  console.log('Saved');
  d.close();
});
