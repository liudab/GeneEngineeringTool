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
const header = parseCSVLine(lines[0]);

// Find LOC4338448 / Os05g0333200
console.log('=== Searching for LOC4338448 / Os05g0333200 ===');
for (let i = 1; i < lines.length; i++) {
  if (lines[i].includes('4338448') || lines[i].includes('Os05g0333200')) {
    const fields = parseCSVLine(lines[i]);
    console.log(`Row ${i} - Total fields: ${fields.length}`);
    // Show columns 11-16
    for (let idx = 11; idx <= 16; idx++) {
      const val = fields[idx] || '';
      console.log(`  [${idx}] (${header[idx] || '?'}): "${val.length > 100 ? val.substring(0, 100) + '...' : val}" (len=${val.length})`);
    }
    // Also show column 8
    console.log(`  [8] (NCBI Gene ID): "${fields[8]}"`);
    break;
  }
}
