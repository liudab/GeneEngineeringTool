# HelixCraft 复用模块架构文档

> 本文档覆盖项目中所有被多页面/多模块复用的功能模块，包括架构设计意图、API 规范、数据流向和 Worker 化可行性分析。

---

## 一、架构全景：复用模块总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        渲染进程 (Renderer)                        │
│                                                                   │
│  ┌─────────────┐  ┌─────────────┐                                │
│  │ VectorPage  │  │VectorEditor │                                │
│  │             │  │    Page     │                                │
│  └──────┬──────┘  └──────┬──────┘                                │
│         │                │                                        │
│         └───────┬────────┘                                        │
│                 ▼                                                 │
│  ┌──────────────────────────────┐   ┌─────────────────────────┐  │
│  │   useSmartAnnotation Hook    │   │  useWorkerTask Hook      │  │
│  │  (智能标注统一入口)            │   │  (Worker 任务通用抽象)    │  │
│  └──────────────┬───────────────┘   └────────────┬────────────┘  │
│                 │                                │                │
│                 ▼                                ▼                │
│  ┌──────────────────────────────┐   ┌─────────────────────────┐  │
│  │  NormalizationDialog 组件     │   │    workerRegistry       │  │
│  │  (智能标注结果弹窗+候选选择)   │   │  (Worker 池 + 优先级队列) │  │
│  └──────────────────────────────┘   └────────────┬────────────┘  │
│                                                   │                │
│                 ┌─────────────────────────────────┤                │
│                 ▼                 ▼               ▼                │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐  │
│  │ alignment.worker │ │ primer-design    │ │ simulation       │  │
│  │ (序列比对)        │ │ .worker(引物设计) │ │ .worker(克隆模拟) │  │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘  │
│                                                                   │
│  workerHelpers.ts — setupWorkerHandler 统一消息分发                 │
└─────────────────────────────────────────────────────────────────┘

                            ▼ IPC (window.api)

