function posicionar(n, o, w, h) {
  if (!o.r) { n.x = o.x; n.y = o.y; return; }
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
