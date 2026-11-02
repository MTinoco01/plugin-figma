// Servidor estático mínimo para testar o medidor no navegador: node teste/servidor.js
const http = require('http'), fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/saida') {
    // o teste no navegador manda a árvore medida para cá (teste/saida.json)
    const partes = [];
    req.on('data', c => partes.push(c));
    req.on('end', () => { fs.writeFileSync(path.join(__dirname, 'saida.json'), Buffer.concat(partes)); res.end('ok'); });
    return;
  }
  const p = path.join(RAIZ, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(RAIZ) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(5178, () => console.log('http://localhost:5178/teste/harness.html'));
