/**
 * 手动迁移脚本：将旧应用目录的数据迁移到新的固定目录
 * 
 * 使用方式：
 *   node scripts/migrate-data.js
 * 
 * 功能：
 * 1. 用旧数据库覆盖新空数据库（保留所有元件/测序/载体/引物等数据）
 * 2. 复制旧目录的 sequencing/ 文件夹到新目录
 * 3. 复制旧目录的 vectors/ 文件夹到新目录（仅新目录中不存在的文件）
 * 4. 复制旧目录的 backups/ 文件夹到新目录
 * 5. 复制旧目录的 logs/ 文件夹到新目录
 */

const fs = require('fs')
const path = require('path')

const OLD_DIR = 'C:\\Users\\liuda\\AppData\\Roaming\\gene-engineering-tool'
const NEW_DIR = 'C:\\Users\\liuda\\AppData\\Roaming\\HelixCraft'

const DB_FILE = 'gene-engineering.db'

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    console.log(`  ✓ 创建目录: ${dir}`)
  }
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest))
  fs.copyFileSync(src, dest)
  return true
}

function copyDirRecursive(src, dest, skipExisting = false) {
  if (!fs.existsSync(src)) return 0
  ensureDir(dest)
  let count = 0
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry)
    const destPath = path.join(dest, entry)
    const stat = fs.statSync(srcPath)
    if (stat.isDirectory()) {
      count += copyDirRecursive(srcPath, destPath, skipExisting)
    } else {
      if (skipExisting && fs.existsSync(destPath)) continue
      copyFile(srcPath, destPath)
      count++
    }
  }
  return count
}

function migrate() {
  console.log('=== HelixCraft 数据迁移工具 ===\n')
  console.log(`旧目录: ${OLD_DIR}`)
  console.log(`新目录: ${NEW_DIR}\n`)

  if (!fs.existsSync(OLD_DIR)) {
    console.log('✗ 旧目录不存在，无需迁移')
    process.exit(0)
  }

  ensureDir(NEW_DIR)

  // 1. 数据库迁移（最关键）
  const oldDb = path.join(OLD_DIR, DB_FILE)
  const newDb = path.join(NEW_DIR, DB_FILE)
  const backupDb = path.join(NEW_DIR, DB_FILE + '.pre-migrate.bak')

  if (!fs.existsSync(oldDb)) {
    console.log('✗ 旧数据库不存在')
  } else {
    const oldSize = fs.statSync(oldDb).size
    const newSize = fs.existsSync(newDb) ? fs.statSync(newDb).size : 0
    console.log(`[1/4] 数据库迁移`)
    console.log(`  旧 DB: ${(oldSize / 1024).toFixed(1)} KB`)
    console.log(`  新 DB: ${(newSize / 1024).toFixed(1)} KB`)

    if (oldSize > newSize) {
      // 备份当前新数据库
      if (fs.existsSync(newDb)) {
        copyFile(newDb, backupDb)
        console.log(`  ✓ 备份当前 DB → ${path.basename(backupDb)}`)
      }
      // 用旧数据库覆盖
      copyFile(oldDb, newDb)
      console.log(`  ✓ 旧数据库已覆盖到新数据库`)
    } else {
      console.log(`  ⚠ 旧 DB 不大于新 DB，跳过（旧数据可能已迁移）`)
    }
  }

  // 2. 测序文件迁移
  const oldSeq = path.join(OLD_DIR, 'sequencing')
  const newSeq = path.join(NEW_DIR, 'sequencing')
  console.log(`\n[2/4] 测序文件迁移`)
  if (fs.existsSync(oldSeq)) {
    const count = copyDirRecursive(oldSeq, newSeq, true)
    console.log(`  ✓ 复制了 ${count} 个测序文件`)
  } else {
    console.log(`  ⚠ 旧目录无 sequencing/ 文件夹`)
  }

  // 3. 载体文件迁移
  const oldVec = path.join(OLD_DIR, 'vectors')
  const newVec = path.join(NEW_DIR, 'vectors')
  console.log(`\n[3/4] 载体文件迁移`)
  if (fs.existsSync(oldVec)) {
    const count = copyDirRecursive(oldVec, newVec, true)
    console.log(`  ✓ 复制了 ${count} 个载体文件`)
  } else {
    console.log(`  ⚠ 旧目录无 vectors/ 文件夹`)
  }

  // 4. 备份目录迁移
  const oldBackups = path.join(OLD_DIR, 'backups')
  const newBackups = path.join(NEW_DIR, 'backups')
  console.log(`\n[4/4] 备份文件迁移`)
  if (fs.existsSync(oldBackups)) {
    const count = copyDirRecursive(oldBackups, newBackups, true)
    console.log(`  ✓ 复制了 ${count} 个备份文件`)
  } else {
    console.log(`  ⚠ 旧目录无 backups/ 文件夹`)
  }

  // 5. 日志迁移（可选）
  const oldLogs = path.join(OLD_DIR, 'logs')
  const newLogs = path.join(NEW_DIR, 'logs')
  if (fs.existsSync(oldLogs)) {
    const count = copyDirRecursive(oldLogs, newLogs, true)
    console.log(`  ✓ 复制了 ${count} 个日志文件`)
  }

  console.log('\n=== 迁移完成 ===')
  console.log(`请重新启动 HelixCraft 验证数据是否恢复。`)
}

migrate()
