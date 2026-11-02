// Arquivo para Figma — o "desenhista".
// Roda na sandbox do Figma: recebe do ui.html uma árvore já medida (F/R/T/S)
// e as imagens em bytes, e cria as camadas com a API do Figma.
//
// Formato da árvore (todas as medidas em px, relativas ao pai):
//   F  frame      { x, y, w, h, n, r, o, blend, fills, stroke, rad, fx, clip, c:[filhos] }
//   R  retângulo  { x, y, w, h, n, r, o, blend, fills, stroke, rad, fx }
//   T  texto      { x, y, w, n, ax, al, auto, segs:[{ s, fam, wt, it, size, fill, ls, lh, tc, td, href }], fx, tstroke }
//   S  svg        { x, y, w, h, n, r, o, svg }
// Pinturas (fills) já chegam no formato do Figma, exceto IMAGE, que traz `key`
// (chave no mapa de imagens) em vez de `imageHash`.

figma.showUI(__html__, { width: 460, height: 640, themeColors: true });

// ---------------------------------------------------------------- fontes

const PESOS = [
  [/hairline|thin/i, 100], [/extra ?light|ultra ?light/i, 200], [/light/i, 300],
  [/semi ?bold|demi ?bold/i, 600], [/extra ?bold|ultra ?bold/i, 800], [/black|heavy/i, 900],
  [/bold/i, 700], [/medium/i, 500], [/regular|normal|book|roman|plain/i, 400],
];
const GENERICAS = {
  'sans-serif': ['Inter', 'Roboto', 'Arial'],
  'system-ui': ['Inter', 'Roboto', 'Segoe UI', 'Arial'],
  '-apple-system': ['Inter', 'SF Pro Text', 'Roboto'],
  'blinkmacsystemfont': ['Inter', 'SF Pro Text', 'Roboto'],
  'ui-sans-serif': ['Inter', 'Roboto', 'Arial'],
  'serif': ['Noto Serif', 'Georgia', 'Times New Roman', 'Roboto Serif'],
  'ui-serif': ['Noto Serif', 'Georgia', 'Times New Roman'],
  'monospace': ['Roboto Mono', 'JetBrains Mono', 'Source Code Pro', 'Courier New'],
  'ui-monospace': ['Roboto Mono', 'JetBrains Mono', 'Source Code Pro', 'Courier New'],
  'cursive': ['Comic Neue', 'Comic Sans MS', 'Caveat'],
  'fantasy': ['Impact', 'Bebas Neue'],
  'helvetica': ['Helvetica', 'Helvetica Neue', 'Arial', 'Inter'],
  'helvetica neue': ['Helvetica Neue', 'Helvetica', 'Arial', 'Inter'],
};

let catalogo = null; // família em minúsculas -> { family, styles:[{ style, wt, it, extra }] }
const resolvidas = new Map(); // chave do pedido -> FontName
const carregadas = new Set();

function pesoDoEstilo(style) {
  for (const [re, w] of PESOS) if (re.test(style)) return w;
  const m = style.match(/\b([1-9]00)\b/);
  return m ? +m[1] : 400;
}

async function montarCatalogo() {
  if (catalogo) return;
  catalogo = new Map();
  for (const f of await figma.listAvailableFontsAsync()) {
    const fam = f.fontName.family, style = f.fontName.style;
    const k = fam.toLowerCase();
    if (!catalogo.has(k)) catalogo.set(k, { family: fam, styles: [] });
    catalogo.get(k).styles.push({
      style, wt: pesoDoEstilo(style), it: /italic|oblique/i.test(style),
      extra: /condensed|narrow|expanded|wide|compressed|display|caption|text|small|subhead|semicond/i.test(style),
    });
  }
}

function melhorEstilo(entrada, wt, it) {
  let best = null, bestScore = Infinity;
  for (const s of entrada.styles) {
    const score = Math.abs(s.wt - wt) + (s.it === it ? 0 : 1000) + (s.extra ? 300 : 0) +
      (s.wt === wt && /^(regular|normal)$/i.test(s.style) ? -1 : 0);
    if (score < bestScore) { bestScore = score; best = s; }
  }
  return best ? { family: entrada.family, style: best.style } : null;
}

function resolverFonte(fam, wt, it) {
  const chave = fam.join(',') + '|' + wt + '|' + it;
  if (resolvidas.has(chave)) return resolvidas.get(chave);
  const tentativas = [];
  for (const f of fam) {
    const k = f.toLowerCase();
    tentativas.push(k);
    if (GENERICAS[k]) tentativas.push(...GENERICAS[k].map(x => x.toLowerCase()));
  }
  tentativas.push('inter', 'roboto', 'arial');
  let fonte = null;
  for (const k of tentativas) {
    const e = catalogo.get(k);
    if (e && (fonte = melhorEstilo(e, wt, it))) break;
  }
  fonte = fonte || { family: 'Inter', style: 'Regular' };
  resolvidas.set(chave, fonte);
  return fonte;
}

