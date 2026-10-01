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

1. **Code-ready** — domínio, provider, segurança e testes implementados.
2. **Deployment-ready** — runtime, migrations, filas, retries, health e observabilidade executando em infraestrutura real.
3. **HOST PASS** — OAuth + webhook + inbound + outbound reais provados contra a Meta no mesmo workspace.

Nenhum dos dois primeiros promove automaticamente o terceiro.

## Infraestrutura real atual — US$ 0 nesta fase

Projeto Supabase Free do G3:

- project ref: `cqtrigqlktekczbbsxiy`;
- região: `sa-east-1`;
- PostgreSQL 17;
- core portátil `database/001–012` + `021_meta_compliance.sql`;
- adapter Supabase Free `supabase/migrations/013–026`;
- dados do produto isolados em `app_private`;
- `anon` e `authenticated` sem acesso direto ao schema privado;
- role web dedicada `automation_web` com least privilege;
- Security Advisor sem lints após hardening atual;
- Supabase Auth para identidade/sessão;
- PGMQ/Supabase Queues para sinais duráveis;
- `pg_net` para wake-up assíncrono;
- `pg_cron` para recovery/retry;
- Edge Function `g3-runtime` como executor;
- Edge Function `instagram-webhook` como callback público da Meta;
- Edge Function `instagram-data-deletion` para compliance;
- Supabase Vault para secrets/keyring/senha da role web;
- `app_private.provider_runtime_config` para configuração global não secreta dos providers;
- Docker workers apenas como fallback futuro/self-hosting.

Não há worker pago obrigatório no G3 atual.

## Web Free

O repositório contém `render.yaml` para um único web service gratuito. O web hospeda dashboard/Auth/OAuth, enquanto callbacks críticos do provider, superfícies legais públicas e runtime assíncrono continuam no Supabase.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fvideoia070707-design%2Fteste)

O botão acima apenas abre a revisão do Blueprint na conta Render. O `render.yaml` continua sendo a fonte de verdade e os gates de CI impedem recursos pagos ou workers no G3 Free.

O Blueprint do Render foi reduzido deliberadamente. Ele não recebe App ID, endpoints Instagram, Graph version ou secrets Meta.

Entrada manual do operador no Blueprint:

- `DATABASE_URL` com a role `automation_web` via Supavisor.

Valores públicos/fixos/derivados pelo Blueprint:

- `APP_ORIGIN` a partir da URL pública do próprio serviço;
- `NEXT_PUBLIC_SUPABASE_URL` do projeto G3;
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` moderna (`sb_publishable_...`), pública por design;
- `DATABASE_POOL_MAX=3`;
- `GOOGLE_AUTH_ENABLED=false` enquanto Google OAuth não estiver configurado.

`legal_entity_name` e `support_email` pertencem a `app_private.platform_public_config` no Supabase e não são secrets/envs do Render.

O workflow **Free Web Blueprint** impede provider config/secrets de voltarem para o Render e impede provisioning pago acidental.

## Migrations: core x adapter

Dois streams permanecem separados:

- `database/001–012` + `021`: schema PostgreSQL portátil;
- `supabase/migrations/013–026`: adapter do runtime hospedado gratuito.

Destaques recentes:

- 020 — role `automation_web` least-privilege;
- 021 — Meta compliance/data deletion;
- 022 — verify token do webhook gerado no Vault;
- 023 — App ID/endpoints OAuth/Graph config/identity probe centralizados em `provider_runtime_config`;
- 024 — chave primária estável dos heartbeats;
- 025 — configuração pública das superfícies legais;
- 026 — guard de consumo OAuth por membership/role.

A migration 023 não preenche endpoints OAuth por suposição. Valores dependentes do App Meta real permanecem nulos até validação explícita.

## Runtime G3 Free

Inbound:

```text
Meta / Instagram
      ↓
instagram-webhook Edge
      ↓
webhook_ingress_events
      ↓ trigger
PGMQ instagram_ingress
      ↓ pg_net
Supabase Edge g3-runtime
      ↓
raw_events → canonical_events → outbox
```

Outbound:

```text
Web / Automation
      ↓
messages: QUEUED
      ↓ trigger
PGMQ instagram_outbound
      ↓ pg_net
g3-runtime
      ↓
Meta API
      ↓
