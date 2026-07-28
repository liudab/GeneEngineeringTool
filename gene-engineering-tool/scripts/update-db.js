const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'HelixCraft', 'gene-engineering.db');
const pluginJsonPath = path.join(__dirname, '..', 'plugins', 'species-rice', 'plugin.json');

async function updateDb() {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(dbPath);
  const db = new SQL.Database(buf);
  
  console.log('=== 读取 plugin.json ===');
  const pluginConfig = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
  console.log('fieldDefinitions:');
  for (const f of pluginConfig.fieldDefinitions) {
    console.log(`  - ${f.name}: displayLocation=${f.displayLocation}, type=${f.type}`);
  }
  
  console.log('\n=== 更新数据库 ===');
  const fieldsConfig = JSON.stringify(pluginConfig.fieldDefinitions);
  const urlTemplates = JSON.stringify(pluginConfig.urlTemplates);
  const mode = pluginConfig.mode || 'offline';
  
  db.run("UPDATE species_plugins SET fields_config = ?, url_templates = ?, mode = ? WHERE species_name = '水稻'", 
    [fieldsConfig, urlTemplates, mode]);
  
  console.log('Updated species_plugins table');
  
  console.log('\n=== 验证更新 ===');
  const result = db.exec("SELECT id, species_name, mode, fields_config FROM species_plugins WHERE species_name = '水稻'");
  if (result.length > 0 && result[0].values.length > 0) {
    const row = result[0].values[0];
    console.log(`Plugin: id=${row[0]}, name=${row[1]}, mode=${row[2]}`);
    const fields = JSON.parse(row[3]);
    console.log(`fields_config (${fields.length} fields):`);
    for (const f of fields) {
      console.log(`  - ${f.name}: displayLocation=${f.displayLocation || 'tab'}, type=${f.type}`);
    }
  }
  
  // Save database
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  console.log('\nDatabase saved successfully!');
  
  db.close();
}

updateDb().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
