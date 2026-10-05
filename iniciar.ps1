<#
  Inicializador do DSHARNESS.

  Cuida do que antes era feito na mao, em ordem, e para com uma mensagem util
  se algum passo falhar em vez de abrir uma interface quebrada:

    1. Ollama respondendo?  se nao, sobe com OLLAMA_MODELS certo
    2. o modelo padrao existe?
    3. aquece o modelo (a primeira chamada fria custa ~10s)
    4. abre a interface web

  Uso:
    powershell -ExecutionPolicy Bypass -File iniciar.ps1
    ... -SemAquecer     pula o passo 3
    ... -Porta 3081     usa outra porta
#>
param(
  [switch]$SemAquecer,
  # Encerra instancias antigas do dsh antes de subir. Util depois de fechar a
  # janela sem encerrar o processo, que deixa a porta presa.
  [switch]$Limpar,
  [int]$Porta = 3080
)

$ErrorActionPreference = 'Stop'
$RAIZ = Split-Path -Parent $MyInvocation.MyCommand.Path
$OLLAMA = 'http://127.0.0.1:11434'

# Onde a URL da instancia fica guardada. Existe por um motivo concreto: o dsh
# gera um token de acesso a cada boot e SO imprime no console. Fechar a janela
# torna o servidor inalcancavel — ele continua vivo, segurando a porta, e nao ha
# como entrar. Guardando a URL, clicar no icone de novo leva de volta para a
# instancia aberta em vez de precisar mata-la.
$ESTADO_DIR = Join-Path $env:LOCALAPPDATA 'dsharness'
$ESTADO = Join-Path $ESTADO_DIR 'instancia.json'
# O Ollama deste usuario guarda os modelos fora do padrao. Sem isto, um serve
# iniciado por aqui acha que nao existe modelo nenhum.
$MODELOS = 'E:\Ollama'

function Passo($n, $texto) { Write-Host ("[{0}/4] {1}" -f $n, $texto) -ForegroundColor Cyan }
function Ok($texto)   { Write-Host ("      OK  " + $texto) -ForegroundColor Green }
function Aviso($texto){ Write-Host ("      !   " + $texto) -ForegroundColor Yellow }
# Falha nao fecha o inicializador: abre uma caixa com "Tentar novamente" e roda
# tudo de novo na mesma janela. Antes era ler o erro, fechar e clicar no icone
# outra vez.
$SCRIPT = $MyInvocation.MyCommand.Path
Add-Type -AssemblyName System.Windows.Forms

function DeNovo([switch]$ComLimpar) {
  Write-Host ''
  Write-Host '  ---- tentando de novo ----' -ForegroundColor DarkGray
  Write-Host ''
  $a = @{}
  if ($SemAquecer) { $a.SemAquecer = $true }
  if ($Limpar -or $ComLimpar) { $a.Limpar = $true }
  if ($Porta -ne 3080) { $a.Porta = $Porta }
  & $SCRIPT @a
  exit $LASTEXITCODE
}

function Caixa($texto, $botoes, $icone) {
  [System.Windows.Forms.MessageBox]::Show($texto, 'DSHARNESS', $botoes, $icone,
    [System.Windows.Forms.MessageBoxDefaultButton]::Button1,
    [System.Windows.Forms.MessageBoxOptions]::DefaultDesktopOnly)
}

