# Deployment contract

A plataforma continua provider-independent e portátil, mas o **runtime padrão do G3 durante desenvolvimento/HOST PASS é gratuito e Supabase-first**.

## Runtime primário — Supabase Free

Componentes:

- PostgreSQL / `app_private`: fonte de verdade;
- Supabase Auth: identidade e sessão;
- PGMQ / Supabase Queues: sinais duráveis de wake-up;
- `pg_net`: invocação assíncrona do executor;
- `pg_cron`: recovery/retry sweep a cada 15 segundos;
- Edge Function `g3-runtime`: executor curto de ingress + outbound;
- Edge Function `instagram-webhook`: callback público da Meta com challenge + HMAC sobre raw body;
- Edge Function `instagram-oauth-callback`: callback OAuth público protegido por state one-time;
- Edge Function `instagram-data-deletion`: callback assinado de exclusão de dados + status por confirmation code;
- Edge Function `platform-legal`: Privacy Policy + instruções de exclusão;
- Supabase Vault: token interno de runtime, keyring AES-256-GCM, secrets Meta e senha da role web;
- `app_private.provider_runtime_config`: configuração global não secreta do provider;
- Setup Center `/settings`: superfície administrativa para configuração não secreta.

**Nenhum background worker pago e nenhum Render são requisitos do G3 Free.**

O dashboard Next.js pode ser executado localmente durante desenvolvimento/HOST PASS ou publicado depois em qualquer host compatível. Os callbacks críticos da Meta permanecem disponíveis no Supabase Edge mesmo quando o dashboard está offline.

## Streams de migration

O schema foi dividido deliberadamente para manter portabilidade.

### Core PostgreSQL portátil

Arquivos portáteis atuais:

- `database/001–012` — domínio, reliability, ingress/outbound state, OAuth state, health, audit e índices;
- `database/021_meta_compliance.sql` — identidade app-scoped do provider e primitivas de data deletion;
- `database/025_platform_public_config.sql` — identidade pública/legal;
- `database/026_oauth_consumption_membership_guard.sql` — membership guard no consumo do OAuth state;
- `database/027_setup_center_config_bridge.sql` — funções allowlisted para configuração administrativa não secreta.

O CI aplica todos os arquivos numerados do stream portátil em PostgreSQL puro e testa o migration runner com ledger/checksum.

### Adapter Supabase Free

Arquivos específicos do Supabase:

- `supabase/migrations/013–020` — runtime Free, Vault, pg_net/pg_cron, heartbeat e role web least-privilege;
- `021_meta_compliance.sql` — espelho idempotente do core;
- `022_meta_webhook_verify_token.sql` — verify token do webhook no Vault;
- `023_instagram_platform_config.sql` — App ID/endpoints/Graph/probe server-only;
- `024_worker_heartbeats_primary_key.sql` — hardening do heartbeat;
- `025_platform_public_config.sql` — espelho de identidade pública/legal;
- `026_oauth_consumption_membership_guard.sql` — espelho do guard de membership;
- `027_setup_center_config_bridge.sql` — espelho byte-for-byte da ponte de configuração.

As migrations compartilhadas 021/025/026/027 são comparadas byte-for-byte pelo workflow `Free Runtime Adapter`.

A migration 023 **não semeia endpoints OAuth por suposição**. App ID, authorize URL, token URL, long-lived token URL e identity probe permanecem nulos até serem confirmados contra o App Meta real.

O projeto Supabase real usa o histórico nativo de migrations. O ledger `app_private.schema_migrations` continua exclusivo do fallback portátil.

## Modelo de execução

### Webhook

1. Meta chama `instagram-webhook` no Supabase Edge;
2. GET usa o verify token do Vault;
3. POST exige App Secret e valida HMAC SHA-256 sobre raw body;
4. `webhook_ingress_events` persiste antes do ACK;
5. trigger sinaliza `instagram_ingress` no PGMQ;
6. `pg_net` acorda o `g3-runtime`;
7. Edge faz claim com lease/idempotência;
8. normaliza para raw/canonical events e outbox;
9. Cron recupera trabalho se o wake-up falhar.

### Outbound