┌─────────────────────────────────────────────────────────────────┐
│                        主进程 (Main)                              │
│                                                                   │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐  │
│  │   ipc.ts (handler)   │  │  services/                       │  │
│  │                      │──│  ├─ file-import-service.ts       │  │
│  │  参数验证→调用→返回   │  │  └─ sequencing-service.ts        │  │
│  └──────────┬───────────┘  └──────────────────────────────────┘  │
│             │                                                     │
│             ▼                                                     │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │                    db/ (Repository 层)                        ││
│  │  ├─ base.ts              (SQL 工具 + Schema + 备份)          ││
│  │  ├─ enzyme-repo.ts       (酶 CRUD + 种子数据)               ││
│  │  ├─ vector-repo.ts       (载体 + 实验室载体)                 ││
│  │  ├─ gene-repo.ts         (基因 CRUD + 关系管理)             ││
│  │  ├─ primer-repo.ts       (引物 CRUD + 比对 + XLSX)          ││
│  │  ├─ sequencing-repo.ts   (测序文件 CRUD)                    ││
│  │  ├─ component-repo.ts    (元件 CRUD + 变体 + 批量导入)      ││
│  │  ├─ component-matching.ts(元件匹配算法: scan + annotate)    ││
│  │  └─ seed-data.ts         (种子数据编排)                     ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                   │
│  database.ts — re-export 兼容入口（外部无需改导入路径）            │
└─────────────────────────────────────────────────────────────────┘
```

### 复用关系矩阵

| 模块 | 被调用于 | 调用者数量 |
|------|----------|-----------|
| `useSmartAnnotation` | VectorPage, VectorEditorPage | 2 |
| `NormalizationDialog` | VectorPage, VectorEditorPage | 2 |
| `useWorkerTask` | useAlignment, usePrimerDesign (可扩展) | 2+ |
| `workerRegistry` | useWorkerTask, useAlignment, usePrimerDesign | 3+ |
| `workerHelpers` | alignment.worker, primer-design.worker, simulation.worker, msa.worker | 4 |
| `component-matching` | ipc.ts (COMPONENT_SCAN_VECTOR, COMPONENT_SMART_ANNOTATE, COMPONENT_IDENTIFY_FEATURE) | 3 |
| `file-import-service` | ipc.ts (EDITOR_GET_DATA, GENE_EDITOR_GET_DATA, FILE_OPEN) | 3 |
| `sequencing-service` | ipc.ts (SEQUENCING_FILE_READ) | 1 |
| `db/*` repos | ipc.ts (所有 CRUD handler), services/ | 5+ |

---

## 二、各模块详细文档

### 2.1 `useSmartAnnotation` Hook

**文件路径**: `src/renderer/hooks/useSmartAnnotation.ts`

**职责边界**: 封装智能标注的完整调用链路（校验 → IPC → 状态管理），不包含结果处理逻辑。各页面保留自己的后处理差异（分类推断 vs feature 更新）。

**核心 API**:

```ts
interface UseSmartAnnotationReturn {
  annotate: (vectorId: number, sequence: string) => Promise<void>
  annotateWithFeatures: (features: any[], sequence: string) => Promise<void>
  status: 'idle' | 'running' | 'done' | 'error'
  matches: SmartMatchResult[] | null
  error: string
  isAnnotating: boolean
  reset: () => void
}
```

**数据流向**:
```
VectorPage:
  annotate(vectorId, seq)
    → window.api.getEditorData(vectorId)  // 获取 features
    → window.api.smartAnnotateComponents(features, seq)  // IPC 调用主进程
    → 主进程: component-matching.ts::smartAnnotateComponents()
    → 返回 SmartMatchResult[] (含 candidates)
    → setMatches(result), setStatus('done')

VectorEditorPage:
  annotateWithFeatures(features, seq)
    → window.api.smartAnnotateComponents(features, seq)
    → 同上
```

**调用方**:
- `VectorPage.tsx` — `handleSmartAnnotate()` 调用 `annotate()`
- `VectorEditorPage.tsx` — 智能标注按钮 onClick 调用 `annotateWithFeatures()`

**注意事项**:
- `annotate` 会自动通过 IPC 获取 features（从 DB 加载），适用于列表页无内存 features 的场景
- `annotateWithFeatures` 直接用已有 features，适用于编辑器页内存中已有 features 的场景
- 匹配阈值（nt-nt ≥99% / nt-aa ≥90%）由后端 `component-matching.ts` 控制，Hook 层不硬编码

---

### 2.2 `NormalizationDialog` 组件

**文件路径**: `src/renderer/components/NormalizationDialog.tsx`

**职责边界**: 展示智能标注匹配结果，支持逐条接受/拒绝、多候选歧义选择（radio button）。不包含匹配算法或数据库写入逻辑。

**核心 API**:

```ts
interface Props {
  matches: SmartMatchResult[]     // 匹配结果（含 candidates 字段）
  vectorName: string              // 载体名称（展示用）
  onAccept: (accepted: SmartMatchResult[]) => void  // 用户确认后回调
  onClose: () => void             // 关闭回调
}
```

**候选选择交互**:
1. 有 `candidates` 的匹配项显示"N个候选"展开按钮
2. 展开后显示 radio button 列表：当前匹配 + candidates（按 similarity 降序）
3. 默认选中当前匹配（similarity 最高）
4. 用户切换候选后，`finalMatches` 计算属性自动更新 `match_component_id/name/type`
5. 点击"应用标注"时，`onAccept` 传入用户最终确认的 `SmartMatchResult[]`

**数据流向**:
```
useSmartAnnotation.matches
  → NormalizationDialog (props.matches)
  → 用户选择/拒绝
  → finalMatches (useMemo 计算)
  → onAccept(finalMatches)
  → 各页面自行处理（VectorPage: 分类推断; VectorEditorPage: 更新 features + syncDB）
```

**调用方**:
- `VectorPage.tsx` — 标注完成后弹出，onAccept 触发 `handleNormalizationAccept`（分类推断）
- `VectorEditorPage.tsx` — 标注完成后弹出，onAccept 触发 feature 更新 + `syncNormalizationToDb`

---

### 2.3 `component-matching.ts` 元件匹配算法

**文件路径**: `src/main/db/component-matching.ts`

**职责边界**: 纯计算层——输入序列/特征 → 输出匹配结果。不包含数据库写入逻辑（写入由 `component-repo.ts` 的 `syncNormalizationToDb` 等函数负责）。

**核心 API**:

```ts
/**
 * 扫描载体序列，返回与元件数据库匹配的所有元件。
 * 支持三类比对：DNA→DNA、AA→DNA、DNA→AA。
 * 用于"规范化"场景（非智能标注）。
 */
