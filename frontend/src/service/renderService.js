const esperar = ms => new Promise(ok => setTimeout(ok, ms));

async function renderizarEMedir(html, opts) {
  const velho = $('palco');
  const f = document.createElement('iframe');
  f.id = 'palco';
  f.style.width = opts.largura + 'px';
  f.style.height = opts.altura + 'px';
  velho.replaceWith(f);
  await Promise.race([
    new Promise(ok => { f.onload = ok; f.srcdoc = html; }),
    esperar(20000),
  ]);
  const doc = f.contentDocument, win = f.contentWindow;
  if (!doc || !doc.body) throw new Error('não foi possível renderizar o documento');
  status('Carregando fontes e imagens…');
  await Promise.race([doc.fonts.ready, esperar(10000)]);
  const pendentes = [...doc.images].filter(im => !im.complete);
  await Promise.race([
    Promise.all(pendentes.map(im => new Promise(ok => { im.onload = im.onerror = ok; }))),
    esperar(10000),
  ]);
  await esperar(opts.espera);
  await Promise.race([doc.fonts.ready, esperar(5000)]);
  const medidor = criarMedidor(doc, win, opts);
  return medidor.medir(status);
}
