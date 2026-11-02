// Interface: recebe os arquivos, renderiza cada documento num iframe escondido,
// mede com o medidor e manda a árvore para o code.js desenhar.

const $ = id => document.getElementById(id);
const paraFigma = msg => parent.postMessage({ pluginMessage: msg }, '*');
const esperar = ms => new Promise(ok => setTimeout(ok, ms));

// ---------------------------------------------------------------- opções

const CAMPOS = { largura: 'o-largura', altura: 'o-altura', raiz: 'o-raiz', espera: 'o-espera', quebras: 'o-quebras', achatar: 'o-achatar', svgVetor: 'o-svg' };

function lerOpcoes() {
  const o = {};
  for (const [k, id] of Object.entries(CAMPOS)) {
    const el = $(id);
    o[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value;
  }
  return o;
}

function aplicarOpcoes(o) {
  if (!o) return;
  for (const [k, id] of Object.entries(CAMPOS)) {
    if (!(k in o)) continue;
    const el = $(id);
    if (el.type === 'checkbox') el.checked = !!o[k]; else el.value = o[k];
  }
}

for (const id of Object.values(CAMPOS)) $(id).addEventListener('change', () => paraFigma({ type: 'save-opts', opts: lerOpcoes() }));

// ---------------------------------------------------------------- registro na tela

function status(t) { $('status').textContent = t || ''; }

function linha(nome) {
  const li = document.createElement('li');
  li.innerHTML = '<span class="st">…</span><span class="nome"></span><span class="msg"></span>';
  li.querySelector('.nome').textContent = nome;
  $('log').prepend(li);
  return {
    ok(m) { li.className = 'ok'; li.querySelector('.st').textContent = '✓'; li.querySelector('.msg').textContent = m || ''; },
    erro(m) { li.className = 'er'; li.querySelector('.st').textContent = '✕'; li.querySelector('.msg').textContent = m || ''; },
    msg(m) { li.querySelector('.msg').textContent = m; },
  };
}

// ---------------------------------------------------------------- conversa com o code.js

let aguardando = null;
window.onmessage = (e) => {
  const m = e.data && e.data.pluginMessage;
  if (!m) return;
  if (m.type === 'opts') aplicarOpcoes(m.opts);
  else if (m.type === 'progress') status(m.text);
  else if ((m.type === 'done' || m.type === 'error') && aguardando) {
    const a = aguardando; aguardando = null;
    m.type === 'done' ? a.ok(m.text) : a.erro(new Error(m.text));
  }
};

function desenhar(items) {
  return new Promise((ok, erro) => {
    aguardando = { ok, erro };
    paraFigma({ type: 'build', items });
  });
}

// ---------------------------------------------------------------- renderização

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

// ---------------------------------------------------------------- fila

let ocupado = false;

async function processar(arquivos, colado) {
  if (ocupado) { status('Aguarde a conversão atual terminar.'); return; }
  ocupado = true;
  $('converter').disabled = true;
  const opts = lerOpcoes();
  try {
    status('Lendo arquivos…');
    const { trabalhos, erros } = colado
      ? { trabalhos: [{ name: 'HTML colado', kind: 'html', html: colado }], erros: [] }
      : await lerArquivos(arquivos, status);
    for (const e of erros) linha(e.split(':')[0]).erro(e.split(':').slice(1).join(':').trim());
    for (const t of trabalhos) {
      const l = linha(t.name);
      try {
        let items;
        if (t.kind === 'html') {
          const medidos = await renderizarEMedir(t.html, opts);
          if (!medidos.length) throw new Error('nada visível para converter');
          items = medidos.map((m, i) => ({ name: medidos.length > 1 ? `${t.name} · ${i + 1}` : t.name, tree: m.tree, images: m.images }));
        } else items = [{ name: t.name, tree: t.tree, images: t.images }];
        l.msg('desenhando…');
        const r = await desenhar(items);
        l.ok(r);
      } catch (e) {
        console.error(e);
        l.erro(e.message || String(e));
      }
    }
    status(trabalhos.length ? 'Concluído.' : erros.length ? 'Nenhum arquivo convertido.' : '');
  } catch (e) {
    console.error(e);
    status('Erro: ' + (e.message || e));
  } finally {
    ocupado = false;
    $('converter').disabled = false;
  }
}

// ---------------------------------------------------------------- entrada de arquivos

async function lerEntrada(entry, caminho, out) {
  if (entry.isFile) {
    const file = await new Promise((ok, erro) => entry.file(ok, erro));
    out.push({ file, path: caminho + file.name });
  } else if (entry.isDirectory) {
    const leitor = entry.createReader();
    let lote;
    do {
      lote = await new Promise((ok, erro) => leitor.readEntries(ok, erro));
      for (const e of lote) await lerEntrada(e, caminho + entry.name + '/', out);
    } while (lote.length);
  }
}

const zona = $('zona');
zona.addEventListener('click', e => { if (e.target === zona || !e.target.closest('button')) $('arquivos').click(); });
$('escolher').onclick = e => { e.stopPropagation(); $('arquivos').click(); };
$('pasta').onclick = e => { e.stopPropagation(); $('diretorio').click(); };
for (const id of ['arquivos', 'diretorio']) {
  $(id).onchange = (e) => {
    const lista = [...e.target.files].map(file => ({ file, path: file.webkitRelativePath || file.name }));
    e.target.value = '';
    if (lista.length) processar(lista);
  };
}
zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('sobre'); });
zona.addEventListener('dragleave', () => zona.classList.remove('sobre'));
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  zona.classList.remove('sobre');
  const out = [];
  const itens = [...(e.dataTransfer.items || [])];
  const entradas = itens.map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (entradas.length) for (const en of entradas) await lerEntrada(en, '', out);
  else for (const file of e.dataTransfer.files) out.push({ file, path: file.name });
  if (out.length) { processar(out); return; }
  const texto = e.dataTransfer.getData('text/html') || e.dataTransfer.getData('text/plain');
  if (texto && /<[a-z!]/i.test(texto)) processar(null, texto);
});

$('converter').onclick = () => {
  const h = $('html').value.trim();
  if (h) processar(null, h);
};

document.addEventListener('paste', (e) => {
  if (e.target.closest && e.target.closest('textarea,input')) return;
  const arquivos = [...e.clipboardData.files].map(file => ({ file, path: file.name }));
  if (arquivos.length) { processar(arquivos); return; }
  const h = e.clipboardData.getData('text/html') || e.clipboardData.getData('text/plain');
  if (h && /<[a-z!]/i.test(h)) processar(null, h);
});

paraFigma({ type: 'load-opts' });
