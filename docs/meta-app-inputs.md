# Meta App Inputs — G3 Instagram Official

Este arquivo registra apenas inputs/URLs necessários para o primeiro HOST PASS real. Não substitui o Readiness Center e não autoriza preencher endpoints OAuth por suposição.

## URLs públicas já prontas no Supabase Free

### OAuth redirect

```text
https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/instagram-oauth-callback
```

### Webhook callback

```text
https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/instagram-webhook
```

O GET challenge já foi validado ponta a ponta com o verify token do Vault: HTTP 200 + challenge exato.

### Provider data deletion callback

```text
https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/instagram-data-deletion
```

Enquanto `meta_app_secret` real não existe, esta Function permanece fail-closed e responde 503.

### Privacy Policy

```text
https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/platform-legal?document=privacy
```

### Data deletion instructions

```text
https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/platform-legal?document=data-deletion
```

As duas superfícies legais respondem 503 até `legal_entity_name` e `support_email` serem preenchidos em `app_private.platform_public_config`.

## Permissões do G3

Somente:

- `instagram_business_basic`
- `instagram_business_manage_messages`
- `instagram_business_manage_comments`

`instagram_business_content_publish` continua fora do G3.

## Inputs externos ainda necessários

### Secret

- `meta_app_secret` → Supabase Vault, nunca GitHub/Render/browser.

### Configuração global não secreta

Em `app_private.provider_runtime_config` para `instagram.meta.official`:

- `app_id`
- `oauth_authorize_url`
- `oauth_token_url`
- `oauth_token_encoding`
- `long_lived_token_url`
- `identity_probe_path`

Graph base/version permanecem centralizados na mesma tabela.

## Regra de validação

Não preencher endpoints OAuth a partir de exemplos de Instagram Basic Display, snippets de terceiros ou memória histórica. Os valores devem ser confirmados contra o App Meta real / documentação oficial vigente antes de serem persistidos.

## Verify token

`meta_webhook_verify_token` já existe no Supabase Vault. O valor não é commitado e deve ser copiado diretamente do ambiente seguro quando o App Dashboard da Meta solicitar o verify token.

## Identidade pública

Ainda faltam:

- `legal_entity_name`
- `support_email`

Não usar placeholder em produção/App Review.

## HOST PASS

Configuração/attestation não passa o gate. G3 só fica PASS com, no mesmo workspace:

1. OAuth real e credencial criptografada;
2. webhook assinado real persistido;
3. `message.received` real;
4. outbound text DM real com `provider_message_id`.
