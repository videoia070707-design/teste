# Arquitetura G0–G2

## Objetivo

Construir uma base independente de hospedagem para uma plataforma SaaS de automação Instagram + WhatsApp, priorizando confiabilidade antes de expansão funcional.

## Decisões

### Modular monolith + workers
O core começa como monólito modular, com fronteiras claras de domínio. Webhooks, outbound, automations e Browser Lab serão workers separados quando implementados.

### Provider-independent
O domínio não conhece detalhes da Meta. Cada integração implementa `ChannelProvider` e declara suas capabilities.

### Official-first
Providers oficiais são o caminho padrão. Browser/session fica isolado em Labs e nunca é failover silencioso.

### Observable-by-design
Toda ação crítica deve carregar `correlationId`, gerar estados explícitos e poder ser reconstruída a partir de eventos persistidos.

## Fluxo de evento

Provider Webhook → Raw Event → validação → deduplicação → normalização → Canonical Event → Automation Runtime / Inbox → Outbox → Provider

## Regra de envio ambíguo

Timeout de transporte não equivale a falha. O estado `SEND_RESULT_UNKNOWN` bloqueia retry automático até reconciliação com o provider ou outra evidência suficiente. Isso evita duplicar mensagens quando o provider aceitou o envio mas a resposta se perdeu.

## Health

O status de conexão é derivado de autenticação, reachability, freshness, webhook e capabilities. `connected=true` isolado não é aceito como indicador de saúde.

Estados:
- HEALTHY
- DEGRADED_PARTIAL
- STALE
- AUTH_EXPIRED
- DISCONNECTED

## Idempotência

`providerEventId` é a primeira chave de deduplicação, mas colisão suspeita não é descartada silenciosamente. Eventos com o mesmo ID e fingerprint incompatível devem ser enviados para investigação.

## Próximo gate

G3 implementará Instagram Official sobre esses contratos sem alterar o domínio central.
