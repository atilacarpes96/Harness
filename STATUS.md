# DSHARNESS — Status (última atualização: 30/08/2026)

## O que é este projeto, de verdade

`E:\DSHARNESS` é o ambiente de desenvolvimento de plugins/config pro **`dsh`**, o CLI de agente de IA da DeepSeek (parecido com o Claude Code), rodando contra modelos locais via Ollama.

Existe um documento de handoff antigo descrevendo uma ferramenta de análise de PPCI (segurança contra incêndio) com RAG, análise de plantas, etc. **Isso é só a visão futura — nada disso está construído ainda.** Hoje o repositório só tem a infraestrutura de harness (testar/comparar modelos locais) e dois plugins pequenos. Se uma sessão futura ler aquele handoff, tratar como contexto de intenção, não como estado atual.

## Estrutura

- `.dsh/settings.yaml` — configuração dos modelos (o arquivo mais importante; recarrega sozinho, não precisa reiniciar nada quando editado)
- `.dsh/profiles/web/` — profile da interface web (`dsh web`, porta 3080)
- `.dsh/profiles/headless/` — profile sem UI, criado pra testar via terminal: `dsh --profile headless "sua pergunta"`
- `dsh-safe-developer/` — plugin com a tool `validar_plugin_local` (valida hash/versão/dependência de outro plugin antes de confiar nele)
- `screen-tool/` — plugin com a tool `analisar_tela` (+ apelidos `analise_tela`, `analises_tela`, `analisa_tela`, `ver_tela`, `capturar_tela` — modelos pequenos erram o nome, por isso os apelidos)
- `harness-bench/` — ferramenta própria (`node harness-bench/compare.mjs`) pra comparar modelos Ollama direto, sem o overhead do agente do dsh

## Modelo padrão atual e por quê

**Padrão: `qwen3-vl:4b-instruct`** — rápido e confiável, funciona bem mesmo com outros programas (jogo, navegador com vídeo) disputando a GPU.

**Disponível no dropdown: `qwen3-vl:8b-instruct`** — mais detalhado, mas só compensa usar quando a GPU estiver livre (fechar jogo/vídeo antes). Sozinho já ocupa ~9,6GB dos 12,3GB de VRAM da placa (RTX 4070 Ti) — sobra pouca margem pra mais nada.

**Nunca usar `qwen3-vl:8b` (sem `-instruct`)** — esse usa um "renderizador de pensamento" (`RENDERER qwen3-vl-thinking`) que fica preso pensando antes de responder, de forma inconsistente e às vezes por minutos, e isso **não é configurável** — é embutido no próprio binário do Ollama, não dá pra desligar por parâmetro. O `-instruct` (tanto 4b quanto 8b) usa outro renderizador (`qwen3-vl-instruct`) que nunca tem esse problema.

## Achados técnicos (se for mexer em `settings.yaml` de novo)

- YAML: `off` sem aspas vira booleano `false` (regra do YAML 1.1) — sempre usar `"off":` com aspas.
- `reasoningEfforts` exige declarar pelo menos 2 níveis (ex: `{"off":, high: high}`) — só `"off"` sozinho é rejeitado com erro `NO_ADAPTER` (bug/validação não documentada, achado lendo o código-fonte de `dsh-llm-pi-ai`).
- `compat: {thinkingFormat: qwen}` manda o parâmetro nativo `enable_thinking` em vez do genérico `reasoning_effort` — ajuda, mas não resolve o problema do `qwen3-vl:8b` (isso é limitação do renderizador, não do parâmetro).
- Pra ver se um modelo Ollama tem suporte a chamar ferramentas: `curl http://127.0.0.1:11434/api/show -d '{"model":"NOME"}'` e olhar `capabilities` — precisa ter `"tools"` na lista, senão o agente do dsh dá erro 400 ao tentar usar ele.
- Pra ver o renderizador de um modelo: `ollama show --modelfile NOME` — procurar a linha `RENDERER`.

## Pendências / não resolvido

1. **Overhead de prompt de sistema**: toda chamada do agente carrega ~8 mil tokens de instruções/ferramentas, mesmo pra pergunta trivial. Não mexemos nisso ainda (existe um "Minimal mode" na UI que reduz o inventário de ferramentas, mas não testamos se mantém as tools dos plugins customizados).
2. **Análise visual detalhada**: nenhum modelo local testado (4B ou 8B) foi bom o suficiente pra decompor uma cena complexa com várias janelas/monitores — isso é relevante se algum dia for atacar a parte de análise de planta/PPCI de verdade. Provavelmente vai exigir pipeline (recortar regiões, várias passadas, OCR pra texto) em vez de "descreva a imagem inteira".
3. **Idioma**: modelos menores às vezes respondem em inglês mesmo com pergunta em português — pedir explicitamente "responda em português" resolve na hora, mas não é automático.
4. **`dsh` está em versão alpha** (`0.1.2-alpha.2`, atualizado nesta sessão) — é software em desenvolvimento ativo, esperar mais bugs/comportamento estranho ocasional.

## Git

Repositório foi inicializado nesta sessão (não existia antes). 9 commits, histórico limpo, `.gitignore` protegendo credenciais e sessões. `git log --oneline` pra ver o histórico completo do que foi feito.
