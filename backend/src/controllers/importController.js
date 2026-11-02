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

async function construirItens(msg) {
  validarBuild(msg);
  const r = await importar(msg.items);
  const txt = r.frames + ' frame(s), ' + r.camadas + ' camadas criadas';
  figma.ui.postMessage({ type: 'done', text: txt });
  figma.notify('Pronto! ' + txt);
}

async function salvarOpcoes(msg) {
  await figma.clientStorage.setAsync('opts', msg.opts);
}

async function carregarOpcoes() {
  figma.ui.postMessage({ type: 'opts', opts: (await figma.clientStorage.getAsync('opts')) || null });
}

function avisar(msg) {
  figma.notify(msg.text, { error: !!msg.error });
}