1. API cria `messages` em `QUEUED`;
2. trigger sinaliza `instagram_outbound`;
3. `g3-runtime` faz claim e muda para `PROCESSING`;
4. chama a Meta;
5. outcome definitivo vira `SENT`, `FAILED` ou `RETRYING`;
6. timeout/5xx/transporte ambíguo pós-dispatch vira `SEND_RESULT_UNKNOWN`;
7. falha de persistência pós-dispatch preserva a ambiguidade e nunca autoriza blind retry.

PGMQ acelera entrega; PostgreSQL continua fonte autoritativa.

## Setup Center

`/settings` é a superfície administrativa do G3 para campos **não secretos**.

Owner/admin pode atualizar:

- nome jurídico/operador;
- e-mail de suporte/privacidade;
- Meta App ID;
- OAuth authorize URL;
- OAuth token URL;
- OAuth token encoding;
- long-lived token URL;
- identity probe path.

A role `automation_web` não recebe `UPDATE` direto em `platform_public_config` ou `provider_runtime_config`. A migration 027 expõe somente:

- `app_private.set_platform_public_config(...)`;
- `app_private.set_instagram_platform_config(...)`.

As funções são `SECURITY DEFINER`, possuem allowlist e validação no banco. A API `/api/settings/platform` exige `connections.manage`, valida novamente no servidor e registra AuditLog.

**Secrets nunca entram no formulário.** `meta_app_secret`, verify token e keyring permanecem no Vault.

## Segredos

Supabase Vault é a fonte canônica para:

- `g3_runtime_cron_token`;
- `provider_secret_keyring`;
- `automation_web_db_password`;
- `meta_webhook_verify_token`;
- `meta_app_secret`;
- `meta_webhook_signature_header` opcional.

No estado atual, `meta_app_secret` ainda precisa receber o valor real do App Meta. Não criar placeholder.

## Readiness Center

`/connections/instagram/readiness` deriva o readiness estrutural de:

- Supabase Edge origin;
- heartbeat recente do `g3-runtime`;
- provider config no banco;
- secrets no Vault;
- identidade legal no banco.

`APP_ORIGIN`, `DATABASE_URL`, Render e estado do host do dashboard **não bloqueiam mais o readiness estrutural do G3**.

HOST PASS continua separado e só depende de evidência real:

- OAuth real + credencial criptografada;
- `message.received` real;
- outbound text real com `provider_message_id`.

## Compliance / data deletion

`instagram-data-deletion` valida `signed_request` com o App Secret do Vault, trabalha por identidade exata e nunca faz fuzzy delete. Sem App Secret, responde fail-closed.

`platform-legal` retorna 503 enquanto `legal_entity_name` ou `support_email` estiverem ausentes.

## Dashboard web

`apps/web` continua fornecendo:

- autenticação e workspace UI;
- Connections;
- Reliability;
- Setup Center;
- Readiness Center;
- ações manuais protegidas;
- fallback das rotas provider para ambientes portáteis.

Hospedar o dashboard publicamente é uma decisão de UX/operação, não uma pré-condição para manter webhook, OAuth callback, legal/data-deletion ou runtime ativos no G3 Free.

## Fallback portátil

Continuam disponíveis:

- `apps/worker-ingress`;
- `apps/worker-outbound`;
- `Dockerfile`;
- `compose.yaml`;
- imagens GHCR.

São fallback/self-hosting/escala futura e **não requisito do G3 Free**.

## Reliability invariants

- persistência antes de ACK;
- idempotência e collision guard;
- leases recuperáveis;
- retry somente quando comprovadamente seguro;
- outcome ambíguo → `SEND_RESULT_UNKNOWN`;
- private reply com claim único;
- reconciliation auditável;
- data deletion somente por identidade exata;
- Security Advisor sem lints antes de mudança de gate.

## Ordem atual para fechar G3

1. manter runtime Supabase e Advisors saudáveis;
2. preencher no Setup Center somente os dados reais/não secretos;
3. gravar `meta_app_secret` real diretamente no Vault;
4. validar endpoints OAuth/probe contra o App Meta real — nunca por memória de Basic Display;
5. configurar App Meta com OAuth redirect, webhook, privacy e data deletion Edge URLs;
6. preparar conta Instagram Business/Creator e roles/testers;
7. concluir OAuth real;
8. receber webhook real assinado e confirmar `message.received`;
9. enviar resposta real e confirmar `provider_message_id`;
10. somente então permitir `G3 HOST PASS`.

Browser Lab continua fora do G3 e só entra em G12–G13.
