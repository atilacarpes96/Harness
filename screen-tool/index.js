import { execFile } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const AQUI = dirname(fileURLToPath(import.meta.url))
const INSPECT_PS1 = join(AQUI, 'inspect.ps1')
const ACT_PS1 = join(AQUI, 'act.ps1')
const ELEMENTS_PS1 = join(AQUI, 'elements.ps1')
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
        controles: {
          type: 'string',
          description:
            'Título de uma janela: lista os controles clicáveis dela (nome, id e posição), ' +
            'pela árvore de acessibilidade. Use antes de clicar_elemento, para saber o que existe.',
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

      const janelaControles =
        typeof args?.controles === 'string' && args.controles.trim()
          ? args.controles.trim()
          : null
      if (janelaControles) {
        const el = await lerElementos(janelaControles)
        if (el.erro) {
          return `${el.erro}\nJanelas abertas: ${(el.janelas_abertas ?? []).join(' | ')}`
        }
        const lista = (el.elementos ?? [])
          .filter((e) => e.habilitado)
          .map((e) => `  "${e.nome}" (id: ${e.id}, ${e.tipo}) em (${e.x},${e.y})`)
        return [
          `CONTROLES de "${el.janela}" — ${lista.length} clicáveis`,
          'Use a ação clicar_elemento com o nome ou, de preferência, o id.',
          ...lista,
        ].join('\n')
      }

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

// Ações que mudam o estado da máquina. Para estas, agir sem dizer o que se
// espera encontrar no alvo é proibido: ver a tela e agir são chamadas
// separadas, e entre uma e outra a tela pode ter mudado. Sem `janela_esperada`
// a chamada vira simulação e devolve o que encontraria — o modelo confirma
// repetindo a chamada com o título que acabou de ler. Fica impossível clicar
// às cegas por construção, em vez de por boa vontade.
const ACOES_QUE_MUDAM = new Set(['clicar', 'digitar', 'teclas'])

// Comparação tolerante: o OCR troca acento e caixa com frequência, e exigir
// igualdade exata faria a automação falhar por causa de um "ç" mal lido.
export function normalizar(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Todas as linhas de OCR que contêm o texto procurado, com a janela de cada uma.
export function acharTexto(dados, procurado, filtroJanela) {
  const alvo = normalizar(procurado)
  if (!alvo) return []
  const janela = filtroJanela ? normalizar(filtroJanela) : null
  const achados = []

  // Busca curta exige igualdade, não "contém". Medido na Calculadora: procurar
  // "+" casava com "tvl+" — o botão de MEMÓRIA que o OCR leu errado — e o
  // clique iria para o controle errado sem nenhum aviso. Para um ou dois
  // caracteres, "contém" acerta por acidente com frequência demais.
  const exigeExato = alvo.length <= 2

  for (const bloco of dados.ocr) {
    for (const linha of bloco.linhas) {
      const texto = normalizar(linha.texto)
      if (exigeExato ? texto !== alvo : !texto.includes(alvo)) continue
      const j = janelaDaLinha(linha, dados.janelas)
      if (janela && !normalizar(j?.titulo).includes(janela)) continue
      achados.push({
        texto: linha.texto,
        // Centro da linha: é onde um humano clicaria, e onde o controle está.
        x: linha.x + Math.round(linha.w / 2),
        y: linha.y + Math.round(linha.h / 2),
        janela: j,
      })
    }
  }
  return achados
}

// A árvore de acessibilidade do Windows. É melhor que o OCR onde mais importa:
// botão de símbolo. Na Calculadora, procurar "+" por OCR casava com "tvl+" — o
// botão de MEMÓRIA mal lido — e "=" não era encontrado. Aqui vêm "Mais" e
// "Igual a", com retângulo exato.
async function lerElementos(janela) {
  const saida = join(SAIDA_DIR, 'elementos.json')
  await mkdir(SAIDA_DIR, { recursive: true })
  const args = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', ELEMENTS_PS1, '-Janela', janela, '-Out', saida,
  ]
  try {
    await execFileAsync('powershell.exe', args, {
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    })
  } catch {
    // O script sai com código 1 quando não acha a janela, mas grava o motivo.
  }
  const dados = JSON.parse(await readFile(saida, 'utf8'))
  if (Array.isArray(dados.elementos)) return dados
  if (dados.elementos) return { ...dados, elementos: [dados.elementos] }
  return dados
}

// Casa por AutomationId exato primeiro: é o identificador estável, e não muda
// com o idioma do Windows. Só depois tenta o nome visível.
export function acharElemento(elementos, procurado) {
  const alvo = normalizar(procurado)
  const porId = elementos.filter((e) => normalizar(e.id) === alvo)
  if (porId.length) return porId
  const nomeExato = elementos.filter((e) => normalizar(e.nome) === alvo)
  if (nomeExato.length) return nomeExato
  return elementos.filter(
    (e) => normalizar(e.nome).includes(alvo) || normalizar(e.id).includes(alvo),
  )
}

async function clicarElemento(args) {
  const procurado = String(args?.texto ?? '').trim()
  const janela = String(args?.janela_esperada ?? '').trim()
  if (!procurado) return 'Erro: informe em `texto` o nome ou o id do controle.'
  if (!janela) return 'Erro: informe em `janela_esperada` a janela onde procurar o controle.'

  const dados = await lerElementos(janela)
  if (dados.erro) {
    return `${dados.erro}\nJanelas abertas: ${(dados.janelas_abertas ?? []).join(' | ')}`
  }

  const todos = dados.elementos ?? []
  const achados = acharElemento(todos, procurado).filter((e) => e.habilitado)

  if (achados.length === 0) {
    const amostra = todos
      .filter((e) => e.habilitado && e.nome)
      .slice(0, 20)
      .map((e) => `  "${e.nome}"${e.id ? ` (id: ${e.id})` : ''}`)
    return [
      `Não há controle "${procurado}" em "${dados.janela}". Nada foi clicado.`,
      'Controles disponíveis:',
      ...amostra,
    ].join('\n')
  }

  if (achados.length > 1) {
    return [
      `"${procurado}" casa com ${achados.length} controles. NÃO cliquei.`,
      ...achados.slice(0, 10).map((e) => `  "${e.nome}" (id: ${e.id}) em (${e.x},${e.y})`),
      'Repita usando o id, que é exato.',
    ].join('\n')
  }

  const alvo = achados[0]
  const resultado = await executarAcao({
    acao: 'clicar',
    x: alvo.x,
    y: alvo.y,
    botao: args?.botao,
    duplo: args?.duplo,
    simular: args?.simular,
    janela_esperada: janela,
  })
  return `Controle: "${alvo.nome}" (id: ${alvo.id}, ${alvo.tipo}) em (${alvo.x},${alvo.y}).\n${resultado}`
}

// Sem isto toda automação é uma corrida: clica, e o passo seguinte acontece
// antes da interface responder. Sondar pela árvore de acessibilidade custa
// ~0,14s por ciclo contra ~2,6s do OCR, então quando a janela é conhecida a
// espera vai pelo caminho rápido.
async function esperar(args) {
  const alvo = String(args?.texto ?? '').trim()
  if (!alvo) return 'Erro: informe em `texto` o que esperar aparecer.'

  const janela = String(args?.janela_esperada ?? '').trim()
  const sumir = args?.sumir === true
  const limite = Number.isFinite(args?.segundos)
    ? Math.min(Math.max(Math.round(args.segundos), 1), 120)
    : 15

  const inicio = Date.now()
  const viaControles = Boolean(janela)
  let ciclos = 0
  let ultimo = null

  while ((Date.now() - inicio) / 1000 < limite) {
    ciclos++
    let presente = false
    if (viaControles) {
      const el = await lerElementos(janela)
      if (el.erro) {
        // A janela ainda pode estar abrindo: não é erro enquanto houver tempo.
        ultimo = el.erro
      } else {
        presente = acharElemento(el.elementos ?? [], alvo).some((e) => e.habilitado)
        ultimo = null
      }
    } else {
      const dados = await inspecionar({ comVisao: false })
      presente = acharTexto(dados, alvo).length > 0
    }

    if (presente !== sumir) {
      const s = ((Date.now() - inicio) / 1000).toFixed(1)
      return sumir
        ? `"${alvo}" sumiu depois de ${s}s (${ciclos} verificações).`
        : `"${alvo}" apareceu depois de ${s}s (${ciclos} verificações). Pode seguir.`
    }
  }

  const s = ((Date.now() - inicio) / 1000).toFixed(1)
  return [
    `Desisti depois de ${s}s: "${alvo}" ${sumir ? 'continua na tela' : 'não apareceu'}.`,
    ultimo ? `Última leitura: ${ultimo}` : '',
    viaControles
      ? 'Confira com analisar_tela {"controles": "<janela>"} o que existe de verdade.'
      : 'Confira com analisar_tela o que está na tela.',
  ]
    .filter(Boolean)
    .join('\n')
}

async function clicarEmTexto(args) {
  const procurado = String(args?.texto ?? '').trim()
  if (!procurado) return 'Erro: informe em `texto` o que deve ser clicado.'

  const dados = await inspecionar({ comVisao: false })
  const filtro = typeof args?.janela_esperada === 'string' ? args.janela_esperada.trim() : ''
  const achados = acharTexto(dados, procurado, filtro)

  if (achados.length === 0) {
    // Devolver vizinhança ajuda mais que só dizer "não achei": quase sempre o
    // texto está lá com uma letra trocada pelo OCR.
    const todas = dados.ocr.flatMap((b) => b.linhas)
    const parecidas = todas
      .filter((l) => {
        const n = normalizar(l.texto)
        return normalizar(procurado)
          .split(' ')
          .some((p) => p.length > 2 && n.includes(p))
      })
      .slice(0, 8)
      .map((l) => `  (${l.x},${l.y}) ${l.texto}`)
    return [
      `Não encontrei "${procurado}" na tela. Nada foi clicado.`,
      parecidas.length ? 'Textos parecidos que estão visíveis:' : 'Nenhum texto parecido visível.',
      ...parecidas,
    ].join('\n')
  }

  if (achados.length > 1) {
    return [
      `"${procurado}" aparece ${achados.length} vezes. NÃO cliquei — escolher por conta seria clicar às cegas.`,
      'Candidatos:',
      ...achados
        .slice(0, 10)
        .map((a, i) => `  ${i + 1}. (${a.x},${a.y}) em "${a.janela?.titulo ?? 'fora de janela'}" — ${a.texto}`),
      'Repita com janela_esperada para restringir, ou use a ação "clicar" com x/y de um destes.',
    ].join('\n')
  }

  const alvo = achados[0]
  const resultado = await executarAcao({
    acao: 'clicar',
    x: alvo.x,
    y: alvo.y,
    botao: args?.botao,
    duplo: args?.duplo,
    simular: args?.simular,
    // O clique já é verificado pelo próprio texto estar ali; a janela entra
    // como segunda checagem, no momento do clique.
    janela_esperada: alvo.janela?.titulo ?? 'Program Manager',
  })
  return `Alvo: "${alvo.texto}" em (${alvo.x},${alvo.y}), dentro de "${alvo.janela?.titulo ?? 'área de trabalho'}".\n${resultado}`
}

// Pura, para poder ser testada sem mover o mouse de ninguém.
export function montarArgumentos(args) {
  const acao = String(args?.acao ?? '').trim()
  const ps = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ACT_PS1, '-Acao', acao]

  const num = (v) => (Number.isFinite(v) ? Math.round(v) : null)
  const x = num(args?.x)
  const y = num(args?.y)
  if (x !== null) ps.push('-X', String(x))
  if (y !== null) ps.push('-Y', String(y))
  if (args?.texto) ps.push('-Texto', String(args.texto))
  if (args?.teclas) ps.push('-Teclas', String(args.teclas))
  if (Number.isFinite(args?.quantidade)) ps.push('-Quantidade', String(Math.round(args.quantidade)))
  if (args?.botao) ps.push('-Botao', String(args.botao))
  if (args?.duplo === true) ps.push('-Duplo')

  const esperada = typeof args?.janela_esperada === 'string' ? args.janela_esperada.trim() : ''
  if (esperada) ps.push('-JanelaEsperada', esperada)

  const semConfirmacao = ACOES_QUE_MUDAM.has(acao) && !esperada
  if (args?.simular === true || semConfirmacao) ps.push('-Simular')

  return { acao, ps, semConfirmacao }
}