function scanVectorForComponents(
  vectorSeq: string,
  features?: GenBankFeature[]
): ComponentMatch[]

/**
 * 智能标注元件：对载体中的每个 feature，在元件数据库中做全局序列比对。
 * nt-nt ≥99% 或 nt-aa ≥90% 视为达标匹配。
 * 额外收集 ≥80%/≥75% 的候选附加到 candidates 字段。
 * 序列比对全部失败时回退到名称匹配。
 */
function smartAnnotateComponents(
  features: GenBankFeature[],
  vectorSequence: string
): SmartMatchResult[]

/**
 * 对单个元件序列做数据库匹配识别。
 * 返回按相似度降序排列的候选列表（最多10个）。
 */
function identifyFeatureSequence(
  featureSeq: string
): Array<{
  component_id: number; standard_name: string;
  component_type: string; species: string;
  identity: number; match_type: 'exact' | 'partial'
}>
```

**匹配策略**:

| 比对模式 | 达标阈值 | 候选阈值 | 算法 |
|---------|---------|---------|------|
| nt-nt (核酸↔核酸) | ≥99% | ≥80% | 编辑距离 + 滑动窗口 |
| nt-aa (核酸↔氨基酸) | ≥90% | ≥75% | 六框翻译 + 编辑距离 + 滑动窗口 |
| name-match (名称回退) | 仅当序列全部未达标时触发 | — | 精确→子串→关键词→类型映射 |

**一对多支持**: `qualifiedMap<component_id, SmartMatchResult>` 按 component_id 收集所有达标匹配，一个 feature 可同时匹配多个数据库元件（如 KanR 区域同时匹配 AmpR 启动子和 KanR 抗性基因）。

**候选收集**: `candidateMap<component_id, SmartMatchCandidate>` 额外收集低阈值匹配，附加到结果的 `candidates` 字段（按 similarity 降序，最多5个），供 NormalizationDialog 歧义选择。

**数据流向**:
```
IPC handler (COMPONENT_SMART_ANNOTATE)
  → smartAnnotateComponents(features, seq)
  → queryAll vector_components (DB 查询元件库)
  → 对每个 feature:
    → extractFeatDNA (提取 DNA，支持环形跨越)
    → 六框翻译 translateAllFrames
    → 对每个 dbComp: nt-nt + nt-aa 比对
    → qualifiedMap 收集达标匹配
    → candidateMap 收集候选
    → attachCandidates 附加候选到结果
    → 无达标时 matchFeatureByName 名称回退
  → 返回 SmartMatchResult[] (含 candidates)
