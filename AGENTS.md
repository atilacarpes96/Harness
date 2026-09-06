# DSHARNESS

Ambiente de desenvolvimento de plugins e configuração para o `dsh` (CLI de agente
da DeepSeek) rodando contra modelos locais via Ollama.

**Antes de responder qualquer pergunta ampla sobre este projeto, leia
`STATUS.md`** — ele tem o estado atual, o porquê de cada decisão e os achados
medidos. `README.md` tem o mapa curto. Não deduza a arquitetura lendo código
solto: a resposta já está escrita nesses dois arquivos.

## Mapa

| Pasta | O que é |
|---|---|
| `screen-tool/` | Plugin principal: percepção (`inspect.ps1`) e controle (`act.ps1`) de tela |
| `dsh-safe-developer/` | Plugin `validar_plugin_local`, confere outro plugin antes de confiar nele |
| `harness-bench/` | Medição: compara modelos e registra o payload real das chamadas |
| `modelfiles/` | Modelfiles dos modelos derivados, com `num_ctx` corrigido |
| `.dsh/` | Config do dsh: `settings.yaml`, profiles `web`/`headless`, preset `enxuto` |

## Como trabalhar aqui

- **Leia arquivos inteiros.** Use `read` sem `limit`, ou com `limit` de algumas
  centenas de linhas. Paginar de 10 em 10 linhas gasta o contexto inteiro em
  overhead e não constrói entendimento.
- **Ignore ruído em busca:** `.dsh/sessions/`, `.dsh/storages/`,
  `.dsh/attachments/`, `node_modules/`. São logs e dependências, nunca a resposta.
  Prefira `glob` com padrão específico a `*/**`.
- Shell é **PowerShell** (Windows). `pwsh` é a ferramenta; não existe bash aqui.
- Responda em **português**.
- Não edite nada dentro de `node_modules/` — é reinstalável e não versionado.
  Config do agente vai em `.dsh/settings.yaml` ou no preset em
  `.dsh/.agent-presets/enxuto/`.
