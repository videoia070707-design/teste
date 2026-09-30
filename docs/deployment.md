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
- Supabase Vault: token interno de runtime, keyring AES-256-GCM, secrets Meta e senha da role web.

Nenhum background worker pago é necessário para o G3 Free.

## Streams de migration

O schema foi dividido deliberadamente para manter portabilidade:

### Core PostgreSQL portátil

`database/001–012`

Contém domínio, reliability, ingress/outbound state, OAuth state, health, audit e índices. Não pode depender de `pgmq`, `pg_cron`, `pg_net` ou Vault. O CI aplica este stream em PostgreSQL puro e também testa o migration runner com ledger/checksum.

### Adapter Supabase Free

`supabase/migrations/013–020`

Contém somente capacidades específicas do runtime gratuito atual:

- PGMQ queues e triggers;
- token interno no Vault;
- keyring AES no Vault;
- provider runtime config server-only;
- heartbeat genérico para Edge/Cron;
- `pg_net` wake-up;
- Cron de recovery;
- hardening de `search_path`/`pg_net`;
- identidade estável do heartbeat Edge;
- role PostgreSQL `automation_web` least-privilege e bridge allowlisted para secrets do Vault.

O projeto Supabase real usa o histórico nativo de migrations. O ledger `app_private.schema_migrations` é exclusivo do runner portátil e **não deve ser criado/adotado no banco Supabase atual sem um procedimento explícito de reconciliação**.

## Modelo de execução

Quando um webhook é persistido:

1. a Meta chama `instagram-webhook` no Supabase Edge;
2. GET de verificação usa verify token; POST valida HMAC SHA-256 sobre o raw body;
3. `webhook_ingress_events` recebe o envelope antes do ACK do provider;
4. trigger envia um sinal para `instagram_ingress` (PGMQ);
5. trigger faz wake-up assíncrono do `g3-runtime` via `pg_net`;
6. Edge Function faz claim usando o estado/lease da tabela autoritativa;
7. normaliza e persiste `raw_events`, `canonical_events` e outbox;
8. sinal de fila é removido depois do processamento;
9. se o wake-up falhar, o Cron recupera linhas prontas diretamente do banco.

Outbound usa a mesma ideia:

1. API cria `messages` em `QUEUED` com idempotency/resource claim;
2. trigger sinaliza `instagram_outbound`;
3. Edge Function faz claim e muda para `PROCESSING`;
4. chama a Meta;
5. outcome definitivo vira `SENT`, `FAILED` ou `RETRYING`;
6. timeout/5xx/transport ambíguo vira `SEND_RESULT_UNKNOWN`;
7. falha de persistência depois do dispatch preserva a lease; expiração posterior também vira `SEND_RESULT_UNKNOWN`.

A PGMQ é um acelerador de entrega, não a única fonte de verdade. Isso permite recovery mesmo se o sinal da fila se perder.

## Cron e orçamento do Free tier

O job `g3-runtime-recovery` roda a cada 15 segundos. O wake-up imediato acontece apenas quando há trabalho novo.

O desenho evita processos 24/7 e permanece dentro do objetivo de desenvolvimento/HOST PASS no plano gratuito. Frequência, batch size e estratégia serão reavaliados com métricas reais antes de beta público.

## Segredos

### Supabase Vault — padrão

- `g3_runtime_cron_token`: token aleatório entre Postgres/pg_net e a Edge Function;
- `provider_secret_keyring`: JSON do keyring AES-256-GCM usado nas credenciais de providers;
- `automation_web_db_password`: senha da role PostgreSQL dedicada ao dashboard;
- `meta_app_secret`: App Secret da Meta, compartilhado pelo OAuth web e validação HMAC do Edge webhook;
- `meta_webhook_verify_token`: token forte do challenge do webhook;
- `meta_webhook_signature_header`: opcional; default funcional é `x-hub-signature-256`.

O runtime token plaintext não fica em tabelas de produto. `app_private.runtime_invocation_tokens` guarda somente SHA-256 para validação.

O web **não recebe acesso direto ao schema `vault`**. A role `automation_web` pode executar apenas `app_private.get_platform_secret(text)`, uma função `SECURITY DEFINER` em schema privado, com `search_path` fixo, `PUBLIC EXECUTE` revogado e allowlist explícita.

### Variáveis externas ainda necessárias no web

- `APP_ORIGIN`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `DATABASE_URL` usando a role `automation_web`
- `META_APP_ID`
- `INSTAGRAM_GRAPH_BASE_URL`
- `INSTAGRAM_GRAPH_API_VERSION`
- `INSTAGRAM_IDENTITY_PROBE_PATH`
- `INSTAGRAM_OAUTH_AUTHORIZE_URL`
- `INSTAGRAM_OAUTH_TOKEN_URL`
- `INSTAGRAM_OAUTH_TOKEN_ENCODING`
- `INSTAGRAM_LONG_LIVED_TOKEN_URL`
- `LEGAL_ENTITY_NAME`
- `SUPPORT_EMAIL`

