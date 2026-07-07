import { ipcMain, dialog, app } from 'electron'
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'fs'
import path from 'path'
import { IPC_CHANNELS } from '../shared/types'
import type { Vector, GenBankFeature } from '../shared/types'
import * as db from './database'
import { parseGenBank, parseFasta, parseSnapGene } from './file-parser'
import { parseAb1 } from './ab1-parser'
import { createEditorWindow } from './index'
import { setLanguage } from '../shared/i18n'
import { buildMenu } from './menu'
import { generateGenBank, generateFasta } from './genbank-writer'

export function registerIpcHandlers(): void {
  // ============ 酶 ============
  ipcMain.handle(IPC_CHANNELS.ENZYME_LIST, () => {
    return db.getEnzymes()
  })

  ipcMain.handle(IPC_CHANNELS.ENZYME_GET, (_event, id: number) => {
    return db.getEnzyme(id)
  })

  ipcMain.handle(IPC_CHANNELS.ENZYME_SEARCH, (_event, query: string) => {
    return db.searchEnzymes(query)
  })

  ipcMain.handle(IPC_CHANNELS.ENZYME_CREATE, (_event, data) => {
    return db.createEnzyme(data)
  })

  ipcMain.handle(IPC_CHANNELS.ENZYME_UPDATE, (_event, id: number, data) => {
    return db.updateEnzyme(id, data)
  })

  ipcMain.handle(IPC_CHANNELS.ENZYME_DELETE, (_event, id: number) => {
    return db.deleteEnzyme(id)
  })

  // ============ 载体 ============
  ipcMain.handle(IPC_CHANNELS.VECTOR_LIST, () => {
    return db.getVectors()
  })

  ipcMain.handle(IPC_CHANNELS.VECTOR_GET, (_event, id: number) => {
    return db.getVector(id)
  })

  ipcMain.handle(IPC_CHANNELS.VECTOR_CREATE, (_event, data) => {
    return db.createVector(data)
  })

  ipcMain.handle(IPC_CHANNELS.VECTOR_UPDATE, (_event, id: number, data) => {
    return db.updateVector(id, data)
  })

  ipcMain.handle(IPC_CHANNELS.VECTOR_DELETE, (_event, id: number) => {
    return db.deleteVector(id)
  })

  ipcMain.handle(IPC_CHANNELS.VECTOR_ENZYME_SITES, (_event, vectorId: number) => {
    return db.getVectorEnzymeSites(vectorId)
  })

  // ============ 载体导入 ============
  ipcMain.handle(IPC_CHANNELS.VECTOR_IMPORT, async (event) => {
    const win = event.sender.getOwnerBrowserWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: '导入载体文件',
      filters: [
        { name: '序列文件', extensions: ['gb', 'gbk', 'genbank', 'fasta', 'fa', 'fna', 'dna'] },
        { name: 'GenBank', extensions: ['gb', 'gbk', 'genbank'] },
        { name: 'FASTA', extensions: ['fasta', 'fa', 'fna'] },
        { name: 'SnapGene', extensions: ['dna'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    })

    if (result.canceled || result.filePaths.length === 0) return { success: false, count: 0 }

    // 确保载体文件夹存在
    const vectorsDir = path.join(app.getPath('userData'), 'vectors')
    if (!existsSync(vectorsDir)) {
      mkdirSync(vectorsDir, { recursive: true })
    }

    const imported: number[] = []

    for (const filePath of result.filePaths) {
      const fileName = path.basename(filePath)
      const ext = path.extname(filePath).toLowerCase()

      // 复制文件到专用文件夹
      const destPath = path.join(vectorsDir, fileName)
      copyFileSync(filePath, destPath)

      if (ext === '.dna') {
        // SnapGene .dna 是二进制格式，需要以Buffer读取
        const buffer = readFileSync(filePath)
        const record = parseSnapGene(buffer)
        const vectorId = db.createVector({
          name: record.name || fileName.replace('.dna', ''),
          type: record.topology === 'circular' ? 'plasmid' : 'other',
          size_bp: record.size,
          description: record.description,
          sequence: record.sequence,
          backbone_id: null,
          purpose: 'cloning',
          host_type: 'ecoli',
          promoter_type: 'none',
          is_recombinant: false,
          antibiotic_resistance: '',
          copy_number: '',
          file_path: destPath,
          topology: record.topology,
          source_file: fileName
        })
        imported.push(vectorId)
      } else if (['.gb', '.gbk', '.genbank'].includes(ext)) {
        const content = readFileSync(filePath, 'utf-8')
        const record = parseGenBank(content)
        const vectorId = db.createVector({
          name: record.name || fileName.replace(ext, ''),
          type: record.topology === 'circular' ? 'plasmid' : 'other',
          size_bp: record.size,
          description: record.description,
          sequence: record.sequence,
          backbone_id: null,
          purpose: 'cloning',
          host_type: 'ecoli',
          promoter_type: 'none',
          is_recombinant: false,
          antibiotic_resistance: '',
          copy_number: '',
          file_path: destPath,
          topology: record.topology,
          source_file: fileName
        })
        imported.push(vectorId)
      } else if (['.fasta', '.fa', '.fna'].includes(ext)) {
        const content = readFileSync(filePath, 'utf-8')
        const records = parseFasta(content)
        for (const rec of records) {
          const vectorId = db.createVector({
            name: rec.id || fileName.replace(ext, ''),
            type: 'other',
            size_bp: rec.sequence.length,
            description: rec.description,
            sequence: rec.sequence,
            backbone_id: null,
            purpose: 'cloning',
            host_type: 'ecoli',
            promoter_type: 'none',
            is_recombinant: false,
            antibiotic_resistance: '',
            copy_number: '',
            file_path: destPath,
            topology: 'linear',
            source_file: fileName
          })
          imported.push(vectorId)
        }
      }
    }

    return { success: true, count: imported.length, ids: imported }
  })

  // ============ 基因序列 ============
  ipcMain.handle(IPC_CHANNELS.GENE_LIST, (_event, type?: string) => {
    return db.getGenes(type as any)
  })

  ipcMain.handle(IPC_CHANNELS.GENE_GET, (_event, id: number) => {
    return db.getGene(id)
  })

  ipcMain.handle(IPC_CHANNELS.GENE_SEARCH, (_event, query: string, type?: string) => {
    return db.searchGenes(query, type as any)
  })

  ipcMain.handle(IPC_CHANNELS.GENE_CREATE, (_event, data) => {
    return db.createGene(data)
  })

  ipcMain.handle(IPC_CHANNELS.GENE_UPDATE, (_event, id: number, data) => {
    return db.updateGene(id, data)
  })

  ipcMain.handle(IPC_CHANNELS.GENE_DELETE, (_event, id: number) => {
    return db.deleteGene(id)
  })

  ipcMain.handle(IPC_CHANNELS.GENE_RELATIONS, (_event, geneId: number) => {
    return db.getGeneRelations(geneId)
  })

  // ============ 实验室载体 ============
  ipcMain.handle(IPC_CHANNELS.LAB_VECTOR_LIST, () => {
    return db.getLabVectors()
  })

  ipcMain.handle(IPC_CHANNELS.LAB_VECTOR_GET, (_event, id: number) => {
    return db.getLabVector(id)
  })

  ipcMain.handle(IPC_CHANNELS.LAB_VECTOR_CREATE, (_event, data) => {
    return db.createLabVector(data)
  })

  ipcMain.handle(IPC_CHANNELS.LAB_VECTOR_UPDATE, (_event, id: number, data) => {
    return db.updateLabVector(id, data)
  })

  ipcMain.handle(IPC_CHANNELS.LAB_VECTOR_DELETE, (_event, id: number) => {
    return db.deleteLabVector(id)
  })

  // ============ 文件操作 ============
  ipcMain.handle(IPC_CHANNELS.FILE_OPEN, async (event) => {
    const win = event.sender.getOwnerBrowserWindow()
    const result = await dialog.showOpenDialog(win!, {
      filters: [
        { name: '序列文件', extensions: ['gb', 'gbk', 'genbank', 'fasta', 'fa', 'fna', 'dna'] },
        { name: 'GenBank', extensions: ['gb', 'gbk', 'genbank'] },
        { name: 'FASTA', extensions: ['fasta', 'fa', 'fna'] },
        { name: 'SnapGene', extensions: ['dna'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = result.filePaths[0]
    const ext = path.extname(filePath).toLowerCase()

    if (ext === '.dna') {
      // SnapGene .dna 是二进制格式
      const buffer = readFileSync(filePath)
      return { type: 'genbank', data: parseSnapGene(buffer), filePath }
    }

    const content = readFileSync(filePath, 'utf-8')
    if (['.gb', '.gbk', '.genbank'].includes(ext)) {
      return { type: 'genbank', data: parseGenBank(content), filePath }
    } else if (['.fasta', '.fa', '.fna'].includes(ext)) {
      return { type: 'fasta', data: parseFasta(content), filePath }
    }

    return null
  })

  ipcMain.handle(IPC_CHANNELS.FILE_PARSE_GENBANK, (_event, content: string) => {
    return parseGenBank(content)
  })

  ipcMain.handle(IPC_CHANNELS.FILE_PARSE_FASTA, (_event, content: string) => {
    return parseFasta(content)
  })

  // ============ 编辑器窗口 ============
  ipcMain.handle(IPC_CHANNELS.EDITOR_OPEN, (_event, vectorId: number) => {
    createEditorWindow(vectorId)
  })

  ipcMain.handle(IPC_CHANNELS.EDITOR_GET_DATA, (_event, vectorId: number) => {
    const vector = db.getVector(vectorId)
    if (!vector) return null

    // 如果有文件路径，重新解析获取 features
    let features: GenBankFeature[] = []
    if (vector.file_path && existsSync(vector.file_path)) {
      const ext = path.extname(vector.file_path).toLowerCase()
      if (ext === '.dna') {
        const buffer = readFileSync(vector.file_path)
        const record = parseSnapGene(buffer)
        features = record.features
      } else if (['.gb', '.gbk', '.genbank'].includes(ext)) {
        const content = readFileSync(vector.file_path, 'utf-8')
        const record = parseGenBank(content)
        features = record.features
      }
    }

    // 如果数据库没有序列但有文件，从文件读取
    let sequence = vector.sequence || ''
    if (!sequence && vector.file_path && existsSync(vector.file_path)) {
      const ext = path.extname(vector.file_path).toLowerCase()
      if (ext === '.dna') {
        const buffer = readFileSync(vector.file_path)
        const record = parseSnapGene(buffer)
        sequence = record.sequence
        if (features.length === 0) features = record.features
      } else if (['.gb', '.gbk', '.genbank'].includes(ext)) {
        const content = readFileSync(vector.file_path, 'utf-8')
        const record = parseGenBank(content)
        sequence = record.sequence
        if (features.length === 0) features = record.features
      } else if (['.fasta', '.fa', '.fna'].includes(ext)) {
        const records = parseFasta(content)
        if (records.length > 0) sequence = records[0].sequence
      }
    }

    const enzymeSites = db.getVectorEnzymeSites(vectorId)

    return {
      vector: { ...vector, sequence },
      features,
      enzymeSites
    }
  })

  ipcMain.handle(IPC_CHANNELS.EDITOR_SAVE_SEQUENCE, (_event, vectorId: number, sequence: string) => {
    db.updateVector(vectorId, { sequence, size_bp: sequence.length })
    return true
  })

  ipcMain.handle(IPC_CHANNELS.EDITOR_ADD_FEATURE, (_event, _vectorId: number, _feature: GenBankFeature) => {
    // Features are stored via GenBank file; for in-memory editing, handled in renderer
    return true
  })

  // ============ 菜单语言切换 ============
  ipcMain.on(IPC_CHANNELS.MENU_SET_LANGUAGE, (_event, lang: 'zh' | 'en') => {
    setLanguage(lang)
    buildMenu()
  })

  // ============ 文件另存为 ============
  ipcMain.handle(IPC_CHANNELS.FILE_SAVE_GENBANK, async (event, vectorId: number) => {
    const vector = db.getVector(vectorId)
    if (!vector) return false
    let features: GenBankFeature[] = []
    if (vector.file_path && existsSync(vector.file_path)) {
      const ext = path.extname(vector.file_path).toLowerCase()
      if (ext === '.dna') {
        const buffer = readFileSync(vector.file_path)
        const record = parseSnapGene(buffer)
        features = record.features
      } else if (['.gb', '.gbk', '.genbank'].includes(ext)) {
        const content = readFileSync(vector.file_path, 'utf-8')
        const record = parseGenBank(content)
        features = record.features
      }
    }
    const genbank = generateGenBank(vector, features)
    const win = event.sender.getOwnerBrowserWindow()
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: `${vector.name}.gb`,
      filters: [{ name: 'GenBank', extensions: ['gb'] }]
    })
    if (result.canceled || !result.filePath) return false
    writeFileSync(result.filePath, genbank, 'utf-8')
    return true
  })

  ipcMain.handle(IPC_CHANNELS.FILE_SAVE_FASTA, async (event, vectorId: number) => {
    const vector = db.getVector(vectorId)
    if (!vector) return false
    const fasta = generateFasta(vector)
    const win = event.sender.getOwnerBrowserWindow()
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: `${vector.name}.fasta`,
      filters: [{ name: 'FASTA', extensions: ['fasta', 'fa'] }]
    })
    if (result.canceled || !result.filePath) return false
    writeFileSync(result.filePath, fasta, 'utf-8')
    return true
  })

  // ============ 引物 ============
  ipcMain.handle(IPC_CHANNELS.PRIMER_LIST, (_event, category?: string) => {
    return db.getPrimers(category as any)
  })

  ipcMain.handle(IPC_CHANNELS.PRIMER_GET, (_event, id: number) => {
    return db.getPrimer(id)
  })

  ipcMain.handle(IPC_CHANNELS.PRIMER_SEARCH, (_event, query: string, category?: string) => {
    return db.searchPrimers(query, category as any)
  })

  ipcMain.handle(IPC_CHANNELS.PRIMER_CREATE, (_event, data: any) => {
    return db.createPrimer(data)
  })

  ipcMain.handle(IPC_CHANNELS.PRIMER_UPDATE, (_event, id: number, data: any) => {
    db.updatePrimer(id, data)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.PRIMER_DELETE, (_event, id: number) => {
    db.deletePrimer(id)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.PRIMER_ALIGN, (_event, primerId: number) => {
    return db.alignPrimerToGenes(primerId)
  })

  ipcMain.handle(IPC_CHANNELS.PRIMER_SCAN_VECTOR, (_event, vectorSeq: string) => {
    return db.scanVectorForUniversalPrimers(vectorSeq)
  })

  ipcMain.handle(IPC_CHANNELS.PRIMER_IMPORT_XLSX, async (event) => {
    const win = event.sender.getOwnerBrowserWindow()
    const result = await dialog.showOpenDialog(win!, {
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return 0
    const buffer = readFileSync(result.filePaths[0])
    return db.importPrimersFromXlsx(buffer)
  })

  // ============ 测序文件 ============
  ipcMain.handle(IPC_CHANNELS.SEQUENCING_FILE_LIST, () => {
    return db.getSequencingFiles()
  })

  ipcMain.handle(IPC_CHANNELS.SEQUENCING_FILE_GET, (_event, id: number) => {
    return db.getSequencingFile(id)
  })

  ipcMain.handle(IPC_CHANNELS.SEQUENCING_FILE_SEARCH, (_event, query: string) => {
    return db.searchSequencingFiles(query)
  })

  ipcMain.handle(IPC_CHANNELS.SEQUENCING_FILE_CREATE, (_event, data: any) => {
    return db.createSequencingFile(data)
  })

  ipcMain.handle(IPC_CHANNELS.SEQUENCING_FILE_UPDATE, (_event, id: number, data: any) => {
    db.updateSequencingFile(id, data)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.SEQUENCING_FILE_DELETE, (_event, id: number) => {
    db.deleteSequencingFile(id)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.SEQUENCING_FILE_IMPORT, async (event) => {
    const win = event.sender.getOwnerBrowserWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: '导入测序文件',
      filters: [
        { name: '测序文件', extensions: ['ab1', 'seq', 'fasta', 'fa'] },
        { name: 'AB1 (Applied Biosystems)', extensions: ['ab1'] },
        { name: 'SEQ/FASTA', extensions: ['seq', 'fasta', 'fa'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) return { success: false, count: 0 }

    const seqDir = path.join(app.getPath('userData'), 'sequencing')
    if (!existsSync(seqDir)) mkdirSync(seqDir, { recursive: true })

    const imported: number[] = []
    for (const filePath of result.filePaths) {
      const fileName = path.basename(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const destPath = path.join(seqDir, fileName)
      copyFileSync(filePath, destPath)

      let fileType: 'ab1' | 'seq' | 'fasta' = 'seq'
      if (ext === '.ab1') fileType = 'ab1'
      else if (['.fasta', '.fa'].includes(ext)) fileType = 'fasta'

      let sequence = ''
      let traceData = ''
      let peakPositions = ''
      let qualityValues = ''
      let runInfo = ''
      let sampleName = fileName.replace(ext, '')

      if (ext === '.ab1') {
        try {
          const buffer = readFileSync(filePath)
          const ab1 = parseAb1(buffer)
          sequence = ab1.sequence
          traceData = JSON.stringify(ab1.traces)
          peakPositions = JSON.stringify(ab1.peakPositions)
          qualityValues = JSON.stringify(ab1.qualityValues)
          runInfo = ab1.runInfo
          sampleName = ab1.sampleName || sampleName
        } catch (err: any) {
          console.error(`[AB1] 解析失败 ${fileName}:`, err.message)
          // 解析失败仍然导入文件，只是没有 trace 数据
        }
      } else if (['.fasta', '.fa'].includes(ext)) {
        const content = readFileSync(filePath, 'utf-8')
        const records = parseFasta(content)
        if (records.length > 0) {
          sequence = records[0].sequence
          sampleName = records[0].id || sampleName
        }
      } else if (ext === '.seq') {
        // .seq 文件可能是纯序列或 FASTA 格式
        const content = readFileSync(filePath, 'utf-8').replace(/\r/g, '').trim()
        if (content.startsWith('>')) {
          // FASTA 格式
          const records = parseFasta(content)
          if (records.length > 0) {
            sequence = records[0].sequence.toUpperCase()
            sampleName = records[0].id || sampleName
          }
        } else {
          // 纯序列格式：去除数字、空格、换行等非序列字符
          sequence = content.replace(/[^A-Za-z]/g, '').toUpperCase()
        }
      }

      const id = db.createSequencingFile({
        file_name: fileName,
        file_path: destPath,
        file_type: fileType,
        sample_name: sampleName,
        direction: 'forward',
        primer_id: null,
        sequence,
        trace_data: traceData,
        peak_positions: peakPositions,
        quality_values: qualityValues,
        run_info: runInfo,
        notes: ''
      })
      imported.push(id)
    }
    return { success: true, count: imported.length, ids: imported }
  })

  ipcMain.handle(IPC_CHANNELS.SEQUENCING_FILE_READ, (_event, id: number) => {
    const file = db.getSequencingFile(id)
    if (!file) return null
    const result: any = { ...file }
    if (file.trace_data) {
      try { result.trace_data_parsed = JSON.parse(file.trace_data) } catch { /* ignore */ }
    }
    if (file.peak_positions) {
      try { result.peak_positions_parsed = JSON.parse(file.peak_positions) } catch { /* ignore */ }
    }
    if (file.quality_values) {
      try { result.quality_values_parsed = JSON.parse(file.quality_values) } catch { /* ignore */ }
    }
    return result
  })
}
