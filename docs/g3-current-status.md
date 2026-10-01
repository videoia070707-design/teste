# G3 Instagram Official — status atual

Atualizado em 2026-10-01.

## Estado

**Gate ativo:** G3 — Instagram Official  
**Infraestrutura:** Supabase Free  
**HOST PASS:** pendente de configuração/tráfego Meta real  
**G4:** bloqueado até G3 PASS

## Verde / validado

- G0–G2 concluídos.
- Projeto Supabase real em `sa-east-1` ativo.
- Core PostgreSQL + adapter Supabase migrados até `030_setup_center_patch_semantics`.
- Security Advisor: 0 lints após a migration 030.
- Runtime `g3-runtime` executa via Edge + PGMQ + `pg_net` + Cron, sem workers pagos.
- Recovery Cron: 15 segundos; respostas recentes HTTP 200.
- Backlog atual: 0 ingress attention, 0 outbound pending, 0 SEND_RESULT_UNKNOWN.
- Webhook Instagram Edge ativo, HMAC/raw-body/persist-before-ACK.
- OAuth callback Edge ativo.
- OAuth start Edge ativo, JWT + owner/admin + actor/workspace-bound state.
- Provider keyring AES no Supabase Vault.
- Webhook verify token no Supabase Vault.
- Role `automation_web` least-privilege criada; não é necessária para o console local G3.
- `g3-control` ativo para setup/readiness local autenticado.
- G3 Console local disponível em `tools/g3-console`.
- Windows launcher disponível em `tools/g3-console/start-windows.cmd`.
- Servidor canônico do console faz bind somente em `127.0.0.1` e abre a UI em `http://localhost:3000`.
- Workflow `G3 Console` faz smoke test do servidor, 404 e `cache-control: no-store`.
- CI principal e Free Runtime Adapter estavam verdes no último HEAD funcional antes deste snapshot.

## Configuração Meta ainda ausente

Não inventar nem preencher com valores de tutoriais antigos:

- Meta App ID
- Meta App Secret
- OAuth authorize URL do Instagram API with Instagram Login
- OAuth token URL do mesmo fluxo
- Long-lived token URL confirmada para o fluxo atual
- Identity probe path confirmado para a API atual

Já configurados:

- Graph base URL
- Graph API version
- scopes G3:
  - `instagram_business_basic`
  - `instagram_business_manage_messages`
  - `instagram_business_manage_comments`

`instagram_business_content_publish` permanece fora do G3.

## Identidade pública ainda ausente

- nome jurídico / operador
- e-mail de suporte / privacidade

Esses valores devem ser reais e são preenchidos pelo operador no G3 Console. Não inferir de conta, memória ou e-mail técnico.

## URLs públicas Supabase Free

- OAuth callback: `https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/instagram-oauth-callback`
- Webhook: `https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/instagram-webhook`
- Data deletion: `https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/instagram-data-deletion`
- Privacy: `https://cqtrigqlktekczbbsxiy.supabase.co/functions/v1/platform-legal?document=privacy`

## Como operar o próximo passo

1. Executar `tools/g3-console/start-windows.cmd`.
2. Entrar/criar conta no Supabase Auth.
3. Preencher identidade pública real + dados confirmados do App Meta.
4. Salvar setup; secrets vão para Vault.
5. Readiness precisa ficar completo para habilitar `Conectar Instagram`.
6. Concluir OAuth com conta profissional Business/Creator real.
7. Configurar webhook no App Meta usando a URL Edge acima.
8. Enviar DM de uma segunda conta para a conta profissional conectada.
9. Confirmar `message.received` real.
10. Responder pela plataforma e confirmar `provider_message_id` real.
11. Somente então o Overview pode derivar `G3 PASS`.

## Não fazer

- Não voltar a Replit.
- Não provisionar worker pago para fechar G3.
- Não usar Browser Lab como fallback silencioso.
- Não usar endpoint do Instagram Basic Display legado sem evidência oficial atual.
- Não inserir fixture/evento no banco para simular HOST PASS.
- Não fazer retry automático de `SEND_RESULT_UNKNOWN`.
