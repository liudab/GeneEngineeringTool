const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'main', 'db', 'base.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Find the location after the ALTER TABLE statements for species_gene_annotations
const searchStr = `  // 迁移：注释表添加 source_type 和 cache_expires_at 列\r\n  try { db.run("ALTER TABLE species_gene_annotations ADD COLUMN source_type TEXT DEFAULT 'csv_import'") } catch (_e) { /* 列已存在 */ }\r\n  try { db.run("ALTER TABLE species_gene_annotations ADD COLUMN cache_expires_at TEXT DEFAULT NULL") } catch (_e) { /* 列已存在 */ }\r\n\r\n  // 应用设置表（通用 KV 存储）`;

const replaceStr = `  // 迁移：注释表添加 source_type 和 cache_expires_at 列\r\n  try { db.run("ALTER TABLE species_gene_annotations ADD COLUMN source_type TEXT DEFAULT 'csv_import'") } catch (_e) { /* 列已存在 */ }\r\n  try { db.run("ALTER TABLE species_gene_annotations ADD COLUMN cache_expires_at TEXT DEFAULT NULL") } catch (_e) { /* 列已存在 */ }\r\n\r\n  // 迁移：更新已有插件的 fields_config 和 mode（从 plugin.json 读取最新配置）\r\n  try {\r\n    const plugins = db.exec("SELECT id, species_name FROM species_plugins");\r\n    if (plugins.length > 0 && plugins[0].values.length > 0) {\r\n      const dataDir = getDataDir();\r\n      for (const row of plugins[0].values) {\r\n        const pluginId = row[0] as number;\r\n        const speciesName = row[1] as string;\r\n        const pluginJsonPath = path.join(dataDir, 'species-plugins', speciesName, 'plugin.json');\r\n        if (fs.existsSync(pluginJsonPath)) {\r\n          try {\r\n            const pluginConfig = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));\r\n            const fieldsConfig = JSON.stringify(pluginConfig.fieldDefinitions || []);\r\n            const urlTemplates = JSON.stringify(pluginConfig.urlTemplates || {});\r\n            const mode = pluginConfig.mode || 'offline';\r\n            const onlineSources = JSON.stringify(pluginConfig.onlineSources || []);\r\n            db.run("UPDATE species_plugins SET fields_config = ?, url_templates = ?, mode = ?, online_sources_config = ? WHERE id = ?", [fieldsConfig, urlTemplates, mode, onlineSources, pluginId]);\r\n            console.log(\`[DB Migration] Updated plugin \${speciesName} fields_config and mode\`);\r\n          } catch (e) {\r\n            console.warn(\`[DB Migration] Failed to update plugin \${speciesName}:\`, e);\r\n          }\r\n        }\r\n      }\r\n    }\r\n  } catch (e) {\r\n    console.warn('[DB Migration] Failed to migrate plugin fields_config:', e);\r\n  }\r\n\r\n  // 应用设置表（通用 KV 存储）`;

if (content.includes(searchStr)) {
  content = content.replace(searchStr, replaceStr);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('SUCCESS: Updated base.ts with plugin fields_config migration');
} else {
  console.log('Pattern not found');
}
