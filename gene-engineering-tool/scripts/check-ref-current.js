const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'HelixCraft', 'gene-engineering.db');

initSqlJs().then(SQL => {
  const d = new SQL.Database(fs.readFileSync(dbPath));

  const anns = d.exec("SELECT annotation_data FROM species_gene_annotations WHERE ncbi_gene_id = '4338448' AND source_database = 'RAP-DB'");
  if (anns.length > 0) {
    const data = JSON.parse(anns[0].values[0][0]);
    console.log('=== Current references ===');
    console.log(data.references);
    console.log('\n=== Length:', data.references.length, '===');
  }

  d.close();
});