async function executarAcao(args) {
  const { acao, ps, semConfirmacao } = montarArgumentos(args)
  if (!acao) return 'Erro: informe a ação (mover, clicar, digitar, teclas, rolar).'

  let saida
  try {
    const r = await execFileAsync('powershell.exe', ps, {
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    })
    saida = r.stdout
  } catch (e) {
    // act.ps1 sai com código 1 quando aborta, e o json do motivo vem no stdout.
    saida = e.stdout || ''
    if (!saida.trim()) return `Erro ao executar a ação: ${e.message}`
  }

  let dados
  try {
    dados = JSON.parse(String(saida).trim().split('\n').pop())
  } catch {
    return `Resposta ilegível da camada de controle: ${String(saida).slice(0, 400)}`
  }

  if (dados.erro) return `AÇÃO NÃO REALIZADA. ${dados.erro}`

  if (semConfirmacao) {
    return [
      `AÇÃO NÃO REALIZADA — falta confirmar o alvo.`,
      `No alvo está a janela: "${dados.janela_no_alvo}"`,
      `Se é essa mesmo, repita a chamada incluindo janela_esperada com parte desse título.`,
      `Isso existe porque entre ver a tela e agir ela pode ter mudado.`,
    ].join('\n')
  }

  if (dados.simulado) {
    return `Simulação: nada foi feito. No alvo está a janela "${dados.janela_no_alvo}".`
  }

  const linhas = [`Ação "${acao}" realizada.`]
  if (dados.cursor_em) linhas.push(`Cursor em (${dados.cursor_em[0]},${dados.cursor_em[1]}).`)
  if (dados.caracteres != null) linhas.push(`${dados.caracteres} caracteres digitados.`)
  if (dados.combinacao) linhas.push(`Combinação enviada: ${dados.combinacao}.`)
  linhas.push(`Janela em foco depois: "${dados.janela_em_foco_depois}".`)
  linhas.push('Confira o efeito com analisar_tela antes da próxima ação.')
  return linhas.join('\n')
}

