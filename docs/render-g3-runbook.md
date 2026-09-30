# Render G3 provisioning runbook

Este documento cobre somente o runtime público necessário para o **G3 Instagram Official HOST PASS**. Ele não altera o gate: container saudável não equivale a HOST PASS.

## 1. Custo e escopo

Blueprint atual:

- `automation-web`: `free` — US$ 0/mês, adequado apenas ao teste controlado; pode hibernar por inatividade.
- `automation-worker-ingress`: `0.5c-512mb` — menor plano compatível com background worker.
- `automation-worker-outbound`: `0.5c-512mb` — menor plano compatível com background worker.

Na tabela pública de preços consultada em 2026-09-30, `0.5c-512mb` custa US$ 7/mês por instância. Portanto, os dois workers representam aproximadamente **US$ 14/mês**, antes de eventuais extras de plataforma/banda/build. Não provisionar recursos pagos sem aprovação explícita do custo vigente no momento da criação.

## 2. Fonte do deploy

Repositório:

`videoia070707-design/teste`

Blueprint:

`render.yaml`

Todos os serviços usam o mesmo Dockerfile parametrizado por `SERVICE`.

Deploy automático só ocorre com `autoDeployTrigger: checksPass`.

## 3. Secrets necessários no primeiro sync

O web service é a fonte única para os secrets compartilhados. Nunca gravar esses valores no Git.

### Banco / criptografia

- `DATABASE_URL`
  - apontando para o Supabase `cqtrigqlktekczbbsxiy`;
  - incluir TLS, no mínimo `sslmode=require`;
  - preferir `verify-full` quando a cadeia de CA/hostname estiver validada no ambiente.
- `PROVIDER_SECRET_KEYS_JSON`
  - JSON com chave AES-256 em base64;
  - a versão corrente é `v1` via `PROVIDER_SECRET_CURRENT_KEY_VERSION`.

### Meta / Instagram

- `META_APP_ID`
- `META_APP_SECRET`
- `META_WEBHOOK_VERIFY_TOKEN`
- `INSTAGRAM_GRAPH_API_VERSION`
- `INSTAGRAM_IDENTITY_PROBE_PATH`
- `INSTAGRAM_OAUTH_AUTHORIZE_URL`
- `INSTAGRAM_OAUTH_TOKEN_URL`

Os endpoints OAuth e identity probe continuam explícitos até serem validados contra o App Meta real. Não preencher usando defaults do Instagram Basic Display legado.

### Legal

- `LEGAL_ENTITY_NAME`
- `SUPPORT_EMAIL`

Sem esses valores, `/legal/privacy` e `/legal/data-deletion` devem permanecer indisponíveis por design.

## 4. Valores já declarados no Blueprint

Não precisam ser copiados manualmente:

- Supabase URL;
- Supabase publishable key;
- `GOOGLE_AUTH_ENABLED=false`;
- `META_WEBHOOK_SIGNATURE_HEADER=x-hub-signature-256`;
- `INSTAGRAM_GRAPH_BASE_URL=https://graph.instagram.com/`;
- long-lived-token URL;
- worker lease/poll/batch defaults.

Google Login permanece oculto até o provider Google estar configurado no Supabase e no Google OAuth client.

## 5. Ordem de provisionamento

1. Conectar o repositório ao workspace Render.
2. Criar/sincronizar o Blueprint.
3. Informar todos os valores `sync: false` antes do primeiro deploy.
4. Confirmar que o CI GitHub do commit está verde.
5. Deixar o `automation-worker-ingress` executar o migration runner no pre-deploy.
6. Subir web + ingress + outbound.
7. Verificar `/api/health/live`.
8. Verificar `/api/health/ready`.
9. Confirmar no banco que ingress e outbound possuem heartbeat recente.
10. Somente então configurar callback/redirect URLs no Supabase Auth e no App Meta.

## 6. Evidências de runtime

Antes de iniciar o teste Meta:

- web readiness HTTP = 200;
- ingress heartbeat = `RUNNING`;
- outbound heartbeat = `RUNNING`;
- migrations no banco real intactas;
- Supabase Security Advisor sem lints críticos;
- Readiness Center sem falso `HEALTHY` para Instagram ainda não conectado.

Runtime saudável não promove G3 automaticamente.

## 7. Callback URLs após o deploy

Com `APP_ORIGIN` derivado do `RENDER_EXTERNAL_URL`:

- Supabase Auth callback: `<APP_ORIGIN>/auth/callback`
- Instagram OAuth callback: `<APP_ORIGIN>/api/connections/instagram/callback`
- Instagram webhook: `<APP_ORIGIN>/api/providers/instagram/webhook`
- Privacy Policy: `<APP_ORIGIN>/legal/privacy`
- Data Deletion: `<APP_ORIGIN>/legal/data-deletion`

Registrar exatamente as URLs exibidas no Readiness Center para evitar drift.

## 8. Rollback

Se web readiness ou worker heartbeat falhar após deploy:

1. não iniciar OAuth Meta;
2. não forçar `HEALTHY` no banco;
3. preservar os eventos e logs existentes;
4. verificar deploy/build logs;
5. reverter para o último deploy verde ou corrigir e redeployar;
6. não reenviar mensagens em `SEND_RESULT_UNKNOWN` durante recuperação.

Migration já aplicada nunca deve ser editada retroativamente; criar nova migration.

## 9. Critério para começar HOST PASS

O ambiente está apto para HOST PASS quando:

- web responde readiness;
- dois workers estão `RUNNING`;
- Auth por e-mail funciona;
- Meta readiness mostra configuração local pronta;
- App Meta real pode receber as URLs públicas.

Depois disso, seguir `docs/g3-host-pass-runbook.md`.
