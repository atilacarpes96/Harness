// Controle do ComfyUI para o painel e para o chat: ligado ou nao, memoria,
// desligar e a preferencia "desligar sozinho depois de cada imagem".
//
// Desligar usa a funcao do proprio Gerador (gerador.desligar_comfy), que so
// fecha o ComfyUI que o Gerador abriu e se recusa a mexer no do Comfy Desktop.
//
// Tempos medidos em 03/11/2026 (RTX 4070 Ti, Qwen Image 2.1): com o ComfyUI
// ligado a imagem sai em ~40 s; desligado, a primeira leva ~95 s, porque ele
// precisa subir. Daí o aviso de "cerca de 1 minuto a mais".

import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { join } from 'node:path'
import { acharPython, COMFY_URL, rodar, ultimaLinhaJson } from './comum.js'

export const SEGUNDOS_A_MAIS_PARA_LIGAR = 55

const ARQ_PREFERENCIAS = join(
  process.env.LOCALAPPDATA || process.env.TEMP || '.',
  'dsharness',
  'gerador-imagens.json',
)

export async function lerPreferencias() {
  try {
    const p = JSON.parse(await readFile(ARQ_PREFERENCIAS, 'utf8'))
    return { desligarDepois: p.desligarDepois === true }
  } catch {
    return { desligarDepois: false }
  }
}

export async function salvarPreferencias(prefs) {
  const atual = { ...(await lerPreferencias()), ...prefs }
  await mkdir(join(ARQ_PREFERENCIAS, '..'), { recursive: true })
  await writeFile(ARQ_PREFERENCIAS, JSON.stringify(atual, null, 2), 'utf8')
  return atual
}

export async function comfyNoAr() {
  try {
    const r = await fetch(`${COMFY_URL}/system_stats`, { signal: AbortSignal.timeout(1500) })
    return r.ok
  } catch {
    return false
  }
}

/** Memoria (RAM) dos processos "python main.py --port 8188", em MB. */
function ramDoComfy() {
  const porta = new URL(COMFY_URL).port || '8188'
  const ps =
    "$p = @(Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { " +
    `$_.CommandLine -like '*main.py*' -and $_.CommandLine -like '*--port ${porta}*' }); ` +
    '[int](($p | Measure-Object WorkingSetSize -Sum).Sum / 1MB)'
  return new Promise((ok) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { windowsHide: true, timeout: 15_000 },
      (_e, out) => {
        const n = Number.parseInt(String(out ?? '').trim(), 10)
        ok(Number.isFinite(n) && n > 0 ? n : null)
      })
  })
}

let cache = { em: 0, valor: null }

/** Estado para o painel e para a ferramenta. Guarda 4 s para o painel nao martelar. */
export async function estadoComfy({ fresco = false } = {}) {
  if (!fresco && cache.valor && Date.now() - cache.em < 4000) return cache.valor
  const [ligado, prefs] = await Promise.all([comfyNoAr(), lerPreferencias()])
  const ramMB = ligado ? await ramDoComfy() : null
  cache = {
    em: Date.now(),
    valor: { ligado, ramMB, desligarDepois: prefs.desligarDepois, segundosAMais: SEGUNDOS_A_MAIS_PARA_LIGAR },
  }
  return cache.valor
}

/** Desliga pelo proprio Gerador. Devolve { ok, mensagem }. */
export async function desligarComfy(pastaGerador, signal) {
  if (!(await comfyNoAr())) {
    cache.em = 0
    return { ok: true, mensagem: 'O ComfyUI já estava desligado.' }
  }
  const python = await acharPython()
  const codigo =
    'import json, sys; sys.path.insert(0, sys.argv[1]); import gerador as v; ' +
    'ok, msg = v.desligar_comfy(); print(json.dumps({"ok": ok, "mensagem": msg}, ensure_ascii=False))'
  const r = await rodar(python, ['-c', codigo, pastaGerador], { cwd: pastaGerador, signal })
  cache.em = 0
  const j = ultimaLinhaJson(r.saida)
  if (!j) return { ok: false, mensagem: `Não consegui desligar (código ${r.codigo}).` }
  return { ok: j.ok, mensagem: j.ok ? 'ComfyUI desligado. A memória foi liberada.' : `Não desliguei: ${j.mensagem}.` }
}

/** Texto para o fim de cada imagem: o que custa deixar ligado e o que custa desligar. */
export function avisoDepoisDaImagem(estado) {
  if (!estado.ligado) {
    return `O ComfyUI foi desligado depois da imagem (opção ligada no painel ComfyUI). A próxima imagem leva cerca de 1 minuto a mais.`
  }
  const ram = estado.ramMB ? ` e ocupa ~${(estado.ramMB / 1024).toFixed(1).replace('.', ',')} GB de RAM` : ''
  return (
    `O ComfyUI continua ligado${ram}, para a próxima imagem sair em ~40 s. ` +
    `Para desligar: botão ComfyUI na barra lateral, ou peça "desliga o ComfyUI" ` +
    `(aí a próxima imagem leva cerca de 1 minuto a mais).`
  )
}

// --- endereco local para o painel da interface ------------------------------
// O botao da barra lateral roda no navegador e precisa falar com este lado.
// Escuta so em 127.0.0.1 e so responde a paginas do proprio PC (Origin local);
// um site da internet aberto no navegador nao consegue chamar.

export const PORTA_PAINEL = Number(process.env.DSH_PAINEL_PORTA || 48231)

function origemLocal(origem) {
  return !origem || /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(origem)
}

function lerCorpo(req) {
  return new Promise((ok, falha) => {
    let dados = ''
    req.setEncoding('utf8')
    req.on('data', (d) => {
      dados += d
      if (dados.length > 10_000) req.destroy()
    })
    req.on('end', () => ok(dados))
    req.on('error', falha)
  })
}

/** Sobe o endereco do painel. Devolve a funcao que fecha. Porta ocupada = outra instancia do dsh ja serve. */
export function abrirPainel(pastaGerador) {
  const srv = http.createServer(async (req, res) => {
    const origem = req.headers.origin
    if (!origemLocal(origem)) {
      res.writeHead(403).end()
      return
    }
    const cab = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    if (origem) {
      Object.assign(cab, {
        'Access-Control-Allow-Origin': origem,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Private-Network': 'true',
        Vary: 'Origin',
      })
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cab).end()
      return
    }
    try {
      let resposta
      if (req.method === 'GET' && req.url === '/comfy') {
        resposta = await estadoComfy()
      } else if (req.method === 'POST' && req.url === '/comfy/desligar') {
        resposta = await desligarComfy(pastaGerador)
      } else if (req.method === 'POST' && req.url === '/comfy/preferencia') {
        const corpo = JSON.parse((await lerCorpo(req)) || '{}')
        cache.em = 0
        resposta = await salvarPreferencias({ desligarDepois: corpo.desligarDepois === true })
      } else {
        res.writeHead(404, cab).end('{}')
        return
      }
      res.writeHead(200, cab).end(JSON.stringify(resposta))
    } catch (e) {
      res.writeHead(500, cab).end(JSON.stringify({ erro: String(e?.message ?? e) }))
    }
  })
  srv.on('error', () => {})
  srv.listen(PORTA_PAINEL, '127.0.0.1')
  return () => srv.close()
}