```

**调用方**:
- `ipc.ts` — `COMPONENT_SCAN_VECTOR`, `COMPONENT_SMART_ANNOTATE`, `COMPONENT_IDENTIFY_FEATURE`
- 通过 `database.ts` re-export

**依赖**:
- `db/base.ts` — `queryAll`, `reverseComplement`, `CODON_TABLE`
- `componentMatch.ts` — `matchAminoToDna`, `isValidDna`, `isValidProtein`, `slidingWindowMatch`
- `shared/types.ts` — `SmartMatchResult`, `SmartMatchCandidate`, `GenBankFeature`

**已知限制**:
- 每次调用都全量查询元件库（`SELECT * FROM vector_components`），元件库大时性能可能下降
- `scanVectorForComponents` 使用 `continue` 跳过后续比对模式（找到 DNA 匹配后不尝试 AA 匹配），这是设计意图（规范化场景只需最佳匹配）
- `smartAnnotateComponents` 不存在此限制，对每个元件尝试所有比对模式

---

### 2.4 `useWorkerTask` 通用 Hook

**文件路径**: `src/renderer/hooks/useWorkerTask.ts`

**职责边界**: 抽象 Worker 任务的通用生命周期管理（惰性创建 → 提交 → 进度 → 取消 → 清理）。不包含具体业务逻辑。

**核心 API**:

```ts
function useWorkerTask<TOutput = any>(
  workerName: string,        // Worker 在 Registry 中的名称
  workerFactory: () => Worker // Worker 工厂函数
): {
  execute: (taskType: string, input: any, options?: WorkerTaskOptions) => void
  cancel: () => void
  reset: () => void
  status: WorkerTaskStatus   // 'idle' | 'running' | 'done' | 'error' | 'cancelled'
  result: TOutput | null
  error: string
  progress: WorkerTaskProgress | null  // { percent, message }
}
```

**内置机制**:
- **惰性初始化**: 首次 `execute` 时才通过 `workerRegistry.getWorker()` 创建 Worker
- **RAF 节流进度**: `onProgress` 回调通过 `requestAnimationFrame` 节流，避免高频 `setState`
- **自动清理**: 组件卸载时 `workerRegistry.terminate()` + `cancelAnimationFrame`
- **取消**: 先尝试从队列移除，若正在执行则 `terminate Worker`

**调用方**:
- `useAlignment.ts` — `useWorkerTask('alignment', () => new Worker(...alignment.worker.ts...))`
- `usePrimerDesign.ts` — 目前使用独立的 workerRegistry 调用（可迁移到 useWorkerTask）
- 未来新增 Worker 任务时可直接使用

---

### 2.5 Worker 模块

#### `alignment.worker.ts`

**文件路径**: `src/renderer/workers/alignment.worker.ts`

**职责边界**: 在后台线程执行双序列比对计算，避免阻塞 UI 主线程。

**支持的任务类型**:

| 任务类型 | 输入 | 输出 | 说明 |
|---------|------|------|------|
| `align` | `{ seq1, seq2, type, params?, seq1Name?, seq2Name? }` | `AlignmentOutput` | 单次双序列比对 |
| `batch-align` | `{ pairs: AlignInput[] }` | `AlignmentOutput[]` | 批量比对（带进度上报） |
| `six-frame` | `{ sequence: string }` | `TranslatedFrame[]` | 仅六框翻译，无比对 |

**算法**:
- `nucleotide-nw`: Needleman-Wunsch 全局比对
- `nucleotide-sw`: Smith-Waterman 局部比对（返回 top 5）
- `protein`: Needleman-Wunsch + BLOSUM62 蛋白打分矩阵
- `nucleotide-protein`: 核酸六框翻译后与蛋白序列做 Smith-Waterman 比对，选最佳阅读框

**依赖**: `engine/alignment/` 纯算法模块（`alignSequences`, `sixFrameTranslation`）

#### `primer-design.worker.ts`

**文件路径**: `src/renderer/workers/primer-design.worker.ts`

**职责边界**: 在后台线程执行引物设计全流程（候选枚举 → 热力学评分 → 特异性检查 → 配对排序 → 多轮迭代）。

**支持的任务类型**:

| 任务类型 | 输入 | 输出 | 说明 |
|---------|------|------|------|
| `design` | `{ templateSeq, selectionStart, selectionEnd, mode, params? }` | `PrimerDesignResult` | 完整引物设计 |
| `cancel` | — | `{ ok: true }` | 设置取消标志 |

**取消机制**: `volatile cancelled flag` + `wrappedProgress` 回调注入检查点，每次进度上报时检查取消标志。

**依赖**: `engine/primer/primerDesigner.ts` — `designPrimersWithIterations`

#### `simulation.worker.ts`

**文件路径**: `src/renderer/workers/simulation.worker.ts`

**职责边界**: 在后台线程执行酶切模拟、连接模拟、凝胶电泳、克隆模拟、甲基化分析等 CPU 密集计算。

**支持的任务类型**: `digest`, `ligation`, `gel`, `cloning`, `methylation`

#### `msa.worker.ts`

**文件路径**: `src/renderer/workers/msa.worker.ts`

**职责边界**: 在后台线程执行多序列比对（ClustalW）和系统发育树构建。

**支持的任务类型**: `msa` — 输入 `{ sequences, isProtein?, params?, treeMethod? }`，输出 `MSAOutput`

---

### 2.6 `workerRegistry.ts` + `workerHelpers.ts`

#### `workerRegistry.ts`

**文件路径**: `src/renderer/workers/workerRegistry.ts`

**职责边界**: Worker 池全局管理器，负责 Worker 生命周期、任务调度和状态查询。

**核心 API**:

```ts
class WorkerRegistry {
  // Worker 生命周期
  getWorker(name: string, factory: () => Worker): Worker  // 注册/复用
  terminate(name: string): void                           // 终止
  terminateAll(): void                                    // 终止全部

