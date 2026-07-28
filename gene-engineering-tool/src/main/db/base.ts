/**
 * @module db/base
 * @description
 * 数据库基础设施模块 — 提供 SQLite (sql.js WASM) 底层工具、Schema 创建/迁移、备份恢复。
 *
 * 架构设计意图：
 * - 将数据库核心操作（连接管理、SQL 执行、持久化）集中在一个模块中
 * - 所有 Repository 模块（enzyme-repo, vector-repo 等）都从此模块导入底层工具
 * - 外部调用方（ipc.ts, index.ts）可通过 re-export 兼容入口访问
 *
 * 核心职责：
 * 1. 数据库实例管理（getDb, db 变量）
 * 2. SQL 执行原语（run, runNoSave, runBatch, queryAll, queryOne, lastInsertId, saveDb）
 * 3. Schema 创建与迁移（createTables, migrateEnzymeSchema, migrateVectorsTable）
 * 4. 数据库初始化（initDatabase）
 * 5. 数据目录管理（getDataDir, ensureFixedUserDataDir, migrateFromOldAppNames）
 * 6. 数据库备份与恢复（exportDatabase, restoreDatabase, createAutoBackup）
 * 7. 通用序列工具（reverseComplement, translateDNA, calcGcContent, calcTm）
 *
 * 依赖关系：
 * - sql.js (SQLite WASM)
 * - electron app (路径管理)
 * - fs/path (文件操作)
 *
 * @example
 * import { getDb, run, queryAll, saveDb } from './db/base'
 */

import initSqlJs, { Database } from 'sql.js'
import path from 'path'
import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs'
import type { VectorComponentType } from '../../shared/types'
import { createLogger } from '../logger'

const log = createLogger('DB')

// ============ 模块级状态 ============

let db: Database
let dbPath: string

/** 获取当前数据库实例引用（供需要直接 exec 的高级操作使用） */
export function getDb(): Database { return db }

/** 获取当前数据库文件路径 */
export function getDbPath(): string { return dbPath }

// ============ 固定数据目录（不依赖 app.name / productName） ============

/** 固定的数据目录名称 —— 与 package.json name 解耦，避免软件改名导致数据丢失 */
const FIXED_DATA_DIR_NAME = 'HelixCraft'

/** 已知旧应用名称列表（用于自动迁移） */
const KNOWN_OLD_APP_NAMES = [
  'gene-engineering-tool',
  'gene-engineering',
  'vector-editor'
]

/** 获取固定的数据目录路径（不依赖 app.getPath('userData')） */
export function getDataDir(): string {
  const isElectron = !!app?.getAppPath
  if (!isElectron) return process.cwd()
  return path.join(app.getPath('appData'), FIXED_DATA_DIR_NAME)
}

/** 确保固定数据目录存在，并在 app 启动最早阶段调用
 *  调用 app.setPath('userData', ...) 将所有后续 userData 引用重定向到固定目录 */
export function ensureFixedUserDataDir(): void {
  const fixedDir = getDataDir()
  if (!existsSync(fixedDir)) {
    mkdirSync(fixedDir, { recursive: true })
  }
  app.setPath('userData', fixedDir)
}

/** 递归复制目录 */
function copyDirRecursive(src: string, dest: string): number {
  if (!existsSync(src)) return 0
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true })
  let copied = 0
  const entries = readdirSync(src)
  for (const entry of entries) {
    const srcPath = path.join(src, entry)
    const destPath = path.join(dest, entry)
    const stat = statSync(srcPath)
    if (stat.isDirectory()) {
      copied += copyDirRecursive(srcPath, destPath)
    } else {
      if (!existsSync(destPath)) {
        copyFileSync(srcPath, destPath)
        copied++
      }
    }
  }
  return copied
}

