/**
 * Configuração do site — edite AQUI ao trocar de ambiente/conta/domínio.
 * (Carregado antes de app.js e ads.js.)
 *
 * IMPORTANTE: aqui só entram valores PÚBLICOS (URL do Worker, domínio).
 * Segredos de verdade (ADMIN_TOKEN, API keys) NUNCA vão no frontend —
 * ficam só no Worker via `wrangler secret put`.
 */
window.APP_CONFIG = {
  // URL da API (Cloudflare Worker). Ex: https://SEU-WORKER.SEU-USUARIO.workers.dev
  API_BASE: "https://buscador-empresas-blendibox.blendibox.workers.dev",

  // Domínio público do site (usado no SEO dinâmico: canonical e JSON-LD).
  SITE_URL: "https://buscadeempresa.blendibox.com.br",
};