  // 任务执行
  execute<TInput, TOutput>(
    workerName: string, taskType: string, input: TInput,
    options?: ExecuteOptions  // { priority, timeout, onProgress, retries }
  ): Promise<TOutput>

  cancel(taskId: string): void  // 取消任务

  // 状态查询
  isRunning(workerName: string): boolean
  getRunningTask(workerName: string): string | null
  queuedCount: number
  runningCount: number
}

// 全局单例
export const workerRegistry = new WorkerRegistry()
```

**内部机制**:
- **Worker 池**: `Map<name, WorkerEntry>`，同名 Worker 复用，不同名独立
- **优先级队列**: `high(0) > normal(1) > low(2)`，同优先级 FIFO
- **超时取消**: 超时自动 `terminate Worker` + `reject Promise` + 通过工厂重建 Worker
- **错误重试**: 可配置 `retries` 次数，失败后重新入队
- **进度路由**: 通过 `task.id` 匹配 `progress` 消息到对应 Promise 的 `onProgress` 回调

#### `workerHelpers.ts`

**文件路径**: `src/renderer/workers/workerHelpers.ts`

**职责边界**: Worker 端和主线程端的通信工具函数。

**核心 API**:

```ts
// Worker 端：统一消息分发（在 .worker.ts 文件内调用）
function setupWorkerHandler(
  handlers: Record<string, (input: any, reportProgress: (percent, message) => void) => any | Promise<any>>
): void

// 主线程端：简洁 Promise 包装（适合不需要 Registry 的简单场景）
function createWorkerProxy(worker: Worker): {
  execute: <T>(type: string, input: any) => Promise<T>
  terminate: () => void
}
```

**消息协议**:
```ts
// 请求（主线程 → Worker）
interface WorkerTask<TInput = unknown> {
  id: string       // 唯一任务 ID
  type: string     // 任务类型（如 'align', 'design'）
  input: TInput    // 任务输入数据
}

// 响应（Worker → 主线程）
interface WorkerResult<TOutput = unknown> {
  id: string           // 对应请求的 ID
  output?: TOutput     // 成功时的输出
  error?: string       // 失败时的错误信息
  progress?: { percent: number; message: string }  // 进度上报
}
```

**调用方**:
- 所有 `*.worker.ts` 文件使用 `setupWorkerHandler`
- `createWorkerProxy` 适用于不需要优先级队列/超时/重试的简单场景

---

### 2.7 `db/` Repository 模块

所有 Repository 模块遵循统一设计模式：

| 标准接口 | 说明 |
|---------|------|
| `getAll()` / `getList(filter?)` | 获取全部/过滤列表 |
| `getById(id)` | 根据 ID 获取单条 |
| `search(query)` | 模糊搜索 |
| `create(data)` | 创建，返回插入 ID |
| `update(id, data)` | 部分更新 |
| `delete(id)` | 删除 |

#### `base.ts` — 基础设施层

**文件路径**: `src/main/db/base.ts`

**职责**: SQL 执行原语、Schema 创建/迁移、数据库初始化、备份恢复、通用序列工具。

**核心导出**:
```ts
// SQL 工具
function queryAll<T>(sql, params?): T[]
function queryOne<T>(sql, params?): T | undefined
function run(sql, params?): void          // 执行 + saveDb
function runNoSave(sql, params?): void    // 执行但不持久化（批量操作用）
function runBatch(fn: () => void): void   // 事务包装：BEGIN → fn → COMMIT → saveDb
function saveDb(): void
function lastInsertId(): number

// 初始化与迁移
function initDatabase(customDbPath?): Promise<void>
function ensureFixedUserDataDir(): void
function migrateFromOldAppNames(): { migrated, from, files }

// 备份恢复
function exportDatabase(): Buffer
function restoreDatabase(buffer: Buffer): Promise<{ success, message }>
function createAutoBackup(): string | null

