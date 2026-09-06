// Testes da geometria do screen-tool. Zero dependência: node --test.
//
//   node --test screen-tool/
//
// O que estes testes protegem: o defeito que motivou a reescrita era capturar
// apenas a tela principal, e ele só se manifesta com dois monitores. Como nem
// sempre há dois ligados na máquina, o arranjo de duas telas — inclusive o mais
// comum, com a segunda à ESQUERDA e portanto em X negativo — é exercitado aqui
// com dados sintéticos. O caminho de captura de verdade tem o gancho
// -SimularMonitores no inspect.ps1.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  acharElemento,
  acharTexto,
  agruparTexto,
  abaTocando,
  assinaturaDaTela,
  ehJanelaPropria,
  ehNavegador,
  dicaDeAba,
  formatar,
  janelaDaLinha,
  janelaEmPonto,
  limparNomeAba,
  montarArgumentos,
  motivoParaNaoClicar,
  normalizar,
} from './index.js'

// -- camada de controle ------------------------------------------------------
// A regra que importa: ver a tela e agir são chamadas separadas, e entre uma e
// outra a tela pode mudar. Por isso clicar/digitar/teclar sem dizer o que se
// espera no alvo vira simulação, em vez de agir às cegas.

const temSimular = (r) => r.ps.includes('-Simular')

test('clicar sem janela_esperada não age, vira simulação', () => {
  const r = montarArgumentos({ acao: 'clicar', x: 10, y: 20 })
  assert.equal(r.semConfirmacao, true)
  assert.ok(temSimular(r), 'precisa ir com -Simular para não clicar às cegas')
})

test('digitar e teclas também exigem confirmação', () => {
  for (const acao of ['digitar', 'teclas']) {
    const r = montarArgumentos({ acao, texto: 'oi', teclas: 'ctrl+s' })
    assert.equal(r.semConfirmacao, true, `${acao} deveria exigir confirmação`)
    assert.ok(temSimular(r), `${acao} deveria ir simulado`)
  }
})

test('com janela_esperada a ação vai valendo', () => {
  const r = montarArgumentos({ acao: 'clicar', x: 10, y: 20, janela_esperada: 'Bloco' })
  assert.equal(r.semConfirmacao, false)
  assert.ok(!temSimular(r))
  assert.deepEqual(r.ps.slice(-2), ['-JanelaEsperada', 'Bloco'])
})

test('janela_esperada em branco não conta como confirmação', () => {
  const r = montarArgumentos({ acao: 'clicar', x: 1, y: 2, janela_esperada: '   ' })
  assert.equal(r.semConfirmacao, true, 'espaço em branco não é um alvo verificável')
})

test('mover e rolar não exigem confirmação', () => {
  // Mover não muda estado nenhum, e é como se sonda a tela antes de agir.
  for (const acao of ['mover', 'rolar']) {
    assert.equal(montarArgumentos({ acao, x: 1, y: 2, quantidade: -3 }).semConfirmacao, false)
  }
})

test('simular explícito é respeitado mesmo com confirmação dada', () => {
  const r = montarArgumentos({ acao: 'clicar', x: 1, y: 2, janela_esperada: 'X', simular: true })
  assert.ok(temSimular(r))
})

test('coordenada negativa chega intacta na linha de comando', () => {
  const r = montarArgumentos({ acao: 'mover', x: -1032, y: -168 })
  const i = r.ps.indexOf('-X')
  assert.deepEqual([r.ps[i + 1], r.ps[i + 3]], ['-1032', '-168'])
})

