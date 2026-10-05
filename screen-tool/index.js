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
// errado. Aqui o modelo so precisa julgar layout. Era 1024; em 04/10/2026 o
// usuario pediu precisao acima de rapidez e passou a 1280 (940 tokens, ainda
// com ~3k de folga no num_ctx 4096).
const VISION_WIDTH = 1280
const VISION_MODEL = 'qwen3.5:4b'
const VISION_NUM_CTX = 4096
const OLLAMA_URL = 'http://127.0.0.1:11434/api/chat'

// Teto de linhas de texto no resultado. 120 linhas ~ 1.4k tokens, que cabe
// folgado no dsh-4b:16k depois do prompt de sistema enxuto (3.5k de 16k).
const MAX_LINHAS_PADRAO = 120

const SEM_JANELA = Symbol('sem janela')

// A janela do PROPRIO agente. Existe porque o dsh roda numa aba do navegador,
// entao TUDO que o agente escreve e que o usuario digita vira texto NA TELA — e
// portanto vira alvo de clique. E uma armadilha que se retroalimenta: quanto
// mais o agente fala em "youtube", mais "youtube" aparece na tela para clicar.
//
// Medido na sessao session-9932b1ee (05/09/2026). O usuario pediu "entra em
// alguma das abas do youtube e da play no video". As abas de YouTube ESTAVAM
// abertas, mas o OCR corta o titulo delas ("NerdCast 1046 - Qual", "A Intemet
// Morreu") e a palavra "YouTube" nao sobrevive ao corte. O unico "youtube" na
// tela era a MENSAGEM DO USUARIO renderizada no chat. O agente clicou nela e
// anunciou que o video tinha comecado a tocar.
//
// O padrao casa com o titulo da janela. Para outro deploy, defina
// DSH_SCREEN_TOOL_JANELA_PROPRIA com uma expressao regular propria.
const PADRAO_JANELA_PROPRIA = /deepseek harness/i

function padraoJanelaPropria() {
  const bruto = process.env.DSH_SCREEN_TOOL_JANELA_PROPRIA
  if (!bruto) return PADRAO_JANELA_PROPRIA
  try {
    return new RegExp(bruto, 'i')
  } catch {
    return PADRAO_JANELA_PROPRIA
  }
}

export function ehJanelaPropria(janela) {
  const titulo = typeof janela === 'string' ? janela : janela?.titulo
  if (!titulo) return false
  return padraoJanelaPropria().test(String(titulo))
}

// Reaproveita janelaDaLinha tratando o ponto como uma linha de tamanho zero.
export function janelaEmPonto(janelas, x, y) {
  return janelaDaLinha({ x, y, w: 0, h: 0 }, janelas ?? [])
}

// Assinatura do estado visivel, para responder "mudou alguma coisa desde a
// ultima leitura?". Nao inclui `capturado_em`: o carimbo de tempo muda sempre e
// tornaria toda tela diferente da anterior. As linhas vao ordenadas para a
// comparacao nao depender da ordem em que o OCR devolveu.
//
// Um relogio visivel na tela (barra de tarefas, carimbo de mensagem) muda de
// minuto em minuto e faz a assinatura diferir sem nada ter mudado de verdade.
// Isso deixa a checagem CONSERVADORA — deixa passar as vezes, nunca acusa
// mudanca que nao houve — que e o erro certo a cometer aqui.
// A janela do proprio agente fica DE FORA da assinatura, e isso nao e detalhe:
// a conversa cresce na tela a cada passo — cada chamada de ferramenta vira uma
// linha nova no chat — entao a tela literalmente NUNCA fica igual, e a checagem
// nunca acusaria nada. Medido: duas leituras seguidas, sem tocar em nada,
// davam assinaturas diferentes so por causa do proprio log do agente.
//
// Conceitualmente e o certo tambem: o agente falar consigo mesmo nao e uma
// mudanca no programa que ele esta tentando controlar.
export function assinaturaDaTela(dados) {
  const janelas = (dados?.janelas ?? [])
    .filter((j) => !ehJanelaPropria(j))
    .map(
      (j) =>
        `${j.titulo}|${j.x},${j.y},${j.largura},${j.altura}` +
        `|${j.minimizada ? 1 : 0}|${j.em_foco ? 1 : 0}`,
    )
  const linhas = (dados?.ocr ?? [])
    .flatMap((b) => b.linhas ?? [])
    .filter((l) => !ehJanelaPropria(janelaDaLinha(l, dados?.janelas ?? [])))
    .map((l) => `${l.x},${l.y},${l.texto}`)
    .sort()
  return [...janelas, '--', ...linhas].join('\n')
}

