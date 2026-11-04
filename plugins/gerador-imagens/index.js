// Plugin: gerar imagem no Gerador de Imagens (ComfyUI local) a partir do chat.
//
// Quem faz o trabalho e o gerar.py do proprio Gerador (sobe o ComfyUI se
// precisar e devolve um JSON). Aqui so escolhemos os argumentos, liberamos a
// placa de video antes e depois, e devolvemos os caminhos das imagens.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  acharPython,
  ferramenta,
  fimDoLog,
  limparCaminho,
  liberarComfy,
  liberarOllama,
  pastaDoPrograma,
  rodar,
  ultimaLinhaJson,
} from './comum.js'
import {
  abrirPainel,
  avisoDepoisDaImagem,
  desligarComfy,
  estadoComfy,
  lerPreferencias,
  SEGUNDOS_A_MAIS_PARA_LIGAR,
} from './comfy.js'

export const name = 'gerador-imagens'
export const inject = ['tools']

const PASTA = process.env.GERADOR_DIR || pastaDoPrograma('Gerador de Imagens')
const SCRIPT = join(PASTA, 'gerar.py')

// Nomes curtos para o modelo pequeno acertar; o gerar.py usa os nomes da tela.
const MODELOS = {
  qwen: 'Qwen Image 2.1',
  'qwen-rapido': 'Qwen Image 2.1 Rápido',
  flux: 'Flux.2 Klein 4B',
  anime: 'Animagine XL 4.0',
}

// Os mesmos formatos do cartao de ajustes do Gerador (o Animagine tem os seus).
const FORMATOS = {
  quadrado: { padrao: '1024x1024', anime: '1024x1024' },
  retrato: { padrao: '896x1152', anime: '832x1216' },
  paisagem: { padrao: '1152x896', anime: '1216x832' },
}

async function gerar(args, exec) {
  const pedido = String(args?.pedido ?? '').trim()
  if (!pedido) return 'Faltou dizer o que desenhar (campo "pedido").'
  if (!existsSync(SCRIPT)) return `Não achei o Gerador de Imagens em ${PASTA}.`

  const chave = MODELOS[args?.modelo] ? args.modelo : 'qwen'
  const quantidade = Math.min(4, Math.max(1, Number.parseInt(args?.quantidade ?? 1, 10) || 1))
  const refs = (Array.isArray(args?.referencias) ? args.referencias : [])
    .map(limparCaminho)
    .filter(Boolean)
  for (const r of refs) {
    if (!existsSync(r)) return `Não achei a imagem de referência: ${r}`
  }
  // O "Melhorar prompt" do Gerador (LLM local, ~5 s) reescreve o pedido no
  // formato do modelo. Ligado por padrao: em 03/11/2026 "farol numa praia"
  // direto no Qwen virou um poste de luz; reescrito, virou um farol.
  const melhorar = typeof args?.melhorar === 'boolean' ? args.melhorar : true

  const cmd = [SCRIPT, '--prompt', pedido, '--modelo', MODELOS[chave], '--quantidade', String(quantidade)]
  const formato = FORMATOS[args?.formato]
  if (formato && refs.length === 0) {
    cmd.push('--tamanho', chave === 'anime' ? formato.anime : formato.padrao)
  }
  for (const r of refs) cmd.push('--ref', r)
  if (melhorar) cmd.push('--melhorar')

  const python = await acharPython()
  await liberarOllama()
  let r
  try {
    r = await rodar(python, cmd, { cwd: PASTA, signal: exec?.signal })
  } finally {
    // Devolve a placa para o modelo do agente, que recarrega na proxima resposta.
    // Com "desligar depois de cada imagem" ligado no painel, fecha o ComfyUI.
    if ((await lerPreferencias()).desligarDepois) await desligarComfy(PASTA)
    else await liberarComfy()
  }

  const j = ultimaLinhaJson(r.saida)
  if (!j) {
    return `O Gerador terminou sem resposta (código ${r.codigo}). Fim do registro:\n${fimDoLog(r.erros)}`
  }
  if (!j.ok) return `Não deu para gerar: ${j.erro}`

  // A interface do dsh mostra ![...](caminho local) como imagem no chat.
  const linhas = [
    `Pronto: ${j.imagens.length} imagem(ns) com ${j.modelo} em ${Math.round(j.segundos)} s.`,
    'Para o usuário ver, copie para a sua resposta estas linhas, exatamente como estão:',
    ...j.imagens.map((c, i) => `![imagem ${i + 1}](${c})`),
    'Você não viu a imagem: não descreva o conteúdo dela. Diga só o que foi gerado e onde ficou salvo.',
  ]
  if (j.prompt && j.prompt !== pedido) linhas.push(`Prompt usado (reescrito): ${j.prompt}`)
  linhas.push(
    'Os arquivos ficam na pasta "remoto" da saída do ComfyUI; a limpeza automática do Gerador manda para a Lixeira depois de alguns dias.',
    `Diga também ao usuário: ${avisoDepoisDaImagem(await estadoComfy({ fresco: true }))}`,
  )
  return linhas.join('\n')
}

