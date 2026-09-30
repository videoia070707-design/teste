# Deployment contract

A plataforma continua provider-independent e portátil, mas o **runtime padrão do G3 durante desenvolvimento/HOST PASS é gratuito**.

## Runtime primário — Supabase Free

Componentes:

- PostgreSQL / `app_private`: fonte de verdade;
- Supabase Auth: identidade e sessão;
- PGMQ / Supabase Queues: sinais duráveis de wake-up;
- `pg_net`: invocação assíncrona do executor;
- `pg_cron`: recovery/retry sweep a cada 15 segundos;
- Edge Function `g3-runtime`: executor curto de ingress + outbound;
- Edge Function `instagram-webhook`: callback público da Meta com challenge + HMAC sobre raw body;
- Edge Function `instagram-data-deletion`: callback assinado de exclusão de dados + status por confirmation code;
- Supabase Vault: token interno de runtime, keyring AES-256-GCM, secrets Meta e senha da role web;
- `app_private.provider_runtime_config`: configuração global não secreta dos providers hospedados.

Nenhum background worker pago é necessário para o G3 Free.

## Streams de migration

O schema foi dividido deliberadamente para manter portabilidade sem reutilizar os números 013–020 fora do adapter Supabase.

### Core PostgreSQL portátil

Arquivos portáteis atuais:

- `database/001–012` — domínio, reliability, ingress/outbound state, OAuth state, health, audit e índices;
- `database/021_meta_compliance.sql` — identidade app-scoped do provider e primitivas de data deletion.

O intervalo 013–020 permanece reservado ao adapter Supabase. Novas migrations portáteis continuam a partir de 021.

O CI aplica **todos** os arquivos `database/[0-9][0-9][0-9]_*.sql` em PostgreSQL puro e testa o migration runner com ledger/checksum. Hoje são 13 arquivos portáteis.

### Adapter Supabase Free

Arquivos específicos do Supabase:

- `supabase/migrations/013–020` — runtime Free, Vault, pg_net/pg_cron, heartbeat e role web least-privilege;
- `supabase/migrations/021_meta_compliance.sql` — espelho idempotente da migration portátil 021;
- `supabase/migrations/022_meta_webhook_verify_token.sql` — gera o verify token do webhook diretamente no Vault;
- `supabase/migrations/023_instagram_platform_config.sql` — centraliza App ID, endpoints OAuth, Graph config e identity probe do Instagram em configuração global server-only.

A migration 023 **não semeia endpoints OAuth por suposição**. App ID, authorize URL, token URL, long-lived token URL e identity probe permanecem nulos até serem confirmados contra o App Meta real. `graph_base_url` e `graph_api_version` continuam pinados no banco e o encoding OAuth fica explicitamente controlado.

O projeto Supabase real usa o histórico nativo de migrations. O ledger `app_private.schema_migrations` é exclusivo do runner portátil e **não deve ser criado/adotado no banco Supabase atual sem procedimento explícito de reconciliação**.

Durante a fase de validação, a migration idempotente `meta_compliance` foi registrada três vezes no histórico nativo do projeto hospedado. Os objetos resultantes são únicos/idempotentes e os Advisors permanecem limpos. Não remover nem editar entradas antigas do histórico. Futuras alterações recebem novo número/nome de migration.

## Modelo de execução

Webhook:

1. Meta chama `instagram-webhook` no Supabase Edge;
2. GET usa somente o verify token do Vault; POST exige App Secret e valida HMAC SHA-256 sobre raw body;
3. `webhook_ingress_events` persiste o envelope antes do ACK;
4. trigger sinaliza `instagram_ingress` no PGMQ;
5. `pg_net` acorda o `g3-runtime`;
6. Edge faz claim com lease/idempotência;
7. normaliza para `raw_events`, `canonical_events` e outbox;
8. o sinal da fila é removido após processamento;
9. Cron recupera trabalho pronto se o wake-up falhar.

Outbound:

1. API cria `messages` em `QUEUED`;
2. trigger sinaliza `instagram_outbound`;
3. Edge faz claim e muda para `PROCESSING`;
4. chama a Meta;
5. outcome definitivo vira `SENT`, `FAILED` ou `RETRYING`;
6. timeout/5xx/transporte ambíguo após dispatch vira `SEND_RESULT_UNKNOWN`;
7. falha de persistência após dispatch preserva a ambiguidade e nunca autoriza blind retry.

PGMQ é acelerador de entrega, não fonte única de verdade.

## Data deletion da Meta

O callback hospedado é `instagram-data-deletion` e recebe `signed_request` da Meta.

Fluxo:

1. POST aceita somente form data compatível;
2. `signed_request` é validado por HMAC-SHA256 com `meta_app_secret` do Vault;
3. o provider subject não é retido em plaintext no receipt;
4. fingerprint e subject hash usam SHA-256;
5. o receipt recebe `confirmation_code` aleatório;
6. `delete_provider_subject_data()` apaga somente `provider_subject_id` exato;
7. identidade não resolvida vai para `MANUAL_REVIEW`, nunca fuzzy delete;
8. GET com `code` expõe apenas status público.

