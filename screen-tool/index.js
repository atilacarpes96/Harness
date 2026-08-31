import { execFile } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const AQUI = dirname(fileURLToPath(import.meta.url))
const INSPECT_PS1 = join(AQUI, 'inspect.ps1')
const SAIDA_DIR = join(tmpdir(), 'dsh-screen-tool')

// Largura da copia entregue ao modelo de visao. Custo em tokens de imagem,
// medido no qwen3.5:4b: 1024px=596, 1280px=940, 1920px=2060, 2560px=3620.
// A versao anterior mandava a tela inteira (3620) dentro de num_ctx 4096 e
// sobravam ~245 tokens para a resposta — dai a descricao vaga e o texto lido
// errado. Aqui o modelo so precisa julgar layout, entao 1024 basta.
const VISION_WIDTH = 1024
const VISION_MODEL = 'qwen3.5:4b'
const VISION_NUM_CTX = 4096
const OLLAMA_URL = 'http://127.0.0.1:11434/api/chat'

// Teto de linhas de texto no resultado. 120 linhas ~ 1.4k tokens, que cabe
// folgado no dsh-4b:16k depois do prompt de sistema enxuto (3.5k de 16k).
const MAX_LINHAS_PADRAO = 120

const SEM_JANELA = Symbol('sem janela')

export const name = 'screen-analyzer'
export const inject = ['tools']

async function inspecionar({ comVisao }) {
  await mkdir(SAIDA_DIR, { recursive: true })

  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    INSPECT_PS1,
    '-OutDir',
    SAIDA_DIR,
    '-Ocr',
  ]
  if (comVisao) args.push('-VisionWidth', String(VISION_WIDTH))

  await execFileAsync('powershell.exe', args, {
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  })

  const bruto = await readFile(join(SAIDA_DIR, 'inspect.json'), 'utf8')
  const dados = JSON.parse(bruto)

  // ConvertTo-Json colapsa lista de um elemento em objeto solto.
  const lista = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])
  dados.monitores = lista(dados.monitores)
  dados.janelas = lista(dados.janelas)
  dados.ocr = lista(dados.ocr).map((o) => ({ ...o, linhas: lista(o.linhas) }))
  return dados
}

// Qual janela contem o centro da linha de texto. EnumWindows entrega em ordem-Z
// da frente para tras, entao a de menor `ordem_z` e a que esta por cima — e e
// dela o texto que aparece de fato na tela.
export function janelaDaLinha(linha, janelas) {
  const cx = linha.x + linha.w / 2
  const cy = linha.y + linha.h / 2
  let melhor = null
  for (const j of janelas) {
    if (j.minimizada || j.x == null) continue
    if (cx < j.x || cx > j.x + j.largura) continue
    if (cy < j.y || cy > j.y + j.altura) continue
    if (!melhor || j.ordem_z < melhor.ordem_z) melhor = j
  }
  return melhor
}

export function agruparTexto(dados) {
  const grupos = new Map()

  for (const bloco of dados.ocr) {
    for (const linha of bloco.linhas) {
      if (!String(linha.texto ?? '').trim()) continue
      const j = janelaDaLinha(linha, dados.janelas)
      // SEM_JANELA e simbolo, e nao string, para nao poder colidir com uma
      // ordem_z convertida em texto.
      const chave = j ? `${j.ordem_z}` : SEM_JANELA
      if (!grupos.has(chave)) grupos.set(chave, { janela: j, linhas: [] })
      grupos.get(chave).linhas.push(linha)
    }
  }

  for (const g of grupos.values()) {
    // Ordem de leitura: de cima para baixo, da esquerda para a direita.
    g.linhas.sort((a, b) => (a.y - b.y) || (a.x - b.x))
  }

  return [...grupos.values()].sort((a, b) => {
    if (!a.janela) return 1
    if (!b.janela) return -1
    return a.janela.ordem_z - b.janela.ordem_z
  })
}

