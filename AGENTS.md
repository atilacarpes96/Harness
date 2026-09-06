# DSHARNESS

## Você controla esta máquina

Você TEM mouse, teclado e visão de tela aqui, agora, por estas ferramentas:

- `analisar_tela` / `ver_tela` — ver o que está na tela: janelas, ABAS do
  navegador com nome inteiro, controles reais de cada janela, e o estado do
  player de vídeo (tocando ou parado).
- `interagir_tela` — clicar, digitar, teclas, focar janela, trocar de aba.

Quando o pedido for **fazer** alguma coisa na tela — clicar, trocar de aba, dar
play, pausar, abrir um programa, preencher um campo — **aja, não explique**:

1. Chame `analisar_tela` PRIMEIRO, sempre. É o passo 1 de qualquer tarefa de tela.
2. Depois aja com `interagir_tela`, um passo por vez.

Nunca responda que não tem controle do navegador ou do Windows. Nunca ofereça
Selenium, ChromeDriver, WebDriver, script de PowerShell ou "criar um plugin"
para isso: o controle já existe e já está na sua mão.

Pedido com dois passos ("troca de aba **e** dá play") continua sendo tarefa de
tela: comece pelo `analisar_tela` do mesmo jeito, e faça um passo de cada vez.

## Quando o pedido for sobre o projeto em si

**Antes de responder pergunta ampla sobre este projeto, leia `STATUS.md`** — ele
tem o estado atual, o porquê de cada decisão e os achados medidos. `README.md`
tem o mapa curto.

| Pasta | O que é |
|---|---|
| `screen-tool/` | O plugin das ferramentas de tela acima (`inspect.ps1`, `act.ps1`) |
| `dsh-safe-developer/` | Plugin `validar_plugin_local`, confere outro plugin |
| `harness-bench/` | Medição: compara modelos e registra o payload das chamadas |
| `modelfiles/` | Modelfiles dos modelos derivados, com `num_ctx` corrigido |
| `.dsh/` | Config: `settings.yaml`, profiles `web`/`headless`, preset `enxuto` |

- **Leia arquivos inteiros.** `read` sem `limit`, ou com algumas centenas de
  linhas. Paginar de 10 em 10 gasta o contexto em overhead.
- **Ignore ruído em busca:** `.dsh/sessions/`, `.dsh/storages/`,
  `.dsh/attachments/`, `node_modules/`.
- Shell é **PowerShell** (Windows). Responda em **português**.
- Não edite nada em `node_modules/` — é reinstalável e não versionado.
