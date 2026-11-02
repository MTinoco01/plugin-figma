// Leitura de estilos calculados (getComputedStyle) e tradução para pinturas,
// bordas, cantos e efeitos no formato da API do Figma.

const px = v => parseFloat(v) || 0;
const clamp01 = v => Math.max(0, Math.min(1, v));

// ---------------------------------------------------------------- cores

const _cv = document.createElement('canvas');
_cv.width = _cv.height = 1;
const _cx = _cv.getContext('2d', { willReadFrequently: true });
const _cores = new Map();

// Qualquer cor CSS -> { r, g, b, a } de 0 a 1. Formatos que não são rgb()
// (oklch, color(), hsl, nomes) passam por um pixel de canvas.
function cor(str) {
  if (!str) return null;
  str = String(str).trim();
  if (_cores.has(str)) return _cores.get(str);
  let c = null;
  const m = str.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/);
  if (m) {
    const a = m[4] == null ? 1 : m[5] ? m[4] / 100 : +m[4];
    c = { r: clamp01(m[1] / 255), g: clamp01(m[2] / 255), b: clamp01(m[3] / 255), a: clamp01(a) };
  } else if (str === 'transparent' || str === 'none') {
    c = { r: 0, g: 0, b: 0, a: 0 };
  } else {
    _cx.clearRect(0, 0, 1, 1);
    _cx.fillStyle = 'rgba(0,0,0,0)';
    _cx.fillStyle = str;
    _cx.fillRect(0, 0, 1, 1);
    const d = _cx.getImageData(0, 0, 1, 1).data;
    c = { r: d[0] / 255, g: d[1] / 255, b: d[2] / 255, a: d[3] / 255 };
  }
  _cores.set(str, c);
  return c;
}

const visivel = c => c && c.a > 0.001;
const solido = c => ({ type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a });

// Separa por vírgula (ou outro separador) respeitando parênteses e aspas.
function dividir(str, sep = ',') {
  const out = [];
  let nivel = 0, aspas = null, atual = '';
  for (const ch of str) {
    if (aspas) { if (ch === aspas) aspas = null; atual += ch; continue; }
    if (ch === '"' || ch === "'") { aspas = ch; atual += ch; continue; }
    if (ch === '(') nivel++;
    if (ch === ')') nivel--;
    if (nivel === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) {
      if (atual.trim()) out.push(atual.trim());
      atual = '';
    } else atual += ch;
  }
  if (atual.trim()) out.push(atual.trim());
  return out;
}

// Tira a cor do começo/fim de um trecho como "rgba(0,0,0,.2) 0px 4px 8px".
const RE_COR = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)|#[0-9a-f]{3,8}\b|\b(?!inset\b)[a-z]+\b/i;
function separarCor(parte) {
  const m = parte.match(RE_COR);
  if (!m) return { c: null, resto: parte };
  return { c: cor(m[0]), resto: (parte.slice(0, m.index) + ' ' + parte.slice(m.index + m[0].length)).trim() };
}

// ---------------------------------------------------------------- gradientes

function inverter([[a, b, c], [d, e, f]]) {
  const det = a * e - b * d || 1e-9;
  return [[e / det, -b / det, (b * f - e * c) / det], [-d / det, a / det, (d * c - a * f) / det]];
}

function angulo(s) {
  const m = s.match(/^(-?[\d.]+)(deg|rad|turn|grad)$/);
  if (!m) return null;
  const v = +m[1];
  return { deg: v, rad: v * 180 / Math.PI, turn: v * 360, grad: v * 0.9 }[m[2]];
}

