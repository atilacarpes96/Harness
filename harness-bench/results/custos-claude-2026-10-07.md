# Claude como cérebro, screen-tool como mãos — custos medidos (07/10/2026)

Pergunta do usuário: dá para o Claude pensar e o PC fazer o trabalho pesado de
tela, gastando menos que o padrão do Cowork (prints + plugin do Chrome)?

Custo = o que o Claude lê de volta, em tokens (≈ caracteres ÷ 3,3 para texto em
português; imagem ≈ largura × altura ÷ 750). Tudo que entra fica na conversa e é
relido a cada passo seguinte, então o custo real cresce com o tamanho da tarefa.

## Métodos

- **Antes**: ferramentas do plugin (`index.js`) chamadas direto, saída feita
  para o modelo de 4B (instrução repetida em toda resposta, lista completa de
  controles com coordenada, leitura de página por OCR da tela inteira).
- **Depois**: `screen-tool/tela.mjs` (novo) + `texto.ps1` (novo) + correção de
  digitação no `act.ps1`.
- **Cowork/Chrome**: plugin Claude in Chrome (medido: `read_page`,
  `get_page_text`, print) e computer use por print para apps do Windows
  (estimado pelo tamanho do print).
- **Agente local** (DSHARNESS com qwen 4B/9B decidindo): medido em 04/10,
  ver `9b-vs-4b-2026-10-04.md`.

## Por tarefa

| Tarefa | Antes | Depois | Cowork / Chrome | Agente local |
|---|---|---|---|---|
| Calculadora 128×37, conferir | ~1.100 tok, certo | **~340** (≈70 com ids conhecidos), certo | ~3.200 a 14.000 (2 a 9 prints) | não terminou (laço 1m40s) |
| Bloco de Notas: digitar e salvar | ~700 tok, **texto embaralhado** | **~25**, certo; texto longo colado ~25 | ~1.600 a 3.200 | — |
| Site CBMRS → Resoluções Técnicas, ler a lista | ~4.300 tok, lista incompleta (OCR corta em 120 linhas) | **~640**, lista exata | **~5.800** medido (read_page 1.900 + print 1.590 + get_page_text 2.300) | — |
| Wikipédia: buscar e ler | ~3.800 tok | **~370** | ~4.800 (estimado com as medidas acima) | — |
| Configurações: resolução da tela | ~1.000 a 2.000 tok | **~65** | ~1.600 a 3.200 | — |

Tempo por passo no "Depois": 0,5 a 1 s (um processo PowerShell por ação).
Digitar ficou ~0,5 s mais lento a cada 100 caracteres; texto longo vai por `colar=`.

## O que mudou e por quê

1. **Digitação** (`act.ps1`): um caractere por envio com 5 ms. Em lotes de 20
   o Bloco de Notas do Win11 embaralhava e a ação dizia "realizada". Medido:
   lote 20/5 ms e lote 1/0 ms embaralham; lote 1 com 3 ms ou mais sai certo.
   Novo `-Colar` (área de transferência, devolve o conteúdo anterior).
2. **Leitura de texto** (`texto.ps1`): pega o texto do documento pelo
   TextPattern da acessibilidade (página do Chrome em ~0,5 s) em vez de OCR.
   Exato — o OCR leu 4.736 como 1.736 na Calculadora.
3. **Saída enxuta** (`tela.mjs`): uma linha por passo; lista de controles com
   filtro, sem coordenada nem tipo "Button" por padrão; vários passos numa
   chamada (`faz`), parando no primeiro erro.
4. **`ir=<url>`**: o link na árvore de acessibilidade já traz a URL; ir direto
   é mais barato e certo que abrir menu suspenso.
5. **Desempate de homônimo**: link embrulhado em ListItem do mesmo nome não
   conta mais como ambíguo. Nomes diferentes continuam recusados — a trava que
   impediu clicar no "Fechar" do Chrome em vez do aviso do site continua.

## Lições

- "Ação realizada" não prova nada: texto embaralhado e clique bloqueado por um
  aviso do site ("Período Eleitoral") vieram como sucesso. Conferir com
  `ler=` ou `texto=` custa ~20 tokens.
- O que pesa no Cowork é o print (~1.600 tokens cada) e a árvore inteira da
  página (`read_page` ~1.900 mesmo filtrando interativos).
- Windows-MCP testado e descartado: leitura com barra de tarefas sempre, 2,5 MB
  numa janela com PNG aberto no Bloco de Notas, sem as travas.
- Visão local (qwen3.5:4b) descreveu Bloco de Notas + Calculadora como
  "terminal ou editor de código". Não compensa para o Claude.

## dsh 0.2

Atualizado de 0.1.2-alpha.2 para 0.2.0-rc.2. Na primeira execução ele migrou
`.dsh/settings.yaml` para `profiles/headless/cordis.patch.yml` e renomeou o
original para `settings.yaml.imported` (o `agent-presets` e os comentários não
foram levados). O profile `web` ficou sem nada; o mesmo bloco foi copiado para
ele. O modelo padrão estava como `qwen3-vl:4b-instruct` cru, que o Ollama roda
com num_ctx 4096: a tarefa chegava cortada (inputTokens: 1) e o agente
respondia genérico em inglês. Trocado para `dsh-4b:32k`: 4.954 tokens de
entrada, resposta certa.
