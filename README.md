# DSHARNESS

Ambiente de desenvolvimento de plugins e configuração para o **`dsh`**, o CLI de
agente da DeepSeek, rodando contra modelos locais via **Ollama**.

O trabalho principal aqui é o **`screen-tool`**: dar a um modelo local de 4B
consciência do que está na tela — e, agora, capacidade de agir sobre ela.

> **Leia o [STATUS.md](STATUS.md) antes de mexer.** Ele tem o estado atual, o
> porquê de cada decisão e os achados que custaram medição. Várias conclusões
> "óbvias" sobre este projeto estavam erradas, e o STATUS diz quais.

## Estrutura

| Pasta | O que é |
|---|---|
| `screen-tool/` | O plugin principal: percepção (`inspect.ps1`) e controle (`act.ps1`) de tela |
| `dsh-safe-developer/` | Plugin com `validar_plugin_local`, para conferir outro plugin antes de confiar nele |
| `harness-bench/` | Ferramentas de medição: compara modelos do Ollama e registra o payload real das chamadas |
| `modelfiles/` | Modelfiles dos modelos derivados, com contexto corrigido |
| `.dsh/` | Configuração do dsh: `settings.yaml`, profiles `web` e `headless`, preset `enxuto` |

## Começando

Rode uma vez para criar o atalho na Área de Trabalho:

```bash
powershell -ExecutionPolicy Bypass -File instalar-atalho.ps1
```

Depois é só o ícone. Ele confere o Ollama (e sobe, se preciso), confere o modelo
padrão, aquece o modelo e abre a interface — parando com uma mensagem útil se
algum passo falhar, em vez de abrir algo quebrado.

## O que o screen-tool faz

**`analisar_tela`** — devolve o estado da tela combinando quatro fontes, cada uma
escolhida por ser a mais exata para o que entrega:

- **monitores**: todos, não só o principal
- **janelas**: título, processo, retângulo, ordem-Z e foco, direto do Win32
- **texto**: OCR nativo do Windows, com a coordenada de cada linha, atribuído por
  geometria à janela que o contém
- **controles** (`{"controles":"Calculadora"}`): nome, id e retângulo de cada
  elemento clicável, pela árvore de acessibilidade

**`interagir_tela`** — move o mouse, clica, digita, envia combinações, rola e traz
janelas para frente, consumindo as **mesmas coordenadas** que a percepção devolve.

Para automatizar, a ordem de preferência é `clicar_elemento` → `clicar_texto` →
coordenada crua. A primeira é a única que acerta botão de símbolo: procurar `+`
por OCR na Calculadora casava com o botão de **memória** mal lido.

Detalhes, medições e limites em [`screen-tool/README.txt`](screen-tool/README.txt).

## Agir na máquina tem três travas

Observar é reversível; agir não é. Por isso:

1. **Confirmação de alvo** — clicar, digitar e teclar sem `janela_esperada` não
   agem: viram simulação e informam qual janela está no alvo. Ver a tela e agir
   são chamadas separadas, e a tela muda no meio.
2. **Limite da área virtual** — coordenada fora dela é recusada antes de
   qualquer evento.
3. **Scroll Lock** — com ele ligado, nenhuma injeção acontece. Veto de hardware,
   independente do agente se comportar.

## Rodando

```bash
node --test screen-tool/test.mjs        # 18 testes, sem depender de tela
dsh --profile headless "sua pergunta"   # um turno, sem interface
dsh web                                 # interface web, porta 3080
```

## Dependência de plataforma

Isto **não é portátil**, e não por descuido: a percepção e o controle são API do
próprio Windows (`System.Windows.Forms.Screen`, `user32`/`dwmapi`,
`Windows.Media.Ocr`, `SendInput`). Fazer o mesmo pelo Node exigiria dependência
nativa; aqui é zero dependência.

O que roda em qualquer lugar: **os testes** (`node --test`), que são geometria
pura e montagem de argumentos, mais toda a edição de código.

O que exige a máquina Windows com Ollama: qualquer captura, OCR, injeção de
mouse ou teclado, e qualquer chamada de modelo. Ou seja, **alteração feita fora
dela não está verificada** — só compila e passa nos testes puros.
