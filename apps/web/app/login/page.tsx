import { signInWithEmail, signInWithGoogle, signUpWithEmail } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_credentials: "Preencha e-mail e senha.",
  invalid_credentials: "E-mail ou senha inválidos.",
  invalid_signup: "Use um e-mail válido e uma senha com pelo menos 8 caracteres.",
  signup_failed: "Não foi possível criar a conta.",
  google_oauth_failed: "Não foi possível iniciar o login com Google.",
  auth_callback: "Não foi possível concluir a autenticação. Tente novamente."
};

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const errorCode = typeof params.error === "string" ? params.error : "";
  const status = typeof params.status === "string" ? params.status : "";

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <div className="eyebrow">Automation control plane</div>
        <h1>Entre para conectar seus canais.</h1>
        <p>
          Sua conta da plataforma é separada das credenciais do Instagram e WhatsApp.
          Os canais serão autorizados depois, pelos fluxos oficiais de cada provider.
        </p>

        {errorCode && (
          <div className="notice warning" role="alert">
            {ERROR_MESSAGES[errorCode] ?? "Falha de autenticação."}
          </div>
        )}

        {status === "check_email" && (
          <div className="notice" role="status">
            Confira seu e-mail para confirmar a conta antes de entrar.
          </div>
        )}

        <form action={signInWithGoogle} className="auth-google-form">
          <button className="button button-secondary" type="submit">
            Continuar com Google
          </button>
        </form>

        <div className="auth-divider"><span>ou use e-mail</span></div>

        <form action={signInWithEmail} className="auth-form">
          <label>
            <span>E-mail</span>
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            <span>Senha</span>
            <input name="password" type="password" autoComplete="current-password" minLength={8} required />
          </label>
          <button className="button button-primary" type="submit">Entrar</button>
        </form>

        <form action={signUpWithEmail} className="auth-signup-form">
          <label>
            <span>Novo e-mail</span>
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            <span>Criar senha</span>
            <input name="password" type="password" autoComplete="new-password" minLength={8} required />
          </label>
          <button className="button button-ghost" type="submit">Criar conta</button>
        </form>

        <p className="auth-footnote">
          Login não concede acesso automático a nenhuma conta social. Instagram e WhatsApp são conectados separadamente.
        </p>
      </div>
    </div>
  );
}
