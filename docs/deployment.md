# Deployment contract

A plataforma não depende de Replit, Vercel ou de um único host. O runtime de produção é composto por três processos long-lived (`web`, `worker-ingress`, `worker-outbound`) e um processo operacional one-shot (`migrate`). Todos podem rodar em qualquer ambiente compatível com containers e PostgreSQL.

## Processos

### `@automation/web`
Responsável por dashboard, Supabase Auth SSR, OAuth/callbacks, APIs protegidas, webhook público e health endpoints.

- liveness: `GET /api/health/live`
- readiness: `GET /api/health/ready`
- porta padrão: `3000`

### `@automation/worker-ingress`
Consome `webhook_ingress_events`, usa lease recuperável, normaliza eventos e persiste `raw_events`, `canonical_events` e outbox.

### `@automation/worker-outbound`
Consome mensagens outbound, executa mutações do provider e preserva `SEND_RESULT_UNKNOWN` quando o outcome é ambíguo.

Os dois workers usam um supervisor de runtime que:

- mantém o mesmo `worker_id` usado pelas leases;
- grava heartbeat periódico em `app_private.worker_heartbeats`;
- encaminha `SIGTERM`/`SIGINT` para o processo real;
- registra `stopped_at` quando o processo termina;
- fecha a conexão PostgreSQL antes de sair.

O dashboard Reliability classifica cada worker como `RUNNING`, `STALE`, `STOPPED` ou `NOT_SEEN`. Heartbeat é apenas evidência operacional e nunca conta como G3 HOST PASS.

### Migration runner

O comando:

```bash
pnpm --filter @automation/storage-postgres migrate
```

aplica o stream `database/*.sql` usando:

- `pg_advisory_xact_lock` para impedir dois deploys concorrentes de alterar schema ao mesmo tempo;
- ledger `app_private.schema_migrations`;
- SHA-256 por arquivo;
- recusa explícita se uma migration já aplicada for alterada;
- transação para que uma falha não deixe o ledger parcialmente atualizado.

Migration aplicada é imutável. Correções de schema devem sempre ser uma nova migration.

## Infraestrutura externa

A implementação atual usa:

- PostgreSQL para dados do produto;
- Supabase Auth para identidade e sessão do usuário;
- Meta/Instagram APIs para o provider oficial;
- secret manager do ambiente de deploy para todas as variáveis sensíveis.

Supabase é o adapter de Auth atual, não o host obrigatório da aplicação. Web e workers continuam containers independentes.

## Variáveis por processo

### Compartilhadas

- `DATABASE_URL`
- `PROVIDER_SECRET_CURRENT_KEY_VERSION`
- `PROVIDER_SECRET_KEYS_JSON`
- `INSTAGRAM_GRAPH_BASE_URL`
- `INSTAGRAM_GRAPH_API_VERSION`

### Migration runner

- `DATABASE_URL`
- `MIGRATIONS_DIR` (opcional; normalmente não deve ser alterado)

### Web

Além das compartilhadas:

- `APP_ORIGIN`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `META_APP_ID`
- `META_APP_SECRET`
- `META_WEBHOOK_VERIFY_TOKEN`
- `META_WEBHOOK_SIGNATURE_HEADER`
- `INSTAGRAM_OAUTH_AUTHORIZE_URL`
- `INSTAGRAM_OAUTH_TOKEN_URL`
- `INSTAGRAM_OAUTH_TOKEN_ENCODING`
- `INSTAGRAM_LONG_LIVED_TOKEN_URL`
- `INSTAGRAM_IDENTITY_PROBE_PATH`
- `LEGAL_ENTITY_NAME`
- `SUPPORT_EMAIL`

### Ingress worker

- `DATABASE_URL`
- `INGRESS_WORKER_BATCH_SIZE`
- `INGRESS_WORKER_POLL_MS`
- `INGRESS_WORKER_LEASE_SECONDS`
- `INGRESS_WORKER_ID` (opcional; gerado automaticamente quando ausente)

### Outbound worker

- `DATABASE_URL`
- `PROVIDER_SECRET_CURRENT_KEY_VERSION`
- `PROVIDER_SECRET_KEYS_JSON`
- `INSTAGRAM_GRAPH_BASE_URL`
- `INSTAGRAM_GRAPH_API_VERSION`
- `OUTBOUND_WORKER_BATCH_SIZE`
- `OUTBOUND_WORKER_POLL_MS`
- `OUTBOUND_WORKER_LEASE_SECONDS`
- `OUTBOUND_WORKER_ID` (opcional; gerado automaticamente quando ausente)

## Docker

O `Dockerfile` recebe `SERVICE` como build arg e instala dependências a partir do lockfile commitado.

Exemplos:

```bash
docker build --build-arg SERVICE=@automation/web -t automation-web .
docker build --build-arg SERVICE=@automation/worker-ingress -t automation-ingress .
docker build --build-arg SERVICE=@automation/worker-outbound -t automation-outbound .
```

Para desenvolvimento/integração do runtime:

```bash
cp .env.example .env
# preencher apenas localmente; nunca commitar .env

docker compose --profile ops run --rm migrate
docker compose up --build
```

O serviço `migrate` fica atrás do profile `ops`: ele não roda automaticamente toda vez que `docker compose up` é executado.

O `compose.yaml` não cria um banco falso nem um Meta fake. Ele espera serviços externos configurados por `.env`, justamente para não fazer o ambiente parecer pronto quando Auth/provider não estão realmente conectados.

## Ordem de rollout

1. executar o migration runner;
2. iniciar `web`;
3. validar `/api/health/live` e `/api/health/ready`;
4. iniciar `worker-ingress` e confirmar heartbeat recente;
5. iniciar `worker-outbound` e confirmar heartbeat recente;
6. abrir `/connections/instagram/readiness` e executar o preflight local;
7. configurar URLs no App Dashboard da Meta;
8. concluir OAuth real;
9. enviar DM real para a conta de teste e confirmar `message.received`;
10. responder pela plataforma e confirmar `provider_message_id`;
11. somente então permitir que o próprio sistema derive `G3 HOST PASS`.

## Regras de segurança de deploy

- nenhum secret deve usar prefixo `NEXT_PUBLIC_`;
- `APP_ORIGIN` deve ser HTTPS em ambiente público;
- workers não devem ficar expostos à internet;
- somente o `web` recebe tráfego externo;
- webhook deve chegar diretamente ao `web` ou a um proxy que preserve o raw body sem mutá-lo;
- reverse proxies não podem transformar o corpo antes da validação HMAC;
- `api/health/*` nunca retorna secrets, workspace IDs ou diagnóstico interno detalhado;
- DB e secret store devem usar conexões privadas/TLS quando disponíveis;
- rolling deploy deve respeitar `stop_grace_period` para evitar interrupção de leases em execução;
- migrations já registradas no ledger nunca devem ser editadas/regravadas;
- migration runner é operação de deploy, não processo permanentemente exposto.

## Escala

Workers podem ser replicados horizontalmente porque o claim usa lock/lease no banco. Cada réplica registra seu próprio heartbeat. Aumentar réplicas não remove a necessidade de observar filas, latência, `SEND_RESULT_UNKNOWN`, dead letters e limites do provider.

Browser Lab não faz parte deste runtime de produção do G3. Ele continua isolado para G12–G13.
