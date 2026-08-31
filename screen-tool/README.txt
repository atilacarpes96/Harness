DSH Screen Analyzer — camada de percepção de tela

Ferramentas registradas: analisar_tela (apelido: ver_tela)


O QUE FAZ

Devolve o estado da tela em três fontes, cada uma escolhida por ser a mais
exata para o que entrega:

  1. Monitores  — System.Windows.Forms.Screen, TODOS os monitores
  2. Janelas    — user32/dwmapi: título, processo, retângulo, ordem-Z, foco
  3. Texto      — Windows.Media.Ocr, com a coordenada de cada linha

O texto do OCR é atribuído por geometria à janela que o contém, então o
resultado não é uma lista solta de strings: é "dentro da janela X, na
coordenada Y, este texto". Todas as coordenadas são da área de trabalho
virtual, prontas para uso direto — inclusive negativas, quando há um monitor
à esquerda do principal.

O modelo visual (qwen3.5:4b) entra só se `visao: true` for pedido, e apenas
para julgar layout e estado. Ele é proibido de transcrever texto.


POR QUE ASSIM, E NÃO "DESCREVA A IMAGEM"

A versão anterior capturava só `PrimaryScreen` — em duas telas, metade da
informação nunca era capturada — e mandava a tela inteira para um modelo de 4B
dentro de num_ctx 4096. Medições que motivaram a reescrita (31/08/2026):

  custo da imagem em tokens, qwen3.5:4b
    512x288    164        1280x720    940
    768x432    356        1920x1080  2060
    1024x576   596        2560x1440  3620   <- uma tela

  A 2560x1440 sobravam ~245 tokens de contexto para a resposta. O modelo
  devolvia ~90 tokens de descrição vaga e soletrava texto errado. Com duas
  telas (5120x1440, ~7240 tokens) a imagem sozinha não caberia no contexto.

O OCR nativo do Windows resolve o mesmo problema melhor e mais barato:
105 linhas com coordenada em 0,7s, contra uma frase vaga em 6s. Ampliar 2x
antes de reconhecer sobe para ~127 linhas (texto de interface tem ~9px).


USO

  analisar_tela                          tudo, de todos os monitores
  analisar_tela {"monitor": 1}           só o segundo monitor
  analisar_tela {"visao": true}          soma a leitura de layout do modelo
  analisar_tela {"pergunta": "..."}      orienta a leitura visual

Custo do resultado: ~1.7k tokens numa tela de 2560x1440 com 125 linhas de
texto. Cabe folgado no dsh-4b:16k depois do prompt de sistema enxuto.

As capturas ficam em %TEMP%\dsh-screen-tool (o caminho sai no resultado).


TESTES

  node --test screen-tool/test.mjs

Cobrem a geometria com duas telas sintéticas, incluindo o arranjo real desta
máquina: secundária em pé (1080x1920) em (-1080,-178), ou seja, origem negativa
nos DOIS eixos. É fácil lembrar de X negativo e esquecer o Y.

Conferido em hardware com as duas telas ligadas: duas capturas nas dimensões
certas, faixas de OCR disjuntas (x 0..2512 contra x -1032..-100), e 169 linhas
de texto contra 125 com uma tela só.

Para exercitar a captura multi-monitor de verdade com uma tela só, o
inspect.ps1 tem o gancho -SimularMonitores, que recebe o caminho de um json
com retângulos e trata regiões da tela física como monitores separados:

  echo [{"x":0,"y":0,"largura":1280,"altura":1440},{"x":1280,"y":0,"largura":1280,"altura":1440}] > dual.json
  powershell -File screen-tool\inspect.ps1 -OutDir saida -Ocr -SimularMonitores dual.json

Verificar na saída: dois monitor-N.png, e as coordenadas do OCR do monitor 1
começando em 1280 (o deslocamento aplicado).


INSTALAÇÃO

O plugin já está ligado nos dois profiles por link:, não por file: — editar o
fonte tem efeito imediato, sem reinstalar. Conferir com:

  ls .dsh/profiles/web/node_modules/dsh-screen-analyzer     (deve ser symlink)

Para instalar em um profile novo:

  dsh plugin --profile <nome> add link:E:/DSHARNESS/screen-tool


CAMADA DE CONTROLE — interagir_tela (act.ps1)

Move o mouse, clica, digita, envia combinações e rola. Consome as MESMAS
coordenadas que o analisar_tela devolve, sem conversão no meio.

Preferidas, por serem as que não exigem calcular coordenada:

  interagir_tela {"acao":"clicar_texto","texto":"Salvar"}
  interagir_tela {"acao":"focar","janela_esperada":"Bloco de notas"}

