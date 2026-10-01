# Teste local no Windows

Este pacote foi preparado para testar a Automation Platform **localmente antes do deploy online**.

## Arquivo principal

Dê dois cliques em:

`TESTAR-FERRAMENTA-WINDOWS.cmd`

Ele executa automaticamente:

1. validação do PowerShell;
2. checagem de Node.js e Docker Desktop;
3. preparação do pnpm;
4. instalação das dependências com lockfile;
5. criação de PostgreSQL local isolado em Docker (`127.0.0.1:55432`);
6. criação dos stubs necessários de Supabase Auth para o teste local;
7. migrations PostgreSQL portáveis;
8. criação de um usuário local de teste;
9. `pnpm typecheck`;
10. `pnpm test`;
11. `pnpm build`;
12. inicialização do dashboard em `http://127.0.0.1:3000`;
13. health checks `/api/health/live` e `/api/health/ready`;
14. smoke test de `/`, `/connections` e `/reliability`;
15. criação de logs e relatório final.

## Requisitos

- Windows 10/11;
- PowerShell 5.1+;
- Node.js 20+ (Node.js 22 LTS recomendado);
- Docker Desktop aberto e funcionando;
- internet apenas na primeira instalação de dependências/imagem Docker.

O script **não instala programas automaticamente** e não gera cobrança.

## Segurança do modo local

O launcher usa `LOCAL_TEST_MODE=true` somente no ambiente local.

O bypass de autenticação local é aceito apenas para requisições em:

- `localhost`;
- `127.0.0.1`;
- `::1`.

Ele não substitui Supabase Auth em um endereço público.

Nenhum segredo real da Meta, senha do Supabase ou token de produção é incluído no ZIP.

O banco local usa credenciais descartáveis apenas para desenvolvimento:

- container: `automation-platform-local-db`;
- banco: `automation_local`;
- porta local: `55432`.

## Onde ficam os resultados

Cada execução cria uma pasta em:

`Relatorios-Teste-Local\Teste-<id>`

Arquivos importantes:

- `CONSOLE_OUTPUT.log` — log geral;
- `WEB_SERVER.log` — saída do Next.js;
- `LOCAL_TEST_RESULT.json` — resultado estruturado;
- `RESULTADO.txt` — resumo legível.

## Encerrar o ambiente

Dê dois cliques em:

`PARAR-FERRAMENTA-WINDOWS.cmd`

Isso encerra o processo web, remove o container PostgreSQL local e apaga o `.env.local` gerado pelo teste.

## O que não é validado nesse modo

O teste local não fabrica evidências da Meta. Portanto continuam pendentes até o HOST PASS real:

- OAuth real do Instagram;
- assinatura de webhook real;
- `message.received` vindo da Meta;
- DM real com `provider_message_id`;
- permissões/App Review reais.

O objetivo deste pacote é validar aplicação, banco, migrations, reliability, UI e runtime local antes de publicar o dashboard na internet.
