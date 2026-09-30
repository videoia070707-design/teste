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

O Overview e o Meta Readiness Center derivam o status G3 dessas evidências. Compilação, mock, fixture, env configurada ou attestation manual não podem promover o gate para PASS.

### Segurança do OAuth
- cada state é aleatório, armazenado apenas como hash e consumível uma única vez;
- cada sessão OAuth é vinculada ao `initiated_by_user_id` verificado que iniciou o fluxo;
- o callback só consome o state quando o usuário autenticado atual é o ator original;
- workspace membership e `connections.manage` são revalidados no callback;
- credenciais nunca são enviadas ao browser e são mantidas no secret vault criptografado.

### Least privilege
Enquanto G3 implementar apenas mensagens/comentários, o OAuth solicita somente:
- `instagram_business_basic`;
- `instagram_business_manage_messages`;
- `instagram_business_manage_comments`.

`instagram_business_content_publish` permanece escopo opcional e `content.publish` permanece capability indisponível até existir implementação e testes correspondentes. Não solicitar permissão futura antecipadamente.

### Meta Readiness Center
O painel separa três classes de sinal:
1. **runtime configuration** — envs, URLs e keyring estruturalmente válidos;
2. **external attestations** — App Meta, roles, webhook subscriptions e URLs legais confirmados operacionalmente;
3. **live evidence** — OAuth real, webhook real e outbound real.

Somente a terceira classe participa do HOST PASS. Attestations são auditadas, mas nunca substituem tráfego real.

Extensões já implementadas dentro do G3, mas que não substituem o HOST PASS mínimo:
- `comment.received`;
- resposta pública a comentário;
- private reply/comment→DM;
- claim único de private reply por comentário;
- ações manuais com AuditLog e correlation ID;
- páginas públicas de Privacy Policy e Data Deletion condicionadas a identidade legal configurada.

G4 não inicia enquanto G3 estiver `IN PROGRESS`, salvo mudança explícita desta disciplina de gate.
