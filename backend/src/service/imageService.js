let HASHES = {};

function criarImagens(imagens) {
  HASHES = {};
  for (const k in imagens) {
    try { HASHES[k] = figma.createImage(imagens[k]).hash; } catch (e) { HASHES[k] = null; }
  }
}

const CINZA = { type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } };

function pintura(p) {
  if (p.type !== 'IMAGE') return p;
  const hash = HASHES[p.key];
  if (!hash) return CINZA;
  const out = { type: 'IMAGE', imageHash: hash, scaleMode: p.mode || 'FILL' };
  if (p.mode === 'CROP') out.imageTransform = p.transform || [[1, 0, 0], [0, 1, 0]];
  if (p.mode === 'TILE') out.scalingFactor = p.scale || 1;
  if (p.opacity != null) out.opacity = p.opacity;
  return out;
}

const pinturas = lista => (lista || []).map(pintura);
