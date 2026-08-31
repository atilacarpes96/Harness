<#
  Cria o atalho do DSHARNESS na Area de Trabalho, com icone proprio.

  Rode uma vez:
    powershell -ExecutionPolicy Bypass -File instalar-atalho.ps1

  Para remover depois, basta apagar o atalho da Area de Trabalho.
#>
param(
  [string]$Nome = 'DSHARNESS'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$RAIZ = Split-Path -Parent $MyInvocation.MyCommand.Path
$alvo = Join-Path $RAIZ 'iniciar.ps1'
if (-not (Test-Path $alvo)) { throw "Nao achei o iniciar.ps1 em $RAIZ" }

# -- icone -------------------------------------------------------------------
# Desenha um PNG e embrulha no formato ICO. Um .ico pode conter PNG direto
# (desde o Vista), entao o arquivo e so: cabecalho + entrada + o PNG.
$icone = Join-Path $RAIZ 'dsharness.ico'
$lado = 256
$bmp = New-Object System.Drawing.Bitmap($lado, $lado, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
try {
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  # Quadrado arredondado escuro.
  $r = 48
  $caminho = New-Object System.Drawing.Drawing2D.GraphicsPath
  $caminho.AddArc(0, 0, $r*2, $r*2, 180, 90)
  $caminho.AddArc($lado-$r*2, 0, $r*2, $r*2, 270, 90)
  $caminho.AddArc($lado-$r*2, $lado-$r*2, $r*2, $r*2, 0, 90)
  $caminho.AddArc(0, $lado-$r*2, $r*2, $r*2, 90, 90)
  $caminho.CloseFigure()
  $fundo = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0,0)),
    (New-Object System.Drawing.Point($lado,$lado)),
    [System.Drawing.Color]::FromArgb(255, 34, 38, 54),
    [System.Drawing.Color]::FromArgb(255, 18, 20, 30))
  $g.FillPath($fundo, $caminho)

  # Moldura de tela, que e do que a ferramenta trata.
  $caneta = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 96, 165, 250), 10)
  $g.DrawRectangle($caneta, 56, 64, 144, 100)
  $g.FillRectangle((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 96, 165, 250))), 112, 172, 32, 12)

  # Cursor dentro da tela: percepcao mais controle.
  $seta = @(
    (New-Object System.Drawing.Point(118, 96)),
    (New-Object System.Drawing.Point(118, 148)),
    (New-Object System.Drawing.Point(132, 134)),
    (New-Object System.Drawing.Point(142, 156)),
    (New-Object System.Drawing.Point(154, 150)),
    (New-Object System.Drawing.Point(144, 128)),
    (New-Object System.Drawing.Point(162, 126))
  )
  $g.FillPolygon((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)), $seta)

  $fonte = New-Object System.Drawing.Font('Segoe UI', 42, [System.Drawing.FontStyle]::Bold)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString('dsh', $fonte, (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,226,232,240))),
    (New-Object System.Drawing.RectangleF(0, 186, $lado, 60)), $fmt)
} finally { $g.Dispose() }

$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray()
$ms.Dispose(); $bmp.Dispose()

$fs = [System.IO.File]::Create($icone)
$w = New-Object System.IO.BinaryWriter($fs)
try {
  $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]1)   # ICONDIR
  $w.Write([byte]0); $w.Write([byte]0)                            # 0 = 256px
  $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([uint16]1); $w.Write([uint16]32)
  $w.Write([uint32]$png.Length)
  $w.Write([uint32]22)                                            # offset do PNG
  $w.Write($png)
} finally { $w.Dispose(); $fs.Dispose() }

Write-Host ("icone gerado: {0} ({1:N0} bytes)" -f $icone, (Get-Item $icone).Length)

# -- atalho ------------------------------------------------------------------
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop ($Nome + '.lnk')

$shell = New-Object -ComObject WScript.Shell
$a = $shell.CreateShortcut($lnk)
$a.TargetPath = (Get-Command powershell.exe).Source
$a.Arguments = ('-NoLogo -ExecutionPolicy Bypass -File "{0}"' -f $alvo)
$a.WorkingDirectory = $RAIZ
$a.IconLocation = $icone
$a.Description = 'Sobe o Ollama, aquece o modelo e abre o DSHARNESS'
$a.WindowStyle = 1
$a.Save()

Write-Host ("atalho criado: {0}" -f $lnk) -ForegroundColor Green