// 通用序列工具（被多个 repo 和 matching 模块复用）
function reverseComplement(seq: string): string
function translateDNA(dnaSeq: string): string
function calcTm(seq: string): number
function calcGcContent(seq: string): number
const CODON_TABLE: Record<string, string>
```

#### 各 Repository 一览

| 模块 | 文件 | 核心职责 | 特殊能力 |
|------|------|---------|---------|
| `enzyme-repo` | `db/enzyme-repo.ts` | 限制性内切酶 CRUD | `seedEnzymes()` 版本控制播种, `updateEnzymeLibrary()` 强制覆盖 |
| `vector-repo` | `db/vector-repo.ts` | 载体 + 实验室载体 CRUD | `saveVectorFeatures()` JSON 序列化, `getVectorEnzymeSites()` JOIN 查询 |
| `gene-repo` | `db/gene-repo.ts` | 基因序列 CRUD | `getGeneRelations()` 双向 UNION 查询, 按类型过滤 |
| `primer-repo` | `db/primer-repo.ts` | 引物 CRUD | `alignPrimerToGenes()` 正向+RC 精确/模糊匹配, `scanVectorForUniversalPrimers()`, `importPrimersFromXlsx()` |
| `sequencing-repo` | `db/sequencing-repo.ts` | 测序文件 CRUD | LEFT JOIN primers 关联引物名 |
| `component-repo` | `db/component-repo.ts` | 元件 CRUD + 变体 | `deduplicateComponents()` 去重, `mergeComponentsBySimilarity()` 合并, `batchImportComponentsFromFeatures()` 批量导入, `exportComponentsToJson()`/`importComponentsFromJson()` |
| `component-matching` | `db/component-matching.ts` | 匹配算法（纯计算） | `scanVectorForComponents()`, `smartAnnotateComponents()`, `identifyFeatureSequence()` |
| `seed-data` | `db/seed-data.ts` | 种子数据编排 | `seedVectorComponents()`, `purgeOldSeedComponents()` |

**依赖关系图**:
```
ipc.ts
  ├─ import * as db from './database'  (re-export barrel)
  │    ├─ db/base.ts
  │    ├─ db/enzyme-repo.ts
  │    ├─ db/vector-repo.ts
  │    ├─ db/gene-repo.ts
  │    ├─ db/primer-repo.ts
  │    ├─ db/sequencing-repo.ts
  │    ├─ db/component-repo.ts
  │    ├─ db/component-matching.ts
  │    └─ db/seed-data.ts
  ├─ services/file-import-service.ts
  │    └─ file-parser.ts
  └─ services/sequencing-service.ts
       ├─ db/sequencing-repo.ts
       ├─ ab1-parser.ts
       └─ base-caller.ts
```

---

### 2.8 Service 层

#### `file-import-service.ts`

**文件路径**: `src/main/services/file-import-service.ts`

**职责边界**: 统一多格式序列文件解析逻辑，消除 IPC 层 5 处重复的格式分支代码。

**核心 API**:

```ts
type ParsedFileContent =
  | { format: 'genbank'; data: GenBankRecord }
  | { format: 'fasta'; data: FastaRecord[] }
  | null

function parseFileContent(filePath: string): ParsedFileContent
function readFeaturesFromFile(filePath: string): GenBankFeature[]
```

**支持格式**: `.gb`, `.gbk`, `.genbank`, `.fasta`, `.fa`, `.fna`, `.dna` (binary), `.embl`, `.emb`

**调用方**: `ipc.ts` 的 `EDITOR_GET_DATA`, `GENE_EDITOR_GET_DATA` handler

#### `sequencing-service.ts`

**文件路径**: `src/main/services/sequencing-service.ts`

**职责边界**: 封装 AB1 测序文件的完整处理流程（解析 → 碱基识别 → 参考序列匹配）。

**核心 API**:

```ts
interface SequencingFileResult {
  [key: string]: any
  trace_data_parsed?: any
  peak_positions_parsed?: number[]
  quality_values_parsed?: number[]
  reference_sequence?: string
  reference_source?: string
}

