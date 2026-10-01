# G3 Console local

Ferramenta de HOST PASS do Instagram Official usando o runtime gratuito do Supabase.

## Windows

1. Baixe/clone o repositório.
2. Abra `tools/g3-console`.
3. Dê duplo clique em `start-windows.cmd`.
4. O launcher inicia o servidor local, espera ele responder e só então abre `http://localhost:3000/`.
5. A janela `G3 Console Server` fica minimizada. Feche essa janela para encerrar o console.

O launcher usa o servidor canônico `scripts/g3-console-server.mjs`, validado pelo workflow `G3 Console`. O servidor faz bind somente em `127.0.0.1`, aplica CSP/headers de segurança e não exige Render, Replit ou outro serviço pago. `localhost` é apenas a origem usada pelo navegador e pelo Supabase Auth.

É necessário ter Node.js instalado. Não abra `index.html` diretamente via `file://`: Auth e CORS do G3 foram deliberadamente limitados à origem localhost.

## Primeiro acesso

O Supabase Auth atual permite cadastro por e-mail e exige confirmação de e-mail.

1. clique em **Criar conta**;
2. confirme o e-mail recebido;
3. reabra/retorne ao G3 Console;
4. entre com e-mail e senha;
5. no primeiro acesso autenticado, o control plane cria o workspace e torna o primeiro usuário `owner`.

Não crie usuário fake para contornar essa etapa. O HOST PASS deve ficar associado ao operador real do ambiente de teste.

## Setup do App Meta

Use o arquivo [`META-SETUP.md`](./META-SETUP.md) junto do console.

Referências oficiais atuais:

- Meta for Developers Apps: https://developers.facebook.com/apps/
- Workspace oficial Instagram API da Meta: https://www.postman.com/meta/instagram/overview
- Instagram API with Instagram Login: https://www.postman.com/meta/instagram/folder/1z5vxzu/instagram-api-with-instagram-login

O G3 usa **Instagram API with Instagram Login** para contas profissionais Business/Creator. Não substitua esse fluxo por exemplos de Instagram Basic Display ou pelo fluxo de Facebook Login apenas porque um tutorial antigo mostra endpoints parecidos.

Scopes do G3:

- `instagram_business_basic`
- `instagram_business_manage_messages`
- `instagram_business_manage_comments`

`instagram_business_content_publish` permanece fora até existir publishing no produto.

## Ordem recomendada

1. entrar no G3 Console;
2. preencher nome do operador e e-mail público de suporte/privacidade;
3. criar/abrir o App Meta adequado para Instagram API with Instagram Login;
4. preencher **Meta App ID**;
5. colar **Meta App Secret** somente no campo write-only do console;
6. preencher endpoints OAuth/identity apenas com valores confirmados para o App real;
7. em **Webhook verification**, gerar/rotacionar o Verify Token;
8. copiar o Verify Token e registrar o mesmo valor no App Meta;
9. registrar as URLs públicas exibidas no console;
10. atualizar status; somente quando `Configuration` estiver pronta o botão **Conectar Instagram** é liberado;
11. concluir OAuth real;
12. enviar uma DM real de uma segunda conta para a conta profissional conectada;
13. responder pela plataforma;
14. confirmar `provider_message_id` e deixar o dashboard derivar o G3 PASS.

## URLs públicas atuais

- OAuth callback: `https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/instagram-oauth-callback`
- Webhook callback: `https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/instagram-webhook`
- Data deletion: `https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/instagram-data-deletion`
- Privacy: `https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/platform-legal?document=privacy`

## Segurança

- O Supabase publishable key presente no HTML é público por design.
- Meta App Secret é write-only e vai para Supabase Vault.
- O Webhook Verify Token é rotacionado por uma Edge Function protegida por JWT + checagem owner/admin; o token aparece somente na resposta da rotação.
- O console não deve armazenar senha da conta, App Secret ou provider tokens em arquivos locais.
- Runtime/queues/heartbeat saudáveis não contam como HOST PASS.
- `G3 PASS` nunca é produzido por self-test; exige OAuth real, inbound real e outbound real rastreável.
