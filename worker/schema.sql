-- Buscador de Empresas - Blendibox
-- Esquema do D1

-- Cache de CNPJs consultados (nossa "base de consultas realizadas").
-- Guardamos o payload COMPLETO da BrasilAPI (sem mascarar);
-- a mascara de socios e aplicada na resposta ao usuario.
CREATE TABLE IF NOT EXISTS cnpj_cache (
  cnpj       TEXT PRIMARY KEY,      -- 14 digitos, so numeros
  payload    TEXT NOT NULL,         -- JSON completo da BrasilAPI
  municipio  TEXT,
  uf         TEXT,
  updated_at TEXT NOT NULL          -- ISO 8601 (para calcular TTL)
);

CREATE INDEX IF NOT EXISTS idx_cache_updated ON cnpj_cache (updated_at);
CREATE INDEX IF NOT EXISTS idx_cache_cidade  ON cnpj_cache (uf, municipio);

-- Contador de demanda por cidade.
-- Base para no futuro "promover" uma cidade inteira (importacao em lote).
CREATE TABLE IF NOT EXISTS city_demand (
  municipio  TEXT NOT NULL,
  uf         TEXT,
  consultas  INTEGER NOT NULL DEFAULT 0,
  last_query TEXT,
  PRIMARY KEY (municipio, uf)
);
