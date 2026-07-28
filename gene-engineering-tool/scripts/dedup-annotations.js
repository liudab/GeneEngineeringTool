const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'HelixCraft', 'gene-engineering.db');

async function dedup() {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(dbPath);
  const db = new SQL.Database(buf);
  
  // Count before
  const before = db.exec("SELECT COUNT(*) FROM species_gene_annotations");
  console.log('Annotations before:', before[0].values[0][0]);
  
  // Find duplicates
  const dups = db.exec(`
    SELECT MIN(id) as keep_id, plugin_id, source_database, source_accession, ncbi_gene_id, COUNT(*) as cnt
    FROM species_gene_annotations
    GROUP BY plugin_id, source_database, source_accession, ncbi_gene_id
    HAVING cnt > 1
  `);
  
  let deletedCount = 0;
  if (dups.length > 0 && dups[0].values.length > 0) {
    console.log(`Found ${dups[0].values.length} duplicate groups`);
    for (const row of dups[0].values) {
      const keepId = row[0];
      const pluginId = row[1];
      const srcDb = row[2];
      const srcAcc = row[3];
      const ncbiId = row[4];
      const cnt = row[5];
      db.run(
        'DELETE FROM species_gene_annotations WHERE plugin_id = ? AND source_database = ? AND source_accession = ? AND ncbi_gene_id = ? AND id != ?',
        [pluginId, srcDb, srcAcc, ncbiId, keepId]
      );
      deletedCount += cnt - 1;
    }
  }
  console.log(`Deleted ${deletedCount} duplicate annotations`);
  
  // Count after
  const after = db.exec("SELECT COUNT(*) FROM species_gene_annotations");
  console.log('Annotations after:', after[0].values[0][0]);
  
  // Verify LOC4350574
  const anns = db.exec("SELECT id, source_database, source_accession FROM species_gene_annotations WHERE ncbi_gene_id = '4350574'");
  if (anns.length > 0) {
    console.log(`\nLOC4350574 annotations (${anns[0].values.length}):`);
    for (const row of anns[0].values) {
      console.log(`  id=${row[0]}, source=${row[1]}, accession=${row[2]}`);
    }
  }
  
  // Save
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  console.log('\nDatabase saved!');
  db.close();
}

dedup().catch(err => { console.error('Error:', err.message); process.exit(1); });
