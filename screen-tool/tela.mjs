#!/usr/bin/env node
// Linha de comando ENXUTA do screen-tool, para um agente de fora (o Claude)
// usar as mesmas camadas de percepção e controle sem o dsh.
//
// Por que existe: o agente que paga por token relê cada resultado a cada passo.
// As respostas do plugin (index.js) foram escritas para um modelo de 4B, com
// instrução repetida em toda saída ("Confira o efeito com analisar_tela..."). Aqui
// cada passo vira uma linha, a lista de controles aceita filtro e vários passos
// vão numa chamada só. Medido em 07/10/2026 contra o plugin: ver tabela no
// README.txt, seção TELA.MJS.
//
//   node tela.mjs janelas
//   node tela.mjs controles <janela> [filtro] [--tipos Button,Edit] [--tudo]
//   node tela.mjs texto <janela> [filtro] [--max 2000] [--de <trecho onde começar>]
//   node tela.mjs ler <janela> <controle>
//   node tela.mjs faz <janela> <passo> [<passo> ...]
//
// Passos do `faz` (param no primeiro passo que falhar):
//   clicar=<nome|id>   duplo=<nome|id>   clicar@x,y
//   digitar=<texto>    trocar=<texto> (apaga o campo antes)   colar=<texto>
//   teclas=<combo>     rolar=<entalhes, negativo desce>
//   esperar=<nome>     sumir=<nome>      (até 15 s, pela árvore de acessibilidade)
//   ler=<controle>     texto=<filtro>    focar    janela=<novo título>
//   ir=<url>           (navegador: ctrl+l, endereço, enter)
//   pausa=<ms>

import { execFile } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { acharElemento, normalizar } from './index.js'

const run = promisify(execFile)
const AQUI = dirname(fileURLToPath(import.meta.url))
const SAIDA = join(tmpdir(), 'dsh-screen-tool')
const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File']

async function ps(script, args) {
  try {
    const r = await run('powershell.exe', [...PS, join(AQUI, script), ...args], {
      windowsHide: true, timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
    })
    return { ok: true, saida: r.stdout }
  } catch (e) {
    return { ok: false, saida: e.stdout ?? '', erro: e.message }
  }
}

async function json(script, args) {
  await mkdir(SAIDA, { recursive: true })
  const out = join(SAIDA, `tela-${process.pid}.json`)
  await ps(script, [...args, '-Out', out])
  return JSON.parse(await readFile(out, 'utf8'))
}

// ---- percepção -------------------------------------------------------------

async function elementos(janela) {
  const d = await json('elements.ps1', ['-Janela', janela, '-Max', '600'])
  if (d.erro) throw new Error(d.erro)
  const lista = Array.isArray(d.elementos) ? d.elementos : d.elementos ? [d.elementos] : []
  return { janela: d.janela, lista }
}

// Mesmo alvo exposto duas vezes (ListItem + Hyperlink no mesmo pixel) vira um.
function unicos(lista) {
  const vistos = new Map()
  for (const e of lista) {
    const k = `${e.x},${e.y},${normalizar(e.nome)}`
    if (!vistos.has(k) || e.tipo === 'Hyperlink' || e.tipo === 'Button') vistos.set(k, e)
  }
  return [...vistos.values()]
}

const curto = (s, n = 70) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

// Uma linha por controle. Sem coordenada por padrão: o `faz` clica pelo nome e
// acha a posição sozinho; coordenada só serve para clicar@x,y (--pos).
// Tipo omitido quando é botão, o caso mais comum.
let comPos = false
function linhaControle(e) {
  const id = e.id && !/^view_\d+$/.test(e.id) ? ` #${e.id}` : ''
  const fora = e.habilitado ? '' : ' (fora da tela)'
  const valor = e.valor ? ` = ${JSON.stringify(curto(e.valor, 60))}` : ''
  const tipo = e.tipo === 'Button' ? '' : ` [${e.tipo}]`
  const pos = comPos ? ` ${e.x},${e.y}` : ''
  return `${curto(e.nome) || '(sem nome)'}${id}${tipo}${pos}${valor}${fora}`
}

