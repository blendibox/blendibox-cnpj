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

    // Solicitacao de remocao (opt-out LGPD): POST /optout
    if (url.pathname === "/optout" && request.method === "POST") {
      return handleOptout(request, env);
    }

    // Rotas de administracao (protegidas por token)
    if (url.pathname.startsWith("/admin/")) {
      return handleAdmin(url, request, env);
    }

    // Export dos CNPJs em cache (protegido) — gera as paginas estaticas
    if (url.pathname === "/export" && request.method === "GET") {
      return handleExport(url, env);
    }

    // Geocodificacao (mapa + distancia): /geocode?cnpj=...
    if (url.pathname === "/geocode" && request.method === "GET") {
      return handleGeocode(url, env);
    }

    // Assistente de vendas (IA): POST /ia/chat
    if (url.pathname === "/ia/chat" && request.method === "POST") {
      return handleIaChat(request, env);
    }

    // Busca por nome na base ja cacheada: /buscar?nome=...
    if (url.pathname === "/buscar" && request.method === "GET") {
      return handleBuscaNome(url, env);
    }

    // Revelar contato completo (rate-limited): /cnpj/{cnpj}/contato
    const mContato = url.pathname.match(/^\/cnpj\/([^/]+)\/contato\/?$/);
    if (request.method === "GET" && mContato) {
      return handleContato(mContato[1], request, env);
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

  // 0. Empresa optou por sair dos resultados? (LGPD)
  if (await isBlacklisted(env, cnpj)) {
    return corsResponse(
      {
        removido: true,
        mensagem:
          "Esta empresa solicitou a remoção dos resultados de busca e não é mais exibida aqui.",
      },
      200
    );
  }

  const ttlDays = parseInt(env.CACHE_TTL_DAYS ?? "30", 10);

  // 1. Tenta o cache (D1)
  const cached = await getFromCache(env, cnpj);
  if (cached && !isStale(cached.updated_at, ttlDays)) {
    const data = JSON.parse(cached.payload);
    ctx.waitUntil(registrarHit(env, cnpj));
    return corsResponse({ fonte: "cache", data: aplicarMascaras(data, env) }, 200);
  }

  // 2. Cache miss (ou vencido) -> consulta as fontes (minhareceita, depois BrasilAPI)
  const up = await consultarUpstream(cnpj);

  if (up.status === 200) {
    // 3. Grava no cache em background e conta o hit (nao atrasa a resposta)
    ctx.waitUntil(saveToCache(env, cnpj, up.data).then(() => registrarHit(env, cnpj)));
    // 4. Devolve ao usuario (mascarado)
    return corsResponse({ fonte: up.fonte, data: aplicarMascaras(up.data, env) }, 200);
  }

  if (up.status === 404) {
    return corsResponse({ erro: "CNPJ nao encontrado" }, 404);
  }

  // Todas as fontes falharam: se tivermos cache (mesmo vencido), servimos.
  if (cached) {
    const data = JSON.parse(cached.payload);
    ctx.waitUntil(registrarHit(env, cnpj));
    return corsResponse(
      { fonte: "cache-vencido", data: aplicarMascaras(data, env) },
      200
    );
  }

  const msg =
    up.status === 429
      ? "Limite das fontes de dados atingido, tente novamente em instantes"
      : "Fontes de dados indisponiveis no momento";
  return corsResponse({ erro: msg }, up.status === 429 ? 429 : 502);
}

/**
 * Busca por nome dentro da base JA cacheada (empresas ja consultadas).
 * Prioriza correspondencia exata; no parcial, traz ate 10 resultados.
 */
async function handleBuscaNome(url, env) {
  const termo = (url.searchParams.get("nome") || "").trim();
  if (termo.length < 3) {
    return corsResponse({ erro: "Digite ao menos 3 caracteres." }, 400);
  }

  const like = `%${termo}%`;
  const { results } = await env.DB.prepare(
    `SELECT cnpj, razao_social, nome_fantasia, municipio, uf
       FROM cnpj_cache
      WHERE razao_social LIKE ? COLLATE NOCASE
         OR nome_fantasia LIKE ? COLLATE NOCASE
      ORDER BY CASE WHEN razao_social = ? COLLATE NOCASE THEN 0 ELSE 1 END,
               LENGTH(razao_social) ASC
      LIMIT 10`
  )
    .bind(like, like, termo)
    .all();

  return corsResponse({ termo, total: (results ?? []).length, resultados: results ?? [] }, 200);
}

