# DSHARNESS — Status (última atualização: 03/11/2026)

## 03/11/2026 — dsh 0.2.2-alpha.3 e plugins dos outros programas

**Versão:** `npm install -g @deepseek-ai/dsh@0.2.2-alpha.3` (saiu no mesmo dia;
a tag `latest` do npm era a 0.2.1-rc.5). Escolhida por trazer a interface em
pt-BR (só existe na linha 0.2.2) e o gerenciador de plugins novo. Antes: 0.2.0-rc.2.

**O npm 11 não roda scripts de instalação** (política `allow-scripts`: pulou 5
pacotes). Conferido um por um, nenhum faz falta no Windows: o `node-pty` já traz
`conpty.dll` e `OpenConsole.exe` em `prebuilds\win32-x64\conpty`, e o
`conpty.node` carrega a DLL da própria pasta (`conpty.cc`: `PathCombineW(currentDir,
"conpty\\conpty.dll")`); o `koffi` 3.x pega o binário por dependência opcional
(`@koromix/koffi-win32-x64`, carrega); o `ensure-spawn-helper` só faz `chmod`; o
do `protobufjs` só avisa versão e o do `@google/genai` é vazio. (O
`post-install.js` do `node-pty` foi rodado à mão antes de achar isso; inofensivo.)

**Profiles na versão nova:**
- O headless avisava `entry not found` para 4 cortes que sumiram no 0.2.2
  (`workflow-worker-thread`, `tool-ralph`, `tool-subagent-list-agents`,
  `tool-str-replace-editor`). Tirados do `cordis.patch.yml`.
- **O preset `.dsh/.agent-presets/enxuto` não é lido desde a migração para o
  0.2 (07/10/2026).** A web voltou ao "Modo padrão": medido pelo proxy-log,
  **40 ferramentas e 13,2 mil tokens** de prompt por chamada. No 0.2 um modo é
  uma entrada `@deepseek-ai/dsh-agent-preset` (`id`, `name`, `description`,
  `order`, `plugins`) e o padrão fica em `agent-preset-registry.config.default`.
  Recriado no `web/cordis.patch.yml` a partir do `standard` do 0.2.2: **24
  ferramentas, 7,6 mil tokens**; a mesma pergunta caiu de 7 s para 3 s. A
  interface lembra o último modo usado no rascunho da sessão nova, então quem
  já usou "Modo padrão" precisa escolher Enxuto uma vez.
- O `tool-result-pruner` só corta resultado grande sob pressão de contexto
  (`compactIfNeeded`), não a cada chamada. No Enxuto ele foi para
  12288/8192/2048 porque transcrição e documento voltam com até ~12 mil caracteres.

**Plugins dos outros programas** (`plugins/`, ligados por `link:` nos dois
profiles): `gerar_imagem`, `transcrever`, `ler_documento`, `meus_programas`.
Regra seguida: o modelo só escolhe a ferramenta e preenche 1–3 campos; quem faz
o trabalho é o script que o programa já tinha (o mesmo das skills do Claude),
com JSON na última linha. Antes de ComfyUI/Whisper o plugin tira os modelos do
Ollama da placa (inclusive o do agente, que recarrega em 5–15 s na resposta
seguinte); depois do ComfyUI, `POST /free`. O `exec.signal` mata a árvore do
processo se a resposta for parada.

Medido (headless e web, `dsh-4b:32k`):
- headless: **16 ferramentas, ~6,1 mil tokens** de prompt;
- `meus_programas` listar: 0,2 s; o agente escolheu a ferramenta sozinho;
- `ler_documento` (PDF): 0,2 s, e a segunda leitura sai do cache;
- `transcrever` (áudio de 50 s): 15–20 s de Whisper, 28 s no total com o resumo;
- `gerar_imagem` (Qwen): ~40 s por imagem; +1 a 3 min se o ComfyUI estava desligado.

Achados:
- **"farol numa praia" direto no Qwen virou um poste de luz.** Com o Melhorar
  prompt do Gerador (LLM local, ~5 s) virou farol. Ficou ligado por padrão.
