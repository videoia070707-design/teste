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
- CI/typecheck/build estiverem verdes.

## G3 — Instagram Official
Só inicia depois do G2 PASS. Critério mínimo: OAuth/Instagram Login real, webhook validado, evento de mensagem real normalizado e resposta real rastreável ponta a ponta.
