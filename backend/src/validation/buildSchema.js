const TIPOS_NO = new Set(['F', 'R', 'T', 'S']);

function validarNo(o, caminho) {
  if (!o || typeof o !== 'object') throw new Error(caminho + ': nó ausente');
  if (!TIPOS_NO.has(o.t)) throw new Error(caminho + ': tipo de nó inválido (' + o.t + ')');
  for (const k of ['x', 'y']) {
    if (typeof o[k] !== 'number' || !isFinite(o[k])) throw new Error(caminho + ': ' + k + ' inválido');
  }
  if (o.t === 'T') {
    if (!Array.isArray(o.segs) || !o.segs.length) throw new Error(caminho + ': texto sem trechos');
  } else if (o.t === 'S') {
    if (typeof o.svg !== 'string') throw new Error(caminho + ': svg ausente');
  } else if (!(o.w >= 0 && o.h >= 0)) {
    throw new Error(caminho + ': tamanho inválido');
  }
  if (o.c) o.c.forEach((c, i) => validarNo(c, caminho + '.' + i));
}

function validarBuild(msg) {
  if (!Array.isArray(msg.items) || !msg.items.length) throw new Error('nenhum item para desenhar');
  msg.items.forEach((item, i) => {
    if (!item.name) throw new Error('item ' + i + ' sem nome');
    validarNo(item.tree, item.name);
  });
}
