#!/usr/bin/env node
// Proxy de inspeção entre o dsh e o Ollama.
//
// Escuta em LISTEN_PORT e repassa tudo pra UPSTREAM, gravando o corpo de cada
// POST /v1/chat/completions em results/requests.jsonl. Serve pra responder
// "quanto de cada chamada é system prompt e inventário de ferramentas?" sem
// depender de instrumentar o dsh.
//
//   node harness-bench/proxy-log.mjs
//   # e apontar llm-pi-ai.providers.ollama.baseURL pra http://127.0.0.1:11435/v1

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const LISTEN_PORT = Number(process.env.PROXY_PORT ?? 11435)
const UPSTREAM_HOST = process.env.UPSTREAM_HOST ?? '127.0.0.1'
const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT ?? 11434)

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, 'results')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, 'requests.jsonl')

// Estimativa grosseira, só pra ordem de grandeza quando a resposta não traz usage.
const estTokens = (chars) => Math.round(chars / 3.6)

function summarize(body) {
  let req
  try { req = JSON.parse(body) } catch { return null }
  const msgs = req.messages ?? []
  const systemChars = msgs
    .filter((m) => m.role === 'system')
    .reduce((n, m) => n + JSON.stringify(m.content ?? '').length, 0)
  const otherChars = msgs
    .filter((m) => m.role !== 'system')
    .reduce((n, m) => n + JSON.stringify(m.content ?? '').length, 0)
  const toolsJson = JSON.stringify(req.tools ?? [])
  const tools = (req.tools ?? []).map((t) => ({
    name: t.function?.name ?? t.name,
    chars: JSON.stringify(t).length,
  }))
  tools.sort((a, b) => b.chars - a.chars)
  return {
    model: req.model,
    messageCount: msgs.length,
    systemChars,
    otherChars,
    toolCount: tools.length,
    toolsChars: toolsJson.length,
    totalChars: systemChars + otherChars + toolsJson.length,
    estSystemTokens: estTokens(systemChars),
    estToolsTokens: estTokens(toolsJson.length),
    tools,
  }
}

function usageFrom(raw) {
  // Não-streaming: JSON inteiro. Streaming: última linha `data:` que traga usage.
  try { const j = JSON.parse(raw); if (j.usage) return j.usage } catch {}
  const lines = raw.split('\n').filter((l) => l.startsWith('data: '))
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const j = JSON.parse(lines[i].slice(6))
      if (j.usage) return j.usage
    } catch {}
  }
  return null
}

let seq = 0

const server = http.createServer((clientReq, clientRes) => {
  const chunks = []
  clientReq.on('data', (c) => chunks.push(c))
  clientReq.on('end', () => {
    const body = Buffer.concat(chunks)
    const isChat = clientReq.url.includes('/chat/completions')
    const headers = { ...clientReq.headers, host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}` }
    if (body.length) headers['content-length'] = String(body.length)

    const upstream = http.request(
      { host: UPSTREAM_HOST, port: UPSTREAM_PORT, path: clientReq.url, method: clientReq.method, headers },
      (upRes) => {
        clientRes.writeHead(upRes.statusCode ?? 502, upRes.headers)
        const outChunks = []
        upRes.on('data', (c) => { outChunks.push(c); clientRes.write(c) })
        upRes.on('end', () => {
          clientRes.end()
          if (!isChat) return
          const n = ++seq
          const summary = summarize(body.toString('utf8'))
          const usage = usageFrom(Buffer.concat(outChunks).toString('utf8'))
          const record = { n, at: new Date().toISOString(), status: upRes.statusCode, usage, summary, request: body.toString('utf8') }
          fs.appendFileSync(outFile, JSON.stringify(record) + '\n')
          if (summary) {
            const pct = (x) => `${Math.round((x / summary.totalChars) * 100)}%`
            console.log(
              `#${n} ${summary.model} | msgs=${summary.messageCount} tools=${summary.toolCount} | ` +
              `system=${summary.systemChars}c (${pct(summary.systemChars)}) tools=${summary.toolsChars}c (${pct(summary.toolsChars)}) ` +
              `conversa=${summary.otherChars}c (${pct(summary.otherChars)}) | prompt_tokens=${usage?.prompt_tokens ?? '?'}`,
            )
          }
        })
      },
    )
    upstream.on('error', (err) => {
      console.error('upstream error:', err.message)
      if (!clientRes.headersSent) clientRes.writeHead(502)
      clientRes.end()
    })
    if (body.length) upstream.write(body)
    upstream.end()
  })
})

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(`proxy-log: 127.0.0.1:${LISTEN_PORT} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT}`)
  console.log(`gravando em ${outFile}`)
})
