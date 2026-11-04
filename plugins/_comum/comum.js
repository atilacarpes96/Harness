// Pecas comuns aos plugins que ligam o agente aos outros programas da pasta:
// achar as pastas, rodar um processo que pode ser cancelado e liberar a placa
// de video antes de um trabalho pesado (ComfyUI, Whisper).
//
// Nada de caminho pessoal fixo aqui: a pasta dos programas e a pasta acima do
// DSHARNESS (ou DSH_PROGRAMAS, se definida).
//
// FONTE UNICA: plugins/_comum/comum.js. Cada plugin leva uma copia (comum.js na
// pasta dele), porque quem instala pelo catalogo (aba Descubra) recebe so a
// pasta do plugin. Depois de editar aqui: node plugins/_comum/sincronizar.mjs

import { execFile, spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))

// O dsh roda com DSH_HOME = <DSHARNESS>\.dsh (o iniciar.ps1 garante). Sem ele,
// vale a posicao do arquivo: plugins\<plugin>\comum.js -> DSHARNESS.
export const RAIZ_DSHARNESS = process.env.DSH_HOME
  ? resolve(process.env.DSH_HOME, '..')
  : resolve(AQUI, '..', '..')
export const RAIZ_PROGRAMAS =
  process.env.DSH_PROGRAMAS || resolve(RAIZ_DSHARNESS, '..')

const OLLAMA = process.env.DSH_OLLAMA_URL || 'http://127.0.0.1:11434'
const COMFY = process.env.DSH_COMFY_URL || 'http://127.0.0.1:8188'
export const COMFY_URL = COMFY

export function pastaDoPrograma(nome) {
  return join(RAIZ_PROGRAMAS, nome)
}

/** Saida de texto padrao das ferramentas: o valor ja e o texto para o modelo. */
export function ferramenta(def) {
  return {
    ...def,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
  }
}

/**
 * Roda um programa e devolve { codigo, saida, erros }.
 * Se o sinal abortar (usuario parou a resposta, ou estourou o tempo), mata a
 * arvore inteira do processo: o Python do gerador e do Whisper abre filhos.
 */
export function rodar(comando, args, { cwd, signal, env } = {}) {
  return new Promise((ok, falha) => {
    if (signal?.aborted) {
      falha(new Error('cancelado'))
      return
    }
    const p = spawn(comando, args, {
      cwd,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        ...env,
      },
    })
    let saida = ''
    let erros = ''
    p.stdout.setEncoding('utf8')
    p.stderr.setEncoding('utf8')
    p.stdout.on('data', (d) => {
      saida += d
    })
    p.stderr.on('data', (d) => {
      erros += d
      if (erros.length > 200_000) erros = erros.slice(-100_000)
    })
    const parar = () => matarArvore(p.pid)
    signal?.addEventListener('abort', parar, { once: true })
    p.on('error', (e) => {
      signal?.removeEventListener('abort', parar)
      falha(e)
    })
    p.on('close', (codigo) => {
      signal?.removeEventListener('abort', parar)
      if (signal?.aborted) falha(new Error('cancelado'))
      else ok({ codigo, saida, erros })
    })
  })
}

export function matarArvore(pid) {
  if (!pid) return
  execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
}

/** Os scripts do Gerador e do Transcritor terminam com um JSON na ultima linha. */
export function ultimaLinhaJson(texto) {
  const linhas = String(texto ?? '').trim().split(/\r?\n/).reverse()
  for (const linha of linhas) {
    const s = linha.trim()
    if (!s.startsWith('{')) continue
    try {
      return JSON.parse(s)
    } catch {
      // linha de log que comeca com chave; segue procurando
    }
  }
  return null
}

export function fimDoLog(texto, linhas = 8) {
  return String(texto ?? '').trim().split(/\r?\n/).slice(-linhas).join('\n')
}

/**
 * Tira da placa de video os modelos do Ollama, inclusive o do proprio agente.
 * Sem isso o ComfyUI e o Whisper disputam os 12 GB com ele e ficam lentos ou
 * falham. O modelo do agente volta sozinho na proxima resposta (alguns segundos).
 */
export async function liberarOllama() {
  try {
    const r = await fetch(`${OLLAMA}/api/ps`, { signal: AbortSignal.timeout(3000) })
    const { models = [] } = await r.json()
    for (const m of models) {
      await fetch(`${OLLAMA}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: m.name, keep_alive: 0 }),
        signal: AbortSignal.timeout(20_000),
      }).catch(() => {})
    }
    return models.map((m) => m.name)
  } catch {
    return []
  }
}

/** Pede ao ComfyUI para soltar os modelos da placa (o mesmo do botao do Gerador). */
export async function liberarComfy() {
  try {
    await fetch(`${COMFY}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(5000),
    })
    return true
  } catch {
    return false
  }
}

let pythonAchado = null

/**
 * O Python que tem torch/whisper/yt-dlp. DSH_PYTHON manda; senao o primeiro
 * python.exe do PATH que nao seja o atalho da Microsoft Store.
 */
export async function acharPython() {
  if (process.env.DSH_PYTHON) return process.env.DSH_PYTHON
  if (pythonAchado) return pythonAchado
  const lista = await new Promise((ok) => {
    execFile('where.exe', ['python'], { windowsHide: true }, (_e, out) => ok(String(out ?? '')))
  })
  pythonAchado =
    lista.split(/\r?\n/).map((s) => s.trim()).find((s) => s && !/WindowsApps/i.test(s)) ||
    'python'
  return pythonAchado
}

/** Tira aspas e espacos que o modelo as vezes deixa em volta de um caminho. */
export function limparCaminho(texto) {
  return String(texto ?? '').trim().replace(/^["'`]+|["'`]+$/g, '').trim()
}