function construirFerramentaAcao() {
  return {
    name: 'interagir_tela',
    description:
      'Age na tela. Ordem de preferência: "clicar_elemento" (usa a árvore de acessibilidade ' +
      'do Windows — é a mais confiável, e a única que acerta botão de símbolo como + ou =), ' +
      'depois "clicar_texto" (acha o texto na tela), e só então coordenada crua. ' +
      'Use "focar" para trazer uma janela para frente antes de digitar nela. Para "clicar", ' +
      '"digitar" e "teclas" é obrigatório informar janela_esperada; sem isso a chamada ' +
      'apenas simula e informa o que encontrou no alvo.',
    parameters: {
      type: 'object',
      properties: {
        acao: {
          type: 'string',
          enum: [
            'clicar_elemento', 'clicar_texto', 'esperar', 'focar',
            'mover', 'clicar', 'digitar', 'teclas', 'rolar',
          ],
          description:
            'clicar_elemento: clica um controle pelo nome ou id (use `texto` e `janela_esperada`). ' +
            'clicar_texto: acha o texto na tela e clica nele (use `texto`). ' +
            'esperar: aguarda algo aparecer antes de seguir (use `texto`). ' +
            'focar: traz uma janela para frente (use `janela_esperada`).',
        },
        x: { type: 'integer', description: 'Coordenada X do alvo (mover, clicar, rolar).' },
        y: { type: 'integer', description: 'Coordenada Y do alvo (mover, clicar, rolar).' },
        texto: {
          type: 'string',
          description:
            'O que digitar (digitar), o texto a procurar na tela (clicar_texto), ' +
            'ou o nome/id do controle (clicar_elemento).',
        },
        teclas: {
          type: 'string',
          description: 'Combinação, por exemplo "ctrl+s", "enter", "shift+end" (ação teclas).',
        },
        quantidade: {
          type: 'integer',
          description: 'Entalhes de rolagem; negativo rola para baixo (ação rolar).',
        },
        botao: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Botão do mouse.' },
        duplo: { type: 'boolean', description: 'Clique duplo.' },
        janela_esperada: {
          type: 'string',
          description:
            'Parte do título da janela. Obrigatório para clicar, digitar, teclas e focar. ' +
            'Em clicar_texto é opcional, e serve para desempatar quando o texto aparece em vários lugares.',
        },
        segundos: {
          type: 'integer',
          description: 'Tempo máximo de espera, em segundos (ação esperar). Padrão 15.',
        },
        sumir: {
          type: 'boolean',
          description: 'Na ação esperar, aguardar o texto DESAPARECER em vez de aparecer.',
        },
        simular: { type: 'boolean', description: 'Só dizer o que faria, sem fazer.' },
      },
      required: ['acao'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: 120_000,
    execute: (args) => {
      if (args?.acao === 'clicar_elemento') return clicarElemento(args)
      if (args?.acao === 'clicar_texto') return clicarEmTexto(args)
      if (args?.acao === 'esperar') return esperar(args)
      return executarAcao(args)
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
  ctx.tools.register(construirFerramentaAcao())
}
