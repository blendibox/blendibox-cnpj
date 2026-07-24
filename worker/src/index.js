/**
 * Buscador de Empresas - Blendibox
 * Cloudflare Worker — API de consulta de CNPJ (cache-aside sobre a BrasilAPI)
 *
 * Fluxo:
 *   1. Recebe GET /cnpj/{cnpj}
 *   2. Procura no D1 (nossa base de consultas realizadas)
 *   3. Se existir e estiver fresco (< TTL) -> devolve do cache
 *   4. Se nao existir ou estiver velho -> consulta a BrasilAPI,
 *      devolve ao usuario E grava no D1 para a proxima vez
 *
 * Tambem conta a demanda por cidade, para no futuro permitir
 * "promover" uma cidade inteira (importacao em lote da Receita).
 */

// Fontes de dados, em ordem de preferencia.
// minhareceita.org e a primaria porque nao bloqueia os IPs da Cloudflare;
// a BrasilAPI entra como fallback automatico. Ambas usam o mesmo formato
// de campos, entao a resposta ao frontend e a mesma.
const UPSTREAMS = [
  { nome: "minhareceita", url: (c) => `https://minhareceita.org/${c}` },
  { nome: "brasilapi", url: (c) => `https://brasilapi.com.br/api/cnpj/v1/${c}` },
];

/**
 * Consulta as fontes em ordem. Retorna:
 *   { status: 200, data, fonte }  -> sucesso
 *   { status: 404 }               -> CNPJ nao existe (definitivo)
 *   { status: 429|502 }           -> todas as fontes falharam
 */
async function consultarUpstream(cnpj) {
  let ultimoStatus = 0;
  for (const src of UPSTREAMS) {
    try {
      const res = await fetch(src.url(cnpj), {
        headers: { Accept: "application/json" },
      });
      if (res.status === 404) return { status: 404 };
      if (res.ok) {
        const data = await res.json();
        return { status: 200, data, fonte: src.nome };
      }
      ultimoStatus = res.status; // 429/5xx -> tenta a proxima fonte
    } catch (_) {
      ultimoStatus = 502;
    }
  }
  return { status: ultimoStatus || 502 };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Preflight CORS
    if (request.method === "OPTIONS") {
      return corsResponse(null, 204);
    }

    // Rota de saude / info
    if (url.pathname === "/" || url.pathname === "/health") {
      return corsResponse(
        { service: "buscador-empresas-blendibox", status: "ok" },
        200
      );
    }

    // Rota principal: /cnpj/{cnpj}
    const match = url.pathname.match(/^\/cnpj\/([^/]+)\/?$/);
    if (request.method === "GET" && match) {
      return handleConsulta(match[1], env, ctx);
    }

    return corsResponse({ erro: "Rota nao encontrada" }, 404);
  },

  /**
   * Cron trigger: reprocessa as entradas mais antigas/vencidas
   * para manter a base fresca sem depender do usuario buscar de novo.
   * Lote pequeno para respeitar o rate limit da BrasilAPI.
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshVencidos(env));
  },
};

async function handleConsulta(cnpjRaw, env, ctx) {
  const cnpj = onlyDigits(cnpjRaw);

  if (!isValidCnpj(cnpj)) {
    return corsResponse({ erro: "CNPJ invalido" }, 400);
  }

  const ttlDays = parseInt(env.CACHE_TTL_DAYS ?? "30", 10);
  const mask = (env.MASK_SOCIOS ?? "true") === "true";

  // 1. Tenta o cache (D1)
  const cached = await getFromCache(env, cnpj);
  if (cached && !isStale(cached.updated_at, ttlDays)) {
    const data = JSON.parse(cached.payload);
    return corsResponse(
      { fonte: "cache", data: mask ? maskSocios(data) : data },
      200
    );
  }

  // 2. Cache miss (ou vencido) -> consulta as fontes (minhareceita, depois BrasilAPI)
  const up = await consultarUpstream(cnpj);

  if (up.status === 200) {
    // 3. Grava no cache em background (nao atrasa a resposta)
    ctx.waitUntil(saveToCache(env, cnpj, up.data));
    // 4. Devolve ao usuario (mascarado se configurado)
    return corsResponse(
      { fonte: up.fonte, data: mask ? maskSocios(up.data) : up.data },
      200
    );
  }

  if (up.status === 404) {
    return corsResponse({ erro: "CNPJ nao encontrado" }, 404);
  }

  // Todas as fontes falharam: se tivermos cache (mesmo vencido), servimos.
  if (cached) {
    const data = JSON.parse(cached.payload);
    return corsResponse(
      { fonte: "cache-vencido", data: mask ? maskSocios(data) : data },
      200
    );
  }

  const msg =
    up.status === 429
      ? "Limite das fontes de dados atingido, tente novamente em instantes"
      : "Fontes de dados indisponiveis no momento";
  return corsResponse({ erro: msg }, up.status === 429 ? 429 : 502);
}

/* ------------------------- D1 (cache) ------------------------- */

