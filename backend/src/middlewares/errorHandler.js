function comTratamentoDeErro(acao) {
  return async (msg) => {
    try {
      await acao(msg);
    } catch (e) {
      const texto = String((e && e.message) || e);
      figma.ui.postMessage({ type: 'error', text: texto });
      figma.notify('Erro: ' + texto, { error: true });
    }
  };
}