- A interface converte `![alt](E:\caminho\img.png)` em `/api/file?path=...` e
  mostra a imagem no chat. O plugin devolve essas linhas prontas e diz ao modelo
  para não descrever a imagem: sem isso o 4B inventava a descrição. A
  ferramenta `present` existe, mas o 4B não a usou.
- Teste com `Start-Process -Wait` em volta do dsh **trava**: ele espera a árvore
  inteira, e o ComfyUI que o `gerar.py` sobe fica vivo de propósito. A imagem
  tinha saído em 40 s. Para testar, ler o log em vez de esperar o processo.
- O título automático das sessões sai em inglês ("Sunset Beach Lamp Image").
- **PENDENTE: o terminal do agente (`pwsh`) falha em toda chamada** com
  `SetNamedSecurityInfoW failed (Win32 5): grantWrite(...DSHARNESS)`. No modo de
  acesso `workspace-write` o dsh isola o shell (token restrito + SID de
  capacidade `S-1-4-…`) e, a cada concessão, grava o DACL **e** um rótulo de
  integridade Low na pasta (flags 4|16). Gravar rótulo exige `WRITE_OWNER`; no
  disco E: o usuário herda só "Modificar" (é dono, então tem `WRITE_DAC`, mas
  não `WRITE_OWNER`). O código do rótulo já existia no 0.2.0-rc.2: não é
  regressão da atualização. O 4B entra em laço repetindo a chamada. Saídas:
  dar controle total da pasta ao usuário (`icacls` com `(OI)(CI)F`, sem admin,
  mantém o isolamento) ou o modo `danger-full-access` (sem isolamento). As
  ferramentas de tela e os plugins não passam pelo pwsh e funcionam.

---

## O que é este projeto, de verdade

`E:\Programas desenvolvidos\DSHARNESS` é o ambiente de desenvolvimento de plugins/config pro **`dsh`**, o CLI de agente de IA da DeepSeek (parecido com o Claude Code), rodando contra modelos locais via Ollama.

Existe um documento de handoff antigo descrevendo uma ferramenta de análise de documentos técnicos com RAG, análise de plantas, etc. **Isso é só a visão futura — nada disso está construído ainda.** Hoje o repositório só tem a infraestrutura de harness (testar/comparar modelos locais) e dois plugins pequenos. Se uma sessão futura ler aquele handoff, tratar como contexto de intenção, não como estado atual.

## Estrutura

- `.dsh/settings.yaml` — configuração dos modelos (o arquivo mais importante; recarrega sozinho, não precisa reiniciar nada quando editado)
- `.dsh/profiles/web/` — profile da interface web (`dsh web`, porta 3080)
- `.dsh/profiles/headless/` — profile sem UI, criado pra testar via terminal: `dsh --profile headless "sua pergunta"`. O corte de ferramentas mora em `cordis.patch.yml` e vale por padrão (ver achados)
- `dsh-safe-developer/` — plugin com a tool `validar_plugin_local` (valida hash/versão/dependência de outro plugin antes de confiar nele)
- `screen-tool/` — plugin com a tool `analisar_tela` (+ o apelido `ver_tela`). `inspect.ps1` é a camada de percepção (monitores/janelas/OCR numa só chamada), `index.js` monta o resultado, `test.mjs` cobre a geometria de duas telas — `node --test screen-tool/test.mjs`
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
- **`agent-presets: default:` no `settings.yaml` NÃO alcança o profile headless.** Agent preset é conceito do app web (ele monta a sessão do agente a partir de um preset); o launcher não tem `--preset`. Consequência: entre 31/08 e a 2ª sessão, o `web` rodava enxuto e o headless rodava com as 28 ferramentas — todo teste feito por terminal media a configuração errada, sem nenhum sinal disso na saída. Corrigido movendo o corte pra `.dsh/profiles/headless/cordis.patch.yml`, que é a camada do próprio profile e vale sem `--patch`. Lição geral: **as duas mecânicas de corte são independentes; mexer numa não afeta a outra, e nada avisa.**
- Pra conferir de verdade quantas ferramentas um profile manda, não confie no `--dump-config` (a saída é grande e fácil de ler errado) — suba o `proxy-log.mjs` e olhe `toolCount`/`prompt_tokens` do payload real.
- Pra rodar uma segunda instância web de teste sem derrubar a que está aberta: `dsh web --port 3081 --no-open` (o token de acesso sai no log).
- O Ollama do usuário guarda os modelos em `E:\Ollama` — se subir o serve na mão, precisa de `OLLAMA_MODELS='E:\Ollama'`, senão ele acha que não tem modelo nenhum.

