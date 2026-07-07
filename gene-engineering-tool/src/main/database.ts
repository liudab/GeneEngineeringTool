import initSqlJs, { Database } from 'sql.js'
import path from 'path'
import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import type {
  RestrictionEnzyme,
  Vector,
  VectorEnzymeSite,
  GeneSequence,
  GeneRelation,
  LabVector,
  GeneSequenceType,
  VectorPurpose,
  VectorHostType,
  VectorPromoterType,
  VectorType,
  Primer,
  PrimerCategory,
  PrimerAlignmentHit,
  SequencingFile,
  SequencingFileType,
  SequencingDirection
} from '../shared/types'

let db: Database
let dbPath: string

function saveDb(): void {
  const data = db.export()
  writeFileSync(dbPath, Buffer.from(data))
}

function queryAll<T = any>(sql: string, params: any[] = []): T[] {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const results: T[] = []
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T)
  }
  stmt.free()
  return results
}

function queryOne<T = any>(sql: string, params: any[] = []): T | undefined {
  const results = queryAll<T>(sql, params)
  return results[0]
}

function run(sql: string, params: any[] = []): void {
  db.run(sql, params)
  saveDb()
}

function lastInsertId(): number {
  const r = queryOne<{ id: number }>('SELECT last_insert_rowid() as id')
  return r?.id ?? 0
}

export async function initDatabase(): Promise<void> {
  const wasmPath = path.join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
  const wasmBinary = readFileSync(wasmPath)
  const SQL = await initSqlJs({ wasmBinary })
  dbPath = path.join(app.getPath('userData'), 'gene-engineering.db')

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')
  createTables()
}

