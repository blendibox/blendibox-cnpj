-- Migracao 001 — busca por nome + rate limit de contato
-- Rode uma vez no banco que ja existe:
--   wrangler d1 execute buscador-empresas-blendibox --remote --file=./migrations/001_busca_nome_e_rate_limit.sql

-- Novas colunas para busca por nome (SQLite ignora se ja existirem? nao —
-- rode apenas uma vez; se der erro "duplicate column", ja foi aplicada).
ALTER TABLE cnpj_cache ADD COLUMN razao_social TEXT;
ALTER TABLE cnpj_cache ADD COLUMN nome_fantasia TEXT;
CREATE INDEX IF NOT EXISTS idx_cache_razao ON cnpj_cache (razao_social);

-- Tabela de rate limit da rota /contato
CREATE TABLE IF NOT EXISTS reveal_rate (
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reveal_ip ON reveal_rate (ip, ts);
