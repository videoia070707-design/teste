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

## Fase atual

G0–G2 estão concluídos no core. G3 — Instagram Official — está code-ready e em validação de host real.

O código atual já possui:

- sessão Supabase SSR, workspace e RBAC no servidor;
- OAuth/Instagram Login com `state` persistido, hash-only, consumível uma única vez e vinculado ao usuário que iniciou o fluxo;
- revalidação de membership/permissão no callback OAuth;
- credenciais do provider criptografadas e referenciadas fora da UI;
- webhook com validação de assinatura e persistência antes do ACK;
- worker de ingress com lease, retry, deduplicação e collision guard;
- normalização de `message.received`, `message.sent` e `comment.received`;
- outbound worker separado do HTTP, com idempotência e `SEND_RESULT_UNKNOWN` para outcomes ambíguos;
- DM, resposta pública a comentário e private reply/comment→DM pelo provider oficial;
- claim único de private reply por comentário;
- health center, capability evidence e reconciliação manual auditável;
- Meta Readiness Center separando configuração, attestations externas e live evidence;
- páginas públicas de Privacy Policy e Data Deletion que só ficam disponíveis quando identidade legal e contato estão configurados;
- dashboard de Reliability e Overview ligados ao banco real;
- G3 calculado por evidência: OAuth válido + webhook real `message.received` + DM outbound aceita com provider message ID;
- CI com PostgreSQL real para migrations, invariantes, typecheck, testes e build.

### Instagram scopes do G3

O OAuth atual solicita apenas as permissões usadas pelas capacidades implementadas:

- `instagram_business_basic`
- `instagram_business_manage_messages`
- `instagram_business_manage_comments`

`instagram_business_content_publish` fica separado como escopo opcional futuro. `content.publish` permanece indisponível até a função existir e ter seus próprios testes. Isso evita pedir permissão antecipadamente apenas porque a API a oferece.

G3 **não deve ser marcado PASS apenas porque o código compila ou porque um checklist foi confirmado**. O status só muda quando as evidências de host real forem persistidas no workspace.

## Estrutura

- `apps/web`: dashboard web, auth, OAuth/callbacks, Readiness Center e APIs protegidas
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
- G4: WhatsApp Official — somente depois do G3 HOST PASS
- G5: Unified Inbox + Contacts