function createTables(): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS restriction_enzymes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      source_organism TEXT NOT NULL,
      recognition_sequence TEXT NOT NULL,
      cut_position INTEGER NOT NULL,
      optimal_temp REAL DEFAULT 37.0,
      is_palindromic INTEGER DEFAULT 1
    )`)

  db.run(`
    CREATE TABLE IF NOT EXISTS vectors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'plasmid',
      size_bp INTEGER NOT NULL DEFAULT 0,
      description TEXT DEFAULT '',
      sequence TEXT DEFAULT '',
      backbone_id INTEGER REFERENCES vectors(id) ON DELETE SET NULL,
      purpose TEXT DEFAULT 'cloning',
      host_type TEXT DEFAULT 'ecoli',
      promoter_type TEXT DEFAULT 'none',
      is_recombinant INTEGER DEFAULT 0,
      antibiotic_resistance TEXT DEFAULT '',
      copy_number TEXT DEFAULT '',
      file_path TEXT DEFAULT '',
      topology TEXT DEFAULT 'circular',
      source_file TEXT DEFAULT ''
    )`)

  db.run(`
    CREATE TABLE IF NOT EXISTS vector_enzyme_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vector_id INTEGER NOT NULL REFERENCES vectors(id) ON DELETE CASCADE,
      enzyme_id INTEGER NOT NULL REFERENCES restriction_enzymes(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      is_unique INTEGER DEFAULT 1
    )`)

  db.run(`
    CREATE TABLE IF NOT EXISTS gene_sequences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gene_name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('mrna','cdna','genomic','protein')),
      species TEXT DEFAULT '',
      sequence TEXT DEFAULT '',
      accession_number TEXT DEFAULT '',
      description TEXT DEFAULT ''
    )`)

  db.run(`
    CREATE TABLE IF NOT EXISTS gene_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gene_id INTEGER NOT NULL REFERENCES gene_sequences(id) ON DELETE CASCADE,
      related_gene_id INTEGER NOT NULL REFERENCES gene_sequences(id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL
    )`)

  db.run(`
    CREATE TABLE IF NOT EXISTS lab_vectors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vector_id INTEGER REFERENCES vectors(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      insert_gene_id INTEGER REFERENCES gene_sequences(id) ON DELETE SET NULL,
      empty_vector_id INTEGER REFERENCES lab_vectors(id) ON DELETE SET NULL,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`)

  db.run('CREATE INDEX IF NOT EXISTS idx_enzyme_name ON restriction_enzymes(name)')
  db.run('CREATE INDEX IF NOT EXISTS idx_enzyme_seq ON restriction_enzymes(recognition_sequence)')
  db.run('CREATE INDEX IF NOT EXISTS idx_vector_name ON vectors(name)')
  db.run('CREATE INDEX IF NOT EXISTS idx_gene_name ON gene_sequences(gene_name)')
  db.run('CREATE INDEX IF NOT EXISTS idx_gene_type ON gene_sequences(type)')
  db.run('CREATE INDEX IF NOT EXISTS idx_lab_vector_name ON lab_vectors(name)')

  // 引物表
  db.run(`
    CREATE TABLE IF NOT EXISTS primers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sequence TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('universal','lab')),
      tm REAL,
      gc_content REAL,
      description TEXT DEFAULT '',
      source TEXT DEFAULT '用户添加',
      added_by TEXT DEFAULT '',
      added_at TEXT DEFAULT (datetime('now')),
      target_gene_id INTEGER REFERENCES gene_sequences(id) ON DELETE SET NULL,
      alignment_result TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`)
  db.run('CREATE INDEX IF NOT EXISTS idx_primer_name ON primers(name)')
  db.run('CREATE INDEX IF NOT EXISTS idx_primer_category ON primers(category)')
  db.run('CREATE INDEX IF NOT EXISTS idx_primer_seq ON primers(sequence)')

  // 测序文件表
  db.run(`
    CREATE TABLE IF NOT EXISTS sequencing_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL CHECK(file_type IN ('ab1','seq','fasta')),
      sample_name TEXT NOT NULL DEFAULT '',
      direction TEXT NOT NULL DEFAULT 'forward' CHECK(direction IN ('forward','reverse')),
      primer_id INTEGER REFERENCES primers(id) ON DELETE SET NULL,
      sequence TEXT DEFAULT '',
      trace_data TEXT DEFAULT '',
      peak_positions TEXT DEFAULT '',
      quality_values TEXT DEFAULT '',
      run_info TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`)
  db.run('CREATE INDEX IF NOT EXISTS idx_seq_file_name ON sequencing_files(file_name)')
  db.run('CREATE INDEX IF NOT EXISTS idx_seq_sample_name ON sequencing_files(sample_name)')
  db.run('CREATE INDEX IF NOT EXISTS idx_seq_direction ON sequencing_files(direction)')
  db.run('CREATE INDEX IF NOT EXISTS idx_seq_primer ON sequencing_files(primer_id)')
  // 兼容迁移
  try { db.run('ALTER TABLE primers ADD COLUMN source TEXT DEFAULT \'用户添加\'') } catch { /* 已存在 */ }
  try { db.run('ALTER TABLE primers ADD COLUMN added_by TEXT DEFAULT \'\'') } catch { /* 已存在 */ }
  try { db.run('ALTER TABLE primers ADD COLUMN added_at TEXT DEFAULT (datetime(\'now\'))') } catch { /* 已存在 */ }

  // 迁移: 为已有 vectors 表添加新列
  migrateVectorsTable()

  saveDb()
}

function migrateVectorsTable(): void {
  const cols = queryAll<{ name: string }>('PRAGMA table_info(vectors)').map(r => r.name)
  const newCols: [string, string][] = [
    ['purpose', "TEXT DEFAULT 'cloning'"],
    ['host_type', "TEXT DEFAULT 'ecoli'"],
    ['promoter_type', "TEXT DEFAULT 'none'"],
    ['is_recombinant', 'INTEGER DEFAULT 0'],
    ['antibiotic_resistance', "TEXT DEFAULT ''"],
    ['copy_number', "TEXT DEFAULT ''"],
    ['file_path', "TEXT DEFAULT ''"],
    ['topology', "TEXT DEFAULT 'circular'"],
    ['source_file', "TEXT DEFAULT ''"]
  ]
  for (const [col, colDef] of newCols) {
    if (!cols.includes(col)) {
      db.run(`ALTER TABLE vectors ADD COLUMN ${col} ${colDef}`)
    }
  }
}

// ============ 限制性内切酶 CRUD ============

export function getEnzymes(): RestrictionEnzyme[] {
  return queryAll<RestrictionEnzyme>('SELECT * FROM restriction_enzymes ORDER BY name')
}

export function getEnzyme(id: number): RestrictionEnzyme | undefined {
  return queryOne<RestrictionEnzyme>('SELECT * FROM restriction_enzymes WHERE id = ?', [id])
}

export function searchEnzymes(query: string): RestrictionEnzyme[] {
  const q = `%${query}%`
  return queryAll<RestrictionEnzyme>(
    'SELECT * FROM restriction_enzymes WHERE name LIKE ?1 OR source_organism LIKE ?1 OR recognition_sequence LIKE ?1 ORDER BY name', [q]
  )
}

export function createEnzyme(data: Omit<RestrictionEnzyme, 'id'>): number {
  run(
    'INSERT INTO restriction_enzymes (name, source_organism, recognition_sequence, cut_position, optimal_temp, is_palindromic) VALUES (?, ?, ?, ?, ?, ?)',
    [data.name, data.source_organism, data.recognition_sequence, data.cut_position, data.optimal_temp, data.is_palindromic ? 1 : 0]
  )
  return lastInsertId()
}

export function updateEnzyme(id: number, data: Partial<RestrictionEnzyme>): void {
  const fields: string[] = []
  const values: unknown[] = []
  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
  if (data.source_organism !== undefined) { fields.push('source_organism = ?'); values.push(data.source_organism) }
  if (data.recognition_sequence !== undefined) { fields.push('recognition_sequence = ?'); values.push(data.recognition_sequence) }
  if (data.cut_position !== undefined) { fields.push('cut_position = ?'); values.push(data.cut_position) }
  if (data.optimal_temp !== undefined) { fields.push('optimal_temp = ?'); values.push(data.optimal_temp) }
  if (data.is_palindromic !== undefined) { fields.push('is_palindromic = ?'); values.push(data.is_palindromic ? 1 : 0) }
  if (fields.length === 0) return
  values.push(id)
  run(`UPDATE restriction_enzymes SET ${fields.join(', ')} WHERE id = ?`, values)
}

export function deleteEnzyme(id: number): void {
  run('DELETE FROM restriction_enzymes WHERE id = ?', [id])
}

// ============ 载体 CRUD ============

export function getVectors(): Vector[] {
  return queryAll<Vector>('SELECT * FROM vectors ORDER BY name')
}

export function getVector(id: number): Vector | undefined {
  return queryOne<Vector>('SELECT * FROM vectors WHERE id = ?', [id])
}

export function createVector(data: Omit<Vector, 'id'>): number {
  run(
    `INSERT INTO vectors (name, type, size_bp, description, sequence, backbone_id,
      purpose, host_type, promoter_type, is_recombinant, antibiotic_resistance,
      copy_number, file_path, topology, source_file)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.name, data.type, data.size_bp, data.description, data.sequence, data.backbone_id,
     data.purpose || 'cloning', data.host_type || 'ecoli', data.promoter_type || 'none',
     data.is_recombinant ? 1 : 0, data.antibiotic_resistance || '',
     data.copy_number || '', data.file_path || '', data.topology || 'circular', data.source_file || '']
  )
  return lastInsertId()
}

