# G3 Instagram Official — HOST PASS runbook

Este runbook fecha a diferença entre **code-ready / deployment-ready** e **HOST PASS real**. Nenhuma etapa abaixo pode ser substituída por fixture, self-test, attestation manual ou inserção direta no banco.

Referências oficiais usadas no fluxo:

- Meta Instagram API official Postman workspace: https://www.postman.com/meta/instagram/overview
- Instagram API with Instagram Login: https://www.postman.com/meta/instagram/folder/1z5vxzu/instagram-api-with-instagram-login
- Instagram Send API: https://www.postman.com/meta/instagram/folder/uxudqu0/send-api

A documentação oficial atual descreve Instagram Login para contas profissionais Business/Creator. O G3 solicita apenas as permissões efetivamente usadas:

- `instagram_business_basic`
- `instagram_business_manage_messages`
- `instagram_business_manage_comments`

`instagram_business_content_publish` continua fora do G3 enquanto publishing não estiver implementado.

## 0. Pré-condições

Antes de tocar na Meta, o ambiente precisa ter:

- Supabase Free runtime saudável (`g3-runtime`, PGMQ, `pg_net`, Cron e heartbeat);
- Edge Function pública `instagram-webhook` ativa e fail-closed sem configuração Meta;
- Edge Function pública `instagram-data-deletion` ativa e protegida por `signed_request` HMAC;
- migration 021 de Meta compliance presente no schema e no histórico hospedado;
- Supabase Auth configurado;
- dashboard web publicado em HTTPS em `APP_ORIGIN`;
- `DATABASE_URL` do web usando a role least-privilege `automation_web`, nunca `postgres`;
- conexão pública PostgreSQL criptografada (`sslmode=require` no mínimo);
- `LEGAL_ENTITY_NAME` e `SUPPORT_EMAIL` configurados;
- `provider_secret_keyring` no Supabase Vault;
- `meta_app_secret` e `meta_webhook_verify_token` no Supabase Vault;
- `META_APP_ID` no web;
- URLs OAuth/Graph/versionamento explícitas;
- `INSTAGRAM_IDENTITY_PROBE_PATH` validado contra a API real;
- Security Advisor sem lints;
- CI principal, Free Runtime Adapter e Free Web Blueprint verdes.

Docker ingress/outbound workers **não são pré-condição do G3 Free**. Eles são fallback portátil. O runtime primário é Supabase Edge + PGMQ + Cron.

### Checkpoint

Abra:

`/connections/instagram/readiness`

A seção **Runtime configuration** precisa estar pronta. Em ambiente público, `DATABASE_URL TLS` deve estar `READY`.

Execute **preflight**. O preflight chama o webhook Edge público com um challenge sintético e exige a resposta exata. Isso comprova configuração de rede/TLS/Function/Vault/challenge, mas **não cria raw event, canonical event, mensagem ou HOST PASS**.

## 1. Configurar o App Meta

Use um app apropriado ao cenário empresarial e habilite Instagram compatível com **Instagram Login**.

No App Dashboard, configure exatamente os valores apresentados pelo Readiness Center:

- OAuth redirect URI;
- webhook callback URL;
- Privacy Policy URL;
- URL pública de instruções de exclusão quando o App Dashboard solicitar uma página informativa;
- callback de Data Deletion quando o App Dashboard solicitar processamento programático.

O webhook callback do G3 Free deve apontar para:

`https://<project-ref>.supabase.co/functions/v1/instagram-webhook`

O callback programático de exclusão deve apontar para:

`https://<project-ref>.supabase.co/functions/v1/instagram-data-deletion`

A página pública de instruções permanece:

`<APP_ORIGIN>/legal/data-deletion`

Não aponte a Meta para a rota Next como webhook primário. O web Free pode hibernar; callbacks do provider precisam continuar disponíveis no Supabase Edge.

`instagram-data-deletion` usa `verify_jwt=false` porque a Meta não possui sessão Supabase. O POST só é aceito depois de validar o `signed_request` com HMAC-SHA256 usando o `meta_app_secret` real do Vault. A resposta de aceite retorna `url` de status e `confirmation_code`. Replays da mesma solicitação convergem para o mesmo receipt por fingerprint, em vez de criar deleções independentes.

Registre em **External readiness** as confirmações operacionais. Attestations ajudam o acompanhamento, mas não passam o gate.

## 2. Preparar conta de teste

A conta usada no teste deve ser uma conta profissional Instagram **Business ou Creator** e elegível para a configuração selecionada.

Em modo de desenvolvimento, configure os roles/testers exigidos pela Meta para o app e para a conta profissional usada no teste.

## 3. Concluir OAuth pela própria plataforma

Na UI:

`Connections → Instagram Official → Conectar Instagram`

Fluxo esperado:

1. usuário autenticado inicia OAuth;
2. servidor cria `state` aleatório, persiste somente o hash e vincula ator/workspace;
3. usuário autoriza na Meta;
4. callback revalida usuário + membership + permissão;
5. `state` é consumido uma única vez;
6. authorization code é trocado server-side;
7. Meta App Secret é obtido do Vault pela bridge allowlisted, não por variável pública;
8. token é promovido ao formato long-lived suportado;
9. credencial do Instagram é criptografada com o provider keyring;
10. `channel_connections.auth_valid=true` somente depois da secret reference ser anexada;
11. a identidade app-scoped retornada/confirmada pelo provider é mantida separada em `provider_subject_id` para callbacks de compliance, sem substituir a identidade de conta usada pela API.

