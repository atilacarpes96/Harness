import { execFile } from 'node:child_process'
import { readFile, rm, stat } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const SCREENSHOT_PATH = 'E:\\DSHARNESS\\screenshot-tool.png'
const MIN_SCREENSHOT_BYTES = 10_000
const VISION_MODEL = 'qwen3.5:4b'
const OLLAMA_URL = 'http://127.0.0.1:11434/api/chat'

const VISION_SCHEMA = {
  type: 'object',
  properties: {
    resumo: {
      type: 'string',
      description: 'Resumo geral em uma frase curta.',
    },
    janelas: {
      type: 'string',
      description: 'Até três janelas, resumidas em uma única frase.',
    },
    textos_relevantes: {
      type: 'string',
      description: 'No máximo cinco textos relevantes, em uma frase.',
    },
    observacoes: {
      type: 'string',
      description: 'Uma observação visual curta ou string vazia.',
    },
  },
  required: [
    'resumo',
    'janelas',
    'textos_relevantes',
    'observacoes',
  ],
  additionalProperties: false,
}

export const name = 'screen-analyzer'
export const inject = ['tools']

function limitText(value, maxLength) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function normalizeVisionResult(value) {
  return {
    resumo: limitText(value?.resumo, 300),
    janelas: limitText(value?.janelas, 500),
    textos_relevantes: limitText(
      value?.textos_relevantes,
      300,
    ),
    observacoes: limitText(value?.observacoes, 200),
  }
}

async function validateScreenshot() {
  let info

  try {
    info = await stat(SCREENSHOT_PATH)
  } catch {
    throw new Error(`A captura não foi criada em ${SCREENSHOT_PATH}.`)
  }

  if (!info.isFile()) {
    throw new Error(
      `O caminho da captura não é um arquivo: ${SCREENSHOT_PATH}`,
    )
  }

  if (info.size < MIN_SCREENSHOT_BYTES) {
    throw new Error(
      `A captura foi rejeitada porque possui apenas ${info.size} bytes. ` +
        `O mínimo exigido é ${MIN_SCREENSHOT_BYTES} bytes.`,
    )
  }

  return info.size
}

async function capturePrimaryScreen() {
  await rm(SCREENSHOT_PATH, { force: true })

  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$arquivo = "E:\\DSHARNESS\\screenshot-tool.png"

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap(
    $bounds.Width,
    $bounds.Height,
    [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)

try {
    $graphics.CopyFromScreen(
        $bounds.X,
        $bounds.Y,
        0,
        0,
        $bounds.Size,
        [System.Drawing.CopyPixelOperation]::SourceCopy
    )
    $bitmap.Save($arquivo, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}

if (-not (Test-Path -LiteralPath $arquivo)) {
    throw "A captura não foi criada."
}
`

  await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      ps,
    ],
    {
      windowsHide: true,
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    },
  )

  return validateScreenshot()
}

function buildVisionPrompt(question) {
  return [
    'Analise exclusivamente a imagem fornecida.',
    'Responda somente com o objeto JSON solicitado.',
    'Use no máximo 100 palavras no total.',
    'Cada campo deve conter somente uma frase curta.',
    'Não crie listas, subtópicos ou objetos adicionais.',
    'Não transcreva menus ou listas extensas.',
    'Não repita palavras ou informações.',
    'Informe somente fatos claramente visíveis.',
    'Responda em português do Brasil.',
    `Solicitação: ${question}`,
    `Esquema JSON: ${JSON.stringify(VISION_SCHEMA)}`,
  ].join('\n')
}

async function askVision(question) {
  const bytes = await readFile(SCREENSHOT_PATH)
  const imageBase64 = bytes.toString('base64')

  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: buildVisionPrompt(question),
          images: [imageBase64],
        },
      ],
      format: VISION_SCHEMA,
      stream: false,
      keep_alive: -1,
      think: false,
      options: {
        num_ctx: 4096,
        num_predict: 1024,
        temperature: 0,
        repeat_last_n: 256,
        repeat_penalty: 1.2,
      },
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(
      `Ollama respondeu HTTP ${response.status}: ${detail}`,
    )
  }

  const data = await response.json()
  const answer = String(data.message?.content ?? '').trim()

  if (!answer) {
    throw new Error('O modelo visual retornou uma resposta vazia.')
  }

  if (data.done_reason === 'length') {
    throw new Error(
      'O modelo visual atingiu o limite antes de concluir o JSON.',
    )
  }

  let parsed

  try {
    parsed = JSON.parse(answer)
  } catch {
    throw new Error(
      'O modelo visual retornou um JSON inválido.',
    )
  }

  return JSON.stringify(normalizeVisionResult(parsed), null, 2)
}

function buildAnalisarTelaTool(name) {
  return {
    name,
    description:
      'Captura a tela principal do Windows e solicita uma análise estruturada ao modelo local qwen3.5:4b. Apenas observa: não move o mouse, não clica e não digita.',
    parameters: {
      type: 'object',
      properties: {
        pergunta: {
          type: 'string',
          description:
            'O que deve ser identificado na tela.',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [
        { type: 'text', text: value },
      ],
    },
    timeoutMs: 120_000,
    async execute(args) {
      const question =
        typeof args?.pergunta === 'string' &&
        args.pergunta.trim()
          ? args.pergunta.trim()
          : 'Descreva objetivamente as janelas e os principais elementos visíveis.'

      const screenshotBytes = await capturePrimaryScreen()
      const analysis = await askVision(question)

      return [
        `Captura: ${SCREENSHOT_PATH}`,
        `Tamanho da captura: ${screenshotBytes} bytes`,
        `Modelo visual: ${VISION_MODEL}`,
        '',
        '=== EVIDÊNCIA VISUAL BRUTA ===',
        analysis,
        '=== FIM DA EVIDÊNCIA VISUAL ===',
      ].join('\n')
    },
  }
}

// Modelos menores (ex. qwen3-vl:4b-instruct) variam a forma que inventam
// pro nome da ferramenta em vez de usar "analisar_tela" literalmente.
// Cobre as variações observadas em vez de perseguir uma de cada vez.
const TOOL_NAME_ALIASES = [
  'analisar_tela',
  'analise_tela',
  'analises_tela',
  'analisa_tela',
  'ver_tela',
  'capturar_tela',
]

export function apply(ctx) {
  for (const name of TOOL_NAME_ALIASES) {
    ctx.tools.register(buildAnalisarTelaTool(name))
  }
}