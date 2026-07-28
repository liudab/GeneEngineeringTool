/**
 * @module services/gene-html-generator
 * @description 为每个基因目录生成完整的静态 HTML 详情页（复刻软件内基因详情面板）
 */

import { existsSync, readFileSync, readdirSync } from 'fs'
import path from 'path'
import { writeFileSync } from 'fs'

/**
 * 为指定基因目录生成 index.html（完整复刻基因详情页）
 */
export function generateGenePageHtml(geneDir: string): void {
  try {
    if (!existsSync(geneDir)) return

    // 读取 gene.json
    const geneJsonPath = path.join(geneDir, 'gene.json')
    if (!existsSync(geneJsonPath)) return
    const gene = JSON.parse(readFileSync(geneJsonPath, 'utf-8'))

    // 读取所有注释文件
    const annDir = path.join(geneDir, 'annotations')
    const ncbiSummary = readJsonSafe(path.join(annDir, 'ncbi', 'summary.json'))
    const ncbiTranscripts = readJsonSafe(path.join(annDir, 'ncbi', 'transcripts.json'))
    const ncbiCrossRefs = readJsonSafe(path.join(annDir, 'ncbi', 'cross_refs.json'))
    const rapdbLocus = readJsonSafe(path.join(annDir, 'rapdb', 'locus_info.json'))
    const rapdbOryzabase = readJsonSafe(path.join(annDir, 'rapdb', 'oryzabase.json'))
    const rapdbExpression = readJsonSafe(path.join(annDir, 'rapdb', 'expression.json'))
    const rapdbAnnData = readJsonSafe(path.join(annDir, 'rapdb', 'annotation_data.json'))
    const msuGeneInfo = readJsonSafe(path.join(annDir, 'msu', 'gene_info.json'))
    const msuAnnData = readJsonSafe(path.join(annDir, 'msu', 'annotation_data.json'))
    const msuRnaseq = readJsonSafe(path.join(annDir, 'msu', 'rnaseq_tpm.json'))
    const ricedataInfo = readJsonSafe(path.join(annDir, 'ricedata', 'gene_info.json'))
    const ricedataAnnData = readJsonSafe(path.join(annDir, 'ricedata', 'annotation_data.json'))

    // 读取序列 manifest
    const manifest = readJsonSafe(path.join(geneDir, 'sequences', 'manifest.json'))

    // 读取表达图片列表
    const imgDir = path.join(annDir, 'rapdb', 'images')
    const images = existsSync(imgDir) ? readdirSync(imgDir).filter(f => f.endsWith('.png')) : []

    // 读取图表型表达数据（expression/ 子目录中的 JSON 文件）
    const exprDataDir = path.join(annDir, 'rapdb', 'expression')
    const chartDataMap: Record<string, any> = {}
    if (existsSync(exprDataDir)) {
      const exprFiles = readdirSync(exprDataDir).filter(f => f.endsWith('.json'))
      for (const f of exprFiles) {
        const rxpId = f.replace('.json', '')
        const d = readJsonSafe(path.join(exprDataDir, f))
        if (d) chartDataMap[rxpId] = d
      }
    }

    // 构建 HTML
    const html = buildGeneHtml(gene, {
      ncbiSummary, ncbiTranscripts, ncbiCrossRefs,
      rapdbLocus, rapdbOryzabase, rapdbExpression, rapdbAnnData, images,
      chartDataMap,
      msuGeneInfo, msuAnnData, msuRnaseq,
      ricedataInfo, ricedataAnnData,
      manifest
    })

    writeFileSync(path.join(geneDir, 'index.html'), html, 'utf-8')
  } catch (err: any) {
    console.warn(`[GeneHtml] Failed to generate page for ${geneDir}: ${err.message}`)
  }
}

