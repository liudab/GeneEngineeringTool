const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'HelixCraft', 'gene-engineering.db');

initSqlJs().then(SQL => {
  const d = new SQL.Database(fs.readFileSync(dbPath));

  // Check the imported gene
  const genes = d.exec("SELECT id, gene_name, ncbi_gene_id FROM gene_sequences");
  console.log('=== Imported genes ===');
  if (genes.length > 0) {
    for (const v of genes[0].values) {
      console.log(`  id=${v[0]}, name="${v[1]}", ncbi_gene_id="${v[2]}"`);
    }
  } else {
    console.log('  No genes found');
  }

  // Check annotations that should match
  if (genes.length > 0) {
    const ncbiId = genes[0].values[0][2];
    console.log(`\n=== Annotations with ncbi_gene_id="${ncbiId}" ===`);
    const anns = d.exec(`SELECT id, plugin_id, source_database, source_accession, gene_id FROM species_gene_annotations WHERE ncbi_gene_id = '${ncbiId}'`);
    if (anns.length > 0) {
      console.log(`  Found ${anns[0].values.length} annotations`);
      for (const v of anns[0].values) {
        console.log(`  id=${v[0]} plugin_id=${v[1]} src=${v[2]} acc=${v[3]} gene_id=${v[4]}`);
      }
    } else {
      console.log('  No annotations found');
    }

    // Also check with LOC prefix
    console.log(`\n=== Annotations with ncbi_gene_id="LOC${ncbiId}" ===`);
    const anns2 = d.exec(`SELECT id, plugin_id, source_database, source_accession, gene_id FROM species_gene_annotations WHERE ncbi_gene_id = 'LOC${ncbiId}'`);
    if (anns2.length > 0) {
      console.log(`  Found ${anns2[0].values.length} annotations`);
      for (const v of anns2[0].values) {
        console.log(`  id=${v[0]} plugin_id=${v[1]} src=${v[2]} acc=${v[3]} gene_id=${v[4]}`);
      }
    } else {
      console.log('  No annotations found');
    }
  }

  // Check plugin enabled
  console.log('\n=== Plugin status ===');
  const plugins = d.exec("SELECT id, species_name, enabled FROM species_plugins");
  if (plugins.length > 0) {
    for (const v of plugins[0].values) {
      console.log(`  Plugin id=${v[0]} name=${v[1]} enabled=${v[2]}`);
    }
  }

  d.close();
});