SENT / RETRYING / FAILED / SEND_RESULT_UNKNOWN
```

A fila é acelerador. Correção e recovery continuam apoiados em tabelas duráveis, leases, idempotência e Cron.

## Reliability preservada

- webhook persistido antes do ACK;
- leases finitas;
- deduplicação + collision guard;
- retry somente quando seguro;
- resultado ambíguo pós-dispatch → `SEND_RESULT_UNKNOWN`;
- nenhum blind retry;
- reconciliation auditável;
- private reply com claim único;
- heartbeat não conta como HOST PASS;
- data deletion somente por subject exato.

## Segurança e secrets

Vault hospedado contém atualmente:

- `provider_secret_keyring`;
- `automation_web_db_password`;
- `meta_webhook_verify_token`.

`meta_app_secret` real ainda precisa ser fornecido antes do teste real contra a Meta e **não recebe placeholder**.

A role `automation_web` pode ler apenas a configuração global necessária e não pode alterar `provider_runtime_config` nem acessar diretamente o Vault.

O webhook v2 já foi provado em preflight:

- GET challenge com verify token → 200 + challenge exato;
- POST sem App Secret → 503;
- zero ingress persistido no POST não autenticado/configurado.

## Meta Data Deletion

`instagram-data-deletion` valida `signed_request`, mantém receipts mínimos/hash-only e apaga somente por `provider_subject_id` exato.

O workflow **Meta Compliance** prova:

- deleção isolada do subject exato;
- preservação de dados não relacionados;
- no-match com zero side effect;
- bloqueio de execução para `anon`/`authenticated`.

Sem prova de mapeamento entre IDs do provider, a plataforma converge para `MANUAL_REVIEW`, nunca fuzzy delete.

## O código atual já possui

- Supabase Auth SSR, workspace automático e RBAC server-side;
- OAuth Instagram com state hash-only, single-use e actor-bound;
- credenciais do provider com AES-256-GCM;
- provider keyring no Vault;
- webhook Edge com HMAC e persistência antes do ACK;
- normalização de eventos Instagram;
- DM, resposta pública a comentário e private reply/comment→DM;
- Connection Health Center e capability evidence;
- Meta Readiness Center conectado à configuração hospedada;
- páginas Privacy Policy e Data Deletion;
- dashboard Reliability;
- runtime Supabase Edge + PGMQ + Cron;
- fallback Docker portátil;
- CI com PostgreSQL real, migrations, invariants, typecheck, testes, build, containers e gates específicos.

## Instagram scopes do G3

- `instagram_business_basic`
- `instagram_business_manage_messages`
- `instagram_business_manage_comments`

`instagram_business_content_publish` permanece futuro/opcional.

G3 só fica PASS após evidência real persistida de:

1. OAuth válido com conta profissional;
2. webhook assinado real;
3. `message.received` real;
4. DM outbound real com `provider_message_id`.

Runbook: `docs/g3-host-pass-runbook.md`.

## Estrutura

- `apps/web`: dashboard, Auth, OAuth/callbacks, APIs e health/readiness
- `supabase/functions/g3-runtime`: executor gratuito
- `supabase/functions/instagram-webhook`: callback Meta
- `supabase/functions/instagram-data-deletion`: compliance
- `supabase/migrations`: adapter Supabase Free 013–026
- `apps/worker-ingress`: fallback Docker
- `apps/worker-outbound`: fallback Docker
- `packages/core`: domínio/RBAC
- `packages/providers`: contratos/capabilities
- `packages/provider-instagram-official`: adapter oficial Meta
- `packages/reliability`: estados/retry/idempotência/reconciliação
- `packages/secrets`: AES-GCM/envelope encryption
- `packages/storage-postgres`: stores + migration runner
- `database`: migrations PostgreSQL portáveis
- `docs`: gates, deployment e runbooks

## Próximos passos

- fechar publicação HTTPS do `apps/web` no tier gratuito;
- validar `automation_web` via Supavisor no host;
- configurar callback do Supabase Auth;
- preencher `provider_runtime_config` com valores validados do App Meta real;
- adicionar `meta_app_secret` real ao Vault;
- executar OAuth + webhook + inbound + outbound reais;
- fechar **G3 HOST PASS**;
- somente depois iniciar G4 — WhatsApp Official.
