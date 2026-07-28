const fs = require('fs');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'plugins', 'species-rice', 'data', 'ricedata.clean.csv');

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

const content = fs.readFileSync(csvPath, 'utf8');
const lines = content.split('\n');

// Show header
console.log('=== CSV Header ===');
const header = parseCSVLine(lines[0]);
console.log('Total columns:', header.length);
header.forEach((h, i) => console.log(`  [${i}]: ${h}`));

// Find LOC4350574 and show its fields
console.log('\n=== LOC4350574 row ===');
for (let i = 1; i < lines.length; i++) {
  if (lines[i].includes('4350574') || lines[i].includes('Os11g0512000')) {
    const fields = parseCSVLine(lines[i]);
    console.log('Row', i, '- Total fields:', fields.length);
    fields.forEach((f, idx) => {
      const val = f.length > 80 ? f.substring(0, 80) + '...' : f;
      console.log(`  [${idx}] (${header[idx] || '?'}): "${val}"`);
    });
    break;
  }
}
