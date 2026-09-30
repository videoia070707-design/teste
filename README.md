# Automation Platform

Plataforma SaaS de automação para Instagram e WhatsApp.

## Princípios

- Official-first
- Provider-independent
- Observable-by-design
- Browser-capable, isolado em Labs
- Multi-tenant desde o núcleo
- Reliability antes de expansão funcional

## Fase atual

G0–G2: fundação do produto, provider framework, capability registry e reliability core.

## Estrutura

- `apps/web`: dashboard web
- `packages/core`: tipos e regras de domínio compartilhadas
- `packages/providers`: contratos de providers e capabilities
- `packages/reliability`: estados, idempotência e reconciliação
- `docs`: decisões arquiteturais e gates

## Próximos gates

- G3: Instagram Official
- G4: WhatsApp Official
- G5: Unified Inbox + Contacts
