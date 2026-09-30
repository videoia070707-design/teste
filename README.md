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
- Runtime portátil: containers versionados, sem dependência estrutural de Replit/Vercel/Render

## Fase atual

G0–G2 estão concluídos no core. G3 — Instagram Official — está **DEPLOYMENT-READY**. O Supabase real de teste já foi provisionado e validado; o próximo passo é provisionar os serviços do `render.yaml` e então executar o HOST PASS contra a Meta.

Há três estados deliberadamente diferentes:

1. **Code-ready** — domínio, provider, workers, segurança e testes estão implementados.
2. **Deployment-ready** — migrations, containers, health checks, worker heartbeat e release artifacts passaram pelo CI e podem ser executados em infraestrutura compatível.
3. **HOST PASS** — OAuth + webhook + inbound + outbound reais foram provados contra a Meta no mesmo workspace.

Nenhum dos dois primeiros estados promove automaticamente o terceiro.

### Infraestrutura real já provisionada

Supabase de teste do G3:

- project ref: `cqtrigqlktekczbbsxiy`;
- região: `sa-east-1` (São Paulo);
- PostgreSQL 17;
- migrations `001`–`012` aplicadas;
- `app_private` sem `USAGE` para `anon` e `authenticated`;
- advisor de segurança sem lints após as migrations;
- foreign keys críticas com índices de cobertura;
- publishable key usada apenas como chave pública de Auth/Data API; provider/database secrets continuam fora do Git.

Render:

- `render.yaml` define `automation-web`, `automation-worker-ingress` e `automation-worker-outbound`;
- web Free é apenas ambiente controlado para HOST PASS, não produção always-on;
- os dois workers usam o menor plano de background worker disponível;
- `APP_ORIGIN` deriva de `RENDER_EXTERNAL_URL`;
- shared secrets são declarados uma vez no web service e copiados para workers via `fromService` quando aplicável;
- deploy automático usa `checksPass`;
- migrations rodam no pre-deploy do worker ingress pago; web Free não usa pre-deploy;
- CI específico do Blueprint impede `preDeployCommand` em plano Free e worker Free.

O código atual já possui:

- sessão Supabase SSR, workspace e RBAC no servidor;
- OAuth/Instagram Login com `state` persistido, hash-only, consumível uma única vez e vinculado ao usuário que iniciou o fluxo;
- revalidação de membership/permissão no callback OAuth;
- credenciais do provider criptografadas e referenciadas fora da UI;
- webhook com validação de assinatura e persistência antes do ACK;
- worker de ingress com lease, retry, deduplicação e collision guard;
- normalização de `message.received`, `message.sent` e `comment.received`;
- outbound worker separado do HTTP, com idempotência semântica e `SEND_RESULT_UNKNOWN` para outcomes ambíguos;
- DM, resposta pública a comentário e private reply/comment→DM pelo provider oficial;
- claim único de private reply por comentário;
- health center, capability evidence e reconciliação manual auditável;
- Meta Readiness Center separando configuração, attestations externas e live evidence;
- páginas públicas de Privacy Policy e Data Deletion que só ficam disponíveis quando identidade legal e contato estão configurados;
- dashboard de Reliability e Overview ligados ao banco real;
- G3 calculado por evidência: OAuth válido + webhook real `message.received` + DM outbound aceita com provider message ID;
- web liveness/readiness endpoints;
- heartbeat persistente dos workers e estados `RUNNING`, `STALE`, `STOPPED`, `NOT_SEEN`;
- migration runner com advisory lock, ledger e checksum imutável;
- Dockerfile único parametrizado por serviço + Compose para web/workers/migration operation;
- release workflow que publica imagens versionadas no GHCR somente em tags `vX.Y.Z`;
- CI com PostgreSQL real para migrations, migration runner idempotente, invariantes, typecheck, testes, build, Compose e imagens Docker.

### Instagram scopes do G3

O OAuth atual solicita apenas as permissões usadas pelas capacidades implementadas:

- `instagram_business_basic`
- `instagram_business_manage_messages`
- `instagram_business_manage_comments`

`instagram_business_content_publish` fica separado como escopo opcional futuro. `content.publish` permanece indisponível até a função existir e ter seus próprios testes. Isso evita pedir permissão antecipadamente apenas porque a API a oferece.

G3 **não deve ser marcado PASS apenas porque o código compila, o container sobe ou um checklist foi confirmado**. O status só muda quando as evidências de host real forem persistidas no workspace.

Runbook operacional do teste real: `docs/g3-host-pass-runbook.md`.

## Runtime

Processos long-lived:

- `@automation/web`
- `@automation/worker-ingress`
- `@automation/worker-outbound`

Operação one-shot:

- `@automation/storage-postgres migrate`

Documentação completa: `docs/deployment.md`.

Uma tag de release válida, por exemplo `v0.1.0`, prepara publicação das imagens:

- `ghcr.io/<owner>/automation-migrate:v0.1.0`
- `ghcr.io/<owner>/automation-web:v0.1.0`
- `ghcr.io/<owner>/automation-worker-ingress:v0.1.0`
- `ghcr.io/<owner>/automation-worker-outbound:v0.1.0`

As imagens de release incluem SBOM/provenance e são portáveis para qualquer host de containers compatível.

## Estrutura

- `apps/web`: dashboard web, auth, OAuth/callbacks, Readiness Center e APIs protegidas
- `apps/worker-ingress`: processamento durável de webhooks
- `apps/worker-outbound`: envio durável e recuperação segura de side effects
- `packages/core`: tipos, RBAC e regras de domínio compartilhadas
- `packages/providers`: contratos de providers e capabilities
- `packages/provider-instagram-official`: adapter Meta/Instagram oficial
- `packages/reliability`: estados, idempotência, retry e reconciliação
- `packages/secrets`: envelope encryption e keyring
- `packages/storage-postgres`: stores PostgreSQL server-only + migration runner
- `database`: migrations imutáveis validadas no CI
- `docs`: decisões arquiteturais, gates e deployment contract

## Próximos gates

- G3: provisionar runtime público e fechar HOST PASS com uma conta Instagram profissional + App Meta reais
- G4: WhatsApp Official — somente depois do G3 HOST PASS
- G5: Unified Inbox + Contacts
