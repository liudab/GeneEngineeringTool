/**
 * RiceXPro X 轴样本标签的中文翻译（前端渲染层处理，跟随应用语言切换）
 * 采用「短语词典（按长度降序匹配）+ 规则替换」策略，未匹配部分保留原英文，避免空白/undefined
 */

// 短语词典：复合词/多词短语在前，单词在后（实际匹配按长度降序）
const PHRASE_DICT: Record<string, string> = {
  // 复合发育阶段（优先于单词匹配）
  'Vegetative_Reproductive': '营养生殖期',
  'Reproductive_Ripening': '生殖成熟期',
  // 组织名称（多词优先）
  'Leaf blade': '叶片',
  'Leaf sheath': '叶鞘',
  'cm panicle': 'cm穗',
  'mm floret': 'mm小花',
  'Inflorescence': '花序',
  'Anther': '花药',
  'Pistil': '雌蕊',
  'Lemma': '外稃',
  'Palea': '内稃',
  'Ovary': '子房',
  'Embryo': '胚',
  'Endosperm': '胚乳',
  'Root': '根',
  'Stem': '茎',
  // 发育阶段（单词）
  'vegetative': '营养期',
  'reproductive': '生殖期',
  'ripening': '成熟期',
  'Vegetative': '营养期',
  'Reproductive': '生殖期',
  'Ripening': '成熟期',
  // 处理条件与单位
  'Control': '对照',
  'panicle': '穗',
  'floret': '小花',
  'min': '分钟',
  'hr': '小时'
}

// 按短语长度降序排列，确保长短语优先匹配（如 "Leaf blade" 先于 "Leaf"）
const SORTED_PHRASES = Object.keys(PHRASE_DICT).sort((a, b) => b.length - a.length)

/**
 * 将单个 RXP 样本标签翻译为当前语言
 * @param label 原始英文标签（来自后端 sample_labels）
 * @param lang 当前应用语言（'zh' 显示中文，其余返回原英文）
 */
export function translateRxpLabel(label: string, lang: string): string {
  if (lang !== 'zh' || !label) return label
  let result = label
  for (const en of SORTED_PHRASES) {
    if (result.includes(en)) result = result.split(en).join(PHRASE_DICT[en])
  }
  // 营养缺失处理：-N/-P/-K
  result = result.replace(/-N/g, '缺氮').replace(/-P/g, '缺磷').replace(/-K/g, '缺钾')
  // 独立小时后缀（如 6h → 6小时；不影响已翻译的"小时"）
  result = result.replace(/(\d)h\b/g, '$1小时')
  return result
}

/** 批量翻译标签数组 */
export function translateRxpLabels(labels: string[], lang: string): string[] {
  return labels.map(l => translateRxpLabel(l, lang))
}

// ============ MSU RNA-Seq 样本名称翻译 ============
const MSU_SAMPLE_DICT: Record<string, string> = {
  'Root': '根',
  'Shoot': '芽',
  'Leaf': '叶',
  'Leaf blade': '叶片',
  'Leaf sheath': '叶鞘',
  'Panicle': '穗',
  'Anther': '花药',
  'Pistil': '雌蕊',
  'Ovary': '子房',
  'Embryo': '胚',
  'Endosperm': '胚乳',
  'Stem': '茎',
  'Node': '节',
  'Internode': '节间',
  'Callus': '愈伤组织',
  'Seed': '种子',
  'Seedling': '幼苗',
  'Flower': '花',
  'Spikelet': '小穗',
  'Rachis': '穗轴',
  'Rachilla': '小穗轴',
  'Lemma': '外稃',
  'Palea': '内稃',
  'Stamen': '雄蕊',
  'Carpel': '心皮',
  'Coleoptile': '胚芽鞘',
  'Coleorhiza': '胚根鞘',
  'Radicle': '胚根',
  'Plumule': '胚芽',
  'Young panicle': '幼穗',
  'Mature leaf': '成熟叶',
  'Young leaf': '幼叶',
  'Flag leaf': '剑叶',
  'Tiller': '分蘗',
  'Tiller base': '分蘗基部',
  'Shoot base': '茎基部',
  'Root tip': '根尖',
  'Mature embryo': '成熟胚',
  'Mature endosperm': '成熟胚乳',
  'Developing endosperm': '发育中胚乳',
  'Developing embryo': '发育中胚',
  'Germinating embryo': '萌发胚',
  'Dry seed': '干种子',
  'Imbibed seed': '吸水种子',
  'Vegetative': '营养期',
  'Reproductive': '生殖期',
  'Ripening': '成熟期',
  'Heading': '抽穗期',
  'Flowering': '开花期',
  'Boot': '孕穗期',
}

/** 翻译 MSU RNA-Seq 样本名称（中文环境显示中文，英文环境保留原文） */
export function translateMsuSample(sample: string, lang: string): string {
  if (lang !== 'zh' || !sample) return sample
  // 精确匹配
  if (MSU_SAMPLE_DICT[sample]) return MSU_SAMPLE_DICT[sample]
  // 短语替换（按长度降序）
  const sorted = Object.keys(MSU_SAMPLE_DICT).sort((a, b) => b.length - a.length)
  let result = sample
  for (const en of sorted) {
    if (result.includes(en)) result = result.split(en).join(MSU_SAMPLE_DICT[en])
  }
  return result
}