// Duas telas lado a lado com a segunda à esquerda: a principal em (0,0) e a
// secundária começando em -1920. É o arranjo que quebra código que assume
// coordenada não-negativa.
const DUAS_TELAS = {
  capturado_em: '2026-08-31T03:00:00-03:00',
  area_virtual: { x: -1920, y: 0, largura: 4480, altura: 1440 },
  monitores: [
    { indice: 0, nome: 'PRINCIPAL', principal: true, x: 0, y: 0, largura: 2560, altura: 1440 },
    { indice: 1, nome: 'ESQUERDA', principal: false, x: -1920, y: 0, largura: 1920, altura: 1080 },
  ],
  janelas: [
    {
      titulo: 'Editor', processo: 'code', x: 100, y: 50, largura: 1200, altura: 900,
      monitor: 0, minimizada: false, em_foco: true, ordem_z: 0,
    },
    {
      titulo: 'Navegador', processo: 'chrome', x: -1900, y: 20, largura: 1800, altura: 1000,
      monitor: 1, minimizada: false, em_foco: false, ordem_z: 1,
    },
    {
      titulo: 'Atrás do Editor', processo: 'notepad', x: 0, y: 0, largura: 2000, altura: 1400,
      monitor: 0, minimizada: false, em_foco: false, ordem_z: 2,
    },
    {
      titulo: 'Guardada', processo: 'spotify', x: null, y: null, largura: null, altura: null,
      monitor: null, minimizada: true, em_foco: false, ordem_z: 3,
    },
  ],
  ocr: [
    {
      monitor: 0, idioma: 'pt-BR', escala: 2, linhas: [
        { texto: 'segunda linha do editor', x: 200, y: 300, w: 300, h: 20 },
        { texto: 'primeira linha do editor', x: 200, y: 100, w: 300, h: 20 },
        // Dentro do retângulo das duas janelas do monitor 0: quem vale é a da
        // frente, porque é dela o pixel que aparece na tela.
        { texto: 'coberta pelo editor', x: 400, y: 400, w: 200, h: 20 },
        // Fora de qualquer janela: barra de tarefas.
        { texto: 'barra de tarefas', x: 10, y: 1420, w: 150, h: 15 },
      ],
    },
    {
      monitor: 1, idioma: 'pt-BR', escala: 2, linhas: [
        { texto: 'aba do navegador', x: -1800, y: 60, w: 250, h: 18 },
        { texto: 'rodape do navegador', x: -1850, y: 900, w: 200, h: 18 },
      ],
    },
  ],
}

test('janelaDaLinha escolhe a janela da frente quando duas se sobrepõem', () => {
  const linha = { texto: 'coberta pelo editor', x: 400, y: 400, w: 200, h: 20 }
  const j = janelaDaLinha(linha, DUAS_TELAS.janelas)
  assert.equal(j.titulo, 'Editor', 'a de menor ordem_z é a que aparece na tela')
})

test('janelaDaLinha atribui texto em coordenada negativa ao monitor da esquerda', () => {
  const linha = { texto: 'aba do navegador', x: -1800, y: 60, w: 250, h: 18 }
  const j = janelaDaLinha(linha, DUAS_TELAS.janelas)
  assert.equal(j.titulo, 'Navegador')
  assert.equal(j.monitor, 1)
})

test('janelaDaLinha devolve null para texto fora de qualquer janela', () => {
  const linha = { texto: 'barra de tarefas', x: 10, y: 1420, w: 150, h: 15 }
  assert.equal(janelaDaLinha(linha, DUAS_TELAS.janelas), null)
})

test('janelaDaLinha ignora janela minimizada', () => {
  // A minimizada tem coordenada nula; se o código a tratasse como retângulo,
  // null viraria 0 na comparação e ela engoliria o texto do canto da tela.
  const linha = { texto: 'canto', x: 0, y: 0, w: 10, h: 10 }
  const j = janelaDaLinha(linha, [DUAS_TELAS.janelas[3]])
  assert.equal(j, null)
})

test('agruparTexto agrupa por janela e ordena em ordem de leitura', () => {
  const grupos = agruparTexto(DUAS_TELAS)
  const editor = grupos.find((g) => g.janela?.titulo === 'Editor')
  assert.deepEqual(
    editor.linhas.map((l) => l.texto),
    ['primeira linha do editor', 'segunda linha do editor', 'coberta pelo editor'],
    'de cima para baixo, independente da ordem em que o OCR devolveu',
  )
})

test('agruparTexto deixa o texto sem janela por último', () => {
  const grupos = agruparTexto(DUAS_TELAS)
  assert.equal(grupos.at(-1).janela, null)
  assert.equal(grupos.at(-1).linhas[0].texto, 'barra de tarefas')
})

test('agruparTexto cobre os dois monitores', () => {
  const grupos = agruparTexto(DUAS_TELAS)
  const titulos = grupos.map((g) => g.janela?.titulo ?? '(fora)')
  assert.ok(titulos.includes('Editor'), 'monitor 0 presente')
  assert.ok(titulos.includes('Navegador'), 'monitor 1 presente')
  const total = grupos.reduce((n, g) => n + g.linhas.length, 0)
  assert.equal(total, 6, 'nenhuma linha perdida entre os dois monitores')
})