function Erro($texto) {
  Write-Host ''
  Write-Host ("  FALHOU: " + $texto) -ForegroundColor Red
  $r = Caixa ("Nao deu para abrir o DSHARNESS.`n`n$texto`n`nTentar de novo?") `
    'RetryCancel' 'Error'
  if ($r -eq 'Retry') { DeNovo }
  exit 1
}

function OllamaVivo {
  try {
    $r = Invoke-RestMethod -Uri "$OLLAMA/api/tags" -TimeoutSec 3 -ErrorAction Stop
    return @($r.models)
  } catch { return $null }
}

Write-Host ''
Write-Host '  DSHARNESS' -ForegroundColor White
Write-Host '  agente local com consciencia de tela' -ForegroundColor DarkGray
Write-Host ''

# -- 0. instancias antigas ---------------------------------------------------
# Fechar a janela do navegador nao encerra o servidor: o processo fica vivo
# segurando a porta, e o proximo boot morre com EADDRINUSE. Aqui a gente ao
# menos avisa; com -Limpar, encerra.
function DshEmExecucao {
  $achados = @()
  foreach ($p in 3080..3090) {
    try {
      $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction Stop
    } catch { continue }
    foreach ($c in $conns) {
      $proc = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $c.OwningProcess) -ErrorAction SilentlyContinue
      if (-not $proc) { continue }
      # So mexe no que for claramente uma instancia do dsh: nunca derrubar um
      # node alheio so por estar numa porta vizinha.
      if ($proc.CommandLine -and $proc.CommandLine -match 'dsh') {
        $achados += [pscustomobject]@{ Porta = $p; Pid = $c.OwningProcess; Nome = $proc.Name }
      }
    }
  }
  return $achados
}

$antigas = DshEmExecucao
if ($antigas) {
  if ($Limpar) {
    Passo 0 'Encerrando instancias antigas'
    foreach ($a in $antigas) {
      Stop-Process -Id $a.Pid -Force -ErrorAction SilentlyContinue
      Ok ("porta {0} liberada (pid {1})" -f $a.Porta, $a.Pid)
    }
    Start-Sleep -Milliseconds 800
  } else {
    Passo 0 'Instancias antigas encontradas'
    foreach ($a in $antigas) { Aviso ("porta {0} ocupada por {1} (pid {2})" -f $a.Porta, $a.Nome, $a.Pid) }
    Aviso 'use -Limpar para encerrar todas antes de subir'
  }
}

# -- 1. Ollama ---------------------------------------------------------------
Passo 1 'Verificando o Ollama'
$modelos = OllamaVivo
if ($modelos) {
  Ok ("ja estava rodando, {0} modelos" -f $modelos.Count)
} else {
  # Ollama que existe mas nao responde e um serve travado na subida (visto em
  # 04/10/2026: o processo ficou vivo sem nunca abrir a porta). Subir outro por
  # cima nao resolve; encerrar o travado resolve.
  $travados = @(Get-Process -Name 'ollama' -ErrorAction SilentlyContinue)
  if ($travados) {
    Aviso ("Ollama travado (pid {0}); encerrando" -f (($travados.Id) -join ', '))
    $travados | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
  } else {
    Aviso 'nao respondeu; subindo'
  }
  $env:OLLAMA_MODELS = $MODELOS
  $log = Join-Path $env:TEMP 'dsharness-ollama.log'
  Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden `
    -RedirectStandardError $log -ErrorAction SilentlyContinue
  $limite = (Get-Date).AddSeconds(45)
  while (-not $modelos -and (Get-Date) -lt $limite) {
    Start-Sleep -Milliseconds 800
    $modelos = OllamaVivo
  }
  if (-not $modelos) {
    $fim = ''
    if (Test-Path $log) { $fim = (Get-Content $log -Tail 3) -join "`n" }
    Erro ("o Ollama nao subiu em 45s.`n`nUltimas linhas do log:`n" + $fim)
  }
  Ok ("subiu, {0} modelos" -f $modelos.Count)
}

# -- 2. modelo padrao --------------------------------------------------------
Passo 2 'Conferindo o modelo padrao'
$cfg = Join-Path $RAIZ '.dsh\settings.yaml'
$padrao = 'dsh-4b:16k'
if (Test-Path $cfg) {
  # Le so a primeira linha "model:" do bloco agent-default-model.
  $linha = (Select-String -Path $cfg -Pattern '^\s*model:\s*(\S+)' | Select-Object -First 1)
  if ($linha) { $padrao = $linha.Matches[0].Groups[1].Value }
}
$nomes = @($modelos | ForEach-Object { $_.name })
if ($nomes -contains $padrao) {
  Ok $padrao
} else {
  Aviso ("'{0}' nao esta instalado." -f $padrao)
  Aviso ("disponiveis: " + (($nomes | Select-Object -First 6) -join ', '))
  Aviso 'a interface abre assim mesmo; escolha outro modelo no seletor.'
}

