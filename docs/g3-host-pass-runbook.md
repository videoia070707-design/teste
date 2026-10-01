# G3 Instagram Official — HOST PASS runbook

Este runbook fecha a diferença entre **code-ready / deployment-ready** e **HOST PASS real**. Fixture, self-test, attestation manual, heartbeat ou inserção direta no banco nunca contam como prova do gate.

## Escopo oficial do G3

Permissões solicitadas:

- `instagram_business_basic`
- `instagram_business_manage_messages`
- `instagram_business_manage_comments`

`instagram_business_content_publish` permanece fora do G3 enquanto publishing não estiver implementado.

## 0. Arquitetura usada no HOST PASS gratuito

O caminho crítico da Meta não depende de Render nem de workers pagos:

- `instagram-oauth-callback` — Supabase Edge, callback OAuth público protegido por state;
- `instagram-webhook` — Supabase Edge, challenge + HMAC sobre raw body;
- `instagram-data-deletion` — Supabase Edge, callback programático de exclusão;
- `platform-legal` — Supabase Edge, Privacy Policy + instruções de exclusão;
- `g3-runtime` — Supabase Edge, executor ingress/outbound;
- PGMQ + `pg_net` + `pg_cron` — fila, wake-up e recovery;
- PostgreSQL `app_private` — fonte de verdade;
- Supabase Vault — secrets e keyring;
- `g3-control` — control plane owner/admin para setup e readiness;
- G3 Console local — interface operacional do HOST PASS.

O dashboard Next.js continua sendo a experiência administrativa futura e pode rodar localmente ou em host gratuito, mas os callbacks críticos da Meta permanecem ativos no Supabase Edge mesmo se o dashboard estiver offline.

Docker workers continuam fallback/escala futura e não são pré-condição do G3 Free.

## 1. Pré-condições internas

Antes do teste real contra a Meta:

- Supabase project `ACTIVE_HEALTHY`;
- Security Advisor sem lints;
- runtime `g3-runtime` com heartbeat recente;
- Cron/recovery ativo;
- `instagram-webhook`, `instagram-data-deletion`, `platform-legal`, `instagram-oauth-start`, `instagram-oauth-callback`, `g3-control` e `g3-webhook-token` ativos;
- migrations Supabase aplicadas até a versão atual;
- `provider_secret_keyring` e `meta_webhook_verify_token` no Vault;
- `meta_app_secret` real no Vault antes do fluxo OAuth/HMAC real;
- `app_private.provider_runtime_config` preenchido somente com valores validados contra o App Meta real;
- `graph_api_version_confirmed_at` preenchido somente após confirmação explícita da versão no App Meta/documentação oficial atual;
- `app_private.platform_public_config` preenchido com operador e contato reais antes de registrar páginas legais;
- CI principal + Free Runtime Adapter + G3 Console verdes.

A role `automation_web` é least-privilege e não recebe escrita genérica nas tabelas de configuração. O Setup Center escreve somente por funções allowlisted.

## 2. G3 Console / Setup Center

Execute localmente:

`pnpm g3:console`

Entre com Supabase Auth e preencha somente valores reais confirmados:

- nome jurídico/operador;
- e-mail de suporte/privacidade;
- Meta App ID;
- **Graph API version explicitamente validada**;
- Meta App Secret no campo write-only;
- OAuth authorize URL;
- OAuth token URL;
- OAuth token encoding;
- long-lived token URL;
- identity probe path.

Regras:

- App Secret é write-only: é enviado ao control plane, armazenado no Vault e limpo do formulário; nunca é carregado de volta;
- não copiar endpoints do Instagram Basic Display legado por memória;
- endpoints OAuth/probe só são aceitos quando confirmados para o App Meta real;
- a Graph API version pré-semeada no banco **não conta como confirmada**;
- preencher `Graph API version` no Console é uma confirmação operacional explícita e grava `graph_api_version_confirmed_at`;
- campo vazio preserva configuração já existente; clearing destrutivo não é implícito;
- qualquer mudança gera AuditLog.

O Console mostra readiness como booleanos derivados do banco/Vault. `Conectar Instagram` só fica habilitado quando a configuração exigida estiver READY.

## 3. URLs públicas do App Meta

Use exatamente as URLs exibidas pelo G3 Console.

### OAuth redirect

`https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/instagram-oauth-callback`

### Webhook

`https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/instagram-webhook`

### Data deletion callback programático

`https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/instagram-data-deletion`

### Privacy Policy

`https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/platform-legal?document=privacy`

### Data deletion instructions

`https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/platform-legal?document=data-deletion`

As páginas legais retornam 503 enquanto `legal_entity_name` / `support_email` não estiverem configurados. Isso é intencional.

## 4. Configurar o App Meta real

