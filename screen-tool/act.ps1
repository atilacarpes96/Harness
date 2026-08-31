<#
  Camada de controle do screen-tool: mouse e teclado por SendInput.

  Par do inspect.ps1. A percepcao devolve coordenada da area virtual; este
  script consome a mesma coordenada, sem conversao no meio.

  Uso:
    act.ps1 -Acao mover    -X 100 -Y 200
    act.ps1 -Acao clicar   -X 100 -Y 200 [-Botao left|right|middle] [-Duplo]
    act.ps1 -Acao digitar  -Texto "acentuacao funciona"
    act.ps1 -Acao teclas   -Teclas "ctrl+s"
    act.ps1 -Acao rolar    -X 100 -Y 200 -Quantidade -3

  Comuns:
    -JanelaEsperada "<parte do titulo>"  aborta se a janela sob o alvo (ou em
                                         foco, nas acoes sem coordenada) nao
                                         casar. E a protecao contra a tela ter
                                         mudado entre perceber e agir.
    -Simular                             diz o que faria, sem fazer.

  TRAVA FISICA: com Scroll Lock ligado, nada e injetado. E um veto de hardware
  que o usuario controla sozinho, sem depender do agente se comportar.
#>
param(
  [Parameter(Mandatory=$true)][ValidateSet('mover','clicar','digitar','teclas','rolar','focar')][string]$Acao,
  [int]$X = [int]::MinValue,
  [int]$Y = [int]::MinValue,
  [ValidateSet('left','right','middle')][string]$Botao = 'left',
  [switch]$Duplo,
  [string]$Texto = '',
  [string]$Teclas = '',
  [int]$Quantidade = 0,
  [string]$JanelaEsperada = '',
  [switch]$Simular
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$sig = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class Win32Act {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern short GetKeyState(int vKey);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int m);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextLengthW(IntPtr h);
  [DllImport("user32.dll")] public static extern short VkKeyScanW(char ch);
  [DllImport("user32.dll")] public static extern uint MapVirtualKeyW(uint code, uint mapType);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);

  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
    public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT {
    public uint uMsg; public ushort wParamL, wParamH;
  }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public HARDWAREINPUT hi;
  }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT {
    public uint type; public InputUnion u;
  }

  public const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
  public const uint MOVE = 0x0001, LEFTDOWN = 0x0002, LEFTUP = 0x0004,
                    RIGHTDOWN = 0x0008, RIGHTUP = 0x0010,
                    MIDDLEDOWN = 0x0020, MIDDLEUP = 0x0040,
                    WHEEL = 0x0800, ABSOLUTE = 0x8000, VIRTUALDESK = 0x4000;
  public const uint EXTENDED = 0x0001, KEYUP = 0x0002, UNICODE = 0x0004, SCANCODE = 0x0008;

  public static int Size() { return Marshal.SizeOf(typeof(INPUT)); }

  // As structs sao montadas AQUI, e nao no PowerShell, de proposito: no
  // PowerShell um acesso aninhado a value type ($i.u.mi.dx = ...) escreve numa
  // COPIA que e descartada em seguida. O sintoma e cruel — SendInput aceita os
  // eventos e informa sucesso, mas eles chegam zerados e nao fazem nada.
  static INPUT Mouse(uint flags, int dx, int dy, int data) {
    INPUT i = new INPUT();
    i.type = INPUT_MOUSE;
    i.u.mi.dx = dx; i.u.mi.dy = dy;
    i.u.mi.mouseData = unchecked((uint)data);
    i.u.mi.dwFlags = flags;
    return i;
  }
  static INPUT Key(ushort vk, ushort scan, uint flags) {
    INPUT i = new INPUT();
    i.type = INPUT_KEYBOARD;
    i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags;
    return i;
  }

  // Teclas cujo evento precisa do bit de "estendida", senao viram o equivalente
  // do teclado numerico (uma seta vira o digito correspondente).
  static bool Estendida(ushort vk) {
    switch (vk) {
      case 0x21: case 0x22: case 0x23: case 0x24:            // pgup pgdn end home
      case 0x25: case 0x26: case 0x27: case 0x28:            // setas
      case 0x2D: case 0x2E:                                  // insert delete
      case 0xA3: case 0xA5:                                  // ctrl e alt direitos
        return true;
      default: return false;
    }
  }

  // Tecla virtual COM scan code de verdade. Sem o scan code o Windows nao marca
  // o modificador como segurado para a tecla seguinte: ctrl+home funciona (o
  // Ctrl e consultado por estado) mas shift+end nao seleciona, porque a ancora
  // da selecao depende do Shift estar fisicamente registrado. Sintoma que passa
  // facil por "a combinacao nao existe".
  static INPUT KeyVk(ushort vk, bool up) {
    uint flags = up ? KEYUP : 0;
    if (Estendida(vk)) flags |= EXTENDED;
    return Key(vk, (ushort)MapVirtualKeyW(vk, 0), flags);
  }
  static void Push(INPUT[] arr) {
    uint n = SendInput((uint)arr.Length, arr, Size());
    if (n != arr.Length)
      throw new Exception("SendInput aceitou " + n + " de " + arr.Length +
                          " eventos (erro " + Marshal.GetLastWin32Error() + ")");
  }

  public static void MoveAbs(int nx, int ny) {
    Push(new INPUT[] { Mouse(MOVE | ABSOLUTE | VIRTUALDESK, nx, ny, 0) });
  }
  public static void ClickAt(uint down, uint up) {
    Push(new INPUT[] { Mouse(down, 0, 0, 0), Mouse(up, 0, 0, 0) });
  }
  public static void Wheel(int notches) {
    Push(new INPUT[] { Mouse(WHEEL, 0, 0, notches * 120) });
  }
  public static void TypeText(string s) {
    var lote = new System.Collections.Generic.List<INPUT>();
    foreach (char c in s) {
      lote.Add(Key(0, (ushort)c, UNICODE));
      lote.Add(Key(0, (ushort)c, UNICODE | KEYUP));
      // Em lotes: um envio unico muito grande pode ser descartado pela fila do
      // destino, e o texto chega truncado sem nenhum erro.
      if (lote.Count >= 40) { Push(lote.ToArray()); lote.Clear(); System.Threading.Thread.Sleep(5); }
    }
    if (lote.Count > 0) Push(lote.ToArray());
  }
  // Procura a janela visivel cujo titulo contenha o trecho. Devolve o primeiro
  // acerto na ordem-Z, ou seja, a mais a frente entre as candidatas.
  public static IntPtr AcharJanela(string trecho) {
    IntPtr achada = IntPtr.Zero;
    string alvo = trecho.ToLowerInvariant();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (achada != IntPtr.Zero) return false;
      if (!IsWindowVisible(h)) return true;
      string t = TitleOf(h);
      if (t.Length > 0 && t.ToLowerInvariant().Contains(alvo)) { achada = h; return false; }
      return true;
    }, IntPtr.Zero);
    return achada;
  }
  static string TitleOf(IntPtr h) {
    int n = GetWindowTextLengthW(h);
    if (n <= 0) return "";
    var sb = new StringBuilder(n + 2);
    GetWindowTextW(h, sb, sb.Capacity);
    return sb.ToString();
  }

  // Trazer para frente e mais dificil do que parece: o Windows recusa
  // SetForegroundWindow vindo de um processo que nao tem o foco, justamente
  // para impedir que aplicativos roubem a tela do usuario. O caminho aceito e
  // anexar a fila de entrada da thread que tem o foco, mudar, e desanexar.
  public static bool Focar(IntPtr h) {
    if (h == IntPtr.Zero) return false;
    if (IsIconic(h)) ShowWindow(h, 9); // SW_RESTORE
    IntPtr atual = GetForegroundWindow();
    if (atual == h) return true;

    uint threadAtual = GetWindowThreadProcessId(atual, IntPtr.Zero);
    uint threadNossa = GetCurrentThreadId();
    bool anexou = false;
    if (threadAtual != 0 && threadAtual != threadNossa)
      anexou = AttachThreadInput(threadNossa, threadAtual, true);
    try {
      BringWindowToTop(h);
      SetForegroundWindow(h);
    } finally {
      if (anexou) AttachThreadInput(threadNossa, threadAtual, false);
    }
    return GetForegroundWindow() == h;
  }

  public static void Combo(ushort[] mods, ushort vk) {
    var ev = new System.Collections.Generic.List<INPUT>();
    foreach (ushort m in mods) ev.Add(KeyVk(m, false));
    ev.Add(KeyVk(vk, false));
    ev.Add(KeyVk(vk, true));
    // Soltar os modificadores na ordem inversa, como um teclado de verdade.
    for (int i = mods.Length - 1; i >= 0; i--) ev.Add(KeyVk(mods[i], true));
    Push(ev.ToArray());
  }

  public static string TitleAt(IntPtr h) {
    if (h == IntPtr.Zero) return "";
    // GA_ROOT = 2: sobe do controle para a janela de topo, senao o titulo vem
    // vazio ao mirar dentro de um botao ou campo de texto.
    IntPtr root = GetAncestor(h, 2);
    if (root == IntPtr.Zero) root = h;
    int n = GetWindowTextLengthW(root);
    if (n <= 0) return "";
    var sb = new StringBuilder(n + 2);
    GetWindowTextW(root, sb, sb.Capacity);
    return sb.ToString();
  }
}
'@
Add-Type -TypeDefinition $sig
[Win32Act]::SetProcessDPIAware() | Out-Null

