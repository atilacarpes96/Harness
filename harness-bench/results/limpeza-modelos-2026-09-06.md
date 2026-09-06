# Limpeza de modelos — 06/09/2026

Como restaurar qualquer coisa desta lista: `ollama pull <tag>` para as tags
originais, ou `ollama create` a partir do Modelfile para as derivadas.

## Por que a soma das tags nao e a ocupacao real

Tags diferentes apontam para o mesmo arquivo de peso (blob). Antes da limpeza:
25 tags somavam 135,9 GB, e o disco tinha 64,8 GB. `dsh-4b:32k`, `dsh-4b:16k`,
`qwen3-vision:4b` e `qwen3-vl:4b-instruct` sao quatro nomes para os mesmos
3,3 GB — apagar tres deles libera zero. Por isso a conta e por GRUPO.

## Removidas — orfas (16,7 GB)

Nenhuma citada em `.dsh/settings.yaml`, no codigo, nem nos workflows do
ComfyUI. Verificado com casamento exato de tag, para nao confundir
`qwen3-vl:4b` com `qwen3-vl:4b-instruct`.

| grupo | libera |
|---|---|
| `qwen3:8b` + `qwen3-agent:8b` + `qwen3-harness:8b` | 5,2 GB |
| `llama3.1:8b` | 4,9 GB |
| `qwen3-vl:4b` + `qwen3-vl-harness:4b` | 3,3 GB |
| `llama3.2:3b` | 2,0 GB |
| `qwen2.5-coder:1.5b-base` | 1,0 GB |
| `nomic-embed-text:latest` | 0,3 GB |

## Removidas — nao liberam disco, so limpam o menu

`qwen3-vision:4b`, `qwen3-vl-harness:8b`, `qwen2.5:3b`. Compartilham peso com
modelos em uso.

## Removido — o 36B (23,9 GB)

`dsh-36b:32k` + `qwen3.6:latest`, o mesmo arquivo. Medido em 05/09/2026:
prompt eval 114 tok/s contra 7.631 do `dsh-4b:32k`, geracao 32 contra 118,
23,3 s de load frio, e 59% dos pesos na RAM porque 23,9 GB nao cabem nos
12,3 GB da placa. Na pergunta de compreensao do benchmark acertou o MESMO que
o 4B. A rota saiu do `settings.yaml` e o `modelfiles/dsh-36b-32k.Modelfile`
foi removido junto.

Para trazer de volta: `ollama pull qwen3.6` e recriar o Modelfile a partir
deste commit.

## MANTIDOS, e por que

| tag | quem usa |
|---|---|
| `dsh-4b:32k` | modelo padrao do harness |
| `dsh-4b:16k` | rota legada; mesmo peso do 32k, apagar nao liberaria nada |
| `qwen3-vl:4b-instruct` | base dos dois acima |
| `qwen3.5:4b` | **`VISION_MODEL` em `screen-tool/index.js`** — o `visao: true` chama ele |
| `dsh-8b:12k` + `qwen3-vl:8b-instruct` | rota local maior, opt-in |
| `qwen3-vl:8b` | rota no settings.yaml e no `INSTALAR_MODELOS_v8_4.ps1` do ComfyUI |
| `critico-cpu` + `qwen2.5vl:3b` | **workflows do ComfyUI** (v5, v6, v7, v8, flux_pt_loop2) |
| `critico-v83-cpu` | **workflow `gerador_imagens_v8_4_SCHNELL_Q6`** |
| `tradutor-cpu` + `qwen2.5:3b`* | **todos os 7 workflows do ComfyUI** |

Achado que quase custou caro: o gerador de imagens do ComfyUI chama modelos do
Ollama. Sem conferir os workflows, `critico-cpu`, `critico-v83-cpu` e
`tradutor-cpu` pareceriam orfaos.

## ComfyUI

`checkpoints/sd_xl_turbo_1.0_fp16.safetensors` (6,5 GB) nao e citado por
nenhum dos 7 workflows — eles sao todos Flux, e esse arquivo e SDXL. Mandado
para a Lixeira, nao apagado.

Em uso: `unet/flux1-schnell-Q4_0.gguf` (6,4 GB, 6 workflows),
`clip/t5xxl_fp8_e4m3fn.safetensors` (4,6 GB), `vae/ae.safetensors` (320 MB),
`clip/clip_l.safetensors` (235 MB).

**Pendencia separada:** o workflow mais novo, `gerador_imagens_v8_4_SCHNELL_Q6`,
pede `flux1-schnell-Q6_K.gguf`, que nao existe em disco — so o `Q4_0` esta
instalado. Esse workflow nao roda como esta.

## Conhecimento que sobrevive a remocao do 36B

A rota do `dsh-36b:32k` no `settings.yaml` carregava um achado que vale para
QUALQUER modelo "thinking" no Ollama, e que se perderia junto com ela.

O endpoint `/v1` do Ollama — que e o que o dsh usa — ignora quase todas as
formas de desligar o raciocinio. Testado em 05/09/2026 contra
`/v1/chat/completions`, com o mesmo prompt:

| como se pede | raciocinio gerado |
|---|---|
| `enable_thinking: false` | 2.319 chars |
| `think: false` no topo do corpo | 1.539 chars |
| `chat_template_kwargs` | 1.435 chars |
| **`reasoning_effort: "none"`** | **0 chars, resposta em 2,5 s** |

Ou seja: `reasoning_effort: "none"` e o unico que funciona pelo `/v1`. No dsh
isso se declara como

```yaml
reasoningEfforts:
  "off": "none"     # o valor e o wire value mandado literalmente
  high: high        # precisa de 2 niveis declarados, quirk do dsh-llm-pi-ai
```

E NAO se declara `compat: {thinkingFormat: qwen}` junto: esse switch faz o dsh
mandar `enable_thinking` no LUGAR do `reasoning_effort`, trocando o unico que
funciona pelo que nao funciona.

`PARAMETER think false` no Modelfile tambem nao existe — o `ollama create`
recusa com `unknown parameter 'think'`.

Sem isso, um modelo thinking gasta o orcamento inteiro de saida raciocinando e
devolve `content` VAZIO: medido, 512 tokens de completion e nenhuma resposta.