// Paradas de cor: [{ position 0..1, color }]. `L` converte px em fração.
function paradas(partes, L) {
  const st = [];
  for (const p of partes) {
    const { c, resto } = separarCor(p);
    if (!c) continue; // dica de interpolação: ignorada
    const pos = resto.split(/\s+/).filter(Boolean).map(t =>
      t.endsWith('%') ? px(t) / 100 : t.endsWith('px') ? px(t) / (L || 1) : null);
    const color = { r: c.r, g: c.g, b: c.b, a: c.a };
    if (!pos.length) st.push({ position: null, color });
    for (const q of pos) st.push({ position: q, color });
  }
  if (st.length < 2) return null;
  if (st[0].position == null) st[0].position = 0;
  if (st[st.length - 1].position == null) st[st.length - 1].position = 1;
  for (let i = 1; i < st.length; i++) {
    if (st[i].position == null) {
      let j = i; while (st[j].position == null) j++;
      const a = st[i - 1].position, b = st[j].position;
      for (let k = i; k < j; k++) st[k].position = a + (b - a) * (k - i + 1) / (j - i + 1);
    }
    st[i].position = Math.max(st[i].position, st[i - 1].position);
  }
  for (const s of st) s.position = clamp01(s.position);
  return st;
}

function lerPosicao(str, w, h) {
  const t = str.trim().split(/\s+/);
  const kw = { left: 0, center: 0.5, right: 1, top: 0, bottom: 1 };
  let x = 0.5, y = 0.5;
  const val = (v, total) => v.endsWith('%') ? px(v) / 100 : px(v) / total;
  if (t.length === 1) {
    if (t[0] === 'top' || t[0] === 'bottom') y = kw[t[0]];
    else x = t[0] in kw ? kw[t[0]] : val(t[0], w);
  } else {
    let [a, b] = t;
    if (a === 'top' || a === 'bottom' || b === 'left' || b === 'right') [a, b] = [b, a];
    x = a in kw ? kw[a] : val(a, w);
    y = b in kw ? kw[b] : val(b, h);
  }
  return [x * w, y * h];
}

function gradienteLinear(partes, w, h) {
  let dx = 0, dy = 1;
  if (partes[0].startsWith('in ')) partes = partes.slice(1);
  const primeiro = partes[0].replace(/\s+in\s+.*$/, '');
  const a = angulo(primeiro);
  if (a != null) {
    const t = a * Math.PI / 180; dx = Math.sin(t); dy = -Math.cos(t); partes = partes.slice(1);
  } else if (primeiro.startsWith('to ')) {
    const sx = /right/.test(primeiro) ? 1 : /left/.test(primeiro) ? -1 : 0;
    const sy = /bottom/.test(primeiro) ? 1 : /top/.test(primeiro) ? -1 : 0;
    if (sx && sy) { dx = sx * h; dy = sy * w; } else { dx = sx; dy = sy; }
    const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n; partes = partes.slice(1);
  }
  const L = Math.abs(w * dx) + Math.abs(h * dy) || 1;
  const st = paradas(partes, L);
  if (!st) return null;
  const p0 = [(w / 2 - dx * L / 2) / w, (h / 2 - dy * L / 2) / h];
  const p1 = [(w / 2 + dx * L / 2) / w, (h / 2 + dy * L / 2) / h];
  const xc = [p1[0] - p0[0], p1[1] - p0[1]];
  const yc = [-dy * L / w, dx * L / h];
  const o = [p0[0] - yc[0] / 2, p0[1] - yc[1] / 2];
  return { type: 'GRADIENT_LINEAR', gradientStops: st,
    gradientTransform: inverter([[xc[0], yc[0], o[0]], [xc[1], yc[1], o[1]]]) };
}

