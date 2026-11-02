// O "medidor": percorre o documento renderizado no iframe e monta a árvore
// F/R/T/S que o code.js desenha. Usa getBoundingClientRect, getComputedStyle
// e Range (para medir cada letra e reproduzir as quebras de linha exatas).

const IGNORAR = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'HEAD', 'TEMPLATE', 'NOSCRIPT', 'BASE']);
const ATOMICOS = new Set(['IMG', 'SVG', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'CANVAS', 'VIDEO', 'IFRAME', 'OBJECT', 'EMBED', 'PICTURE', 'AUDIO', 'METER', 'PROGRESS']);
const CAIXA_TEXTO = { center: 'CENTER', right: 'RIGHT', end: 'RIGHT', justify: 'JUSTIFIED', '-webkit-center': 'CENTER' };
const CASOS = { uppercase: 'UPPER', lowercase: 'LOWER', capitalize: 'TITLE' };

class Registro {
  constructor() { this.urls = new Map(); this.bytes = {}; this.n = 0; }
  imagem(url) {
    if (!this.urls.has(url)) this.urls.set(url, 'IMG' + (++this.n));
    return this.urls.get(url);
  }
  dados(u8) { const k = 'RAW' + (++this.n); this.bytes[k] = u8; return k; }
  async resolver(progresso) {
    const lista = [...this.urls];
    let feitos = 0;
    await Promise.all(lista.map(async ([url, k]) => {
      try { this.bytes[k] = await bytesDeImagem(url); } catch (e) { console.warn('imagem falhou', url, e); }
      progresso && progresso('Baixando imagens… ' + (++feitos) + '/' + lista.length);
    }));
    return this.bytes;
  }
}

function nomeDe(el) {
  const tag = el.tagName.toLowerCase();
  if (el.id) return tag + '#' + el.id;
  const cls = typeof el.className === 'string' && el.className.trim().split(/\s+/)[0];
  return cls && !cls.startsWith('__h2f') ? tag + '.' + cls : tag;
}

