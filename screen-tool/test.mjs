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

import { agruparTexto, formatar, janelaDaLinha } from './index.js'

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

test('formatar avisa quando corta linhas pelo limite', () => {
  const texto = formatar(DUAS_TELAS, {
    grupos: agruparTexto(DUAS_TELAS),
    maxLinhas: 2,
    visao: null,
    monitorFiltro: null,
  })
  assert.match(texto, /4 linhas omitidas pelo limite de 2/)
})
