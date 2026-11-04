# DSHARNESS

Ambiente para usar o **dsh** (o agente de IA da DeepSeek) com modelos que rodam no seu PC, pelo Ollama. O destaque é a **ferramenta de tela**: ela deixa a IA ver o que está na tela e agir nela (clicar, digitar, trocar de janela), lendo os botões e textos que o próprio Windows informa, em vez de olhar fotos da tela.

## Como abrir

- Atalho **DSHARNESS** na pasta **IA** da área de trabalho.
- Ele confere o Ollama (e liga, se precisar), confere e aquece o modelo padrão e abre a interface no navegador.
- Se algum passo falhar, mostra uma mensagem explicando, em vez de abrir algo quebrado.
- Clicar no atalho com o DSHARNESS já aberto volta para a sessão que existe.

## Como usar

Converse na interface como num chat (ela está em português desde a versão 0.2.2). Peça direto:
- "o que tem na minha tela?"
- "troca para a aba do YouTube e dá play"
- "abre a calculadora e faz 128 vezes 37"
- "gera uma imagem de um farol numa praia ao pôr do sol"
- "transcreve esse vídeo e me resume: https://..."
- "resume o PDF C:\pasta\contrato.pdf"
- "abre o Transcritor" / "quais programas eu tenho?" / "como uso o FlowCursor?"

### Os seus outros programas

Desde 03/11/2026 o DSHARNESS usa os outros programas desta pasta:

| Ferramenta | Usa | O que faz |
|---|---|---|
| **gerar_imagem** | Gerador de Imagens | Gera a imagem no ComfyUI e mostra no chat. Liga o ComfyUI se precisar. |
| **transcrever** | Transcritor | Transcreve link do YouTube, TikTok, Instagram ou arquivo do PC. O `.txt` fica ao lado do áudio. |
| **ler_documento** | anydoc (Pacote IA Trabalho) | Lê PDF, Word, Excel, PowerPoint, ODT, RTF, EPUB e CSV, sem nada sair do PC. |
| **meus_programas** | pasta dos programas e atalhos | Lista, abre pelo nome, abre a pasta ou explica pelo LEIA-ME. |

- A imagem pedida passa antes pelo **Melhorar prompt** do Gerador (uns 5 s a mais). Ele evita confusão como "farol" virar poste de luz. Para texto exato escrito na imagem, peça "sem melhorar".
- Gerar imagem e transcrever usam a placa de vídeo. Por isso o modelo do agente sai da placa durante o trabalho e volta depois, sozinho. A resposta final demora uns segundos a mais.
- A primeira imagem demora 1 a 3 min, porque liga o ComfyUI. As seguintes levam uns 40 s.
- O ComfyUI continua ligado depois. Para desligar, use o Gerador de Imagens (pílula verde → Desligar o ComfyUI).
- Programa novo nesta pasta (com LEIA-ME.md) ou atalho novo na área de trabalho aparece sozinho no **meus_programas**.

### Modo Enxuto

Embaixo da caixa de mensagem aparece o modo do agente. Use o **Enxuto**: ele manda ao modelo só as ferramentas que servem aqui (24 em vez de 40). Responde mais rápido e erra menos. Ele já é o padrão; se aparecer "Modo padrão", escolha Enxuto uma vez e ele fica lembrado.

### Ferramentas de tela

O modelo usa duas ferramentas:
- **analisar_tela:** lista as janelas, as abas do navegador, os botões e o texto de cada janela.
- **interagir_tela:**
  - clica num botão pelo nome;
  - clica num texto;
  - digita, aperta teclas, rola a página;
  - traz uma janela para a frente;
  - espera algo aparecer;
  - lê o valor de um campo para conferir o resultado.

### Travas de segurança

- **Scroll Lock ligado = nada é clicado nem digitado.** É um freio que você controla pelo teclado.
- Toda ação diz em que janela espera agir; se a tela mudou, ela não acontece.
- Se um texto ou botão aparece em mais de um lugar, ele não escolhe sozinho.

### Modelos

| Modelo | Quando usar |
|---|---|
| `dsh-4b:32k` (padrão) | Rápido, ~8 GB de placa |
| `dsh-9b:64k` | Mais preciso e mais lento |

Escolha no seletor da interface. As versões sem `:32k`/`:64k` rodam com contexto curto demais e se perdem: não use.

## Atalhos

| Tecla | O que faz |
|---|---|
| **Scroll Lock** | Liga e desliga o freio: com ele aceso, a IA não clica nem digita |

## Usar sem a interface

Uma pergunta só, com a resposta no terminal:

```bash
dsh --profile headless "o que tem na minha tela?"
```

### Ferramenta de tela para o Claude (`screen-tool\tela.mjs`)

É a mesma ferramenta, com respostas curtas, para o Claude controlar o Windows gastando pouco:

```bash
node "E:\Programas desenvolvidos\DSHARNESS\screen-tool\tela.mjs" janelas
node "E:\Programas desenvolvidos\DSHARNESS\screen-tool\tela.mjs" controles "Calculadora"
node "E:\Programas desenvolvidos\DSHARNESS\screen-tool\tela.mjs" faz "Calculadora" clicar=Um clicar=Mais clicar=Dois clicar="Igual a" ler=CalculatorResults
node "E:\Programas desenvolvidos\DSHARNESS\screen-tool\tela.mjs" texto "Google Chrome" "palavra" --max 1500
```

Todos os passos estão no fim de `screen-tool\README.txt`.

## Onde ficam as coisas

| Pasta / arquivo | O que é |
|---|---|
| `screen-tool\` | A ferramenta de tela (`inspect.ps1` vê, `act.ps1` age, `texto.ps1` lê páginas, `tela.mjs` para o Claude) |
| `plugins\` | Os plugins dos outros programas (imagem, transcrição, documentos, programas). Diagrama no `README.md` |
| `.dsh\profiles\web` e `headless` | Configuração do dsh: plugins em `package.json`; modelo padrão e modo Enxuto em `cordis.patch.yml` |
| `modelfiles\` | Os modelos com o contexto certo |
| `harness-bench\results\` | Medições: comparação de modelos e custos |
| `STATUS.md` | Histórico técnico de cada decisão (leia antes de mexer) |

## Como funciona

O dsh usa o modelo do Ollama e chama os plugins desta pasta. A ferramenta de tela pergunta ao Windows o que existe na tela (janelas, botões com nome e posição, texto das páginas), em vez de mandar uma foto para a IA. Isso é mais exato e muito mais barato. Uma foto só é usada quando a pergunta é sobre a aparência de algo.

## Problemas comuns

- **"Ollama não subiu":** abra o Ollama pelo menu Iniciar e tente de novo. Os modelos ficam em `E:\Ollama`.
- **A IA responde coisas sem sentido em inglês:** o modelo escolhido está com contexto curto. Volte para `dsh-4b:32k`.
- **A ação não fez efeito:** confira o Scroll Lock e se a janela certa estava na frente.
- **"Não achei o Gerador / Transcritor":** os plugins procuram os programas na pasta acima do DSHARNESS (`Programas desenvolvidos`). Se mudar a pasta de lugar, mude junto.
- **Resposta lenta logo depois de uma imagem ou transcrição:** é o modelo do agente voltando para a placa (5 a 15 s). Normal.
- O dsh é software em versão de testes (**0.2.2-alpha.3**, instalada em 03/11/2026): espere um comportamento estranho de vez em quando.
- **Voltar para a versão anterior** se a nova der problema: `npm install -g @deepseek-ai/dsh@0.2.1-rc.5` (a "estável" mais nova).