export function updateVector(id: number, data: Partial<Vector>): void {
  const fields: string[] = []
  const values: unknown[] = []
  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
  if (data.type !== undefined) { fields.push('type = ?'); values.push(data.type) }
  if (data.size_bp !== undefined) { fields.push('size_bp = ?'); values.push(data.size_bp) }
  if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
  if (data.sequence !== undefined) { fields.push('sequence = ?'); values.push(data.sequence) }
  if (data.backbone_id !== undefined) { fields.push('backbone_id = ?'); values.push(data.backbone_id) }
  if (data.purpose !== undefined) { fields.push('purpose = ?'); values.push(data.purpose) }
  if (data.host_type !== undefined) { fields.push('host_type = ?'); values.push(data.host_type) }
  if (data.promoter_type !== undefined) { fields.push('promoter_type = ?'); values.push(data.promoter_type) }
  if (data.is_recombinant !== undefined) { fields.push('is_recombinant = ?'); values.push(data.is_recombinant ? 1 : 0) }
  if (data.antibiotic_resistance !== undefined) { fields.push('antibiotic_resistance = ?'); values.push(data.antibiotic_resistance) }
  if (data.copy_number !== undefined) { fields.push('copy_number = ?'); values.push(data.copy_number) }
  if (data.file_path !== undefined) { fields.push('file_path = ?'); values.push(data.file_path) }
  if (data.topology !== undefined) { fields.push('topology = ?'); values.push(data.topology) }
  if (data.source_file !== undefined) { fields.push('source_file = ?'); values.push(data.source_file) }
  if (fields.length === 0) return
  values.push(id)
  run(`UPDATE vectors SET ${fields.join(', ')} WHERE id = ?`, values)
}

export function deleteVector(id: number): void {
  run('DELETE FROM vectors WHERE id = ?', [id])
}

export function getVectorEnzymeSites(vectorId: number): VectorEnzymeSite[] {
  return queryAll(`
    SELECT ves.*, re.name as enzyme_name, re.recognition_sequence, re.source_organism, re.cut_position, re.optimal_temp, re.is_palindromic
    FROM vector_enzyme_sites ves
    JOIN restriction_enzymes re ON ves.enzyme_id = re.id
    WHERE ves.vector_id = ?
    ORDER BY ves.position
  `, [vectorId]) as any[]
}

export function addVectorEnzymeSite(vectorId: number, enzymeId: number, position: number, isUnique: boolean): number {
  run(
    'INSERT INTO vector_enzyme_sites (vector_id, enzyme_id, position, is_unique) VALUES (?, ?, ?, ?)',
    [vectorId, enzymeId, position, isUnique ? 1 : 0]
  )
  return lastInsertId()
}

export function removeVectorEnzymeSite(id: number): void {
  run('DELETE FROM vector_enzyme_sites WHERE id = ?', [id])
}

// ============ 基因序列 CRUD ============

export function getGenes(type?: GeneSequenceType): GeneSequence[] {
  if (type) {
    return queryAll<GeneSequence>('SELECT * FROM gene_sequences WHERE type = ? ORDER BY gene_name', [type])
  }
  return queryAll<GeneSequence>('SELECT * FROM gene_sequences ORDER BY gene_name')
}

export function getGene(id: number): GeneSequence | undefined {
  return queryOne<GeneSequence>('SELECT * FROM gene_sequences WHERE id = ?', [id])
}

export function searchGenes(query: string, type?: GeneSequenceType): GeneSequence[] {
  const q = `%${query}%`
  if (type) {
    return queryAll<GeneSequence>(
      'SELECT * FROM gene_sequences WHERE (gene_name LIKE ?1 OR species LIKE ?1 OR accession_number LIKE ?1 OR description LIKE ?1) AND type = ?2 ORDER BY gene_name',
      [q, type]
    )
  }
  return queryAll<GeneSequence>(
    'SELECT * FROM gene_sequences WHERE gene_name LIKE ?1 OR species LIKE ?1 OR accession_number LIKE ?1 OR description LIKE ?1 ORDER BY gene_name',
    [q]
  )
}

export function createGene(data: Omit<GeneSequence, 'id'>): number {
  run(
    'INSERT INTO gene_sequences (gene_name, type, species, sequence, accession_number, description) VALUES (?, ?, ?, ?, ?, ?)',
    [data.gene_name, data.type, data.species, data.sequence, data.accession_number, data.description]
  )
  return lastInsertId()
}

export function updateGene(id: number, data: Partial<GeneSequence>): void {
  const fields: string[] = []
  const values: unknown[] = []
  if (data.gene_name !== undefined) { fields.push('gene_name = ?'); values.push(data.gene_name) }
  if (data.type !== undefined) { fields.push('type = ?'); values.push(data.type) }
  if (data.species !== undefined) { fields.push('species = ?'); values.push(data.species) }
  if (data.sequence !== undefined) { fields.push('sequence = ?'); values.push(data.sequence) }
  if (data.accession_number !== undefined) { fields.push('accession_number = ?'); values.push(data.accession_number) }
  if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
  if (fields.length === 0) return
  values.push(id)
  run(`UPDATE gene_sequences SET ${fields.join(', ')} WHERE id = ?`, values)
}

export function deleteGene(id: number): void {
  run('DELETE FROM gene_sequences WHERE id = ?', [id])
}

export function getGeneRelations(geneId: number): GeneRelation[] {
  return queryAll(`
    SELECT gr.*, gs.gene_name as related_name, gs.type as related_type
    FROM gene_relations gr
    JOIN gene_sequences gs ON gr.related_gene_id = gs.id
    WHERE gr.gene_id = ?
    UNION
    SELECT gr.*, gs.gene_name as related_name, gs.type as related_type
    FROM gene_relations gr
    JOIN gene_sequences gs ON gr.gene_id = gs.id
    WHERE gr.related_gene_id = ?
  `, [geneId, geneId]) as any[]
}

