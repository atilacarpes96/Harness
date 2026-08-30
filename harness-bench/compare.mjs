import { parseArgs } from 'node:util'
import { readFile, appendFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const OLLAMA_URL = 'http://127.0.0.1:11434/api/chat'
const TAGS_URL = 'http://127.0.0.1:11434/api/tags'

const DEFAULT_MODELS = [
  'qwen3-vl:8b',
  'qwen3.5:4b',
  'qwen2.5vl:3b',
]

function parseArgv() {
  const { values } = parseArgs({
    options: {
      prompt: { type: 'string', short: 'p' },
      image: { type: 'string', short: 'i' },
      models: { type: 'string', short: 'm' },
      all: { type: 'boolean', default: false },
      think: { type: 'boolean', default: false },
      out: { type: 'string', default: 'harness-bench/results/run.jsonl' },
      list: { type: 'boolean', default: false },
    },
  })

  return values
}

async function listModels() {
  const res = await fetch(TAGS_URL)
  const data = await res.json()

  return data.models.map((model) => model.name)
}

async function callModel(model, prompt, imageBase64, think) {
  const message = { role: 'user', content: prompt }

  if (imageBase64) {
    message.images = [imageBase64]
  }

  const wallStart = performance.now()

  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [message],
      stream: false,
      think,
      keep_alive: '5m',
    }),
  })

  const wallS = (performance.now() - wallStart) / 1000

  if (!res.ok) {
    const detail = await res.text()

    throw new Error(`HTTP ${res.status}: ${detail.slice(0, 300)}`)
  }

  const data = await res.json()

  const loadS = (data.load_duration ?? 0) / 1e9
  const promptEvalS = (data.prompt_eval_duration ?? 0) / 1e9
  const evalS = (data.eval_duration ?? 0) / 1e9
  const evalTokens = data.eval_count ?? 0

  return {
    model,
    ok: true,
    wall_s: wallS,
    load_s: loadS,
    ttft_proxy_s: loadS + promptEvalS,
    prompt_tokens: data.prompt_eval_count ?? 0,
    eval_s: evalS,
    eval_tokens: evalTokens,
    total_s: (data.total_duration ?? 0) / 1e9,
    tokens_per_s: evalS > 0 ? evalTokens / evalS : null,
    done_reason: data.done_reason,
    response_preview: String(data.message?.content ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 400),
  }
}

function formatTable(rows) {
  const cols = [
    ['model', 24],
    ['load_s', 8],
    ['ttft_proxy_s', 13],
    ['eval_s', 8],
    ['total_s', 9],
    ['eval_tokens', 12],
    ['tokens_per_s', 13],
  ]

  const header = cols.map(([key, width]) => key.padEnd(width)).join(' ')

  const lines = rows.map((row) => {
    if (!row.ok) {
      return `${row.model.padEnd(24)} ERRO: ${row.error}`
    }

    return cols
      .map(([key, width]) => {
        const value = row[key]
        const isInt = key === 'eval_tokens'
        const text =
          typeof value === 'number'
            ? value.toFixed(isInt ? 0 : 2)
            : String(value ?? '')

        return text.padEnd(width)
      })
      .join(' ')
  })

  return [header, '-'.repeat(header.length), ...lines].join('\n')
}

async function main() {
  const args = parseArgv()

  if (args.list) {
    const models = await listModels()
    console.log(models.join('\n'))
    return
  }

  if (!args.prompt) {
    console.error(
      'Uso: node compare.mjs --prompt "..." [--image caminho.png] ' +
        '[--models a,b,c] [--all] [--think] [--out arquivo.jsonl]\n' +
        '      node compare.mjs --list   (lista modelos instalados no Ollama)',
    )
    process.exitCode = 1
    return
  }

  let models

  if (args.all) {
    models = await listModels()
  } else if (args.models) {
    models = args.models
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean)
  } else {
    models = DEFAULT_MODELS
  }

  let imageBase64 = null

  if (args.image) {
    const bytes = await readFile(resolve(args.image))
    imageBase64 = bytes.toString('base64')
  }

  const results = []

  for (const model of models) {
    process.stderr.write(`Rodando ${model}...\n`)

    try {
      results.push(
        await callModel(model, args.prompt, imageBase64, args.think),
      )
    } catch (error) {
      results.push({
        model,
        ok: false,
        error: String(error?.message ?? error),
      })
    }
  }

  console.log(formatTable(results))

  const outPath = resolve(args.out)
  await mkdir(dirname(outPath), { recursive: true })

  const record = {
    timestamp: new Date().toISOString(),
    prompt: args.prompt,
    image: args.image ?? null,
    think: args.think,
    results,
  }

  await appendFile(outPath, `${JSON.stringify(record)}\n`, 'utf8')
  process.stderr.write(`\nResultados salvos em ${outPath}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
