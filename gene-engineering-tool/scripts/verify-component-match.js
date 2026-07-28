/**
 * 元件比对逻辑边界验证脚本
 * 覆盖：空 DNA、空 AA、仅有 DNA、仅有 AA 四种情况，确保不会出现 100% 误匹配。
 *
 * 用法：node scripts/verify-component-match.js
 */
const path = require('path')
const { execSync } = require('child_process')
const { existsSync, mkdirSync } = require('fs')

const tmpDir = path.join(__dirname, '..', '.eval-tmp')
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })

const tsPath = path.join(__dirname, '..', 'src', 'main', 'componentMatch.ts')
const outPath = path.join(tmpDir, 'componentMatch-verify.cjs')

try {
  execSync(`npx esbuild "${tsPath}" --bundle --platform=node --outfile="${outPath}" --format=cjs`, {
    stdio: 'pipe',
    cwd: path.join(__dirname, '..')
  })
} catch (e) {
  console.error('esbuild 编译失败:', e.stderr?.toString())
  process.exit(1)
}

const { matchDnaToDna, matchDnaToAA, matchAminoToDna } = require(outPath)

const vectorDna = 'ATGCGTACGTTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAG'
const validDna = vectorDna.slice(0, 120)
const onlyAminoAcid = 'MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTFSYGVQCFSRYPDHMKQHDGFPKQASKARFLFPSACYPAGTGAALTIYDCVVLHGY'
const validProtein = 'MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTF'

let passed = 0
let failed = 0

function assertNoMatch(name, result) {
  if (result === null) {
    console.log(`  [PASS] ${name}: 未返回匹配`)
    passed++
  } else {
    console.log(`  [FAIL] ${name}: 错误地返回了匹配`, result)
    failed++
  }
}

function assertMatch(name, result) {
  if (result && result.identity === 100) {
    console.log(`  [PASS] ${name}: 正确返回 100% 匹配`)
    passed++
  } else {
    console.log(`  [FAIL] ${name}: 未返回预期的 100% 匹配`, result)
    failed++
  }
}

console.log('\n=== DNA→DNA 边界验证 ===')
assertNoMatch('空 DNA 查询', matchDnaToDna('', vectorDna))
assertNoMatch('空 DNA 模板', matchDnaToDna(validDna, ''))
assertNoMatch('AA 序列作为 DNA 查询', matchDnaToDna(onlyAminoAcid, vectorDna))
assertMatch('有效 DNA 完全匹配', matchDnaToDna(validDna, vectorDna))

console.log('\n=== AA→DNA 边界验证 ===')
assertNoMatch('空 AA 查询', matchAminoToDna('', vectorDna))
assertNoMatch('空 DNA 模板', matchAminoToDna(validProtein, ''))
assertNoMatch('DNA 序列作为 AA 查询', matchAminoToDna(validDna, vectorDna))
assertNoMatch('AA 查询长度不足 5', matchAminoToDna('MASK', vectorDna))

console.log('\n=== DNA→AA 边界验证 ===')
assertNoMatch('空 DNA 查询', matchDnaToAA('', validProtein))
assertNoMatch('空 AA 模板', matchDnaToAA(validDna, ''))
assertNoMatch('AA 序列作为 DNA 查询', matchDnaToAA(onlyAminoAcid, validProtein))
assertNoMatch('仅有 DNA 元件（无 AA 模板）', matchDnaToAA(validDna, ''))

// 仅当 query DNA 翻译后确实能在目标蛋白中找到时才匹配
const dnaForProtein = 'ATGGTGCACCTGACTCCTGAGGAGAAGTCTGCCGTTACTGCCCTGTGGGGCAAGGTGAACGTGGATTAAGAAACGTGCTGGTTTTGGTGCGAGAGGCCATGGGGGTAGGCGCAGGAAAGCAGGCACCATGTAGGGC'
assertNoMatch('DNA 查询无对应蛋白模板', matchDnaToAA(dnaForProtein, validProtein))

console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`)
process.exit(failed > 0 ? 1 : 0)
