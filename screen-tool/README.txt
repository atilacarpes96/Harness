DSH Screen Analyzer

Tool: analisar_tela
Captura: E:\DSHARNESS\screenshot-tool.png
Modelo visual: qwen3.5:4b

Instalação:
1. Extraia a pasta screen-tool para E:\DSHARNESS\screen-tool
2. Feche o Harness.
3. Rode:
   cd E:\DSHARNESS
   dsh plugin --profile web add .\screen-tool
4. Verifique:
   dsh --profile web --dump-config | Select-String "screen-analyzer|dsh-screen-analyzer"
5. Inicie:
   ollama launch dsh --model qwen3-agent:8b