function criarMedidor(doc, win, opts) {
  const reg = new Registro();
  const css = el => win.getComputedStyle(el);
  const alturas = new Map();
  const rotacoes = new Map();

  // ------------------------------------------------------------ preparação

  function injetarEstilo() {
    const st = doc.createElement('style');
    st.textContent = '*,*::before,*::after{transition:none!important;caret-color:transparent!important}' +
      'html{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important}' +
      '[data-h2f-b]::before{content:none!important}[data-h2f-a]::after{content:none!important}';
    (doc.head || doc.documentElement).appendChild(st);
  }

  // ::before e ::after não têm getBoundingClientRect: viram <span> de verdade,
  // com todo o estilo calculado copiado.
  function materializarPseudos() {
    for (const el of [...doc.body.querySelectorAll('*'), doc.body]) {
      if (IGNORAR.has(el.tagName) || ATOMICOS.has(el.tagName) || el.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;
      for (const [pseudo, attr] of [['::before', 'data-h2f-b'], ['::after', 'data-h2f-a']]) {
        const cs = win.getComputedStyle(el, pseudo);
        const content = cs.content;
        if (!content || content === 'none' || content === 'normal' || cs.display === 'none') continue;
        const span = doc.createElement('span');
        span.className = '__h2f-pseudo';
        for (let i = 0; i < cs.length; i++) {
          const p = cs[i];
          if (p === 'content' || p.startsWith('--')) continue;
          span.style.setProperty(p, cs.getPropertyValue(p));
        }
        let texto = '';
        for (const parte of dividir(content, ' ')) {
          if (/^["']/.test(parte)) texto += parte.slice(1, -1).replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, '$1');
          else if (/^attr\(/.test(parte)) texto += el.getAttribute(parte.slice(5, -1).trim()) || '';
          else if (/^url\(/.test(parte)) {
            const img = doc.createElement('img'); img.src = urlDe(parte); span.appendChild(img);
          }
        }
        if (texto) span.appendChild(doc.createTextNode(texto));
        if (pseudo === '::before') el.insertBefore(span, el.firstChild); else el.appendChild(span);
        el.setAttribute(attr, '');
      }
    }
  }

  // Tira a rotação mantendo o centro e a escala (uniforme); guarda o ângulo.
  function normalizarTransformacoes() {
    for (const el of doc.querySelectorAll('*')) {
      if (!(el instanceof win.HTMLElement)) continue;
      const cs = css(el);
      let ang = 0;
      if (cs.rotate && cs.rotate !== 'none') {
        const a = angulo(cs.rotate.split(/\s+/).pop());
        if (a) ang += a;
        el.style.setProperty('rotate', 'none', 'important');
      }
      const t = cs.transform;
      if (t && t !== 'none') {
        const v = t.match(/\((.*)\)/)[1].split(',').map(Number);
        const [a, b, c, d, e, f] = v.length === 16 ? [v[0], v[1], v[4], v[5], v[12], v[13]] : v;
        const rot = Math.atan2(b, a) * 180 / Math.PI;
        if (Math.abs(rot) > 0.01) {
          const s = Math.hypot(a, b);
          const [ox, oy] = cs.transformOrigin.split(' ').map(px);
          const vx = el.offsetWidth / 2 - ox, vy = el.offsetHeight / 2 - oy;
          // centro final = o + A·v + t  ->  com matriz s·I: t' = A·v + t − s·v
          const tx = a * vx + c * vy + e - s * vx, ty = b * vx + d * vy + f - s * vy;
          el.style.setProperty('transform', `matrix(${s}, 0, 0, ${s}, ${tx}, ${ty})`, 'important');
          ang += rot;
        }
      }
      if (Math.abs(ang) > 0.01) rotacoes.set(el, ang);
    }
  }

  // ------------------------------------------------------------ texto

  function alturaNormal(cs) {
    const k = cs.fontFamily + '|' + cs.fontSize + '|' + cs.fontWeight + '|' + cs.fontStyle;
    if (alturas.has(k)) return alturas.get(k);
    const s = doc.createElement('div');
    s.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;line-height:normal;display:block;padding:0;border:0;margin:0';
    s.style.fontFamily = cs.fontFamily; s.style.fontSize = cs.fontSize;
    s.style.fontWeight = cs.fontWeight; s.style.fontStyle = cs.fontStyle;
    s.textContent = 'Hg';
    doc.body.appendChild(s);
    const h = s.getBoundingClientRect().height;
    s.remove();
    alturas.set(k, h);
    return h;
  }

  // Escala visual acumulada (transform: scale) do elemento: tamanho na tela / tamanho de layout.
  const escalas = new Map();
  function escalaDe(el) {
    if (!el || !el.offsetWidth) return 1;
    if (!escalas.has(el)) {
      const k = el.getBoundingClientRect().width / el.offsetWidth;
      escalas.set(el, Math.abs(k - 1) < 0.01 ? 1 : k);
    }
    return escalas.get(el);
  }

  const familias = cs => cs.fontFamily.split(',').map(f => f.replace(/["']/g, '').trim()).filter(Boolean);

  function estiloDoTexto(el, bloco) {
    const cs = css(el);
    let deco = '';
    for (let e = el; e && e !== bloco.parentElement; e = e.parentElement) {
      deco += ' ' + css(e).textDecorationLine;
      if (e === bloco) break;
    }
    const preenchimento = cor(cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color ? cs.webkitTextFillColor : cs.color);
    const a = el.closest('a[href]');
    const k = escalaDe(bloco);
    return {
      fam: familias(cs), wt: +cs.fontWeight || 400, it: /italic|oblique/.test(cs.fontStyle),
      size: px(cs.fontSize) * k, cor: preenchimento,
      ls: (cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing)) * k,
      lh: (cs.lineHeight === 'normal' ? alturaNormal(cs) : px(cs.lineHeight)) * k,
      tc: cs.fontVariantCaps === 'small-caps' ? 'SMALL_CAPS' : CASOS[cs.textTransform] || null,
      td: /line-through/.test(deco) ? 'STRIKETHROUGH' : /underline/.test(deco) ? 'UNDERLINE' : null,
      href: a && bloco.contains(a) ? a.href : null,
      rtl: cs.direction === 'rtl', ws: cs.whiteSpace, vis: cs.visibility === 'visible',
    };
  }

  // Um "trecho" é uma sequência de nós de texto e elementos inline que vira
  // UMA camada de texto. Mede letra por letra para saber onde cada linha quebra.
  function textoDoTrecho(itens, bloco, base, clipTexto, saida) {
    const segs = [];
    const linhas = [];
    let pendente = null, espaco = null, folgaAntes = 0, anterior = null, inicioLinha = true, quebrou = false;
    const range = doc.createRange();
    const blocoCs = css(bloco);
    const al = CAIXA_TEXTO[blocoCs.textAlign] || 'LEFT';
    const exato = opts.quebras && al !== 'JUSTIFIED';

    const emitir = (ch, st) => {
      const ult = segs[segs.length - 1];
      if (ult && ult.st === st) ult.s += ch; else segs.push({ s: ch, st });
    };
    // Margem/padding de elementos inline não existe no texto do Figma: vira
    // espaçamento extra na última letra antes do vão.
    const alargarUltimo = (extra) => {
      const ult = segs[segs.length - 1];
      const chars = [...ult.s], ch = chars.pop();
      ult.s = chars.join('');
      if (!ult.s) segs.pop();
      segs.push({ s: ch, st: { ...ult.st, ls: ult.st.ls + extra } });
    };

    const visitar = (no) => {
      if (no.nodeType === 3) return letras(no);
      if (no.nodeType !== 1) return;
      if (no.tagName === 'BR') {
        if (segs.length) emitir('\n', segs[segs.length - 1].st);
        pendente = null; anterior = null; inicioLinha = true;
        return;
      }
      if (IGNORAR.has(no.tagName) || css(no).display === 'none') return;
      decorarInline(no, base, saida);
      for (const c of no.childNodes) visitar(c);
    };

    const letras = (tn) => {
      const st = estiloDoTexto(tn.parentElement, bloco);
      if (!st.vis) return;
      const colapsa = !/^(pre|pre-wrap|break-spaces)$/.test(st.ws);
      const mantemQuebra = !colapsa || st.ws === 'pre-line';
      const d = tn.data;
      for (let i = 0; i < d.length; i++) {
        let ch = d[i];
        const cc = d.charCodeAt(i);
        const dupla = cc >= 0xd800 && cc <= 0xdbff;
        if (dupla) ch = d.slice(i, i + 2);
        if (ch === '\n' && mantemQuebra) {
          emitir('\n', st); pendente = null; anterior = null; inicioLinha = true; continue;
        }
        if (colapsa && /\s/.test(ch)) {
          if (!inicioLinha && !pendente) {
            pendente = st;
            range.setStart(tn, i); range.setEnd(tn, i + 1);
            const re = range.getClientRects()[0];
            espaco = re && re.width > 0 ? re : null;
            folgaAntes = espaco && anterior && !st.rtl && al !== 'JUSTIFIED' && Math.abs(espaco.top - anterior.top) < 1
              ? espaco.left - anterior.right : 0;
          }
          continue;
        }
        range.setStart(tn, i); range.setEnd(tn, i + ch.length);
        if (dupla) i++;
        const r = range.getClientRects()[0];
        if (!r || (r.width === 0 && r.height === 0)) continue;
        let novaLinha = false;
        if (anterior) {
          const voltou = st.rtl ? r.right > anterior.right + 0.5 : r.left < anterior.left - 0.5;
          if (voltou && r.top > anterior.top + 1) {
            novaLinha = quebrou = true;
            if (exato) { emitir('\n', pendente || st); pendente = null; }
            linhas.push({ top: r.top, h: r.height, lh: st.lh, l: r.left, r: r.right });
          }
        } else if (!linhas.length || inicioLinha) {
          linhas.push({ top: r.top, h: r.height, lh: st.lh, l: r.left, r: r.right });
        }
        const folga = anterior && !novaLinha && !st.rtl && al !== 'JUSTIFIED'
          ? r.left - (pendente && espaco ? espaco.right : anterior.right) : 0;
        if (pendente) {
          if (folgaAntes > 1 && segs.length) alargarUltimo(folgaAntes);
          emitir(' ', pendente); pendente = null;
        }
        folgaAntes = 0;
        if (folga > 1 && segs.length) alargarUltimo(folga);
        emitir(ch, st);
        const L = linhas[linhas.length - 1];
        L.l = Math.min(L.l, r.left); L.r = Math.max(L.r, r.right);
        anterior = r; inicioLinha = false;
      }
    };

    for (const it of itens) visitar(it);
    range.detach && range.detach();
    while (segs.length && /^\s*$/.test(segs[segs.length - 1].s)) segs.pop();
    if (!segs.length || !linhas.length) return;
    segs[segs.length - 1].s = segs[segs.length - 1].s.replace(/\s+$/, '');

    const x0 = Math.min(...linhas.map(l => l.l)), x1 = Math.max(...linhas.map(l => l.r));
    const p = linhas[0];
    const y = p.top - (p.lh - p.h) / 2 - base.y;
    const no = { t: 'T', al, y, segs: [] };
    const conteudo = caixaConteudo(bloco);
    if (exato || !quebrou) {
      no.auto = 'WH';
      if (al === 'CENTER') { no.ax = 'c'; no.x = (x0 + x1) / 2 - base.x; }
      else if (al === 'RIGHT') { no.ax = 'r'; no.x = x1 - base.x; }
      else { no.ax = 'l'; no.x = x0 - base.x; }
      if (al === 'JUSTIFIED') no.al = 'LEFT';
    } else {
      no.auto = 'H'; no.ax = 'l';
      no.x = conteudo.left - base.x; no.w = conteudo.right - conteudo.left + 1;
    }
    const w = x1 - x0, h = linhas[linhas.length - 1].top + linhas[linhas.length - 1].lh - p.top;
    for (const sg of segs) {
      const st = sg.st;
      let fill = visivel(st.cor) ? solido(st.cor) : null;
      if (!fill && clipTexto) fill = gradiente(dividir(clipTexto.backgroundImage)[0] || '', w, h);
      no.segs.push({ s: sg.s, fam: st.fam, wt: st.wt, it: st.it, size: st.size, fill: fill || solido({ r: 0, g: 0, b: 0, a: 0 }),
        ls: st.ls, lh: st.lh, tc: st.tc, td: st.td, href: st.href });
    }
    const tcs = css(itens[0].nodeType === 1 ? itens[0] : itens[0].parentElement);
    const sh = sombras(tcs.textShadow, true);
    if (sh.length) no.fx = sh;
    const sw = px(tcs.webkitTextStrokeWidth);
    if (sw > 0) no.tstroke = { paint: solido(cor(tcs.webkitTextStrokeColor)), w: sw };
    saida.push({ no, grupo: 0, z: 0 });
  }

  // Fundo/borda de <span>, <mark>, <code> etc. dentro do texto: um retângulo
  // por linha, atrás da camada de texto.
  function decorarInline(el, base, saida) {
    const cs = css(el);
    const bg = fundo(cs, 1, 1, reg), bd = borda(cs), sh = sombras(cs.boxShadow);
    if (!bg.fills.length && !bd && !sh.length) return;
    for (const r of el.getClientRects()) {
      if (r.width < 0.5 || r.height < 0.5) continue;
      const no = { t: 'R', n: nomeDe(el), x: r.left - base.x, y: r.top - base.y, w: r.width, h: r.height,
        fills: fundo(cs, r.width, r.height, reg).fills, rad: cantos(cs, r.width, r.height) };
      if (bd && bd.paint) no.stroke = bd;
      if (sh.length) no.fx = sh;
      saida.push({ no, grupo: 0, z: 0 });
    }
  }

  function caixaConteudo(el) {
    const r = el.getBoundingClientRect(), cs = css(el);
    return {
      left: r.left + px(cs.borderLeftWidth) + px(cs.paddingLeft),
      right: r.right - px(cs.borderRightWidth) - px(cs.paddingRight),
      top: r.top + px(cs.borderTopWidth) + px(cs.paddingTop),
    };
  }

  // ------------------------------------------------------------ filhos

  function inlineDeTexto(el) {
    if (el.nodeType !== 1) return true;
    if (el.tagName === 'BR') return true;
    if (IGNORAR.has(el.tagName)) return true;
    if (ATOMICOS.has(el.tagName) || el.namespaceURI !== 'http://www.w3.org/1999/xhtml') return false;
    const d = css(el).display;
    if (d === 'none') return true;
    if (d !== 'inline' && d !== 'contents') return false;
    for (const c of el.children) if (!inlineDeTexto(c)) return false;
    return true;
  }

  // Lista "achatada" de filhos: display:contents e inlines que contêm blocos
  // são transparentes.
  function expandir(el) {
    const out = [];
    for (const c of el.childNodes) {
      if (c.nodeType === 3) { out.push(c); continue; }
      if (c.nodeType !== 1 || IGNORAR.has(c.tagName)) continue;
      const d = css(c).display;
      if (d === 'none') continue;
      if (d === 'contents' || (d === 'inline' && !inlineDeTexto(c) && !ATOMICOS.has(c.tagName))) out.push(...expandir(c));
      else out.push(c);
    }
    return out;
  }

  function chaveZ(cs) {
    const pos = cs.position !== 'static';
    const z = cs.zIndex === 'auto' ? 0 : +cs.zIndex;
    if (!pos) return { grupo: cs.float !== 'none' ? 0.5 : 0, z: 0 };
    return z < 0 ? { grupo: -1, z } : z === 0 ? { grupo: 1, z: 0 } : { grupo: 2, z };
  }

  async function filhos(el, base, clipTexto) {
    const saida = [];
    let trecho = [];
    const fechar = () => {
      if (trecho.length && trecho.some(n => (n.nodeType === 3 ? /\S/.test(n.data) : true))) textoDoTrecho(trecho, el, base, clipTexto, saida);
      trecho = [];
    };
    for (const c of expandir(el)) {
      if (c.nodeType === 3 || inlineDeTexto(c)) { trecho.push(c); continue; }
      fechar();
      const no = await elemento(c, base, clipTexto);
      if (no) saida.push({ no, ...chaveZ(css(c)) });
    }
    fechar();
    return saida.map((s, i) => ({ ...s, i })).sort((a, b) => a.grupo - b.grupo || a.z - b.z || a.i - b.i).map(s => s.no);
  }

  // ------------------------------------------------------------ elementos

  function caixa(el, base) {
    const r = el.getBoundingClientRect();
    const o = { x: r.left - base.x, y: r.top - base.y, w: r.width, h: r.height, n: nomeDe(el) };
    const ang = rotacoes.get(el);
    if (ang) o.r = ang; // mesmo sentido do CSS: a matriz em posicionar() usa y para baixo
    return { o, r };
  }

  function estiloDeCaixa(o, cs, el) {
    const bd = borda(cs);
    if (bd && bd.paint) {
      o.stroke = bd;
      // tabela com border-collapse: a caixa da célula vai até o meio da linha compartilhada
      if ((el.tagName === 'TD' || el.tagName === 'TH') && el.closest('table') && css(el.closest('table')).borderCollapse === 'collapse') bd.align = 'CENTER';
    }
    o.rad = cantos(cs, o.w, o.h);
    const fx = sombras(cs.boxShadow).concat(filtros(cs));
    if (fx.length) o.fx = fx;
    if (+cs.opacity < 1) o.o = +cs.opacity;
    const bl = mistura(cs);
    if (bl) o.blend = bl;
    return bd && bd.lados ? bd.lados : null;
  }

  function ladosDeBorda(lados, o) {
    const [t, r, b, l] = lados;
    const out = [];
    const ret = (x, y, w, h, lado) => out.push({ t: 'R', n: 'borda-' + lado, x, y, w, h, fills: [solido(lado === 'top' ? t.c : lado === 'right' ? r.c : lado === 'bottom' ? b.c : l.c)] });
    if (t) ret(0, 0, o.w, t.w, 'top');
    if (b) ret(0, o.h - b.w, o.w, b.w, 'bottom');
    if (l) ret(0, 0, l.w, o.h, 'left');
    if (r) ret(o.w - r.w, 0, r.w, o.h, 'right');
    return out;
  }

  async function preencherFundo(o, cs) {
    const bg = fundo(cs, o.w, o.h, reg);
    if (!bg.raster) return bg.fills;
    try { return [{ type: 'IMAGE', key: reg.dados(await rasterizarFundo(cs, o.w, o.h)), mode: 'FILL' }]; }
    catch (e) { return bg.fills.slice(0, 1); }
  }

  const MODOS_IMG = { cover: 'FILL', contain: 'FIT', 'scale-down': 'FIT', none: 'FILL', fill: 'CROP' };

  async function imagem(el, o, cs) {
    const src = el.currentSrc || el.src;
    if (!src) return { t: 'R', ...o, fills: [] };
    const semCaixa = !borda(cs) && !cantos(cs, o.w, o.h) && cs.boxShadow === 'none' && /^(fill|contain)$/.test(cs.objectFit) &&
      !visivel(cor(cs.backgroundColor)) && !px(cs.paddingLeft) && !px(cs.paddingTop);
    if (/^data:image\/svg|\.svg(\?|#|$)/i.test(src) && opts.svgVetor && semCaixa) {
      try {
        const txt = await (await fetch(src)).text();
        const d = new DOMParser().parseFromString(txt, 'image/svg+xml').documentElement;
        if (d.tagName.toLowerCase() === 'svg') {
          d.setAttribute('width', o.w); d.setAttribute('height', o.h);
          if (!d.getAttribute('preserveAspectRatio') && cs.objectFit === 'fill') d.setAttribute('preserveAspectRatio', 'none');
          return { t: 'S', ...o, svg: new XMLSerializer().serializeToString(d) };
        }
      } catch (e) { /* cai para imagem */ }
    }
    const fills = await preencherFundo(o, cs);
    fills.push({ type: 'IMAGE', key: reg.imagem(src), mode: MODOS_IMG[cs.objectFit] || 'CROP' });
    const no = { t: 'R', ...o, fills, n: el.alt || o.n };
    estiloDeCaixa(no, cs, el);
    return no;
  }

  const SVG_PROPS = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
    'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'opacity', 'stop-color', 'stop-opacity',
    'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline'];

  function svg(el, o) {
    const copia = el.cloneNode(true);
    const orig = [el, ...el.querySelectorAll('*')], dest = [copia, ...copia.querySelectorAll('*')];
    const remover = [];
    for (let i = 0; i < orig.length; i++) {
      const cs = css(orig[i]);
      if (cs.display === 'none' && !/^(defs|symbol|clipPath|mask|linearGradient|radialGradient|pattern|marker|stop|filter)$/i.test(orig[i].tagName) && !orig[i].closest('defs,symbol,clipPath,mask,pattern,marker')) { remover.push(dest[i]); continue; }
      if (orig[i].closest('defs,symbol,clipPath,mask,pattern,marker') && orig[i].tagName.toLowerCase() !== 'stop') continue;
      for (const p of SVG_PROPS) {
        const v = cs.getPropertyValue(p);
        if (v && !(p === 'stroke-dasharray' && v === 'none')) dest[i].setAttribute(p, v);
      }
    }
    remover.forEach(n => n.remove());
    // <use href="#id">: troca pela cópia do que ele referencia
    for (const u of copia.querySelectorAll('use')) {
      const ref = (u.getAttribute('href') || u.getAttribute('xlink:href') || '').replace(/^#/, '');
      const alvo = ref && doc.getElementById(ref);
      if (!alvo) continue;
      const g = doc.createElementNS('http://www.w3.org/2000/svg', alvo.tagName === 'symbol' ? 'svg' : 'g');
      for (const a of ['fill', 'stroke', 'color', 'stroke-width', 'opacity']) if (u.getAttribute(a)) g.setAttribute(a, u.getAttribute(a));
      const x = u.getAttribute('x') || 0, y = u.getAttribute('y') || 0;
      if (alvo.tagName === 'symbol') {
        if (alvo.getAttribute('viewBox')) g.setAttribute('viewBox', alvo.getAttribute('viewBox'));
        g.setAttribute('x', x); g.setAttribute('y', y);
        g.setAttribute('width', u.getAttribute('width') || '100%'); g.setAttribute('height', u.getAttribute('height') || '100%');
        for (const c of alvo.childNodes) g.appendChild(c.cloneNode(true));
      } else {
        g.setAttribute('transform', `translate(${x},${y})`);
        g.appendChild(alvo.cloneNode(true));
      }
      u.replaceWith(g);
    }
    copia.querySelectorAll('foreignObject,script').forEach(n => n.remove());
    copia.setAttribute('width', o.w); copia.setAttribute('height', o.h);
    if (!copia.getAttribute('viewBox')) copia.setAttribute('viewBox', `0 0 ${o.w} ${o.h}`);
    copia.removeAttribute('style'); copia.removeAttribute('class');
    let txt = new XMLSerializer().serializeToString(copia);
    txt = txt.replace(/currentColor/gi, css(el).color);
    return { t: 'S', ...o, svg: txt };
  }

  // Campo de formulário: caixa + texto do valor (ou placeholder).
  function campo(el, o, cs, fills) {
    const no = { t: 'F', ...o, fills, c: [] };
    const lados = estiloDeCaixa(no, cs, el);
    if (lados) no.c.push(...ladosDeBorda(lados, o));
    const tipo = (el.type || '').toLowerCase();
    if (tipo === 'checkbox' || tipo === 'radio') {
      const azul = { r: 0, g: 0.459, b: 1, a: 1 };
      no.fills = [solido(el.checked && tipo === 'checkbox' ? azul : { r: 1, g: 1, b: 1, a: 1 })];
      no.stroke = { paint: solido(el.checked ? azul : { r: 0.46, g: 0.46, b: 0.46, a: 1 }), top: el.checked && tipo === 'radio' ? o.w * 0.3 : 1, right: 0, bottom: 0, left: 0 };
      no.stroke.right = no.stroke.bottom = no.stroke.left = no.stroke.top;
      if (el.checked && tipo === 'checkbox') no.stroke = null;
      no.rad = tipo === 'radio' ? [o.w / 2, o.w / 2, o.w / 2, o.w / 2] : [2, 2, 2, 2];
      if (el.checked && tipo === 'checkbox') no.c.push({ t: 'S', x: 0, y: 0, w: o.w, h: o.h,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${o.w}" height="${o.h}" viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>` });
      return no;
    }
    let valor = el.tagName === 'SELECT' ? (el.selectedOptions[0] ? el.selectedOptions[0].text : '') : el.value;
    let corTxt = cor(cs.color);
    if (!valor && el.placeholder) { valor = el.placeholder; corTxt = cor(win.getComputedStyle(el, '::placeholder').color); }
    if (tipo === 'password' && el.value) valor = '•'.repeat(el.value.length);
    if (/^(range|color|file|hidden|image)$/.test(tipo)) return no;
    const cb = caixaConteudo(el), r = el.getBoundingClientRect();
    const lh = cs.lineHeight === 'normal' ? alturaNormal(cs) : px(cs.lineHeight);
    if (valor) {
      const area = el.tagName === 'TEXTAREA';
      const al = CAIXA_TEXTO[cs.textAlign] || 'LEFT';
      const t = { t: 'T', al, auto: area ? 'H' : 'WH', ax: 'l', x: cb.left - r.left,
        y: area ? cb.top - r.top : (o.h - lh) / 2, w: cb.right - cb.left,
        segs: [{ s: valor, fam: familias(cs), wt: +cs.fontWeight || 400, it: /italic/.test(cs.fontStyle), size: px(cs.fontSize),
          fill: solido(corTxt || { r: 0, g: 0, b: 0, a: 1 }), ls: px(cs.letterSpacing), lh, tc: CASOS[cs.textTransform] || null }] };
      if (!area && al === 'CENTER') { t.ax = 'c'; t.x = (cb.left + cb.right) / 2 - r.left; }
      if (!area && al === 'RIGHT') { t.ax = 'r'; t.x = cb.right - r.left; }
      no.c.push(t);
    }
    if (el.tagName === 'SELECT') no.c.push({ t: 'S', x: o.w - px(cs.paddingRight) - 14, y: (o.h - 10) / 2, w: 10, h: 10,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><path d="M1.5 3.5l3.5 3.5 3.5-3.5" fill="none" stroke="${cs.color}" stroke-width="1.5"/></svg>` });
    return no;
  }

  function marcador(el, base, cs) {
    if (cs.display !== 'list-item' || cs.listStyleType === 'none' || cs.listStylePosition !== 'outside') return null;
    const mc = win.getComputedStyle(el, '::marker');
    const tipo = cs.listStyleType;
    let idx = 1;
    const pai = el.parentElement;
    if (el.hasAttribute('value')) idx = +el.getAttribute('value');
    else {
      idx = pai && pai.tagName === 'OL' && pai.hasAttribute('start') ? +pai.getAttribute('start') : 1;
      for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (css(s).display === 'list-item') idx++;
    }
    const romano = n => [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
      .reduce((s, [v, l]) => { while (n >= v) { s += l; n -= v; } return s; }, '');
    const letra = n => String.fromCharCode(96 + ((n - 1) % 26) + 1);
    const txt = /^["']/.test(tipo) ? tipo.slice(1, -1).trimEnd()
      : { disc: '•', circle: '◦', square: '▪', decimal: idx + '.', 'decimal-leading-zero': String(idx).padStart(2, '0') + '.',
          'lower-alpha': letra(idx) + '.', 'lower-latin': letra(idx) + '.', 'upper-alpha': letra(idx).toUpperCase() + '.',
          'upper-latin': letra(idx).toUpperCase() + '.', 'lower-roman': romano(idx) + '.', 'upper-roman': romano(idx).toUpperCase() + '.' }[tipo] || '•';
    const cb = caixaConteudo(el), r = el.getBoundingClientRect();
    const size = px(mc.fontSize || cs.fontSize);
    const lh = cs.lineHeight === 'normal' ? alturaNormal(cs) : px(cs.lineHeight);
    return { t: 'T', n: 'marcador', al: 'RIGHT', auto: 'WH', ax: 'r', x: r.left - base.x - size * 0.3,
      y: cb.top - base.y, segs: [{ s: txt, fam: familias(mc.fontFamily ? mc : cs), wt: +(mc.fontWeight || cs.fontWeight) || 400, it: false,
        size, fill: solido(cor(mc.color || cs.color)), ls: 0, lh, tc: null }] };
  }

  async function elemento(el, base, clipTexto) {
    const cs = css(el);
    if (cs.display === 'none') return null;
    const { o, r } = caixa(el, base);
    const tag = el.tagName.toUpperCase();
    const meu = { x: r.left, y: r.top };

    if (tag === 'IMG') return imagem(el, o, cs);
    if (tag === 'SVG' && el.namespaceURI === 'http://www.w3.org/2000/svg') {
      const s = svg(el, o);
      if (+cs.opacity < 1) s.o = +cs.opacity;
      return s;
    }
    if (tag === 'CANVAS' || tag === 'VIDEO') {
      const no = { t: 'R', ...o, fills: [] };
      try {
        const bytes = await paraPNG(el, el.width || el.videoWidth || o.w, el.height || el.videoHeight || o.h);
        no.fills = [{ type: 'IMAGE', key: reg.dados(bytes), mode: tag === 'VIDEO' ? 'FIT' : 'CROP' }];
      } catch (e) {
        if (el.poster) no.fills = [{ type: 'IMAGE', key: reg.imagem(el.poster), mode: 'FILL' }];
        else no.fills = [solido({ r: 0.1, g: 0.1, b: 0.1, a: 1 })];
      }
      estiloDeCaixa(no, cs, el);
      return no;
    }
    if (tag === 'IFRAME' || tag === 'EMBED' || tag === 'OBJECT') {
      return { t: 'F', ...o, fills: [solido({ r: 0.93, g: 0.93, b: 0.93, a: 1 })], c: [] };
    }

    let fills;
    const clipaTexto = cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text';
    if (clipaTexto) { fills = []; clipTexto = cs; } else fills = await preencherFundo(o, cs);

    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return campo(el, o, cs, fills);

    const no = { t: 'F', ...o, fills, c: [] };
    const lados = estiloDeCaixa(no, cs, el);
    no.clip = /hidden|clip|auto|scroll/.test(cs.overflowX + cs.overflowY) && tag !== 'HTML' && tag !== 'BODY';
    if (cs.visibility !== 'visible') { no.fills = []; no.stroke = null; no.fx = null; }

    const mk = marcador(el, meu, cs);
    if (mk) no.c.push(mk);
    no.c.push(...(await filhos(el, meu, clipTexto)));
    if (lados) no.c.push(...ladosDeBorda(lados, o));
    return no;
  }

  // ------------------------------------------------------------ pós-processo

  const temVisual = n => (n.fills && n.fills.length) || n.stroke || (n.fx && n.fx.length) || n.clip || n.r || (n.o != null && n.o < 1) || n.blend;

  // Remove frames sem nada e (opcional) "achata" divs sem estilo, subindo os filhos.
  function simplificar(n, achatar) {
    if (n.t !== 'F') return n;
    const novos = [];
    for (const c of n.c) {
      const s = simplificar(c, achatar);
      if (!s) continue;
      if (s.t === 'F' && !temVisual(s)) {
        if (!s.c.length) continue;
        if (achatar) { for (const g of s.c) novos.push({ ...g, x: g.x + s.x, y: g.y + s.y }); continue; }
      }
      novos.push(s);
    }
    n.c = novos;
    return n;
  }

  // ------------------------------------------------------------ entrada

  function raizes() {
    const W = doc.documentElement.clientWidth;
    const kids = [...doc.body.children].filter(k => !IGNORAR.has(k.tagName) && css(k).display !== 'none' &&
      css(k).position !== 'fixed' && k.getBoundingClientRect().height > 0 && !k.classList.contains('__h2f-pseudo'));
    if (opts.raiz === 'pagina') return null;
    if (opts.raiz === 'filhos') return kids;
    if (kids.length === 1 && kids[0].getBoundingClientRect().width < W - 1) return kids;
    if (kids.length > 1) {
      const r0 = kids[0].getBoundingClientRect();
      if (r0.width < W - 1 && kids.every(k => { const r = k.getBoundingClientRect(); return Math.abs(r.width - r0.width) < 1 && Math.abs(r.height - r0.height) < 1; })) return kids;
    }
    return null;
  }

  async function medir(progresso) {
    injetarEstilo();
    materializarPseudos();
    normalizarTransformacoes();
    // rAF pode ficar parado em iframe fora da tela: o setTimeout garante que segue
    await Promise.race([new Promise(ok => win.requestAnimationFrame(() => ok())), new Promise(ok => setTimeout(ok, 60))]);
    progresso && progresso('Medindo elementos…');
    const lista = raizes();
    const arvores = [];
    if (lista) {
      for (const k of lista) {
        const r = k.getBoundingClientRect();
        const no = await elemento(k, { x: r.left, y: r.top }, null);
        if (!no) continue;
        no.x = 0; no.y = 0; delete no.r; no.clip = true;
        if (no.t === 'F' && !no.fills.length) no.fills = [solido({ r: 1, g: 1, b: 1, a: 1 })];
        arvores.push(no);
      }
    } else {
      const html = doc.documentElement, body = doc.body;
      const W = html.clientWidth;
      const H = Math.max(html.scrollHeight, body.scrollHeight, html.getBoundingClientRect().height);
      const no = await elemento(html, { x: 0, y: 0 }, null);
      const fundoHtml = cor(css(html).backgroundColor), fundoBody = cor(css(body).backgroundColor);
      const corPagina = visivel(fundoHtml) ? fundoHtml : visivel(fundoBody) ? fundoBody : { r: 1, g: 1, b: 1, a: 1 };
      no.x = 0; no.y = 0; no.w = W; no.h = H; no.clip = true; delete no.r;
      if (!no.fills.length || !visivel(fundoHtml)) no.fills = [solido(corPagina), ...no.fills.filter(f => f.type !== 'SOLID')];
      const corpo = no.c.find(c => c.n && c.n.startsWith('body'));
      if (corpo && !visivel(fundoHtml) && visivel(fundoBody)) corpo.fills = corpo.fills.filter(f => f.type !== 'SOLID');
      arvores.push(no);
    }
    const images = await reg.resolver(progresso);
    return arvores.map(a => simplificar(a, opts.achatar)).map(tree => ({ tree, images }));
  }

  return { medir };
}
