<#
  Camada de percepcao do screen-tool: monitores, janelas, capturas e OCR.

  Devolve UM json com tudo em coordenadas da area de trabalho virtual, para que
  cada achado seja enderecavel (e clicavel, quando existir camada de controle).

  Por que PowerShell e nao Node: as tres fontes sao API do proprio Windows
  (System.Windows.Forms.Screen, user32/dwmapi, Windows.Media.Ocr). Fazer isso do
  Node exigiria dependencia nativa; aqui e zero dependencia.

  Uso:
    powershell -File inspect.ps1 -OutDir <dir> [-Ocr] [-OcrScale 2] [-Lang pt-BR] [-NoCapture]
#>
param(
  [Parameter(Mandatory=$true)][string]$OutDir,
  [switch]$Ocr,
  [double]$OcrScale = 2.0,
  [string]$Lang = 'pt-BR',
  [switch]$NoCapture,
  # Largura da copia reduzida entregue ao modelo de visao. 0 = nao gerar.
  # Custo medido em tokens de imagem: 1024px=596, 1280px=940, 1920px=2060,
  # 2560px=3620. A tela inteira nao cabe junto com prompt e resposta, e e
  # justamente por isso que a versao anterior lia texto errado.
  [int]$VisionWidth = 0,
  # GANCHO DE TESTE. Caminho de um json com lista de retangulos que substitui os
  # monitores reais, para exercitar o caminho multi-monitor com uma tela so:
  #   [{"x":0,"y":0,"largura":1280,"altura":1440},
  #    {"x":1280,"y":0,"largura":1280,"altura":1440}]
  # E arquivo, e nao json na linha de comando, porque as aspas do json nao
  # sobrevivem a passagem de argumento para powershell.exe -File.
  #
  # Serve porque o defeito que originou esta reescrita (capturar so a tela
  # principal) so aparece com dois monitores, e nem sempre ha dois ligados.
  [string]$SimularMonitores = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# -- Win32 -------------------------------------------------------------------
# SetProcessDPIAware: sem isto o Windows mente sobre coordenadas em tela com
# escala != 100%, e a captura sai desalinhada das caixas do OCR.
$sig = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class Win32Screen {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder s, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextLengthW(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int val, int size);

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  // EnumWindows entrega na ordem-Z, da frente para tras.
  public static System.Collections.Generic.List<IntPtr> TopLevel() {
    var found = new System.Collections.Generic.List<IntPtr>();
    EnumWindows(delegate(IntPtr h, IntPtr l) { found.Add(h); return true; }, IntPtr.Zero);
    return found;
  }
  public static string TextOf(IntPtr h) {
    int n = GetWindowTextLengthW(h);
    if (n <= 0) return "";
    var sb = new StringBuilder(n + 2);
    GetWindowTextW(h, sb, sb.Capacity);
    return sb.ToString();
  }
  // Janela "cloaked": UWP suspensa que continua visivel para EnumWindows mas
  // nao aparece na tela. Sem este filtro a lista enche de fantasma.
  public static bool IsCloaked(IntPtr h) {
    int v = 0;
    if (DwmGetWindowAttribute(h, 14, out v, sizeof(int)) != 0) return false;
    return v != 0;
  }
}
'@
Add-Type -TypeDefinition $sig

[Win32Screen]::SetProcessDPIAware() | Out-Null
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = [System.IO.Path]::GetFullPath($OutDir)

# -- monitores ---------------------------------------------------------------
$virtual = [System.Windows.Forms.SystemInformation]::VirtualScreen
$monitores = @()

if ($SimularMonitores) {
  # ConvertFrom-Json no PowerShell 5.1 emite o array como UM objeto Object[], e
  # nao um item por elemento. Envolver em @() produziria uma lista de um unico
  # elemento que e o array inteiro. foreach desenrola nos dois casos.
  $parsed = (Get-Content -LiteralPath $SimularMonitores -Raw -Encoding UTF8) | ConvertFrom-Json
  $fake = @()
  foreach ($item in $parsed) { $fake += $item }
  for ($i = 0; $i -lt $fake.Count; $i++) {
    $f = $fake[$i]
    $monitores += [pscustomobject]@{
      indice = $i
      nome = ("\\.\SIMULADO{0}" -f $i)
      principal = ($i -eq 0)
      x = [int]$f.x; y = [int]$f.y; largura = [int]$f.largura; altura = [int]$f.altura
      area_util = [pscustomobject]@{ x = [int]$f.x; y = [int]$f.y; largura = [int]$f.largura; altura = [int]$f.altura }
      arquivo = $null
    }
  }
} else {
  $screens = @([System.Windows.Forms.Screen]::AllScreens)
  for ($i = 0; $i -lt $screens.Count; $i++) {
    $b = $screens[$i].Bounds
    $wa = $screens[$i].WorkingArea
    $monitores += [pscustomobject]@{
      indice = $i
      nome = $screens[$i].DeviceName
      principal = $screens[$i].Primary
      x = $b.X; y = $b.Y; largura = $b.Width; altura = $b.Height
      area_util = [pscustomobject]@{ x = $wa.X; y = $wa.Y; largura = $wa.Width; altura = $wa.Height }
      arquivo = $null
    }
  }
}

# -- janelas -----------------------------------------------------------------
$fg = [Win32Screen]::GetForegroundWindow()
$janelas = @()
$z = 0
foreach ($h in [Win32Screen]::TopLevel()) {
  if (-not [Win32Screen]::IsWindowVisible($h)) { continue }
  if ([Win32Screen]::IsCloaked($h)) { continue }
  $titulo = [Win32Screen]::TextOf($h)
  if ([string]::IsNullOrWhiteSpace($titulo)) { continue }
  $r = New-Object Win32Screen+RECT
  if (-not [Win32Screen]::GetWindowRect($h, [ref]$r)) { continue }
  $w = $r.Right - $r.Left
  $ht = $r.Bottom - $r.Top
  if ($w -le 1 -or $ht -le 1) { continue }
  # WS_EX_TOOLWINDOW (0x80): barra flutuante, nao e janela de aplicativo.
  if (([Win32Screen]::GetWindowLong($h, -20) -band 0x80) -ne 0) { continue }

  $procId = 0
  [Win32Screen]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
  $proc = 'desconhecido'
  try { $proc = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { }

  # A qual monitor pertence: o de maior area de interseccao.
  $monIdx = -1
  $melhor = 0
  for ($i = 0; $i -lt $monitores.Count; $i++) {
    $m = $monitores[$i]
    $ix = [Math]::Max(0, [Math]::Min($r.Right, $m.x + $m.largura) - [Math]::Max($r.Left, $m.x))
    $iy = [Math]::Max(0, [Math]::Min($r.Bottom, $m.y + $m.altura) - [Math]::Max($r.Top, $m.y))
    if (($ix * $iy) -gt $melhor) { $melhor = $ix * $iy; $monIdx = $i }
  }

  # Janela minimizada fica em (-32000,-32000) por convencao do Windows. Isso nao
  # e posicao: publicar como coordenada faria um clique futuro mirar no vazio.
  $iconic = [bool][Win32Screen]::IsIconic($h)
  $reg = [pscustomobject]@{
    titulo = $titulo
    processo = $proc
    x = $null; y = $null; largura = $null; altura = $null
    monitor = $null
    minimizada = $iconic
    em_foco = ($h -eq $fg)
    ordem_z = $z
  }
  if (-not $iconic) {
    $reg.x = $r.Left; $reg.y = $r.Top; $reg.largura = $w; $reg.altura = $ht
    $reg.monitor = $monIdx
  }
  $janelas += $reg
  $z++
}

# -- captura -----------------------------------------------------------------
function Save-Region($x, $y, $w, $h, $path) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size($w, $h)), [System.Drawing.CopyPixelOperation]::SourceCopy)
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $g.Dispose(); $bmp.Dispose() }
}