/**
 * Revela e-mail/telefone completos. Rate-limited por IP e apenas para
 * CNPJs ja em cache (nao dispara nova consulta a fonte). Anti-scraping.
 */
async function handleContato(cnpjRaw, request, env) {
  const cnpj = onlyDigits(cnpjRaw);
  if (!isValidCnpj(cnpj)) {
    return corsResponse({ erro: "CNPJ invalido" }, 400);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
  const limite = parseInt(env.REVEAL_LIMIT_MIN ?? "10", 10);
  const ok = await checkRateLimit(env, ip, limite, 60000);
  if (!ok) {
    return corsResponse({ erro: "Muitas solicitacoes. Aguarde um instante." }, 429);
  }

  const cached = await getFromCache(env, cnpj);
  if (!cached) {
    return corsResponse({ erro: "Consulte o CNPJ primeiro." }, 404);
  }

  const data = JSON.parse(cached.payload);
  return corsResponse(
    {
      email: data.email ?? null,
      telefone1: data.ddd_telefone_1 ?? null,
      telefone2: data.ddd_telefone_2 ?? null,
    },
    200
  );
}

/** Rate limit por IP usando janela deslizante no D1. */
async function checkRateLimit(env, ip, limite, windowMs) {
  const now = Date.now();
  const cutoff = now - windowMs;
  await env.DB.prepare("DELETE FROM reveal_rate WHERE ip = ? AND ts < ?")
    .bind(ip, cutoff)
    .run();
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM reveal_rate WHERE ip = ?"
  )
    .bind(ip)
    .first();
  if ((row?.n ?? 0) >= limite) return false;
  await env.DB.prepare("INSERT INTO reveal_rate (ip, ts) VALUES (?, ?)")
    .bind(ip, now)
    .run();
  return true;
}

/* ------------------------- Opt-out (LGPD) ------------------------- */

async function isBlacklisted(env, cnpj) {
  const row = await env.DB.prepare("SELECT 1 FROM blacklist WHERE cnpj = ?")
    .bind(cnpj)
    .first();
  return !!row;
}

/** Recebe uma solicitacao de remocao e grava como 'pendente' (revisao manual). */
async function handleOptout(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return corsResponse({ erro: "Corpo invalido." }, 400);
  }

  const cnpj = onlyDigits(body.cnpj || "");
  const nome = (body.nome || "").toString().trim().slice(0, 120);
  const vinculo = (body.vinculo || "").toString().trim().slice(0, 60);
  const email = (body.email || "").toString().trim().slice(0, 120);
  const motivo = (body.motivo || "").toString().trim().slice(0, 500);

  if (!isValidCnpj(cnpj)) return corsResponse({ erro: "CNPJ invalido." }, 400);
  if (nome.length < 3) return corsResponse({ erro: "Informe seu nome." }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return corsResponse({ erro: "Informe um e-mail valido." }, 400);
  }

  // Anti-spam por IP
  const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
  const ok = await checkRateLimit(env, ip, 5, 60000);
  if (!ok) return corsResponse({ erro: "Muitas solicitacoes. Aguarde um instante." }, 429);

  // Ja pendente?
  const jaTem = await env.DB.prepare(
    "SELECT 1 FROM optout_requests WHERE cnpj = ? AND status = 'pendente'"
  )
    .bind(cnpj)
    .first();
  if (jaTem) {
    return corsResponse(
      { ok: true, mensagem: "Já existe uma solicitação em análise para este CNPJ." },
      200
    );
  }

  const cached = await getFromCache(env, cnpj);
  const razao = cached ? JSON.parse(cached.payload).razao_social ?? null : null;

  await env.DB.prepare(
    `INSERT INTO optout_requests
       (cnpj, razao_social, nome_solicitante, vinculo, email_contato, motivo, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?)`
  )
    .bind(cnpj, razao, nome, vinculo, email, motivo, new Date().toISOString())
    .run();

  return corsResponse(
    {
      ok: true,
      mensagem:
        "Solicitação recebida. Após análise, a empresa será removida dos resultados.",
    },
    200
  );
}

