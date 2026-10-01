# G3 Console local

Ferramenta de HOST PASS do Instagram Official usando o runtime gratuito do Supabase.

## Windows

1. Baixe/clone o repositório.
2. Abra `tools/g3-console`.
3. Dê duplo clique em `start-windows.cmd`.
4. O navegador abrirá `http://127.0.0.1:3000/`.
5. Mantenha a janela do launcher aberta enquanto usa o console; `Ctrl+C` encerra o servidor.

O launcher usa o servidor canônico `scripts/g3-console-server.mjs`, já validado pelo workflow `G3 Console`. Ele faz bind somente em `127.0.0.1`, aplica CSP/headers de segurança e não exige Render, Replit ou outro serviço pago.

É necessário ter Node.js instalado, que já faz parte do ambiente de desenvolvimento do projeto.

Não abra `index.html` diretamente via `file://`: Auth e CORS do G3 foram deliberadamente limitados à origem localhost.

## Segurança

- O Supabase publishable key presente no HTML é público por design.
- Meta App Secret é write-only e vai para Supabase Vault.
- O console não deve armazenar senha da conta, App Secret ou tokens em arquivos locais.
- `G3 PASS` nunca é produzido por self-test; exige OAuth real, inbound real e outbound real rastreável.
