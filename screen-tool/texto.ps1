<#
  Texto de uma janela pela arvore de acessibilidade, sem OCR e sem imagem.

  Por que existe: para LER uma pagina ou um painel, a lista de controles traz
  coordenada de tudo (caro) e o OCR erra numero (leu 4.736 como 1.736 na
  Calculadora). Aqui o texto vem exato, do proprio programa:
    1. documento com TextPattern (pagina do Chrome/Edge, Word, editores)
    2. sem isso, os nomes dos elementos Text/Hyperlink/etc. em ordem de leitura

  Uso:
    texto.ps1 -Janela "Google Chrome" -Out saida.json [-Max 300000]
#>
param(
  [Parameter(Mandatory=$true)][string]$Janela,
  [Parameter(Mandatory=$true)][string]$Out,
  [int]$Max = 300000
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]

function Gravar($obj) {
  [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($Out),
    ($obj | ConvertTo-Json -Depth 5 -Compress), (New-Object System.Text.UTF8Encoding($false)))
}

$alvo = $null
$filhos = $A::RootElement.FindAll($TS::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($f in $filhos) {
  $n = $f.Current.Name
  if ($n -and $n.ToLower().Contains($Janela.ToLower())) { $alvo = $f; break }
}
if (-not $alvo) {
  Gravar ([pscustomobject]@{ erro = ("Nenhuma janela com '{0}' no titulo." -f $Janela) })
  exit 1
}

# 1. Documento com TextPattern. Navegador expoe a pagina como Document; o
#    TextPattern devolve o texto visivel inteiro, na ordem da pagina.
$condDoc = New-Object System.Windows.Automation.PropertyCondition(
  $A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
$docs = $alvo.FindAll($TS::Descendants, $condDoc)
foreach ($d in $docs) {
  $pat = $null
  if ($d.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pat)) {
    $txt = $pat.DocumentRange.GetText($Max)
    if ($txt -and $txt.Trim()) {
      Gravar ([pscustomobject]@{ janela = $alvo.Current.Name; fonte = 'documento'; texto = $txt })
      exit 0
    }
  }
}

# 2. Sem documento: nomes dos elementos que carregam texto, sem repetir.
$tipos = @('Text','Hyperlink','Button','ListItem','TreeItem','DataItem','Edit','Header','HeaderItem','TabItem','MenuItem','CheckBox','RadioButton')
$linhas = New-Object System.Collections.Generic.List[string]
$vistos = New-Object System.Collections.Generic.HashSet[string]
$total = 0
foreach ($e in $alvo.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
  $c = $e.Current
  if ($c.IsOffscreen) { continue }
  $tipo = $c.ControlType.ProgrammaticName -replace '^ControlType\.', ''
  if ($tipos -notcontains $tipo) { continue }
  $t = $c.Name
  if ($tipo -eq 'Edit') {
    $pat = $null
    try { if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pat)) { $t = $pat.Current.Value } } catch { }
  }
  if (-not $t) { continue }
  $t = $t.Trim()
  if (-not $t -or -not $vistos.Add($t)) { continue }
  $linhas.Add($t); $total += $t.Length
  if ($total -ge $Max) { break }
}
Gravar ([pscustomobject]@{ janela = $alvo.Current.Name; fonte = 'elementos'; texto = ($linhas -join "`n") })
