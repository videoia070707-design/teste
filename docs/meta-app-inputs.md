# Meta App Inputs — G3 Instagram Official

Este arquivo registra somente o handoff necessário para o primeiro HOST PASS real. O Readiness Center continua sendo a fonte de estado; o Setup Center é a superfície para configuração **não secreta**.

## URLs públicas já prontas no Supabase Free

### OAuth redirect

```text
https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/instagram-oauth-callback
```

### Webhook callback

```text
https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/instagram-webhook
```

O GET challenge usa o verify token do Vault. POST exige HMAC válido com o App Secret real.

### Provider data deletion callback

```text
https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/instagram-data-deletion
```

Sem `meta_app_secret`, a função permanece fail-closed.

### Privacy Policy

```text
https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/platform-legal?document=privacy
```

### Data deletion instructions

```text
https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/platform-legal?document=data-deletion
```

As superfícies legais respondem 503 até identidade jurídica e contato reais existirem.

## Permissões do G3

Somente:

- `instagram_business_basic`
- `instagram_business_manage_messages`
- `instagram_business_manage_comments`

`instagram_business_content_publish` continua fora do G3.

## O que já está pronto

- Supabase Free backend/runtime;
- Graph base URL;
- Graph API version pinada;
- webhook verify token no Vault;
- AES provider keyring no Vault;
- Edge runtime + Cron + PGMQ;
- OAuth callback público;
- webhook público;
- data deletion callback;
- páginas legais fail-closed;
- Setup Center `/settings`;
- Readiness Center `/connections/instagram/readiness`;
- CI, reliability e Security Advisor verdes.

## Inputs externos ainda necessários

### 1. Dados públicos / não secretos

Preencher pelo **Setup Center `/settings`**:

- nome jurídico / operador real;
- e-mail de suporte/privacidade real;
- Meta App ID;
- OAuth authorize URL confirmada;
- OAuth token URL confirmada;
- OAuth token encoding confirmado;
- long-lived token URL confirmada;
- identity probe path confirmado.

A API do Setup Center é owner/admin only, valida os campos em duas camadas, usa funções allowlisted e grava AuditLog. A role web não possui UPDATE genérico nas tabelas de configuração.

### 2. Secret

`meta_app_secret` deve ser inserido **diretamente no Supabase Vault** com o nome exato:

```text
meta_app_secret
```

Regras:

- não enviar o App Secret por chat;
- não colocar no GitHub;
- não colocar em `NEXT_PUBLIC_*`;
- não duplicar em Render/env de host;
- não criar placeholder.

O Readiness Center mostra apenas `READY/MISSING`; nunca revela o valor.

### 3. Verify token

`meta_webhook_verify_token` já existe no Supabase Vault. O valor não é commitado. Quando o App Dashboard da Meta pedir o verify token, copie-o diretamente do ambiente seguro, não de logs/chat.

## Regra para endpoints OAuth/probe

Não preencher endpoints com:

- exemplos do Instagram Basic Display legado;
- snippets de terceiros;
- memória histórica;
- endpoint inferido porque “parece o mesmo”.

Persistir apenas valores confirmados no App Meta real ou em documentação oficial atual inequívoca. Se não houver confirmação, o campo permanece vazio e health continua `STALE`.

## Estado atual dos blockers

Prontos:

- Graph base ✅
- Graph version ✅
- verify token ✅
- provider keyring ✅
- Edge Runtime ✅

Pendentes:

- Meta App ID ⏳
- Meta App Secret ⏳
- OAuth authorize URL ⏳
- OAuth token URL ⏳
- long-lived token URL ⏳
- identity probe path ⏳
- legal entity name ⏳
- support email ⏳

## HOST PASS

Configuração, heartbeat, preflight e attestation nunca passam o gate.

G3 só fica PASS quando existirem no mesmo workspace:

1. OAuth real + credencial criptografada;
2. webhook assinado real persistido;
3. `message.received` real;
4. outbound text DM real com `provider_message_id`.

Só depois disso o roadmap libera G4 — WhatsApp Official.
