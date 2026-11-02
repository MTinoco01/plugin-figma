const ROTAS = {
  build: comTratamentoDeErro(construirItens),
  'save-opts': comTratamentoDeErro(salvarOpcoes),
  'load-opts': comTratamentoDeErro(carregarOpcoes),
  notify: comTratamentoDeErro(avisar),
};

async function rotear(msg) {
  const rota = msg && ROTAS[msg.type];
  if (rota) await rota(msg);
}