async function descreverComVisao(arquivo, pergunta) {
  const imagem = (await readFile(arquivo)).toString('base64')

  // O texto da tela ja vem do OCR com coordenada exata. Pedir transcricao aqui
  // so desperdicaria contexto e produziria erro de leitura — o que este modelo
  // acrescenta e julgamento visual: layout, estado, cor, o que chama atencao.
  // "Não transcreva" sozinho não segurou: o modelo continuou citando texto que
  // não existe na tela (inventou nome de ferramenta e mensagem de erro que não
  // estavam ali). Proibir aspas explicitamente zerou as citações nos dois
  // modelos testados.
  const prompt = [
    'Você recebe a captura reduzida de um monitor.',
    'PROIBIDO citar, transcrever ou adivinhar qualquer texto da tela: outro sistema já leu',
    'todo o texto com precisão, e uma citação sua que discorde dele vira erro.',
    'Não escreva nenhuma palavra entre aspas.',
    'Descreva SOMENTE: como a tela está dividida em áreas, que tipo de aplicação ocupa cada',
    'área, e sinais visuais de estado (erro, carregamento, seleção, mídia em reprodução).',
    'Máximo de 60 palavras, em português do Brasil, sem listas.',
    pergunta ? `Dê atenção especial a: ${pergunta}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const resposta = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [{ role: 'user', content: prompt, images: [imagem] }],
      stream: false,
      think: false,
      keep_alive: '5m',
      options: {
        num_ctx: VISION_NUM_CTX,
        num_predict: 300,
        temperature: 0,
      },
    }),
  })

  if (!resposta.ok) {
    return `(visão indisponível: Ollama respondeu HTTP ${resposta.status})`
  }

  const dados = await resposta.json()
  const texto = String(dados.message?.content ?? '').trim()
  if (!texto) return '(visão indisponível: resposta vazia)'

  const gastou = dados.prompt_eval_count ?? 0
  return `${texto}\n(imagem custou ${gastou} tokens de ${VISION_NUM_CTX})`
}

export function formatar(dados, { grupos, maxLinhas, visao, monitorFiltro }) {
  const out = []
  const v = dados.area_virtual

  out.push(
    `=== TELA em ${dados.capturado_em} ===`,
    `Área virtual: ${v.largura}x${v.altura} a partir de (${v.x},${v.y}); ${dados.monitores.length} monitor(es).`,
    'Todas as coordenadas abaixo são da área virtual, prontas para uso direto.',
    '',
    'MONITORES',
  )
  for (const m of dados.monitores) {
    out.push(
      `  [${m.indice}] ${m.largura}x${m.altura} em (${m.x},${m.y})` +
        `${m.principal ? ' — principal' : ''}`,
    )
  }

  out.push('', 'JANELAS (da frente para trás)')
  const janelasVisiveis = dados.janelas.filter(
    (j) => monitorFiltro == null || j.monitor === monitorFiltro || j.minimizada,
  )
  if (janelasVisiveis.length === 0) out.push('  (nenhuma)')
  for (const j of janelasVisiveis) {
    const marca = j.em_foco ? '* ' : '  '
    const onde = j.minimizada
      ? 'MINIMIZADA (sem posição na tela)'
      : `monitor ${j.monitor} em (${j.x},${j.y}) ${j.largura}x${j.altura}`
    out.push(`${marca}"${j.titulo}" [${j.processo}] — ${onde}`)
  }
  out.push('  (* = janela em foco)')

  const totalLinhas = grupos.reduce((n, g) => n + g.linhas.length, 0)
  out.push('', `TEXTO NA TELA (${totalLinhas} linhas lidas por OCR)`)

  let restante = maxLinhas
  for (const g of grupos) {
    if (restante <= 0) break
    if (
      monitorFiltro != null &&
      g.janela &&
      g.janela.monitor !== monitorFiltro
    ) {
      continue
    }
    const titulo = g.janela
      ? `dentro de "${g.janela.titulo}"`
      : 'fora de qualquer janela (área de trabalho, barra de tarefas)'
    out.push(`  -- ${titulo} — ${g.linhas.length} linhas`)
    for (const l of g.linhas.slice(0, restante)) {
      out.push(`     (${l.x},${l.y}) ${l.texto}`)
    }
    restante -= g.linhas.length
  }
  if (totalLinhas > maxLinhas) {
    out.push(
      `  [...] ${totalLinhas - maxLinhas} linhas omitidas pelo limite de ${maxLinhas}.`,
    )
  }

  if (visao) {
    out.push(
      '',
      'IMPRESSÃO VISUAL — vem de um modelo de 4B e pode errar. O texto exato da',
      'tela está na seção acima; onde as duas discordarem, vale o OCR.',
      ...visao,
    )
  }

  out.push('', `Capturas em: ${SAIDA_DIR}`)
  return out.join('\n')
}

function construirFerramenta(nomeFerramenta) {
  return {
    name: nomeFerramenta,
    description:
      'Observa a tela e devolve o que está acontecendo: todos os monitores, ' +
      'as janelas abertas com título, processo e retângulo exatos, e o texto ' +
      'lido por OCR com a coordenada de cada linha, agrupado pela janela que o ' +
      'contém. Só observa: não move o mouse, não clica e não digita.',
    parameters: {
      type: 'object',
      properties: {
        pergunta: {
          type: 'string',
          description: 'O que interessa saber na tela. Opcional.',
        },
        monitor: {
          type: 'integer',
          description:
            'Índice do monitor a examinar. Omita para examinar todos.',
        },
        visao: {
          type: 'boolean',
          description:
            'Também pedir ao modelo visual uma leitura de layout e estado. ' +
            'Mais lento; o texto da tela já vem do OCR sem isso.',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: 120_000,
    async execute(args) {
      const pergunta =
        typeof args?.pergunta === 'string' && args.pergunta.trim()
          ? args.pergunta.trim()
          : ''
      const comVisao = args?.visao === true
      const monitorFiltro =
        Number.isInteger(args?.monitor) && args.monitor >= 0
          ? args.monitor
          : null

      const dados = await inspecionar({ comVisao })
      const grupos = agruparTexto(dados)

      let visao = null
      if (comVisao) {
        visao = []
        for (const m of dados.monitores) {
          if (monitorFiltro != null && m.indice !== monitorFiltro) continue
          const arquivo = m.arquivo_visao || m.arquivo
          if (!arquivo) continue
          visao.push(`  monitor ${m.indice}: ${await descreverComVisao(arquivo, pergunta)}`)
        }
      }

      return formatar(dados, {
        grupos,
        maxLinhas: MAX_LINHAS_PADRAO,
        visao,
        monitorFiltro,
      })
    },
  }
}

// Modelos menores erravam o nome da ferramenta, e a resposta na época foi
// registrar 6 apelidos. Em 31/08/2026 descobrimos que o motivo real era outro:
// o Ollama rodava com num_ctx 4096 e truncava ~76% do prompt, então o modelo
// muitas vezes nem via a lista de ferramentas inteira. Com o contexto correto
// (dsh-4b:16k) o nome literal passou a ser acertado.
//
// Cada apelido custa ~400 chars de schema em TODA chamada, então sobrou só um
// segundo nome — "ver_tela" é o que mais aparecia — como rede de segurança.
const APELIDOS = ['analisar_tela', 'ver_tela']

export function apply(ctx) {
  for (const nomeFerramenta of APELIDOS) {
    ctx.tools.register(construirFerramenta(nomeFerramenta))
  }
}