async function comfyui(args, exec) {
  if (args?.acao === 'desligar') {
    const r = await desligarComfy(PASTA, exec?.signal)
    return r.ok
      ? `${r.mensagem} A próxima imagem vai levar cerca de 1 minuto a mais, porque o ComfyUI precisa ligar de novo.`
      : r.mensagem
  }
  const e = await estadoComfy({ fresco: true })
  if (!e.ligado) {
    return `O ComfyUI está desligado. A próxima imagem liga ele sozinha (cerca de ${SEGUNDOS_A_MAIS_PARA_LIGAR} s a mais).`
  }
  const ram = e.ramMB ? `, ocupando ~${(e.ramMB / 1024).toFixed(1).replace('.', ',')} GB de RAM` : ''
  const auto = e.desligarDepois ? ' A opção "desligar depois de cada imagem" está ligada.' : ''
  return `O ComfyUI está ligado${ram}.${auto} Desligar libera essa memória, mas a próxima imagem leva cerca de 1 minuto a mais.`
}

export function apply(ctx) {
  ctx.tools.register(
    ferramenta({
      name: 'gerar_imagem',
      description:
        'Gera imagens no PC com o Gerador de Imagens (ComfyUI e a placa de vídeo). ' +
        'Use quando pedirem para gerar, criar, desenhar ou editar uma imagem. ' +
        'Demora de 10 s a alguns minutos. Devolve os caminhos dos arquivos PNG.',
      parameters: {
        type: 'object',
        properties: {
          pedido: {
            type: 'string',
            description:
              'O que desenhar, com detalhes (pode ser em português). ' +
              'Com referências, cite a ordem: "o gato da imagem 1 no cenário da imagem 2".',
          },
          modelo: {
            type: 'string',
            enum: ['qwen', 'qwen-rapido', 'flux', 'anime'],
            description:
              'qwen = padrão, o melhor e escreve texto na imagem (~35 s). ' +
              'qwen-rapido = 5x mais rápido, quase igual. ' +
              'flux = fotorrealista. anime = estilo anime.',
          },
          quantidade: {
            type: 'integer',
            minimum: 1,
            maximum: 4,
            description: 'Quantas variações (1 a 4). Padrão 1.',
          },
          formato: {
            type: 'string',
            enum: ['quadrado', 'retrato', 'paisagem'],
            description: 'Formato da imagem. Padrão: o do modelo.',
          },
          referencias: {
            type: 'array',
            items: { type: 'string' },
            description: 'Caminhos de imagens do PC para editar ou combinar (opcional).',
          },
          melhorar: {
            type: 'boolean',
            description:
              'Reescrever o pedido no formato que o modelo entende melhor (padrão: sim). ' +
              'Use false só se o usuário quiser o texto exato, como uma frase escrita na imagem.',
          },
        },
        required: ['pedido'],
        additionalProperties: false,
      },
      // Subir o ComfyUI leva ate 3 min; o Qwen faz ~35 s por imagem.
      timeoutMs: 15 * 60_000,
      execute: gerar,
    }),
  )
  ctx.tools.register(
    ferramenta({
      name: 'comfyui',
      description:
        'Mostra se o ComfyUI (o motor do Gerador de Imagens) está ligado e quanta memória usa, ' +
        'ou desliga ele. Desligar libera a memória, mas a próxima imagem leva cerca de 1 minuto a mais.',
      parameters: {
        type: 'object',
        properties: {
          acao: {
            type: 'string',
            enum: ['estado', 'desligar'],
            description: 'estado = ver se está ligado; desligar = fechar o ComfyUI.',
          },
        },
        required: ['acao'],
        additionalProperties: false,
      },
      timeoutMs: 60_000,
      execute: comfyui,
    }),
  )

  // Endereco local que o botao "ComfyUI" da barra lateral usa (ver comfy.js).
  const fechar = abrirPainel(PASTA)
  if (typeof ctx.effect === 'function') ctx.effect(() => fechar)
  else ctx.on?.('dispose', fechar)
}