function processSequencingFile(id: number): SequencingFileResult | null
```

**处理流程**:
1. 从 DB 获取测序文件记录
2. 解析 JSON 字段（trace/peaks/quality）
3. AB1 无 trace → 从磁盘重新解析 `parseAb1()`
4. AB1 有 trace → 运行 `callBases()` 碱基识别（每次重新运行，算法改进后自动更新 DB）
5. 自动匹配参考序列（按 sample_name / file_name 模糊匹配）

**调用方**: `ipc.ts` 的 `SEQUENCING_FILE_READ` handler

---

## 三、`component-matching.ts` Worker 化可行性分析

### 3.1 当前执行方式

`smartAnnotateComponents` 和 `scanVectorForComponents` 目前在 **Electron Main 进程**中执行：

```
渲染进程 (UI)
  → window.api.smartAnnotateComponents(features, seq)
  → IPC (异步)
  → 主进程: ipc.ts handler
  → component-matching.ts (同步执行)
  → 返回结果
  → 渲染进程接收
```

**CPU 密集程度分析**:

| 操作 | 复杂度 | 耗时评估（pGBKT7 约 4900bp, 20 features） |
|------|--------|------------------------------------------|
| DB 查询元件库 | `SELECT *` 一次 | ~5ms（SQLite WASM） |
| 每个 feature 的六框翻译 | O(n) × 6 帧 | ~1ms/feature |
| nt-nt 编辑距离比对 | O(n×m) 有界 | ~5-50ms/对（取决于序列长度差） |
| nt-nt 滑动窗口 | O(n×m) | ~10-100ms/对（长序列时） |
| nt-aa 编辑距离（6帧×3正向+3反向） | O(n×m) × 6 | ~10-30ms/对 |
| nt-aa 滑动窗口 | O(n×m) | ~5-20ms/对 |
| **总计（20 features × 100 dbComps）** | — | **~3-15秒** |

对于大型载体（如 >10000bp, 50+ features）或大元件库（500+ components），耗时可达 **30-60秒**，期间主进程被阻塞。

### 3.2 Worker 化收益

| 收益 | 评估 |
|------|------|
| **主进程响应性** | ✅ 显著。当前 3-60秒的同步阻塞会导致 Electron 主进程无法响应其他 IPC 请求、菜单事件、窗口管理。Worker 化后主进程保持响应。 |
| **UI 流畅度** | ⚠️ 间接收益。当前 IPC 是异步的，渲染进程不会阻塞。但主进程阻塞可能导致 IPC 响应延迟，表现为"点击后等待很久才出结果"。 |
| **并行能力** | ✅ 可同时运行多个标注任务（不同载体）。 |
| **进度上报** | ✅ 可通过 `reportProgress` 实时上报比对进度。 |

### 3.3 技术挑战

#### 挑战 1: SQLite 数据库依赖

**现状**: `smartAnnotateComponents` 和 `scanVectorForComponents` 在函数开头通过 `queryAll` 从 SQLite 查询元件库和变体数据。

```ts
const components = queryAll<VectorComponent>(
  'SELECT * FROM vector_components WHERE sequence IS NOT NULL ...'
)
const variants = queryAll<ComponentVariant>('SELECT * FROM component_variants')
```

**问题**: Web Worker 运行在渲染进程，无法直接访问主进程的 SQLite 数据库。

**解决方案**: **主进程预加载 + 序列化传入 Worker**

```ts
// 主进程 (ipc.ts)
async function handleSmartAnnotate(features, vectorSeq) {
  // 1. 主进程查询 DB，获取元件库快照
  const componentSnapshot = queryAll<VectorComponent>(...)
  const variantSnapshot = queryAll<ComponentVariant>(...)

  // 2. 将快照 + features + seq 传给渲染进程
  return { componentSnapshot, variantSnapshot, features, vectorSeq }
}