export function addGeneRelation(geneId: number, relatedGeneId: number, relationType: string): number {
  run(
    'INSERT INTO gene_relations (gene_id, related_gene_id, relation_type) VALUES (?, ?, ?)',
    [geneId, relatedGeneId, relationType]
  )
  return lastInsertId()
}

export function removeGeneRelation(id: number): void {
  run('DELETE FROM gene_relations WHERE id = ?', [id])
}

// ============ 实验室载体 CRUD ============

export function getLabVectors(): LabVector[] {
  return queryAll(`
    SELECT lv.*, v.name as vector_name, v.type as vector_type,
           gs.gene_name as insert_gene_name,
           elv.name as empty_vector_name
    FROM lab_vectors lv
    LEFT JOIN vectors v ON lv.vector_id = v.id
    LEFT JOIN gene_sequences gs ON lv.insert_gene_id = gs.id
    LEFT JOIN lab_vectors elv ON lv.empty_vector_id = elv.id
    ORDER BY lv.name
  `) as any[]
}

export function getLabVector(id: number): LabVector | undefined {
  return queryOne(`
    SELECT lv.*, v.name as vector_name, v.type as vector_type,
           gs.gene_name as insert_gene_name,
           elv.name as empty_vector_name
    FROM lab_vectors lv
    LEFT JOIN vectors v ON lv.vector_id = v.id
    LEFT JOIN gene_sequences gs ON lv.insert_gene_id = gs.id
    LEFT JOIN lab_vectors elv ON lv.empty_vector_id = elv.id
    WHERE lv.id = ?
  `, [id]) as any
}

export function createLabVector(data: Omit<LabVector, 'id' | 'created_at'>): number {
  run(
    'INSERT INTO lab_vectors (vector_id, name, insert_gene_id, empty_vector_id, notes) VALUES (?, ?, ?, ?, ?)',
    [data.vector_id, data.name, data.insert_gene_id, data.empty_vector_id, data.notes]
  )
  return lastInsertId()
}

export function updateLabVector(id: number, data: Partial<LabVector>): void {
  const fields: string[] = []
  const values: unknown[] = []
  if (data.vector_id !== undefined) { fields.push('vector_id = ?'); values.push(data.vector_id) }
  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
  if (data.insert_gene_id !== undefined) { fields.push('insert_gene_id = ?'); values.push(data.insert_gene_id) }
  if (data.empty_vector_id !== undefined) { fields.push('empty_vector_id = ?'); values.push(data.empty_vector_id) }
  if (data.notes !== undefined) { fields.push('notes = ?'); values.push(data.notes) }
  if (fields.length === 0) return
  values.push(id)
  run(`UPDATE lab_vectors SET ${fields.join(', ')} WHERE id = ?`, values)
}

export function deleteLabVector(id: number): void {
  run('DELETE FROM lab_vectors WHERE id = ?', [id])
}

// ============ 种子数据 ============

