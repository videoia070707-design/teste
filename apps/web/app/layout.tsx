import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Automation Platform",
  description: "Instagram and WhatsApp automation platform"
};

const navigation = [
  ["Overview", "/"],
  ["Inbox", "/inbox"],
  ["Automations", "/automations"],
  ["Contacts", "/contacts"],
  ["Campaigns", "/campaigns"],
  ["Analytics", "/analytics"],
  ["Connections", "/connections"],
  ["Reliability", "/reliability"],
  ["Settings", "/settings"],
  ["Labs", "/labs"]
] as const;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="app-shell">
          <aside className="sidebar">
            <div className="brand-block">
              <div className="brand-mark">A</div>
              <div>
                <strong>Automation</strong>
                <span>control plane</span>
              </div>
            </div>
            <nav className="nav-list" aria-label="Navegação principal">
              {navigation.map(([label, href]) => (
                <Link href={href} key={href} className="nav-item">
                  {label}
                </Link>
              ))}
            </nav>
            <div className="sidebar-footer">
              <span className="status-dot healthy" />
              Official core online
            </div>
          </aside>
          <main className="main-content">{children}</main>
        </div>
      </body>
    </html>
  );
}