/**
 * Rotas de administracao, protegidas pelo secret ADMIN_TOKEN:
 *   GET  /admin/optout?token=...           -> lista solicitacoes pendentes
 *   POST /admin/optout/aprovar {cnpj,token} -> blacklist + apaga cache
 *   POST /admin/optout/rejeitar {id,token}  -> marca como rejeitada
 */
async function handleAdmin(url, request, env) {
  if (!env.ADMIN_TOKEN) {
    return corsResponse({ erro: "Admin desativado (configure ADMIN_TOKEN)." }, 501);
  }

  // Token via querystring (GET) ou corpo (POST)
  let body = {};
  if (request.method === "POST") {
    try {
      body = await request.json();
    } catch (_) {
      body = {};
    }
  }
  const token = url.searchParams.get("token") || body.token || "";
  if (token !== env.ADMIN_TOKEN) {
    return corsResponse({ erro: "Nao autorizado." }, 401);
  }

  if (url.pathname === "/admin/optout" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT id, cnpj, razao_social, nome_solicitante, vinculo, email_contato, motivo, created_at FROM optout_requests WHERE status = 'pendente' ORDER BY created_at ASC"
    ).all();
    return corsResponse({ pendentes: results ?? [] }, 200);
  }

  if (url.pathname === "/admin/optout/aprovar" && request.method === "POST") {
    const cnpj = onlyDigits(body.cnpj || "");
    if (!isValidCnpj(cnpj)) return corsResponse({ erro: "CNPJ invalido." }, 400);
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO blacklist (cnpj, motivo, created_at) VALUES (?, 'opt-out', ?) ON CONFLICT(cnpj) DO NOTHING"
    )
      .bind(cnpj, now)
      .run();
    // Direito ao esquecimento: apaga o cache da empresa
    await env.DB.prepare("DELETE FROM cnpj_cache WHERE cnpj = ?").bind(cnpj).run();
    await env.DB.prepare(
      "UPDATE optout_requests SET status = 'aprovada' WHERE cnpj = ? AND status = 'pendente'"
    )
      .bind(cnpj)
      .run();
    return corsResponse({ ok: true, mensagem: "Empresa removida dos resultados." }, 200);
  }

  if (url.pathname === "/admin/optout/rejeitar" && request.method === "POST") {
    const id = parseInt(body.id, 10);
    if (!id) return corsResponse({ erro: "id invalido." }, 400);
    await env.DB.prepare(
      "UPDATE optout_requests SET status = 'rejeitada' WHERE id = ?"
    )
      .bind(id)
      .run();
    return corsResponse({ ok: true }, 200);
  }

  return corsResponse({ erro: "Rota admin nao encontrada." }, 404);
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
  const razao = data?.razao_social ?? null;
  const fantasia = data?.nome_fantasia ?? null;
  const payload = JSON.stringify(data);

  // Upsert no cache
  await env.DB.prepare(
    `INSERT INTO cnpj_cache (cnpj, payload, razao_social, nome_fantasia, municipio, uf, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cnpj) DO UPDATE SET
       payload = excluded.payload,
       razao_social = excluded.razao_social,
       nome_fantasia = excluded.nome_fantasia,
       municipio = excluded.municipio,
       uf = excluded.uf,
       updated_at = excluded.updated_at`
  )
    .bind(cnpj, payload, razao, fantasia, municipio, uf, now)
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

/**
 * Geocodifica o endereço do CNPJ (Nominatim/OSM) e guarda lat/lon no D1.
 * Cada endereço é geocodificado só uma vez (cache).
 */
