import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
// A raiz do DSHARNESS e a pasta acima deste plugin; nao depende de onde ela estiver.
const ALLOWED_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const name = 'safe-developer'
export const inject = ['tools']

function insideAllowedRoot(target) {
  const result = relative(ALLOWED_ROOT, target)

  return (
    result === '' ||
    (!result.startsWith('..') && !isAbsolute(result))
  )
}

async function readJson(filePath) {
  const text = await readFile(filePath, 'utf8')

  return {
    text,
    value: JSON.parse(text),
  }
}

async function hashFile(filePath) {
  const bytes = await readFile(filePath)

  return createHash('sha256')
    .update(bytes)
    .digest('hex')
    .toUpperCase()
}

async function run(command, args, cwd) {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    })

    return {
      ok: true,
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
    }
  } catch (error) {
    return {
      ok: false,
      stdout: String(error?.stdout ?? ''),
      stderr: String(
        error?.stderr ??
          error?.message ??
          error,
      ),
    }
  }
}

function finish(report) {
  report.ok =
    report.erros.length === 0 &&
    Object.values(report.verificacoes).every(Boolean)

  return report
}

async function validatePlugin(args) {
  const projectInput = String(args?.projeto ?? '').trim()
  const profile = String(args?.perfil ?? '').trim()
  const packageName = String(args?.pacote ?? '').trim()

  const report = {
    ok: false,
    projeto: projectInput,
    perfil: profile,
    pacote: packageName,
    dependencia: null,
    versao_fonte: null,
    versao_instalada: null,
    hashes: {
      fonte: null,
      instalado: null,
    },
    backups: [],
    verificacoes: {
      caminho_autorizado: false,
      pacote_fonte: false,
      node_check: false,
      pacote_perfil: false,
      dependencia_correta: false,
      sem_referencia_ao_disco_c: false,
      pacote_instalado: false,
      versoes_iguais: false,
      hashes_iguais: false,
      backup_encontrado: false,
      dump_config: false,
    },
    erros: [],
  }

  if (!/^[a-z0-9_-]+$/i.test(profile)) {
    report.erros.push('Nome de perfil inválido.')
    return finish(report)
  }

  if (
    !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i
      .test(packageName)
  ) {
    report.erros.push('Nome de pacote inválido.')
    return finish(report)
  }

  const projectRoot = resolve(projectInput)
  report.projeto = projectRoot

  if (!insideAllowedRoot(projectRoot)) {
    report.erros.push(
      `Projeto fora da raiz permitida: ${ALLOWED_ROOT}`,
    )
    return finish(report)
  }

  report.verificacoes.caminho_autorizado = true

  try {
    const projectInfo = await stat(projectRoot)

    if (!projectInfo.isDirectory()) {
      throw new Error('O projeto não é um diretório.')
    }

    const sourcePackage = await readJson(
      join(projectRoot, 'package.json'),
    )

    report.versao_fonte = String(
      sourcePackage.value.version ?? '',
    )

    report.verificacoes.pacote_fonte =
      sourcePackage.value.name === packageName

    if (!report.verificacoes.pacote_fonte) {
      report.erros.push(
        `Nome da fonte: ${String(sourcePackage.value.name)}.`,
      )
    }

    const sourceEntry = join(
      projectRoot,
      sourcePackage.value.main ?? 'index.js',
    )

    const nodeCheck = await run(
      process.execPath,
      ['--check', sourceEntry],
      projectRoot,
    )

    report.verificacoes.node_check = nodeCheck.ok

    if (!nodeCheck.ok) {
      report.erros.push(
        `node --check: ${nodeCheck.stderr.trim()}`,
      )
    }

    const profileRoot = join(
      ALLOWED_ROOT,
      '.dsh',
      'profiles',
      profile,
    )

    const profilePackage = await readJson(
      join(profileRoot, 'package.json'),
    )

    const lockText = await readFile(
      join(profileRoot, 'pnpm-lock.yaml'),
      'utf8',
    )

    report.verificacoes.pacote_perfil = true

    report.dependencia =
      profilePackage.value.dependencies?.[packageName] ??
      null

    const expected =
      `file:${projectRoot.replaceAll('\\', '/')}`

    report.verificacoes.dependencia_correta =
      report.dependencia === expected

    if (!report.verificacoes.dependencia_correta) {
      report.erros.push(
        `Dependência: ${String(report.dependencia)}. ` +
          `Esperada: ${expected}.`,
      )
    }

    report.verificacoes.sem_referencia_ao_disco_c =
      !/(?:file:|link:)?C:[\\/]/i.test(
        `${profilePackage.text}\n${lockText}`,
      )

    if (
      !report.verificacoes.sem_referencia_ao_disco_c
    ) {
      report.erros.push(
        'Referência ao disco C: encontrada no perfil.',
      )
    }

    const installedRoot = join(
      profileRoot,
      'node_modules',
      ...packageName.split('/'),
    )

    const installedPackage = await readJson(
      join(installedRoot, 'package.json'),
    )

    report.verificacoes.pacote_instalado = true

    report.versao_instalada = String(
      installedPackage.value.version ?? '',
    )

    report.verificacoes.versoes_iguais =
      report.versao_fonte === report.versao_instalada

    if (!report.verificacoes.versoes_iguais) {
      report.erros.push(
        'A versão instalada difere da fonte.',
      )
    }

    const installedEntry = join(
      installedRoot,
      installedPackage.value.main ??
        sourcePackage.value.main ??
        'index.js',
    )

    report.hashes.fonte = await hashFile(sourceEntry)
    report.hashes.instalado =
      await hashFile(installedEntry)

    report.verificacoes.hashes_iguais =
      report.hashes.fonte ===
      report.hashes.instalado

    if (!report.verificacoes.hashes_iguais) {
      report.erros.push(
        'O código instalado difere da fonte.',
      )
    }

    report.backups = (await readdir(projectRoot))
      .filter((file) => /\.(?:backup|bak)$/i.test(file))
      .sort()

    report.verificacoes.backup_encontrado =
      report.backups.length > 0

    if (!report.verificacoes.backup_encontrado) {
      report.erros.push('Nenhum backup encontrado.')
    }

    let dump

    if (process.platform === 'win32') {
      const commandProcessor =
        process.env.ComSpec || 'cmd.exe'

      dump = await run(
        commandProcessor,
        [
          '/d',
          '/s',
          '/c',
          `dsh --profile ${profile} --dump-config`,
        ],
        ALLOWED_ROOT,
      )
    } else {
      dump = await run(
        'dsh',
        ['--profile', profile, '--dump-config'],
        ALLOWED_ROOT,
      )
    }

    const dumpText =
      `${dump.stdout}\n${dump.stderr}`

    report.verificacoes.dump_config =
      dump.ok && dumpText.includes(packageName)

    if (!dump.ok) {
      report.erros.push(
        `dump-config: ${dump.stderr.trim()}`,
      )
    } else if (!report.verificacoes.dump_config) {
      report.erros.push(
        'O pacote não apareceu no dump-config.',
      )
    }
  } catch (error) {
    report.erros.push(
      String(error?.message ?? error),
    )
  }

  return finish(report)
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'validar_plugin_local',
    description:
      'Valida um plugin local do DSH sem modificar arquivos. ' +
      'Confere sintaxe, dependência, versões, hashes, backups ' +
      'e dump-config.',
    parameters: {
      type: 'object',
      properties: {
        projeto: {
          type: 'string',
          description:
            'Projeto localizado dentro da pasta do DSHARNESS.',
        },
        perfil: {
          type: 'string',
          description: 'Perfil DSH, como web.',
        },
        pacote: {
          type: 'string',
          description: 'Nome exato do pacote.',
        },
      },
      required: ['projeto', 'perfil', 'pacote'],
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
      return JSON.stringify(
        await validatePlugin(args),
        null,
        2,
      )
    },
  })
}