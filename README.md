# Automation Platform

Plataforma SaaS de automação para Instagram e WhatsApp.

## Princípios

- Official-first
- Provider-independent
- Observable-by-design
- Browser-capable, isolado em Labs
- Multi-tenant desde o núcleo
- Reliability antes de expansão funcional
- Gate PASS somente por evidência operacional
- Least privilege por capability implementada
- **Free-first durante desenvolvimento/HOST PASS**
- Runtime portátil: Supabase Free agora; containers continuam fallback futuro, sem lock-in

## Fase atual

G0–G2 estão concluídos. G3 — Instagram Official — está **DEPLOYMENT-READY no backend gratuito** e ainda aguarda o HOST PASS real contra a Meta.

Há três estados deliberadamente diferentes:

1. **Code-ready** — domínio, provider, segurança e testes estão implementados.
2. **Deployment-ready** — runtime, migrations, filas, retries, health e observabilidade executam em infraestrutura real.
3. **HOST PASS** — OAuth + webhook + inbound + outbound reais foram provados contra a Meta no mesmo workspace.

Nenhum dos dois primeiros estados promove automaticamente o terceiro.

## Infraestrutura real atual — US$ 0 nesta fase

Projeto Supabase Free do G3:

- project ref: `cqtrigqlktekczbbsxiy`;
- região: `sa-east-1` (São Paulo);
- PostgreSQL 17;
- migrations `001`–`018` aplicadas no fluxo do projeto;
- dados do produto isolados em `app_private`;
- `anon` e `authenticated` sem acesso direto ao schema privado;
- Security Advisor atualmente sem lints;
- Supabase Auth para identidade/sessão;
- PGMQ/Supabase Queues para sinais duráveis de ingress e outbound;
- `pg_net` para wake-up assíncrono do executor;
- `pg_cron` a cada 15 segundos como recovery/retry sweep;
- Edge Function `g3-runtime` como executor principal;
- Supabase Vault para token interno do runtime e keyring AES-256-GCM;
- provider runtime config server-only no Postgres;
- Docker workers mantidos apenas como fallback futuro/self-hosting.

O runtime foi validado no projeto real: invocações da Edge Function retornam HTTP 200, filas permanecem vazias quando não há trabalho e o recovery Cron está ativo.

**Não há worker pago obrigatório no G3 atual.** O antigo Blueprint do Render e seu CI específico foram removidos para evitar provisioning pago acidental.

## Runtime G3 Free

Fluxo principal:

```text
Instagram / Webhook
        ↓
      Web API
        ↓
webhook_ingress_events (fonte de verdade)
        ↓ trigger
PGMQ instagram_ingress
        ↓ pg_net wake-up
Supabase Edge Function g3-runtime
        ↓
raw_events → canonical_events → outbox
```

Outbound:

```text
API / Automation
      ↓
messages: QUEUED (fonte de verdade)
      ↓ trigger
PGMQ instagram_outbound
      ↓ pg_net wake-up
Supabase Edge Function g3-runtime
      ↓
Meta API
      ↓
SENT / RETRYING / FAILED / SEND_RESULT_UNKNOWN
```

A fila é um acelerador/wake-up. A correção do sistema continua apoiada no estado durável das tabelas, leases, idempotência e recovery sweep. Se um sinal de fila for perdido, o Cron recupera o trabalho pronto diretamente do banco.

### Reliability preservada

- evento persistido antes do ACK do webhook;
- leases finitas;
- deduplicação + fingerprint collision guard;
- retries com backoff somente quando seguros;
- 5xx/timeout/transporte ambíguo após dispatch → `SEND_RESULT_UNKNOWN`;
- lease outbound expirada após possível side effect → `SEND_RESULT_UNKNOWN`;
- nenhum blind retry de resultado ambíguo;
- reconciliation manual auditável;
- private reply com claim único por comentário;
- heartbeat do Edge runtime separado de evidência de HOST PASS.

## O código atual já possui

- Supabase Auth SSR, workspace automático e RBAC server-side;
- OAuth Instagram com state hash-only, single-use e actor-bound;
- credenciais do provider criptografadas com AES-256-GCM;
- keyring padrão armazenado no Supabase Vault; env keyring fica somente como fallback legado/self-host;
- webhook com HMAC e persistência antes do ACK;
- normalização de `message.received`, `message.sent` e `comment.received`;
- DM, resposta pública a comentário e private reply/comment→DM;
- Connection Health Center e capability evidence;
- Meta Readiness Center;
- páginas de Privacy Policy e Data Deletion condicionadas à identidade legal configurada;
- dashboard Reliability ligado ao banco real;
- runtime primário Supabase Edge + PGMQ + Cron;
- workers Docker equivalentes mantidos como fallback portátil;
- CI com PostgreSQL real, migrations, invariants, typecheck, testes, build e containers.

## Instagram scopes do G3

O OAuth solicita somente as permissões usadas agora:

- `instagram_business_basic`
- `instagram_business_manage_messages`
- `instagram_business_manage_comments`

`instagram_business_content_publish` permanece opcional/futuro. `content.publish` fica indisponível até a função existir e possuir testes próprios.

G3 **não deve ser marcado PASS porque o banco, Edge Function, Cron ou frontend estão online**. O status só muda após evidência real persistida de:

1. OAuth válido com conta profissional;
2. webhook assinado real;
3. `message.received` real;
4. DM outbound real aceita pela Meta com provider message ID.

Runbook: `docs/g3-host-pass-runbook.md`.

## Web

`apps/web` continua sendo Next.js e precisa de uma URL HTTPS pública para Auth/OAuth/webhook durante o HOST PASS. Nesta fase, somente opções com plano gratuito serão consideradas. O runtime assíncrono não depende do host do frontend.

## Fallback portátil

Os seguintes componentes permanecem no repositório para self-hosting ou escala futura, mas **não são requisitos do G3 Free**:

- `apps/worker-ingress`
- `apps/worker-outbound`
- `Dockerfile`
- `compose.yaml`
- release images no GHCR

Isso preserva independência do Supabase caso o volume futuro exija workers dedicados.

## Estrutura

- `apps/web`: dashboard, Auth, OAuth/callbacks, webhook e APIs
- `supabase/functions/g3-runtime`: executor gratuito de ingress/outbound
- `apps/worker-ingress`: fallback Docker para ingress
- `apps/worker-outbound`: fallback Docker para outbound
- `packages/core`: domínio/RBAC
- `packages/providers`: contratos/capabilities
- `packages/provider-instagram-official`: adapter oficial Meta
- `packages/reliability`: estados, retry, idempotência, reconciliação
- `packages/secrets`: AES-GCM/envelope encryption
- `packages/storage-postgres`: stores server-only + migration runner de fallback
- `database`: migrations imutáveis
- `docs`: gates, deployment e runbooks

## Próximos passos

- manter o G3 no runtime gratuito;
- colocar `apps/web` em uma URL HTTPS usando somente tier gratuito;
- configurar Meta App real;
- executar G3 HOST PASS;
- somente depois iniciar G4 — WhatsApp Official;
- G5 — Unified Inbox + Contacts após G4.