async function handleGeocode(url, env) {
  const cnpj = onlyDigits(url.searchParams.get("cnpj") || "");
  if (!isValidCnpj(cnpj)) return corsResponse({ erro: "CNPJ invalido" }, 400);

  const row = await env.DB.prepare(
    "SELECT payload, lat, lon FROM cnpj_cache WHERE cnpj = ?"
  )
    .bind(cnpj)
    .first();
  if (!row) return corsResponse({ erro: "Consulte o CNPJ primeiro." }, 404);
  if (row.lat != null && row.lon != null) {
    return corsResponse({ lat: row.lat, lon: row.lon, fonte: "cache" }, 200);
  }

  const d = JSON.parse(row.payload);

  try {
    let geo = null;
    let aproximado = false;
    // 1. tenta rua + cidade + estado (preciso)
    if (d.logradouro && d.municipio) {
      const street = [d.logradouro, d.numero].filter(Boolean).join(" ");
      geo = await geoNominatim(
        `street=${enc(street)}&city=${enc(d.municipio)}&state=${enc(d.uf || "")}`
      );
    }
    // 2. fallback: centro do município (aproximado)
    if (!geo && d.municipio) {
      geo = await geoNominatim(
        `city=${enc(d.municipio)}&state=${enc(d.uf || "")}&country=Brasil`
      );
      aproximado = true;
    }
    if (!geo) return corsResponse({ erro: "endereco nao localizado" }, 404);

    await env.DB.prepare("UPDATE cnpj_cache SET lat = ?, lon = ? WHERE cnpj = ?")
      .bind(geo.lat, geo.lon, cnpj)
      .run();
    return corsResponse({ lat: geo.lat, lon: geo.lon, aproximado }, 200);
  } catch (_) {
    return corsResponse({ erro: "geocode falhou" }, 502);
  }
}

function enc(s) {
  return encodeURIComponent((s || "").toString().trim());
}

async function geoNominatim(params) {
  const r = await fetch(
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&" + params,
    {
      headers: {
        "User-Agent": "BuscaDeEmpresaBlendibox/1.0 (atendimento@blendibox.com.br)",
        Accept: "application/json",
      },
    }
  );
  if (!r.ok) return null;
  const arr = await r.json();
  if (!arr.length) return null;
  return { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon) };
}

/**
 * Assistente de vendas (SDR) com IA — Cloudflare Workers AI.
 * Stateless: o frontend envia o histórico. Pode ser aterrado nos dados
 * públicos do CNPJ do lead (diferencial).
 */
async function handleIaChat(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return corsResponse({ erro: "Corpo invalido." }, 400);
  }

  const mensagens = Array.isArray(body.mensagens) ? body.mensagens.slice(-12) : [];
  if (!mensagens.length) return corsResponse({ erro: "Sem mensagens." }, 400);

  const cfg = body.config || {};
  let contextoEmpresa = "";
  const cnpj = onlyDigits(body.cnpjLead || "");
  if (isValidCnpj(cnpj)) {
    const resumo = await resumoParaIa(env, cnpj);
    if (resumo) contextoEmpresa = `\nDados públicos da empresa do lead (CNPJ ${cnpj}): ${resumo}. Use para personalizar a abordagem.`;
  }

  const messages = [
    { role: "system", content: montarSystemPrompt(cfg, contextoEmpresa) },
    ...mensagens.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, 2000),
    })),
  ];

  try {
    const modelo = body.modelo || env.IA_MODELO || "@cf/meta/llama-3.2-3b-instruct";
    const r = await env.AI.run(modelo, { messages, max_tokens: 400, temperature: 0.6 });
    const resposta = (r?.response || "").trim();
    return corsResponse({ resposta }, 200);
  } catch (e) {
    return corsResponse({ erro: "Assistente indisponivel no momento.", detalhe: String((e && e.message) || e) }, 502);
  }
}

function montarSystemPrompt(cfg, contextoEmpresa) {
  const empresa = (cfg.empresa || "nossa empresa").toString().slice(0, 80);
  const produto = (cfg.produto || "").toString().slice(0, 900);
  const roteiro = (cfg.roteiro || "").toString().slice(0, 900);
  return [
    `Você é um SDR (assistente de vendas) da ${empresa}, atendendo leads pelo WhatsApp, em português do Brasil.`,
    `Objetivo: atender com cordialidade, tirar dúvidas e QUALIFICAR o lead de forma humanizada — nunca robótica.`,
    produto ? `Sobre a empresa/produto: ${produto}` : "",
    roteiro ? `Roteiro de qualificação (siga com naturalidade, UMA pergunta por vez): ${roteiro}` : "",
    `Regras: mensagens curtas e naturais (estilo WhatsApp); no máximo 1 pergunta por mensagem; nunca invente dados — se não souber, diga que vai verificar com o time. Quando o lead demonstrar interesse claro, ofereça agendar uma conversa com um consultor humano.`,
    contextoEmpresa,
  ]
    .filter(Boolean)
    .join("\n");
}