### Evidência esperada

No Readiness Center:

- **OAuth real + credencial criptografada = READY**.

Se falhar, não edite tabelas manualmente para “desbloquear” o gate.

## 4. Configurar e provar webhook real

Configure no App Dashboard da Meta as assinaturas necessárias às capacidades do G3 — mensagens e comentários — conforme o produto disponibilizar para o app.

O endpoint primário implementa:

- GET: challenge com `meta_webhook_verify_token` lido do Vault;
- POST: HMAC SHA-256 sobre o **raw body** usando `meta_app_secret` lido do Vault.

A Function está com `verify_jwt=false` porque a chamada vem da Meta, mas isso não significa endpoint sem autenticação: a autenticação é específica do provider. Sem secrets configurados, responde 503/fail-closed.

### Regra de persistência

Webhook assinado só recebe ACK de sucesso depois que o payload foi persistido em `webhook_ingress_events`. Se a persistência falhar, o endpoint retorna erro para permitir retry do provider.

### Evidência esperada

O Readiness Center deve mostrar:

- **Webhook assinado persistido = READY**.

Isto ainda não basta para HOST PASS: precisamos de uma mensagem real normalizada.

## 5. Gerar inbound real

A partir de uma **segunda conta Instagram de teste**, envie uma DM para a conta profissional conectada.

Não use DM fria como teste. O G3 responde apenas a uma identidade observada em `message.received` verificado na mesma conexão.

Fluxo esperado:

`Meta → instagram-webhook Edge → durable ingress → PGMQ wake-up → g3-runtime → raw event → normalizer → canonical event message.received`

### Evidência esperada

No Readiness Center:

- **Mensagem real normalizada = READY**.

No Reliability Center, deve existir o evento canônico correspondente.

## 6. Responder pela plataforma

No Readiness Center, envie o challenge exato mostrado pela UI a partir da segunda conta tester. A plataforma só habilita a resposta HOST PASS depois de observar esse `message.received` específico.

Fluxo esperado:

`web enqueue → message QUEUED → PGMQ signal → g3-runtime claim → InstagramOfficialProvider → Meta Send API → provider_message_id → SENT`

O Send API oficial usa a forma:

`https://graph.instagram.com/{api_version}/{ig_user_id}/messages`

A versão é configuração explícita; não deve ser hardcoded em múltiplos pontos.

### Evidência esperada

No banco/Readiness Center:

- outbound `message_type='text'`;
- `delivery_state` em `SENT`, `DELIVERED` ou `READ`;
- `provider_message_id` real retornado pela Meta.

No Readiness Center:

- **Resposta DM real rastreada = READY**.

## 7. Resultado do gate

G3 HOST PASS só pode ficar verdadeiro quando, no mesmo workspace, coexistirem:

- OAuth real + secret reference válida;
- `message.received` de webhook real;
- outbound text DM real com `provider_message_id`.

O Overview deriva o estado do banco. Não existe botão administrativo para forçar PASS.

## 8. Casos de falha que NÃO autorizam retry cego

Se a chamada à Meta:

- atingir timeout depois do dispatch;
- fechar transporte depois do dispatch;
- retornar 5xx ambíguo;
- retornar 2xx sem ID suficiente para confirmar o side effect;
- for aceita pela Meta mas a persistência do resultado falhar;

então o estado deve convergir para:

`SEND_RESULT_UNKNOWN`

A mensagem não volta automaticamente à fila. Reconciliação exige evidência externa + AuditLog.

## 9. Data deletion — prova separada de compliance

Data deletion não conta como evidência de HOST PASS de mensagens, mas precisa estar funcional antes de abrir o produto a usuários reais.

Fluxo esperado:

`Meta signed_request → instagram-data-deletion → HMAC verify → receipt hashed → exact provider_subject_id deletion → confirmation status`

Regras:

- nunca fazer fuzzy match por nome, username ou external account parecido;
- nunca gravar o `signed_request` bruto nem o provider subject plaintext no receipt;
- conexão legada sem `provider_subject_id` resolvível vai para `MANUAL_REVIEW`;
- a solicitação repetida usa o mesmo fingerprint/receipt;
- o status público não expõe identificadores internos, secrets ou identidade do usuário.

## 10. Evidência que deve ser preservada após o teste

- `channel_connections` da conexão oficial;
- secret reference criptografada;
- `webhook_ingress_events` do evento real;
- `raw_events` e `canonical_events` relevantes;
- outbound `messages` com `provider_message_id`;
- AuditLogs das ações manuais;
- heartbeat do runtime durante a janela do teste.

Para exclusão iniciada pelo provider, o receipt mínimo em `data_deletion_requests` substitui a retenção dos dados apagados e contém somente hashes, contadores, status e confirmation code.

Não guardar tokens ou secrets em logs de aplicação genéricos.

## 11. Critério para avançar ao G4

Somente depois de o dashboard derivar **G3 HOST PASS** com as provas acima, e de os callbacks de compliance estarem configurados corretamente no App Meta, o roadmap libera implementação/validação do **G4 — WhatsApp Official**.