# -- 3. aquecer --------------------------------------------------------------
Passo 3 'Aquecendo o modelo'
if ($SemAquecer) {
  Aviso 'pulado (-SemAquecer)'
} elseif ($nomes -contains $padrao) {
  try {
    $corpo = @{ model = $padrao; prompt = 'ok'; stream = $false; keep_alive = '30m' } | ConvertTo-Json
    $t = Measure-Command {
      Invoke-RestMethod -Uri "$OLLAMA/api/generate" -Method Post -Body $corpo `
        -ContentType 'application/json' -TimeoutSec 120 | Out-Null
    }
    Ok ("carregado em {0:N1}s, fica na memoria por 30min" -f $t.TotalSeconds)
  } catch {
    Aviso 'nao consegui aquecer; a primeira resposta vai demorar mais'
  }
} else {
  Aviso 'sem modelo padrao para aquecer'
}

# -- 4. interface ------------------------------------------------------------
Passo 4 ("Abrindo a interface na porta {0}" -f $Porta)

# Conferir a porta antes de chamar o dsh. Sem isto, uma instancia ja rodando faz
# o boot morrer com um stack trace de Node de 30 linhas, onde a unica linha que
# importa (EADDRINUSE) fica enterrada no meio.
$ocupada = $false
try {
  $teste = New-Object System.Net.Sockets.TcpClient
  $teste.Connect('127.0.0.1', $Porta)
  $ocupada = $true
  $teste.Close()
} catch { $ocupada = $false }

if ($ocupada) {
  # Porta ocupada tem dois casos MUITO diferentes, e confundi-los e o que fazia
  # a experiencia ser ruim: instancia viva e alcancavel (basta abrir), ou orfa
  # cujo token se perdeu junto com o console (so serve para ser encerrada).
  $urlSalva = $null
  if (Test-Path $ESTADO) {
    try {
      $j = Get-Content $ESTADO -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($j.porta -eq $Porta -and $j.url) {
        $r = Invoke-WebRequest -Uri $j.url -TimeoutSec 4 -UseBasicParsing -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $urlSalva = $j.url }
      }
    } catch { $urlSalva = $null }
  }

  if ($urlSalva) {
    Ok 'ja esta aberto e alcancavel; abrindo no navegador'
    Start-Process $urlSalva
    Start-Sleep -Milliseconds 900
    exit 0
  }

  Aviso ("a porta {0} esta ocupada por uma instancia orfa." -f $Porta)
  $r = Caixa ("Ja existe um DSHARNESS aberto na porta $Porta, mas o endereco dele se perdeu " +
    "(a janela que o abriu foi fechada).`n`nEncerrar essa instancia e abrir uma nova?") `
    'YesNo' 'Question'
  if ($r -eq 'Yes') { DeNovo -ComLimpar }
  exit 0
}

Set-Location $RAIZ
Write-Host ''
Write-Host '  A interface abre no navegador. Feche esta janela para desligar o agente.' -ForegroundColor DarkGray
Write-Host '  Dica: Scroll Lock ligado bloqueia mouse e teclado do agente.' -ForegroundColor DarkGray
Write-Host ''

$dsh = (Get-Command dsh -ErrorAction SilentlyContinue)
if (-not $dsh) { Erro "o comando 'dsh' nao foi encontrado no PATH." }

# A URL com token so existe na saida do dsh. Antes ela era lida por um pipe
# (`& dsh web 2>&1 | ForEach-Object`), e em 04/10/2026 o dsh subiu, abriu o
# navegador e o pipe nunca entregou a linha: o estado ficou com o token velho.
# Agora o node escreve num log e a gente le o arquivo, que foi testado.
New-Item -ItemType Directory -Force -Path $ESTADO_DIR | Out-Null
$binJs = Join-Path (Split-Path $dsh.Source) 'node_modules\@deepseek-ai\dsh\lib\bin.js'
$node = Join-Path (Split-Path $dsh.Source) 'node.exe'
if (-not (Test-Path $node)) { $node = 'node' }
$logDsh = Join-Path $env:TEMP 'dsharness-web.log'
Remove-Item $logDsh, "$logDsh.err" -ErrorAction SilentlyContinue

$web = Start-Process -FilePath $node -NoNewWindow -PassThru -WorkingDirectory $RAIZ `
  -ArgumentList @("`"$binJs`"", 'web', '--port', $Porta, '--no-open') `
  -RedirectStandardOutput $logDsh -RedirectStandardError "$logDsh.err"

$url = $null
for ($i = 0; $i -lt 120 -and -not $url -and -not $web.HasExited; $i++) {
  Start-Sleep -Milliseconds 500
  $txt = Get-Content $logDsh -Raw -ErrorAction SilentlyContinue
  if ($txt -match '(http://[^\s]+token=[A-Za-z0-9_\-]+)') { $url = $Matches[1] }
}

# Nunca imprimiu o endereco: o dsh morreu na subida ou travou. Mostra o fim do
# log na caixa, que oferece tentar de novo.
if (-not $url) {
  if (-not $web.HasExited) { Stop-Process -Id $web.Id -Force -ErrorAction SilentlyContinue }
  $fim = @(Get-Content $logDsh, "$logDsh.err" -Tail 4 -ErrorAction SilentlyContinue) -join "`n"
  Erro ("o dsh nao abriu a interface em 60s.`n`nUltimas linhas:`n" + $fim)
}

([pscustomobject]@{
  porta = $Porta
  url = $url
  pid_do_iniciador = $PID
  em = (Get-Date).ToString('o')
} | ConvertTo-Json -Compress) | Set-Content -Path $ESTADO -Encoding utf8
Ok 'interface no ar; abrindo no navegador'
Write-Host '      Endereco guardado. Clicar no icone de novo abre esta mesma sessao.' -ForegroundColor DarkGray
Start-Process $url

# Segura a janela enquanto o agente roda: fechar a janela desliga o dsh, que
# divide o console com ela.
$web.WaitForExit()
Write-Host ''
Write-Host ("  O dsh encerrou (codigo {0})." -f $web.ExitCode) -ForegroundColor Yellow
Get-Content "$logDsh.err" -Tail 5 -ErrorAction SilentlyContinue
