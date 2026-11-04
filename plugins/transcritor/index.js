// Plugin: transcrever audio, video ou link (YouTube, TikTok, Instagram) com o
// Whisper do Transcritor, a partir do chat.
//
// Link: roda o youtube.py do Transcritor (baixa o MP3 e transcreve).
// Arquivo do PC: chama direto o worker.py dele, o mesmo do Transcritor.exe.
// O .txt fica ao lado do audio; o texto volta para o agente poder resumir.

import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  acharPython,
  ferramenta,
  fimDoLog,
  limparCaminho,
  liberarOllama,
  pastaDoPrograma,
  rodar,
  ultimaLinhaJson,
} from '../_comum/comum.js'

export const name = 'transcritor'
export const inject = ['tools']

const PASTA = process.env.TRANSCRITOR_DIR || pastaDoPrograma('Transcritor')
const YOUTUBE = join(PASTA, 'youtube.py')
const WORKER = join(PASTA, 'src', 'worker.py')
// Siglas e nomes proprios para o Whisper acertar (fica fora do Git do Transcritor).
const TERMOS = join(PASTA, 'termos.txt')

// O texto inteiro de 1 h de video passa de 60 mil caracteres: estoura o
// contexto do modelo local. Vai um pedaco; o resto fica no .txt.
const MAX_TEXTO = 9000

async function responder(txt, titulo, segundos) {
  const texto = (await readFile(txt, 'utf8')).trim()
  const linhas = [
    `Transcrição pronta${titulo ? ` de "${titulo}"` : ''}${segundos ? ` em ${Math.round(segundos)} s` : ''}.`,
    `Arquivo: ${txt}`,
    `Tamanho: ${texto.length} caracteres.`,
  ]
  if (texto.length > MAX_TEXTO) {
    linhas.push(
      `Abaixo vão os primeiros ${MAX_TEXTO} caracteres; o texto inteiro está no arquivo (use a ferramenta read para ler o resto).`,
    )
  }
  linhas.push('', texto.slice(0, MAX_TEXTO))
  return linhas.join('\n')
}

async function deLink(url, idioma, python, signal) {
  const r = await rodar(python, [YOUTUBE, url, '--idioma', idioma], { cwd: PASTA, signal })
  const j = ultimaLinhaJson(r.saida)
  if (!j) return `O Transcritor terminou sem resposta (código ${r.codigo}).\n${fimDoLog(r.erros)}`
  const item = j.itens?.[0]
  if (!j.ok || !item?.txt) {
    const erro = item?.erro ?? j.erro ?? 'motivo desconhecido'
    const dica = /login|cookie|private|sign in/i.test(erro)
      ? ' Esse site pediu login: exporte o cookies.txt (ver LEIA-ME do Transcritor).'
      : ''
    return `Não deu para transcrever o link: ${erro}.${dica}`
  }
  return responder(item.txt, item.titulo, j.segundos)
}

async function deArquivo(arquivo, idioma, python, signal) {
  if (!existsSync(arquivo)) return `Não achei o arquivo: ${arquivo}`
  const lista = join(tmpdir(), `dsh-transcrever-${process.pid}-${Date.now()}.txt`)
  await writeFile(lista, arquivo, 'utf8')
  const args = ['-u', WORKER, '--model', 'turbo', '--language', idioma, '--list', lista]
  if (existsSync(TERMOS)) args.push('--termos', TERMOS)
  const t0 = Date.now()
  let r
  try {
    r = await rodar(python, args, { cwd: PASTA, signal })
  } finally {
    await rm(lista, { force: true })
  }
  // Protocolo do worker: linhas "@@TIPO<TAB>campo<TAB>campo".
  let txt = null
  let erro = null
  for (const linha of r.saida.split(/\r?\n/)) {
    if (!linha.startsWith('@@')) continue
    const campos = linha.slice(2).split('\t')
    if (campos[0] === 'FILEDONE') txt = campos[2]
    else if (campos[0] === 'FILEERR') erro = campos[2]
    else if (campos[0] === 'FATAL') erro = campos[1]
  }
  if (txt && existsSync(txt)) return responder(txt, basename(arquivo), (Date.now() - t0) / 1000)
  return `Não deu para transcrever: ${erro ?? `o Whisper saiu com código ${r.codigo}`}\n${fimDoLog(r.erros, 5)}`
}

async function transcrever(args, exec) {
  const origem = limparCaminho(args?.origem)
  if (!origem) return 'Faltou o link ou o caminho do arquivo (campo "origem").'
  const idioma = ['pt', 'en', 'es', 'auto'].includes(args?.idioma) ? args.idioma : 'auto'
  if (!existsSync(WORKER)) return `Não achei o Transcritor em ${PASTA}.`

  const python = await acharPython()
  // O Whisper precisa de alguns GB da placa; o modelo do agente volta depois.
  await liberarOllama()
  return /^https?:\/\//i.test(origem)
    ? deLink(origem, idioma, python, exec?.signal)
    : deArquivo(origem, idioma, python, exec?.signal)
}

export function apply(ctx) {
  ctx.tools.register(
    ferramenta({
      name: 'transcrever',
      description:
        'Transforma fala em texto com o Whisper do PC (Transcritor). Aceita link do ' +
        'YouTube, TikTok ou Instagram, ou um arquivo de áudio/vídeo do PC. Salva um .txt ' +
        'ao lado do áudio e devolve o texto para você resumir ou responder. ' +
        'Demora de alguns segundos a poucos minutos.',
      parameters: {
        type: 'object',
        properties: {
          origem: {
            type: 'string',
            description: 'O link do vídeo ou o caminho completo do arquivo de áudio/vídeo.',
          },
          idioma: {
            type: 'string',
            enum: ['pt', 'en', 'es', 'auto'],
            description: 'Idioma falado. Fixar (pt, en, es) melhora a pontuação. Padrão: auto.',
          },
        },
        required: ['origem'],
        additionalProperties: false,
      },
      timeoutMs: 30 * 60_000,
      execute: transcrever,
    }),
  )
}