function readJsonSafe(filePath: string): any {
  try {
    if (existsSync(filePath)) return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {}
  return null
}

function esc(s: any): string {
  if (!s) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildGeneHtml(gene: any, data: any): string {
  const { ncbiSummary, ncbiTranscripts, ncbiCrossRefs, rapdbLocus, rapdbOryzabase, rapdbExpression, rapdbAnnData, images, chartDataMap, msuGeneInfo, msuAnnData, msuRnaseq, ricedataInfo, ricedataAnnData, manifest } = data

  // 序列文件列表
  let seqRows = ''
  if (Array.isArray(manifest)) {
    for (const s of manifest) {
      seqRows += `<tr><td><span class="badge badge-${s.source === 'NCBI' ? 'ncbi' : s.source === 'MSU' ? 'msu' : 'rapdb'}">${esc(s.source)}</span></td><td class="mono">${esc(s.accession)}</td><td>${esc(s.molType)}</td><td>${esc(s.format)}</td><td class="num">${s.length || '-'}</td><td><a href="sequences/${esc(s.fileName)}">打开</a></td></tr>\n`
    }
  }

  // 表达图谱区域（图片 + 图表型实验）
  const categories = rapdbExpression?.categories || []
  const totalExperiments = categories.reduce((s: number, c: any) => s + ((c.views || c.images || []).length), 0)
  // 构建分类和视图数据（内联到 JS，供图表渲染使用）
  const catData = categories.map((cat: any) => ({
    name: cat.name || cat.id,
    views: (cat.views || cat.images || []).map((v: any) => ({
      id: v.id || '',
      label: v.label || v.id || '',
      type: v.type || 'image',
      url: v.url || '',
      rxpId: v.rxpId || ''
    }))
  }))
  let exprSection = ''
  if (totalExperiments > 0 || images.length > 0) {
    exprSection = `<div class="section"><h3>Expression (RiceXPro) 时空表达图谱（${totalExperiments} 个实验）</h3>
<div id="expr-viewer">
  <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
    <select id="expr-cat-sel" onchange="exprCatChange()"></select>
    <select id="expr-view-sel" onchange="exprViewChange()"></select>
  </div>
  <div id="expr-content" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;min-height:200px"></div>
</div>
</div>`
  }

  // NCBI 转录本表格
  let txRows = ''
  if (ncbiTranscripts?.transcripts) {
    for (const t of ncbiTranscripts.transcripts) {
      txRows += `<tr><td class="mono">${esc(t.transcript_id)}</td><td>${esc(t.name)}</td><td class="num">${t.exon_count || '-'}</td><td class="num">${t.mrna_length || '-'} bp</td><td class="num">${t.cds_length || '-'} bp</td><td class="num">${t.protein_length || '-'} aa</td></tr>\n`
    }
  }

  // 交叉引用
  let refLinks = ''
  if (ncbiCrossRefs?.cross_references) {
    refLinks = ncbiCrossRefs.cross_references.map((r: any) => `<a href="${esc(r.url)}" target="_blank" class="ref-link">[${esc(r.database)}] ${esc(r.accession)}</a>`).join(' ')
  }

  // RAP-DB 注释
  const rapdbInfo = rapdbAnnData || rapdbLocus
  let rapdbDesc = ''
  if (rapdbInfo) {
    const fields = ['gene_chinese_name', 'basic_info', 'mutant_phenotype', 'mapping_cloning', 'expression_pattern', 'subcellular_location', 'biological_function', 'references']
    for (const f of fields) {
      if (rapdbInfo[f]) rapdbDesc += `<details class="desc-block"><summary>${esc(f)}</summary><pre class="desc-content">${esc(rapdbInfo[f])}</pre></details>\n`
    }
  }

  // Oryzabase
  let oryzabaseHtml = ''
  if (rapdbOryzabase) {
    const o = rapdbOryzabase
    oryzabaseHtml = `
      ${o.gene_symbol ? `<p><strong>基因符号:</strong> ${esc(o.gene_symbol)}</p>` : ''}
      ${o.gene_name ? `<p><strong>基因名称:</strong> ${esc(o.gene_name)}</p>` : ''}
      ${o.note ? `<p><strong>功能:</strong> ${esc(o.note)}</p>` : ''}
      ${o.oryzabase_gene_synonyms ? `<p><strong>别名:</strong> ${esc(o.oryzabase_gene_synonyms)}</p>` : ''}
      ${o.interpro ? `<p><strong>InterPro:</strong> ${esc(Array.isArray(o.interpro) ? o.interpro.join('; ') : o.interpro)}</p>` : ''}
      ${o.go_terms ? `<p><strong>GO:</strong> ${esc(Array.isArray(o.go_terms) ? o.go_terms.join('; ') : o.go_terms)}</p>` : ''}
      ${o.literature ? `<p><strong>文献:</strong> ${esc(o.literature)}</p>` : ''}`
  }

  // MSU 信息
  let msuHtml = ''
  const msu = msuAnnData || msuGeneInfo
  if (msu) {
    if (msu.gene_product_name) msuHtml += `<p><strong>基因产物:</strong> ${esc(msu.gene_product_name)}</p>`
    if (msu.locus_name) msuHtml += `<p><strong>基因座:</strong> ${esc(msu.locus_name)}</p>`
    if (msu.go_terms) msuHtml += `<p><strong>GO:</strong> ${esc(JSON.stringify(msu.go_terms))}</p>`
  }

  // RiceData
  let ricedataHtml = ''
  const rd = ricedataAnnData || ricedataInfo
  if (rd) {
    const fields = ['gene_chinese_name', 'gene_english_name', 'gene_symbol', 'basic_info', 'mutant_phenotype', 'mapping_cloning', 'expression_pattern', 'subcellular_location', 'biological_function', 'references']
    for (const f of fields) {
      if (rd[f]) ricedataHtml += `<details class="desc-block"><summary>${esc(f)}</summary><pre class="desc-content">${esc(rd[f])}</pre></details>\n`
    }
  }

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>${esc(gene.gene_name)} - HelixCraft</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b;font-size:13px}
.header{background:#fff;border-bottom:1px solid #e2e8f0;padding:16px 24px}
.header h1{font-size:18px;font-weight:700}
.header .meta{font-size:12px;color:#64748b;margin-top:4px}
.tabs{display:flex;gap:0;border-bottom:1px solid #e2e8f0;background:#fff;padding:0 24px}
.tab{padding:10px 16px;font-size:12px;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;color:#64748b}
.tab.active{border-bottom-color:#06b6d4;color:#0891b2;background:#f0fdfa}
.tab:hover{color:#1e293b}
.content{padding:24px;max-width:1200px}
.panel{display:none}
.panel.active{display:block}
.section{margin-bottom:16px;padding:16px;background:#fff;border:1px solid #e2e8f0;border-radius:8px}
.section h3{font-size:13px;font-weight:600;color:#475569;margin-bottom:8px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{background:#f1f5f9;text-align:left;padding:6px 8px;font-weight:500;color:#475569}
td{padding:6px 8px;border-bottom:1px solid #f1f5f9}
.mono{font-family:'Cascadia Code',Consolas,monospace;font-size:11px}
.num{text-align:right;font-family:monospace}
.badge{display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:500}
.badge-ncbi{background:#dbeafe;color:#1d4ed8}
.badge-rapdb{background:#e0e7ff;color:#4338ca}
.badge-msu{background:#e0f2fe;color:#0369a1}
a{color:#3b82f6;text-decoration:none}
a:hover{text-decoration:underline}
.ref-link{margin-right:8px;font-size:11px}
.desc-block{margin:4px 0;border:1px solid #e2e8f0;border-radius:4px}
.desc-block summary{padding:8px 12px;cursor:pointer;font-weight:500;font-size:12px;background:#f8fafc}
.desc-content{padding:8px 12px;font-size:11px;white-space:pre-wrap;font-family:inherit;line-height:1.6}
.img-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin-top:8px}
.img-item{border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
.img-item img{width:100%;height:auto;display:block}
.img-item span{display:block;padding:4px 8px;font-size:10px;color:#64748b;background:#f8fafc}
.back-link{font-size:12px;margin-bottom:12px;display:inline-block}
</style>
</head>
<body>
<a href="../index.html" class="back-link" style="margin:12px 24px">← 返回基因列表</a>
<div class="header">
<h1>${esc(gene.gene_name)}</h1>
<div class="meta">${gene.ncbi_gene_id ? `NCBI: ${esc(gene.ncbi_gene_id)} | ` : ''}${esc(gene.species)} ${gene.accession_number ? `| ${esc(gene.accession_number)}` : ''}</div>
</div>
<div class="tabs">
<div class="tab active" onclick="showTab('ncbi',this)">NCBI</div>
<div class="tab" onclick="showTab('rapdb',this)">RAP-DB</div>
<div class="tab" onclick="showTab('msu',this)">MSU</div>
<div class="tab" onclick="showTab('ricedata',this)">RiceData</div>
<div class="tab" onclick="showTab('seq',this)">序列 (${Array.isArray(manifest) ? manifest.length : 0})</div>
</div>
<div class="content">

<div class="panel active" id="panel-ncbi">
${ncbiSummary ? `<div class="section"><h3>基因摘要</h3>
<p><strong>名称:</strong> ${esc(ncbiSummary.name)}</p>
<p><strong>描述:</strong> ${esc(ncbiSummary.description)}</p>
<p><strong>物种:</strong> ${esc(ncbiSummary.organism)}</p>
<p><strong>染色体:</strong> ${esc(ncbiSummary.chromosome)} ${ncbiSummary.chr_accession ? `(${esc(ncbiSummary.chr_accession)})` : ''}</p>
<p><strong>位置:</strong> ${ncbiSummary.genomic_range_start || ''}..${ncbiSummary.genomic_range_end || ''} (${esc(ncbiSummary.strand)})</p>
</div>` : '<div class="section"><p style="color:#94a3b8">暂无 NCBI 数据，请执行"更新 NCBI 信息"</p></div>'}
${txRows ? `<div class="section"><h3>转录本</h3><table><tr><th>Accession</th><th>名称</th><th>外显子</th><th>mRNA</th><th>CDS</th><th>Protein</th></tr>${txRows}</table></div>` : ''}
${refLinks ? `<div class="section"><h3>交叉引用</h3>${refLinks}</div>` : ''}
</div>

<div class="panel" id="panel-rapdb">
${rapdbOryzabase ? `<div class="section"><h3>Oryzabase 信息</h3>${oryzabaseHtml}</div>` : ''}
${rapdbDesc ? `<div class="section"><h3>基因注释</h3>${rapdbDesc}</div>` : ''}
${rapdbLocus ? `<div class="section"><h3>基因座信息</h3><p><strong>位置:</strong> ${esc(rapdbLocus.seqid)}:${rapdbLocus.start_pos || ''}..${rapdbLocus.end_pos || ''} (${esc(rapdbLocus.strand)})</p></div>` : ''}
${exprSection}
${!rapdbOryzabase && !rapdbDesc && !exprSection ? '<div class="section"><p style="color:#94a3b8">暂无 RAP-DB 数据，请执行“在线更新 RAP-DB 信息”</p></div>' : ''}
</div>

<div class="panel" id="panel-msu">
${msuHtml ? `<div class="section"><h3>MSU 基因信息</h3>${msuHtml}</div>` : ''}
${msuRnaseq?.samples ? `<div class="section"><h3>RNA-Seq TPM 表达值</h3><table><tr><th>Sample</th><th>TPM</th></tr>${msuRnaseq.samples.slice(0, 20).map((s: any) => `<tr><td>${esc(s.sample)}</td><td class="num">${s.tpm}</td></tr>`).join('')}</table></div>` : ''}
${!msuHtml && !msuRnaseq ? '<div class="section"><p style="color:#94a3b8">暂无 MSU 数据，请执行"获取全部数据"</p></div>' : ''}
</div>

<div class="panel" id="panel-ricedata">
${ricedataHtml ? `<div class="section"><h3>国家水稻数据中心</h3>${ricedataHtml}</div>` : '<div class="section"><p style="color:#94a3b8">暂无 RiceData 数据，请执行"从 RiceData 更新"</p></div>'}
</div>

<div class="panel" id="panel-seq">
<div class="section"><h3>序列文件清单</h3>
${seqRows ? `<table><tr><th>来源</th><th>Accession</th><th>类型</th><th>格式</th><th>长度</th><th>操作</th></tr>${seqRows}</table>` : '<p style="color:#94a3b8">暂无序列文件</p>'}
</div>
</div>

</div>
<script>
// ===== 标签页切换 =====
function showTab(name, el){
  document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('active')});
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active')});
  document.getElementById('panel-'+name).classList.add('active');
  if(el) el.classList.add('active');
}

// ===== 表达图谱数据（内联，离线可用） =====
var EXPR_CATS = ${JSON.stringify(catData || [])};
var CHART_DATA = ${JSON.stringify(chartDataMap || {})};

// ===== 表达图谱查看器 =====
var exprCatIdx = 0, exprViewIdx = 0;
function exprCatChange(){
  exprCatIdx = +document.getElementById('expr-cat-sel').value;
  exprViewIdx = 0;
  fillViewSel();
  renderExprView();
}
function exprViewChange(){
  exprViewIdx = +document.getElementById('expr-view-sel').value;
  renderExprView();
}
function fillViewSel(){
  var sel = document.getElementById('expr-view-sel');
  sel.innerHTML = '';
  var cat = EXPR_CATS[exprCatIdx];
  if(!cat) return;
  cat.views.forEach(function(v,i){
    var o = document.createElement('option');
    o.value = i; o.textContent = v.label + (v.type==='chart'?' [图表]':' [图片]');
    sel.appendChild(o);
  });
  sel.value = exprViewIdx;
}
function renderExprView(){
  var box = document.getElementById('expr-content');
  var cat = EXPR_CATS[exprCatIdx];
  if(!cat || !cat.views.length){ box.innerHTML='<p style="padding:24px;color:#94a3b8;font-size:12px">暂无表达数据</p>'; return; }
  var v = cat.views[Math.min(exprViewIdx, cat.views.length-1)];
  if(v.type === 'image'){
    box.innerHTML = '<img src="annotations/rapdb/images/' + v.id + '.png" alt="' + v.label + '" style="width:100%;height:auto;display:block">';
  } else if(v.type === 'chart'){
    var d = CHART_DATA[v.rxpId];
    if(!d || !d.data || !d.data.length){
      box.innerHTML='<p style="padding:24px;color:#94a3b8;font-size:12px">该实验暂无表达数据</p>';
    } else {
      box.innerHTML = renderChartSVG(v.label, d);
    }
  }
}

// ===== SVG 图表渲染（复刻 ExpressionBarChart：柱状图 + 箱型图） =====
function niceStep(max, target){
  var raw = max / target;
  var mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  var norm = raw / mag;
  var step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}
function boxStats(vals){
  var s = vals.slice().sort(function(a,b){return a-b});
  var n = s.length;
  var q1 = s[Math.floor(n*0.25)], med = s[Math.floor(n*0.5)], q3 = s[Math.floor(n*0.75)];
  var sum = s.reduce(function(a,b){return a+b},0), mean = sum/n;
  var sd = Math.sqrt(s.reduce(function(a,b){return a+(b-mean)*(b-mean)},0)/n);
  return {min:s[0], max:s[n-1], q1:q1, median:med, q3:q3, mean:mean, sd:sd};
}
function renderChartSVG(label, d){
  var data = d.data, labels = d.sample_labels || [];
  // 重建箱型图数据
  var boxData = null;
  if(d.repeats && d.repeats.length > 1){
    boxData = [];
    for(var i=0;i<data.length;i++) boxData.push([]);
    d.repeats.forEach(function(rep){
      var vals = rep.values || [];
      for(var i=0;i<Math.min(vals.length,data.length);i++) boxData[i].push(vals[i]);
    });
  }
  var hasBox = boxData && boxData.some(function(b){return b.length>1});
  var maxVal = hasBox ? Math.max.apply(null, boxData.map(function(b){return Math.max.apply(null,b)})) : Math.max.apply(null, data);
  if(maxVal <= 0) maxVal = 1;
  var W=960,H=480,mL=90,mR=30,mT=30,mB=110;
  var plotW=W-mL-mR, plotH=H-mT-mB, n=data.length, band=plotW/n;
  var boxW=Math.min(band*0.55,36);
  var step=niceStep(maxVal,5), yMax=Math.ceil(maxVal/step)*step;
  function yScale(v){return mT+plotH-(yMax>0?(v/yMax)*plotH:0)}
  var ticks=[]; for(var t=0;t<=yMax+1e-9;t+=step) ticks.push(t);
  var rotate = labels.length>0 || n>12;
  var labelEvery = n>80 ? Math.ceil(n/80) : 1;
  var svg = '<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" style="display:block;background:#fff" xmlns="http://www.w3.org/2000/svg">';
  // 标题
  svg += '<text x="'+mL+'" y="18" font-size="15" font-weight="600" fill="#334155">'+escHtml(label)+'</text>';
  svg += '<text x="'+(mL+340)+'" y="18" font-size="11" fill="#94a3b8">'+n+' 个样本'+(hasBox?' · '+boxData[0].length+' 次重复 · 箱型图':'')+'</text>';
  // 网格线 + Y轴
  ticks.forEach(function(tk){
    var y=yScale(tk);
    svg += '<line x1="'+mL+'" y1="'+y+'" x2="'+(mL+plotW)+'" y2="'+y+'" stroke="#e2e8f0" stroke-width="1"'+(tk!==0?' stroke-dasharray="3,3"':'')+'/>';
    var lbl = tk>=1000 ? (tk/1000).toFixed(1)+'k' : +tk.toFixed(2);
    svg += '<text x="'+(mL-8)+'" y="'+(y+4)+'" font-size="12" text-anchor="end" fill="#64748b">'+lbl+'</text>';
  });
  // 箱型图或柱状图
  if(hasBox){
    boxData.forEach(function(values,i){
      var cx=mL+i*band+band/2, st=boxStats(values);
      svg += '<g class="chart-g" data-idx="'+i+'">';
      svg += '<line x1="'+cx+'" y1="'+yScale(st.max)+'" x2="'+cx+'" y2="'+yScale(st.min)+'" stroke="#6366f1" stroke-width="1.5"/>';
      svg += '<line x1="'+(cx-boxW*0.3)+'" y1="'+yScale(st.max)+'" x2="'+(cx+boxW*0.3)+'" y2="'+yScale(st.max)+'" stroke="#6366f1" stroke-width="1.5"/>';
      svg += '<line x1="'+(cx-boxW*0.3)+'" y1="'+yScale(st.min)+'" x2="'+(cx+boxW*0.3)+'" y2="'+yScale(st.min)+'" stroke="#6366f1" stroke-width="1.5"/>';
      svg += '<rect x="'+(cx-boxW/2)+'" y="'+yScale(st.q3)+'" width="'+boxW+'" height="'+Math.max(1,yScale(st.q1)-yScale(st.q3))+'" rx="2" fill="#e0e7ff" stroke="#6366f1" stroke-width="1.5"/>';
      svg += '<line x1="'+(cx-boxW/2)+'" y1="'+yScale(st.median)+'" x2="'+(cx+boxW/2)+'" y2="'+yScale(st.median)+'" stroke="#4338ca" stroke-width="2.5"/>';
      values.forEach(function(v,j){
        var jitter=(j-(values.length-1)/2)*(boxW*0.22);
        svg += '<circle cx="'+(cx+jitter)+'" cy="'+yScale(v)+'" r="3" fill="#818cf8" opacity="0.85"/>';
      });
      svg += '<title>'+escHtml(labels[i]||String(i+1))+': '+st.mean.toFixed(1)+' ± '+st.sd.toFixed(1)+'</title>';
      svg += '</g>';
    });
  } else {
    data.forEach(function(v,i){
      var cx=mL+i*band+band/2, h=yMax>0?(v/yMax)*plotH:0, barW=Math.min(band*0.68,46);
      svg += '<g class="chart-g" data-idx="'+i+'">';
      svg += '<rect x="'+(cx-barW/2)+'" y="'+yScale(v)+'" width="'+barW+'" height="'+h+'" rx="2" fill="#6366f1" opacity="0.92"/>';
      svg += '<title>'+escHtml(labels[i]||String(i+1))+': '+v.toFixed(1)+'</title>';
      svg += '</g>';
    });
  }
  // X轴标签
  data.forEach(function(_,i){
    if(i%labelEvery!==0) return;
    var cx=mL+i*band+band/2, txt=escHtml(labels[i]||String(i+1));
    if(rotate){
      svg += '<text x="'+cx+'" y="'+(mT+plotH+12)+'" font-size="11" fill="#64748b" text-anchor="end" transform="rotate(-45 '+cx+' '+(mT+plotH+12)+')">'+txt+'</text>';
    } else {
      svg += '<text x="'+cx+'" y="'+(mT+plotH+18)+'" font-size="12" text-anchor="middle" fill="#64748b">'+txt+'</text>';
    }
  });
  // 坐标轴
  svg += '<line x1="'+mL+'" y1="'+mT+'" x2="'+mL+'" y2="'+(mT+plotH)+'" stroke="#94a3b8" stroke-width="1.5"/>';
  svg += '<line x1="'+mL+'" y1="'+(mT+plotH)+'" x2="'+(mL+plotW)+'" y2="'+(mT+plotH)+'" stroke="#94a3b8" stroke-width="1.5"/>';
  svg += '<text x="22" y="'+(mT+plotH/2)+'" font-size="13" font-weight="600" fill="#475569" text-anchor="middle" transform="rotate(-90 22 '+(mT+plotH/2)+')">表达水平 (Expression level)</text>';
  svg += '<text x="'+(mL+plotW/2)+'" y="'+(H-12)+'" font-size="13" font-weight="600" fill="#475569" text-anchor="middle">样本 (Sample)</text>';
  svg += '</svg>';
  return svg;
}
function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ===== 初始化表达图谱查看器 =====
(function(){
  if(!EXPR_CATS.length) return;
  var catSel = document.getElementById('expr-cat-sel');
  EXPR_CATS.forEach(function(c,i){
    var o = document.createElement('option');
    o.value = i; o.textContent = c.name;
    catSel.appendChild(o);
  });
  fillViewSel();
  renderExprView();
})();
</script>
</body>
</html>`
}
