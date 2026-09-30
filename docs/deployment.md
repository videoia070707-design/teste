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
- Supabase Vault: token interno de runtime e keyring AES-256-GCM.

Nenhum background worker pago é necessário para o G3 Free.

## Streams de migration

O schema foi dividido deliberadamente para manter portabilidade:

### Core PostgreSQL portátil

`database/001–012`

Contém domínio, reliability, ingress/outbound state, OAuth state, health, audit e índices. Não pode depender de `pgmq`, `pg_cron`, `pg_net` ou Vault. O CI aplica este stream em PostgreSQL puro e também testa o migration runner com ledger/checksum.

### Adapter Supabase Free

`supabase/migrations/013–019`

Contém somente capacidades específicas do runtime gratuito atual:

- PGMQ queues e triggers;
- token interno no Vault;
- keyring AES no Vault;
- provider runtime config server-only;
- heartbeat genérico para Edge/Cron;
- `pg_net` wake-up;
- Cron de recovery;
- hardening de `search_path`/`pg_net`;
- identidade estável do heartbeat Edge.

O projeto Supabase real usa o histórico nativo de migrations. O ledger `app_private.schema_migrations` é exclusivo do runner portátil e **não deve ser criado/adotado no banco Supabase atual sem um procedimento explícito de reconciliação**.

## Modelo de execução

Quando um webhook é persistido:

1. `webhook_ingress_events` recebe o envelope antes do ACK do provider;
2. trigger envia um sinal para `instagram_ingress` (PGMQ);
3. trigger faz wake-up assíncrono do `g3-runtime` via `pg_net`;
4. Edge Function faz claim usando o estado/lease da tabela autoritativa;
5. normaliza e persiste `raw_events`, `canonical_events` e outbox;
6. sinal de fila é removido depois do processamento;
7. se o wake-up falhar, o Cron recupera linhas prontas diretamente do banco.

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

- `g3_runtime_cron_token`: token aleatório usado entre Postgres/pg_net e a Edge Function;
- `provider_secret_keyring`: JSON do keyring AES-256-GCM usado para criptografar/decriptar credenciais de providers.

O token plaintext não fica em tabelas de produto. `app_private.runtime_invocation_tokens` guarda somente SHA-256 para validação.

### Variáveis externas ainda necessárias no web

- `APP_ORIGIN`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `DATABASE_URL`
- `META_APP_ID`
- `META_APP_SECRET`
- `META_WEBHOOK_VERIFY_TOKEN`
- `META_WEBHOOK_SIGNATURE_HEADER`
- `INSTAGRAM_GRAPH_BASE_URL`
- `INSTAGRAM_GRAPH_API_VERSION`
- `INSTAGRAM_IDENTITY_PROBE_PATH`
- `INSTAGRAM_OAUTH_AUTHORIZE_URL`
- `INSTAGRAM_OAUTH_TOKEN_URL`
- `INSTAGRAM_OAUTH_TOKEN_ENCODING`
- `INSTAGRAM_LONG_LIVED_TOKEN_URL`
- `LEGAL_ENTITY_NAME`
- `SUPPORT_EMAIL`

O keyring via `PROVIDER_SECRET_CURRENT_KEY_VERSION` / `PROVIDER_SECRET_KEYS_JSON` é apenas fallback legado/self-hosting. No caminho Supabase Free, o web usa o Vault.

## Web

`apps/web` continua Next.js e fornece:

- dashboard;
- Supabase Auth SSR;
- OAuth/callbacks da Meta;
- webhook público com raw body/HMAC;
- APIs protegidas;
- health/readiness;
- páginas legais.

O HOST PASS exige uma URL HTTPS pública. Durante esta fase só devemos escolher hospedagem com tier gratuito; o executor assíncrono permanece no Supabase e não depende do host do web.

## Edge Function

Fonte versionada:

`supabase/functions/g3-runtime/index.ts`

A função usa `SUPABASE_DB_URL` fornecida pelo próprio ambiente Supabase. A rota é protegida por token interno próprio (`x-runtime-token`) verificado por hash server-only, então o deploy atual não depende de sessão de usuário para chamadas de Cron/pg_net.

A Function não é evidência de G3 HOST PASS. HTTP 200 prova somente runtime operacional.

## Reliability invariants

- webhook persistido antes do ACK;
- idempotência por provider event ID;
- fingerprint incompatível → `SUSPICIOUS_EVENT_COLLISION`;
- leases recuperáveis;
- retry apenas para rejeição comprovadamente retryable;
- provider 5xx/timeout/transport pós-dispatch = outcome ambíguo;
- `SEND_RESULT_UNKNOWN` nunca retorna automaticamente para fila;
- private reply com claim único por comentário;
- reconciliation exige evidência e audit log.

## Segurança

- `app_private` permanece server-only;
- `anon`/`authenticated` não recebem `USAGE` no schema;
- `pg_net` instalado no schema `extensions` conforme recomendação do Supabase;
- funções SECURITY DEFINER têm `search_path` explícito;
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
3. publicar `apps/web` em URL HTTPS usando tier gratuito;
4. configurar callback do Supabase Auth;
5. configurar App Meta real e URLs do Readiness Center;
6. concluir OAuth real com conta Instagram Business/Creator;
7. receber webhook real assinado e confirmar `message.received`;
8. enviar resposta real pela plataforma;
9. confirmar `provider_message_id`;
10. somente então permitir `G3 HOST PASS`.

Browser Lab continua fora do G3 e só entra em G12–G13.