async function resumoParaIa(env, cnpj) {
  let data = null;
  const cached = await getFromCache(env, cnpj);
  if (cached) data = JSON.parse(cached.payload);
  else {
    const up = await consultarUpstream(cnpj);
    if (up.status === 200) data = up.data;
  }
  if (!data) return "";
  return [
    data.razao_social,
    data.descricao_situacao_cadastral,
    data.porte,
    data.cnae_fiscal_descricao,
    [data.municipio, data.uf].filter(Boolean).join("/"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Incrementa o contador de buscas do CNPJ (para poda por demanda). */
async function registrarHit(env, cnpj) {
  await env.DB.prepare(
    "UPDATE cnpj_cache SET hits = hits + 1, last_hit = ? WHERE cnpj = ?"
  )
    .bind(new Date().toISOString(), cnpj)
    .run();
}

/**
 * Export paginado dos CNPJs em cache (protegido por ADMIN_TOKEN).
 * Usado pelo gerador de paginas estaticas.
 *   GET /export?token=...&limit=500&offset=0
 */
async function handleExport(url, env) {
  if (!env.ADMIN_TOKEN) {
    return corsResponse({ erro: "Export desativado (configure ADMIN_TOKEN)." }, 501);
  }
  if ((url.searchParams.get("token") || "") !== env.ADMIN_TOKEN) {
    return corsResponse({ erro: "Nao autorizado." }, 401);
  }

  const limit = Math.min(1000, Math.max(1, parseInt(url.searchParams.get("limit") || "500", 10)));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));

  const totalRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM cnpj_cache").first();
  const { results } = await env.DB.prepare(
    `SELECT cnpj, payload, hits, last_hit, updated_at
       FROM cnpj_cache
      ORDER BY updated_at ASC
      LIMIT ? OFFSET ?`
  )
    .bind(limit, offset)
    .all();

  const empresas = (results ?? []).map((r) => ({
    cnpj: r.cnpj,
    hits: r.hits,
    last_hit: r.last_hit,
    updated_at: r.updated_at,
    data: JSON.parse(r.payload),
  }));

  return corsResponse(
    { total: totalRow?.n ?? 0, limit, offset, empresas },
    200
  );
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

/** Aplica todas as mascaras configuradas (socios + contato). */
function aplicarMascaras(data, env) {
  let out = data;
  if ((env.MASK_SOCIOS ?? "true") === "true") out = maskSocios(out);
  if ((env.MASK_CONTATO ?? "true") === "true") out = maskContato(out);
  return out;
}

/** Mascara e-mail e telefones (exibicao parcial; anti-scraping). */
function maskContato(data) {
  if (!data) return data;
  return {
    ...data,
    email: maskEmail(data.email),
    ddd_telefone_1: maskTelefone(data.ddd_telefone_1),
    ddd_telefone_2: maskTelefone(data.ddd_telefone_2),
  };
}

function maskEmail(email) {
  if (!email) return email;
  const [user, dom] = String(email).split("@");
  if (!dom) return "***";
  const u =
    user.length <= 2
      ? user[0] + "*"
      : user.slice(0, 2) + "*".repeat(Math.max(1, user.length - 2));
  return `${u}@${dom}`;
}

function maskTelefone(tel) {
  if (!tel) return tel;
  const d = String(tel).replace(/\D/g, "");
  if (d.length < 6) return "***";
  // Mantem os 2 primeiros (DDD parcial) e os 2 ultimos digitos
  return d.slice(0, 2) + "*".repeat(d.length - 4) + d.slice(-2);
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
  if (body === null) {
    return new Response(null, { status, headers });
  }
  headers["Content-Type"] = "application/json; charset=utf-8";
  return new Response(JSON.stringify(body), { status, headers });
}
