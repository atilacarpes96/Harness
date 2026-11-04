// Plugin sem ferramenta: "perguntar antes" para o modo de acesso total.
//
// O terminal do agente roda com acesso total (o isolamento do dsh nao funciona
// nesta pasta; ver STATUS.md, 03/11/2026). Antes de cada ferramenta este plugin
// confere o pedido: o que for arriscado (apagar, formatar, mexer no Windows,
// desligar o PC, instalar, mandar dados para fora, git push...) para e pergunta
// ao usuario na interface, com o motivo. Sem interface (headless) nao ha a quem
// perguntar e o dsh nega sozinho.
//
// Se o usuario escolher na sessao o modo "danger-full-access" (aprovacao
// "never"), a trava fica quieta: foi escolha dele rodar sem perguntas.

import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, relative, resolve } from 'node:path'
import { RAIZ_DSHARNESS } from './comum.js'

export const name = 'confirmar-perigoso'
export const inject = ['tools', 'approval']

// [expressao, motivo]. Comparacao sem diferenciar maiusculas.
const REGRAS_SHELL = [
  [/\bremove-item\b|\bri\s|\b(rm|rmdir|rd|del|erase)\s|\bclear-content\b|\bclear-recyclebin\b|\[(system\.)?io\.(file|directory)\]::delete/i,
    'apaga arquivos ou pastas'],
  [/\bremove-(?!item\b)[a-z]+/i, 'remove algo do Windows (comando Remove-...)'],
  [/\bformat-volume\b|\bformat\s+[a-z]:|\bdiskpart\b|\bclear-disk\b|\binitialize-disk\b|\bcipher\s+\/w|\bvssadmin\b/i,
    'mexe em disco (formatar ou apagar volume)'],
  [/\bstop-computer\b|\brestart-computer\b|\bshutdown(\.exe)?\b|\blogoff\b/i, 'desliga ou reinicia o PC'],
  [/\bstop-process\b|\bspps\b|\btaskkill\b|\bkill\s|\bstop-service\b|\bset-service\b|\bsc(\.exe)?\s+(stop|delete|config)\b|\bnew-service\b/i,
    'encerra programas ou serviços'],
  [/\breg(\.exe)?\s+(add|delete|import)\b|\b(set|new)-itemproperty\b|\bhk(lm|cu|cr|u|cc):|\bset-executionpolicy\b|\bbcdedit\b|\bnetsh\b|\b(set|add)-mppreference\b|\b(set|new)-netfirewall|\bicacls\b|\btakeown\b|\bset-acl\b|\bregister-scheduledtask\b|\bschtasks\b[^\n]*\/(create|delete|change)\b|\bsetx\b|\[environment\]::setenvironmentvariable/i,
    'muda configuração do Windows (registro, permissões, firewall, tarefas ou variáveis)'],
  [/-verb\s+runas\b|\brunas(\.exe)?\s/i, 'pede para rodar como administrador'],
  [/\bwinget\s+(install|uninstall|upgrade)\b|\bchoco\s+(install|uninstall|upgrade)\b|\bmsiexec\b|\bnpm\s+(i|install|uninstall|remove|rm)\b[^\n]*\s(-g|--global)\b|\bpip3?\s+(install|uninstall)\b|\buninstall-[a-z]+|\binstall-(module|package)\b/i,
    'instala ou desinstala programas'],
  [/\bgit\s+push\b|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-[a-z]*f|\bgit\s+branch\s+-d\b|\bgit\s+checkout\s+--\s|\bgit\s+(rebase|filter-branch)\b|\s--force\b/i,
    'mexe no Git de um jeito difícil de desfazer, ou envia para o GitHub'],
  [/\b(invoke-webrequest|invoke-restmethod|iwr|irm)\b[^|;\n]*-method\s+(post|put|patch|delete)\b|\bcurl(\.exe)?\b[^|;\n]*(\s-x\s*(post|put|patch|delete)\b|\s(-d|--data[a-z-]*|-f|--form|-t|--upload-file)\s)|\bsend-mailmessage\b|\b(scp|sftp|ftp|ssh)\s/i,
    'envia dados para fora do PC'],
  [/\b(iex|invoke-expression)\b|\s-enc(odedcommand)?\s/i, 'roda código que não dá para conferir antes (iex ou comando codificado)'],
  [/\bmove-item\b|\bmi\s|\bmove\s|\brename-item\b|\bren\s/i, 'move ou renomeia arquivos'],
]

/** Motivos de risco de um comando de terminal (lista vazia = seguro). */
export function avaliarComando(comando) {
  const texto = String(comando ?? '')
  return REGRAS_SHELL.filter(([re]) => re.test(texto)).map(([, motivo]) => motivo)
}

function dentro(raiz, caminho) {
  const r = relative(raiz, caminho)
  return r === '' || (!r.startsWith('..') && !isAbsolute(r))
}

/** Escrever ou editar fora da pasta do DSHARNESS (e fora do TEMP) pergunta antes. */
export function avaliarArquivo(ferramenta, caminho, raiz = RAIZ_DSHARNESS) {
  if (!caminho) return []
  const alvo = resolve(process.cwd(), String(caminho))
  if (dentro(raiz, alvo) || dentro(tmpdir(), alvo)) return []
  if (ferramenta === 'edit') return ['edita um arquivo fora da pasta do DSHARNESS']
  if (existsSync(alvo)) return ['sobrescreve um arquivo que já existe fora da pasta do DSHARNESS']
  return []
}

function lerArgs(valor) {
  if (typeof valor === 'string') {
    try {
      return JSON.parse(valor)
    } catch {
      return {}
    }
  }
  return valor ?? {}
}

export function avaliar(nome, args) {
  if (nome === 'pwsh' || nome === 'bash') return avaliarComando(args.command)
  if (nome === 'write' || nome === 'edit') return avaliarArquivo(nome, args.file_path)
  return []
}

export function apply(ctx) {
  ctx.on(
    'tools/pre-execute',
    async (exec, next) => {
      const sessao = exec.agent?.session
      if (!sessao) return next()
      // Sessao em "acesso total sem perguntas": escolha do usuario, nao interfere.
      if (ctx.approval.overrideOf(sessao) === 'never') return next()
      const motivos = avaliar(exec.name, lerArgs(exec.arguments))
      if (motivos.length === 0) return next()
      const seguinte = await next()
      // Outra trava ja negou ou ja vai perguntar: vale a dela.
      if (seguinte.kind !== 'allow') return seguinte
      const lista = motivos.join('; ')
      return {
        kind: 'ask',
        reason: `confirmar-perigoso: ${exec.name} ${lista}`,
        displayReason: {
          pt: `Ação que pede confirmação: ${lista}. Confira o comando antes de permitir.`,
          en: `Needs confirmation: ${lista}. Check the command before allowing it.`,
        },
      }
    },
    { prepend: true },
  )
}
