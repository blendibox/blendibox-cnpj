-- Buscador de Empresas - Blendibox
-- Esquema do D1 (instalacao nova)

-- Cache de CNPJs consultados (nossa "base de consultas realizadas").
-- Guardamos o payload COMPLETO da fonte (sem mascarar); as mascaras
-- (socios e contato) sao aplicadas na resposta ao usuario.
CREATE TABLE IF NOT EXISTS cnpj_cache (
  cnpj          TEXT PRIMARY KEY,   -- 14 digitos, so numeros
  payload       TEXT NOT NULL,      -- JSON completo da fonte
  razao_social  TEXT,               -- desnormalizado p/ busca por nome
  nome_fantasia TEXT,
  municipio     TEXT,
  uf            TEXT,
  updated_at    TEXT NOT NULL       -- ISO 8601 (para calcular TTL)
);

CREATE INDEX IF NOT EXISTS idx_cache_updated ON cnpj_cache (updated_at);
CREATE INDEX IF NOT EXISTS idx_cache_cidade  ON cnpj_cache (uf, municipio);
CREATE INDEX IF NOT EXISTS idx_cache_razao   ON cnpj_cache (razao_social);

-- Contador de demanda por cidade.
-- Base para no futuro "promover" uma cidade inteira (importacao em lote).
CREATE TABLE IF NOT EXISTS city_demand (
  municipio  TEXT NOT NULL,
  uf         TEXT,
  consultas  INTEGER NOT NULL DEFAULT 0,
  last_query TEXT,
  PRIMARY KEY (municipio, uf)
);

-- Janela deslizante de rate limit para a rota /contato (anti-scraping).
CREATE TABLE IF NOT EXISTS reveal_rate (
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reveal_ip ON reveal_rate (ip, ts);

-- Empresas removidas dos resultados (opt-out LGPD, apos aprovacao).
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
