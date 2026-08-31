<#
  Quarta fonte de percepcao: a arvore de acessibilidade (UI Automation).

  Por que existe: OCR le PIXEL, e falha exatamente onde a automacao mais precisa
  acertar — botao de simbolo. Medido na Calculadora:
    procurar "+" por OCR casou com "tvl+", que era o botao de MEMORIA mal lido
    procurar "=" por OCR nao achou nada
  A UIA devolve o nome real do controle e o retangulo exato:
    nome=[Mais]    id=[plusButton]   -> o + de verdade
    nome=[Igual a] id=[equalButton]
  O AutomationId ainda e melhor que o nome, por ser estavel entre idiomas.

  Custo medido: ~90ms para achar a janela, ~50ms para varrer os controles.

  Uso:
    elements.ps1 -Janela "Calculadora" -Out saida.json [-Tipos Button,Edit] [-Max 200]
#>
param(
  [Parameter(Mandatory=$true)][string]$Janela,
  [Parameter(Mandatory=$true)][string]$Out,
  # Tipos de controle a listar. Vazio = todos os que forem clicaveis ou editaveis.
  [string[]]$Tipos = @('Button','Edit','CheckBox','RadioButton','ComboBox','ListItem','MenuItem','TabItem','Hyperlink','Text'),
  [int]$Max = 300
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$raiz = [System.Windows.Automation.AutomationElement]::RootElement

# Procurar entre as janelas de topo aquela cujo nome contenha o trecho. Nao dá
# para usar PropertyCondition aqui porque ela exige igualdade exata, e titulo de
# janela quase sempre tem sufixo ("... - Google Chrome").
$alvo = $null
$filhos = $raiz.FindAll([System.Windows.Automation.TreeScope]::Children,
  [System.Windows.Automation.Condition]::TrueCondition)
foreach ($f in $filhos) {
  $n = $f.Current.Name
  if ($n -and $n.ToLower().Contains($Janela.ToLower())) { $alvo = $f; break }
}

if (-not $alvo) {
  $abertas = @()
  foreach ($f in $filhos) { if ($f.Current.Name) { $abertas += $f.Current.Name } }
  $erro = [pscustomobject]@{
    erro = ("Nenhuma janela com '{0}' no titulo." -f $Janela)
    janelas_abertas = ($abertas | Select-Object -First 20)
  }
  [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($Out),
    ($erro | ConvertTo-Json -Depth 5 -Compress), (New-Object System.Text.UTF8Encoding($false)))
  Write-Output 'erro: janela nao encontrada'
  exit 1
}

$todos = $alvo.FindAll([System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.Condition]::TrueCondition)

$itens = @()
foreach ($e in $todos) {
  if ($itens.Count -ge $Max) { break }
  $c = $e.Current
  $tipo = $c.ControlType.ProgrammaticName -replace '^ControlType\.', ''
  if ($Tipos.Count -gt 0 -and $Tipos -notcontains $tipo) { continue }

  $r = $c.BoundingRectangle
  # Elemento fora da tela ou sem area nao e clicavel; publicar seria oferecer um
  # alvo que nao existe.
  if ($r.Width -le 0 -or $r.Height -le 0) { continue }
  if ([double]::IsInfinity($r.X) -or [double]::IsInfinity($r.Y)) { continue }

  $nome = $c.Name
  $id = $c.AutomationId
  if (-not $nome -and -not $id) { continue }

  # Valor do controle, quando ele expoe um. E o que fecha o laco agir->conferir
  # sem depender do OCR: campo de texto, visor, caixa de selecao. ValuePattern
  # cobre edit/combo; para Text o proprio Name ja carrega o conteudo.
  $valor = $null
  try {
    $pat = $null
    if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pat)) {
      $valor = $pat.Current.Value
    }
  } catch { }

  $itens += [pscustomobject]@{
    nome = $nome
    id = $id
    tipo = $tipo
    valor = $valor
    x = [int]($r.X + $r.Width / 2)
    y = [int]($r.Y + $r.Height / 2)
    largura = [int]$r.Width
    altura = [int]$r.Height
    habilitado = (-not $c.IsOffscreen) -and $c.IsEnabled
  }
}

$saida = [pscustomobject]@{
  janela = $alvo.Current.Name
  total = $itens.Count
  elementos = $itens
}
# Gravar pelo .NET: o stdout do PowerShell passa pela codepage do console e
# destroi acento, quebrando o JSON no meio.
[System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($Out),
  ($saida | ConvertTo-Json -Depth 6 -Compress), (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("ok elementos={0}" -f $itens.Count)