// Ícones de fonte (área de uso privado) e o caractere de objeto não dizem nada.
function limparTexto(t) {
  const linhas = String(t ?? '')
    .replace(/[\uE000-\uF8FF\uFFFC]/g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  return linhas.filter((l, i) => l !== linhas[i - 1])
}

async function texto(janela, filtro, max = 2000, de = '') {
  const d = await json('texto.ps1', ['-Janela', janela])
  if (d.erro) throw new Error(d.erro)
  let linhas = limparTexto(d.texto)
  // --de pula o menu e o cabeçalho: começa na primeira linha que contém o trecho.
  if (de) {
    const i = linhas.findIndex((l) => normalizar(l).includes(normalizar(de)))
    if (i > 0) linhas = linhas.slice(i)
  }
  if (filtro) {
    const alvo = normalizar(filtro)
    // Filtro curto ("RT") casaria dentro de "Portarias" e "Porto"; exige palavra.
    const casa = alvo.length <= 3
      ? ((s) => new RegExp(`(^|[^a-z0-9])${alvo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(s))
      : ((s) => s.includes(alvo))
    const marcadas = new Set()
    linhas.forEach((l, i) => {
      if (casa(normalizar(l))) for (const j of [i - 1, i, i + 1]) marcadas.add(j)
    })
    linhas = linhas.filter((_, i) => marcadas.has(i))
    if (!linhas.length) return `"${filtro}" não aparece em "${d.janela}".`
  }
  let corpo = linhas.join('\n')
  if (corpo.length > max) corpo = `${corpo.slice(0, max)}\n[... mais ${corpo.length - max} caracteres; use um filtro]`
  return corpo
}

// ---- controle --------------------------------------------------------------

async function act(args) {
  const r = await ps('act.ps1', args)
  let d = {}
  try { d = JSON.parse(r.saida.trim().split(/\r?\n/).pop()) } catch { d = { erro: r.erro || r.saida } }
  return d
}

// Página web embrulha o link num ListItem do mesmo nome, com centro diferente.
// Se só UM dos homônimos é acionável (link, botão...), é ele o alvo; o resto é
// moldura. Nomes diferentes continuam ambíguos de verdade.
const ACIONAVEIS = ['Hyperlink', 'Button', 'MenuItem', 'TabItem', 'CheckBox', 'RadioButton', 'Edit', 'ComboBox']
function desempatar(lista) {
  if (lista.length < 2) return lista
  const nomes = new Set(lista.map((e) => normalizar(e.nome)))
  const acion = lista.filter((e) => ACIONAVEIS.includes(e.tipo))
  return nomes.size === 1 && acion.length === 1 ? acion : lista
}

function escolher(lista, procurado) {
  const achados = acharElemento(lista, procurado)
  const visiveis = achados.filter((e) => e.habilitado)
  return { achados: desempatar(unicos(achados)), visiveis: desempatar(unicos(visiveis)) }
}

function ambiguo(procurado, lista) {
  return `"${procurado}" casa com ${lista.length}; use o #id ou clicar@x,y:\n` +
    lista.slice(0, 6).map((e) => `  ${linhaControle(e)} ${e.x},${e.y}`).join('\n')
}

async function passo(estado, p) {
  const [, nome, sep, arg = ''] = p.match(/^([a-z]+)([=@]?)([\s\S]*)$/) ?? []
  const j = estado.janela
  const confirma = ['-JanelaEsperada', j]

  if (nome === 'janela') { estado.janela = arg; return `janela agora "${arg}"` }
  if (nome === 'pausa') { await new Promise((r) => setTimeout(r, Number(arg) || 500)); return `pausa ${arg} ms` }
  if (nome === 'focar') {
    const d = await act(['-Acao', 'focar', ...(arg ? ['-JanelaEsperada', arg] : confirma)])
    if (!d.feito) throw new Error(d.erro ?? 'não consegui focar')
    return `foco: ${curto(d.janela_em_foco_depois, 60)}`
  }

  if ((nome === 'clicar' || nome === 'duplo') && sep === '@') {
    const [x, y] = arg.split(',').map(Number)
    const d = await act(['-Acao', 'clicar', '-X', x, '-Y', y, ...(nome === 'duplo' ? ['-Duplo'] : []), ...confirma].map(String))
    if (!d.feito) throw new Error(d.erro ?? 'clique recusado')
    return `clicou ${x},${y}`
  }
  if (nome === 'clicar' || nome === 'duplo') {
    const { lista } = await elementos(j)
    const { achados, visiveis } = escolher(lista, arg.replace(/^#/, ''))
    if (!achados.length) throw new Error(`não há "${arg}" em "${j}"`)
    if (!visiveis.length) throw new Error(`"${arg}" existe mas está fora da tela; role antes (rolar=-5)`)
    if (visiveis.length > 1) throw new Error(ambiguo(arg, visiveis))
    const e = visiveis[0]
    const d = await act(['-Acao', 'clicar', '-X', String(e.x), '-Y', String(e.y), ...(nome === 'duplo' ? ['-Duplo'] : []), ...confirma])
    if (!d.feito) throw new Error(d.erro ?? 'clique recusado')
    return `clicou "${curto(e.nome || e.id, 50)}"`
  }

  if (nome === 'digitar' || nome === 'trocar' || nome === 'colar') {
    const extra = [...(nome === 'trocar' ? ['-Substituir'] : []), ...(nome === 'colar' ? ['-Colar'] : [])]
    const d = await act(['-Acao', 'digitar', '-Texto', arg, ...extra, ...confirma])
    if (!d.feito) throw new Error(d.erro ?? 'digitação recusada')
    return `${nome === 'colar' ? 'colou' : 'digitou'} ${arg.length} caracteres`
  }
  // Navegador: ir direto ao endereço é mais barato e mais certo que abrir menu
  // suspenso — e o link na árvore de acessibilidade já traz a URL como valor.
  if (nome === 'ir') {
    for (const a of [['-Teclas', 'ctrl+l'], ['-Texto', arg, '-Substituir'], ['-Teclas', 'enter']]) {
      const d = await act(['-Acao', a[0] === '-Teclas' ? 'teclas' : 'digitar', ...a, ...confirma])
      if (!d.feito) throw new Error(d.erro ?? 'navegação recusada')
      await new Promise((r) => setTimeout(r, 80))
    }
    return `abrindo ${curto(arg, 60)}`
  }
  if (nome === 'teclas') {
    const d = await act(['-Acao', 'teclas', '-Teclas', arg, ...confirma])
    if (!d.feito) throw new Error(d.erro ?? 'teclas recusadas')
    return `teclas ${arg}`
  }
  if (nome === 'rolar') {
    const { lista } = await elementos(j)
    // Rola no meio da janela: o maior elemento visível costuma ser o conteúdo.
    const base = lista.filter((e) => e.habilitado).sort((a, b) => b.largura * b.altura - a.largura * a.altura)[0]
    if (!base) throw new Error('não achei onde rolar')
    const d = await act(['-Acao', 'rolar', '-X', String(base.x), '-Y', String(base.y), '-Quantidade', arg || '-5'])
    if (!d.feito) throw new Error(d.erro ?? 'rolagem recusada')
    return `rolou ${arg || -5}`
  }

  if (nome === 'esperar' || nome === 'sumir') {
    const inicio = Date.now()
    while (Date.now() - inicio < 15_000) {
      let presente = false
      try { presente = escolher((await elementos(j)).lista, arg).visiveis.length > 0 } catch { /* ainda abrindo */ }
      if (presente === (nome === 'esperar')) return `${nome === 'esperar' ? 'apareceu' : 'sumiu'} "${arg}" em ${((Date.now() - inicio) / 1000).toFixed(1)} s`
      await new Promise((r) => setTimeout(r, 300))
    }
    throw new Error(`"${arg}" ${nome === 'esperar' ? 'não apareceu' : 'não sumiu'} em 15 s`)
  }

  if (nome === 'ler') {
    const { lista } = await elementos(j)
    const { achados } = escolher(lista, arg)
    if (!achados.length) throw new Error(`não há "${arg}" em "${j}"`)
    if (achados.length > 1) throw new Error(ambiguo(arg, achados))
    return `${curto(achados[0].nome || achados[0].id, 40)} = ${JSON.stringify(achados[0].valor ?? achados[0].nome)}`
  }
  if (nome === 'texto') return await texto(j, arg, 1500)

  throw new Error(`passo desconhecido: ${p}`)
}

// ---- main -------------------------------------------------------------------

async function main() {
  const [cmd, ...resto] = process.argv.slice(2)
  const opc = {}
  const pos = []
  for (let i = 0; i < resto.length; i++) {
    if (resto[i].startsWith('--')) {
      const k = resto[i].slice(2)
      opc[k] = resto[i + 1] && !resto[i + 1].startsWith('--') ? resto[++i] : true
    } else pos.push(resto[i])
  }

  if (cmd === 'janelas') {
    const r = await run('powershell.exe', ['-NoProfile', '-Command',
      "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Process | ? { $_.MainWindowTitle } | % { $_.MainWindowTitle + ' (' + $_.ProcessName + ')' }"],
      { windowsHide: true })
    return r.stdout.trim()
  }

  if (cmd === 'controles') {
    comPos = Boolean(opc.pos)
    const [janela, filtro] = pos
    const { janela: nome, lista } = await elementos(janela)
    let l = unicos(lista)
    if (opc.tipos) { const t = String(opc.tipos).split(','); l = l.filter((e) => t.includes(e.tipo)) }
    if (filtro) l = acharElemento(l, filtro)
    else if (!opc.tudo) l = l.filter((e) => e.habilitado)
    const teto = opc.tudo ? 1000 : 60
    const linhas = l.slice(0, teto).map(linhaControle)
    if (l.length > teto) linhas.push(`[... mais ${l.length - teto}; use um filtro]`)
    return `${nome} — ${l.length}\n${linhas.join('\n')}`
  }

  if (cmd === 'texto') return await texto(pos[0], pos[1], Number(opc.max) || 2000, opc.de ? String(opc.de) : '')

  if (cmd === 'ler') return await passo({ janela: pos[0] }, `ler=${pos[1]}`)

  if (cmd === 'faz') {
    const estado = { janela: pos[0] }
    const saida = []
    for (const p of pos.slice(1)) {
      try {
        saida.push(`ok ${await passo(estado, p)}`)
      } catch (e) {
        saida.push(`ERRO em "${curto(p, 40)}": ${e.message}`)
        process.exitCode = 1
        break
      }
    }
    return saida.join('\n')
  }

  return 'uso: janelas | controles <janela> [filtro] | texto <janela> [filtro] | ler <janela> <controle> | faz <janela> <passos...>'
}

main().then(
  (s) => process.stdout.write(`${s}\n`),
  (e) => { process.stdout.write(`ERRO: ${e.message}\n`); process.exitCode = 1 },
)