Sem `meta_app_secret`, o POST responde 503/fail-closed. O workflow `Meta Compliance` prova isolamento da exclusão e bloqueio para roles públicas.

## Segredos e configuração de provider

### Supabase Vault

- `g3_runtime_cron_token`;
- `provider_secret_keyring`;
- `automation_web_db_password`;
- `meta_webhook_verify_token`;
- `meta_app_secret` — **ainda externo/obrigatório antes do HOST PASS**;
- `meta_webhook_signature_header` — opcional, default `x-hub-signature-256`.

Já provisionados no Vault: `provider_secret_keyring`, `automation_web_db_password` e `meta_webhook_verify_token`.

Nunca criar placeholder para `meta_app_secret`.

### `provider_runtime_config`

No caminho hospedado, a configuração Meta/Instagram não secreta não pertence ao Render. A linha `instagram.meta.official` concentra:

- `app_id`;
- `oauth_authorize_url`;
- `oauth_token_url`;
- `oauth_token_encoding`;
- `long_lived_token_url`;
- `graph_base_url`;
- `graph_api_version`;
- `identity_probe_path`.

A role `automation_web` possui somente `SELECT` nessa tabela. O dashboard de tenant não pode alterar a configuração global da plataforma.

## Variáveis do web hospedado

O Blueprint Free atual exige apenas:

- `APP_ORIGIN` — derivada da URL externa do serviço;
- `NEXT_PUBLIC_SUPABASE_URL`;
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — fornecida ao serviço, não commitada no Blueprint;
- `DATABASE_URL` — role `automation_web` via Supavisor;
- `DATABASE_POOL_MAX=3`;
- `LEGAL_ENTITY_NAME`;
- `SUPPORT_EMAIL`;
- `GOOGLE_AUTH_ENABLED=false` enquanto Google OAuth não estiver configurado.

Meta App ID, Graph config e endpoints Instagram são **proibidos no `render.yaml`** pelo CI. Secrets Meta e keyring continuam Vault-owned. Env equivalente existe apenas como fallback portátil/self-hosting em `.env.example`.

## Conexão PostgreSQL do web

O host nunca usa a role administrativa `postgres`.

Migration 020 cria `automation_web` com LOGIN e privilégios mínimos; senha randômica fica no Vault. Em deploy público, `apps/web/lib/server/database.ts` recusa uma `DATABASE_URL` administrativa, exige TLS e limita o pool.

Para host IPv4, use o **Shared Supavisor Session Pooler** em `5432`:

- usuário `automation_web.<project-ref>`;
- senha correspondente a `automation_web_db_password`;
- `sslmode=require` ou verificação mais forte;
- hostname exato copiado do painel **Connect** do projeto.

Nunca adivinhar o índice do hostname `aws-[INDEX]-<region>.pooler.supabase.com`.

## Web Free

`apps/web` fornece dashboard, Supabase Auth SSR, OAuth/callbacks, APIs protegidas, health/readiness e páginas legais.

No G3 Free, callbacks críticos do provider ficam no Supabase Edge, não no host web. Isso evita perder webhook/data-deletion quando o web gratuito hiberna.

O Blueprint mantém exatamente um serviço web gratuito, sem pre-deploy pago. O workflow `Free Web Blueprint` falha se:

- o plano deixar de ser `free`;
- provider config voltar ao Render;
- secrets Vault-owned forem declarados no Blueprint;
- publishable key voltar a ser commitada;
- `DATABASE_URL` deixar de ser operator-supplied;
- pool exceder 3 conexões.

## Edge Functions

Fontes versionadas:

- `supabase/functions/g3-runtime/index.ts`;
- `supabase/functions/instagram-webhook/index.ts`;
- `supabase/functions/instagram-data-deletion/index.ts`.

`instagram-webhook` v2 separa readiness do GET e POST: challenge pode ser validado com verify token antes do App Secret existir; POST permanece fail-closed sem App Secret/HMAC válido.

HTTP 200 de Function não é evidência de HOST PASS.

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

## Fallback portátil

Continuam disponíveis `apps/worker-ingress`, `apps/worker-outbound`, `Dockerfile`, `compose.yaml` e imagens GHCR. São fallback/self-hosting e **não requisito do G3 Free**.

## Ordem atual para fechar G3

1. manter runtime Supabase e Advisors saudáveis;
2. publicar `apps/web` em HTTPS usando um único web service Free;
3. validar `automation_web` via Supavisor no host;
4. configurar callback do Supabase Auth;
5. preencher `provider_runtime_config` com App ID/endpoints/probe **validados no App Meta real**;
6. gravar `meta_app_secret` real no Vault;
7. configurar App Meta com OAuth, webhook, privacy e data deletion;
8. concluir OAuth com conta Instagram Business/Creator;
9. receber webhook real assinado e confirmar `message.received`;
10. enviar resposta real pela plataforma e confirmar `provider_message_id`;
11. somente então permitir `G3 HOST PASS`.

Browser Lab continua fora do G3 e só entra em G12–G13.