function gradienteRadial(partes, w, h) {
  let cfg = '';
  if (/^(circle|ellipse|closest|farthest|at\s|-?[\d.]+(px|%))/.test(partes[0]) || partes[0].startsWith('in ')) {
    cfg = partes[0].replace(/\bin\s+\S+(\s+\S+)?/, '').trim(); partes = partes.slice(1);
  }
  const [forma, pos] = cfg.split(/\bat\b/).map(s => (s || '').trim());
  const [cx, cy] = pos ? lerPosicao(pos, w, h) : [w / 2, h / 2];
  const lados = { closest: [Math.min(cx, w - cx), Math.min(cy, h - cy)],
                  farthest: [Math.max(cx, w - cx), Math.max(cy, h - cy)] };
  const circ = /circle/.test(forma) || (/^-?[\d.]+px$/.test(forma.split(/\s+/)[0]) && forma.split(/\s+/).filter(t => /\d/.test(t)).length === 1);
  const medidas = forma.split(/\s+/).filter(t => /^-?[\d.]+(px|%)$/.test(t));
  let rx, ry;
  if (medidas.length) {
    rx = medidas[0].endsWith('%') ? px(medidas[0]) / 100 * w : px(medidas[0]);
    ry = medidas[1] ? (medidas[1].endsWith('%') ? px(medidas[1]) / 100 * h : px(medidas[1])) : rx;
  } else {
    const tipo = /closest-side/.test(forma) ? 'cs' : /farthest-side/.test(forma) ? 'fs' : /closest-corner/.test(forma) ? 'cc' : 'fc';
    const [lx, ly] = lados[tipo[0] === 'c' ? 'closest' : 'farthest'];
    if (circ) {
      const cantos = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => Math.hypot(x - cx, y - cy));
      rx = ry = tipo === 'cs' ? Math.min(lx, ly) : tipo === 'fs' ? Math.max(lx, ly)
        : tipo === 'cc' ? Math.min(...cantos) : Math.max(...cantos);
    } else {
      const k = tipo.endsWith('c') ? Math.SQRT2 : 1;
      rx = lx * k; ry = ly * k;
    }
  }
  rx = Math.max(rx, 0.01); ry = Math.max(ry, 0.01);
  const st = paradas(partes, rx);
  if (!st) return null;
  const xc = [2 * rx / w, 0], yc = [0, 2 * ry / h];
  const o = [cx / w - xc[0] / 2, cy / h - yc[1] / 2];
  return { type: 'GRADIENT_RADIAL', gradientStops: st,
    gradientTransform: inverter([[xc[0], yc[0], o[0]], [xc[1], yc[1], o[1]]]) };
}

// "linear-gradient(...)" -> pintura do Figma, ou null se não dá para traduzir
function gradiente(str, w, h) {
  const m = str.match(/^([a-z-]+)\((.*)\)$/s);
  if (!m) return null;
  const partes = dividir(m[2]);
  if (m[1] === 'linear-gradient') return gradienteLinear(partes, w, h);
  if (m[1] === 'radial-gradient') return gradienteRadial(partes, w, h);
  return null; // conic, repeating-*: viram imagem
}

