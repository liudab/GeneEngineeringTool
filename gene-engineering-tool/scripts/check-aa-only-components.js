/**
 * 检查数据库中“仅有氨基酸序列”的元件，验证它们现在会被正确跳过 DNA 比对方向。
 */
const { readFileSync } = require('fs')
const { join } = require('path')
const os = require('os')

const initSqlJs = require('sql.js')

const dbPath = join(os.homedir(), 'AppData', 'Roaming', 'gene-engineering-tool', 'gene-engineering.db')
const wasmPath = join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')

const targetNames = ['10xHis', 'AviTag', 'BSD', 'BioEase tag', 'BleoR']

async function main() {
  const SQL = await initSqlJs({ wasmBinary: readFileSync(wasmPath) })
  const db = new SQL.Database(readFileSync(dbPath))

  const namesLiteral = targetNames.map(n => `'${n}'`).join(',')
  const rows = db.exec(`SELECT id, standard_name, sequence, amino_acid_sequence, type FROM vector_components WHERE standard_name IN (${namesLiteral})`)

  if (!rows.length || !rows[0].values.length) {
    console.log('未找到目标元件')
    return
  }

  const nameIdx = rows[0].columns.indexOf('standard_name')
  const seqIdx = rows[0].columns.indexOf('sequence')
  const aaIdx = rows[0].columns.indexOf('amino_acid_sequence')
  const typeIdx = rows[0].columns.indexOf('type')

  for (const row of rows[0].values) {
    const name = row[nameIdx]
    const seq = String(row[seqIdx] || '')
    const aa = String(row[aaIdx] || '')
    const type = row[typeIdx]
    const dnaOnly = seq.toUpperCase().replace(/[^ATGC]/g, '')
    const hasProteinLetters = /[EFIKLPQ]/.test(seq.toUpperCase())
    console.log(`\n[${name}] type=${type}`)
    console.log(`  sequence(${seq.length}): ${seq.slice(0, 60)}${seq.length > 60 ? '...' : ''}`)
    console.log(`  amino_acid_sequence(${aa.length}): ${aa.slice(0, 60)}${aa.length > 60 ? '...' : ''}`)
    console.log(`  清理后 DNA 长度: ${dnaOnly.length}, 是否含蛋白特有字母: ${hasProteinLetters}`)
    console.log(`  是否会被 DNA→DNA / DNA→AA 方向跳过: ${dnaOnly.length < 10 || hasProteinLetters}`)
  }

  db.close()
}

main().catch(e => { console.error(e); process.exit(1) })
