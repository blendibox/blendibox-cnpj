-- Migracao 004 — coordenadas geocodificadas (mapa + distancia)
-- wrangler d1 execute buscador-empresas-blendibox --remote --file=./migrations/004_geo.sql

ALTER TABLE cnpj_cache ADD COLUMN lat REAL;
ALTER TABLE cnpj_cache ADD COLUMN lon REAL;