/** 启动时从旧应用名称目录自动迁移数据 */
export function migrateFromOldAppNames(): { migrated: boolean; from: string; files: number } {
  const dataDir = getDataDir()
  const dbFile = path.join(dataDir, 'gene-engineering.db')
  const newDbExists = existsSync(dbFile)
  const newDbSize = newDbExists ? statSync(dbFile).size : 0

  const appDataDir = app.getPath('appData')

  const candidates: { dir: string; dbFile: string; dbSize: number }[] = []
  for (const oldName of KNOWN_OLD_APP_NAMES) {
    const oldDir = path.join(appDataDir, oldName)
    const oldDbFile = path.join(oldDir, 'gene-engineering.db')
    if (!existsSync(oldDbFile)) continue
    const oldDbSize = statSync(oldDbFile).size
    candidates.push({ dir: oldDir, dbFile: oldDbFile, dbSize: oldDbSize })
  }

  if (candidates.length === 0) {
    try {
      const entries = readdirSync(appDataDir)
      for (const entry of entries) {
        if (entry === FIXED_DATA_DIR_NAME || entry === 'Electron' || entry === 'helixcraft') continue
        const candidateDir = path.join(appDataDir, entry)
        try {
          const stat = statSync(candidateDir)
          if (!stat.isDirectory()) continue
        } catch { continue }
        const candidateDb = path.join(candidateDir, 'gene-engineering.db')
        if (existsSync(candidateDb)) {
          const candidateSize = statSync(candidateDb).size
          candidates.push({ dir: candidateDir, dbFile: candidateDb, dbSize: candidateSize })
        }
      }
    } catch (e) {
      log.error('[Migrate] Fallback scan failed', e)
    }
  }

  if (candidates.length === 0) {
    return { migrated: false, from: '', files: 0 }
  }

  const best = candidates.sort((a, b) => b.dbSize - a.dbSize)[0]

  if (newDbExists && newDbSize >= best.dbSize) {
    log.info(`[Migrate] New DB (${newDbSize} bytes) >= old DB (${best.dbSize} bytes), skip migration`)
    return { migrated: false, from: '', files: 0 }
  }

  if (newDbExists) {
    const backupPath = dbFile + '.pre-migrate.bak'
    copyFileSync(dbFile, backupPath)
    log.info(`[Migrate] Backed up new DB → ${backupPath} (${newDbSize} bytes)`)
  }

  const filesCopied = copyDirRecursive(best.dir, dataDir)
  log.info(`[Migrate] Copied ${filesCopied} files from ${best.dir} → ${dataDir} (DB: ${best.dbSize} bytes)`)
  return { migrated: true, from: best.dir, files: filesCopied }
}

// ============ SQL 执行原语 ============

/** 将内存数据库持久化到磁盘 */
export function saveDb(): void {
  const data = db.export()
  writeFileSync(dbPath, Buffer.from(data))
}

/** 执行 SQL 查询，返回所有结果行 */
export function queryAll<T = any>(sql: string, params: any[] = []): T[] {
  try {
    const stmt = db.prepare(sql)
    stmt.bind(params)
    const results: T[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T)
    }
    stmt.free()
    return results
  } catch (err: any) {
    log.error(`SQL queryAll failed: ${sql}`, err)
    throw err
  }
}

/** 执行 SQL 查询，返回第一行结果 */
export function queryOne<T = any>(sql: string, params: any[] = []): T | undefined {
  try {
    const results = queryAll<T>(sql, params)
    return results[0]
  } catch (err: any) {
    log.error(`SQL queryOne failed: ${sql}`, err)
    throw err
  }
}

/** 执行 SQL 并立即持久化到磁盘 */
export function run(sql: string, params: any[] = []): void {
  try {
    db.run(sql, params)
    saveDb()
  } catch (err: any) {
    log.error(`SQL run failed: ${sql}`, err)
    throw err
  }
}

/** 执行 SQL 但不立即持久化（用于批量操作，由调用方负责 saveDb） */
export function runNoSave(sql: string, params: any[] = []): void {
  try {
    db.run(sql, params)
  } catch (err: any) {
    log.error(`SQL runNoSave failed: ${sql}`, err)
    throw err
  }
}

/** 批量操作包装器：在事务中执行 fn，完成后统一 saveDb */
export function runBatch(fn: () => void): void {
  try {
    db.run('BEGIN TRANSACTION')
    fn()
    db.run('COMMIT')
    saveDb()
  } catch (err: any) {
    log.error(`Batch operation failed`, err)
    try { db.run('ROLLBACK') } catch (_e) { /* ignore */ }
    throw err
  }
}

/** 获取最近一次 INSERT 的自增 ID（使用 db.exec 避免 prepared statement 干扰） */
export function lastInsertId(): number {
  try {
    const results = db.exec('SELECT last_insert_rowid() as id')
    if (results.length > 0 && results[0].values.length > 0) {
      const id = results[0].values[0][0]
      return typeof id === 'number' ? id : Number(id) || 0
    }
    return 0
  } catch (err: any) {
    log.error('lastInsertId failed', err)
    return 0
  }
}

// ============ 数据库初始化 ============

/** 初始化数据库连接：加载 WASM、打开/创建数据库文件、创建表结构 */
export async function initDatabase(customDbPath?: string): Promise<void> {
  const isElectron = !!app?.getAppPath
  const wasmPath = isElectron
    ? path.join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
    : path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
  const wasmBinary = readFileSync(wasmPath)
  const SQL = await initSqlJs({ wasmBinary })
  dbPath = customDbPath || (isElectron ? path.join(getDataDir(), 'gene-engineering.db') : path.join(process.cwd(), 'gene-engineering.db'))

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath)
    db = new SQL.Database(buffer)
    log.info(`Loaded existing database: ${dbPath} (${buffer.length} bytes)`)
  } else {
    db = new SQL.Database()
    log.info(`Created new database: ${dbPath}`)
  }

  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')
  createTables()
  migrateEnzymeSchema()
  log.info('Tables created/verified')
}

// ============ Schema 创建与迁移 ============

