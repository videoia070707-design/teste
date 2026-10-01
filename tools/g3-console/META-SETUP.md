# G3 — campos do App Meta

Use este guia junto do `G3 Console`. O console grava secrets no Supabase Vault e configuração pública/server-side no banco; ele não salva o App Secret no navegador.

## Dados que ainda dependem do App Meta real

- **Meta App ID** — ID numérico exibido no App Dashboard da Meta.
- **Meta App Secret** — secret do app; cole somente no campo write-only do G3 Console.
- **OAuth authorize URL** — use apenas o endpoint confirmado para **Instagram API with Instagram Login** no App/ documentação atual.
- **OAuth token URL** — endpoint confirmado para troca do authorization code no mesmo produto.
- **Long-lived token URL** — endpoint confirmado para promoção/refresh compatível com o fluxo atual.
- **Identity probe path** — path de identidade/perfil confirmado para a versão atual da API. Não reutilize automaticamente exemplos do Instagram Basic Display legado.

## URLs públicas já prontas no Supabase Free

- OAuth callback: `https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/instagram-oauth-callback`
- Webhook callback: `https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/instagram-webhook`
- Data deletion: `https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/instagram-data-deletion`
- Privacy: `https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/platform-legal?document=privacy`

## Dados públicos do operador

O console também pede:

- **Nome jurídico / operador**
- **E-mail de suporte / privacidade**

Esses valores alimentam as páginas públicas usadas no processo de integração/App Review. Não invente valores: use a identidade real do operador do produto.

## O que não deve ser alterado por conveniência

- Scopes atuais do G3: `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`.
- `instagram_business_content_publish` fica fora enquanto publishing não existir no produto.
- Não usar endpoint do Instagram Basic Display antigo apenas porque aparece em tutorial antigo.
- Não marcar readiness manualmente para contornar configuração ausente.
- Não inserir OAuth/webhook/evento fake no banco para obter HOST PASS.

Depois que todos os itens de **Configuration** ficarem prontos, o botão **Conectar Instagram** é habilitado. O G3 só recebe PASS após OAuth real + inbound real + outbound real com `provider_message_id`.
