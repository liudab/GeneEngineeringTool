const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'main', 'services', 'species-plugin-service.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Use CRLF line endings
const searchStr = `    speciesRepo.updateSpeciesPlugin(existing.id, {\r\n      version: config.version || existing.version,\r\n      data_file: dataFile,\r\n      fields_config: JSON.stringify(config.fieldDefinitions || []),\r\n      url_templates: JSON.stringify(config.urlTemplates || {}),\r\n    })`;

const replaceStr = `    speciesRepo.updateSpeciesPlugin(existing.id, {\r\n      version: config.version || existing.version,\r\n      data_file: dataFile,\r\n      fields_config: JSON.stringify(config.fieldDefinitions || []),\r\n      url_templates: JSON.stringify(config.urlTemplates || {}),\r\n      mode: config.mode,\r\n      online_sources_config: JSON.stringify(config.onlineSources || []),\r\n    })`;

if (content.includes(searchStr)) {
  content = content.replace(searchStr, replaceStr);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('SUCCESS: Updated species-plugin-service.ts');
} else {
  console.log('Pattern not found');
}