/** 迁移：旧版 restriction_enzymes 表添加新字段 */
function migrateEnzymeSchema(): void {
  const cols = queryAll<{ name: string }>('PRAGMA table_info(restriction_enzymes)')
  const existing = new Set(cols.map(c => c.name))
  const migrations: [string, string][] = [
    ['overhang_type', "TEXT DEFAULT '5prime'"],
    ['overhang_length', 'INTEGER DEFAULT 4'],
    ['top_cut_offset', 'INTEGER'],
    ['bottom_cut_offset', 'INTEGER'],
    ['optimal_buffer', 'TEXT'],
    ['heat_inactivation_temp', 'REAL'],
    ['methylation_sensitive', 'TEXT'],
    ['is_time_saver', 'INTEGER DEFAULT 0'],
    ['is_high_fidelity', 'INTEGER DEFAULT 0'],
    ['star_activity_note', 'TEXT'],
    ['ligation_note', 'TEXT'],
    ['cut_sequence', 'TEXT'],
    ['subtype', 'TEXT'],
    ['rebase_id', 'TEXT'],
    ['prototype', 'TEXT'],
    ['source_organism_cn', 'TEXT'],
    ['organism_type', 'TEXT'],
    ['growth_temp', 'REAL'],
    ['molecular_weight', 'REAL'],
    ['clean_recognition_seq', 'TEXT'],
    ['seq_length', 'INTEGER'],
    ['has_ambiguous_bases', 'INTEGER DEFAULT 0'],
    ['gc_content', 'REAL'],
    ['sites_lambda', 'INTEGER'],
    ['sites_pbr322', 'INTEGER'],
    ['sites_adeno2', 'INTEGER'],
    ['sites_phix174', 'INTEGER'],
    ['sites_sv40', 'INTEGER'],
    ['gene_cloned', 'INTEGER DEFAULT 0'],
    ['gene_sequenced', 'INTEGER DEFAULT 0'],
    ['crystal_data', 'INTEGER DEFAULT 0'],
    ['kinetics_data', 'INTEGER DEFAULT 0'],
    ['ss_cleavage', 'INTEGER DEFAULT 0'],
    ['has_isoschizomers', 'INTEGER DEFAULT 0'],
    ['date_entered', 'TEXT'],
    ['date_modified', 'TEXT'],
    ['rebase_url', 'TEXT']
  ]
  for (const [col, type] of migrations) {
    if (!existing.has(col)) {
      db.run(`ALTER TABLE restriction_enzymes ADD COLUMN ${col} ${type}`)
    }
  }
  if (migrations.some(([c]) => !existing.has(c))) {
    saveDb()
    log.info('Enzyme schema migrated')
  }
}