## Pendências / não resolvido

1. ~~**Overhead de prompt de sistema**~~ — **medido e atacado em 31/08.** Eram 8.710 tokens por chamada, dos quais 87% eram só os schemas das 32 ferramentas. Medição completa em `harness-bench/results/overhead-2026-08-31.md`. Duas correções aplicadas: contexto de verdade (modelos `dsh-4b:16k` / `dsh-8b:12k`) e o overlay `harness-bench/patches/enxuto.yml`, que desliga 18 ferramentas e leva o prompt a 3.507 tokens (−60%). No profile `web` a mesma coisa foi feita como *agent preset* — `.dsh/.agent-presets/enxuto/`, já definido como padrão em `settings.yaml`. Medido pela UI: **8,6 K -> 3,8 K tokens** por chamada. As ferramentas dos plugins locais sobrevivem ao preset (vêm do plano do host, não do preset).

   **Correção posterior (2ª sessão):** aquele "duas correções" só valia inteiro no `web`. O headless dependia de passar `--patch` na mão e ninguém passava — medido pelo proxy: **28 ferramentas / 8.282 tokens** sem o overlay contra **10 / 3.082** com ele. A lista foi movida pra `.dsh/profiles/headless/cordis.patch.yml` e agora vale por padrão (verificado: sem `--patch`, 10 ferramentas / 3.082 tokens). O `harness-bench/patches/enxuto.yml` virou array vazio pra não manter a lista em dois lugares — a original está em `git show 22d6c38:harness-bench/patches/enxuto.yml`.
2. ~~**Análise visual detalhada**~~ — **atacada na 2ª sessão, e o diagnóstico estava errado.** Não era o modelo ser pequeno: era a ferramenta não entregar a informação. Dois defeitos somados:

   - `capturePrimaryScreen()` usava `[Screen]::PrimaryScreen` — **com duas telas, metade nunca era capturada.**
   - A tela inteira ia para o modelo dentro de `num_ctx 4096`. Uma imagem 2560x1440 custa **3.620 tokens** (medido: 1024px=596, 1280px=940, 1920px=2060), então sobravam ~245 tokens para a resposta. Com duas telas (5120x1440, ~7240 tokens) a imagem sozinha não caberia. É o mesmo erro de contexto pequeno da pendência 1, num terceiro lugar.

   A saída foi parar de pedir ao modelo o que o Windows entrega exato. A ferramenta agora combina três fontes: monitores (`Screen.AllScreens`, todos), janelas (`user32`/`dwmapi`: título, processo, retângulo, ordem-Z, foco) e texto (`Windows.Media.Ocr`, **nativo, pt-BR e en-US, ~0,7s por tela**), com o texto atribuído por geometria à janela que o contém. O modelo visual virou opcional (`visao: true`) e só julga layout — proibido de transcrever, porque inventava texto que não existia.

   Antes: ~90 tokens de prosa vaga, uma tela, sem coordenada. Depois: **125 linhas de texto com coordenada, agrupadas por janela, em 2,6s**, custando ~1,7k tokens de resultado. Ver `screen-tool/README.txt`.

   **Conferido com as duas telas ligadas** (31/08, mesma sessão). O arranjo real é mais duro que o simulado: a secundária é **retrato, 1080x1920, em (-1080,-178)** — origem negativa nos **dois** eixos, área virtual 3640x1920. Resultado: duas capturas com as dimensões certas em 3,4s; janela do Chrome em (-1087,-178) atribuída ao monitor 1; faixas de OCR disjuntas (`x 0..2512` contra `x -1032..-100`); **169 linhas contra 125 com uma tela**, das quais 52 atribuídas à janela da segunda tela. Esse arranjo virou caso fixo em `test.mjs` — é fácil lembrar de X negativo e esquecer o Y.

   Efeito colateral a saber: usar a ferramenta com a saída do próprio agente na tela realimenta o OCR, e o modelo passa a citar o próprio texto de volta. Não é defeito, mas atrapalha ao testar.
