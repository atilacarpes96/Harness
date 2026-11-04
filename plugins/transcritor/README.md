# Transcritor (plugin do DSHARNESS)

Transforma fala em texto com o Whisper do seu PC, pelo chat.

**Peça assim:** "transcreve esse vídeo e me resume: https://youtube.com/...", "o que ele fala nesse áudio? C:\pasta\reuniao.mp3".

## O que vem junto

- **Ferramenta `transcrever`**: aceita link do YouTube, TikTok e Instagram (e outros sites do yt-dlp) ou um arquivo de áudio ou vídeo do PC.
- O `.txt` fica salvo ao lado do áudio. O agente recebe até 9 mil caracteres para resumir; o resto ele lê no arquivo.
- Fixar o idioma (pt, en, es) melhora a pontuação.

## Precisa de

- O programa **Transcritor** na mesma pasta de programas do DSHARNESS (usa o `youtube.py` e o `src\worker.py` dele).
- Python com whisper, torch e yt-dlp. Para Instagram, um `cookies.txt` ao lado do Transcritor.