`META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_WEBHOOK_SIGNATURE_HEADER` e o provider keyring são Vault-owned no caminho hospedado. Variáveis equivalentes permanecem apenas como fallback local/self-hosting e são proibidas no Blueprint Render Free pelo CI.

## Conexão PostgreSQL do web

O host web nunca deve usar a senha administrativa do projeto Supabase.

Migration 020 cria `automation_web` com:

- `LOGIN` e senha randômica salva no Vault;
- `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`, `NOREPLICATION`, `NOBYPASSRLS`;
- grants explícitos apenas nas tabelas/funções necessárias ao G3;
- acesso negado a `app_private.runtime_invocation_tokens` e ao schema `vault`;
- timeouts de statement/lock/idle transaction.

Para Render, use o **Supavisor Session Pooler** em `5432`, porque o endpoint direto do Supabase é IPv6 e o ambiente Render é tratado como IPv4-only. A URL deve usar o usuário `automation_web.<project-ref>`, a senha de `automation_web_db_password` e `sslmode=require`. O valor final permanece somente como secret `DATABASE_URL` do serviço web.

## Web

`apps/web` continua Next.js e fornece:

- dashboard;
- Supabase Auth SSR;
- OAuth/callbacks da Meta;
- fallback de webhook para portabilidade/self-hosting;
- APIs protegidas;
- health/readiness;
- páginas legais.

No G3 Free, o callback público primário da Meta é `https://<project-ref>.supabase.co/functions/v1/instagram-webhook`, não a rota Next. Isso evita perda de webhook quando o web Free estiver hibernado.

O HOST PASS exige uma URL HTTPS pública para dashboard/OAuth/legal. Durante esta fase só devemos escolher hospedagem com tier gratuito; o executor assíncrono e o webhook permanecem no Supabase e não dependem do host do web.

## Edge Functions

Fontes versionadas:

- `supabase/functions/g3-runtime/index.ts`
- `supabase/functions/instagram-webhook/index.ts`

`g3-runtime` usa `SUPABASE_DB_URL` fornecida pelo ambiente Supabase. A rota é protegida por token interno próprio (`x-runtime-token`) validado server-side.

`instagram-webhook` é público para a Meta (`verify_jwt=false`), mas implementa sua própria autenticação: challenge token no GET e HMAC SHA-256 do raw body no POST. Na ausência dos secrets Meta, deve responder 503/fail-closed.

HTTP 200 de uma Function prova somente runtime operacional; não é evidência de G3 HOST PASS.

## Reliability invariants

- webhook persistido antes do ACK;
- idempotência por provider event ID/fingerprint;
- fingerprint incompatível → `SUSPICIOUS_EVENT_COLLISION`;
- leases recuperáveis;
- retry apenas para rejeição comprovadamente retryable;
- provider 5xx/timeout/transport pós-dispatch = outcome ambíguo;
- `SEND_RESULT_UNKNOWN` nunca retorna automaticamente para fila;
- private reply com claim único por comentário;
- reconciliation exige evidência e audit log.

## Segurança

- `app_private` permanece server-only;
- `anon`/`authenticated` não recebem `USAGE` no schema privado;
- `automation_web` usa grants mínimos e não tem `BYPASSRLS`/admin privileges;
- `pg_net` instalado no schema `extensions` conforme recomendação do Supabase;
- funções `SECURITY DEFINER` têm `search_path` explícito e `PUBLIC EXECUTE` revogado quando sensíveis;
- secrets não usam `NEXT_PUBLIC_`;
- Vault e envelopes nunca são retornados ao frontend;
- webhook HMAC usa raw body;
- runtime token não é HOST PASS evidence;
- Security Advisor deve permanecer sem lints antes de qualquer mudança de gate.

## Fallback Docker opcional

Ainda existem:

- `apps/worker-ingress`;
- `apps/worker-outbound`;
- `Dockerfile`;
- `compose.yaml`;
- workflow de imagens GHCR.

Eles preservam portabilidade para self-hosting/escala futura. **Não são requisitos do G3 Free e não devem ser provisionados em um serviço pago durante esta fase sem pedido explícito do usuário.**

O migration runner Docker continua como ferramenta de fallback e opera somente o stream `database/001–012`.

## Ordem atual para fechar G3

1. manter Supabase Free runtime saudável;
2. manter Security Advisor sem lints;
3. publicar `apps/web` em URL HTTPS usando somente um web service Free;
4. validar a conexão real do host usando `automation_web` via Supavisor;
5. configurar callback do Supabase Auth;
6. gravar `meta_app_secret` e `meta_webhook_verify_token` no Vault;
7. configurar App Meta real e URLs do Readiness Center;
8. concluir OAuth real com conta Instagram Business/Creator;
9. receber webhook real assinado e confirmar `message.received`;
10. enviar resposta real pela plataforma;
11. confirmar `provider_message_id`;
12. somente então permitir `G3 HOST PASS`.

Browser Lab continua fora do G3 e só entra em G12–G13.
