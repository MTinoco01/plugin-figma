// Gera teste/harness.html: o ui.html com um exemplo embutido em window.__AMOSTRA.
// Uso: node teste/gerar.js exemplos/post.html
const fs = require('fs'), path = require('path');
const raiz = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(raiz, 'ui.html'), 'utf8');
const amostra = fs.readFileSync(path.resolve(process.argv[2] || path.join(raiz, 'exemplos/post.html')), 'utf8');
const i = ui.lastIndexOf('</body>');
const tag = '<script>window.__AMOSTRA=' + JSON.stringify(amostra).replace(/<\//g, '<\/') + ';</script>';
fs.writeFileSync(path.join(__dirname, 'harness.html'), ui.slice(0, i) + tag + ui.slice(i));
console.log('teste/harness.html pronto');