export function seedEnzymes(): void {
  const count = queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM restriction_enzymes')
  if (count && count.cnt > 0) return

  const enzymes: Omit<RestrictionEnzyme, 'id'>[] = [
    { name: 'EcoRI', source_organism: 'Escherichia coli RY13', recognition_sequence: 'GAATTC', cut_position: 1, optimal_temp: 37, is_palindromic: true },
    { name: 'BamHI', source_organism: 'Bacillus amyloliquefaciens H', recognition_sequence: 'GGATCC', cut_position: 1, optimal_temp: 37, is_palindromic: true },
    { name: 'HindIII', source_organism: 'Haemophilus influenzae Rd', recognition_sequence: 'AAGCTT', cut_position: 1, optimal_temp: 37, is_palindromic: true },
    { name: 'NotI', source_organism: 'Nocardia otitidis', recognition_sequence: 'GCGGCCGC', cut_position: 2, optimal_temp: 37, is_palindromic: true },
    { name: 'XhoI', source_organism: 'Xanthomonas holcicola', recognition_sequence: 'CTCGAG', cut_position: 1, optimal_temp: 37, is_palindromic: true },
    { name: 'SalI', source_organism: 'Streptomyces albus G', recognition_sequence: 'GTCGAC', cut_position: 1, optimal_temp: 37, is_palindromic: true },
    { name: 'XbaI', source_organism: 'Xanthomonas badrii', recognition_sequence: 'TCTAGA', cut_position: 1, optimal_temp: 37, is_palindromic: true },
    { name: 'PstI', source_organism: 'Providencia stuartii', recognition_sequence: 'CTGCAG', cut_position: 5, optimal_temp: 37, is_palindromic: true },
    { name: 'SmaI', source_organism: 'Serratia marcescens', recognition_sequence: 'CCCGGG', cut_position: 3, optimal_temp: 25, is_palindromic: true },
    { name: 'KpnI', source_organism: 'Klebsiella pneumoniae', recognition_sequence: 'GGTACC', cut_position: 5, optimal_temp: 37, is_palindromic: true },
    { name: 'SacI', source_organism: 'Streptomyces achromogenes', recognition_sequence: 'GAGCTC', cut_position: 5, optimal_temp: 37, is_palindromic: true },
    { name: 'NcoI', source_organism: 'Nocardia corallina', recognition_sequence: 'CCATGG', cut_position: 1, optimal_temp: 37, is_palindromic: true },
    { name: 'NdeI', source_organism: 'Neisseria denitrificans', recognition_sequence: 'CATATG', cut_position: 2, optimal_temp: 37, is_palindromic: true },
    { name: 'ApaI', source_organism: 'Acetobacter pasteurianus', recognition_sequence: 'GGGCCC', cut_position: 5, optimal_temp: 25, is_palindromic: true },
    { name: 'ClaI', source_organism: 'Caryophanon latum', recognition_sequence: 'ATCGAT', cut_position: 2, optimal_temp: 37, is_palindromic: true },
    { name: 'EcoRV', source_organism: 'Escherichia coli RFL5', recognition_sequence: 'GATATC', cut_position: 3, optimal_temp: 37, is_palindromic: true },
    { name: 'SpeI', source_organism: 'Sphaerotilus natans', recognition_sequence: 'ACTAGT', cut_position: 1, optimal_temp: 37, is_palindromic: true },
    { name: 'BglII', source_organism: 'Bacillus globigii', recognition_sequence: 'AGATCT', cut_position: 1, optimal_temp: 37, is_palindromic: true },
    { name: 'NheI', source_organism: 'Nocardia hinshawii', recognition_sequence: 'GCTAGC', cut_position: 1, optimal_temp: 37, is_palindromic: true },
    { name: 'MluI', source_organism: 'Micrococcus luteus', recognition_sequence: 'ACGCGT', cut_position: 1, optimal_temp: 37, is_palindromic: true },
    { name: 'SphI', source_organism: 'Streptomyces phaeochromogenes', recognition_sequence: 'GCATGC', cut_position: 5, optimal_temp: 37, is_palindromic: true },
    { name: 'DraI', source_organism: 'Deinococcus radiophilus', recognition_sequence: 'TTTAAA', cut_position: 3, optimal_temp: 37, is_palindromic: true },
    { name: 'HaeIII', source_organism: 'Haemophilus aegyptius', recognition_sequence: 'GGCC', cut_position: 2, optimal_temp: 37, is_palindromic: true },
    { name: 'AluI', source_organism: 'Arthrobacter luteus', recognition_sequence: 'AGCT', cut_position: 2, optimal_temp: 37, is_palindromic: true },
    { name: 'TaqI', source_organism: 'Thermus aquaticus', recognition_sequence: 'TCGA', cut_position: 1, optimal_temp: 65, is_palindromic: true },
    { name: 'HpaI', source_organism: 'Haemophilus parainfluenzae', recognition_sequence: 'GTTAAC', cut_position: 3, optimal_temp: 37, is_palindromic: true },
    { name: 'BsaI', source_organism: 'Bacillus stearothermophilus', recognition_sequence: 'GGTCTC', cut_position: 7, optimal_temp: 37, is_palindromic: false },
    { name: 'BbsI', source_organism: 'Bacillus brevis', recognition_sequence: 'GAAGAC', cut_position: 8, optimal_temp: 37, is_palindromic: false },
    { name: 'BsmBI', source_organism: 'Bacillus smithii', recognition_sequence: 'CGTCTC', cut_position: 7, optimal_temp: 55, is_palindromic: false },
    { name: 'SapI', source_organism: 'Sphingomonas paucimobilis', recognition_sequence: 'GCTCTTC', cut_position: 8, optimal_temp: 37, is_palindromic: false },
    { name: 'SfiI', source_organism: 'Streptomyces fimbriatus', recognition_sequence: 'GGCCNNNNNGGCC', cut_position: 8, optimal_temp: 50, is_palindromic: true },
    { name: 'FokI', source_organism: 'Flavobacterium okeanokoites', recognition_sequence: 'GGATG', cut_position: 14, optimal_temp: 37, is_palindromic: false },
    { name: 'StuI', source_organism: 'Streptomyces tubercidicus', recognition_sequence: 'AGGCCT', cut_position: 3, optimal_temp: 37, is_palindromic: true },
    { name: 'NarI', source_organism: 'Nocardia asteroides', recognition_sequence: 'GGCGCC', cut_position: 2, optimal_temp: 37, is_palindromic: true },
    { name: 'PvuI', source_organism: 'Proteus vulgaris', recognition_sequence: 'CGATCG', cut_position: 4, optimal_temp: 37, is_palindromic: true },
    { name: 'PvuII', source_organism: 'Proteus vulgaris', recognition_sequence: 'CAGCTG', cut_position: 3, optimal_temp: 37, is_palindromic: true },
    { name: 'AflII', source_organism: 'Anabaena flos-aquae', recognition_sequence: 'CTTAAG', cut_position: 1, optimal_temp: 37, is_palindromic: true },
    { name: 'AscI', source_organism: 'Archaeoglobus fulgidus', recognition_sequence: 'GGCGCGCC', cut_position: 2, optimal_temp: 37, is_palindromic: true },
    { name: 'AvrII', source_organism: 'Anabaena variabilis', recognition_sequence: 'CCTAGG', cut_position: 1, optimal_temp: 37, is_palindromic: true },
    { name: 'BclI', source_organism: 'Bacillus caldolyticus', recognition_sequence: 'TGATCA', cut_position: 1, optimal_temp: 55, is_palindromic: true },
    { name: 'EagI', source_organism: 'Enterobacter agglomerans', recognition_sequence: 'CGGCCG', cut_position: 1, optimal_temp: 37, is_palindromic: true },
    { name: 'PacI', source_organism: 'Pseudomonas alcaligenes', recognition_sequence: 'TTAATTAA', cut_position: 5, optimal_temp: 37, is_palindromic: true },
    { name: 'SwaI', source_organism: 'Staphylococcus warneri', recognition_sequence: 'ATTTAAAT', cut_position: 4, optimal_temp: 25, is_palindromic: true },
    { name: 'AarI', source_organism: 'Arthrobacter aurescens', recognition_sequence: 'CACCTGC', cut_position: 11, optimal_temp: 37, is_palindromic: false },
    { name: 'I-SceI', source_organism: 'Saccharomyces cerevisiae', recognition_sequence: 'TAGGGATAACAGGGTAAT', cut_position: 9, optimal_temp: 37, is_palindromic: false },
    { name: 'BstXI', source_organism: 'Bacillus stearothermophilus', recognition_sequence: 'CCANNNNNNTGG', cut_position: 6, optimal_temp: 55, is_palindromic: true },
    { name: 'AccI', source_organism: 'Acinetobacter calcoaceticus', recognition_sequence: 'GTMKAC', cut_position: 1, optimal_temp: 37, is_palindromic: true },
    { name: 'BpiI', source_organism: 'Bacillus pumilus', recognition_sequence: 'GAAGAC', cut_position: 8, optimal_temp: 37, is_palindromic: false },
    { name: 'AvaI', source_organism: 'Anabaena variabilis', recognition_sequence: 'CYCGRG', cut_position: 1, optimal_temp: 37, is_palindromic: true },
    { name: 'BstBI', source_organism: 'Bacillus stearothermophilus', recognition_sequence: 'TTCGAA', cut_position: 2, optimal_temp: 55, is_palindromic: true }
  ]

  for (const e of enzymes) {
    db.run(
      'INSERT OR IGNORE INTO restriction_enzymes (name, source_organism, recognition_sequence, cut_position, optimal_temp, is_palindromic) VALUES (?, ?, ?, ?, ?, ?)',
      [e.name, e.source_organism, e.recognition_sequence, e.cut_position, e.optimal_temp, e.is_palindromic ? 1 : 0]
    )
  }
  saveDb()
}