// O Chrome anexa " – Utilizacao de memoria – 195 MB" ao nome da aba quando o
// economizador de memoria esta ligado. Esse sufixo muda a cada leitura, entao
// poluiria tanto a busca por nome quanto a assinatura da tela.
const SUFIXO_MEMORIA =
  /\s+[\u2013\u2014-]\s+(Utiliza[\u00e7c][\u00e3a]o de mem[\u00f3o]ria|Memory usage)\s+[\u2013\u2014-].*$/i

export function limparNomeAba(nome) {
  return String(nome ?? '').replace(SUFIXO_MEMORIA, '').trim()
}

// O Chrome escreve "audio em reproducao" no NOME da aba enquanto ela toca som,
// e tira quando pausa. Isso resolve a pergunta que o agente nao conseguia
// responder de jeito nenhum: "o play funcionou?".
//
// Medido na sessao session-7ceeaf4e: ele clicou no player, nao soube dizer se
// tinha tocado, clicou de novo — e ficou pausando e despausando o video. Estava
// tentando julgar isso por OCR e por um modelo de visao de 4B olhando um frame
// parado, que e justamente o que nao da para fazer: video pausado e video
// tocando sao a mesma imagem num instante qualquer.
const MARCA_TOCANDO = /[–—-]\s*(áudio em reprodução|audio playing|playing)/i

export function abaTocando(nome) {
  return MARCA_TOCANDO.test(String(nome ?? ''))
}

// O estado do player, lido da arvore de acessibilidade da PAGINA.
//
// Isto e o achado que resolve a queixa: o botao de play/pause do YouTube se
// chama "Pausa (k)" enquanto o video TOCA (clicar ali pausa) e "Reproduzir (k)"
// quando esta parado. O nome do botao E a resposta para "o play funcionou?".
// Medido ao vivo na aba do usuario: 791 elementos na arvore, e nas posicoes
// 28-30 estavam "Pausa (k)", "Sem audio (m)" e "24 Minutos 49 Segundos de 24
// Minutos 49 Segundos".
//
// Por que isso importa mais que parecer: na sessao session-7ceeaf4e o agente
// tentou julgar o play por OCR e por um modelo de visao olhando um frame
// parado, e ficou pausando e despausando. Video pausado e video tocando sao a
// mesma imagem num instante qualquer — a pergunta e inrespondivel por pixel, e
// trivial por aqui.
const BOTAO_PAUSAR = /^(pausar?|pause)\b/i
const BOTAO_TOCAR = /^(reproduzir|tocar|play)\b/i
// "24 Minutos 49 Segundos de 24 Minutos 49 Segundos" / "... of ...". Exige
// numero dos dois lados para nao casar com "pagina 3 de 10".
const POSICAO = /\d[^]*\s(?:de|of)\s[^]*\d/i

export function estadoDaMidia(elementos) {
  const botoes = (elementos ?? []).filter(
    (e) => e.tipo === 'Button' && e.habilitado && e.nome,
  )

  const pausar = botoes.find((e) => BOTAO_PAUSAR.test(e.nome))
  const tocar = botoes.find((e) => BOTAO_TOCAR.test(e.nome))
  const botao = pausar ?? tocar
  if (!botao) return null

  const posicao = botoes.find(
    (e) => e !== botao && POSICAO.test(e.nome) && /\d/.test(e.nome),
  )

  return {
    tocando: Boolean(pausar),
    nome: botao.nome,
    x: botao.x,
    y: botao.y,
    posicao: posicao ? posicao.nome : null,
  }
}

const PROCESSOS_NAVEGADOR = new Set([
  'chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'chromium',
])

export function ehNavegador(processo) {
  return PROCESSOS_NAVEGADOR.has(String(processo ?? '').toLowerCase())
}

// Estado entre chamadas, para as duas travas contra laco: "a tela nao mudou" e
// "voce ja tentou exatamente isso". Vive no modulo porque o plugin e uma
// instancia por sessao.
const estado = {
  assinatura: null,
  quando: null,
  janelas: [],
  abas: null,
  ultimoClique: null,
}

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