test('formatar publica os dois monitores e marca foco e minimizada', () => {
  const texto = formatar(DUAS_TELAS, {
    grupos: agruparTexto(DUAS_TELAS),
    maxLinhas: 120,
    visao: null,
    monitorFiltro: null,
  })
  assert.match(texto, /2560x1440 em \(0,0\)/)
  assert.match(texto, /1920x1080 em \(-1920,0\)/, 'monitor em X negativo aparece')
  assert.match(texto, /\* "Editor"/, 'janela em foco marcada')
  assert.match(texto, /"Guardada".*MINIMIZADA \(sem posição na tela\)/)
  assert.ok(
    !/"Guardada".*\(\d/.test(texto),
    'minimizada não deve publicar coordenada inventada',
  )
  assert.match(texto, /\(-1800,60\) aba do navegador/, 'coordenada negativa preservada')
})

test('formatar respeita o filtro de monitor', () => {
  const texto = formatar(DUAS_TELAS, {
    grupos: agruparTexto(DUAS_TELAS),
    maxLinhas: 120,
    visao: null,
    monitorFiltro: 1,
  })
  assert.match(texto, /"Navegador"/)
  assert.ok(!texto.includes('"Editor"'), 'janela do outro monitor fica de fora')
})

// O arranjo real da máquina, conferido em 31/08/2026 com as duas telas ligadas:
// a secundária está em pé, à esquerda e mais alta que a principal, o que dá
// origem negativa nos DOIS eixos. Fica aqui como regressão porque é o caso que
// mais facilmente quebra: é fácil lembrar de X negativo e esquecer o Y.
const RETRATO_ACIMA_E_A_ESQUERDA = {
  capturado_em: '2026-08-31T06:54:41-03:00',
  area_virtual: { x: -1080, y: -178, largura: 3640, altura: 1920 },
  monitores: [
    { indice: 0, nome: 'DISPLAY1', principal: true, x: 0, y: 0, largura: 2560, altura: 1440 },
    { indice: 1, nome: 'DISPLAY2', principal: false, x: -1080, y: -178, largura: 1080, altura: 1920 },
  ],
  janelas: [
    {
      titulo: 'Editor', processo: 'code', x: 882, y: 57, largura: 1661, altura: 1326,
      monitor: 0, minimizada: false, em_foco: true, ordem_z: 0,
    },
    {
      titulo: 'Navegador', processo: 'chrome', x: -1087, y: -178, largura: 1094, altura: 967,
      monitor: 1, minimizada: false, em_foco: false, ordem_z: 1,
    },
  ],
  ocr: [
    { monitor: 0, idioma: 'pt-BR', escala: 2, linhas: [
      { texto: 'no editor', x: 1000, y: 200, w: 100, h: 18 },
    ] },
    { monitor: 1, idioma: 'pt-BR', escala: 2, linhas: [
      // Acima do topo da tela principal: y negativo.
      { texto: 'topo do navegador', x: -1032, y: -168, w: 200, h: 18 },
      // Na tela de baixo do monitor em pé, já abaixo da janela do navegador.
      { texto: 'area de trabalho da tela em pe', x: -900, y: 1400, w: 300, h: 18 },
    ] },
  ],
}

test('monitor em pé com origem negativa nos dois eixos', () => {
  const grupos = agruparTexto(RETRATO_ACIMA_E_A_ESQUERDA)

  const nav = grupos.find((g) => g.janela?.titulo === 'Navegador')
  assert.deepEqual(
    nav.linhas.map((l) => l.texto),
    ['topo do navegador'],
    'texto em y negativo pertence à janela do monitor em pé',
  )

  const fora = grupos.find((g) => g.janela === null)
  assert.deepEqual(
    fora.linhas.map((l) => l.texto),
    ['area de trabalho da tela em pe'],
    'texto abaixo da janela, no mesmo monitor, não pode ser atribuído a ela',
  )

  const texto = formatar(RETRATO_ACIMA_E_A_ESQUERDA, {
    grupos, maxLinhas: 120, visao: null, monitorFiltro: null,
  })
  assert.match(texto, /1080x1920 em \(-1080,-178\)/)
  assert.match(texto, /3640x1920 a partir de \(-1080,-178\)/)
  assert.match(texto, /\(-1032,-168\) topo do navegador/)
})

// -- achar texto para clicar -------------------------------------------------
// O OCR troca acento e caixa o tempo todo. Exigir igualdade exata faria a
// automação falhar por um "ç" mal lido, então a comparação é tolerante.

test('normalizar tira acento, caixa e espaço sobrando', () => {
  assert.equal(normalizar('  Ação   Não  '), 'acao nao')
  assert.equal(normalizar('ÇÃOÉÊÕ'), 'caoeeo')
  assert.equal(normalizar(null), '')
})

test('acharTexto encontra mesmo com acento diferente do original', () => {
  const dados = {
    janelas: DUAS_TELAS.janelas,
    ocr: [{ monitor: 0, linhas: [{ texto: 'Configurações', x: 200, y: 100, w: 120, h: 20 }] }],
  }
  const r = acharTexto(dados, 'configuracoes')
  assert.equal(r.length, 1)
  assert.equal(r[0].janela.titulo, 'Editor')
})

test('acharTexto devolve o centro da linha, que é onde se clica', () => {
  const dados = {
    janelas: DUAS_TELAS.janelas,
    ocr: [{ monitor: 0, linhas: [{ texto: 'Salvar', x: 200, y: 100, w: 80, h: 20 }] }],
  }
  assert.deepEqual(
    (({ x, y }) => ({ x, y }))(acharTexto(dados, 'salvar')[0]),
    { x: 240, y: 110 },
  )
})

test('acharTexto acha coisa na tela de coordenada negativa', () => {
  const r = acharTexto(DUAS_TELAS, 'aba do navegador')
  assert.equal(r.length, 1)
  assert.equal(r[0].janela.titulo, 'Navegador')
  assert.ok(r[0].x < 0, 'a coordenada de clique continua negativa')
})

test('acharTexto devolve TODAS as ocorrências, para quem chama poder recusar', () => {
  const dados = {
    janelas: DUAS_TELAS.janelas,
    ocr: [{ monitor: 0, linhas: [
      { texto: 'Salvar', x: 200, y: 100, w: 80, h: 20 },
      { texto: 'Salvar como', x: 200, y: 300, w: 140, h: 20 },
    ] }],
  }
  assert.equal(acharTexto(dados, 'salvar').length, 2, 'ambiguidade tem que ser visível para quem chama')
})

test('acharTexto restringe por janela para desempatar', () => {
  const dados = {
    janelas: DUAS_TELAS.janelas,
    ocr: [
      { monitor: 0, linhas: [{ texto: 'Fechar', x: 200, y: 100, w: 80, h: 20 }] },
      { monitor: 1, linhas: [{ texto: 'Fechar', x: -1800, y: 60, w: 80, h: 20 }] },
    ],
  }
  assert.equal(acharTexto(dados, 'fechar').length, 2)
  const so = acharTexto(dados, 'fechar', 'Navegador')
  assert.equal(so.length, 1)
  assert.ok(so[0].x < 0, 'sobrou a do monitor da esquerda')
})

// -- controles pela árvore de acessibilidade ---------------------------------
// Estes números vêm da Calculadora real, medidos em 31/08. É o caso que provou
// por que o OCR não basta: procurar "+" por OCR casava com "tvl+", que era o
// botão de MEMÓRIA lido errado.
const BOTOES_CALCULADORA = [
  { nome: 'Adição de memória', id: 'MemPlus', tipo: 'Button', x: 1707, y: 910, habilitado: true },
  { nome: 'Mais', id: 'plusButton', tipo: 'Button', x: 1852, y: 1164, habilitado: true },
  { nome: 'Igual a', id: 'equalButton', tipo: 'Button', x: 1852, y: 1218, habilitado: true },
  { nome: 'Sete', id: 'num7Button', tipo: 'Button', x: 1616, y: 1058, habilitado: true },
  { nome: 'Limpar', id: 'clearButton', tipo: 'Button', x: 1774, y: 952, habilitado: true },
  { nome: 'Limpar entrada', id: 'clearEntryButton', tipo: 'Button', x: 1695, y: 952, habilitado: true },
]

test('acharElemento prefere o id exato, que não muda com o idioma', () => {
  const r = acharElemento(BOTOES_CALCULADORA, 'plusButton')
  assert.equal(r.length, 1)
  assert.equal(r[0].nome, 'Mais')
})

test('acharElemento acha o botão certo pelo nome, e não o de memória', () => {
  const r = acharElemento(BOTOES_CALCULADORA, 'Mais')
  assert.equal(r.length, 1, 'nome exato ganha de "Adição de memória", que apenas contém a palavra')
  assert.equal(r[0].id, 'plusButton')
})

test('acharElemento junta o mesmo alvo duplicado pela arvore da web', () => {
  // Pagina web expoe o mesmo link como ListItem E como Hyperlink, no mesmo
  // pixel. Sem juntar, toda busca numa pagina vira "ambiguo" e a automacao
  // trava sem motivo real. Fica o tipo mais acionavel.
  const duplicado = [
    { nome: 'Serviços', id: '', tipo: 'ListItem', x: 956, y: 314, habilitado: true },
    { nome: 'Serviços', id: '', tipo: 'Hyperlink', x: 956, y: 314, habilitado: true },
  ]
  const r = acharElemento(duplicado, 'Serviços')
  assert.equal(r.length, 1, 'mesma coordenada e mesmo nome = mesma coisa')
  assert.equal(r[0].tipo, 'Hyperlink', 'fica o acionavel, nao o item de lista')
})

test('acharElemento nao junta alvos de mesmo nome em lugares diferentes', () => {
  const doisLugares = [
    { nome: 'Abrir', id: '', tipo: 'Button', x: 100, y: 100, habilitado: true },
    { nome: 'Abrir', id: '', tipo: 'Button', x: 800, y: 400, habilitado: true },
  ]
  assert.equal(acharElemento(doisLugares, 'Abrir').length, 2, 'ambiguidade de verdade tem que sobreviver')
})

test('acharElemento devolve os empates em vez de escolher', () => {
  // "Limpar" casa exato com um e por prefixo com outro: o exato deve ganhar.
  assert.deepEqual(acharElemento(BOTOES_CALCULADORA, 'Limpar').map((e) => e.id), ['clearButton'])
  // Já um trecho ambíguo tem que devolver os dois, para quem chama recusar.
  assert.equal(acharElemento(BOTOES_CALCULADORA, 'clear').length, 2)
})

test('acharTexto exige igualdade em busca de 1 ou 2 caracteres', () => {
  // O caso real: "+" não pode casar dentro de "tvl+" e mandar o clique para a
  // memória. Com texto curto, "contém" acerta por acidente com frequência.
  const dados = {
    janelas: DUAS_TELAS.janelas,
    ocr: [{ monitor: 0, linhas: [
      { texto: 'tvl+', x: 200, y: 100, w: 40, h: 18 },
      { texto: 'Salvar tudo', x: 200, y: 200, w: 90, h: 18 },
    ] }],
  }
  assert.equal(acharTexto(dados, '+').length, 0, 'não pode casar dentro de tvl+')
  assert.equal(acharTexto(dados, 'Salvar').length, 1, 'busca longa continua por trecho')
})

test('substituir vira -Substituir na linha de comando', () => {
  // Clicar num campo posiciona o cursor mas NAO seleciona. Sem isto o texto
  // novo e concatenado ao antigo: foi assim que "about:blank" mais um endereco
  // viraram "chrome://blankhttps//..." na barra do Chrome.
  const r = montarArgumentos({ acao: 'digitar', texto: 'x', janela_esperada: 'Chrome', substituir: true })
  assert.ok(r.ps.includes('-Substituir'))
  const sem = montarArgumentos({ acao: 'digitar', texto: 'x', janela_esperada: 'Chrome' })
  assert.ok(!sem.ps.includes('-Substituir'), 'sem pedir, nao apaga o campo de ninguem')
})

test('focar não é forçado a simular, mas leva a janela alvo', () => {
  const r = montarArgumentos({ acao: 'focar', janela_esperada: 'Bloco' })
  assert.equal(r.semConfirmacao, false, 'focar não muda conteúdo, só traz para frente')
  assert.ok(!r.ps.includes('-Simular'))
  assert.deepEqual(r.ps.slice(-2), ['-JanelaEsperada', 'Bloco'])
})

test('formatar avisa quando corta linhas pelo limite', () => {
  const texto = formatar(DUAS_TELAS, {
    grupos: agruparTexto(DUAS_TELAS),
    maxLinhas: 2,
    visao: null,
    monitorFiltro: null,
  })
  assert.match(texto, /4 linhas omitidas pelo limite de 2/)
})

// -- a armadilha do proprio reflexo ------------------------------------------
// O dsh roda numa aba do navegador, entao a conversa fica NA TELA. Tudo que o
// agente escreve, e tudo que o usuario digita, vira texto clicavel. Medido na
// sessao session-9932b1ee: pedido "entra numa aba do youtube e da play", o
// agente procurou "youtube" na tela, achou a MENSAGEM DO USUARIO, clicou nela e
// anunciou que o video estava tocando.

test('ehJanelaPropria reconhece a janela do dsh e poupa as outras', () => {
  assert.ok(
    ehJanelaPropria('AI Coding Assistant Session — DeepSeek Harness - Google Chrome'),
    'e o titulo exato da sessao medida',
  )
  assert.ok(ehJanelaPropria({ titulo: 'algo — DeepSeek Harness' }))
  assert.ok(!ehJanelaPropria('NerdCast 1046 - Qual é a Pauta? - YouTube - Google Chrome'))
  assert.ok(!ehJanelaPropria(null), 'sem janela não é a janela do agente')
})

test('janelaEmPonto devolve a janela da frente sob a coordenada', () => {
  // (400,400) esta dentro do Editor e do "Atras do Editor"; vale a da frente.
  assert.equal(janelaEmPonto(DUAS_TELAS.janelas, 400, 400).titulo, 'Editor')
  assert.equal(janelaEmPonto(DUAS_TELAS.janelas, -1800, 60).titulo, 'Navegador')
  assert.equal(janelaEmPonto(DUAS_TELAS.janelas, 10, 1420), null, 'barra de tarefas')
})

// -- "mudou alguma coisa?" ---------------------------------------------------
// Sem isto o modelo recebe a mesma parede de texto e conclui o que quiser dela.

test('assinaturaDaTela ignora o carimbo de tempo', () => {
  const outroInstante = { ...DUAS_TELAS, capturado_em: '2030-01-01T00:00:00-03:00' }
  assert.equal(assinaturaDaTela(DUAS_TELAS), assinaturaDaTela(outroInstante))
})

test('assinaturaDaTela nao depende da ordem em que o OCR devolveu', () => {
  const invertido = {
    ...DUAS_TELAS,
    ocr: DUAS_TELAS.ocr.map((b) => ({ ...b, linhas: [...b.linhas].reverse() })),
  }
  assert.equal(assinaturaDaTela(DUAS_TELAS), assinaturaDaTela(invertido))
})

test('assinaturaDaTela muda quando o texto da tela muda', () => {
  const mexido = structuredClone(DUAS_TELAS)
  mexido.ocr[0].linhas[0].texto = 'outra coisa'
  assert.notEqual(assinaturaDaTela(DUAS_TELAS), assinaturaDaTela(mexido))
})

test('assinaturaDaTela muda quando uma janela se move', () => {
  const mexido = structuredClone(DUAS_TELAS)
  mexido.janelas[0].x = 999
  assert.notEqual(assinaturaDaTela(DUAS_TELAS), assinaturaDaTela(mexido))
})

test('formatar avisa, no topo, quando a tela esta identica a anterior', () => {
  const texto = formatar(DUAS_TELAS, {
    grupos: agruparTexto(DUAS_TELAS),
    maxLinhas: 120,
    visao: null,
    monitorFiltro: null,
    semMudancaHa: 12_000,
  })
  assert.match(texto, /IDENTICA a leitura anterior \(ha 12s\)/)
  assert.match(texto, /NAO teve efeito visivel/)
  const semAviso = formatar(DUAS_TELAS, {
    grupos: agruparTexto(DUAS_TELAS),
    maxLinhas: 120,
    visao: null,
    monitorFiltro: null,
  })
  assert.ok(!/IDENTICA/.test(semAviso), 'tela nova não leva aviso')
})

// -- abas de navegador -------------------------------------------------------
// Aba nao e janela: o Windows so ve UMA janela do Chrome. E o OCR le a tira de
// abas cortada na largura da aba, entao o nome do site nunca aparece. Sem a
// secao ABAS, "entra numa aba do youtube" e impossivel de cumprir.

test('limparNomeAba tira o sufixo do economizador de memoria do Chrome', () => {
  assert.equal(
    limparNomeAba('A Internet Morreu - YouTube – Utilização de memória – 195 MB'),
    'A Internet Morreu - YouTube',
  )
  assert.equal(
    limparNomeAba('Some Video - YouTube – Memory usage – 431 MB'),
    'Some Video - YouTube',
  )
  assert.equal(limparNomeAba('Aba sem sufixo'), 'Aba sem sufixo')
  assert.equal(limparNomeAba(null), '')
})

test('ehNavegador cobre os navegadores comuns e nada mais', () => {
  for (const p of ['chrome', 'Chrome', 'msedge', 'firefox', 'brave']) {
    assert.ok(ehNavegador(p), `${p} deveria contar como navegador`)
  }
  for (const p of ['code', 'notepad', 'explorer', '', null]) {
    assert.ok(!ehNavegador(p))
  }
})

test('formatar publica as abas com o nome inteiro e manda usar clicar_elemento', () => {
  const texto = formatar(DUAS_TELAS, {
    grupos: agruparTexto(DUAS_TELAS),
    maxLinhas: 120,
    visao: null,
    monitorFiltro: null,
    abas: {
      janela: 'Navegador',
      lista: [
        { nome: 'A Internet Morreu - YouTube', x: 517, y: 20 },
        { nome: 'NerdCast 1046 - Qual é a Pauta? - YouTube', x: 709, y: 20 },
      ],
    },
  })
  assert.match(texto, /ABAS em "Navegador" \(2\)/)
  // O nome do site sobrevive aqui, e era isso que faltava: no OCR o titulo
  // chega cortado em "NerdCast 1046 - Qual" e a palavra YouTube some.
  assert.match(texto, /"A Internet Morreu - YouTube" em \(517,20\)/)
  assert.match(texto, /clicar_elemento/)
  assert.match(texto, /NAO clicar_texto/)
})

// -- as duas recusas de clique -----------------------------------------------
// Na sessao session-9932b1ee o agente clicou na propria conversa e, depois de
// avisado que nao tinha dado certo, repetiu o MESMO clique em (1120,945) seis
// vezes seguidas com a tela parada.

// A janela do dsh cobrindo o monitor 0, como na sessao medida.
const COM_JANELA_PROPRIA = [
  {
    titulo: 'AI Coding Assistant Session — DeepSeek Harness - Google Chrome',
    processo: 'chrome', x: -8, y: -8, largura: 2576, altura: 1408,
    monitor: 0, minimizada: false, em_foco: true, ordem_z: 0,
  },
  {
    titulo: 'Bloco de Notas', processo: 'notepad', x: 2600, y: 100, largura: 400, altura: 300,
    monitor: 0, minimizada: false, em_foco: false, ordem_z: 1,
  },
]

test('recusa clique dentro da janela do proprio dsh', () => {
  // (1120,945) e a coordenada exata em que o agente clicou seis vezes.
  const r = motivoParaNaoClicar({ x: 1120, y: 945, janelas: COM_JANELA_PROPRIA })
  assert.match(r, /NAO CLIQUEI/)
  assert.match(r, /propria conversa/)
})

test('deixa passar clique numa janela que nao e a do agente', () => {
  assert.equal(motivoParaNaoClicar({ x: 2700, y: 200, janelas: COM_JANELA_PROPRIA }), null)
})

test('sem leitura de tela previa nao ha o que conferir, e o clique passa', () => {
  assert.equal(motivoParaNaoClicar({ x: 1120, y: 945, janelas: [] }), null)
})

test('recusa o mesmo clique quando a tela nao mudou desde ele', () => {
  const r = motivoParaNaoClicar({
    x: 1120, y: 945, janelas: [], assinatura: 'tela-A',
    ultimoClique: { chave: 'clicar:1120,945', assinatura: 'tela-A' },
  })
  assert.match(r, /ja clicou em \(1120,945\) e a tela continua identica/)
})

test('se a tela mudou, repetir o clique e legitimo e passa', () => {
  const r = motivoParaNaoClicar({
    x: 1120, y: 945, janelas: [], assinatura: 'tela-B',
    ultimoClique: { chave: 'clicar:1120,945', assinatura: 'tela-A' },
  })
  assert.equal(r, null)
})

test('clique em OUTRA coordenada passa mesmo com a tela parada', () => {
  const r = motivoParaNaoClicar({
    x: 500, y: 500, janelas: [], assinatura: 'tela-A',
    ultimoClique: { chave: 'clicar:1120,945', assinatura: 'tela-A' },
  })
  assert.equal(r, null)
})

// -- a conversa do agente nao conta como "a tela mudou" ----------------------
// Sem isto a trava de "nada mudou" nunca dispararia no dsh de verdade: cada
// chamada de ferramenta vira uma linha nova no chat, entao a tela muda sempre.

test('assinaturaDaTela ignora o que muda dentro da janela do proprio agente', () => {
  const base = {
    janelas: COM_JANELA_PROPRIA,
    ocr: [{ monitor: 0, linhas: [
      // dentro da janela do dsh: o log da conversa, que cresce a cada passo
      { texto: 'Tool call interagir_tela', x: 1000, y: 1030, w: 300, h: 20 },
      // dentro do Bloco de Notas: isto sim e o programa sendo controlado
      { texto: 'conteudo real', x: 2700, y: 200, w: 200, h: 20 },
    ] }],
  }
  const depois = structuredClone(base)
  depois.ocr[0].linhas[0].texto = 'Tool call analisar_tela — mais uma linha no chat'

  assert.equal(
    assinaturaDaTela(base),
    assinaturaDaTela(depois),
    'o agente falando consigo mesmo não é uma mudança na tela',
  )

  const mudouDeVerdade = structuredClone(base)
  mudouDeVerdade.ocr[0].linhas[1].texto = 'outro conteudo'
  assert.notEqual(assinaturaDaTela(base), assinaturaDaTela(mudouDeVerdade))
})

// -- aba nao e janela --------------------------------------------------------
// O erro DOMINANTE da sessao session-7ceeaf4e: 14 chamadas de `focar` com nome
// de aba, mais 4 cliques abortados pelo mesmo motivo. E a mensagem que o modelo
// recebia no clique — "a tela mudou entre perceber e agir" — apontava para a
// causa errada.

const ABAS_CHROME = {
  janela: 'NerdCast 1046 - Qual é a Pauta? - YouTube - Google Chrome',
  lista: [
    { nome: 'A Internet Morreu - YouTube', x: 517, y: 20 },
    { nome: '(7) NerdCast 1046 - Qual é a Pauta? Filmes Caseiros - YouTube', x: 709, y: 20 },
  ],
}

test('dicaDeAba reconhece o nome parcial de aba que o modelo usou', () => {
  // "NerdCast 1046" foi exatamente o que ele mandou em janela_esperada.
  const d = dicaDeAba('NerdCast 1046', ABAS_CHROME)
  assert.match(d, /nao e uma JANELA — e uma ABA/)
  assert.match(d, /clicar x=709 y=20/, 'precisa entregar a coordenada pronta')
  assert.match(d, /janela_esperada="NerdCast 1046 - Qual é a Pauta\? - YouTube - Google Chrome"/)
})

test('dicaDeAba casa tambem quando o modelo manda o titulo inteiro da aba', () => {
  const d = dicaDeAba('(7) NerdCast 1046 - Qual é a Pauta? Filmes Caseiros - YouTube', ABAS_CHROME)
  assert.match(d, /clicar x=709 y=20/)
})

test('dicaDeAba fica calada quando nao ha aba parecida', () => {
  assert.equal(dicaDeAba('Bloco de Notas', ABAS_CHROME), null)
  assert.equal(dicaDeAba('NerdCast 1046', null), null, 'sem leitura de tela não há dica')
  assert.equal(dicaDeAba('ok', ABAS_CHROME), null, 'nome curto demais casaria com qualquer coisa')
})

// -- "o play funcionou?" -----------------------------------------------------
// A pergunta que o agente nao conseguia responder, e que o fez ficar pausando e
// despausando o video na sessao session-7ceeaf4e. Video pausado e video tocando
// sao a mesma imagem num frame parado; o Chrome, porem, escreve no NOME da aba.

test('abaTocando reconhece a marca que o Chrome poe na aba', () => {
  assert.ok(abaTocando('(7) A Internet Morreu - YouTube – áudio em reprodução'))
  assert.ok(abaTocando('Some Video - YouTube - audio playing'))
  assert.ok(!abaTocando('(7) NerdCast 1046 - Qual é a Pauta? - YouTube'))
  assert.ok(!abaTocando(null))
})

test('formatar aponta a aba que esta tocando, e cala quando nenhuma esta', () => {
  const com = formatar(DUAS_TELAS, {
    grupos: agruparTexto(DUAS_TELAS), maxLinhas: 120, visao: null, monitorFiltro: null,
    abas: { janela: 'Chrome', lista: [
      { nome: 'A Internet Morreu - YouTube – áudio em reprodução', x: 562, y: 20 },
    ] },
  })
  assert.match(com, /ESTA tocando agora/)

  const sem = formatar(DUAS_TELAS, {
    grupos: agruparTexto(DUAS_TELAS), maxLinhas: 120, visao: null, monitorFiltro: null,
    abas: { janela: 'Chrome', lista: [{ nome: 'NerdCast 1046 - YouTube', x: 709, y: 20 }] },
  })
  assert.ok(!/ESTA tocando agora/.test(sem))
})

test('limparNomeAba preserva a marca de audio e tira so o uso de memoria', () => {
  assert.equal(
    limparNomeAba('A Internet Morreu - YouTube – áudio em reprodução – Utilização de memória – 195 MB'),
    'A Internet Morreu - YouTube – áudio em reprodução',
  )
})