function juntarFontes(o, lista) {
  if (o.t === 'T') for (const s of o.segs) lista.push(s);
  if (o.c) for (const c of o.c) juntarFontes(c, lista);
  return lista;
}

async function carregarFontes(arvores) {
  await montarCatalogo();
  const segs = [];
  for (const a of arvores) juntarFontes(a, segs);
  const unicas = new Map();
  for (const s of segs) {
    const f = resolverFonte(s.fam, s.wt, s.it);
    s.font = f;
    unicas.set(f.family + '|' + f.style, f);
  }
  unicas.set('Inter|Regular', { family: 'Inter', style: 'Regular' });
  for (const [k, f] of unicas) {
    if (carregadas.has(k)) continue;
    try { await figma.loadFontAsync(f); carregadas.add(k); } catch (e) { /* tratado no texto */ }
  }
  for (const s of segs) {
    if (!carregadas.has(s.font.family + '|' + s.font.style)) s.font = { family: 'Inter', style: 'Regular' };
  }
  return unicas.size;
}

// ---------------------------------------------------------------- imagens e pinturas

let HASHES = {};

function criarImagens(imagens) {
  HASHES = {};
  for (const k in imagens) {
    try { HASHES[k] = figma.createImage(imagens[k]).hash; } catch (e) { HASHES[k] = null; }
  }
}

const CINZA = { type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } };

function pintura(p) {
  if (p.type !== 'IMAGE') return p;
  const hash = HASHES[p.key];
  if (!hash) return CINZA;
  const out = { type: 'IMAGE', imageHash: hash, scaleMode: p.mode || 'FILL' };
  if (p.mode === 'CROP') out.imageTransform = p.transform || [[1, 0, 0], [0, 1, 0]];
  if (p.mode === 'TILE') out.scalingFactor = p.scale || 1;
  if (p.opacity != null) out.opacity = p.opacity;
  return out;
}

const pinturas = lista => (lista || []).map(pintura);

// ---------------------------------------------------------------- construção

function posicionar(n, o, w, h) {
  if (!o.r) { n.x = o.x; n.y = o.y; return; }
  // CSS gira em torno do centro; o Figma, em torno do canto superior esquerdo.
  const t = o.r * Math.PI / 180, a = Math.cos(t), b = Math.sin(t);
  const cx = o.x + w / 2, cy = o.y + h / 2;
  n.relativeTransform = [[a, -b, cx - (a * w / 2 - b * h / 2)],
                         [b, a, cy - (b * w / 2 + a * h / 2)]];
}

function aplicarCaixa(n, o) {
  n.fills = pinturas(o.fills);
  if (o.stroke) {
    const s = o.stroke;
    n.strokes = [s.paint];
    n.strokeAlign = s.align || 'INSIDE';
    if (s.top === s.right && s.top === s.bottom && s.top === s.left) n.strokeWeight = s.top;
    else {
      n.strokeTopWeight = s.top; n.strokeRightWeight = s.right;
      n.strokeBottomWeight = s.bottom; n.strokeLeftWeight = s.left;
    }
    if (s.dash) n.dashPattern = s.dash;
  }
  if (o.rad) {
    const [tl, tr, br, bl] = o.rad;
    if (tl === tr && tl === br && tl === bl) n.cornerRadius = tl;
    else { n.topLeftRadius = tl; n.topRightRadius = tr; n.bottomRightRadius = br; n.bottomLeftRadius = bl; }
  }
  if (o.fx && o.fx.length) n.effects = o.fx;
  if (o.o != null && o.o < 1) n.opacity = o.o;
  if (o.blend) n.blendMode = o.blend;
}

let contador = 0;
async function respirar() {
  if (++contador % 150 === 0) {
    figma.ui.postMessage({ type: 'progress', text: 'Desenhando… ' + contador + ' camadas' });
    await new Promise(ok => setTimeout(ok, 0));
  }
}

