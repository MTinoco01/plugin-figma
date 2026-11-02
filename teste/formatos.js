// Injetado no harness: testa lerArquivos() com vários formatos e escreve um resumo em #__out.
(async () => {
  const out = document.getElementById('__out') || Object.assign(document.createElement('textarea'), { id: '__out', hidden: true });
  document.body.appendChild(out);
  out.value = '';
  const linhas = [];
  try {
    const cv = Object.assign(document.createElement('canvas'), { width: 64, height: 40 });
    const g = cv.getContext('2d'); g.fillStyle = '#e11d48'; g.fillRect(0, 0, 64, 40);
    const png = await new Promise(ok => cv.toBlob(ok, 'image/png'));
    const pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
      '4 0 obj<</Length 44>>stream\nBT /F1 24 Tf 40 100 Td (Ola PDF) Tj ET\nendstream endobj\n' +
      '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';
    const md = '# Título\n\nTexto com **negrito**, *itálico* e `código`.\n\n- item um\n- item dois\n  - aninhado\n\n1. primeiro\n2. segundo\n\n> citação\n\n| a | b |\n|---|--:|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n\n- [x] feito\n- [ ] pendente\n';
    const f = (nome, conteudo, tipo) => ({ file: new File([conteudo], nome, { type: tipo }), path: nome });
    const conjuntos = [
      [f('nota.md', md, 'text/markdown')],
      [f('dados.csv', 'nome;idade\nAna;30\nBeto;25', 'text/csv')],
      [f('obj.json', '{"a":1,"b":[1,2]}', 'application/json')],
      [f('icone.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48"><circle cx="12" cy="12" r="10" fill="red"/></svg>', 'image/svg+xml')],
      [f('foto.png', png, 'image/png')],
      [f('doc.pdf', pdf, 'application/pdf')],
      // HTML + imagem e CSS locais soltos juntos
      [f('site/index.html', '<link rel="stylesheet" href="css/s.css"><div class="c"><img src="img/foto.png" style="width:64px"></div>', 'text/html'),
       { file: new File(['.c{width:300px;height:100px;background:url(../img/foto.png) center/cover}'], 's.css', { type: 'text/css' }), path: 'site/css/s.css' },
       { file: new File([png], 'foto.png', { type: 'image/png' }), path: 'site/img/foto.png' }],
    ];
    for (const lista of conjuntos) {
      const nome = lista[0].path;
      try {
        const { trabalhos, erros } = await lerArquivos(lista, () => {});
        if (erros.length) linhas.push(nome + ' ERROS ' + erros.join('; '));
        for (const t of trabalhos) {
          let arvores;
          if (t.kind === 'html') arvores = (await renderizarEMedir(t.html, lerOpcoes())).map(m => ({ tree: m.tree, images: m.images }));
          else arvores = [{ tree: t.tree, images: t.images }];
          for (const a of arvores) {
            const conta = {}; let textos = [];
            (function andar(n) { conta[n.t] = (conta[n.t] || 0) + 1; if (n.segs) textos.push(n.segs.map(s => s.s).join('')); (n.c || []).forEach(andar); })(a.tree);
            const fills = a.tree.fills ? a.tree.fills.map(p => p.type).join(',') : '';
            linhas.push(`${nome} -> ${t.name}: ${Math.round(a.tree.w)}x${Math.round(a.tree.h)} ${JSON.stringify(conta)} fills=${fills} imgs=${Object.keys(a.images).map(k => k + ':' + a.images[k].length)} textos=${JSON.stringify(textos.slice(0, 12)).slice(0, 300)}`);
          }
        }
      } catch (e) { linhas.push(nome + ' FALHOU ' + (e.stack || e)); }
    }
    out.value = linhas.join('\n');
  } catch (e) { out.value = 'ERRO ' + e.stack; }
})();