// ============ 引物 CRUD ============

export function getPrimers(category?: PrimerCategory): Primer[] {
  if (category) {
    return queryAll<Primer>('SELECT * FROM primers WHERE category = ? ORDER BY name', [category])
  }
  return queryAll<Primer>('SELECT * FROM primers ORDER BY name')
}

export function getPrimer(id: number): Primer | undefined {
  return queryOne<Primer>('SELECT * FROM primers WHERE id = ?', [id])
}

export function searchPrimers(query: string, category?: PrimerCategory): Primer[] {
  const q = `%${query}%`
  if (category) {
    return queryAll<Primer>(
      'SELECT * FROM primers WHERE (name LIKE ?1 OR sequence LIKE ?1 OR description LIKE ?1) AND category = ?2 ORDER BY name',
      [q, category]
    )
  }
  return queryAll<Primer>(
    'SELECT * FROM primers WHERE name LIKE ?1 OR sequence LIKE ?1 OR description LIKE ?1 ORDER BY name',
    [q]
  )
}

export function createPrimer(data: Omit<Primer, 'id' | 'created_at'>): number {
  run(
    'INSERT INTO primers (name, sequence, category, tm, gc_content, description, target_gene_id, alignment_result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [data.name, data.sequence, data.category, data.tm ?? null, data.gc_content ?? null, data.description ?? '', data.target_gene_id ?? null, data.alignment_result ?? '']
  )
  return lastInsertId()
}

export function updatePrimer(id: number, data: Partial<Primer>): void {
  const fields: string[] = []
  const values: unknown[] = []
  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
  if (data.sequence !== undefined) { fields.push('sequence = ?'); values.push(data.sequence) }
  if (data.category !== undefined) { fields.push('category = ?'); values.push(data.category) }
  if (data.tm !== undefined) { fields.push('tm = ?'); values.push(data.tm) }
  if (data.gc_content !== undefined) { fields.push('gc_content = ?'); values.push(data.gc_content) }
  if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
  if (data.target_gene_id !== undefined) { fields.push('target_gene_id = ?'); values.push(data.target_gene_id) }
  if (data.alignment_result !== undefined) { fields.push('alignment_result = ?'); values.push(data.alignment_result) }
  if (fields.length === 0) return
  values.push(id)
  run(`UPDATE primers SET ${fields.join(', ')} WHERE id = ?`, values)
}

export function deletePrimer(id: number): void {
  run('DELETE FROM primers WHERE id = ?', [id])
}

// ============ 引物序列比对 ============

function reverseComplement(seq: string): string {
  const comp: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G', a: 't', t: 'a', g: 'c', c: 'g' }
  return seq.split('').reverse().map(c => comp[c] || c).join('')
}

