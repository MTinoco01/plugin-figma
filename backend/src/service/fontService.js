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

let catalogo = null;
const resolvidas = new Map();
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
    try { await figma.loadFontAsync(f); carregadas.add(k); } catch (e) {}
  }
  for (const s of segs) {
    if (!carregadas.has(s.font.family + '|' + s.font.style)) s.font = { family: 'Inter', style: 'Regular' };
  }
  return unicas.size;
}
