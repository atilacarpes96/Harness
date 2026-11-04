# Confirmar o que é perigoso (plugin do DSHARNESS)

Deixa o agente com **acesso total**, mas faz ele **parar e perguntar** antes do que é difícil de desfazer.

## Pergunta antes de

- apagar arquivos ou pastas, ou remover algo do Windows;
- formatar ou mexer em disco;
- desligar ou reiniciar o PC;
- encerrar programas ou serviços;
- mudar registro, permissões, firewall, tarefas agendadas ou variáveis;
- rodar como administrador;
- instalar ou desinstalar programas;
- `git push`, `git reset --hard`, `git clean` e afins;
- mandar dados para fora do PC (POST, upload, e-mail, ssh);
- rodar código que não dá para conferir antes (`iex`, comando codificado);
- mover ou renomear arquivos;
- editar ou sobrescrever arquivo fora da pasta do DSHARNESS.

O pedido aparece na conversa com o motivo e os botões **Rejeitar** e **Permitir uma vez**. Sem interface (modo headless), o que é arriscado é negado sozinho.

## Como funciona

É uma lista fixa de regras, conferida antes de cada ferramenta: é rápida e previsível, ao contrário de um modelo revisor. Se você escolher na sessão o modo "danger-full-access" (sem perguntas), a trava fica quieta.
