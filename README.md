# Arquivo para Figma

Plugin do Figma que transforma arquivos em camadas editáveis. Você solta o arquivo no plugin e ele aparece no canvas: textos continuam texto, ícones continuam vetor e caixas viram frames com cor, borda, cantos e sombra.

## Instalar

1. No Figma Desktop: **Plugins → Development → Import plugin from manifest…**
2. Escolha `C:\projetos\Plugin-figma\manifest.json`. Depois disso, não mova a pasta, senão o Figma passa a mostrar "Unknown plugin".
3. Para abrir: **Plugins → Development → Arquivo para Figma**.

## Usar

- **Soltar arquivos ou pastas** na área tracejada. A conversão começa sozinha.
- **Escolher arquivos / Escolher pasta** fazem o mesmo pelo seletor do sistema.
- **Colar HTML**: cole o código na caixa e clique em *Converter*. Também dá para colar com Ctrl+V em qualquer lugar do plugin.

Se o HTML usa imagens, CSS ou fontes locais, solte tudo junto (ou a pasta inteira). Os caminhos relativos (`img/foto.png`, `../css/estilo.css`) são resolvidos sozinhos.

| Formato | Vira no Figma |
| --- | --- |
| `.html` / `.htm` | Frames, textos, vetores e imagens editáveis, medidos num navegador de verdade |
| `.md` | Documento formatado (títulos, listas, tabelas, código, citações) |
| `.docx` | Documento formatado (via mammoth.js) |
| `.pdf` | Um frame por página, com a página como imagem em 2x (via pdf.js) |
| `.svg` | Vetor editável |
| `.png` `.jpg` `.gif` `.webp` `.avif` `.bmp` | Retângulo com a imagem no tamanho original (WebP e AVIF são convertidos para PNG) |
| `.txt` `.csv` `.json` | Texto em monoespaçada, tabela ou JSON formatado |

### Opções

- **Largura/Altura da tela**: o tamanho da "janela" onde o HTML é renderizado. Isso afeta media queries e unidades `vw`/`vh`.
- **Frame raiz**
  - *Automático*: se o `<body>` tem um único elemento de largura fixa (um post de 1080 px, por exemplo), ele vira o frame. Se tem vários elementos iguais (slides de um carrossel), cada um vira um frame. Caso contrário, a página inteira vira um frame.
  - *Página inteira* ou *Cada filho do body* forçam um desses modos.
- **Espera extra**: tempo a mais antes de medir, para páginas que montam o conteúdo com JavaScript (Tailwind via CDN, React etc.).
- **Quebras de linha idênticas ao original**: mede cada letra no navegador e põe a quebra exatamente onde o navegador quebrou. Desligado, o Figma quebra sozinho dentro da largura da caixa (fica mais fácil de editar, mas pode quebrar diferente).
- **Remover divs sem estilo**: tira da árvore os wrappers sem fundo, borda, sombra ou corte e sobe os filhos de nível.
- **Imagens .svg como vetor**: um `<img src="x.svg">` sem borda nem cantos vira vetor em vez de bitmap.

## Como funciona

A conversão tem duas metades, as duas rodam dentro do plugin:

1. **`ui.html` (o navegador que mede).** O arquivo é renderizado num `<iframe>` escondido com a largura escolhida. Depois o plugin:
   - espera as fontes (`document.fonts.ready`) e as imagens;
   - transforma `::before`/`::after` em `<span>` de verdade, para que tenham posição;
   - tira as rotações mantendo o centro e guarda o ângulo;
   - percorre o DOM com `getBoundingClientRect` e `getComputedStyle`;
   - mede o texto **letra por letra** com `Range`, o que dá as quebras de linha exatas e preserva margens e paddings de elementos inline (como espaçamento de letra);
   - traduz `linear-gradient` e `radial-gradient` para gradientes nativos, e `box-shadow`, `filter: blur`, `backdrop-filter`, bordas por lado, tracejado, cantos por canto, `mix-blend-mode`, `object-fit`, texto com gradiente (`background-clip: text`), marcadores de lista e campos de formulário para as propriedades do Figma;
   - transforma em imagem PNG 2x (via SVG `foreignObject`) o fundo que o Figma não sabe desenhar: padrões com `background-size`, gradientes repetidos ou cônicos, imagens posicionadas.
2. **`code.js` (o desenhista).** Recebe a árvore (`F` frame, `R` retângulo, `T` texto, `S` svg) e as imagens em bytes. Escolhe para cada texto a fonte instalada mais próxima (família, peso e itálico, com alternativas para `sans-serif`, `serif` e `monospace`), carrega todas antes de começar e cria as camadas com `createFrame`, `createText`, `createRectangle`, `createNodeFromSvg` e `createImage`.

## Testar sem o Figma

- `node teste/servidor.js` sobe `http://localhost:5178`.
- `node teste/gerar.js exemplos/post.html` cria `teste/harness.html`: a interface com o exemplo embutido.
- No navegador, abrir o harness e injetar `teste/rodar.js` mede o exemplo e grava a árvore em `teste/saida.json`. Injetar `teste/formatos.js` testa todos os formatos.
- `node teste/mock-figma.js` roda o `code.js` sobre a `saida.json` contra uma imitação rígida da API do Figma. Ela acusa cor fora de 0..1, fonte não carregada, intervalo de texto inválido, gradiente malformado etc.
- `teste/reconstruir.html` redesenha a `saida.json` com divs. Serve para comparar lado a lado com o original.

## Limitações conhecidas

- **Fontes**: o texto usa a fonte instalada no Figma com o mesmo nome. Se o HTML pede uma fonte que o navegador não tem (sem `@font-face` nem Google Fonts), o navegador mede com outra fonte e as larguras podem diferir. Google Fonts funciona dos dois lados.
- **Imagens de outros sites** só são copiadas se o servidor permitir CORS. Se não, a imagem vira um retângulo cinza do mesmo tamanho. Solte o arquivo da imagem junto com o HTML ou use `data:` URLs.
- **Sublinhado com margem**: num link sublinhado com `margin`/`padding` lateral, o vão vira espaçamento de letra, e o sublinhado se estende sobre ele.
- **`filter`** além de `blur`/`drop-shadow` (grayscale, brightness…), **`clip-path`**, **máscaras** e **transformações 3D/skew** não são reproduzidos.
- **Ordem das camadas** segue a pintura do CSS dentro de cada pai (elementos posicionados e `z-index` por cima), não necessariamente a ordem do código.
- **PDF** entra como imagem por página: fiel, mas o texto não fica editável.
- **Conteúdo com rolagem interna** (`overflow: auto`) entra cortado na posição inicial.