function Save-Scaled($src, $dst, $w, $h) {
  $img = [System.Drawing.Image]::FromFile($src)
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($img, 0, 0, $w, $h)
    $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $g.Dispose(); $bmp.Dispose(); $img.Dispose() }
}

if (-not $NoCapture) {
  for ($i = 0; $i -lt $monitores.Count; $i++) {
    $m = $monitores[$i]
    $p = Join-Path $OutDir ("monitor-{0}.png" -f $i)
    Save-Region $m.x $m.y $m.largura $m.altura $p
    $monitores[$i].arquivo = $p
    if ($VisionWidth -gt 0 -and $VisionWidth -lt $m.largura) {
      $pv = Join-Path $OutDir ("monitor-{0}-visao.png" -f $i)
      $nh = [int][Math]::Round($m.altura * ($VisionWidth / $m.largura))
      Save-Scaled $p $pv $VisionWidth $nh
      $monitores[$i] | Add-Member -NotePropertyName arquivo_visao -NotePropertyValue $pv -Force
    } else {
      $monitores[$i] | Add-Member -NotePropertyName arquivo_visao -NotePropertyValue $p -Force
    }
  }
}

# -- OCR ---------------------------------------------------------------------
# Ampliar antes de reconhecer: texto de interface tem ~9px de altura e o
# reconhecedor perde caractere nesse tamanho. Medido: 105 -> 127 linhas a 2x.
$ocrPorMonitor = @()
if ($Ocr -and -not $NoCapture) {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
  [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
  [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
  [Windows.Storage.StorageFile, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
  [Windows.Globalization.Language, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null

  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

  function Await($op, $type) {
    $t = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
    try { $t.Wait(-1) | Out-Null } catch {
      $inner = $_.Exception
      while ($inner.InnerException) { $inner = $inner.InnerException }
      throw ("OCR falhou: " + $inner.Message)
    }
    $t.Result
  }

  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language($Lang)))
  if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
  if (-not $engine) { throw "Nenhum motor de OCR disponivel neste Windows." }

  foreach ($m in $monitores) {
    if (-not $m.arquivo) { continue }
    $escala = $OcrScale
    # MaxImageDimension = 10000: reduzir a escala se estourar.
    $maiorLado = [Math]::Max($m.largura, $m.altura) * $escala
    if ($maiorLado -gt 9800) { $escala = 9800.0 / [Math]::Max($m.largura, $m.altura) }

    $alvo = $m.arquivo
    if ($escala -ne 1.0) {
      $alvo = Join-Path $OutDir ("monitor-{0}-ocr.png" -f $m.indice)
      Save-Scaled $m.arquivo $alvo ([int][Math]::Round($m.largura * $escala)) ([int][Math]::Round($m.altura * $escala))
    }

    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($alvo)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $sb = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $res = Await ($engine.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])

    $linhas = @()
    foreach ($ln in $res.Lines) {
      $ws = @($ln.Words)
      if ($ws.Count -eq 0) { continue }
      $x1 = ($ws | ForEach-Object { $_.BoundingRect.X } | Measure-Object -Minimum).Minimum
      $y1 = ($ws | ForEach-Object { $_.BoundingRect.Y } | Measure-Object -Minimum).Minimum
      $x2 = ($ws | ForEach-Object { $_.BoundingRect.X + $_.BoundingRect.Width } | Measure-Object -Maximum).Maximum
      $y2 = ($ws | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height } | Measure-Object -Maximum).Maximum
      # Desfaz a escala e soma a origem do monitor: coordenada da area virtual.
      $linhas += [pscustomobject]@{
        texto = $ln.Text
        x = [int][Math]::Round($x1 / $escala) + $m.x
        y = [int][Math]::Round($y1 / $escala) + $m.y
        w = [int][Math]::Round(($x2 - $x1) / $escala)
        h = [int][Math]::Round(($y2 - $y1) / $escala)
      }
    }
    $sb.Dispose()
    $stream.Dispose()
    if ($escala -ne 1.0) { Remove-Item -LiteralPath $alvo -Force -ErrorAction SilentlyContinue }
    $ocrPorMonitor += [pscustomobject]@{
      monitor = $m.indice
      idioma = $engine.RecognizerLanguage.LanguageTag
      escala = $escala
      linhas = $linhas
    }
  }
}

$saida = [pscustomobject]@{
  capturado_em = (Get-Date).ToString('o')
  area_virtual = [pscustomobject]@{ x = $virtual.X; y = $virtual.Y; largura = $virtual.Width; altura = $virtual.Height }
  monitores = $monitores
  janelas = $janelas
  ocr = $ocrPorMonitor
}
$json = $saida | ConvertTo-Json -Depth 8 -Compress
# Gravar pelo .NET: o stdout do PowerShell passa pela codepage do console e
# destroi acento e aspa tipografica, quebrando o JSON no meio.
[System.IO.File]::WriteAllText((Join-Path $OutDir 'inspect.json'), $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("ok monitores={0} janelas={1} ocr={2}" -f $monitores.Count, $janelas.Count, $ocrPorMonitor.Count)