3. ~~**Idioma**~~ — **reavaliado e fechado.** A suspeita estava certa: era o truncamento. Com `dsh-4b:16k` e contexto de verdade, 4 de 4 perguntas em português (incluindo uma aberta, sem chamada de ferramenta) vieram respondidas em português, sem precisar pedir. Não vale mais tratar como pendência; se voltar a acontecer, suspeitar de contexto estourado antes de culpar o modelo.
4. **`dsh` está em versão alpha** (`0.1.2-alpha.2`) — é software em desenvolvimento ativo, esperar mais bugs/comportamento estranho ocasional.
5. ~~**Os 6 apelidos do `analisar_tela`**~~ — cortados pra 2 (`analisar_tela`, `ver_tela`) em 31/08. Com o contexto corrigido o modelo acerta o nome literal.

## Direção declarada pelo usuário (31/08, 2ª sessão)

O `screen-tool` não é um experimento de visão: é o começo de um **assistente que
acompanha o trabalho do dia a dia** — saber o que está acontecendo na tela e dar
contexto melhor. E, mais adiante, **agir**: mexer no mouse e no teclado,
interagir com a tela como uma pessoa quando não der para resolver por comando.

Isso já decidiu uma escolha de arquitetura: a camada de percepção devolve
**coordenada de tela em tudo** — janela, linha de texto, área — em vez de só
prosa. Uma descrição não é clicável; um retângulo é. Quem for construir a camada
de controle não precisa refazer a percepção, só consumir o que já sai de lá.

**A camada de controle foi construída em 31/08** (`act.ps1` + a tool
`interagir_tela`): mouse, clique, digitação, combinações de teclas e rolagem,
consumindo as mesmas coordenadas que a percepção devolve. Verificado com o
modelo local de 4B fazendo o laço inteiro sozinho — ver a tela, achar a janela,
clicar e digitar — com o texto conferido byte a byte no controle de destino.

**Automação começou em 31/08**, com duas capacidades acima das primitivas:

- **`clicar_texto`** — acha o texto pelo OCR e clica nele. É o que torna a
  automação viável num modelo de 4B: ele não precisa ler 125 linhas de mapa da
  tela e calcular coordenada, que é onde errava. Quando o texto aparece em
  vários lugares ela **não escolhe** — devolve os candidatos; adivinhar
  reintroduziria o clique às cegas que as travas existem para impedir.
- **`focar`** — traz uma janela para frente. Necessário porque o Windows recusa
  `SetForegroundWindow` de processo sem foco; o caminho é anexar a fila de
  entrada da thread em foco. Foi a lacuna que apareceu na prática quando o
  diálogo de credencial do git ficou escondido atrás do GitHub Desktop.

Verificado com o modelo local encadeando as duas sozinho (focar o GitHub Desktop
e clicar em History), com o resultado **conferido por leitura independente da
tela**, e não pelo relato do agente.

**Quarta fonte de percepção, e a mais importante para automação: a árvore de
acessibilidade** (`elements.ps1`, UI Automation). Testar contra a Calculadora
mostrou que clicar por OCR tem um modo de falha perigoso, não apenas impreciso:

- procurar `"+"` casou com **`tvl+`** — o botão de **memória** que o OCR leu
  errado. O clique iria para o controle errado **sem aviso nenhum**.
- procurar `"="` não achou nada: OCR não lê botão de símbolo.
- pela UIA: `nome=[Mais] id=[plusButton]`, `nome=[Igual a] id=[equalButton]`,
  com retângulo exato, em ~140ms.

Duas correções saíram daí: a ação `clicar_elemento` (prefira sempre o
`AutomationId`, que não muda com o idioma) e, no `clicar_texto`, **busca de um
ou dois caracteres passou a exigir igualdade** em vez de "contém".

Validado ponta a ponta: `7 + 8 =` na Calculadora, com o **15 conferido lendo a
tela depois**.

