# DSHARNESS — Status (última atualização: 31/08/2026)

## O que é este projeto, de verdade

`E:\DSHARNESS` é o ambiente de desenvolvimento de plugins/config pro **`dsh`**, o CLI de agente de IA da DeepSeek (parecido com o Claude Code), rodando contra modelos locais via Ollama.

Existe um documento de handoff antigo descrevendo uma ferramenta de análise de PPCI (segurança contra incêndio) com RAG, análise de plantas, etc. **Isso é só a visão futura — nada disso está construído ainda.** Hoje o repositório só tem a infraestrutura de harness (testar/comparar modelos locais) e dois plugins pequenos. Se uma sessão futura ler aquele handoff, tratar como contexto de intenção, não como estado atual.

## Estrutura

- `.dsh/settings.yaml` — configuração dos modelos (o arquivo mais importante; recarrega sozinho, não precisa reiniciar nada quando editado)
- `.dsh/profiles/web/` — profile da interface web (`dsh web`, porta 3080)
- `.dsh/profiles/headless/` — profile sem UI, criado pra testar via terminal: `dsh --profile headless "sua pergunta"`
- `dsh-safe-developer/` — plugin com a tool `validar_plugin_local` (valida hash/versão/dependência de outro plugin antes de confiar nele)
- `screen-tool/` — plugin com a tool `analisar_tela` (+ o apelido `ver_tela`)
- `.dsh/.agent-presets/enxuto/` — preset do agente usado pelo profile `web`: shell, arquivos e os plugins locais, sem subagente/workflow/goal/todo/skill/plano/busca-web
- `harness-bench/` — ferramentas próprias: `compare.mjs` (compara modelos Ollama direto, sem o overhead do agente) e `proxy-log.mjs` (proxy entre o dsh e o Ollama que grava o payload real de cada chamada — é como o overhead foi medido)
- `modelfiles/` — Modelfiles dos modelos derivados com contexto corrigido (ver abaixo)

## Modelo padrão atual e por quê

**Padrão: `dsh-4b:16k`** — é o `qwen3-vl:4b-instruct` com `PARAMETER num_ctx 16384`
(ver `modelfiles/dsh-4b-16k.Modelfile`). O contexto maior não é luxo: sem ele o
Ollama roda tudo em 4096 e **truncava ~76% de cada chamada** (detalhe na seção de
achados). Ocupa ~4,8 GB dos 12,3 GB da placa.

**Disponível: `dsh-8b:12k`** — o `qwen3-vl:8b-instruct` com contexto 12k, 7,15 GB
residentes. Mais detalhado, prefill ~2,5× mais lento que o 4b. Vale quando a GPU
estiver livre.

As tags originais (`qwen3-vl:4b-instruct`, `qwen3-vl:8b-instruct`) continuam no
dropdown, mas rodam com contexto 4096 — só usar pra comparação.

**Nunca usar `qwen3-vl:8b` (sem `-instruct`)** — esse usa um "renderizador de pensamento" (`RENDERER qwen3-vl-thinking`) que fica preso pensando antes de responder, de forma inconsistente e às vezes por minutos, e isso **não é configurável** — é embutido no próprio binário do Ollama, não dá pra desligar por parâmetro. O `-instruct` (tanto 4b quanto 8b) usa outro renderizador (`qwen3-vl-instruct`) que nunca tem esse problema.

## Achados técnicos (se for mexer em `settings.yaml` de novo)