export function formatar(
  dados,
  { grupos, maxLinhas, visao, monitorFiltro, semMudancaHa = null, abas = null },
) {
  const out = []
  const v = dados.area_virtual

  out.push(`=== TELA em ${dados.capturado_em} ===`)
  // Na sessao de 04/10/2026 o modelo respondeu "o que ta aparecendo agora"
  // reciclando uma leitura de um minuto antes, e misturou o texto de uma janela
  // na descricao de outra. As duas linhas abaixo dizem isso na cara dele.
  out.push(
    'Esta leitura vale só para este instante; para outra pergunta sobre a tela, chame de novo.',
    'O texto de cada janela está no grupo dela: não atribua a uma janela texto de outro grupo.',
  )

  // Sem isto o modelo recebe a MESMA parede de texto de antes e conclui o que
  // quiser dela. Na sessao session-9932b1ee ele clicou seis vezes na mesma
  // coordenada, e depois de cada uma escreveu uma analise afirmando que a tela
  // tinha mudado. Nada tinha mudado; ele nao tinha como saber, porque ninguem
  // dizia. Dizer e barato e resolve.
  if (semMudancaHa != null) {
    out.push(
      `ATENCAO: a tela esta IDENTICA a leitura anterior (ha ${Math.round(semMudancaHa / 1000)}s).`,
      'O que voce fez entre uma leitura e outra NAO teve efeito visivel nenhum.',
      'Repetir a mesma acao vai dar o mesmo resultado. Mude de caminho:',
      '  analisar_tela com controles: "<titulo da janela>" lista o que da para',
      '  clicar de verdade, com o nome real do controle — o OCR corta nome longo.',
    )
  }

  out.push(
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
  // Janela aberta mas sem nenhuma linha de OCR esta coberta por outra (ou e
  // so imagem). Em 04/10/2026 o terminal do DSHARNESS estava inteiro atras do
  // Chrome maximizado, e o modelo descreveu "logs" nele com frases copiadas da
  // janela do Claude. Dizer que nao ha nada visivel ali corta a invencao.
  const comTexto = new Set(grupos.filter((g) => g.janela).map((g) => g.janela.ordem_z))
  for (const j of janelasVisiveis) {
    const marca = j.em_foco ? '* ' : '  '
    const onde = j.minimizada
      ? 'MINIMIZADA (sem posição na tela)'
      : `monitor ${j.monitor} em (${j.x},${j.y}) ${j.largura}x${j.altura}`
    const coberta = !j.minimizada && !comTexto.has(j.ordem_z)
      ? ' — COBERTA: nenhum texto dela aparece na tela; não descreva o conteúdo dela'
      : ''
    out.push(`${marca}"${j.titulo}" [${j.processo}] — ${onde}${coberta}`)
  }
  out.push('  (* = janela em foco)')

  // Aba de navegador nao e janela: o Windows so enxerga UMA janela do Chrome,
  // com o titulo da aba ativa. As outras abas existem so na arvore de
  // acessibilidade. E o OCR nao salva: ele le a tira de abas, mas cortada na
  // largura da aba — "NerdCast 1046 - Qual" — entao o nome do site nunca
  // aparece. Pedir "entra numa aba do youtube" era impossivel de cumprir sem
  // esta secao.
  if (abas?.lista?.length) {
    out.push('', `ABAS em "${abas.janela}" (${abas.lista.length})`)
    for (const a of abas.lista) {
      out.push(`  "${a.nome}" em (${a.x},${a.y})`)
    }
    out.push(
      '  Para trocar de aba use interagir_tela clicar_elemento com o nome da aba,',
      '  e NAO clicar_texto: o OCR corta o titulo da aba e nunca acha o nome do site.',
    )
    if (abas.lista.some((a) => abaTocando(a.nome))) {
      out.push(
        '  A aba marcada "audio em reproducao" ESTA tocando agora. Use isso para',
        '  conferir se o play funcionou — a imagem da tela nao responde isso.',
      )
    }
  }

  if (abas?.midia) {
    const m = abas.midia
    out.push(
      '',
      `MIDIA na aba ativa: ${m.tocando ? 'TOCANDO AGORA' : 'PARADA'}`,
      `  botao "${m.nome}" em (${m.x},${m.y}) — clicar ali ${m.tocando ? 'PAUSA' : 'DA PLAY'}`,
    )
    if (m.posicao) out.push(`  posicao: ${m.posicao}`)
    out.push(
      '  Confira o play POR AQUI, nao pela imagem: video parado e video tocando',
      '  sao a mesma foto num instante qualquer. O nome do botao e que muda.',
    )
  }

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
    // A janela do proprio dsh mostra as respostas antigas do modelo. Em
    // 04/10/2026, com ela na frente, o modelo leu pelo OCR a descricao que ele
    // mesmo tinha dado um minuto antes e a repetiu como se fosse a tela de
    // agora — com o mesmo erro de digitacao. O texto dela nao entra.
    if (ehJanelaPropria(g.janela)) {
      out.push(
        `  -- ${titulo} — janela desta conversa; texto omitido de propósito.`,
        '     O que aparece nela são as suas próprias mensagens: não use como leitura da tela.',
      )
      continue
    }
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
            'Use sempre que o usuário perguntar o que aparece ou como está a tela; ' +
            'para só listar janelas ou achar um texto, o OCR basta.',
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
        // Terceira variante da armadilha do reflexo. Na sessao session-7ceeaf4e
        // o modelo pediu os controles de "YouTube Video Playback Guide", que
        // era a ABA DO PROPRIO DSH, recebeu so a moldura do navegador e
        // concluiu — por escrito — que "o Chrome nao expoe os elementos
        // internos da pagina via arvore de acessibilidade". Conclusao errada, e
        // cara: era justamente o caminho que resolvia a tarefa. Recusar aqui
        // evita a conclusao errada melhor do que devolver a lista inutil.
        if (ehJanelaPropria(janelaControles)) {
          return [
            `"${janelaControles}" e a janela do PROPRIO dsh. Nao listei os controles:`,
            'seriam os controles da sua propria conversa, e nao do programa que voce',
            'quer controlar. Pior, a lista viria so com a moldura do navegador e',
            'daria a impressao de que a pagina nao expoe nada — o que e falso.',
            'Peca os controles da janela do alvo. Veja a lista JANELAS de analisar_tela.',
          ].join('\n')
        }

        const el = await lerElementos(janelaControles)
        if (el.erro) {
          return `${el.erro}\nJanelas abertas: ${(el.janelas_abertas ?? []).join(' | ')}`
        }
        if (ehJanelaPropria(el.janela)) {
          return [
            `"${janelaControles}" casou com "${el.janela}", que e a janela do PROPRIO dsh.`,
            'Nao listei: seriam os controles da sua propria conversa.',
            'Peca pelo titulo da janela do alvo, da lista JANELAS de analisar_tela.',
          ].join('\n')
        }

        const acionaveis = (el.elementos ?? []).filter(
          (e) => e.habilitado && e.nome && TIPOS_ACIONAVEIS.has(e.tipo),
        )
        const lista = acionaveis
          .slice(0, MAX_CONTROLES_LISTADOS)
          .map((e) => `  "${e.nome}" (id: ${e.id}, ${e.tipo}) em (${e.x},${e.y})`)
        const cortados = acionaveis.length - lista.length
        const midia = estadoDaMidia(el.elementos)
        return [
          `CONTROLES de "${el.janela}" — ${acionaveis.length} acionáveis`,
          'Use a ação clicar_elemento com o nome ou, de preferência, o id.',
          ...(midia
            ? [
                `MIDIA: ${midia.tocando ? 'TOCANDO' : 'PARADA'} — botao "${midia.nome}"` +
                  `${midia.posicao ? `, posicao ${midia.posicao}` : ''}`,
              ]
            : []),
          ...lista,
          ...(cortados > 0
            ? [`  [...] ${cortados} controles omitidos. Procure pelo nome com clicar_elemento.`]
            : []),
        ].join('\n')
      }

      const dados = await inspecionar({ comVisao })
      const grupos = agruparTexto(dados)

      const assinatura = assinaturaDaTela(dados)
      const igual = estado.assinatura !== null && assinatura === estado.assinatura
      const semMudancaHa = igual && estado.quando ? Date.now() - estado.quando : null
      estado.assinatura = assinatura
      estado.quando = Date.now()
      // Guardado para a trava de clique saber, sem custar outra leitura de
      // tela, qual janela esta sob a coordenada que o modelo quer clicar.
      estado.janelas = dados.janelas ?? []

      const abas = await lerAbas(dados)
      estado.abas = abas

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
        semMudancaHa,
        abas,
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
// Teto da VARREDURA. O padrao do elements.ps1 e 300, e uma pagina do YouTube
// tem 435 elementos que passam no filtro de tipo — medido ao vivo. Cortar a
// varredura perde alvo real; o que precisa de teto e a SAIDA, que e o que
// consome contexto, e essa e limitada em construirFerramenta.
const MAX_ELEMENTOS = 600

// Tipos que valem listar para quem vai AGIR. Group, Pane e Image entulham a
// lista de uma pagina web sem oferecer nada para clicar.
const TIPOS_ACIONAVEIS = new Set([
  'Button', 'Hyperlink', 'Edit', 'CheckBox', 'RadioButton',
  'ComboBox', 'MenuItem', 'TabItem', 'ListItem', 'Slider',
])

const MAX_CONTROLES_LISTADOS = 120

async function lerElementos(janela) {
  const saida = join(SAIDA_DIR, 'elementos.json')
  await mkdir(SAIDA_DIR, { recursive: true })
  const args = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', ELEMENTS_PS1, '-Janela', janela, '-Out', saida,
    '-Max', String(MAX_ELEMENTOS),
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

// As abas do navegador, pela arvore de acessibilidade. Custo medido no
// elements.ps1: ~90ms para achar a janela e ~50ms para varrer.
//
// Pega o navegador mais a frente na ordem-Z, e nao a janela em foco: quando o
// usuario pede "entra numa aba do youtube", quem esta em foco e justamente a
// janela do dsh, onde ele digitou o pedido. Exigir foco aqui deixaria a secao
// vazia exatamente na hora em que ela e necessaria.
async function lerAbas(dados) {
  const frente = (dados?.janelas ?? [])
    .filter((j) => !j.minimizada && ehNavegador(j.processo))
    .sort((a, b) => a.ordem_z - b.ordem_z)[0]
  if (!frente) return null
  let el
  try {
    el = await lerElementos(frente.titulo)
  } catch {
    // Abas sao um extra: se a arvore falhar, a leitura de tela continua valendo.
    return null
  }
  // Nem todo TabItem e aba do navegador: a propria PAGINA usa TabItem para os
  // seus proprios controles. Medido ao vivo numa aba do YouTube, a arvore
  // devolvia "Todos", "Relacionados" e "Enviados recentemente" — chips DENTRO
  // do video — misturados com as 12 abas de verdade. Publicar isso mandaria o
  // modelo tentar "trocar para a aba Relacionados".
  //
  // A tira de abas fica colada no topo da janela; controle de pagina, nao. 80px
  // cobre a tira inteira (41px de altura) com folga, e nada abaixo dela.
  const limiteTira = (frente.y ?? 0) + 80
  const lista = (el?.elementos ?? [])
    .filter((e) => e.tipo === 'TabItem' && e.y < limiteTira)
    .map((e) => ({ nome: limparNomeAba(e.nome), x: e.x, y: e.y }))
    .filter((e) => e.nome)
  const midia = estadoDaMidia(el?.elementos)
  if (!lista.length && !midia) return null
  return { janela: el.janela ?? frente.titulo, lista, midia }
}

// Casa por AutomationId exato primeiro: é o identificador estável, e não muda
// com o idioma do Windows. Só depois tenta o nome visível.
// Página web expõe o MESMO alvo várias vezes na árvore — um link costuma
// aparecer como ListItem e como Hyperlink, no mesmo pixel. Sem juntar, toda
// busca numa página vira "ambíguo" e a automação trava sem motivo real.
// Mesma coordenada e mesmo nome = mesma coisa; fica o tipo mais acionável.
const PRIORIDADE_TIPO = ['Button', 'Hyperlink', 'Edit', 'CheckBox', 'RadioButton', 'ComboBox', 'MenuItem', 'TabItem', 'ListItem', 'Text']

function juntarDuplicados(lista) {
  const porLugar = new Map()
  for (const e of lista) {
    const chave = `${e.x},${e.y},${normalizar(e.nome)}`
    const atual = porLugar.get(chave)
    if (!atual) {
      porLugar.set(chave, e)
      continue
    }
    const posAtual = PRIORIDADE_TIPO.indexOf(atual.tipo)
    const posNovo = PRIORIDADE_TIPO.indexOf(e.tipo)
    const melhorAtual = posAtual === -1 ? 99 : posAtual
    const melhorNovo = posNovo === -1 ? 99 : posNovo
    if (melhorNovo < melhorAtual) porLugar.set(chave, e)
  }
  return [...porLugar.values()]
}

export function acharElemento(elementos, procurado) {
  const alvo = normalizar(procurado)
  const porId = elementos.filter((e) => e.id && normalizar(e.id) === alvo)
  if (porId.length) return juntarDuplicados(porId)
  const nomeExato = elementos.filter((e) => normalizar(e.nome) === alvo)
  if (nomeExato.length) return juntarDuplicados(nomeExato)
  return juntarDuplicados(
    elementos.filter(
      (e) => normalizar(e.nome).includes(alvo) || (e.id && normalizar(e.id).includes(alvo)),
    ),
  )
}

// Fecha o laço agir -> conferir sem passar pelo OCR. Importa porque o OCR erra
// exatamente onde a conferência precisa acertar: número, campo curto, símbolo.
async function lerElemento(args) {
  const procurado = String(args?.texto ?? '').trim()
  const janela = String(args?.janela_esperada ?? '').trim()
  if (!janela) return 'Erro: informe em `janela_esperada` a janela onde ler.'

  const dados = await lerElementos(janela)
  if (dados.erro) {
    return `${dados.erro}\nJanelas abertas: ${(dados.janelas_abertas ?? []).join(' | ')}`
  }
  const todos = dados.elementos ?? []

  // Sem alvo, devolve tudo que tem conteúdo: serve para descobrir de onde ler.
  if (!procurado) {
    const comConteudo = todos.filter((e) => e.valor || e.tipo === 'Text')
    if (comConteudo.length === 0) return `Nenhum controle com conteúdo em "${dados.janela}".`
    return [
      `CONTEÚDO de "${dados.janela}"`,
      ...comConteudo.map((e) => `  ${e.id || e.nome} = ${JSON.stringify(e.valor ?? e.nome)}`),
    ].join('\n')
  }

  const achados = acharElemento(todos, procurado)
  if (achados.length === 0) {
    return `Não há controle "${procurado}" em "${dados.janela}".`
  }
  if (achados.length > 1) {
    return [
      `"${procurado}" casa com ${achados.length} controles:`,
      ...achados.slice(0, 10).map((e) => `  "${e.nome}" (id: ${e.id})`),
      'Repita usando o id, que é exato.',
    ].join('\n')
  }

  const e = achados[0]
  const conteudo = e.valor ?? e.nome
  return `"${e.nome || e.id}" (${e.tipo}) = ${JSON.stringify(conteudo)}`
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
  const todosAchados = acharTexto(dados, procurado, filtro)

  // O texto que o proprio agente escreveu esta na tela e casa com a busca. Se
  // sobrar so isso, clicar seria conversar com o proprio reflexo — foi
  // exatamente o que aconteceu na sessao session-9932b1ee. Separar em vez de
  // filtrar em silencio: o modelo precisa entender POR QUE nao clicou, senao
  // tenta de novo com outra palavra e cai na mesma armadilha.
  const proprios = todosAchados.filter((a) => ehJanelaPropria(a.janela))
  const achados = todosAchados.filter((a) => !ehJanelaPropria(a.janela))

  if (achados.length === 0 && proprios.length > 0) {
    return [
      `NAO CLIQUEI. As ${proprios.length} ocorrencias de "${procurado}" na tela estao`,
      `todas dentro de "${proprios[0].janela?.titulo ?? 'janela do agente'}" — que e a`,
      'janela do PROPRIO dsh. Isso e a sua conversa aparecendo na tela, nao o alvo:',
      'a mensagem do usuario e as suas proprias respostas viram texto clicavel.',
      '',
      'Clicar ali nao faz nada no programa que voce quer controlar.',
      'Para agir de verdade:',
      '  1. analisar_tela — veja a secao ABAS e a lista de janelas.',
      '  2. analisar_tela com controles: "<titulo da janela>" — nomes reais dos controles.',
      '  3. interagir_tela clicar_elemento com esse nome.',
    ].join('\n')
  }

  // O filtro `janela_esperada` pode ter comido tudo. Isso ficava invisivel: a
  // resposta dizia "Nao encontrei X na tela" e logo abaixo listava o proprio X
  // em "textos parecidos" — contraditorio, e mandava o modelo caçar erro de OCR
  // que nao existia. Medido na sessao session-7ceeaf4e: 4 buscas assim, todas
  // porque ele passou o nome da ABA em janela_esperada, e nenhuma janela tem
  // esse titulo.
  if (achados.length === 0 && filtro) {
    const semFiltro = acharTexto(dados, procurado, '').filter((a) => !ehJanelaPropria(a.janela))
    if (semFiltro.length) {
      const dica = dicaDeAba(filtro, estado.abas)
      return [
        `Nao cliquei. "${procurado}" ESTA na tela, mas nenhuma ocorrencia fica dentro`,
        `de uma janela cujo titulo contenha "${filtro}" — e esse foi o seu filtro.`,
        'Onde o texto realmente esta:',
        ...semFiltro
          .slice(0, 6)
          .map((a) => `  (${a.x},${a.y}) em "${a.janela?.titulo ?? 'fora de janela'}" — ${a.texto}`),
        dica ? `\n${dica}` : 'Repita sem janela_esperada, ou com parte do titulo de uma janela acima.',
      ].join('\n')
    }
  }

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
  if (args?.substituir === true) ps.push('-Substituir')

  const esperada = typeof args?.janela_esperada === 'string' ? args.janela_esperada.trim() : ''
  if (esperada) ps.push('-JanelaEsperada', esperada)

  const semConfirmacao = ACOES_QUE_MUDAM.has(acao) && !esperada
  if (args?.simular === true || semConfirmacao) ps.push('-Simular')

  return { acao, ps, semConfirmacao }
}

// Aba nao e janela, e o modelo insiste em tratar como se fosse: manda `focar`
// ou `janela_esperada` com o nome da ABA. Isso nunca casa com titulo de janela
// nenhum, e ele repete ate desistir.
//
// Medido na sessao session-7ceeaf4e: 14 chamadas de `focar` com nome de aba,
// mais 4 cliques abortados pelo mesmo motivo — o erro dominante da sessao. Pior
// que o desperdicio: a mensagem que ele recebia no clique era "a tela mudou
// entre perceber e agir", que aponta para a causa errada. A tela nao tinha
// mudado; ele e que tinha nomeado uma aba onde se pede uma janela.
//
// Devolve a dica pronta, com a coordenada do centro da aba, ou null.
export function dicaDeAba(nome, abas) {
  const alvo = normalizar(nome)
  if (alvo.length < 4 || !abas?.lista?.length) return null

  const casa = abas.lista.filter((a) => {
    const n = normalizar(a.nome)
    return n.includes(alvo) || alvo.includes(n)
  })
  if (!casa.length) return null

  return [
    `"${nome}" nao e uma JANELA — e uma ABA do navegador.`,
    'Aba nao tem janela propria: o Windows enxerga UMA janela do navegador, com o',
    'titulo da aba ativa. Por isso focar por nome de aba nunca vai funcionar.',
    'Para trocar de aba, CLIQUE nela — a coordenada ja e o centro da aba:',
    ...casa
      .slice(0, 5)
      .map(
        (a) =>
          `  interagir_tela clicar x=${a.x} y=${a.y} ` +
          `janela_esperada="${abas.janela}"   -> "${a.nome}"`,
      ),
  ].join('\n')
}

// As duas recusas de clique, isoladas do resto para poderem ser testadas sem
// mover o mouse de ninguem. Devolve o texto da recusa, ou null para deixar
// passar. `janelas` e `assinatura` vem da ultima leitura de tela — que e
// justamente o que o modelo olhou para escolher a coordenada.
export function motivoParaNaoClicar({ x, y, janelas, assinatura, ultimoClique }) {
  // 1) Clicar na propria conversa. Mesma razao do clicar_texto, agora para
  // coordenada crua: depois que o clicar_texto recusa, o caminho seguinte do
  // modelo e pegar o x/y de um dos candidatos e clicar direto. Na sessao
  // session-9932b1ee foi assim que ele acertou a propria mensagem do usuario.
  // Sem leitura de tela previa nao ha o que conferir, e o clique passa.
  const alvo = janelaEmPonto(janelas, x, y)
  if (alvo && ehJanelaPropria(alvo)) {
    return [
      `NAO CLIQUEI. (${x},${y}) cai dentro de "${alvo.titulo}", que e a janela do`,
      'PROPRIO dsh — voce estaria clicando na sua propria conversa, e nao no',
      'programa que quer controlar.',
      'Veja a secao ABAS e a lista de JANELAS da ultima leitura, escolha o alvo',
      'certo, e prefira: analisar_tela com controles: "<janela>" e clicar_elemento.',
    ].join('\n')
  }

  // 2) Laco. Dispara so quando as DUAS coisas valem: e exatamente o mesmo
  // clique, e a tela esta como estava quando ele foi dado. Se a tela mudou,
  // repetir pode ser legitimo e passa. Na sessao medida o mesmo clique em
  // (1120,945) saiu seis vezes seguidas com a tela parada.
  if (
    ultimoClique &&
    ultimoClique.chave === `clicar:${x},${y}` &&
    assinatura != null &&
    ultimoClique.assinatura === assinatura
  ) {
    return [
      `NAO CLIQUEI. Voce ja clicou em (${x},${y}) e a tela continua identica.`,
      'O mesmo clique vai dar o mesmo resultado: nenhum.',
      'Pare de repetir e mude de abordagem:',
      '  analisar_tela com controles: "<titulo da janela>" da o nome real do',
      '  controle, e clicar_elemento acerta o alvo que a coordenada erra.',
      'Se nao souber como seguir, pergunte ao usuario com ask_user_question.',
    ].join('\n')
  }

  return null
}

// As acoes que a camada de controle (act.ps1) entende. As outras — as que
// resolvem no JS — sao despachadas antes de chegar aqui.
const ACOES_DO_CONTROLE = new Set([
  'mover', 'clicar', 'digitar', 'teclas', 'rolar', 'focar',
])

async function executarAcao(args) {
  const { acao, ps, semConfirmacao } = montarArgumentos(args)
  if (!acao) return 'Erro: informe a ação (mover, clicar, digitar, teclas, rolar).'

  // Sem isto uma acao inventada vazava o erro cru do PowerShell, em portugues
  // com acento quebrado e citando o caminho do act.ps1 — ilegivel para o modelo
  // e sem dizer o que fazer. Visto na sessao session-7ceeaf4e com
  // acao: "ver_tela", que e o nome da OUTRA ferramenta.
  if (!ACOES_DO_CONTROLE.has(acao)) {
    return [
      `Não existe a ação "${acao}" em interagir_tela.`,
      'Ações válidas: clicar_elemento, ler_elemento, clicar_texto, esperar,',
      'focar, mover, clicar, digitar, teclas, rolar.',
      'Para OBSERVAR a tela use a outra ferramenta, analisar_tela — não é uma ação daqui.',
    ].join('\n')
  }

  if (acao === 'clicar' && Number.isFinite(args?.x) && Number.isFinite(args?.y)) {
    const x = Math.round(args.x)
    const y = Math.round(args.y)
    const recusa = motivoParaNaoClicar({ x, y, ...estado })
    if (recusa) return recusa
    estado.ultimoClique = { chave: `clicar:${x},${y}`, assinatura: estado.assinatura }
  }

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

  if (dados.erro) {
    const dica = dicaDeAba(args?.janela_esperada, estado.abas)
    return dica
      ? `AÇÃO NÃO REALIZADA. ${dados.erro}\n\n${dica}`
      : `AÇÃO NÃO REALIZADA. ${dados.erro}`
  }

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
            'clicar_elemento', 'ler_elemento', 'clicar_texto', 'esperar', 'focar',
            'mover', 'clicar', 'digitar', 'teclas', 'rolar',
          ],
          description:
            'clicar_elemento: clica um controle pelo nome ou id (use `texto` e `janela_esperada`). ' +
            'ler_elemento: le o conteudo exato de um controle, para conferir o efeito de uma acao ' +
            '(use `janela_esperada`; sem `texto` lista tudo que tem conteudo). ' +
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
        substituir: {
          type: 'boolean',
          description:
            'Em digitar: apagar o que já está no campo antes de escrever. ' +
            'Use sempre que o campo puder ter conteúdo, como barra de endereço — ' +
            'clicar posiciona o cursor mas não seleciona, e o texto sairia concatenado.',
        },
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
      if (args?.acao === 'ler_elemento') return lerElemento(args)
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
