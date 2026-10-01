# Render Free Web — deploy do dashboard G3

Este runbook publica **somente o dashboard web** no Render Free. O runtime assíncrono, webhook, filas, Cron e secrets do provider continuam no Supabase Free.

## Invariante de custo

O `render.yaml` deve criar exatamente:

- 1 serviço `web`;
- `plan: free`;
- zero background workers;
- zero bancos Render;
- zero cron jobs Render;
- zero `preDeployCommand` pago.

O workflow `Free Web Blueprint` falha se essa regra for violada.

## 1. Abrir o Blueprint

Use o botão **Deploy to Render** do `README.md` ou importe o repositório:

`videoia070707-design/teste`

Antes de confirmar, confira que existe apenas o serviço `automation-web` em plano **Free**.

## 2. Preparar a DATABASE_URL sem usar a senha admin

O web deve usar a role PostgreSQL dedicada `automation_web`, nunca `postgres`.

No Supabase Dashboard do projeto `cqtrigqlktekczbbsxiy`:

1. Abra **Connect**.
2. Selecione **Session pooler** / Supavisor em porta `5432`.
3. Copie o hostname exato mostrado pelo Dashboard. Não adivinhe o hostname regional.
4. Em **Vault**, revele e copie o valor do secret `automation_web_db_password` diretamente para o seu gerenciador de senhas/clipboard.
5. Não cole essa senha em issue, commit, chat ou arquivo do repositório.

Monte localmente a URL no formato:

```text
postgresql://automation_web.cqtrigqlktekczbbsxiy:<PASSWORD_URL_ENCODED>@<SESSION_POOLER_HOST>:5432/postgres?sslmode=require
```

Se a senha tiver caracteres especiais, aplique percent-encoding apenas no componente da senha.

## 3. Inserir o secret no Render

No formulário do Blueprint, preencha apenas:

- `DATABASE_URL` — valor construído acima.

Os demais valores públicos do host G3 são derivados ou já declarados pelo Blueprint.

Não adicione no Render:

- `META_APP_SECRET`;
- `META_WEBHOOK_VERIFY_TOKEN`;
- provider AES keyring;
- senha `postgres`;
- service-role key;
- workers pagos.

Esses secrets continuam no Supabase Vault.

## 4. Criar o web Free

Confirme o Blueprint somente se:

- serviço = `automation-web`;
- tipo = Web Service;
- plano = Free;
- quantidade de serviços = 1.

Depois do deploy, anote a URL HTTPS pública gerada pelo Render.

## 5. Validar runtime do web

Teste:

```text
https://<render-host>/api/health/live
https://<render-host>/api/health/ready
```

Os dois precisam responder `200` antes de qualquer configuração Meta.

## 6. Configurar Supabase Auth

Com a URL final do Render, atualize **Authentication → URL Configuration** no Supabase:

- **Site URL** = `https://<render-host>`
- **Redirect URL de produção** = `https://<render-host>/auth/callback`

Use a URL exata em produção. O callback Next.js real da aplicação é `/auth/callback` e faz a troca PKCE com `exchangeCodeForSession` antes de redirecionar internamente.

Google OAuth permanece desabilitado (`GOOGLE_AUTH_ENABLED=false`) até o provider Google ser configurado de verdade. Email/senha continua sendo o caminho inicial.

## 7. Abrir o Setup Center

Depois do primeiro login:

`/settings`

O primeiro usuário autenticado cria/garante seu workspace e membership `owner` no backend.

O Setup Center configura apenas dados não secretos do App Meta e superfícies legais. Secrets Meta permanecem no Supabase Vault.

## 8. Critério de conclusão deste deploy

Este deploy está concluído quando:

- `/api/health/live` = 200;
- `/api/health/ready` = 200;
- login Supabase funciona;
- dashboard abre com workspace real;
- Reliability mostra `Supabase Edge Runtime` saudável.

Isso prova **web deployment**, não G3 HOST PASS.

G3 continua exigindo OAuth Meta real + webhook real + inbound real + outbound real com `provider_message_id`.
