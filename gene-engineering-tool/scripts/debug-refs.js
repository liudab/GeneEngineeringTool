const fs = require('fs');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'plugins', 'species-rice', 'data', 'ricedata.clean.csv');

// Multi-line CSV parser
function parseCSV(content) {
  const rows = [];
  let i = 0;
  const len = content.length;
  while (i < len) {
    const row = [];
    let field = '';
    let inQuotes = false;
    while (i < len) {
      const ch = content[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < len && content[i + 1] === '"') { field += '"'; i += 2; }
          else { inQuotes = false; i++; }
        } else { field += ch; i++; }
      } else {
        if (ch === '"') { inQuotes = true; i++; }
        else if (ch === ',') { row.push(field.trim()); field = ''; i++; }
        else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && i + 1 < len && content[i + 1] === '\n') i++;
          row.push(field.trim()); field = ''; i++; break;
        } else { field += ch; i++; }
      }
    }
    if (i >= len && field.length > 0) row.push(field.trim());
    if (row.length > 1 || (row.length === 1 && row[0].length > 0)) rows.push(row);
  }
  return rows;
}

const content = fs.readFileSync(csvPath, 'utf8');
const allRows = parseCSV(content);

// Find LOC4338448
for (const row of allRows) {
  if (row[8] && row[8].includes('4338448')) {
    const refs = row[16] || '';
    console.log('=== Raw references field (first 800 chars) ===');
    console.log(JSON.stringify(refs.substring(0, 800)));
    console.log('\n=== Split by number pattern ===');
    const parts = refs.split(/(?:^|\n)\s*(\d+)\s*\.\s*\n?/);
    console.log('Parts count:', parts.length);
    parts.forEach((p, idx) => {
      console.log(`  Part[${idx}]: "${p.substring(0, 80)}..."`);
    });
    break;
  }
}
