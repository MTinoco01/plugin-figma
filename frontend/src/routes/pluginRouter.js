const paraFigma = msg => parent.postMessage({ pluginMessage: msg }, '*');

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
