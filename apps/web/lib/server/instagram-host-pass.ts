import "server-only";

export function buildInstagramHostPassChallenge(workspaceId: string): string {
  const compact = workspaceId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10).toUpperCase();
  if (compact.length < 6) throw new Error("INVALID_WORKSPACE_ID_FOR_HOST_PASS");
  return `G3-HOST-PASS-${compact}`;
}

export const INSTAGRAM_HOST_PASS_REPLY_TEXT =
  "Teste G3 recebido. Esta resposta foi enviada pela plataforma durante a validação do Instagram Official.";