$virtual = [System.Windows.Forms.SystemInformation]::VirtualScreen
$resultado = [ordered]@{ acao = $Acao; feito = $false }

function Falhar($msg) {
  $resultado.erro = $msg
  ($resultado | ConvertTo-Json -Depth 5 -Compress)
  exit 1
}

# -- trava fisica ------------------------------------------------------------
# VK_SCROLL = 0x91. GetKeyState devolve o bit 0 ligado quando o LED esta aceso.
if (([Win32Act]::GetKeyState(0x91) -band 1) -ne 0) {
  Falhar 'Scroll Lock esta ligado: injecao de mouse e teclado bloqueada pelo usuario. Desligue para permitir.'
}

# -- focar -------------------------------------------------------------------
# Sai por aqui antes da verificacao de alvo: focar e o unico caso em que a
# janela esperada NAO esta no alvo — e justamente por isso que se quer focar.
if ($Acao -eq 'focar') {
  if (-not $JanelaEsperada) { Falhar "A acao 'focar' exige -JanelaEsperada com parte do titulo." }
  $alvo = [Win32Act]::AcharJanela($JanelaEsperada)
  if ($alvo -eq [IntPtr]::Zero) {
    Falhar ("Nenhuma janela visivel com '{0}' no titulo." -f $JanelaEsperada)
  }
  $resultado.janela_no_alvo = [Win32Act]::TitleAt($alvo)
  if ($Simular) {
    $resultado.simulado = $true
    ($resultado | ConvertTo-Json -Depth 5 -Compress); exit 0
  }
  $ok = [Win32Act]::Focar($alvo)
  Start-Sleep -Milliseconds 120
  $resultado.janela_em_foco_depois = [Win32Act]::TitleAt([Win32Act]::GetForegroundWindow())
  if (-not $ok -and $resultado.janela_em_foco_depois -ne $resultado.janela_no_alvo) {
    Falhar ("Nao consegui trazer '{0}' para a frente; quem esta em foco e '{1}'." -f `
      $resultado.janela_no_alvo, $resultado.janela_em_foco_depois)
  }
  $resultado.feito = $true
  ($resultado | ConvertTo-Json -Depth 5 -Compress); exit 0
}

# -- alvo e verificacao ------------------------------------------------------
$precisaCoord = @('mover','clicar','rolar') -contains $Acao
if ($precisaCoord) {
  if ($X -eq [int]::MinValue -or $Y -eq [int]::MinValue) { Falhar "A acao '$Acao' exige -X e -Y." }
  if ($X -lt $virtual.X -or $X -ge ($virtual.X + $virtual.Width) -or
      $Y -lt $virtual.Y -or $Y -ge ($virtual.Y + $virtual.Height)) {
    Falhar ("({0},{1}) esta fora da area virtual: x {2}..{3}, y {4}..{5}." -f `
      $X, $Y, $virtual.X, ($virtual.X + $virtual.Width - 1), $virtual.Y, ($virtual.Y + $virtual.Height - 1))
  }
  $p = New-Object Win32Act+POINT
  $p.X = $X; $p.Y = $Y
  $resultado.janela_no_alvo = [Win32Act]::TitleAt([Win32Act]::WindowFromPoint($p))
} else {
  $resultado.janela_no_alvo = [Win32Act]::TitleAt([Win32Act]::GetForegroundWindow())
}