**`ler_elemento` fecha o laço agir → conferir** sem passar pelo OCR, que errava
justamente onde a conferência precisa acertar: número, campo curto, símbolo. A
Calculadora expõe `CalculatorExpression` e `CalculatorResults` com a conta
inteira. Verificado com 3 contas feitas por clique e batidas contra o valor
calculado em JavaScript — **3/3** —, e depois com o modelo local fazendo o ciclo
sozinho (calcular 6×9 e conferir o próprio resultado), com o valor confirmado
por leitura independente.

**Primeiro alvo fora do laboratório (31/08): o site de um órgão público pelo Chrome.** A
ferramenta fez tudo — focar, achar a barra de endereço pela árvore de
acessibilidade, digitar, Enter, esperar e conferir. Chegou na página inicial
do site, com 58 linhas lidas da página.

Mas falhou na primeira tentativa, e o modo de falha valeu mais que o sucesso: o
título ficou `chrome://blankhttps//www.<site>/`. Clicar num campo
**posiciona o cursor mas não seleciona**, então o endereço foi concatenado ao
`about:blank` que já estava lá, e o Chrome tentou interpretar o resultado — foi
daí que sumiu o `:` do `https://`, e não de erro na digitação (verificado à
parte: `a:b/c:d` chega intacto).

Correção: `digitar` ganhou `substituir: true`, que seleciona tudo antes de
escrever, no **mesmo processo** — separar em duas chamadas deixaria uma janela
entre o `ctrl+a` e a digitação em que o foco pode mudar e a seleção se perde.

Lição para os próximos alvos reais: a Calculadora é dócil demais. Aplicativo de
verdade tem campo com conteúdo, janela que demora e controle sem nome.

## Inicializador

`iniciar.ps1` + ícone na Área de Trabalho (`instalar-atalho.ps1`, roda uma vez).
Confere o Ollama e sobe se preciso — com `OLLAMA_MODELS=E:\Ollama`, senão ele não
acha modelo nenhum —, lê o modelo padrão do `settings.yaml`, aquece (a primeira
chamada fria custa ~4s) e abre a interface. Cada passo falha com mensagem útil.

Detalhe que só apareceu testando: sem conferir a porta antes, uma instância já
rodando fazia o boot morrer com **30 linhas de stack trace do Node**, com o
`EADDRINUSE` enterrado no meio. Agora avisa em uma linha e sugere outra porta.

**O achado que mudou o desenho:** o `dsh web` gera um token de acesso a cada boot
e **só o imprime no console** — verificado que ele não é persistido em lugar
nenhum. Fechar a janela deixa o servidor vivo e *inalcançável*, segurando a
porta. Foi assim que duas instâncias ficaram presas desde 30/08.

A resposta óbvia (encerrar sempre ao iniciar) mataria também uma sessão viva em
uso. O inicializador passou a **guardar a URL com token**, e agora distingue os
dois casos: instância viva e alcançável → abre ela; órfã → explica e manda usar
`-Limpar`. Clicar no ícone com o DSHARNESS aberto leva de volta para a sessão.

Isso muda a categoria do plugin: **observar é reversível, agir não é.** Daí as
três travas, descritas em `screen-tool/README.txt`:

1. clicar/digitar/teclar sem `janela_esperada` não agem, viram simulação
2. coordenada fora da área virtual é recusada
3. **Scroll Lock ligado bloqueia toda injeção** — veto de hardware, útil para
   deixar o agente observando mas proibido de agir

## Git

Repositório foi inicializado em 30/08 (não existia antes). Histórico limpo, `.gitignore` protegendo credenciais e sessões. `git log --oneline` pra ver o histórico completo do que foi feito.

**Nada de arquivo `.backup`/`.bak` daqui pra frente.** Os 24 que existiam (de 26–27/08, anteriores ao git) foram apagados na 2ª sessão — inclusive 6 versões seriadas do `screen-tool/index.js` e 4 do `package.json` do profile web. Eram o hábito de versionar à mão de antes do repo existir; hoje só escondem qual arquivo é o vivo. Todos entraram no snapshot inicial antes de sair, então continuam recuperáveis: `git show 3cf2cdd:screen-tool/index.js.before-qwen3.5.backup`. Pra guardar um estado antes de mexer, usar `git stash`, um branch, ou simplesmente commitar.