Use uma configuração compatível com conta profissional Instagram **Business ou Creator**.

No App Dashboard da Meta:

1. configure exatamente o OAuth redirect exibido pelo Console;
2. configure o webhook callback Edge;
3. registre Privacy Policy e Data Deletion URLs Edge;
4. confirme os scopes do G3;
5. configure testers/roles necessários para o modo de desenvolvimento;
6. copie o Verify Token gerado uma única vez pelo `g3-webhook-token` e use o mesmo valor no App Dashboard;
7. no G3 Console, registre App ID/App Secret/endpoints/probe e a Graph API version **somente após validação atual**.

Não usar endpoint herdado do Basic Display sem confirmação atual. Não considerar o valor armazenado `v26.0` validado apenas porque existe no banco; até confirmação explícita ele permanece `graph_api_version_confirmed_at = NULL`.

## 5. OAuth real

O usuário autenticado inicia o OAuth pela plataforma.

Fluxo:

1. plataforma valida sessão + workspace + owner/admin;
2. gera state aleatório de alta entropia;
3. persiste somente SHA-256 do state + workspace + ator + TTL;
4. redirect URI é a Edge Function `instagram-oauth-callback`;
5. Meta retorna `code + state` para a Edge Function;
6. callback consome state uma única vez;
7. o banco bloqueia consumo se o ator perdeu permissão no workspace;
8. callback carrega App ID/endpoints/version do provider config e App Secret do Vault;
9. troca authorization code server-side;
10. promove token para long-lived quando suportado pela configuração validada;
11. cifra a credencial com AES-256-GCM;
12. anexa secret reference à conexão;
13. só então `auth_valid=true`; health permanece `STALE` até as demais evidências.

### Evidência esperada

**OAuth real + credencial criptografada = READY**.

## 6. Webhook real

`instagram-webhook` possui dois fluxos:

- GET: challenge usando `meta_webhook_verify_token` do Vault;
- POST: HMAC SHA-256 sobre o **raw body** usando `meta_app_secret` do Vault.

Evento assinado só recebe ACK depois de persistir em `webhook_ingress_events`. Falha de persistência retorna 503 para permitir retry.

### Evidência esperada

**Webhook assinado persistido = READY**.

Isto isoladamente ainda não é HOST PASS.

## 7. Inbound real

De uma segunda conta tester, envie DM para a conta profissional conectada.

Fluxo:

`Meta → instagram-webhook → durable ingress → PGMQ → g3-runtime → raw event → canonical message.received`

Não usar DM fria como teste. A plataforma responde somente a identidade observada em inbound válido na mesma conexão.

### Evidência esperada

**Mensagem real normalizada = READY**.

## 8. Outbound real

Use a plataforma para responder ao inbound observado.

Fluxo:

`enqueue → QUEUED → PGMQ → g3-runtime → Instagram API → provider_message_id → SENT`

### Evidência esperada

- outbound `message_type='text'`;
- estado `SENT`, `DELIVERED` ou `READ`;
- `provider_message_id` real.

**Resposta DM real rastreada = READY**.

## 9. Resultado do gate

G3 HOST PASS só fica verdadeiro quando coexistirem no mesmo workspace:

- OAuth real + secret reference válida;
- `message.received` real;
- outbound text real com `provider_message_id`.

A configuração também precisa estar structurally READY, incluindo Graph API version explicitamente confirmada. Não existe botão administrativo para forçar PASS.

## 10. Reliability — nunca retry cego

Timeout, 5xx, transporte quebrado pós-dispatch, 2xx sem ID suficiente ou falha de persistência depois de possível side effect devem convergir para:

`SEND_RESULT_UNKNOWN`

Esse estado nunca volta automaticamente para a fila. Reconciliação exige evidência externa e AuditLog.

## 11. Compliance / data deletion

Fluxo programático:

`Meta signed_request → instagram-data-deletion → HMAC → receipt fingerprint → resolução exata de provider identity → exclusão/status`

Regras:

- sem fuzzy match por nome/username;
- não persistir signed request bruto no receipt;
- sem identidade exata → `MANUAL_REVIEW`;
- replay converge por fingerprint;
- status público não expõe identidade ou secrets.

Compliance não conta como evidência de mensagens do HOST PASS, mas deve estar funcional antes de usuários reais.

## 12. O que preservar depois do teste

- `channel_connections` da conexão oficial;
- secret reference criptografada;
- `webhook_ingress_events` real;
- raw/canonical events relevantes;
- outbound com provider message ID;
- AuditLogs;
- heartbeat do runtime durante a janela do teste.

Nunca guardar tokens ou secrets em logs genéricos.

## 13. Critério para liberar G4

Somente após **G3 HOST PASS real** e callbacks de compliance corretamente configurados o roadmap libera **G4 — WhatsApp Official**.
