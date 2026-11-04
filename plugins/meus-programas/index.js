// Plugin: os programas do usuario num lugar so. Lista os programas da pasta
// (cada um com LEIA-ME.md) e os atalhos da area de trabalho, abre qualquer um
// pelo nome e explica como usar lendo o LEIA-ME.
//
// Nada fica fixo no codigo: a lista e lida na hora, entao programa novo na
// pasta ou atalho novo na area de trabalho aparece sozinho.

import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { ferramenta, RAIZ_PROGRAMAS } from '../_comum/comum.js'

export const name = 'meus-programas'
export const inject = ['tools']

const MAX_LEIA_ME = 7000

function powershell(comando) {
  return new Promise((ok) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', comando],
      { windowsHide: true, timeout: 15_000 },
      (_e, out) => ok(String(out ?? '').trim()),
    )
  })
}

let pastasCache = null

/** Area de trabalho do usuario, as subpastas dela (ex.: IA) e a area publica. */
async function pastasDeAtalhos() {
  if (pastasCache) return pastasCache
  const out = await powershell(
    "[Environment]::GetFolderPath('Desktop'); [Environment]::GetFolderPath('CommonDesktopDirectory')",
  )
  const [usuario, publica] = out.split(/\r?\n/).map((s) => s.trim())
  const lista = []
  if (usuario) {
    lista.push({ pasta: usuario, grupo: 'Área de trabalho' })
    const subpastas = await readdir(usuario, { withFileTypes: true }).catch(() => [])
    for (const d of subpastas) {
      if (d.isDirectory()) lista.push({ pasta: join(usuario, d.name), grupo: `Área de trabalho > ${d.name}` })
    }
  }
  if (publica) lista.push({ pasta: publica, grupo: 'Área de trabalho (todos os usuários)' })
  pastasCache = lista
  return lista
}

async function listarAtalhos() {
  const itens = []
  const vistos = new Set()
  for (const { pasta, grupo } of await pastasDeAtalhos()) {
    for (const d of await readdir(pasta, { withFileTypes: true }).catch(() => [])) {
      const ext = extname(d.name).toLowerCase()
      if (!d.isFile() || (ext !== '.lnk' && ext !== '.url')) continue
      const nome = basename(d.name, extname(d.name)).replace(/\s*-\s*atalho$/i, '')
      if (vistos.has(normalizar(nome))) continue
      vistos.add(normalizar(nome))
      itens.push({ nome, caminho: join(pasta, d.name), grupo })
    }
  }
  return itens
}

async function resumoDoLeiaMe(arquivo) {
  const texto = await readFile(arquivo, 'utf8').catch(() => '')
  for (const bloco of texto.split(/\r?\n\s*\r?\n/)) {
    const s = bloco.trim()
    if (!s || s.startsWith('#')) continue
    return s.replace(/\*\*/g, '').replace(/\s+/g, ' ').slice(0, 200)
  }
  return ''
}

async function listarProgramas() {
  const itens = []
  for (const d of await readdir(RAIZ_PROGRAMAS, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory() || /^[._]/.test(d.name)) continue
    const leiaMe = join(RAIZ_PROGRAMAS, d.name, 'LEIA-ME.md')
    if (!existsSync(leiaMe)) continue
    itens.push({
      nome: d.name,
      caminho: join(RAIZ_PROGRAMAS, d.name),
      leiaMe,
      resumo: await resumoDoLeiaMe(leiaMe),
    })
  }
  return itens
}

