// Injetado no harness: mede window.__AMOSTRA, manda a árvore para /saida e
// escreve um resumo em <textarea id="__out">.
(async () => {
  const out = document.getElementById('__out') || Object.assign(document.createElement('textarea'), { id: '__out', hidden: true });
  document.body.appendChild(out);
  out.value = '';
  try {
    const t0 = performance.now();
    const res = await renderizarEMedir(window.__AMOSTRA, lerOpcoes());
    const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return btoa(s); };
    const items = res.map((m, i) => ({ name: 'teste ' + i, tree: m.tree, images: Object.fromEntries(Object.entries(m.images).map(([k, v]) => [k, b64(v)])) }));
    await fetch('/saida', { method: 'POST', body: JSON.stringify(items) });
    const r = Math.round;
    const resumo = (n, d) => (' '.repeat(d) + n.t + ' ' + (n.n || '') + ' @' + r(n.x) + ',' + r(n.y) + (n.w ? ' ' + r(n.w) + 'x' + r(n.h || 0) : '') + (n.r ? ' r' + n.r.toFixed(1) : '') +
      (n.fills ? ' [' + n.fills.map(f => f.type.replace('GRADIENT_', 'G-')).join(',') + ']' : '') + (n.stroke ? ' stroke' : '') + (n.fx ? ' fx:' + n.fx.map(e => e.type).join(',') : '') +
      (n.segs ? ' ' + n.ax + '/' + n.auto + '/' + n.al + ' ' + n.segs.map(s => JSON.stringify(s.s) + (s.ls ? '{ls' + s.ls.toFixed(1) + '}' : '') + '·' + r(s.size)).join('').slice(0, 160) : '') + '\n') +
      (n.c ? n.c.map(c => resumo(c, d + 1)).join('') : '');
    out.value = r(performance.now() - t0) + 'ms roots=' + res.length + '\n' + res.map(x => resumo(x.tree, 0)).join('\n');
  } catch (e) { out.value = 'ERRO ' + e.stack; }
})();
