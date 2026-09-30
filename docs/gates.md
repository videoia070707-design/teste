# Gates

## G0 — Product/API Readiness
PASS quando escopo, provider policy, segurança de credenciais e dependências externas estiverem documentados.

## G1 — Core SaaS
PASS quando workspace, memberships e RBAC estiverem modelados e o isolamento multi-tenant tiver contrato explícito.

## G2 — Provider + Reliability Core
PASS quando:
- providers implementarem contrato comum;
- capabilities forem consultáveis por conexão;
- health suportar falha parcial;
- webhook/evento tiver idempotência;
- colisão suspeita não for descartada como duplicata;
- envio ambíguo usar SEND_RESULT_UNKNOWN;
- retry de envio ambíguo ficar bloqueado até reconciliação;
- CI validar migrations e invariantes do banco;
- CI/typecheck/test/build estiverem verdes.

## G3 — Instagram Official
Só inicia depois do G2 PASS.

HOST PASS mínimo exige evidência persistida no mesmo workspace de:
- OAuth/Instagram Login real concluído, conexão oficial `auth_valid` e referência de credencial criptografada;
- webhook assinado real processado até `message.received` canônico;
- DM outbound real com `message_type='text'`, estado `SENT`/`DELIVERED`/`READ` e `provider_message_id` retornado pela Meta.

O Overview deriva o status G3 dessas evidências. Compilação, mock ou fixture não podem promover o gate para PASS.

Extensões já implementadas dentro do G3, mas que não substituem o HOST PASS mínimo:
- `comment.received`;
- resposta pública a comentário;
- private reply/comment→DM;
- claim único de private reply por comentário;
- ações manuais com AuditLog e correlation ID.
