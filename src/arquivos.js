// Leitura dos arquivos soltos no plugin. Cada arquivo vira um "trabalho":
//   { name, kind:'html', html }            -> renderizado e medido no iframe
//   { name, kind:'tree', tree, images }    -> já pronto para o code.js
// Arquivos de apoio (imagens, CSS, fontes) soltos junto com um HTML são
// trocados por blob: URLs para que o HTML os encontre.

const EXT = n => (n.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
const DOCS = new Set(['html', 'htm', 'xhtml', 'md', 'markdown', 'txt', 'log', 'csv', 'tsv', 'json', 'pdf', 'docx']);
const IMAGENS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico']);
const tirarExt = n => n.replace(/\.[^.]+$/, '');

function normalizar(caminho) {
  const out = [];
  for (const p of caminho.replace(/\\/g, '/').split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop(); else out.push(p);
  }
  return out.join('/').toLowerCase();
}

const externo = u => !u || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u.trim());

function criarAcervo(arquivos) {
  const porCaminho = new Map(), porNome = new Map();
  for (const { file, path } of arquivos) {
    const url = URL.createObjectURL(file);
    porCaminho.set(normalizar(path), { url, file });
    const nome = file.name.toLowerCase();
    if (!porNome.has(nome)) porNome.set(nome, { url, file });
  }
  return {
    achar(ref, dir) {
      if (externo(ref)) return null;
      const limpo = decodeURIComponent(ref.split(/[?#]/)[0]);
      const alvo = limpo.startsWith('/') ? normalizar(limpo) : normalizar(dir + '/' + limpo);
      return porCaminho.get(alvo) || porNome.get(limpo.split('/').pop().toLowerCase()) || null;
    },
  };
}

const dirDe = p => p.replace(/\\/g, '/').split('/').slice(0, -1).join('/');

function trocarURLsCSS(css, dir, acervo) {
  return css.replace(/url\(\s*(["']?)(.*?)\1\s*\)/g, (m, q, u) => {
    const a = acervo.achar(u, dir);
    return a ? `url("${a.url}")` : m;
  }).replace(/@import\s+(["'])(.*?)\1/g, (m, q, u) => {
    const a = acervo.achar(u, dir);
    return a ? `@import "${a.url}"` : m;
  });
}

// Reescreve src/href/url() do HTML para os arquivos locais soltos junto.
async function prepararHTML(html, caminho, acervo) {
  const dir = dirDe(caminho);
  const d = new DOMParser().parseFromString(html, 'text/html');
  // folhas de estilo locais entram inline, com os url() resolvidos a partir da pasta do CSS
  for (const link of d.querySelectorAll('link[rel~="stylesheet"][href]')) {
    const href = link.getAttribute('href');
    const a = acervo.achar(href, dir);
    if (!a) continue;
    const st = d.createElement('style');
    st.textContent = trocarURLsCSS(await a.file.text(), dirDe(normalizar(dir + '/' + href.split(/[?#]/)[0])), acervo);
    link.replaceWith(st);
  }
  for (const el of d.querySelectorAll('[src],[href],[poster],[srcset],[data-src]')) {
    for (const at of ['src', 'href', 'poster', 'data-src']) {
      const v = el.getAttribute(at);
      const a = v && acervo.achar(v, dir);
      if (a && !(at === 'href' && el.tagName === 'A')) el.setAttribute(at, a.url);
    }
    if (el.hasAttribute('data-src') && !el.getAttribute('src')) el.setAttribute('src', el.getAttribute('data-src'));
    const ss = el.getAttribute('srcset');
    if (ss) el.setAttribute('srcset', ss.split(',').map(p => {
      const [u, ...r] = p.trim().split(/\s+/);
      const a = acervo.achar(u, dir);
      return [a ? a.url : u, ...r].join(' ');
    }).join(', '));
    if (el.tagName === 'IMG') el.removeAttribute('loading');
  }
  for (const st of d.querySelectorAll('style')) st.textContent = trocarURLsCSS(st.textContent, dir, acervo);
  for (const el of d.querySelectorAll('[style]')) el.setAttribute('style', trocarURLsCSS(el.getAttribute('style'), dir, acervo));
  return '<!DOCTYPE html>' + d.documentElement.outerHTML;
}

// ---------------------------------------------------------------- Markdown e texto

const ESTILO_DOC = `
  html,body{margin:0;background:#fff}
  .doc{box-sizing:border-box;width:880px;padding:48px 56px;font:16px/1.6 Inter,"Segoe UI",Roboto,Arial,sans-serif;color:#1f2328;background:#fff}
  .doc h1,.doc h2{border-bottom:1px solid #d1d9e0;padding-bottom:.3em}
  .doc h1{font-size:2em;margin:0 0 16px}.doc h2{font-size:1.5em;margin:24px 0 16px}.doc h3{font-size:1.25em;margin:24px 0 16px}
  .doc h4,.doc h5,.doc h6{font-size:1em;margin:24px 0 16px}
  .doc p,.doc ul,.doc ol,.doc blockquote,.doc pre,.doc table{margin:0 0 16px}
  .doc a{color:#0969da;text-decoration:none}
  .doc code{font:85% "Roboto Mono",Consolas,monospace;background:#eff1f3;border-radius:6px;padding:.2em .4em}
  .doc pre{background:#f6f8fa;border-radius:6px;padding:16px;overflow:hidden;white-space:pre-wrap}
  .doc pre code{background:none;padding:0;font-size:85%}
  .doc blockquote{color:#59636e;border-left:4px solid #d1d9e0;padding:0 16px}
  .doc table{border-collapse:collapse}.doc th,.doc td{border:1px solid #d1d9e0;padding:6px 13px}
  .doc th{font-weight:600;background:#f6f8fa}
  .doc hr{border:0;height:4px;background:#d1d9e0;margin:24px 0}
  .doc img{max-width:100%}.doc ul,.doc ol{padding-left:2em}
`;

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inlineMD(s) {
  const codigos = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codigos.push(c); return '\u0000' + (codigos.length - 1) + '\u0000'; });
  s = esc(s)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => '<strong>' + (a || b) + '</strong>')
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?!\s)(.+?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/ {2,}$/, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + esc(codigos[i]) + '</code>');
}

function markdown(md) {
  md = md.replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '');
  const L = md.split('\n');
  let out = '', i = 0;
  const lista = (ini) => {
    // listas com aninhamento por recuo
    const recuo = l => l.match(/^\s*/)[0].replace(/\t/g, '    ').length;
    const base = recuo(L[ini]);
    const ordenada = /^\s*\d+[.)]\s/.test(L[ini]);
    let html = ordenada ? `<ol start="${parseInt(L[ini])}">` : '<ul>';
    let j = ini;
    while (j < L.length) {
      const l = L[j];
      if (!l.trim()) {
        const prox = L[j + 1] || '';
        const mesmoTipo = ordenada ? /^\s*\d+[.)]\s/.test(prox) : /^\s*[-*+]\s/.test(prox);
        if (mesmoTipo || (recuo(prox) > base && /^\s*([-*+]|\d+[.)])\s/.test(prox))) { j++; continue; }
        break;
      }
      const r = recuo(l);
      const m = l.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
      if (r > base && m) { const [sub, k] = lista(j); html = html.replace(/<\/li>$/, sub + '</li>'); j = k; continue; }
      if (r < base || !m) {
        if (!m && r > base && html.endsWith('</li>')) { html = html.replace(/<\/li>$/, ' ' + inlineMD(l.trim()) + '</li>'); j++; continue; }
        break;
      }
      let item = m[1];
      const tarefa = item.match(/^\[( |x)\]\s+(.*)$/i);
      if (tarefa) item = `<input type="checkbox" disabled${tarefa[1] !== ' ' ? ' checked' : ''}> ` + inlineMD(tarefa[2]);
      else item = inlineMD(item);
      html += '<li>' + item + '</li>';
      j++;
    }
    return [html + (ordenada ? '</ol>' : '</ul>'), j];
  };
  while (i < L.length) {
    const l = L[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = l.match(/^\s*(```|~~~)\s*(\S*)/))) {
      const fim = m[1]; const cod = [];
      i++;
      while (i < L.length && !L[i].trim().startsWith(fim)) cod.push(L[i++]);
      i++;
      out += '<pre><code>' + esc(cod.join('\n')) + '</code></pre>';
    } else if ((m = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      out += `<h${m[1].length}>${inlineMD(m[2])}</h${m[1].length}>`; i++;
    } else if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(l)) {
      out += '<hr>'; i++;
    } else if (/^\s*>/.test(l)) {
      const q = [];
      while (i < L.length && /^\s*>/.test(L[i])) q.push(L[i++].replace(/^\s*>\s?/, ''));
      out += '<blockquote>' + markdown(q.join('\n')) + '</blockquote>';
    } else if (/^\s*([-*+]|\d+[.)])\s/.test(l)) {
      const [h, j] = lista(i); out += h; i = j;
    } else if (/\|/.test(l) && i + 1 < L.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(L[i + 1])) {
      const cel = s => s.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const alin = cel(L[i + 1]).map(c => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left');
      out += '<table><thead><tr>' + cel(l).map((c, k) => `<th style="text-align:${alin[k]}">${inlineMD(c)}</th>`).join('') + '</tr></thead><tbody>';
      i += 2;
      while (i < L.length && /\|/.test(L[i]) && L[i].trim()) {
        out += '<tr>' + cel(L[i]).map((c, k) => `<td style="text-align:${alin[k] || 'left'}">${inlineMD(c)}</td>`).join('') + '</tr>'; i++;
      }
      out += '</tbody></table>';
    } else if (/^\s*</.test(l)) {
      const b = [];
      while (i < L.length && L[i].trim()) b.push(L[i++]);
      out += b.join('\n');
    } else {
      const p = [];
      while (i < L.length && L[i].trim() && !/^(#{1,6}\s|\s*```|\s*~~~|\s*>|\s*([-*+]|\d+[.)])\s)/.test(L[i])) p.push(L[i++]);
      out += '<p>' + p.map(inlineMD).join(' ').replace(/<br> /g, '<br>') + '</p>';
    }
  }
  return out;
}

const paginaDoc = (corpo, extra = '') => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${ESTILO_DOC}${extra}</style></head><body><div class="doc">${corpo}</div></body></html>`;

function csv(texto, sep) {
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) { if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') aspas = false; else campo += c; continue; }
    if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  const [cab, ...resto] = linhas.filter(l => l.some(c => c.trim()));
  if (!cab) return '';
  return '<table><thead><tr>' + cab.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
    resto.map(l => '<tr>' + l.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
}

// ---------------------------------------------------------------- bibliotecas (PDF, DOCX)

const _scripts = {};
function carregarScript(url) {
  return _scripts[url] || (_scripts[url] = new Promise((ok, erro) => {
    const s = document.createElement('script');
    s.src = url; s.onload = ok; s.onerror = () => erro(new Error('não carregou ' + url));
    document.head.appendChild(s);
  }));
}

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const MAMMOTH = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';

async function lerPDF(file, nome, progresso) {
  await carregarScript(PDFJS + 'pdf.min.js');
  const lib = window.pdfjsLib;
  if (!lib.GlobalWorkerOptions.workerSrc) {
    try {
      const src = await (await fetch(PDFJS + 'pdf.worker.min.js')).text();
      lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    } catch (e) { lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; }
  }
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const trabalhos = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    progresso && progresso(`${nome}: página ${p}/${pdf.numPages}`);
    const pg = await pdf.getPage(p);
    const vp = pg.getViewport({ scale: 96 / 72 });
    const k = Math.min(2, 4096 / Math.max(vp.width, vp.height));
    const vp2 = pg.getViewport({ scale: 96 / 72 * k });
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(vp2.width); cv.height = Math.ceil(vp2.height);
    // intent 'print': o modo 'display' espera requestAnimationFrame, que para quando a janela não está visível
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp2, intent: 'print' }).promise;
    const bytes = await canvasParaBytes(cv);
    trabalhos.push({ name: pdf.numPages > 1 ? `${nome} · página ${p}` : nome, kind: 'tree', images: { PAG: bytes },
      tree: { t: 'F', x: 0, y: 0, w: vp.width, h: vp.height, n: 'página ' + p, clip: true,
        fills: [{ type: 'IMAGE', key: 'PAG', mode: 'FILL' }], c: [] } });
  }
  return trabalhos;
}

async function lerDOCX(file) {
  await carregarScript(MAMMOTH);
  const r = await window.mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  return paginaDoc(r.value, '.doc{width:794px;padding:72px 80px;font-family:Calibri,Carlito,Arial,sans-serif;font-size:15px;line-height:1.5}');
}

// ---------------------------------------------------------------- entrada

async function lerImagem(file, nome) {
  const url = URL.createObjectURL(file);
  const im = await carregarImg(url);
  const bytes = await bytesDeImagem(url);
  const w = im.naturalWidth, h = im.naturalHeight;
  return { name: nome, kind: 'tree', images: { IMG: bytes },
    tree: { t: 'R', x: 0, y: 0, w, h, n: nome, fills: [{ type: 'IMAGE', key: 'IMG', mode: 'FILL' }] } };
}

async function lerSVG(file, nome) {
  const txt = await file.text();
  const d = new DOMParser().parseFromString(txt, 'image/svg+xml').documentElement;
  const vb = (d.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const w = px(d.getAttribute('width')) || vb[2] || 0, h = px(d.getAttribute('height')) || vb[3] || 0;
  if (w && h) { d.setAttribute('width', w); d.setAttribute('height', h); }
  return { name: nome, kind: 'tree', images: {}, tree: { t: 'S', x: 0, y: 0, w, h, n: nome, svg: new XMLSerializer().serializeToString(d) } };
}

// arquivos: [{ file, path }] -> trabalhos
async function lerArquivos(arquivos, progresso) {
  const acervo = criarAcervo(arquivos);
  const temDoc = arquivos.some(a => DOCS.has(EXT(a.file.name)));
  const trabalhos = [], erros = [];
  for (const { file, path } of arquivos) {
    const ext = EXT(file.name), nome = tirarExt(file.name);
    try {
      if (ext === 'html' || ext === 'htm' || ext === 'xhtml') {
        trabalhos.push({ name: nome, kind: 'html', html: await prepararHTML(await file.text(), path, acervo) });
      } else if (ext === 'md' || ext === 'markdown') {
        const html = await prepararHTML(paginaDoc(markdown(await file.text())), path, acervo);
        trabalhos.push({ name: nome, kind: 'html', html });
      } else if (ext === 'txt' || ext === 'log') {
        trabalhos.push({ name: nome, kind: 'html', html: paginaDoc('<pre style="background:none;padding:0;margin:0;font:14px/1.55 \'Roboto Mono\',Consolas,monospace">' + esc(await file.text()) + '</pre>') });
      } else if (ext === 'csv' || ext === 'tsv') {
        const t = await file.text(), amostra = t.slice(0, 2000);
        const sep = ext === 'tsv' ? '\t' : amostra.split(';').length > amostra.split(',').length ? ';' : ',';
        trabalhos.push({ name: nome, kind: 'html', html: paginaDoc(csv(t, sep), '.doc{width:auto;display:inline-block}') });
      } else if (ext === 'json') {
        let t = await file.text();
        try { t = JSON.stringify(JSON.parse(t), null, 2); } catch (e) { /* mostra como veio */ }
        trabalhos.push({ name: nome, kind: 'html', html: paginaDoc('<pre>' + esc(t) + '</pre>') });
      } else if (ext === 'pdf') {
        trabalhos.push(...await lerPDF(file, nome, progresso));
      } else if (ext === 'docx') {
        trabalhos.push({ name: nome, kind: 'html', html: await lerDOCX(file) });
      } else if (temDoc) {
        continue; // imagem/CSS/fonte de apoio de um HTML
      } else if (ext === 'svg') {
        trabalhos.push(await lerSVG(file, nome));
      } else if (IMAGENS.has(ext) || /^image\//.test(file.type)) {
        trabalhos.push(await lerImagem(file, nome));
      } else {
        erros.push(`${file.name}: formato não suportado`);
      }
    } catch (e) {
      erros.push(`${file.name}: ${e.message || e}`);
    }
  }
  return { trabalhos, erros };
}
