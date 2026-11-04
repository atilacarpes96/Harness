// Plugin: ler documentos (PDF, Word, Excel, PowerPoint, ODT, RTF, EPUB, CSV)
// convertidos em Markdown pelo anydoc, sem nada sair do PC.
//
// O Markdown fica guardado em %TEMP%\dsh-documentos (chave = caminho, tamanho e
// data do arquivo), entao pedir a parte 2, 3... nao converte de novo.

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { ferramenta, fimDoLog, limparCaminho, rodar } from './comum.js'

export const name = 'documentos'
export const inject = ['tools']

const CACHE = join(tmpdir(), 'dsh-documentos')
// ~3 mil tokens por parte: cabe folgado no contexto de 32k do modelo padrao.
const TAMANHO_PARTE = 12_000
const TEXTO_PURO = new Set(['.txt', '.md', '.markdown', '.log', '.json', '.yml', '.yaml', '.xml', '.html', '.htm'])

let anydocAchado = null

/** O cli.js do anydoc: ANYDOC_JS, a instalacao global do npm, ou o que o PATH apontar. */
async function acharAnydoc() {
  if (anydocAchado) return anydocAchado
  const candidatos = []
  if (process.env.ANYDOC_JS) candidatos.push(process.env.ANYDOC_JS)
  if (process.env.APPDATA) {
    candidatos.push(join(process.env.APPDATA, 'npm', 'node_modules', '@firecrawl', 'anydoc', 'cli.js'))
  }
  const onde = await new Promise((ok) => {
    execFile('where.exe', ['anydoc.cmd'], { windowsHide: true }, (_e, out) => ok(String(out ?? '')))
  })
  for (const cmd of onde.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
    candidatos.push(join(dirname(cmd), 'node_modules', '@firecrawl', 'anydoc', 'cli.js'))
  }
  anydocAchado = candidatos.find((c) => existsSync(c)) ?? null
  return anydocAchado
}

async function converter(arquivo, signal) {
  const ext = extname(arquivo).toLowerCase()
  if (TEXTO_PURO.has(ext)) return { md: await readFile(arquivo, 'utf8'), caminho: arquivo }

  const info = await stat(arquivo)
  const chave = createHash('sha1')
    .update(`${arquivo}|${info.size}|${info.mtimeMs}`)
    .digest('hex')
    .slice(0, 16)
  const saida = join(CACHE, `${chave}.md`)
  if (!existsSync(saida)) {
    const cli = await acharAnydoc()
    if (!cli) return { erro: 'Não achei o anydoc (o conversor de documentos). Ele vem do Pacote IA Trabalho.' }
    await mkdir(CACHE, { recursive: true })
    const r = await rodar(process.execPath, [cli, arquivo, '-o', saida], { signal })
    if (r.codigo === 3) {
      return { erro: 'Esse PDF é escaneado (só imagem): precisa de OCR, e o conversor local não faz OCR.' }
    }
    if (r.codigo !== 0 || !existsSync(saida)) {
      return { erro: `O conversor falhou (código ${r.codigo}):\n${fimDoLog(r.erros, 5)}` }
    }
  }
  return { md: await readFile(saida, 'utf8'), caminho: saida }
}

async function lerDocumento(args, exec) {
  const arquivo = limparCaminho(args?.arquivo)
  if (!arquivo) return 'Faltou o caminho do arquivo (campo "arquivo").'
  if (!existsSync(arquivo)) return `Não achei o arquivo: ${arquivo}`

  const { md, caminho, erro } = await converter(arquivo, exec?.signal)
  if (erro) return erro

  const total = Math.max(1, Math.ceil(md.length / TAMANHO_PARTE))
  const parte = Math.min(total, Math.max(1, Number.parseInt(args?.parte ?? 1, 10) || 1))
  const trecho = md.slice((parte - 1) * TAMANHO_PARTE, parte * TAMANHO_PARTE)
  const cabecalho = [
    `${basename(arquivo)}: parte ${parte} de ${total} (${md.length} caracteres no total).`,
    parte < total ? `Para continuar, chame de novo com parte ${parte + 1}.` : 'Esta é a última parte.',
    caminho !== arquivo ? `Markdown completo: ${caminho}` : '',
  ].filter(Boolean)
  return `${cabecalho.join('\n')}\n\n${trecho}`
}

export function apply(ctx) {
  ctx.tools.register(
    ferramenta({
      name: 'ler_documento',
      description:
        'Lê o conteúdo de um documento do PC: PDF, Word, Excel, PowerPoint, ODT, RTF, ' +
        'EPUB ou CSV (convertido em texto, nada sai do PC). Documento grande vem em partes ' +
        'de ~12 mil caracteres. Use para resumir, procurar ou responder sobre o documento.',
      parameters: {
        type: 'object',
        properties: {
          arquivo: {
            type: 'string',
            description: 'Caminho completo do arquivo.',
          },
          parte: {
            type: 'integer',
            minimum: 1,
            description: 'Qual parte ler, para documento grande. Padrão 1.',
          },
        },
        required: ['arquivo'],
        additionalProperties: false,
      },
      timeoutMs: 5 * 60_000,
      execute: lerDocumento,
    }),
  )
}
