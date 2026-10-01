# G3 Instagram Official — HOST PASS runbook

Este runbook fecha a diferença entre **code-ready / deployment-ready** e **HOST PASS real**. Fixture, self-test, attestation manual, heartbeat ou inserção direta no banco nunca contam como prova do gate.

## Escopo oficial do G3

Permissões solicitadas:

- `instagram_business_basic`
- `instagram_business_manage_messages`
- `instagram_business_manage_comments`

`instagram_business_content_publish` permanece fora do G3 enquanto publishing não estiver implementado.

## 0. Arquitetura usada no HOST PASS gratuito

O caminho crítico da Meta não depende do host do dashboard:

- `instagram-oauth-callback` — Supabase Edge, callback OAuth público protegido por state;
- `instagram-webhook` — Supabase Edge, challenge + HMAC sobre raw body;
- `instagram-data-deletion` — Supabase Edge, callback programático de exclusão;
- `platform-legal` — Supabase Edge, Privacy Policy + instruções de exclusão;
- `g3-runtime` — Supabase Edge, executor ingress/outbound;
- PGMQ + `pg_net` + `pg_cron` — fila, wake-up e recovery;
- PostgreSQL `app_private` — fonte de verdade;
- Supabase Vault — secrets e keyring.

O dashboard Next.js continua necessário para a experiência do usuário e para iniciar o OAuth autenticado, mas webhook, legal/compliance e retorno da Meta permanecem disponíveis mesmo se um host web gratuito estiver hibernando.

Docker workers continuam fallback/escala futura e não são pré-condição do G3 Free.

## 1. Pré-condições internas

Antes do teste real contra a Meta:

- Supabase project `ACTIVE_HEALTHY`;
- Security Advisor sem lints;
- runtime `g3-runtime` com heartbeat recente;
- Cron/recovery ativo;
- `instagram-webhook`, `instagram-data-deletion`, `platform-legal` e `instagram-oauth-callback` ativos;
- migrations Supabase aplicadas até a versão atual;
- `provider_secret_keyring` e `meta_webhook_verify_token` no Vault;
- `meta_app_secret` real no Vault antes do fluxo OAuth/HMAC real;
- `app_private.provider_runtime_config` preenchido somente com valores validados contra o App Meta real;
- `app_private.platform_public_config` preenchido com operador e contato reais antes de registrar páginas legais;
- web app usa role PostgreSQL `automation_web`, nunca a senha administrativa `postgres`;
- conexão PostgreSQL pública usa TLS;
- CI principal + Free Runtime Adapter verdes.

## 2. URLs públicas do App Meta

O Readiness Center é a fonte operacional dessas URLs.

Para o projeto Supabase hospedado, o formato esperado é:

### OAuth redirect

`https://<project-ref>.supabase.co/functions/v1/instagram-oauth-callback`

### Webhook

`https://<project-ref>.supabase.co/functions/v1/instagram-webhook`

### Data deletion callback programático

`https://<project-ref>.supabase.co/functions/v1/instagram-data-deletion`

### Privacy Policy

`https://<project-ref>.supabase.co/functions/v1/platform-legal?document=privacy`

### Data deletion instructions

`https://<project-ref>.supabase.co/functions/v1/platform-legal?document=data-deletion`

As páginas legais retornam 503 enquanto `legal_entity_name` / `support_email` não estiverem configurados. Isso é intencional: documento incompleto não deve parecer publicado.

## 3. Configurar o App Meta real

Use uma configuração de Instagram compatível com conta profissional **Business ou Creator**.

Depois de validar os valores no App Dashboard, registre no provider global:

- `app_id`;
- `oauth_authorize_url`;
- `oauth_token_url`;
- `oauth_token_encoding`;
- `long_lived_token_url`;
- `graph_base_url`;
- `graph_api_version`;
- `identity_probe_path`.

Regras:

- não copiar endpoints do Instagram Basic Display legado por memória;
- versão Graph é pinada e upgrade é explícito;
- `identity_probe_path` ausente mantém health em `STALE`, nunca falso `HEALTHY`;
- `meta_app_secret` vai somente para Supabase Vault;
- workspace admins não alteram provider runtime config global.

## 4. OAuth real

