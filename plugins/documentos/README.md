# Documentos (plugin do DSHARNESS)

Lê PDF, Word, Excel, PowerPoint, ODT, RTF, EPUB e CSV para o agente resumir, procurar ou responder. Nada sai do PC.

**Peça assim:** "resume o PDF C:\pasta\contrato.pdf", "qual o total da planilha X?".

## O que vem junto

- **Ferramenta `ler_documento`**: converte o arquivo em texto com o anydoc e entrega em partes de 12 mil caracteres (documento grande vem em várias partes).
- A conversão fica guardada em `%TEMP%\dsh-documentos`, então pedir a parte 2, 3... é instantâneo.
- PDF escaneado (só imagem) precisa de OCR, que o conversor local não faz: o plugin avisa.

## Precisa de

- O **anydoc** instalado (vem no Pacote IA Trabalho, ou `npm install -g @firecrawl/anydoc`).
