// Junta src/ui.html com os scripts de src/ num único ui.html (o Figma só aceita um arquivo).
// Uso: node build.js   (ou  node build.js --watch)
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const ORDEM = ['estilos.js', 'medir.js', 'arquivos.js', 'main.js'];

function build() {
  const html = fs.readFileSync(path.join(SRC, 'ui.html'), 'utf8');
  const js = ORDEM.map(f => `// ---- ${f}\n` + fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
  const out = html.replace('<!-- SCRIPTS -->', () => '<script>\n' + js.replace(/<\/script/gi, '<\\/script') + '\n</script>');
  fs.writeFileSync(path.join(__dirname, 'ui.html'), out);
  console.log('ui.html gerado (' + Math.round(out.length / 1024) + ' KB)');
}

build();
if (process.argv.includes('--watch')) {
  fs.watch(SRC, () => { try { build(); } catch (e) { console.error(e.message); } });
  console.log('observando src/…');
}
