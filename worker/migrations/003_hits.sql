-- Migracao 003 — contador de buscas por CNPJ (para poda por demanda)
-- Rode uma vez:
--   wrangler d1 execute buscador-empresas-blendibox --remote --file=./migrations/003_hits.sql

ALTER TABLE cnpj_cache ADD COLUMN hits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cnpj_cache ADD COLUMN last_hit TEXT;
CREATE INDEX IF NOT EXISTS idx_cache_hits ON cnpj_cache (hits, last_hit);