const urlDe = s => { const m = s.match(/^url\(\s*["']?(.*?)["']?\s*\)$/s); return m ? m[1] : null; };

// Fundo do elemento. Devolve { fills, raster } — raster=true quando o fundo
// precisa ser desenhado como imagem (padrões, repetições, gradiente cônico).
function fundo(cs, w, h, reg) {
  const fills = [];
  const bg = cor(cs.backgroundColor);
  if (visivel(bg)) fills.push(solido(bg));
  const img = cs.backgroundImage;
  if (!img || img === 'none') return { fills, raster: false };
  const camadas = dividir(img), tamanhos = dividir(cs.backgroundSize), repet = dividir(cs.backgroundRepeat);
  const sobre = [];
  for (let i = 0; i < camadas.length; i++) {
    const c = camadas[i];
    if (c === 'none') continue;
    const tam = (tamanhos[i % tamanhos.length] || 'auto').trim();
    const rep = (repet[i % repet.length] || 'repeat').trim();
    const cobre = /^(auto|auto auto|100% 100%)$/.test(tam);
    const u = urlDe(c);
    if (u) {
      const modo = tam === 'cover' ? 'FILL' : tam === 'contain' && /no-repeat/.test(rep) ? 'FIT' : tam === '100% 100%' ? 'CROP' : null;
      if (!modo) return { fills, raster: true };
      sobre.push({ type: 'IMAGE', key: reg.imagem(u), mode: modo });
      continue;
    }
    const g = cobre ? gradiente(c, w, h) : null;
    if (!g) return { fills, raster: true };
    sobre.push(g);
  }
  return { fills: fills.concat(sobre.reverse()), raster: false };
}

// ---------------------------------------------------------------- borda, cantos, sombras

const LADOS = ['Top', 'Right', 'Bottom', 'Left'];

function borda(cs) {
  const lados = LADOS.map(L => {
    const estilo = cs['border' + L + 'Style'];
    const w = estilo === 'none' || estilo === 'hidden' ? 0 : px(cs['border' + L + 'Width']);
    return { w, c: cor(cs['border' + L + 'Color']), estilo };
  });
  const ativos = lados.filter(l => l.w > 0 && visivel(l.c));
  if (!ativos.length) return null;
  const mesmaCor = ativos.every(l => l.c.r === ativos[0].c.r && l.c.g === ativos[0].c.g && l.c.b === ativos[0].c.b && l.c.a === ativos[0].c.a);
  const w = l => (l.w > 0 && visivel(l.c) ? l.w : 0);
  if (!mesmaCor) return { lados: lados.map(l => (w(l) ? l : null)) };
  const e = ativos[0].estilo, bw = ativos[0].w;
  const dash = e === 'dashed' ? [bw * 3, bw * 2] : e === 'dotted' ? [bw, bw] : null;
  return { paint: solido(ativos[0].c), top: w(lados[0]), right: w(lados[1]), bottom: w(lados[2]), left: w(lados[3]), dash };
}

function cantos(cs, w, h) {
  const r = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(k => {
    const v = (cs['border' + k + 'Radius'] || '0').split(/\s+/)[0];
    return v.endsWith('%') ? Math.min(w, h) * px(v) / 100 : px(v);
  });
  if (!r.some(Boolean)) return null;
  const f = Math.min(1, w / (r[0] + r[1] || 1), w / (r[3] + r[2] || 1), h / (r[0] + r[3] || 1), h / (r[1] + r[2] || 1));
  return r.map(v => v * f);
}

function sombras(str, texto) {
  if (!str || str === 'none') return [];
  return dividir(str).map(p => {
    const inset = /\binset\b/.test(p);
    const { c, resto } = separarCor(p.replace(/\binset\b/, ''));
    const n = resto.split(/\s+/).filter(Boolean).map(px);
    if (!c || n.length < 2) return null;
    const fx = { type: inset ? 'INNER_SHADOW' : 'DROP_SHADOW', color: { r: c.r, g: c.g, b: c.b, a: c.a },
      offset: { x: n[0], y: n[1] }, radius: n[2] || 0, spread: texto ? 0 : n[3] || 0, visible: true, blendMode: 'NORMAL' };
    if (!inset) fx.showShadowBehindNode = false;
    return fx;
  }).filter(Boolean).reverse();
}

function filtros(cs) {
  const fx = [];
  const f = cs.filter || '', b = cs.backdropFilter || cs.webkitBackdropFilter || '';
  let m = f.match(/blur\(([\d.]+)px\)/);
  if (m && +m[1]) fx.push({ type: 'LAYER_BLUR', radius: +m[1] * 2, visible: true });
  for (const d of f.matchAll(/drop-shadow\(((?:[^()]|\([^)]*\))*)\)/g)) fx.push(...sombras(d[1], true));
  m = b.match(/blur\(([\d.]+)px\)/);
  if (m && +m[1]) fx.push({ type: 'BACKGROUND_BLUR', radius: +m[1] * 2, visible: true });
  return fx;
}

const MISTURAS = { multiply: 'MULTIPLY', screen: 'SCREEN', overlay: 'OVERLAY', darken: 'DARKEN', lighten: 'LIGHTEN',
  'color-dodge': 'COLOR_DODGE', 'color-burn': 'COLOR_BURN', 'hard-light': 'HARD_LIGHT', 'soft-light': 'SOFT_LIGHT',
  difference: 'DIFFERENCE', exclusion: 'EXCLUSION', hue: 'HUE', saturation: 'SATURATION', color: 'COLOR', luminosity: 'LUMINOSITY' };
const mistura = cs => MISTURAS[cs.mixBlendMode] || null;

// ---------------------------------------------------------------- imagens

function bytesDeDataURL(u) {
  const [cab, dados] = u.split(',');
  if (/;base64/i.test(cab)) {
    const bin = atob(dados);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(dados));
}

async function blobDe(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.blob();
}

const dataURLDe = blob => new Promise((ok, erro) => {
  const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = erro; fr.readAsDataURL(blob);
});

function carregarImg(src) {
  return new Promise((ok, erro) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => ok(im); im.onerror = () => erro(new Error('imagem não carregou'));
    im.src = src;
  });
}

const canvasParaBytes = cv => new Promise((ok, erro) => cv.toBlob(async b => {
  if (!b) return erro(new Error('canvas vazio'));
  ok(new Uint8Array(await b.arrayBuffer()));
}, 'image/png'));

// Desenha uma fonte de imagem num canvas e devolve PNG (limite do Figma: 4096 px).
async function paraPNG(fonte, w, h) {
  const k = Math.min(1, 4096 / Math.max(w, h));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
  cv.getContext('2d').drawImage(fonte, 0, 0, cv.width, cv.height);
  return canvasParaBytes(cv);
}

// Baixa qualquer imagem e devolve bytes que o Figma aceita (PNG, JPG ou GIF).
async function bytesDeImagem(url) {
  const blob = await blobDe(url);
  const tipo = blob.type;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const ok = /^image\/(png|jpe?g|gif)$/.test(tipo) || (!tipo && (bytes[0] === 0x89 || bytes[0] === 0xff || bytes[0] === 0x47));
  if (ok) {
    const im = await carregarImg(URL.createObjectURL(blob)).catch(() => null);
    if (!im || Math.max(im.naturalWidth, im.naturalHeight) <= 4096) return bytes;
    return paraPNG(im, im.naturalWidth, im.naturalHeight);
  }
  const im = await carregarImg(URL.createObjectURL(blob));
  const w = im.naturalWidth || 512, h = im.naturalHeight || 512;
  const k = /svg/.test(tipo) ? 2 : 1; // SVG usado como imagem: desenha em 2x
  return paraPNG(im, w * k, h * k);
}

// Troca url(...) dentro de um CSS por data: URLs (para desenhar via SVG).
async function embutirURLs(css) {
  const urls = [...css.matchAll(/url\(\s*["']?(.*?)["']?\s*\)/g)].map(m => m[1]).filter(u => !u.startsWith('data:'));
  for (const u of new Set(urls)) {
    try { css = css.split(u).join(await dataURLDe(await blobDe(u))); } catch (e) { /* fica sem a imagem */ }
  }
  return css;
}

// Desenha o fundo de um elemento (cor + todas as camadas) como PNG em 2x,
// usando um SVG com foreignObject — é o "print" do que o Figma não sabe fazer.
async function rasterizarFundo(cs, w, h) {
  const props = ['background-color', 'background-image', 'background-size', 'background-position',
    'background-repeat', 'background-blend-mode', 'background-origin', 'background-clip'];
  let css = props.map(p => p + ':' + cs.getPropertyValue(p)).join(';');
  css = await embutirURLs(css);
  const esc = css.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;${esc}"></div></foreignObject></svg>`;
  const im = await carregarImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  return paraPNG(im, w * 2, h * 2);
}
