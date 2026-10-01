# Free Web Deploy — G3 HOST PASS

Este documento cobre somente o dashboard web gratuito. O runtime assíncrono, webhook Meta, data deletion, filas e Cron já rodam no Supabase Free.

## Recurso permitido nesta fase

- exatamente 1 Render Web Service;
- `plan: free`;
- nenhum background worker Render;
- nenhum Render Postgres;
- nenhum Render Cron;
- nenhum pre-deploy pago.

O arquivo autoritativo é `render.yaml`.

## Banco do web

A aplicação pública usa a role least-privilege `automation_web`, nunca `postgres`.

O Shared Supavisor Session Pooler foi validado por conexão real em 2026-09-30:

- host: `aws-0-sa-east-1.pooler.supabase.com`
- porta: `5432`
- database: `postgres`
- project ref: `cqtrigqlktekczbbsxiy`
- role: `automation_web`
- TLS: obrigatório

Template da `DATABASE_URL`:

```text
postgresql://automation_web.cqtrigqlktekczbbsxiy:<PASSWORD_URL_ENCODED>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require
```

`<PASSWORD_URL_ENCODED>` é o valor do secret `automation_web_db_password` no Supabase Vault com percent-encoding apropriado para URI. Nunca commitá-lo, nunca colocá-lo em `NEXT_PUBLIC_*` e nunca substituí-lo pela senha da role administrativa `postgres`.

## Variáveis pedidas pelo Blueprint

O Blueprint Free deixa apenas duas entradas para o operador:

1. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
2. `DATABASE_URL`

Os demais valores são fixos/derivados no `render.yaml` ou ficam no Supabase.

## Readiness obrigatório após deploy

O deploy só é considerado utilizável quando:

```text
GET /api/health/ready
```

retorna HTTP 200 e `databaseRolePolicy = least_privilege_verified`.

Essa rota comprova, no próprio host público:

- role efetiva `automation_web`;
- não-superuser;
- sem BYPASSRLS;
- TLS ativo;
- `app_private` acessível;
- provider config legível;
- runtime tokens negados;
- Vault direto negado;
- secret bridge allowlisted disponível.

Se qualquer item falhar, o endpoint retorna 503 e o G3 não avança.

## Segurança

O web não recebe:

- `META_APP_SECRET`;
- `META_WEBHOOK_VERIFY_TOKEN`;
- provider AES keyring;
- runtime invocation token;
- senha administrativa do Supabase.

Esses valores permanecem no Supabase Vault/runtime.

## Depois que o web tiver URL HTTPS

1. configurar Site URL / redirects do Supabase Auth;
2. validar login email/senha;
3. completar identidade pública/legal da plataforma;
4. configurar App Meta real;
5. executar o G3 HOST PASS conforme `docs/g3-host-pass-runbook.md`.
