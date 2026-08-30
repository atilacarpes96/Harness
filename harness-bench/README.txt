DSH Harness Bench

Compara modelos locais do Ollama com o mesmo prompt, usando as métricas
nativas da API (load_duration, prompt_eval_duration, eval_duration,
eval_count) em vez de cronômetro manual.

Requer: Ollama rodando em http://127.0.0.1:11434

Uso:
  node harness-bench/compare.mjs --list
  node harness-bench/compare.mjs --prompt "Responda somente: OK"
  node harness-bench/compare.mjs --prompt "Descreva a imagem" --image screenshot-tool.png --models qwen3-vl:8b,qwen2.5vl:3b
  node harness-bench/compare.mjs --prompt "..." --all --think

Colunas do relatório:
  load_s        tempo para carregar o modelo (0 se já estava em memória)
  ttft_proxy_s  load_s + prompt_eval_s — aproximação de tempo-até-1o-token
                (não é TTFT real: a chamada usa stream:false; para TTFT
                exato seria necessário medir o primeiro chunk em modo stream)
  eval_s        tempo de geração da resposta
  total_s       duração total reportada pelo Ollama
  eval_tokens   tokens gerados
  tokens_per_s  eval_tokens / eval_s

Cada execução também é anexada em JSONL (--out, padrão
harness-bench/results/run.jsonl) com o prompt, timestamp e todas as
métricas — inclusive um preview da resposta — para comparar execuções
ao longo do tempo.

Modelos rodam em sequência (nunca em paralelo), para não distorcer os
tempos por disputa de GPU/CPU entre eles.