export function alignPrimerToGenes(primerId: number): PrimerAlignmentHit[] {
  const primer = getPrimer(primerId)
  if (!primer || !primer.sequence) return []
  const seq = primer.sequence.toUpperCase()
  const rcSeq = reverseComplement(seq)
  const genes = queryAll<GeneSequence>('SELECT * FROM gene_sequences WHERE sequence IS NOT NULL AND sequence != ""')
  const hits: PrimerAlignmentHit[] = []

  for (const gene of genes) {
    const geneSeq = gene.sequence.toUpperCase()
    if (geneSeq.length < seq.length) continue
    const fwdIdx = geneSeq.indexOf(seq)
    if (fwdIdx !== -1) {
      hits.push({ gene_id: gene.id, gene_name: gene.gene_name, match_start: fwdIdx + 1, match_end: fwdIdx + seq.length, strand: 1, identity: 100 })
      continue
    }
    const rcIdx = geneSeq.indexOf(rcSeq)
    if (rcIdx !== -1) {
      hits.push({ gene_id: gene.id, gene_name: gene.gene_name, match_start: rcIdx + 1, match_end: rcIdx + rcSeq.length, strand: -1, identity: 100 })
      continue
    }
    // 模糊匹配（允许1错配）—— 正向 + 反向互补
    let found = false
    for (let i = 0; i <= geneSeq.length - seq.length; i++) {
      const sub = geneSeq.substring(i, i + seq.length)
      let mismatches = 0
      for (let j = 0; j < seq.length; j++) { if (seq[j] !== sub[j]) mismatches++; if (mismatches > 1) break }
      if (mismatches <= 1) {
        hits.push({ gene_id: gene.id, gene_name: gene.gene_name, match_start: i + 1, match_end: i + seq.length, strand: 1, identity: Math.round(((seq.length - mismatches) / seq.length) * 100) })
        found = true; break
      }
    }
    if (!found) {
      // 反向互补模糊匹配
      for (let i = 0; i <= geneSeq.length - rcSeq.length; i++) {
        const sub = geneSeq.substring(i, i + rcSeq.length)
        let mismatches = 0
        for (let j = 0; j < rcSeq.length; j++) { if (rcSeq[j] !== sub[j]) mismatches++; if (mismatches > 1) break }
        if (mismatches <= 1) {
          hits.push({ gene_id: gene.id, gene_name: gene.gene_name, match_start: i + 1, match_end: i + rcSeq.length, strand: -1, identity: Math.round(((rcSeq.length - mismatches) / rcSeq.length) * 100) })
          break
        }
      }
    }
  }
  if (hits.length > 0) { updatePrimer(primerId, { target_gene_id: hits[0].gene_id, alignment_result: JSON.stringify(hits) }) }
  return hits
}

// ============ 载体序列引物扫描（编辑器用） ============

/** 扫描载体序列，返回所有匹配的通用引物位点 */
export function scanVectorForUniversalPrimers(vectorSeq: string): import('./types').PrimerSiteInfo[] {
  if (!vectorSeq) return []
  const seq = vectorSeq.toUpperCase().replace(/[^ATGC]/g, '')
  const seqLen = seq.length
  const comp: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' }
  const revComp = (s: string) => s.split('').reverse().map(c => comp[c] || c).join('')

  const primers = queryAll<Primer>("SELECT * FROM primers WHERE category = 'universal'")
  const results: import('./types').PrimerSiteInfo[] = []

  for (const primer of primers) {
    const pSeq = primer.sequence.toUpperCase().replace(/[^ATGC]/g, '')
    if (pSeq.length < 10) continue

    // 正向匹配
    let pos = seq.indexOf(pSeq)
    if (pos >= 0) {
      results.push({
        primer_id: primer.id, primer_name: primer.name, sequence: pSeq,
        position: pos + 1, recog_start: pos + 1, recog_end: pos + pSeq.length, strand: 1
      })
    }

    // 反向互补匹配
    const rc = revComp(pSeq)
    pos = seq.indexOf(rc)
    if (pos >= 0) {
      results.push({
        primer_id: primer.id, primer_name: primer.name, sequence: pSeq,
        position: pos + 1, recog_start: pos + 1, recog_end: pos + pSeq.length, strand: -1
      })
    }
  }

  return results
}

// ============ 通用引物种子数据 ============

const UNIVERSAL_PRIMERS: [string, string][] = [
  ['M13F', 'TGTAAAACGACGGCCAGT'], ['M13R', 'CAGGAAACAGCTATGAC'],
  ['M13F-47', 'CGCCAGGGTTTTCCCAGTCACGAC'], ['M13R-48', 'GAGCGGATAACAATTTCACACAGG'],
  ['T7', 'TAATACGACTCACTATAGGG'], ['T7-term', 'GCTAGTTATTGCTCAGCGG'],
  ['SP6', 'ATTTAGGTGACACTATAG'], ['T3', 'ATTAACCCTCACTAAAGG'],
  ['pUC-F', 'GTTTTCCCAGTCACGAC'], ['pUC-R', 'CAGGAAACAGCTATGAC'],
  ['CMV-F', 'CGCAAATGGGCGGTAGGCGTG'], ['BGH-R', 'TAGAAGGCACAGTCGAGG'],
  ['SV40-F', 'GACTCCTTCTGTGGACGTC'], ['SV40-R', 'AGCAATCCATCTTCTTGTGTG'],
  ['RV-M', 'CAGGAAACAGCTATGAC'],
  ['pGEX-F', 'GGGCTGGCAAGCCACGTTTGGTG'], ['pGEX-R', 'CCGGGAATGCCCGAATATCTGGT'],
  ['pET-F', 'TGCTAGTTATTGCTCAGCGG'],
  ['EGFP-F', 'CAAGCTGACCCTGAAGTTC'], ['EGFP-R', 'TACAGCTCGTCCATGCC'],
  ['Flag-F', 'GATTACAAGGATGACGACGATAAG'], ['HA-F', 'TACCCATACGATGTTCCAGATTACGCT'],
  ['Myc-F', 'GAACAAAAACTCATCTCAGAAGAGGATCTG'], ['His-F', 'CACCATCACCATCACCAT'],
  ['27F', 'AGAGTTTGATCCTGGCTCAG'], ['1492R', 'TACGGCTACCTTGTTACGACTT'],
  ['ITS1', 'TCCGTAGGTGAACCTGCGG'], ['ITS4', 'TCCTCCGCTTATTGATATGC'],
  ['U6-F', 'GAGGGCCTATTTCCCATGATTC'], ['EF1a-F', 'CTGAACTTCAAACCTCTG'],
  ['GAPDH-F', 'GAAGGTGAAGGTCGGAGTC'], ['GAPDH-R', 'GAAGATGGTGATGGGATTTC'],
  ['beta-actin-F', 'CATGTACGTTGCTATCCAGGC'], ['beta-actin-R', 'CTCCTTAATGTCACGCACGAT'],
  ['WPRE-R', 'CATAGCGTAAAAGGAGCAACA'], ['EF1a-R', 'GAGCCAGTACACGACATCAC'],
  ['35S-F', 'GACGCACAATCCCACTATCC'], ['NOS-R', 'GATCGCAAGACCGGCAACAG']
]

