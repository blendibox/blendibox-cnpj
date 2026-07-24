-- Migracao 002 — opt-out (LGPD) + blacklist
-- Rode uma vez:
--   wrangler d1 execute buscador-empresas-blendibox --remote --file=./migrations/002_optout_blacklist.sql

-- Empresas removidas dos resultados (apos aprovacao).
CREATE TABLE IF NOT EXISTS blacklist (
  cnpj       TEXT PRIMARY KEY,
  motivo     TEXT,
  created_at TEXT NOT NULL
);

-- Solicitacoes de remocao (entram como 'pendente' e sao revisadas).
CREATE TABLE IF NOT EXISTS optout_requests (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  cnpj             TEXT NOT NULL,
  razao_social     TEXT,
  nome_solicitante TEXT,
  vinculo          TEXT,
  email_contato    TEXT,
  motivo           TEXT,
  status           TEXT NOT NULL DEFAULT 'pendente',
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_optout_status ON optout_requests (status, created_at);
