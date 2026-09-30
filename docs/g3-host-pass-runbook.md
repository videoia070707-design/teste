# G3 Instagram Official — HOST PASS runbook

Este runbook fecha a diferença entre **code-ready / deployment-ready** e **HOST PASS real**. Nenhuma etapa abaixo pode ser substituída por fixture, self-test, attestation manual ou inserção direta no banco.

Referências operacionais oficiais utilizadas na definição deste fluxo:

- Meta Instagram API official Postman workspace: https://www.postman.com/meta/instagram/overview
- Instagram API with Instagram Login: https://www.postman.com/meta/instagram/folder/1z5vxzu/instagram-api-with-instagram-login
- Instagram Send API: https://www.postman.com/meta/instagram/folder/uxudqu0/send-api

A documentação oficial atual descreve Instagram Login para contas profissionais Business/Creator. O G3 solicita apenas as permissões efetivamente usadas no produto atual:

- `instagram_business_basic`
- `instagram_business_manage_messages`
- `instagram_business_manage_comments`

`instagram_business_content_publish` não faz parte do G3 enquanto publishing não estiver implementado.

## 0. Pré-condições

Antes de tocar na Meta, o ambiente precisa ter:

- PostgreSQL real acessível pelo web e pelos workers;
- Supabase Auth configurado;
- domínio HTTPS público em `APP_ORIGIN`;
- `LEGAL_ENTITY_NAME` e `SUPPORT_EMAIL` configurados;
- keyring de secrets configurado;
- `META_APP_ID`, `META_APP_SECRET` e `META_WEBHOOK_VERIFY_TOKEN` no secret manager;
- URLs OAuth/Graph/versionamento explícitas;
- `INSTAGRAM_IDENTITY_PROBE_PATH` explicitamente validado para a versão real da API;
- migration runner executado com sucesso;
- web `/api/health/live` = 200;
- web `/api/health/ready` = 200;
- ingress worker = `RUNNING` no Reliability Center;
- outbound worker = `RUNNING` no Reliability Center.

### Checkpoint

Abra:

`/connections/instagram/readiness`

A seção **Runtime configuration** precisa estar pronta. Execute **preflight local**. O resultado `ready` comprova somente estrutura/configuração local; nunca conta como HOST PASS.

## 1. Configurar o App Meta

Use um app apropriado ao cenário empresarial e habilite o produto/configuração de Instagram compatível com **Instagram Login**.

No App Dashboard, configure exatamente os valores apresentados pelo nosso Readiness Center:

- OAuth redirect URI;
- webhook callback URL;
- Privacy Policy URL;
- Data Deletion URL.

Não digite versões alternativas dessas URLs manualmente. Elas são derivadas de `APP_ORIGIN` para impedir divergência entre deploy e App Dashboard.

Registre no **External readiness** as confirmações operacionais. Essas attestations servem para acompanhamento, não para passar o gate.

## 2. Preparar conta de teste

A conta usada no teste deve ser uma conta profissional Instagram **Business ou Creator** e estar elegível para o produto/configuração selecionado.

Para testes em modo de desenvolvimento, configure os roles/testers exigidos pela Meta para o app e para a conta profissional usada no teste.

A documentação oficial do Send API também exige, em ambiente de teste, que os testers tenham os roles/permissões necessários no app e na conta profissional.

## 3. Concluir OAuth pela própria plataforma

Na UI:

`Connections → Instagram Official → Conectar Instagram`

O fluxo esperado é:

1. usuário autenticado inicia OAuth;
2. servidor cria `state` aleatório, persiste somente o hash e vincula ao ator/workspace;
3. usuário autoriza na Meta;
4. callback revalida usuário + membership + permissão;
5. `state` é consumido uma única vez;
6. authorization code é trocado server-side;
7. token é promovido ao formato long-lived suportado pelo provider;
8. credencial é criptografada e armazenada fora da UI;
9. `channel_connections.auth_valid=true` somente depois da referência de secret ser anexada.

### Evidência esperada

No Readiness Center:

- **OAuth real + credencial criptografada = READY**.

Se falhar, não edite tabelas manualmente para “desbloquear” o gate.

## 4. Configurar e provar webhook real

Configure no App Dashboard da Meta as assinaturas necessárias às capacidades do G3 — mensagens e comentários — conforme a configuração atual disponibilizada para o app.

O callback público é:

`<APP_ORIGIN>/api/providers/instagram/webhook`

O endpoint implementa dois fluxos distintos:

- GET: challenge com `META_WEBHOOK_VERIFY_TOKEN`;
- POST: HMAC SHA-256 sobre o **raw body** usando `META_APP_SECRET`.

Um proxy/reverse proxy não pode reserializar ou alterar o corpo antes de o web verificar a assinatura.

### Regra de persistência

Webhook assinado só recebe ACK de sucesso depois que o payload foi persistido. Se o banco estiver indisponível, o endpoint retorna 503 para permitir retry do provider.

### Evidência esperada

O Readiness Center deve mostrar:

- **Webhook assinado persistido = READY**.

Isto ainda não basta para HOST PASS: precisamos de uma mensagem real normalizada.

## 5. Gerar inbound real

A partir de uma **segunda conta Instagram de teste**, envie uma DM para a conta profissional conectada.

Não use tentativa de DM fria como teste. A documentação oficial do Send API estabelece que a conversa precisa ser iniciada pelo usuário Instagram; o destinatário de uma resposta via API deve ter enviado uma mensagem à conta profissional.

Fluxo esperado:

`Meta webhook → durable ingress → raw event → normalizer → canonical event message.received`

### Evidência esperada

No Readiness Center:

- **Mensagem real normalizada = READY**.

No Reliability Center, deve existir o evento canônico correspondente.

## 6. Responder pela plataforma

Use a própria aplicação para responder à conversa criada no passo anterior.

Fluxo esperado:

`HTTP enqueue → message QUEUED → outbound worker lease → InstagramOfficialProvider → Meta Send API → provider_message_id → SENT`

O Send API oficial atual usa o endpoint conceitual:

`https://graph.instagram.com/{api_version}/{ig_user_id}/messages`

Nosso código constrói esse endpoint usando configuração explícita; não hardcode versão no domínio.

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

O Overview deriva esse estado do banco. Não existe botão administrativo para forçar PASS.

## 8. Casos de falha que NÃO autorizam retry cego

Se a chamada à Meta:

- atingir timeout depois do dispatch;
- fechar transporte depois do dispatch;
- retornar 5xx ambíguo;
- retornar 2xx sem ID suficiente para confirmar o side effect;
- for aceita pela Meta mas o banco falhar antes de persistir `SENT`;

então o estado deve convergir para:

`SEND_RESULT_UNKNOWN`

A mensagem não volta automaticamente à fila. Reconciliação exige evidência externa + AuditLog.

## 9. Evidência que deve ser preservada após o teste

- `channel_connections` da conexão oficial;
- secret reference criptografada;
- `webhook_ingress_events` do evento real;
- `raw_events` e `canonical_events` relevantes;
- outbound `messages` com `provider_message_id`;
- AuditLogs das ações manuais;
- worker heartbeat durante a janela do teste.

Não guardar tokens, payloads sensíveis ou texto de mensagens em logs de aplicação genéricos.

## 10. Critério para avançar ao G4

Somente depois de o dashboard derivar **G3 HOST PASS** com as provas acima, o roadmap libera implementação/validação do **G4 — WhatsApp Official**.