/** 创建所有数据表（如不存在）及索引 */
function createTables(): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS seed_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`)

  db.run(`
    CREATE TABLE IF NOT EXISTS restriction_enzymes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      source_organism TEXT NOT NULL,
      recognition_sequence TEXT NOT NULL,
      cut_position INTEGER NOT NULL,
      optimal_temp REAL DEFAULT 37.0,
      is_palindromic INTEGER DEFAULT 1,
      overhang_type TEXT DEFAULT '5prime',
      overhang_length INTEGER DEFAULT 4,
      top_cut_offset INTEGER,
      bottom_cut_offset INTEGER,
      optimal_buffer TEXT,
      heat_inactivation_temp REAL,
      methylation_sensitive TEXT,
      is_time_saver INTEGER DEFAULT 0,
      is_high_fidelity INTEGER DEFAULT 0,
      star_activity_note TEXT,
      ligation_note TEXT,
      cut_sequence TEXT,
      subtype TEXT,
      rebase_id TEXT,
      prototype TEXT,
      source_organism_cn TEXT,
      organism_type TEXT,
      growth_temp REAL,
      molecular_weight REAL,
      clean_recognition_seq TEXT,
      seq_length INTEGER,
      has_ambiguous_bases INTEGER DEFAULT 0,
      gc_content REAL,
      sites_lambda INTEGER,
      sites_pbr322 INTEGER,
      sites_adeno2 INTEGER,
      sites_phix174 INTEGER,
      sites_sv40 INTEGER,
      gene_cloned INTEGER DEFAULT 0,
      gene_sequenced INTEGER DEFAULT 0,
      crystal_data INTEGER DEFAULT 0,
      kinetics_data INTEGER DEFAULT 0,
      ss_cleavage INTEGER DEFAULT 0,
      has_isoschizomers INTEGER DEFAULT 0,
      date_entered TEXT,
      date_modified TEXT,
      rebase_url TEXT
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
      purpose TEXT DEFAULT '',
      host_type TEXT DEFAULT '[]',
      promoter_type TEXT DEFAULT 'none',
      promoters TEXT DEFAULT '',
      reporter_gene TEXT DEFAULT '',
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

  // 迁移：gene_sequences 新字段（兼容已有数据库）
  try { db.run('ALTER TABLE gene_sequences ADD COLUMN features_json TEXT DEFAULT \'[]\'') } catch (_e) { /* 列已存在 */ }
  try { db.run('ALTER TABLE gene_sequences ADD COLUMN topology TEXT DEFAULT \'linear\'') } catch (_e) { /* 列已存在 */ }
  try { db.run('ALTER TABLE gene_sequences ADD COLUMN file_path TEXT DEFAULT \'\'') } catch (_e) { /* 列已存在 */ }
  // Phase 1.2 扩展字段（NCBI 集成 + 基因浏览器）
  try { db.run("ALTER TABLE gene_sequences ADD COLUMN gene_symbol TEXT DEFAULT ''") } catch (_e) { /* 列已存在 */ }
  try { db.run("ALTER TABLE gene_sequences ADD COLUMN chromosome TEXT DEFAULT ''") } catch (_e) { /* 列已存在 */ }
  try { db.run("ALTER TABLE gene_sequences ADD COLUMN strand INTEGER DEFAULT 1") } catch (_e) { /* 列已存在 */ }
  try { db.run("ALTER TABLE gene_sequences ADD COLUMN biotype TEXT DEFAULT ''") } catch (_e) { /* 列已存在 */ }
  try { db.run("ALTER TABLE gene_sequences ADD COLUMN ncbi_gene_id TEXT DEFAULT ''") } catch (_e) { /* 列已存在 */ }
  try { db.run("ALTER TABLE gene_sequences ADD COLUMN genomic_start INTEGER DEFAULT 0") } catch (_e) { /* 列已存在 */ }
  try { db.run("ALTER TABLE gene_sequences ADD COLUMN genomic_end INTEGER DEFAULT 0") } catch (_e) { /* 列已存在 */ }
  try { db.run("ALTER TABLE gene_sequences ADD COLUMN summary TEXT DEFAULT ''") } catch (_e) { /* 列已存在 */ }
  try { db.run("ALTER TABLE gene_sequences ADD COLUMN ncbi_imported_at TEXT DEFAULT ''") } catch (_e) { /* 列已存在 */ }

  // 基因转录本表
  db.run(`
    CREATE TABLE IF NOT EXISTS gene_transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gene_id INTEGER NOT NULL REFERENCES gene_sequences(id) ON DELETE CASCADE,
      transcript_id TEXT NOT NULL,
      name TEXT DEFAULT '',
      is_primary INTEGER DEFAULT 0,
      mrna_sequence TEXT DEFAULT '',
      cds_sequence TEXT DEFAULT '',
      protein_sequence TEXT DEFAULT '',
      exon_count INTEGER DEFAULT 0,
      strand INTEGER DEFAULT 1,
      source TEXT DEFAULT 'manual'
    )`)

  // 基因外显子表
  db.run(`
    CREATE TABLE IF NOT EXISTS gene_exons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transcript_id INTEGER NOT NULL REFERENCES gene_transcripts(id) ON DELETE CASCADE,
      exon_number INTEGER NOT NULL,
      start INTEGER NOT NULL,
      end INTEGER NOT NULL,
      strand INTEGER DEFAULT 1,
      utr_type TEXT DEFAULT NULL
    )`)

  // 基因交叉引用表
  db.run(`
    CREATE TABLE IF NOT EXISTS gene_cross_refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gene_id INTEGER NOT NULL REFERENCES gene_sequences(id) ON DELETE CASCADE,
      database TEXT NOT NULL,
      accession TEXT NOT NULL,
      url TEXT DEFAULT '',
      is_primary INTEGER DEFAULT 0
    )`)

  // 相关序列表（NCBI Related Sequences）
  db.run(`
    CREATE TABLE IF NOT EXISTS gene_related_sequences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gene_id INTEGER NOT NULL REFERENCES gene_sequences(id) ON DELETE CASCADE,
      seq_type TEXT NOT NULL,
      nucleotide_accession TEXT NOT NULL,
      protein_accession TEXT DEFAULT NULL,
      genomic_range TEXT DEFAULT NULL,
      description TEXT DEFAULT '',
      ncbi_imported_at TEXT DEFAULT (datetime('now'))
    )`)

  db.run('CREATE INDEX IF NOT EXISTS idx_related_gene ON gene_related_sequences(gene_id)')

  // 迁移：gene_related_sequences 添加 ncbi_content 缓存列
  try { db.run("ALTER TABLE gene_related_sequences ADD COLUMN ncbi_content TEXT DEFAULT ''") } catch (_e) { /* 列已存在 */ }

  // ============ 物种基因数据库插件系统 ============

  // 物种插件元数据表
  db.run(`
    CREATE TABLE IF NOT EXISTS species_plugins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      species_name TEXT NOT NULL UNIQUE,
      species_latin TEXT DEFAULT '',
      package_name TEXT DEFAULT '',
      version TEXT DEFAULT '',
      data_file TEXT DEFAULT '',
      fields_config TEXT DEFAULT '[]',
      url_templates TEXT DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      installed_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`)

  // 物种基因注释数据表
  db.run(`
    CREATE TABLE IF NOT EXISTS species_gene_annotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plugin_id INTEGER NOT NULL REFERENCES species_plugins(id) ON DELETE CASCADE,
      gene_id INTEGER REFERENCES gene_sequences(id) ON DELETE SET NULL,
      source_database TEXT NOT NULL,
      source_accession TEXT NOT NULL,
      ncbi_gene_id TEXT DEFAULT '',
      gene_symbol TEXT DEFAULT '',
      gene_name TEXT DEFAULT '',
      annotation_data TEXT DEFAULT '{}',
      external_links TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    )`)

  // 物种注释索引
  db.run('CREATE INDEX IF NOT EXISTS idx_sga_plugin ON species_gene_annotations(plugin_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_sga_ncbi ON species_gene_annotations(ncbi_gene_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_sga_gene ON species_gene_annotations(gene_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_sga_accession ON species_gene_annotations(source_database, source_accession)')

  // 迁移：插件表添加 mode 和 online_sources_config 列
  try { db.run("ALTER TABLE species_plugins ADD COLUMN mode TEXT DEFAULT 'offline'") } catch (_e) { /* 列已存在 */ }
  try { db.run("ALTER TABLE species_plugins ADD COLUMN online_sources_config TEXT DEFAULT '{}'") } catch (_e) { /* 列已存在 */ }

  // 迁移：注释表添加 source_type 和 cache_expires_at 列
  try { db.run("ALTER TABLE species_gene_annotations ADD COLUMN source_type TEXT DEFAULT 'csv_import'") } catch (_e) { /* 列已存在 */ }
  try { db.run("ALTER TABLE species_gene_annotations ADD COLUMN cache_expires_at TEXT DEFAULT NULL") } catch (_e) { /* 列已存在 */ }

  // 迁移：更新已有插件的 fields_config 和 mode（从 plugin.json 读取最新配置）
  try {
    const plugins = db.exec("SELECT id, species_name FROM species_plugins");
    if (plugins.length > 0 && plugins[0].values.length > 0) {
      const dataDir = getDataDir();
      for (const row of plugins[0].values) {
        const pluginId = row[0] as number;
        const speciesName = row[1] as string;
        const pluginJsonPath = path.join(dataDir, 'species-plugins', speciesName, 'plugin.json');
        if (existsSync(pluginJsonPath)) {
          try {
            const pluginConfig = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));
            const fieldsConfig = JSON.stringify(pluginConfig.fieldDefinitions || []);
            const urlTemplates = JSON.stringify(pluginConfig.urlTemplates || {});
            const mode = pluginConfig.mode || 'offline';
            const onlineSources = JSON.stringify(pluginConfig.onlineSources || []);
            db.run("UPDATE species_plugins SET fields_config = ?, url_templates = ?, mode = ?, online_sources_config = ? WHERE id = ?", [fieldsConfig, urlTemplates, mode, onlineSources, pluginId]);
            console.log(`[DB Migration] Updated plugin ${speciesName} fields_config and mode`);
          } catch (e) {
            console.warn(`[DB Migration] Failed to update plugin ${speciesName}:`, e);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[DB Migration] Failed to migrate plugin fields_config:', e);
  }

  // 迁移：清理重复的物种注释记录（保留每个 plugin_id + source_database + source_accession 组合的第一条）
  try {
    const dupResult = db.exec(`
      SELECT MIN(id) as keep_id, plugin_id, source_database, source_accession, COUNT(*) as cnt
      FROM species_gene_annotations
      GROUP BY plugin_id, source_database, source_accession
      HAVING cnt > 1
    `);
    if (dupResult.length > 0 && dupResult[0].values.length > 0) {
      let deletedCount = 0;
      for (const row of dupResult[0].values) {
        const keepId = row[0] as number;
        const pluginId = row[1] as number;
        const srcDb = row[2] as string;
        const srcAcc = row[3] as string;
        db.run(
          'DELETE FROM species_gene_annotations WHERE plugin_id = ? AND source_database = ? AND source_accession = ? AND id != ?',
          [pluginId, srcDb, srcAcc, keepId]
        );
        deletedCount += (row[4] as number) - 1;
      }
      if (deletedCount > 0) {
        console.log(`[DB Migration] Cleaned up ${deletedCount} duplicate species annotations`);
      }
    }
    // 清理孤儿注释（插件已被卸载但注释记录残留）
    db.run('DELETE FROM species_gene_annotations WHERE plugin_id NOT IN (SELECT id FROM species_plugins)');
  } catch (e) {
    console.warn('[DB Migration] Failed to dedup annotations:', e);
  }

  // 迁移：清理因 sql.js CASCADE 不可靠导致的孤儿记录
  try {
    // 清理孤儿外显子（转录本已被删除）
    db.run('DELETE FROM gene_exons WHERE transcript_id NOT IN (SELECT id FROM gene_transcripts)')
    // 清理孤儿转录本（基因已被删除）
    db.run('DELETE FROM gene_transcripts WHERE gene_id NOT IN (SELECT id FROM gene_sequences)')
    // 清理孤儿交叉引用
    db.run('DELETE FROM gene_cross_refs WHERE gene_id NOT IN (SELECT id FROM gene_sequences)')
    // 清理孤儿相关序列
    db.run('DELETE FROM gene_related_sequences WHERE gene_id NOT IN (SELECT id FROM gene_sequences)')
    // 清理孤儿基因关系
    db.run('DELETE FROM gene_relations WHERE gene_id NOT IN (SELECT id FROM gene_sequences) OR related_gene_id NOT IN (SELECT id FROM gene_sequences)')
    // 将孤儿物种注释的 gene_id 置为 NULL
    db.run('UPDATE species_gene_annotations SET gene_id = NULL WHERE gene_id IS NOT NULL AND gene_id NOT IN (SELECT id FROM gene_sequences)')
  } catch (e) {
    console.warn('[DB Migration] Failed to clean orphan gene records:', e)
  }

  // 应用设置表（通用 KV 存储）
  db.run(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT ''
    )`)

  db.run('CREATE INDEX IF NOT EXISTS idx_transcript_gene ON gene_transcripts(gene_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_exon_transcript ON gene_exons(transcript_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_crossref_gene ON gene_cross_refs(gene_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_gene_symbol ON gene_sequences(gene_symbol)')
  db.run('CREATE INDEX IF NOT EXISTS idx_gene_ncbi_id ON gene_sequences(ncbi_gene_id)')

  // 迁移：gene_transcripts 添加 CDS 坐标字段
  try { db.run('ALTER TABLE gene_transcripts ADD COLUMN cds_start INTEGER DEFAULT 0') } catch (_e) { /* 列已存在 */ }
  try { db.run('ALTER TABLE gene_transcripts ADD COLUMN cds_end INTEGER DEFAULT 0') } catch (_e) { /* 列已存在 */ }

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

  // 载体元件数据库表
  db.run(`
    CREATE TABLE IF NOT EXISTS vector_components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sequence TEXT NOT NULL,
      standard_name TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      type TEXT NOT NULL CHECK(type IN ('resistance','CDS','promoter','origin','terminator','enhancer','reporter','tag','regulatory','other')),
      species TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`)
  db.run('CREATE INDEX IF NOT EXISTS idx_comp_name ON vector_components(standard_name)')
  db.run('CREATE INDEX IF NOT EXISTS idx_comp_type ON vector_components(type)')

  // 氨基酸序列字段迁移
  try { db.run("ALTER TABLE vector_components ADD COLUMN amino_acid_sequence TEXT NOT NULL DEFAULT ''") } catch (_e) { /* 列已存在 */ }
  try { db.run("ALTER TABLE vector_components ADD COLUMN similar_variants TEXT NOT NULL DEFAULT '[]'") } catch (_e) { /* 列已存在 */ }

  // 扩展：外部来源元数据
  const componentMetaCols: [string, string][] = [
    ['feature_id', "TEXT DEFAULT ''"],
    ['direction', "TEXT DEFAULT 'none'"],
    ['species_short', "TEXT DEFAULT ''"],
    ['species_latin', "TEXT DEFAULT ''"],
    ['species_cn', "TEXT DEFAULT ''"],
    ['taxonomic_category', "TEXT DEFAULT ''"],
    ['ref_protein_sequence', "TEXT DEFAULT ''"],
    ['molecular_weight', "REAL DEFAULT 0"],
    ['dna_variant_count', "INTEGER DEFAULT 0"],
    ['aa_variant_count', "INTEGER DEFAULT 0"],
    ['product_description', "TEXT DEFAULT ''"],
    ['gene', "TEXT DEFAULT ''"],
    ['bound_moiety', "TEXT DEFAULT ''"],
    ['source_databases', "TEXT DEFAULT ''"],
    ['total_occurrences', "INTEGER DEFAULT 0"],
    ['annotation_method', "TEXT DEFAULT ''"],
    ['variants', "TEXT DEFAULT '[]'"]
  ]
  for (const [col, def] of componentMetaCols) {
    try { db.run(`ALTER TABLE vector_components ADD COLUMN ${col} ${def}`) } catch (_e) { /* 列已存在 */ }
  }

  // 标签字段迁移
  try { db.run("ALTER TABLE vector_components ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'") } catch (_e) { /* 列已存在 */ }

  // 序列变体从表
  db.run(`
    CREATE TABLE IF NOT EXISTS component_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      component_id INTEGER NOT NULL,
      variant_id TEXT NOT NULL DEFAULT 'ref',
      seq_type TEXT NOT NULL CHECK(seq_type IN ('DNA','Protein')),
      sequence TEXT NOT NULL DEFAULT '',
      length INTEGER NOT NULL DEFAULT 0,
      is_reference INTEGER NOT NULL DEFAULT 0,
      sources TEXT DEFAULT '',
      FOREIGN KEY (component_id) REFERENCES vector_components(id) ON DELETE CASCADE
    )`)
  db.run('CREATE INDEX IF NOT EXISTS idx_cv_component ON component_variants(component_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_cv_seq_type ON component_variants(seq_type)')
  db.run('CREATE INDEX IF NOT EXISTS idx_cv_sequence ON component_variants(sequence)')

  // 数据迁移：gene_symbol 转换为 db:accession 格式 + 过滤染色体存取号
  try {
    // 染色体存取号模式（基因组序列而非基因标识符）：NC_*, NT_*, NW_*
    const chrAccessionPattern = /^NCBI:(NC_|NT_|NW_)/i
    const genes = db.exec('SELECT id, gene_symbol, accession_number FROM gene_sequences WHERE gene_symbol IS NOT NULL AND gene_symbol != ""')
    if (genes.length > 0 && genes[0].values) {
      for (const row of genes[0].values) {
        const id = row[0] as number
        const symbol = (row[1] as string) || ''
        const existingTags = symbol.split(/[;；]/).map(s => s.trim()).filter(Boolean)
        let needsUpdate = false
        // 如果已有标签不包含 : 分隔符，添加 NCBI: 前缀
        for (let i = 0; i < existingTags.length; i++) {
          if (!existingTags[i].includes(':')) {
            existingTags[i] = `NCBI:${existingTags[i]}`
            needsUpdate = true
          }
        }
        // 过滤掉染色体存取号模式（NC_*, NT_*, NW_* 是基因组序列而非基因标识符）
        const filteredTags = existingTags.filter(t => !chrAccessionPattern.test(t))
        if (filteredTags.length !== existingTags.length) needsUpdate = true
        if (needsUpdate) {
          const newVal = filteredTags.join(';')
          db.run('UPDATE gene_sequences SET gene_symbol = ? WHERE id = ?', [newVal, id])
        }
      }
    }
  } catch (e) {
    log.warn('[Migrate] gene_symbol migration skipped', e)
  }

  saveDb()
}

/** 迁移 vectors 表：添加新列 + 迁移旧 host_type 枚举值 */
function migrateVectorsTable(): void {
  const cols = queryAll<{ name: string }>('PRAGMA table_info(vectors)').map(r => r.name)
  const newCols: [string, string][] = [
    ['purpose', "TEXT DEFAULT ''"],
    ['host_type', "TEXT DEFAULT '[]'"],
    ['promoter_type', "TEXT DEFAULT 'none'"],
    ['promoters', "TEXT DEFAULT ''"],
    ['reporter_gene', "TEXT DEFAULT ''"],
    ['is_recombinant', 'INTEGER DEFAULT 0'],
    ['antibiotic_resistance', "TEXT DEFAULT ''"],
    ['copy_number', "TEXT DEFAULT ''"],
    ['file_path', "TEXT DEFAULT ''"],
    ['topology', "TEXT DEFAULT 'circular'"],
    ['source_file', "TEXT DEFAULT ''"],
    ['features_json', "TEXT DEFAULT ''"]
  ]
  for (const [col, colDef] of newCols) {
    if (!cols.includes(col)) {
      db.run(`ALTER TABLE vectors ADD COLUMN ${col} ${colDef}`)
    }
  }

  // 迁移旧 host_type enum 值 → 中文 JSON 数组
  const hostEnumMap: Record<string, string> = {
    ecoli: '大肠杆菌', mammalian: '哺乳动物', yeast: '酵母',
    plant: '植物', insect: '昆虫', bacillus: '芽孢杆菌', other: '其他'
  }
  const oldVectors = queryAll<{ id: number; host_type: string }>('SELECT id, host_type FROM vectors')
  for (const v of oldVectors) {
    if (v.host_type && hostEnumMap[v.host_type]) {
      const migrated = JSON.stringify([hostEnumMap[v.host_type]])
      run('UPDATE vectors SET host_type = ? WHERE id = ?', [migrated, v.id])
    }
  }
}

// ============ 通用序列工具 ============

/** 标准遗传密码表：DNA 密码子 → 氨基酸（单字母） */
export const CODON_TABLE: Record<string, string> = {
  TTT:'F',TTC:'F',TTA:'L',TTG:'L',CTT:'L',CTC:'L',CTA:'L',CTG:'L',
  ATT:'I',ATC:'I',ATA:'I',ATG:'M',GTT:'V',GTC:'V',GTA:'V',GTG:'V',
  TCT:'S',TCC:'S',TCA:'S',TCG:'S',CCT:'P',CCC:'P',CCA:'P',CCG:'P',
  ACT:'T',ACC:'T',ACA:'T',ACG:'T',GCT:'A',GCC:'A',GCA:'A',GCG:'A',
  TAT:'Y',TAC:'Y',TAA:'*',TAG:'*',CAT:'H',CAC:'H',CAA:'Q',CAG:'Q',
  AAT:'N',AAC:'N',AAA:'K',AAG:'K',GAT:'D',GAC:'D',GAA:'E',GAG:'E',
  TGT:'C',TGC:'C',TGA:'*',TGG:'W',CGT:'R',CGC:'R',CGA:'R',CGG:'R',
  AGT:'S',AGC:'S',AGA:'R',AGG:'R',GGT:'G',GGC:'G',GGA:'G',GGG:'G'
}

/** DNA 反向互补（支持 IUPAC 简并碱基） */
export function reverseComplement(seq: string): string {
  const comp: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G', a: 't', t: 'a', g: 'c', c: 'g' }
  return seq.split('').reverse().map(c => comp[c] || c).join('')
}

/** 将 DNA 序列翻译为氨基酸序列（从第一个 ATG 开始，遇到终止密码子停止） */
export function translateDNA(dnaSeq: string): string {
  const seq = dnaSeq.toUpperCase().replace(/[^ATGC]/g, '')
  const startIdx = seq.indexOf('ATG')
  if (startIdx < 0) return ''
  const aas: string[] = []
  for (let i = startIdx; i + 2 < seq.length; i += 3) {
    const codon = seq.substring(i, i + 3)
    const aa = CODON_TABLE[codon]
    if (!aa) break
    if (aa === '*') break
    aas.push(aa)
  }
  return aas.join('')
}

/** 蛋白表达相关元件类型：自动翻译 */
export const PROTEIN_TYPES: Set<VectorComponentType> = new Set(['CDS', 'tag', 'reporter', 'resistance'])

/** 自动翻译蛋白相关元件的 DNA 序列 */
export function autoTranslate(data: { type?: VectorComponentType; sequence?: string }): string {
  if (data.type && PROTEIN_TYPES.has(data.type) && data.sequence) {
    return translateDNA(data.sequence)
  }
  return ''
}

/** 计算 DNA 序列 GC 含量百分比 */
export function calcGcContent(seq: string): number {
  const upper = seq.toUpperCase()
  return Math.round(((upper.match(/[GC]/g) || []).length / upper.length) * 1000) / 10
}

/** 计算引物退火温度 Tm（短引物用 Wallace 规则，长引物用 nearest-neighbor 近似） */
export function calcTm(seq: string): number {
  const s = seq.toUpperCase()
  const a = (s.match(/A/g) || []).length, t = (s.match(/T/g) || []).length
  const g = (s.match(/G/g) || []).length, c = (s.match(/C/g) || []).length
  if (s.length < 14) return 2 * (a + t) + 4 * (g + c)
  return Math.round((64.9 + 41 * (g + c - 16.4) / s.length) * 10) / 10
}

// ============ 数据库备份/恢复 ============

/** 导出整个数据库为 Buffer */
export function exportDatabase(): Buffer {
  saveDb()
  return Buffer.from(readFileSync(dbPath))
}

/** 从 Buffer 恢复数据库 */
export async function restoreDatabase(buffer: Buffer): Promise<{ success: boolean; message: string }> {
  log.info(`Restoring database from buffer: ${buffer.length} bytes`)
  try {
    const backupPath = dbPath + '.bak'
    if (existsSync(dbPath)) {
      copyFileSync(dbPath, backupPath)
    }
    writeFileSync(dbPath, buffer)
    const SQL = await initSqlJs({ wasmBinary: readFileSync(path.join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')) })
    const newBuffer = readFileSync(dbPath)
    db = new SQL.Database(newBuffer)
    db.run('PRAGMA journal_mode = WAL')
    db.run('PRAGMA foreign_keys = ON')
    createTables()
    return { success: true, message: '数据库恢复成功' }
  } catch (e: any) {
    const backupPath = dbPath + '.bak'
    if (existsSync(backupPath)) {
      copyFileSync(backupPath, dbPath)
    }
    return { success: false, message: `恢复失败: ${e.message}` }
  }
}

/** 创建自动备份（启动时调用），保留最近 5 个备份 */
export function createAutoBackup(): string | null {
  try {
    saveDb()
    const backupDir = path.join(getDataDir(), 'backups')
    if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })
    const now = new Date()
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
    const backupPath = path.join(backupDir, `gene-engineering_${dateStr}.db`)
    copyFileSync(dbPath, backupPath)
    const backups = readdirSync(backupDir) as string[]
    const sorted = backups.filter((f: string) => f.endsWith('.db')).sort().reverse()
    for (const old of sorted.slice(5)) {
      unlinkSync(path.join(backupDir, old))
    }
    return backupPath
  } catch (e) {
    log.error('Auto backup failed', e)
    return null
  }
}