O usuário autenticado inicia o OAuth pelo dashboard.

Fluxo:

1. web valida sessão + workspace + `connections.manage`;
2. gera state aleatório de alta entropia;
3. persiste somente SHA-256 do state + workspace + ator + TTL;
4. redirect URI usado na autorização é a Edge Function `instagram-oauth-callback`;
5. Meta retorna `code + state` para a Edge Function;
6. callback consome state uma única vez;
7. o banco bloqueia consumo se o ator deixou de ser owner/admin do workspace;
8. callback carrega App ID/endpoints do provider config e App Secret do Vault;
9. troca authorization code server-side;
10. promove token para long-lived quando suportado;
11. cifra a credencial com AES-256-GCM usando o mesmo AAD do restante da plataforma;
12. anexa a secret reference à conexão;
13. só então `auth_valid=true` e health inicial permanece `STALE` até as demais evidências.

O callback público não depende de cookie do dashboard: a autorização do retorno é representada pelo state de alta entropia, curto, one-time e ligado ao ator/workspace. Revogação de membership antes do consumo invalida o state no banco.

### Evidência esperada

**OAuth real + credencial criptografada = READY**.

## 5. Webhook real

`instagram-webhook` possui dois fluxos separados:

- GET: challenge usando `meta_webhook_verify_token`;
- POST: HMAC SHA-256 sobre o **raw body** usando `meta_app_secret`.

Evento assinado só recebe ACK de sucesso depois de ser persistido em `webhook_ingress_events`. Falha de persistência retorna 503 para permitir retry do provider.

### Evidência esperada

**Webhook assinado persistido = READY**.

Isso isoladamente ainda não é HOST PASS.

## 6. Inbound real

De uma segunda conta tester, envie DM para a conta profissional conectada.

Fluxo:

`Meta → instagram-webhook → durable ingress → PGMQ → g3-runtime → raw event → canonical message.received`

Não usar DM fria como teste. A plataforma responde somente a identidade observada em inbound válido na mesma conexão.

### Evidência esperada

**Mensagem real normalizada = READY**.

## 7. Outbound real

Use a plataforma para responder ao inbound observado.

Fluxo:

`enqueue → QUEUED → PGMQ → g3-runtime → Instagram API → provider_message_id → SENT`

A chamada usa base/versionamento centralizados no provider config.

### Evidência esperada

- outbound `message_type='text'`;
- estado `SENT`, `DELIVERED` ou `READ`;
- `provider_message_id` real.

**Resposta DM real rastreada = READY**.

## 8. Resultado do gate

G3 HOST PASS só fica verdadeiro quando coexistirem no mesmo workspace:

- OAuth real + secret reference válida;
- `message.received` real;
- outbound text real com `provider_message_id`.

Não existe botão administrativo para forçar PASS.

## 9. Reliability — nunca retry cego

Timeout, 5xx, transporte quebrado pós-dispatch, 2xx sem ID suficiente ou falha de persistência depois de possível side effect devem convergir para:

`SEND_RESULT_UNKNOWN`

Esse estado nunca volta automaticamente para a fila. Reconciliação exige evidência externa e AuditLog.

## 10. Compliance / data deletion

Fluxo programático:

`Meta signed_request → instagram-data-deletion → HMAC → receipt fingerprint → resolução exata de provider identity → exclusão/status`

Regras:

- sem fuzzy match por nome/username;
- não persistir signed request bruto no receipt;
- sem identidade exata → `MANUAL_REVIEW`;
- replay converge por fingerprint;
- status público não expõe identidade ou secrets.

Compliance não conta como evidência de mensagens do HOST PASS, mas deve estar funcional antes de usuários reais.

## 11. O que preservar depois do teste

- `channel_connections` da conexão oficial;
- secret reference criptografada;
- `webhook_ingress_events` real;
- raw/canonical events relevantes;
- outbound com provider message ID;
- AuditLogs;
- heartbeat do runtime durante a janela do teste.

Nunca guardar tokens ou secrets em logs genéricos.

## 12. Critério para liberar G4

Somente após **G3 HOST PASS real** e callbacks de compliance corretamente configurados o roadmap libera **G4 — WhatsApp Official**.
