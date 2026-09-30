# G3 Instagram Official — HOST PASS runbook

Este runbook fecha a diferença entre **code-ready / deployment-ready** e **HOST PASS real**. Nenhuma etapa abaixo pode ser substituída por fixture, self-test, attestation manual ou inserção direta no banco.

Referências oficiais usadas no fluxo:

- Meta Instagram API official Postman workspace: https://www.postman.com/meta/instagram/overview
- Instagram API with Instagram Login: https://www.postman.com/meta/instagram/folder/1z5vxzu/instagram-api-with-instagram-login
- Instagram Send API: https://www.postman.com/meta/instagram/folder/uxudqu0/send-api

O G3 solicita somente:

- `instagram_business_basic`
- `instagram_business_manage_messages`
- `instagram_business_manage_comments`

`instagram_business_content_publish` permanece fora do G3 enquanto publishing não estiver implementado.

## 0. Pré-condições

Antes do teste real contra a Meta:

- Supabase Free runtime saudável (`g3-runtime`, PGMQ, `pg_net`, Cron e heartbeat);
- Edge Functions `instagram-webhook` e `instagram-data-deletion` ativas;
- migrations 021, 022 e 023 aplicadas;
- Supabase Auth configurado;
- dashboard web HTTPS em `APP_ORIGIN`;
- `DATABASE_URL` usando `automation_web`, nunca `postgres`;
- TLS PostgreSQL ativo;
- `LEGAL_ENTITY_NAME` e `SUPPORT_EMAIL` configurados;
- `provider_secret_keyring` e `meta_webhook_verify_token` no Vault;
- `meta_app_secret` real no Vault antes de aceitar POSTs do provider;
- `app_private.provider_runtime_config` preenchido com App ID/endpoints/probe validados para o App Meta real;
- Security Advisor sem lints;
- CI, Free Runtime Adapter, Meta Compliance e Free Web Blueprint verdes.

Meta App ID, Graph version e endpoints OAuth **não pertencem mais ao Render**. O host recebe somente infraestrutura do web; provider config hospedada vem do Postgres e secrets vêm do Vault.

Docker ingress/outbound workers não são pré-condição do G3 Free.

### Checkpoint

Abra `/connections/instagram/readiness`.

O Readiness Center consulta `provider_runtime_config` primeiro e usa env somente como fallback self-hosted. Configuração ainda nula no banco deve aparecer como `BLOCKED`, nunca ser preenchida por suposição.

Execute o **preflight** do webhook. O GET challenge depende apenas do verify token e pode responder 200 antes do App Secret existir. O POST permanece 503/fail-closed até existir `meta_app_secret` e HMAC válido.

## 1. Configurar o App Meta

Use uma configuração compatível com Instagram Login para conta profissional Business/Creator.

No App Dashboard configure exatamente os valores apresentados pelo Readiness Center:

- OAuth redirect URI;
- webhook callback URL;
- Privacy Policy URL;
- Data Deletion instructions URL quando solicitada;
- Data Deletion callback quando solicitado processamento programático.

Webhook:

`https://<project-ref>.supabase.co/functions/v1/instagram-webhook`

Data deletion callback:

`https://<project-ref>.supabase.co/functions/v1/instagram-data-deletion`

Página informativa:

`<APP_ORIGIN>/legal/data-deletion`

Não use a rota Next como webhook primário: o web Free pode hibernar.

## 2. Registrar configuração global validada

Depois de confirmar no App Meta os valores reais, registre na linha `instagram.meta.official` de `app_private.provider_runtime_config`:

- `app_id`;
- `oauth_authorize_url`;
- `oauth_token_url`;
- `oauth_token_encoding`;
- `long_lived_token_url`;
- `graph_base_url`;
- `graph_api_version`;
- `identity_probe_path`.

Regras:

- não copiar endpoints do Instagram Basic Display legado por memória/suposição;
- não permitir que workspace admin altere essa linha;
- `automation_web` permanece SELECT-only;
- versão Graph é pinada e upgrade é explícito;
- ausência de `identity_probe_path` mantém health em `STALE` em vez de falso `HEALTHY`.

