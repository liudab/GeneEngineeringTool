import type { ComponentTag } from '../shared/types'

// 关键词匹配规则表
const TAG_RULES: [ComponentTag, string[]][] = [
  // 原有标签
  ['fluorescent-protein', ['gfp', 'mcherry', 'yfp', 'cfp', 'rfp', 'mvenus', 'mturquoise', 'fluorescent', 'egfp', 'sf-gfp', 'avGFP']],
  ['bioluminescent', ['luc', 'luciferase', 'renilla', 'firefly', 'nluc', 'fluc']],
  ['affinity-tag', ['his-tag', 'his tag', '6xhis', 'flag', 'gst', 'mbp', 'ha-tag', 'myc-tag', 'strep-tag', 'sumo-tag', 'calmodulin', 'cbp-tag']],
  ['selectable-marker', ['selectable', 'selection marker', 'screening marker']],
  ['auxotrophic-marker', ['auxotroph', 'trp1', 'leu2', 'his3', 'ura3', 'met15', 'lys2', 'ade2']],
  ['reporter-gene', ['reporter', 'gus', 'beta-glucuronidase', 'seap', 'secreted alkaline', 'lacZ', 'beta-gal']],
  ['regulatory', ['promoter', 'terminator', 'enhancer', 'operator', 'riboswitch', 'regulatory']],
  ['cloning', ['origin of replication', 'replication origin', 'mcs', 'multiple cloning site', 'puc ori', 'cole1']],
  ['expression', ['rbs', 'ribosome binding', 'kozak', 'polyA', 'poly(A)', 'signal peptide', 'secretion']],
  ['genome-editing', ['crispr', 'cas9', 'dcas9', 'guide rna', 'sgrna', 'talen', 'zinc finger']],
  ['protein-expression', ['fusion protein', 'cleavage site', 'linker', 'expression vector']],
  ['drug-resistance', ['ampicillin', 'kanamycin', 'chloramphenicol', 'tetracycline', 'bleomycin', 'hygromycin', 'spectinomycin', 'streptomycin', 'carbenicillin', 'gentamicin']],
  ['viral', ['ltr', 'itr', 'packaging', 'lentiviral', 'retroviral', 'aav', 'adeno-associated', 'baculovirus']],
  ['metabolic', ['metabolic', 'biosynthesis', 'pathway']],
  // 复制子细分
  ['bacterial-origin', ['cole1', 'p15a', 'pbr322', 'f1 ori', 'm13 ori', 'puc ori', 'bacterial origin']],
  ['yeast-origin', ['2μ ori', '2mu', 'ars1', 'ceni', 'cen/ars', 'yeast origin', 'replicator']],
  ['mammalian-origin', ['sv40 ori', 'ebv ori', 'oriP', 'mammalian origin', 'epstein-barr']],
  ['plant-origin', ['virg', 'vir region', 'agrobacterium', 'ti plasmid', 'plant origin', 'binary vector']],
  // 启动子细分
  ['constitutive-promoter', ['constitutive', 'cmv', 'ef1a', 'ubiquitin', 'actin promoter', 'gapdh', '35S', 'caMV']],
  ['inducible-promoter', ['inducible', 'tet-on', 'tet-off', 'rtTA', 'tTA', 'gal4', 'lac promoter', 'trp promoter']],
  ['tissue-specific-promoter', ['tissue-specific', 'neuron-specific', 'liver-specific', 'heart-specific', 'muscle-specific']],
  // 抗性细分
  ['antibiotic-resistance', ['ampr', 'ampicillin', 'kanr', 'kanamycin', 'cmr', 'chloramphenicol', 'tetr', 'tetracycline', 'specr', 'spectinomycin', 'hygr', 'hygromycin', 'bleor', 'bleomycin', 'puror', 'puromycin']],
  ['herbicide-resistance', ['bar', 'pat', 'glyphosate', 'glufosinate', 'herbicide', 'bialaphos']],
  // T-DNA/农杆菌
  ['tdna-border', ['t-dna', 'tdna', 'left border', 'right border', 'lb', 'rb', 'vir region', 'agrobacterium']],
  // 蛋白质纯化标签
  ['his-tag', ['6xhis', 'his-tag', 'his tag', 'polyhistidine', 'histidine tag']],
  ['flag-tag', ['flag tag', 'flag-tag', 'dykddddk', 'flag epitope']],
  ['gst-tag', ['gst tag', 'gst-tag', 'glutathione s-transferase']],
  ['mbp-tag', ['mbp tag', 'mbp-tag', 'maltose-binding protein', 'maltose binding']],
  // 分泌/定位
  ['signal-peptide', ['signal peptide', 'signal sequence', 'secretion signal', 'leader sequence', 'pelB', 'ompA', 'maltose binding protein signal']],
  ['nls', ['nls', 'nuclear localization', 'nuclear localization signal', 'sv40 nls', 'nucleoplasmin']],
  ['nes', ['nes', 'nuclear export', 'nuclear export signal', 'crm1', 'exportin']],
  // 载体骨架
  ['backbone-element', ['backbone', 'vector backbone', 'plasmid backbone', 'scaffold']],
]

export function autoAnnotateTags(name: string, notes: string, aliases: string): ComponentTag[] {
  const text = `${name} ${notes} ${aliases}`.toLowerCase()
  const tags: ComponentTag[] = []
  for (const [tag, keywords] of TAG_RULES) {
    if (keywords.some(kw => text.includes(kw))) {
      tags.push(tag)
    }
  }
  return tags
}
