// Roda o code.js contra uma imitação rígida da API do Figma, usando a árvore
// medida no navegador (teste/saida.json). Acusa os erros que o Figma acusaria.
// Uso: node teste/mock-figma.js
const fs = require('fs'), path = require('path'), vm = require('vm');

const erros = [];
const falha = (m) => { erros.push(m); throw new Error(m); };
const num = (v, nome) => { if (typeof v !== 'number' || !isFinite(v)) falha(`${nome} inválido: ${v}`); };

function checarCor(c, alpha, onde) {
  for (const k of ['r', 'g', 'b'].concat(alpha ? ['a'] : [])) { num(c[k], onde + '.' + k); if (c[k] < 0 || c[k] > 1) falha(`${onde}.${k} fora de 0..1: ${c[k]}`); }
  const extras = Object.keys(c).filter(k => !['r', 'g', 'b', 'a'].includes(k) || (!alpha && k === 'a'));
  if (extras.length) falha(`${onde} tem campos extras: ${extras}`);
}

function checarPintura(p, onde) {
  if (p.type === 'SOLID') { checarCor(p.color, false, onde + '.color'); if (p.opacity != null) num(p.opacity, onde + '.opacity'); }
  else if (/^GRADIENT_/.test(p.type)) {
    const t = p.gradientTransform;
    if (!Array.isArray(t) || t.length !== 2 || t.some(l => l.length !== 3)) falha(onde + '.gradientTransform malformado');
    t.flat().forEach((v, i) => num(v, onde + '.gradientTransform[' + i + ']'));
    if (!p.gradientStops || p.gradientStops.length < 2) falha(onde + ' precisa de 2+ paradas');
    p.gradientStops.forEach((s, i) => { num(s.position, onde + '.stop' + i); checarCor(s.color, true, onde + '.stop' + i); });
  } else if (p.type === 'IMAGE') {
    if (!hashes.has(p.imageHash)) falha(onde + ': imageHash desconhecido');
    if (!['FILL', 'FIT', 'CROP', 'TILE'].includes(p.scaleMode)) falha(onde + ': scaleMode ' + p.scaleMode);
    if ('key' in p || 'mode' in p) falha(onde + ': campos do plugin vazaram (key/mode)');
  } else falha(onde + ': tipo de pintura ' + p.type);
}

let ids = 0, total = 0;
const hashes = new Set();
const fontesCarregadas = new Set();
const fk = f => f.family + '|' + f.style;

function base(tipo) {
  total++;
  const n = { id: '1:' + (++ids), type: tipo, children: [], parent: null, name: tipo, x: 0, y: 0, width: 100, height: 100 };
  n.appendChild = c => { if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1); c.parent = n; n.children.push(c); };
  n.resize = (w, h) => { num(w, 'resize w'); num(h, 'resize h'); if (w < 0.01 || h < 0.01) falha(`resize pequeno demais: ${w}x${h}`); n.width = w; n.height = h; };
  n.rescale = k => { num(k, 'rescale'); n.width *= k; n.height *= k; };
  let fills = [];
  Object.defineProperty(n, 'fills', { get: () => fills, set: v => { v.forEach((p, i) => checarPintura(p, n.name + '.fills[' + i + ']')); fills = v; } });
  let strokes = [];
  Object.defineProperty(n, 'strokes', { get: () => strokes, set: v => { v.forEach((p, i) => checarPintura(p, n.name + '.strokes[' + i + ']')); strokes = v; } });
  let effects = [];
  Object.defineProperty(n, 'effects', { get: () => effects, set: v => {
    for (const e of v) {
      if (!['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR'].includes(e.type)) falha('efeito ' + e.type);
      num(e.radius, 'efeito.radius');
      if (/SHADOW/.test(e.type)) { checarCor(e.color, true, 'efeito.color'); num(e.offset.x, 'offset.x'); num(e.offset.y, 'offset.y'); }
    }
    effects = v;
  } });
  Object.defineProperty(n, 'relativeTransform', { get: () => [[1, 0, n.x], [0, 1, n.y]], set: m => { m.flat().forEach(v => num(v, 'relativeTransform')); n.x = m[0][2]; n.y = m[1][2]; } });
  for (const k of ['x', 'y', 'opacity', 'cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'strokeWeight',
    'strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight']) {
    let v = 0;
    Object.defineProperty(n, k, { get: () => v, set: nv => { num(nv, n.name + '.' + k); v = nv; } });
  }
  return n;
}

