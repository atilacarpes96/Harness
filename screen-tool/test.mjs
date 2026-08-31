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

import { agruparTexto, formatar, janelaDaLinha, montarArgumentos } from './index.js'

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

test('formatar avisa quando corta linhas pelo limite', () => {
  const texto = formatar(DUAS_TELAS, {
    grupos: agruparTexto(DUAS_TELAS),
    maxLinhas: 2,
    visao: null,
    monitorFiltro: null,
  })
  assert.match(texto, /4 linhas omitidas pelo limite de 2/)
})