// 渲染进程 (useSmartAnnotation)
// 3. 将快照传入 Worker
worker.execute('smart-annotate', {
  componentSnapshot, variantSnapshot, features, vectorSeq
})
```

**序列化开销评估**:
- 典型元件库 ~100-500 条记录，每条约 2KB（含序列）
- 序列化总量 ~200KB-1MB
- `postMessage` 使用 structured clone，对纯 JSON 数据高效（~5-20ms）
- **结论**: 序列化开销可接受（远小于比对计算本身）

#### 挑战 2: 比对算法复用

**现状**: `component-matching.ts` 使用以下辅助函数：
- `calcSeqSimilarity` / `boundedEditDistance` — 自定义编辑距离（纯计算）
- `slidingWindowSimilarity` — 调用 `componentMatch.ts::slidingWindowMatch`（纯计算）
- `matchAminoToDna` — 调用 `componentMatch.ts`（纯计算）
- `reverseComplement` / `CODON_TABLE` / `translateAllFrames` — 纯计算
- `isValidDna` / `isValidProtein` — 纯计算

**关键发现**: 所有比对辅助函数都是**纯计算函数**，不依赖数据库。可以直接在 Worker 中使用。

**与 `alignment.worker.ts` 的关系**:
- `alignment.worker.ts` 使用 `engine/alignment/` 模块（Needleman-Wunsch / Smith-Waterman）
- `component-matching.ts` 使用自定义的编辑距离 + 滑动窗口
- 两套算法**独立**，不共享代码。但 `reverseComplement` 和 `CODON_TABLE` 在 `db/base.ts` 和 `engine/alignment/codonTable.ts` 中有重复定义

#### 挑战 3: 名称回退匹配

`matchFeatureByName` 需要查询全量元件的 `standard_name` 和 `aliases`，用于名称回退。

**解决方案**: 名称回退所需的 `nameCompCache` 数据已包含在 `componentSnapshot` 中（`standard_name`, `aliases`, `type`, `tags` 字段），无需额外查询。

### 3.4 推荐方案

**结论: 推荐 Worker 化**，采用"**主进程预加载 + 渲染进程 Worker 计算**"架构。

#### 架构设计

```
┌──────────────────────────────────────────────────────────┐
│  渲染进程                                                  │
│                                                            │
│  useSmartAnnotation Hook                                   │
│    │                                                       │
│    ├─ 1. IPC: 请求元件库快照                                 │
│    │     window.api.getComponentSnapshot()                 │
│    │     → 主进程: queryAll vector_components               │
│    │     → 主进程: queryAll component_variants              │
│    │     ← 返回 { components, variants, nameCache }        │
│    │                                                       │
│    ├─ 2. Worker: 提交匹配任务                               │
│    │     alignmentWorker.execute('smart-annotate', {       │
│    │       components, variants, features, vectorSeq       │
│    │     })                                                │
│    │     → Worker: 纯计算（比对 + 候选收集）                 │
│    │     → reportProgress(50, '比对 10/20 features...')    │
│    │     ← 返回 SmartMatchResult[]                         │
│    │                                                       │
│    └─ 3. 结果处理（各页面自行处理）                          │
│          VectorPage: 分类推断                               │
│          VectorEditorPage: 更新 features                   │
│                                                            │
└──────────────────────────────────────────────────────────┘
```

#### 实施步骤

1. **新增 IPC 通道**: `COMPONENT_GET_SNAPSHOT` — 主进程返回元件库 + 变体 + 名称缓存的序列化快照

2. **扩展 `alignment.worker.ts`**: 新增 `smart-annotate` 任务类型
   ```ts
   setupWorkerHandler({
     // ... 已有的 align, batch-align, six-frame
     async 'smart-annotate'(input: {
       components: SerializedComponent[]
       variants: SerializedVariant[]
       features: GenBankFeature[]
       vectorSeq: string
     }, reportProgress): Promise<SmartMatchResult[]> {
       // 纯计算：复用 component-matching 的比对逻辑
     }
   })
   ```

3. **提取纯计算核心**: 将 `smartAnnotateComponents` 的比对循环提取为独立纯函数（不依赖 `queryAll`），可放在 `engine/` 目录或 Worker 内

4. **修改 `useSmartAnnotation`**: 先 IPC 获取快照，再传入 Worker

#### 预期效果

| 指标 | 当前（主进程同步） | Worker 化后 |
|------|------------------|------------|
| 主进程阻塞 | 3-60秒 | 0ms（仅 IPC 快照查询 ~5ms） |
| UI 响应性 | 标注期间菜单/窗口无响应 | 完全响应 |
| 进度可见性 | 无（等待完成后一次性返回） | 实时进度上报 |
| 内存开销 | 主进程内存 | Worker 独立内存（快照 ~1MB） |
| 实现复杂度 | 低 | 中（需新增 IPC + Worker 任务类型） |

#### 不推荐 Worker 化的场景

- `scanVectorForComponents`（规范化场景）: 调用频率低，且结果直接用于 `syncNormalizationToDb`（DB 写入），Worker 化收益不大
- `identifyFeatureSequence`（单序列识别）: 输入小（单条序列），计算快（<1秒），无需 Worker
