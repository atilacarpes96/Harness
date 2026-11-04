# Gerador de Imagens (plugin do DSHARNESS)

Gera imagens no seu PC pelo chat, com o ComfyUI e a placa de vídeo. Nada vai para a internet.

**Peça assim:** "gera uma imagem de um farol numa praia ao pôr do sol", "faz 3 versões em retrato", "estilo anime".

## O que vem junto

- **Ferramenta `gerar_imagem`**: escolhe o modelo (Qwen, Qwen rápido, Flux, Anime), o formato e a quantidade. O pedido passa antes pelo "Melhorar prompt" do Gerador, e a imagem aparece dentro do chat.
- **Ferramenta `comfyui`**: diz se o ComfyUI está ligado e desliga quando você pedir.
- **Botão ComfyUI na barra lateral**: mostra se está ligado e quanta memória usa, com o botão de desligar e a opção "desligar sozinho depois de cada imagem".

Desligar libera a memória, mas a próxima imagem leva cerca de 1 minuto a mais (o ComfyUI precisa ligar de novo). Com ele ligado, cada imagem sai em uns 40 s.

## Precisa de

- O programa **Gerador de Imagens** na mesma pasta de programas do DSHARNESS (usa o `gerar.py` dele).
- ComfyUI instalado e uma placa de vídeo com pelo menos 12 GB.
- Antes de gerar, o plugin tira o modelo do agente da placa; ele volta sozinho na resposta seguinte.