export function normalizar(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function pontuar(nome, procurado) {
  const a = normalizar(nome)
  const b = normalizar(procurado)
  if (!a || !b) return 0
  if (a === b) return 100
  if (a.startsWith(b) || b.startsWith(a)) return 80
  if (a.includes(b)) return 70
  if (b.includes(a) && a.length >= 4) return 60
  const palavrasNome = new Set(a.split(' '))
  const palavras = b.split(' ').filter((p) => p.length > 2)
  const comuns = palavras.filter((p) => palavrasNome.has(p)).length
  if (comuns && comuns === palavras.length) return 50
  return comuns ? 20 + comuns : 0
}

/**
 * Melhor item para o nome pedido. Empate de verdade (mesma nota e nomes do
 * mesmo tamanho) nao escolhe: devolve os candidatos, como a ferramenta de tela.
 */
export function escolher(itens, procurado) {
  const notas = itens
    .map((item) => ({ item, nota: pontuar(item.nome, procurado) }))
    .filter((x) => x.nota >= 20)
    .sort((x, y) => y.nota - x.nota || x.item.nome.length - y.item.nome.length)
  if (!notas.length) return {}
  const [primeiro, segundo] = notas
  if (
    segundo &&
    segundo.nota === primeiro.nota &&
    Math.abs(segundo.item.nome.length - primeiro.item.nome.length) <= 3
  ) {
    return { candidatos: notas.filter((x) => x.nota === primeiro.nota).map((x) => x.item.nome) }
  }
  return { item: primeiro.item, nota: primeiro.nota }
}

async function scrollLockLigado() {
  const r = await powershell(
    "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Control]::IsKeyLocked('Scroll')",
  )
  return /true/i.test(r)
}

function abrirNoWindows(caminho) {
  // O Explorer abre atalho, pasta ou arquivo com o programa padrao.
  const p = spawn('explorer.exe', [caminho], { detached: true, stdio: 'ignore' })
  p.on('error', () => {})
  p.unref()
}

async function listar() {
  const programas = await listarProgramas()
  const atalhos = await listarAtalhos()
  const linhas = [`Programas desenvolvidos (pasta ${RAIZ_PROGRAMAS}):`]
  for (const p of programas) linhas.push(`- ${p.nome}: ${p.resumo}`)
  const grupos = new Map()
  for (const a of atalhos) grupos.set(a.grupo, [...(grupos.get(a.grupo) ?? []), a.nome])
  for (const [grupo, nomes] of grupos) linhas.push('', `Atalhos em ${grupo}: ${nomes.join(', ')}`)
  return linhas.join('\n')
}

async function abrir(procurado, soPasta) {
  if (await scrollLockLigado()) {
    return 'Scroll Lock ligado: não abro nada enquanto o freio estiver aceso.'
  }
  const programas = await listarProgramas()
  if (!soPasta) {
    const atalho = escolher(await listarAtalhos(), procurado)
    if (atalho.candidatos) {
      return `Mais de um atalho combina com "${procurado}": ${atalho.candidatos.join(', ')}. Diga qual.`
    }
    if (atalho.item && atalho.nota >= 50) {
      abrirNoWindows(atalho.item.caminho)
      return `Abri "${atalho.item.nome}" (atalho em ${atalho.item.grupo}). Se precisar conferir, use analisar_tela.`
    }
  }
  const prog = escolher(programas, procurado)
  if (prog.candidatos) {
    return `Mais de um programa combina com "${procurado}": ${prog.candidatos.join(', ')}. Diga qual.`
  }
  if (prog.item) {
    abrirNoWindows(prog.item.caminho)
    return soPasta
      ? `Abri a pasta de "${prog.item.nome}" no Explorer.`
      : `"${prog.item.nome}" não tem atalho na área de trabalho; abri a pasta dele no Explorer.`
  }
  return `Não achei nenhum programa ou atalho parecido com "${procurado}". Use a ação listar para ver os nomes.`
}

async function comoUsar(procurado) {
  const prog = escolher(await listarProgramas(), procurado)
  if (prog.candidatos) return `Mais de um programa combina: ${prog.candidatos.join(', ')}. Diga qual.`
  if (!prog.item) {
    const atalho = escolher(await listarAtalhos(), procurado)
    if (atalho.item) {
      return `"${atalho.item.nome}" é só um atalho (${atalho.item.caminho}), sem LEIA-ME para ler.`
    }
    return `Não achei "${procurado}". Use a ação listar para ver os nomes.`
  }
  const texto = await readFile(prog.item.leiaMe, 'utf8')
  const corte = texto.length > MAX_LEIA_ME ? `\n\n[...cortado; o resto está em ${prog.item.leiaMe}]` : ''
  return `LEIA-ME de ${prog.item.nome}:\n\n${texto.slice(0, MAX_LEIA_ME)}${corte}`
}

async function executar(args) {
  const acao = String(args?.acao ?? 'listar')
  const programa = String(args?.programa ?? '').trim()
  if (acao === 'listar') return listar()
  if (!programa) return 'Faltou dizer qual programa (campo "programa").'
  if (acao === 'abrir') return abrir(programa, false)
  if (acao === 'abrir_pasta') return abrir(programa, true)
  if (acao === 'como_usar') return comoUsar(programa)
  return `Ação desconhecida: ${acao}. Use listar, abrir, abrir_pasta ou como_usar.`
}

export function apply(ctx) {
  ctx.tools.register(
    ferramenta({
      name: 'meus_programas',
      description:
        'Os programas do usuário num lugar só. listar = mostra os programas desenvolvidos e ' +
        'os atalhos da área de trabalho; abrir = abre um programa ou atalho pelo nome ' +
        '(ex.: "Transcritor", "Blender", "Chrome"); abrir_pasta = abre a pasta do programa; ' +
        'como_usar = lê o LEIA-ME do programa. Para abrir programa, prefira esta ferramenta ' +
        'a clicar na tela.',
      parameters: {
        type: 'object',
        properties: {
          acao: {
            type: 'string',
            enum: ['listar', 'abrir', 'abrir_pasta', 'como_usar'],
            description: 'O que fazer.',
          },
          programa: {
            type: 'string',
            description: 'Nome do programa ou atalho (não precisa ser exato). Não vale para listar.',
          },
        },
        required: ['acao'],
        additionalProperties: false,
      },
      timeoutMs: 60_000,
      execute: executar,
    }),
  )
}