function criarTexto(o, pai) {
  const texto = o.segs.map(s => s.s).join('');
  if (!texto) return null;
  const n = figma.createText();
  pai.appendChild(n);
  n.fontName = o.segs[0].font;
  n.characters = texto;
  let i = 0;
  for (const s of o.segs) {
    const fim = i + s.s.length;
    if (fim > i) {
      n.setRangeFontName(i, fim, s.font);
      n.setRangeFontSize(i, fim, Math.max(1, s.size));
      n.setRangeFills(i, fim, [pintura(s.fill)]);
      n.setRangeLetterSpacing(i, fim, { unit: 'PIXELS', value: s.ls || 0 });
      n.setRangeLineHeight(i, fim, s.lh ? { unit: 'PIXELS', value: s.lh } : { unit: 'AUTO' });
      if (s.tc) n.setRangeTextCase(i, fim, s.tc);
      if (s.td) n.setRangeTextDecoration(i, fim, s.td);
      if (s.href) { try { n.setRangeHyperlink(i, fim, { type: 'URL', value: s.href }); } catch (e) {} }
    }
    i = fim;
  }
  n.textAlignHorizontal = o.al || 'LEFT';
  if (o.auto === 'H') { n.textAutoResize = 'HEIGHT'; n.resize(Math.max(1, o.w), n.height); }
  else n.textAutoResize = 'WIDTH_AND_HEIGHT';
  // âncora: o navegador diz onde fica a borda esquerda, o centro ou a borda direita
  const x = o.ax === 'c' ? o.x - n.width / 2 : o.ax === 'r' ? o.x - n.width : o.x;
  n.x = x; n.y = o.y;
  if (o.fx && o.fx.length) n.effects = o.fx;
  if (o.tstroke) { n.strokes = [o.tstroke.paint]; n.strokeWeight = o.tstroke.w; n.strokeAlign = 'CENTER'; }
  if (o.o != null && o.o < 1) n.opacity = o.o;
  n.name = o.n || texto.slice(0, 40);
  return n;
}

async function construir(o, pai) {
  await respirar();
  let n = null;
  if (o.t === 'F') {
    n = figma.createFrame();
    pai.appendChild(n);
    n.resize(Math.max(o.w, 0.01), Math.max(o.h, 0.01));
    n.clipsContent = !!o.clip;
    aplicarCaixa(n, o);
    posicionar(n, o, o.w, o.h);
    for (const c of o.c || []) await construir(c, n);
  } else if (o.t === 'R') {
    n = figma.createRectangle();
    pai.appendChild(n);
    n.resize(Math.max(o.w, 0.01), Math.max(o.h, 0.01));
    aplicarCaixa(n, o);
    posicionar(n, o, o.w, o.h);
  } else if (o.t === 'T') {
    n = criarTexto(o, pai);
  } else if (o.t === 'S') {
    try {
      n = figma.createNodeFromSvg(o.svg);
      pai.appendChild(n);
      n.fills = [];
      if (o.w > 0 && o.h > 0 && (Math.abs(n.width - o.w) > 0.5 || Math.abs(n.height - o.h) > 0.5)) n.rescale(o.w / n.width);
      if (o.o != null && o.o < 1) n.opacity = o.o;
      posicionar(n, o, n.width, n.height);
    } catch (e) {
      n = figma.createRectangle();
      pai.appendChild(n);
      n.resize(Math.max(o.w, 1), Math.max(o.h, 1));
      n.fills = [CINZA];
      posicionar(n, o, o.w, o.h);
    }
  }
  if (n && o.n && o.t !== 'T') n.name = o.n;
  return n;
}

// ---------------------------------------------------------------- maestro

async function importar(itens) {
  contador = 0;
  figma.ui.postMessage({ type: 'progress', text: 'Carregando fontes…' });
  const nFontes = await carregarFontes(itens.map(i => i.tree));
  const raizes = [];
  const centro = figma.viewport.center;
  let x = Math.round(centro.x), y = Math.round(centro.y);
  for (const item of itens) {
    criarImagens(item.images || {});
    const raiz = await construir(item.tree, figma.currentPage);
    if (!raiz) continue;
    raiz.name = item.name;
    raiz.x = x; raiz.y = y;
    x += Math.ceil(raiz.width) + 120;
    raizes.push(raiz);
  }
  if (raizes.length) {
    figma.currentPage.selection = raizes;
    figma.viewport.scrollAndZoomIntoView(raizes);
  }
  return { frames: raizes.length, camadas: contador, fontes: nFontes };
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'build') {
    try {
      const r = await importar(msg.items);
      const txt = r.frames + ' frame(s), ' + r.camadas + ' camadas criadas';
      figma.ui.postMessage({ type: 'done', text: txt });
      figma.notify('Pronto! ' + txt);
    } catch (e) {
      figma.ui.postMessage({ type: 'error', text: String(e && e.message || e) });
      figma.notify('Erro: ' + (e && e.message || e), { error: true });
    }
  } else if (msg.type === 'save-opts') {
    await figma.clientStorage.setAsync('opts', msg.opts);
  } else if (msg.type === 'load-opts') {
    figma.ui.postMessage({ type: 'opts', opts: (await figma.clientStorage.getAsync('opts')) || null });
  } else if (msg.type === 'notify') {
    figma.notify(msg.text, { error: !!msg.error });
  }
};
