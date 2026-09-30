const sectionCopy: Record<string, { title: string; description: string; gate: string }> = {
  inbox: { title: "Inbox", description: "Caixa unificada para conversas Instagram e WhatsApp.", gate: "G5" },
  automations: { title: "Automations", description: "Workflow runtime e builder visual com versionamento.", gate: "G7–G8" },
  contacts: { title: "Contacts", description: "Identidade única de contato com múltiplos canais.", gate: "G5" },
  campaigns: { title: "Campaigns", description: "Segmentação, preflight, consentimento e envio controlado.", gate: "G10" },
  analytics: { title: "Analytics", description: "Conversão, custos, reliability e métricas de provider.", gate: "G14" },
  labs: { title: "Labs", description: "Browser/session providers isolados do core oficial.", gate: "G12–G13" }
};

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const copy = sectionCopy[section] ?? { title: section, description: "Módulo planejado.", gate: "Future" };

  return (
    <>
      <header className="page-header">
        <div className="header-copy">
          <div className="eyebrow">{copy.gate}</div>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        <span className="badge">Planned module</span>
      </header>
      <article className="card">
        <div className="eyebrow">Gate discipline</div>
        <h2>Este módulo ainda não foi ativado.</h2>
        <p>Ele será implementado no gate correspondente depois que as dependências anteriores passarem pelos critérios de validação. Nenhuma tela futura será apresentada como funcional antes disso.</p>
      </article>
    </>
  );
}
