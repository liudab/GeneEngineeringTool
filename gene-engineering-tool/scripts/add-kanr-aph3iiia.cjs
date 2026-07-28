/**
 * 一次性脚本：将 Aio-24\pYL1300H 中 7947-8741 的 KanR-APH(3')-IIIa 加入元件数据库
 * 运行方式: node scripts/add-kanr-aph3iiia.cjs
 */
const initSqlJs = require('../node_modules/sql.js');
const fs = require('fs');
const path = require('path');

const CODON = {TTT:'F',TTC:'F',TTA:'L',TTG:'L',CTT:'L',CTC:'L',CTA:'L',CTG:'L',ATT:'I',ATC:'I',ATA:'I',ATG:'M',GTT:'V',GTC:'V',GTA:'V',GTG:'V',TCT:'S',TCC:'S',TCA:'S',TCG:'S',CCT:'P',CCC:'P',CCA:'P',CCG:'P',ACT:'T',ACC:'T',ACA:'T',ACG:'T',GCT:'A',GCC:'A',GCA:'A',GCG:'A',TAT:'Y',TAC:'Y',TAA:'*',TAG:'*',CAT:'H',CAC:'H',CAA:'Q',CAG:'Q',AAT:'N',AAC:'N',AAA:'K',AAG:'K',GAT:'D',GAC:'D',GAA:'E',GAG:'E',TGT:'C',TGC:'C',TGA:'*',TGG:'W',CGT:'R',CGC:'R',CGA:'R',CGG:'R',AGT:'S',AGC:'S',AGA:'R',AGG:'R',GGT:'G',GGC:'G',GGA:'G',GGG:'G'};

function translate(dna, frame = 0) {
  const seq = dna.toUpperCase().replace(/[^ATGC]/g, '');
  // 从 ATG 开始翻译
  const startIdx = seq.indexOf('ATG', frame);
  if (startIdx < 0) return '';
  let aa = '';
  for (let i = startIdx; i + 2 < seq.length; i += 3) {
    const codon = seq.substring(i, i + 3);
    const c = CODON[codon];
    if (!c || c === '*') break;
    aa += c;
  }
  return aa;
}

function rc(seq) {
  const comp = {'A':'T','T':'A','G':'C','C':'G','a':'t','t':'a','g':'c','c':'g'};
  return seq.split('').reverse().map(c => comp[c] || c).join('');
}

async function main() {
  const SQL = await initSqlJs();
  const dbPath = path.join(process.env.APPDATA, 'HelixCraft', 'gene-engineering.db');
  const buf = fs.readFileSync(dbPath);
  const db = new SQL.Database(buf);

  // 获取载体序列
  const vecRes = db.exec("SELECT sequence FROM vectors WHERE id = 17");
  const vecSeq = vecRes[0].values[0][0].toUpperCase();
  console.log('Vector sequence length:', vecSeq.length);

  // 提取 7947-8741 (0-based)
  const featDNA = vecSeq.substring(7947, 8741);
  const rcDNA = rc(featDNA);
  console.log('Feature DNA (7947-8741):', featDNA.length, 'bp');
  console.log('RC DNA:', rcDNA.length, 'bp');

  // 翻译 RC frame 0（从 ATG 开始）
  const aaSeq = translate(rcDNA, 0);
  console.log('Translated AA (from ATG):', aaSeq.length, 'aa');
  console.log('AA:', aaSeq);

  // 检查是否已存在
  const existRes = db.exec("SELECT id, standard_name FROM vector_components WHERE standard_name LIKE '%APH(3%'");
  if (existRes.length > 0 && existRes[0].values.length > 0) {
    console.log('\nAlready exists:', existRes[0].values.map(r => `${r[0]}: ${r[1]}`).join(', '));
  }

  // 插入新元件
  const standardName = "KanR-APH(3')-IIIa";
  const aliases = JSON.stringify(["KanR", "APH(3')-IIIa", "aph(3')-IIIa", "aminoglycoside phosphotransferase"]);
  const notes = "氨基糖苷磷酸转移酶 APH(3')-IIIa，来自葡萄球菌/肠球菌，赋予卡那霉素抗性。从载体 Aio-24\\pYL1300H 7947-8741 (反向链) 提取。";
  
  db.run(`INSERT INTO vector_components (
    sequence, standard_name, aliases, type, species, notes, amino_acid_sequence, similar_variants,
    feature_id, direction, species_short, species_latin, species_cn, taxonomic_category,
    ref_protein_sequence, molecular_weight, dna_variant_count, aa_variant_count,
    product_description, gene, bound_moiety, source_databases, total_occurrences,
    annotation_method, variants
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [
    rcDNA, standardName, aliases, 'resistance', 'Staphylococcus/Enterococcus', notes, aaSeq, '[]',
    '', 'reverse', '', '', '', '',
    '', 0, 0, 0,
    'aminoglycoside 3\'-phosphotransferase type IIIa', "aph(3')-IIIa", '',
    '', 1, 'manual', '[]'
  ]);

  // 保存数据库
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
  console.log('\n✅ Successfully added KanR-APH(3\')-IIIa to database!');
  console.log(`   DNA: ${rcDNA.length}bp`);
  console.log(`   AA: ${aaSeq.length}aa`);
  console.log(`   Type: resistance`);
  
  // 验证插入
  const verifyRes = db.exec("SELECT id, standard_name, sequence, amino_acid_sequence FROM vector_components WHERE standard_name LIKE '%APH(3%'");
  if (verifyRes.length > 0) {
    console.log('\nVerification - existing APH components:');
    for (const row of verifyRes[0].values) {
      console.log(`  id=${row[0]} name="${row[1]}" dnaLen=${(row[2]||'').length} aaLen=${(row[3]||'').length}`);
    }
  }

  db.close();
}

main().catch(e => { console.error('Error:', e); process.exit(1); });
