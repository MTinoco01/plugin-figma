const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;
const DIST = path.join(RAIZ, 'dist');

const BACKEND = [
  'service/fontService.js',
  'service/imageService.js',
  'service/layerService.js',
  'validation/buildSchema.js',
  'middlewares/errorHandler.js',
  'controllers/importController.js',
  'routes/messageRouter.js',
  'plugin.js',
].map(f => path.join(RAIZ, 'backend', 'src', f));

const FRONTEND = [
  'service/cssService.js',
  'service/measureService.js',
  'service/fileService.js',
  'service/renderService.js',
  'routes/pluginRouter.js',
  'controllers/uiController.js',
].map(f => path.join(RAIZ, 'frontend', 'src', f));

const juntar = arquivos => arquivos.map(f => fs.readFileSync(f, 'utf8').trim()).join('\n\n') + '\n';

function build() {
  fs.mkdirSync(DIST, { recursive: true });

  const code = juntar(BACKEND);
  fs.writeFileSync(path.join(DIST, 'code.js'), code);

  const html = fs.readFileSync(path.join(RAIZ, 'frontend', 'src', 'ui.html'), 'utf8');
  const script = '<script>\n' + juntar(FRONTEND).replace(/<\/script/gi, '<\\/script') + '</script>\n';
  const fim = html.lastIndexOf('</body>');
  const ui = html.slice(0, fim) + script + html.slice(fim);
  fs.writeFileSync(path.join(DIST, 'ui.html'), ui);

  console.log(`dist/code.js (${Math.round(code.length / 1024)} KB) e dist/ui.html (${Math.round(ui.length / 1024)} KB) gerados`);
}

build();
if (process.argv.includes('--watch')) {
  for (const pasta of ['backend', 'frontend']) {
    fs.watch(path.join(RAIZ, pasta, 'src'), { recursive: true }, () => {
      try { build(); } catch (e) { console.error(e.message); }
    });
  }
  console.log('observando backend/src e frontend/src…');
}