export function seedUniversalPrimers(): void {
  const count = queryOne<{ cnt: number }>("SELECT COUNT(*) as cnt FROM primers WHERE category = 'universal'")
  if (count && count.cnt > 0) return
  for (const [name, seq] of UNIVERSAL_PRIMERS) {
    db.run(`INSERT OR IGNORE INTO primers (name, sequence, category, tm, gc_content, description, source, added_by) VALUES (?, ?, 'universal', ?, ?, '通用引物', '测序公司提供', '擎科生物')`, [name, seq, calcTm(seq), calcGcContent(seq)])
  }
  saveDb()
}

function calcGcContent(seq: string): number {
  const upper = seq.toUpperCase()
  return Math.round(((upper.match(/[GC]/g) || []).length / upper.length) * 1000) / 10
}

function calcTm(seq: string): number {
  const s = seq.toUpperCase()
  const a = (s.match(/A/g) || []).length, t = (s.match(/T/g) || []).length
  const g = (s.match(/G/g) || []).length, c = (s.match(/C/g) || []).length
  if (s.length < 14) return 2 * (a + t) + 4 * (g + c)
  return Math.round((64.9 + 41 * (g + c - 16.4) / s.length) * 10) / 10
}

// ============ 测序文件 CRUD ============

export function getSequencingFiles(): SequencingFile[] {
  return queryAll<SequencingFile>(`
    SELECT sf.*, p.name as primer_name
    FROM sequencing_files sf
    LEFT JOIN primers p ON sf.primer_id = p.id
    ORDER BY sf.created_at DESC
  `)
}

export function getSequencingFile(id: number): SequencingFile | undefined {
  return queryOne<SequencingFile>(`
    SELECT sf.*, p.name as primer_name
    FROM sequencing_files sf
    LEFT JOIN primers p ON sf.primer_id = p.id
    WHERE sf.id = ?
  `, [id])
}

export function searchSequencingFiles(query: string): SequencingFile[] {
  const q = `%${query}%`
  return queryAll<SequencingFile>(`
    SELECT sf.*, p.name as primer_name
    FROM sequencing_files sf
    LEFT JOIN primers p ON sf.primer_id = p.id
    WHERE sf.file_name LIKE ?1 OR sf.sample_name LIKE ?1 OR sf.notes LIKE ?1
    ORDER BY sf.created_at DESC
  `, [q])
}

export function createSequencingFile(data: Omit<SequencingFile, 'id' | 'created_at' | 'updated_at' | 'primer_name'>): number {
  run(
    `INSERT INTO sequencing_files (file_name, file_path, file_type, sample_name, direction, primer_id,
      sequence, trace_data, peak_positions, quality_values, run_info, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.file_name, data.file_path, data.file_type, data.sample_name, data.direction,
     data.primer_id, data.sequence, data.trace_data, data.peak_positions, data.quality_values,
     data.run_info, data.notes]
  )
  return lastInsertId()
}

export function updateSequencingFile(id: number, data: Partial<SequencingFile>): void {
  const fields: string[] = []
  const values: unknown[] = []
  if (data.file_name !== undefined) { fields.push('file_name = ?'); values.push(data.file_name) }
  if (data.file_path !== undefined) { fields.push('file_path = ?'); values.push(data.file_path) }
  if (data.file_type !== undefined) { fields.push('file_type = ?'); values.push(data.file_type) }
  if (data.sample_name !== undefined) { fields.push('sample_name = ?'); values.push(data.sample_name) }
  if (data.direction !== undefined) { fields.push('direction = ?'); values.push(data.direction) }
  if (data.primer_id !== undefined) { fields.push('primer_id = ?'); values.push(data.primer_id) }
  if (data.sequence !== undefined) { fields.push('sequence = ?'); values.push(data.sequence) }
  if (data.trace_data !== undefined) { fields.push('trace_data = ?'); values.push(data.trace_data) }
  if (data.peak_positions !== undefined) { fields.push('peak_positions = ?'); values.push(data.peak_positions) }
  if (data.quality_values !== undefined) { fields.push('quality_values = ?'); values.push(data.quality_values) }
  if (data.run_info !== undefined) { fields.push('run_info = ?'); values.push(data.run_info) }
  if (data.notes !== undefined) { fields.push('notes = ?'); values.push(data.notes) }
  if (fields.length === 0) return
  fields.push("updated_at = datetime('now')")
  values.push(id)
  run(`UPDATE sequencing_files SET ${fields.join(', ')} WHERE id = ?`, values)
}

export function deleteSequencingFile(id: number): void {
  run('DELETE FROM sequencing_files WHERE id = ?', [id])
}

export function importPrimersFromXlsx(buffer: Buffer): number {
  const XLSX = require('xlsx')
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const ws = wb.Sheets['引物序列']
  if (!ws) return 0
  const data: [string, string][] = XLSX.utils.sheet_to_json(ws, { header: 1 })
  let imported = 0
  for (const row of data) {
    const name = String(row[0] || '').trim()
    const seq = String(row[1] || '').trim().toUpperCase()
    if (!name || !seq || seq.length < 4) continue
    const existing = queryOne<{ id: number }>("SELECT id FROM primers WHERE name = ? AND category = 'universal'", [name])
    if (existing) continue
    db.run(`INSERT INTO primers (name, sequence, category, tm, gc_content, description) VALUES (?, ?, 'universal', ?, ?, '通用引物')`, [name, seq, calcTm(seq), calcGcContent(seq)])
    imported++
  }
  saveDb()
  return imported
}
