const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'HelixCraft', 'gene-engineering.db');

initSqlJs().then(SQL => {
  const d = new SQL.Database(fs.readFileSync(dbPath));

  // Check annotation_data for LOC4338448
  const anns = d.exec("SELECT source_database, source_accession, annotation_data FROM species_gene_annotations WHERE ncbi_gene_id = '4338448'");
  if (anns.length > 0) {
    for (const v of anns[0].values) {
      console.log(`=== ${v[0]} ${v[1]} ===`);
      const data = JSON.parse(v[2]);
      console.log('Keys:', Object.keys(data).join(', '));
      for (const [key, val] of Object.entries(data)) {
        const str = String(val);
        console.log(`  ${key}: "${str.length > 120 ? str.substring(0, 120) + '...' : str}"`);
      }
    }
  }

  d.close();
});