O App Secret real vai para `meta_app_secret` no Supabase Vault, nunca para `render.yaml`.

## 3. Preparar conta de teste

Use uma conta Instagram profissional **Business ou Creator** elegível para a configuração selecionada. Em development mode, configure os roles/testers exigidos pela Meta.

## 4. Concluir OAuth pela própria plataforma

Na UI:

`Connections → Instagram Official → Conectar Instagram`

Fluxo esperado:

1. usuário autenticado inicia OAuth;
2. servidor cria `state` aleatório e persiste somente hash + ator/workspace;
3. usuário autoriza na Meta;
4. callback revalida usuário, membership e permissão;
5. `state` é consumido uma vez;
6. code é trocado server-side usando config do Postgres;
7. App Secret vem do Vault;
8. token é promovido para long-lived quando suportado;
9. credencial Instagram é criptografada com o provider keyring;
10. `auth_valid=true` somente após secret reference válida;
11. identidade usada para compliance permanece separada em `provider_subject_id`.

Sem prova oficial da equivalência entre IDs, não preencher `provider_subject_id` por aproximação.

### Evidência

**OAuth real + credencial criptografada = READY**.

## 5. Configurar e provar webhook real

O endpoint implementa dois níveis independentes:

- GET: challenge com `meta_webhook_verify_token`;
- POST: HMAC SHA-256 do raw body com `meta_app_secret`.

Webhook assinado só recebe ACK de sucesso depois da persistência em `webhook_ingress_events`.

### Evidência

**Webhook assinado persistido = READY**.

Ainda não é HOST PASS.

## 6. Gerar inbound real

De uma segunda conta tester, envie uma DM para a conta profissional conectada.

Fluxo:

`Meta → instagram-webhook → durable ingress → PGMQ → g3-runtime → raw event → canonical message.received`

Não use DM fria como teste. A plataforma responde somente a identidade observada em inbound válido na mesma conexão.

### Evidência

**Mensagem real normalizada = READY**.

## 7. Responder pela plataforma

Fluxo:

`web enqueue → QUEUED → PGMQ → g3-runtime → InstagramOfficialProvider → Meta Send API → provider_message_id → SENT`

O Send API usa a base/versionamento configurados no provider runtime config. Não espalhar versão hardcoded pelo código.

### Evidência

- outbound `message_type='text'`;
- estado `SENT`, `DELIVERED` ou `READ`;
- `provider_message_id` real.

**Resposta DM real rastreada = READY**.

## 8. Resultado do gate

G3 HOST PASS só fica verdadeiro quando coexistem no mesmo workspace:

- OAuth real + secret reference válida;
- `message.received` real;
- outbound text real com `provider_message_id`.

Não existe botão administrativo para forçar PASS.

## 9. Falhas que não autorizam retry cego

Timeout/5xx/transport pós-dispatch, 2xx sem ID suficiente ou persistência falhando após side effect devem convergir para `SEND_RESULT_UNKNOWN`.

Reconciliação exige evidência externa + AuditLog.

## 10. Data deletion

Fluxo:

`Meta signed_request → instagram-data-deletion → HMAC verify → receipt hashed → exact provider_subject_id deletion → status`

Regras:

- nunca fuzzy match por nome/username;
- nunca reter signed request bruto no receipt;
- sem identidade exata resolvida → `MANUAL_REVIEW`;
- replay converge por fingerprint;
- status público não expõe identidade/secrets;
- workflow `Meta Compliance` deve permanecer verde.

Data deletion não conta como evidência de HOST PASS de mensagens, mas deve estar funcional antes de usuários reais.

## 11. Evidência a preservar

- conexão oficial;
- secret reference criptografada;
- webhook ingress real;
- raw/canonical events relevantes;
- outbound com provider message ID;
- AuditLogs;
- heartbeat do runtime durante o teste.

Nunca guardar tokens ou secrets em logs genéricos.

## 12. Critério para avançar ao G4

Somente após **G3 HOST PASS real** e callbacks de compliance configurados corretamente, o roadmap libera **G4 — WhatsApp Official**.
