const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'main', 'db', 'base.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Find and replace fs.existsSync and fs.readFileSync with named imports
const searchStr = `        if (fs.existsSync(pluginJsonPath)) {\r\n          try {\r\n            const pluginConfig = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));`;

const replaceStr = `        if (existsSync(pluginJsonPath)) {\r\n          try {\r\n            const pluginConfig = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));`;

if (content.includes(searchStr)) {
  content = content.replace(searchStr, replaceStr);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('SUCCESS: Updated base.ts to use named imports');
} else {
  console.log('Pattern not found');
}