- YAML: `off` sem aspas vira booleano `false` (regra do YAML 1.1) — sempre usar `"off":` com aspas.
- `reasoningEfforts` exige declarar pelo menos 2 níveis (ex: `{"off":, high: high}`) — só `"off"` sozinho é rejeitado com erro `NO_ADAPTER` (bug/validação não documentada, achado lendo o código-fonte de `dsh-llm-pi-ai`).
- `compat: {thinkingFormat: qwen}` manda o parâmetro nativo `enable_thinking` em vez do genérico `reasoning_effort` — ajuda, mas não resolve o problema do `qwen3-vl:8b` (isso é limitação do renderizador, não do parâmetro).
- Pra ver se um modelo Ollama tem suporte a chamar ferramentas: `curl http://127.0.0.1:11434/api/show -d '{"model":"NOME"}'` e olhar `capabilities` — precisa ter `"tools"` na lista, senão o agente do dsh dá erro 400 ao tentar usar ele.
- Pra ver o renderizador de um modelo: `ollama show --modelfile NOME` — procurar a linha `RENDERER`.
- **O `contextWindow` do `settings.yaml` não chega no Ollama.** O Ollama decide o contexto sozinho na hora de subir o runner (`msg="vram-based default context" ... default_num_ctx=4096` no log do `ollama serve`) e o endpoint `/v1` **ignora** `num_ctx` mandado no corpo — testado como `options.num_ctx` e no topo, nenhum dos dois tem efeito. O único lugar que ele respeita é `PARAMETER num_ctx` no Modelfile (ou a env `OLLAMA_CONTEXT_LENGTH` no servidor, que é global). Com 4096 e o inventário padrão de 32 ferramentas (8.710 tokens), o modelo via menos de um quarto do prompt — e isso explica boa parte do comportamento errático que atribuímos ao "modelo ser pequeno".
- Pra ver o que o dsh manda de verdade: `node harness-bench/proxy-log.mjs` e apontar `baseURL` pra `http://127.0.0.1:11435/v1`. Lembrar de voltar pra 11434 depois.
- **Plugin declarado como `file:` no `package.json` do profile é COPIADO pelo pnpm, não linkado** — editar o fonte não muda nada até reinstalar. Foi o que aconteceu com o `screen-tool` no profile `web`, que ficou 4 dias atrás da fonte sem ninguém notar. Os dois profiles usam `link:` agora; ao mexer em plugin, conferir com `ls -la .dsh/profiles/<profile>/node_modules/` que é symlink.
- Ferramenta registrada por bundle do profile (plano do host) chega no agente **independente do preset** — por isso o preset `enxuto` não precisa declarar `analisar_tela`/`validar_plugin_local`.
- Pra rodar uma segunda instância web de teste sem derrubar a que está aberta: `dsh web --port 3081 --no-open` (o token de acesso sai no log).
- O Ollama do usuário guarda os modelos em `E:\Ollama` — se subir o serve na mão, precisa de `OLLAMA_MODELS='E:\Ollama'`, senão ele acha que não tem modelo nenhum.

## Pendências / não resolvido

1. ~~**Overhead de prompt de sistema**~~ — **medido e atacado em 31/08.** Eram 8.710 tokens por chamada, dos quais 87% eram só os schemas das 32 ferramentas. Medição completa em `harness-bench/results/overhead-2026-08-31.md`. Duas correções aplicadas: contexto de verdade (modelos `dsh-4b:16k` / `dsh-8b:12k`) e o overlay `harness-bench/patches/enxuto.yml`, que desliga 18 ferramentas e leva o prompt a 3.507 tokens (−60%). No profile `web` a mesma coisa foi feita como *agent preset* — `.dsh/.agent-presets/enxuto/`, já definido como padrão em `settings.yaml`. Medido pela UI: **8,6 K -> 3,8 K tokens** por chamada. As ferramentas dos plugins locais sobrevivem ao preset (vêm do plano do host, não do preset).
2. **Análise visual detalhada**: nenhum modelo local testado (4B ou 8B) foi bom o suficiente pra decompor uma cena complexa com várias janelas/monitores — isso é relevante se algum dia for atacar a parte de análise de planta/PPCI de verdade. Provavelmente vai exigir pipeline (recortar regiões, várias passadas, OCR pra texto) em vez de "descreva a imagem inteira".
3. **Idioma**: modelos menores às vezes respondem em inglês mesmo com pergunta em português — pedir explicitamente "responda em português" resolve na hora, mas não é automático. (Parte disso pode ter sido o truncamento do prompt; vale reavaliar agora que o contexto está correto.)
4. **`dsh` está em versão alpha** (`0.1.2-alpha.2`) — é software em desenvolvimento ativo, esperar mais bugs/comportamento estranho ocasional.
5. ~~**Os 6 apelidos do `analisar_tela`**~~ — cortados pra 2 (`analisar_tela`, `ver_tela`) em 31/08. Com o contexto corrigido o modelo acerta o nome literal.

## Git

Repositório foi inicializado em 30/08 (não existia antes). Histórico limpo, `.gitignore` protegendo credenciais e sessões. `git log --oneline` pra ver o histórico completo do que foi feito.