if ($JanelaEsperada) {
  if ($resultado.janela_no_alvo -notlike ("*" + $JanelaEsperada + "*")) {
    Falhar ("Abortado: esperava a janela contendo '{0}', mas ali esta '{1}'. A tela mudou entre perceber e agir." -f `
      $JanelaEsperada, $resultado.janela_no_alvo)
  }
}

if ($Simular) {
  $resultado.simulado = $true
  ($resultado | ConvertTo-Json -Depth 5 -Compress)
  exit 0
}

# -- envio -------------------------------------------------------------------
# Coordenada absoluta do SendInput e normalizada em 0..65535 sobre a area
# VIRTUAL (com o flag VIRTUALDESK), e nao sobre a tela principal. E o que faz
# funcionar com monitor de origem negativa.
function Normalizar($v, $origem, $tamanho) {
  if ($tamanho -le 1) { return 0 }
  return [int][Math]::Round((($v - $origem) * 65535.0) / ($tamanho - 1))
}

if ($precisaCoord) {
  # Duas etapas de proposito. O SendInput absoluto gera o evento de movimento de
  # verdade (a aplicacao ve WM_MOUSEMOVE, entao estado de hover funciona), mas a
  # normalizacao em 65535 passos erra ~1px por eixo numa area virtual de 3640px
  # — medido nas tres formulas candidatas, o residuo e sempre o mesmo. O
  # SetCursorPos encaixa no pixel exato e nao sofre aceleracao de ponteiro,
  # diferente de um movimento relativo de correcao.
  [Win32Act]::MoveAbs((Normalizar $X $virtual.X $virtual.Width), (Normalizar $Y $virtual.Y $virtual.Height))
  Start-Sleep -Milliseconds 15
  [Win32Act]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 10

  $pos = New-Object Win32Act+POINT
  [Win32Act]::GetCursorPos([ref]$pos) | Out-Null
  $resultado.cursor_em = @($pos.X, $pos.Y)
  $resultado.desvio = [Math]::Abs($pos.X - $X) + [Math]::Abs($pos.Y - $Y)
  # Depois do encaixe o desvio deve ser zero. Se nao for, alguma coisa esta
  # movendo o cursor junto e clicar seria clicar no escuro.
  if ($resultado.desvio -gt 0) {
    Falhar ("O cursor parou em ({0},{1}) em vez de ({2},{3}). Nao vou clicar no lugar errado." -f $pos.X, $pos.Y, $X, $Y)
  }
}

switch ($Acao) {
  'mover' { }

  'clicar' {
    $down = switch ($Botao) { 'right' { [Win32Act]::RIGHTDOWN } 'middle' { [Win32Act]::MIDDLEDOWN } default { [Win32Act]::LEFTDOWN } }
    $up   = switch ($Botao) { 'right' { [Win32Act]::RIGHTUP }   'middle' { [Win32Act]::MIDDLEUP }   default { [Win32Act]::LEFTUP } }
    [Win32Act]::ClickAt($down, $up)
    if ($Duplo) {
      Start-Sleep -Milliseconds 60
      [Win32Act]::ClickAt($down, $up)
    }
  }

  'rolar' {
    if ($Quantidade -eq 0) { Falhar "A acao 'rolar' exige -Quantidade diferente de zero." }
    [Win32Act]::Wheel($Quantidade)
  }

  'digitar' {
    if (-not $Texto) { Falhar "A acao 'digitar' exige -Texto." }
    # KEYEVENTF_UNICODE manda o caractere direto, sem passar por layout de
    # teclado: acentuacao e cedilha funcionam sem depender do ABNT2.
    [Win32Act]::TypeText($Texto)
    $resultado.caracteres = $Texto.Length
  }

  'teclas' {
    if (-not $Teclas) { Falhar "A acao 'teclas' exige -Teclas, por exemplo ctrl+s." }
    $mapa = @{
      'enter'=0x0D; 'return'=0x0D; 'tab'=0x09; 'esc'=0x1B; 'escape'=0x1B; 'space'=0x20;
      'backspace'=0x08; 'delete'=0x2E; 'del'=0x2E; 'insert'=0x2D; 'home'=0x24; 'end'=0x23;
      'pageup'=0x21; 'pagedown'=0x22; 'up'=0x26; 'down'=0x28; 'left'=0x25; 'right'=0x27;
      'f1'=0x70;'f2'=0x71;'f3'=0x72;'f4'=0x73;'f5'=0x74;'f6'=0x75;
      'f7'=0x76;'f8'=0x77;'f9'=0x78;'f10'=0x79;'f11'=0x7A;'f12'=0x7B
    }
    $modificadores = @{ 'ctrl'=0x11; 'control'=0x11; 'alt'=0x12; 'shift'=0x10; 'win'=0x5B }

    $partes = $Teclas.ToLower().Split('+') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    if ($partes.Count -eq 0) { Falhar "Combinacao de teclas vazia." }

    $mods = @()
    $principal = $null
    foreach ($parte in $partes) {
      if ($modificadores.ContainsKey($parte)) { $mods += $modificadores[$parte]; continue }
      if ($principal -ne $null) { Falhar ("Mais de uma tecla principal em '{0}'." -f $Teclas) }
      if ($mapa.ContainsKey($parte)) { $principal = $mapa[$parte] }
      elseif ($parte.Length -eq 1) {
        # VkKeyScanW respeita o layout ativo; o byte baixo e o codigo virtual.
        $vk = [Win32Act]::VkKeyScanW([char]$parte)
        if ($vk -eq -1) { Falhar ("O layout de teclado atual nao alcanca '{0}'." -f $parte) }
        $principal = $vk -band 0xFF
      }
      else { Falhar ("Tecla desconhecida: '{0}'." -f $parte) }
    }
    if ($principal -eq $null) { Falhar ("Nenhuma tecla principal em '{0}'." -f $Teclas) }

    [Win32Act]::Combo([uint16[]]$mods, [uint16]$principal)
    $resultado.combinacao = $Teclas
  }
}

Start-Sleep -Milliseconds 30
$resultado.feito = $true
$resultado.janela_em_foco_depois = [Win32Act]::TitleAt([Win32Act]::GetForegroundWindow())
($resultado | ConvertTo-Json -Depth 5 -Compress)