async function getFromCache(env, cnpj) {
  return env.DB.prepare(
    "SELECT payload, updated_at FROM cnpj_cache WHERE cnpj = ?"
  )
    .bind(cnpj)
    .first();
}

async function saveToCache(env, cnpj, data) {
  const now = new Date().toISOString();
  const municipio = data?.municipio ?? null;
  const uf = data?.uf ?? null;
  const payload = JSON.stringify(data);

  // Upsert no cache
  await env.DB.prepare(
    `INSERT INTO cnpj_cache (cnpj, payload, municipio, uf, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(cnpj) DO UPDATE SET
       payload = excluded.payload,
       municipio = excluded.municipio,
       uf = excluded.uf,
       updated_at = excluded.updated_at`
  )
    .bind(cnpj, payload, municipio, uf, now)
    .run();

  // Conta demanda por cidade (para futura "promocao" de regiao)
  if (municipio) {
    await env.DB.prepare(
      `INSERT INTO city_demand (municipio, uf, consultas, last_query)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(municipio, uf) DO UPDATE SET
         consultas = consultas + 1,
         last_query = excluded.last_query`
    )
      .bind(municipio, uf, now)
      .run();
  }
}

async function refreshVencidos(env) {
  const ttlDays = parseInt(env.CACHE_TTL_DAYS ?? "30", 10);
  const limite = new Date(Date.now() - ttlDays * 86400000).toISOString();

  // Pega ate 50 registros vencidos (lote pequeno = respeita rate limit)
  const { results } = await env.DB.prepare(
    "SELECT cnpj FROM cnpj_cache WHERE updated_at < ? ORDER BY updated_at ASC LIMIT 50"
  )
    .bind(limite)
    .all();

  for (const row of results ?? []) {
    try {
      const up = await consultarUpstream(row.cnpj);
      if (up.status === 200) {
        await saveToCache(env, row.cnpj, up.data);
      }
      // pequena pausa entre chamadas
      await sleep(1200);
    } catch (_) {
      // ignora e segue para o proximo no proximo ciclo
    }
  }
}

/* ------------------------- Utilidades ------------------------- */

function onlyDigits(s) {
  return (s || "").replace(/\D/g, "");
}

function isStale(updatedAtISO, ttlDays) {
  const age = Date.now() - new Date(updatedAtISO).getTime();
  return age > ttlDays * 86400000;
}

function isValidCnpj(cnpj) {
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const calc = (base) => {
    const len = base.length;
    let pos = len - 7;
    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += parseInt(base[i], 10) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };

  const base12 = cnpj.slice(0, 12);
  const d1 = calc(base12);
  const d2 = calc(base12 + d1);
  return cnpj === base12 + String(d1) + String(d2);
}

/** Mascara nome e documento dos socios (LGPD). Mantem o 1o nome. */
function maskSocios(data) {
  if (!data || !Array.isArray(data.qsa)) return data;
  return {
    ...data,
    qsa: data.qsa.map((s) => ({
      ...s,
      nome_socio: maskNome(s.nome_socio),
      cnpj_cpf_do_socio: maskDoc(s.cnpj_cpf_do_socio),
    })),
  };
}

function maskNome(nome) {
  if (!nome) return nome;
  const partes = String(nome).trim().split(/\s+/);
  if (partes.length === 1) return partes[0];
  const primeiro = partes[0];
  const resto = partes
    .slice(1)
    .map((p) => p[0] + "*".repeat(Math.max(1, p.length - 1)))
    .join(" ");
  return `${primeiro} ${resto}`;
}

function maskDoc(doc) {
  if (!doc) return doc;
  const d = String(doc).replace(/\D/g, "");
  if (d.length >= 11) {
    // CPF mascarado: ***.XXX.XXX-**
    return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  }
  return "***";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ------------------------- CORS ------------------------- */

function corsResponse(body, status = 200) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
  if (body === null) {
    return new Response(null, { status, headers });
  }
  headers["Content-Type"] = "application/json; charset=utf-8";
  return new Response(JSON.stringify(body), { status, headers });
}
