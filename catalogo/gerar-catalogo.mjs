// Gera catalogo/plugins.json: o indice (formato 1) que a aba "Descubra" do dsh
// le para listar e instalar os plugins deste repositorio direto do GitHub.
//
//   node catalogo/gerar-catalogo.mjs [commit]
//
// O commit (padrao: HEAD) precisa estar no GitHub e conter as pastas dos
// plugins: cada versao do indice instala exatamente aquele commit. Fluxo para
// publicar plugin novo ou versao nova: commit e push dos plugins, depois este
// script, depois commit e push do plugins.json.
//
// Valida com o proprio validador do dsh (@deepseek-ai/dsh-plugin-market-index)
// antes de gravar.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..')
const REPO = 'https://github.com/atilacarpes96/Harness'
const URL_INDICE = 'https://raw.githubusercontent.com/atilacarpes96/Harness/main/catalogo/plugins.json'

function git(...args) {
  return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8' }).trim()
}

function icone(gradiente, desenho) {
  const [a, b] = gradiente
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>' +
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>` +
    `</defs><rect width="64" height="64" rx="14" fill="url(#g)"/>${desenho}</svg>`
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
}

const BRANCO = 'fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"'

const PLUGINS = [
  {
    pasta: 'plugins/meus-programas',
    titulo: { en: 'My programs', pt: 'Meus programas' },
    descricao: {
      en: 'Lists, opens and explains your programs and desktop shortcuts by name.',
      pt: 'Lista, abre e explica os seus programas e os atalhos da área de trabalho, pelo nome.',
    },
    categoria: 'programas',
    rotulos: ['local', 'windows'],
    palavras: ['programas', 'atalhos', 'abrir', 'apps', 'launcher'],
    icone: icone(['#42a5f5', '#3949ab'],
      '<g fill="#fff"><rect x="15" y="15" width="15" height="15" rx="4"/><rect x="34" y="15" width="15" height="15" rx="4"/>' +
      '<rect x="15" y="34" width="15" height="15" rx="4"/><rect x="34" y="34" width="15" height="15" rx="4" opacity=".6"/></g>'),
  },
  {
    pasta: 'plugins/gerador-imagens',
    titulo: { en: 'Image generator', pt: 'Gerador de Imagens' },
    descricao: {
      en: 'Generates images on your GPU with ComfyUI, shows them in the chat, and adds a ComfyUI button to the sidebar.',
      pt: 'Gera imagens na sua placa de vídeo com o ComfyUI, mostra no chat e põe o botão ComfyUI na barra lateral.',
    },
    categoria: 'programas',
    rotulos: ['gpu', 'local', 'interface'],
    palavras: ['imagem', 'comfyui', 'qwen', 'flux', 'anime', 'image'],
    icone: icone(['#7c4dff', '#1e88e5'],
      `<rect x="14" y="18" width="36" height="28" rx="5" ${BRANCO}/><circle cx="25" cy="27" r="3.5" fill="#fff"/>` +
      `<path d="M17 43l10-10 7 7 5-5 8 8" ${BRANCO}/>`),
  },
  {
    pasta: 'plugins/transcritor',
    titulo: { en: 'Transcriber', pt: 'Transcritor' },
    descricao: {
      en: 'Turns speech into text with local Whisper: YouTube, TikTok and Instagram links or audio files.',
      pt: 'Transforma fala em texto com o Whisper do PC: links do YouTube, TikTok e Instagram ou arquivos de áudio.',
    },
    categoria: 'programas',
    rotulos: ['gpu', 'local'],
    palavras: ['transcrever', 'whisper', 'youtube', 'audio', 'video', 'resumo'],
    icone: icone(['#1de9b6', '#00838f'],
      '<g fill="#fff"><rect x="15" y="27" width="4.5" height="10" rx="2.25"/><rect x="22.5" y="21" width="4.5" height="22" rx="2.25"/>' +
      '<rect x="30" y="15" width="4.5" height="34" rx="2.25"/><rect x="37.5" y="23" width="4.5" height="18" rx="2.25"/>' +
      '<rect x="45" y="28" width="4.5" height="8" rx="2.25"/></g>'),
  },
  {
    pasta: 'plugins/documentos',
    titulo: { en: 'Documents', pt: 'Documentos' },
    descricao: {
      en: 'Reads PDF, Word, Excel and PowerPoint files locally, in parts, so the agent can summarize them.',
      pt: 'Lê PDF, Word, Excel e PowerPoint sem nada sair do PC, em partes, para o agente resumir.',
    },
    categoria: 'programas',
    rotulos: ['local'],
    palavras: ['pdf', 'word', 'excel', 'documento', 'resumir', 'anydoc'],
    icone: icone(['#ffb300', '#f4511e'],
      '<path d="M20 12h17l11 11v29a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4V16a4 4 0 0 1 4-4z" fill="#fff"/>' +
      '<path d="M37 12v11h11" fill="none" stroke="#f4511e" stroke-width="3"/>' +
      '<g stroke="#f4511e" stroke-width="3" stroke-linecap="round"><line x1="23" y1="32" x2="41" y2="32"/>' +
      '<line x1="23" y1="39" x2="41" y2="39"/><line x1="23" y1="46" x2="34" y2="46"/></g>'),
  },
  {
    pasta: 'plugins/confirmar-perigoso',
    titulo: { en: 'Confirm risky actions', pt: 'Confirmar o que é perigoso' },
    descricao: {
      en: 'Full access for the agent, but it stops and asks before deleting, formatting, changing Windows, installing or git push.',
      pt: 'Acesso total para o agente, mas ele para e pergunta antes de apagar, formatar, mexer no Windows, instalar ou dar git push.',
    },
    categoria: 'seguranca',
    rotulos: ['local', 'windows'],
    palavras: ['seguranca', 'aprovacao', 'permissao', 'confirmar', 'safety'],
    icone: icone(['#ff5252', '#c2185b'],
      '<path d="M32 11l17 6v13c0 11-7 19-17 23-10-4-17-12-17-23V17z" fill="#fff"/>' +
      '<path d="M24 32l6 6 11-12" fill="none" stroke="#d81b60" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'),
  },
  {
    pasta: 'plugins/skins',
    titulo: { en: 'Skins', pt: 'Skins' },
    descricao: {
      en: 'Five Apple-style skins for the interface: Glass, Aurora, Sunset, Graphite and Paper.',
      pt: 'Cinco skins no estilo Apple para a interface: Vidro, Aurora, Pôr do sol, Grafite e Papel.',
    },
    categoria: 'interface',
    rotulos: ['interface'],
    palavras: ['tema', 'skin', 'vidro', 'apple', 'aparencia', 'theme'],
    icone: icone(['#f06292', '#7c4dff'],
      '<path d="M32 12c-11 0-20 8.5-20 19s8.5 19 18 19c3 0 4.5-2 4.5-4.2 0-2.3-2-3.2-2-5.3 0-2.6 2.2-4.3 5-4.3h4.5c6.2 0 10-4.3 10-9.5C52 18.5 43.5 12 32 12z" fill="#fff"/>' +
      '<circle cx="22.5" cy="29" r="3.6" fill="#7c4dff"/><circle cx="30.5" cy="20.5" r="3.6" fill="#00bfa5"/><circle cx="41" cy="23.5" r="3.6" fill="#ff9100"/>'),
  },
  {
    pasta: 'screen-tool',
    titulo: { en: 'Screen tool', pt: 'Ferramenta de tela' },
    descricao: {
      en: 'Lets the agent see and act on the Windows screen through the accessibility tree, with a Scroll Lock brake.',
      pt: 'Deixa o agente ver e agir na tela do Windows pela árvore de acessibilidade, com o freio do Scroll Lock.',
    },
    categoria: 'tela',
    rotulos: ['local', 'windows'],
    palavras: ['tela', 'clicar', 'digitar', 'janela', 'automacao', 'screen'],
    icone: icone(['#43a047', '#00897b'],
      `<rect x="12" y="14" width="40" height="28" rx="4" ${BRANCO}/><path d="M26 50h12" ${BRANCO}/>` +
      '<path d="M29 21l13 7.5-5.5 1.6 3.2 5.8-3.1 1.7-3.2-5.8-4.4 3.6z" fill="#fff"/>'),
  },
  {
    pasta: 'dsh-safe-developer',
    titulo: { en: 'Plugin checker', pt: 'Conferir plugin' },
    descricao: {
      en: 'Checks another local plugin (syntax, version, hash, dump-config) before you trust it.',
      pt: 'Confere outro plugin local (sintaxe, versão, hash, dump-config) antes de confiar nele.',
    },
    categoria: 'seguranca',
    rotulos: ['local'],
    palavras: ['plugin', 'validar', 'conferir', 'desenvolvedor'],
    icone: icone(['#78909c', '#455a64'],
      `<circle cx="32" cy="32" r="17" ${BRANCO}/><path d="M24 32l6 6 11-12" ${BRANCO}/>`),
  },
]

const commit = process.argv[2] ? git('rev-parse', process.argv[2]) : git('rev-parse', 'HEAD')
const quando = Number(git('show', '-s', '--format=%ct', commit))

const plugins = PLUGINS.map((p) => {
  const pacote = JSON.parse(readFileSync(join(RAIZ, p.pasta, 'package.json'), 'utf8'))
  // O commit tem que conter a pasta (senao a instalacao falha la na frente).
  git('cat-file', '-e', `${commit}:${p.pasta}/package.json`)
  return {
    name: pacote.name,
    title: p.titulo,
    description: p.descricao,
    icon: p.icone,
    author: 'atilacarpes96',
    homepage: `${REPO}/tree/main/${p.pasta}`,
    repository: { url: REPO, directory: p.pasta },
    metadata: { category: p.categoria, labels: p.rotulos, keywords: p.palavras },
    versions: [
      {
        version: pacote.version,
        publishTimestamp: quando,
        source: { type: 'git', url: REPO, commit, path: p.pasta },
      },
    ],
  }
})

const indice = {
  format: 1,
  title: { en: 'DSHARNESS plugins', pt: 'Plugins do DSHARNESS' },
  description: {
    en: 'Plugins that connect the local dsh agent to the programs on this PC: images, transcription, documents, screen and more.',
    pt: 'Plugins que ligam o agente local do dsh aos programas do PC: imagens, transcrição, documentos, tela e mais.',
  },
  metadata: {
    categories: {
      programas: { title: { en: 'Your programs', pt: 'Seus programas' } },
      tela: { title: { en: 'Screen', pt: 'Tela' } },
      seguranca: { title: { en: 'Safety', pt: 'Segurança' } },
      interface: { title: { en: 'Interface', pt: 'Interface' } },
    },
    labels: {
      gpu: { title: { en: 'Uses the GPU', pt: 'Usa a placa de vídeo' } },
      local: { title: { en: '100% local', pt: '100% local' } },
      windows: { title: { en: 'Windows only', pt: 'Só Windows' } },
      interface: { title: { en: 'Changes the interface', pt: 'Mexe na interface' } },
    },
  },
  plugins,
}

// Valida com o validador do dsh: o do projeto, se houver, ou o do dsh instalado.
const candidatos = [
  join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules',
    '@deepseek-ai', 'dsh-plugin-market-index', 'lib', 'index.js'),
]
const validador = candidatos.find((c) => existsSync(c))
if (validador) {
  const { parseMarketIndex } = await import(pathToFileURL(validador).href)
  parseMarketIndex(JSON.parse(JSON.stringify(indice)), URL_INDICE)
  console.log('validado pelo dsh: formato 1 ok')
} else {
  console.log('AVISO: validador do dsh nao encontrado; indice gravado sem validar')
}

writeFileSync(join(AQUI, 'plugins.json'), JSON.stringify(indice, null, 2) + '\n')
console.log(`catalogo/plugins.json: ${plugins.length} plugins, commit ${commit.slice(0, 7)}`)
console.log(`URL para a aba Descubra: ${URL_INDICE}`)