function texto() {
  const n = base('TEXT');
  let fontName = { family: 'Inter', style: 'Regular' }, chars = '';
  Object.defineProperty(n, 'fontName', { get: () => fontName, set: f => { if (!fontesCarregadas.has(fk(f))) falha('fontName sem carregar: ' + fk(f)); fontName = f; } });
  Object.defineProperty(n, 'characters', { get: () => chars, set: s => {
    if (!fontesCarregadas.has(fk(fontName))) falha('characters antes de carregar a fonte');
    chars = s; n.width = s.split('\n').reduce((m, l) => Math.max(m, l.length * 9), 1); n.height = s.split('\n').length * 20;
  } });
  const faixa = nome => (i, f, v) => {
    if (i < 0 || f > chars.length || i >= f) falha(`${nome}(${i},${f}) fora do texto de ${chars.length}`);
    if (nome === 'setRangeFontName' && !fontesCarregadas.has(fk(v))) falha('setRangeFontName sem carregar ' + fk(v));
    if (nome === 'setRangeFills') v.forEach((p, k) => checarPintura(p, 'texto.fill' + k));
    if (nome === 'setRangeFontSize') num(v, 'fontSize');
    if (nome === 'setRangeLetterSpacing' || nome === 'setRangeLineHeight') { if (v.unit !== 'AUTO') num(v.value, nome); }
    if (nome === 'setRangeTextCase' && !['UPPER', 'LOWER', 'TITLE', 'SMALL_CAPS', 'ORIGINAL'].includes(v)) falha('textCase ' + v);
  };
  for (const m of ['setRangeFontName', 'setRangeFontSize', 'setRangeFills', 'setRangeLetterSpacing', 'setRangeLineHeight', 'setRangeTextCase', 'setRangeTextDecoration', 'setRangeHyperlink']) n[m] = faixa(m);
  return n;
}

const pagina = base('PAGE');
const mensagens = [];
const figma = {
  currentPage: pagina,
  viewport: { center: { x: 0, y: 0 }, scrollAndZoomIntoView() {} },
  showUI() {},
  ui: { postMessage: m => mensagens.push(m), onmessage: null, resize() {} },
  notify: (t) => console.log('[notify]', t),
  clientStorage: { getAsync: async () => null, setAsync: async () => {} },
  createFrame: () => base('FRAME'),
  createRectangle: () => base('RECTANGLE'),
  createText: texto,
  createNodeFromSvg: s => { if (!/^<svg[\s>]/.test(s)) falha('SVG inválido'); const n = base('FRAME'); return n; },
  createImage: b => { if (!(b instanceof Uint8Array) || !b.length) falha('createImage sem bytes'); const h = 'h' + hashes.size; hashes.add(h); return { hash: h }; },
  listAvailableFontsAsync: async () => ['Inter:Regular,Bold,Italic', 'Open Sans:Regular,Bold,Italic,Bold Italic,SemiBold,Light', 'Squada One:Regular', 'Roboto:Regular,Bold', 'Roboto Mono:Regular']
    .flatMap(l => { const [fam, st] = l.split(':'); return st.split(',').map(style => ({ fontName: { family: fam, style } })); }),
  loadFontAsync: async f => { fontesCarregadas.add(fk(f)); },
};

const items = JSON.parse(fs.readFileSync(path.join(__dirname, 'saida.json'), 'utf8'));
for (const it of items) for (const k in it.images) it.images[k] = new Uint8Array(Buffer.from(it.images[k], 'base64'));

vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'code.js'), 'utf8'), { figma, __html__: '', console, setTimeout });
(async () => {
  await figma.ui.onmessage({ type: 'build', items });
  const fim = mensagens.find(m => m.type === 'done' || m.type === 'error');
  console.log(fim);
  const conta = {};
  (function andar(n) { conta[n.type] = (conta[n.type] || 0) + 1; n.children.forEach(andar); })(pagina);
  console.log('nós:', conta, '| fontes carregadas:', [...fontesCarregadas].join(', '));
  if (erros.length || fim.type === 'error') { console.log('FALHOU:', erros); process.exit(1); }
  console.log('OK — nenhuma violação da API');
})();
