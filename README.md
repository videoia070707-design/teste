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

## Fase atual

G0–G2 estão concluídos no core. G3 — Instagram Official — está em integração/validação de host real.

O código atual já possui:

- sessão Supabase SSR, workspace e RBAC no servidor;
- OAuth/Instagram Login com `state` persistido e consumível uma única vez;
- credenciais do provider criptografadas e referenciadas fora da UI;
- webhook com validação de assinatura e persistência antes do ACK;
- worker de ingress com lease, retry, deduplicação e collision guard;
- normalização de `message.received`, `message.sent` e `comment.received`;
- outbound worker separado do HTTP, com idempotência e `SEND_RESULT_UNKNOWN` para outcomes ambíguos;
- DM, resposta pública a comentário e private reply/comment→DM pelo provider oficial;
- claim único de private reply por comentário;
- health center, capability evidence e reconciliação manual auditável;
- dashboard de Reliability e Overview ligados ao banco real;
- G3 calculado por evidência: OAuth válido + webhook real `message.received` + DM outbound aceita com provider message ID;
- CI com PostgreSQL real para migrations, typecheck, testes e build.

G3 **não deve ser marcado PASS apenas porque o código compila**. O status só muda quando as três evidências de host real forem persistidas no workspace.

## Estrutura

- `apps/web`: dashboard web, auth, OAuth/callbacks e APIs protegidas
- `apps/worker-ingress`: processamento durável de webhooks
- `apps/worker-outbound`: envio durável e recuperação segura de side effects
- `packages/core`: tipos, RBAC e regras de domínio compartilhadas
- `packages/providers`: contratos de providers e capabilities
- `packages/provider-instagram-official`: adapter Meta/Instagram oficial
- `packages/reliability`: estados, idempotência, retry e reconciliação
- `packages/secrets`: envelope encryption e keyring
- `packages/storage-postgres`: stores PostgreSQL server-only
- `database`: migrations validadas no CI
- `docs`: decisões arquiteturais e gates

## Próximos gates

- G3: fechar HOST PASS com uma conta Instagram profissional/App Meta reais
- G4: WhatsApp Official
- G5: Unified Inbox + Contacts