Primitivas, para quando não há texto no alvo:

  interagir_tela {"acao":"mover",  "x":-550,"y":360}
  interagir_tela {"acao":"clicar", "x":-550,"y":360,"janela_esperada":"Bloco"}
  interagir_tela {"acao":"digitar","texto":"ação","janela_esperada":"Bloco"}
  interagir_tela {"acao":"teclas", "teclas":"ctrl+shift+end","janela_esperada":"Bloco"}
  interagir_tela {"acao":"rolar",  "x":100,"y":100,"quantidade":-3}

CLICAR POR TEXTO

`clicar_texto` acha o texto pelo OCR e clica no centro da linha. É a forma mais
confiável de automatizar: o modelo não precisa ler o mapa da tela nem calcular
coordenada, e o alvo é verificado no instante do clique — "cliquei no que dizia
Salvar" é garantia mais forte que um título de janela.

A comparação é tolerante a acento e caixa, porque o OCR troca os dois com
frequência e exigir igualdade exata faria a automação falhar por um ç mal lido.

O que ela NÃO faz é escolher por você:

- texto em vários lugares -> não clica; devolve os candidatos com coordenada e
  a janela de cada um, para desempatar com `janela_esperada`
- texto ausente -> não clica; lista os textos parecidos que estão visíveis,
  porque quase sempre é o OCR tendo lido uma letra errada

FOCAR

Trazer para frente é mais difícil do que parece: o Windows recusa
SetForegroundWindow vindo de processo sem foco, para impedir que aplicativos
roubem a tela. O caminho aceito é anexar a fila de entrada da thread que tem o
foco, trocar, e desanexar — é o que `focar` faz, junto com restaurar a janela se
estiver minimizada.

Serve para o caso que aparece o tempo todo na prática: a janela alvo existe mas
está atrás de outra. Aconteceu na primeira vez que este projeto foi publicado —
o diálogo de credencial do git ficou escondido atrás do GitHub Desktop.

TRÊS TRAVAS, e por que cada uma existe:

1. CONFIRMAÇÃO DE ALVO. Ver a tela e agir são chamadas separadas, e entre uma
   e outra a tela muda. Clicar, digitar e teclar sem `janela_esperada` NÃO
   agem: viram simulação e devolvem qual janela está no alvo, para a chamada
   ser repetida com o título. Clicar às cegas fica impossível por construção,
   e não por boa vontade do modelo.

2. LIMITE DA ÁREA VIRTUAL. Coordenada fora dela é recusada antes de qualquer
   evento.

3. SCROLL LOCK. Com ele ligado, nada é injetado. É um veto de hardware que
   você aciona sozinho, sem depender do agente se comportar. Use quando quiser
   deixar o agente observando mas proibido de agir.

Cada resposta diz qual janela estava no alvo antes e qual ficou em foco depois.

DETALHES QUE CUSTARAM DEPURAÇÃO

- As structs do SendInput são montadas em C#, não em PowerShell. No PowerShell,
  `$i.u.mi.dx = ...` escreve numa CÓPIA do value type, que é descartada: o
  SendInput aceita os eventos, informa sucesso, e nada acontece.
- Posicionar é em duas etapas: SendInput absoluto (gera o WM_MOUSEMOVE de
  verdade, então hover funciona) e depois SetCursorPos para encaixar no pixel.
  A normalização em 65535 passos erra ~1px por eixo numa área virtual de
  3640px — testadas três fórmulas, o resíduo é o mesmo. Verificado: desvio 0
  em todos os cantos, incluindo coordenada negativa.
- Toda tecla vai com scan code real (MapVirtualKey) e com o bit de estendida
  quando é seta/home/end/etc. Sem o scan code, `ctrl+home` funciona mas
  `shift+end` não seleciona — o Shift não fica registrado como segurado, e o
  sintoma parece "essa combinação não existe".
- Texto vai por KEYEVENTF_UNICODE, então acentuação e cedilha não dependem do
  layout ABNT2 estar ativo. Verificado byte a byte: 40 caracteres com ç, ã, õ,
  é, ê e travessão chegaram idênticos.


LIMITES CONHECIDOS

- Não lê conteúdo de janela minimizada (o Windows não a desenha).
- Janela que cruza dois monitores é atribuída àquele onde tem mais área.
- O OCR erra em fonte muito pequena ou com pouco contraste; a coordenada
  continua correta mesmo quando o texto sai imperfeito.
- `ctrl+a` não funciona em TextBox multilinha do WinForms — é limitação do
  controle, não da injeção (`ctrl+home` e `ctrl+shift+end` funcionam nele).
  Para selecionar tudo de forma portátil: `ctrl+home` e depois
  `ctrl+shift+end`.
- Não há desfazer. O agente age na máquina de verdade.
