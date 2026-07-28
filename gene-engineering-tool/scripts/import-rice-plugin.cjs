/**
 * Standalone script to install the rice species plugin and import CSV data
 * Run with: node scripts/import-rice-plugin.cjs
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(process.env.APPDATA || process.env.HOME, 'HelixCraft', 'gene-engineering.db');
const PLUGIN_DIR = path.join(__dirname, '..', 'plugins', 'species-rice');
const CSV_PATH = path.join(PLUGIN_DIR, 'data', 'ricedata.clean.csv');
const PLUGIN_JSON = path.join(PLUGIN_DIR, 'plugin.json');

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

async function main() {
  console.log('=== Rice Plugin Import Script ===');
  console.log('DB path:', DB_PATH);
  console.log('Plugin dir:', PLUGIN_DIR);

  if (!fs.existsSync(DB_PATH)) {
    console.error('ERROR: Database not found at', DB_PATH);
    process.exit(1);
  }

  // Copy plugin files to species-plugins directory (required for export backup)
  const targetPluginDir = path.join(path.dirname(DB_PATH), 'species-plugins', path.basename(PLUGIN_DIR).replace('species-', ''));
  // Use the species name from plugin.json for the directory
  const configPreload = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf-8'));
  const speciesDir = path.join(path.dirname(DB_PATH), 'species-plugins', configPreload.speciesName);
  if (!fs.existsSync(speciesDir)) {
    fs.mkdirSync(speciesDir, { recursive: true });
  }
  // Copy all files recursively
  function copyRecursive(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      const srcPath = path.join(src, entry);
      const destPath = path.join(dest, entry);
      const stat = fs.statSync(srcPath);
      if (stat.isDirectory()) {
        copyRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
  copyRecursive(PLUGIN_DIR, speciesDir);
  console.log('Plugin files copied to:', speciesDir);

  const SQL = await initSqlJs();
  const dbBuf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuf);

  // Read plugin config
  const config = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf-8'));
  const now = new Date().toISOString();

  // Check if plugin already exists
  const existing = db.exec("SELECT id, species_name FROM species_plugins WHERE species_name = ?", [config.speciesName]);
  let pluginId;

  if (existing.length > 0 && existing[0].values.length > 0) {
    pluginId = existing[0].values[0][0];
    console.log(`Plugin already exists: id=${pluginId}, name=${config.speciesName}`);
    // Update version
    db.run("UPDATE species_plugins SET version = ?, updated_at = ?, data_file = 'data/ricedata.clean.csv' WHERE id = ?",
      [config.version, now, pluginId]);
  } else {
    db.run(
      `INSERT INTO species_plugins (species_name, species_latin, package_name, version, data_file, fields_config, url_templates, enabled, installed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [config.speciesName, config.speciesLatin, config.name || '', config.version,
       'data/ricedata.clean.csv', JSON.stringify(config.fieldDefinitions), JSON.stringify(config.urlTemplates), now, now]
    );
    const result = db.exec("SELECT last_insert_rowid()");
    pluginId = result[0].values[0][0];
    console.log(`Created plugin: id=${pluginId}, name=${config.speciesName}`);
  }

  // Check existing annotation count
  const countResult = db.exec("SELECT COUNT(*) FROM species_gene_annotations WHERE plugin_id = ?", [pluginId]);
  const existingCount = countResult.length > 0 ? countResult[0].values[0][0] : 0;
  console.log(`Existing annotations for plugin ${pluginId}: ${existingCount}`);

  if (existingCount > 1000) {
    console.log('Data already imported (found > 1000 annotations). Skipping CSV import.');
    console.log('To re-import, delete existing annotations first.');
    saveAndExit(db);
    return;
  }

  // Parse CSV
  console.log('Reading CSV...');
  const csvContent = fs.readFileSync(CSV_PATH, 'utf-8').replace(/^\uFEFF/, '');
  const lines = csvContent.split(/\r?\n/);
  console.log(`CSV: ${lines.length} lines total`);

  // Prepare insert statements
  const insertStmt = db.prepare(
    `INSERT INTO species_gene_annotations
     (plugin_id, source_database, source_accession, ncbi_gene_id, gene_symbol, gene_name, annotation_data, external_links, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let imported = 0;
  let skipped = 0;
  const batchSize = 500;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim().length === 0) continue;

    const fields = parseCSVLine(line);

    // Extract NCBI Gene ID (column 8), strip LOC prefix
    const rawNcbiId = (fields[8] || '').trim();
    const ncbiGeneId = rawNcbiId.replace(/^LOC/i, '').trim();

    for (const source of config.dataSources) {
      const accession = (fields[source.csvColumn] || '').trim();
      if (!accession) { skipped++; continue; }

      // Build annotation_data
      const annotationData = {};
      for (const col of source.importColumns) {
        if (col.csvColumn < fields.length) {
          const val = (fields[col.csvColumn] || '').trim();
          if (val) annotationData[col.fieldName] = val;
        }
      }

      insertStmt.bind([
        pluginId,
        source.name,
        accession,
        ncbiGeneId,
        annotationData['gene_symbol'] || '',
        annotationData['gene_name'] || '',
        JSON.stringify(annotationData),
        '{}',
        now
      ]);
      insertStmt.step();
      insertStmt.reset();
      imported++;

      if (imported % 10000 === 0) {
        console.log(`  Imported ${imported} annotations...`);
      }
    }
  }

  insertStmt.free();
  console.log(`Import complete: ${imported} annotations inserted, ${skipped} skipped`);

  // Match annotations to existing gene records
  console.log('Matching annotations to gene records...');
  db.run(
    `UPDATE species_gene_annotations SET gene_id = (
       SELECT id FROM gene_sequences WHERE gene_sequences.ncbi_gene_id = species_gene_annotations.ncbi_gene_id
     ) WHERE plugin_id = ? AND gene_id IS NULL AND ncbi_gene_id != ''`,
    [pluginId]
  );
  const matchResult = db.exec("SELECT COUNT(*) FROM species_gene_annotations WHERE plugin_id = ? AND gene_id IS NOT NULL", [pluginId]);
  const matched = matchResult.length > 0 ? matchResult[0].values[0][0] : 0;
  console.log(`Matched ${matched} annotations to gene records`);

  saveAndExit(db);
}

function saveAndExit(db) {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  db.close();
  console.log('Database saved. Done!');
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
