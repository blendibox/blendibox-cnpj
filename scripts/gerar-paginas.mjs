/**
 * Gerador de páginas estáticas por empresa (SEO).
 *
 * Lê os CNPJs já pesquisados (cache do Worker via /export), gera uma página
 * HTML estática por empresa em frontend/empresa/{slug}-{cnpj}/index.html e
 * atualiza o sitemap. Rode pela GitHub Action (ou local).
 *
 * Variáveis de ambiente:
 *   API_BASE      URL do Worker (default: produção)
 *   ADMIN_TOKEN   token do /export (obrigatório)
 *   SITE_URL      domínio do site (default: produção)
 *
 * Poda por demanda: se houver mais de MAX_SEM_PODA empresas, descarta as que
 * foram pesquisadas uma única vez (hits <= 1) há mais de PODA_DIAS dias.
 */

import { writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const API_BASE = process.env.API_BASE || "https://buscador-empresas-blendibox.blendibox.workers.dev";
const SITE_URL = (process.env.SITE_URL || "https://buscadeempresa.blendibox.com.br").replace(/\/$/, "");
const TOKEN = process.env.ADMIN_TOKEN;

const MAX_SEM_PODA = 20000; // abaixo disso, gera todas
const PODA_DIAS = 180; // acima do limite, descarta hits<=1 mais antigas que isso

const RAIZ = path.resolve(process.cwd(), "frontend");
const DIR_EMPRESAS = path.join(RAIZ, "empresa");

if (!TOKEN) {
  console.error("ERRO: defina a variável de ambiente ADMIN_TOKEN.");
  process.exit(1);
}

/* ------------------------- coleta ------------------------- */

async function coletarEmpresas() {
  const todas = [];
  let offset = 0;
  const limit = 500;
  while (true) {
    const url = `${API_BASE}/export?token=${encodeURIComponent(TOKEN)}&limit=${limit}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`/export retornou ${res.status}`);
    const json = await res.json();
    todas.push(...(json.empresas || []));
    offset += limit;
    if (offset >= (json.total || 0) || (json.empresas || []).length === 0) break;
  }
  return todas;
}

function aplicarPoda(empresas) {
  if (empresas.length <= MAX_SEM_PODA) return empresas;
  const corte = Date.now() - PODA_DIAS * 86400000;
  return empresas.filter((e) => {
    const umaVezSo = (e.hits || 0) <= 1;
    const antiga = e.last_hit && new Date(e.last_hit).getTime() < corte;
    return !(umaVezSo && antiga); // descarta só as de baixo valor
  });
}

/* ------------------------- geração ------------------------- */

async function main() {
  console.log(`Coletando empresas de ${API_BASE} ...`);
  const brutas = await coletarEmpresas();
  const empresas = aplicarPoda(brutas);
  console.log(`Total no cache: ${brutas.length} | após poda: ${empresas.length}`);

  // Limpa e recria a pasta de empresas (evita páginas órfãs)
  if (existsSync(DIR_EMPRESAS)) await rm(DIR_EMPRESAS, { recursive: true, force: true });
  await mkdir(DIR_EMPRESAS, { recursive: true });

  const urls = [];
  for (const e of empresas) {
    const d = e.data || {};
    const cnpj = onlyDigits(d.cnpj || e.cnpj);
    if (cnpj.length !== 14) continue;
    // LGPD: pula MEI/pessoa física com CPF no nome (evita indexar CPF).
    if (/\d{11}/.test(d.razao_social || "")) {
      console.log("  (pulado por privacidade — CPF no nome):", cnpj);
      continue;
    }
    const s = `${slug(d.razao_social || d.nome_fantasia)}-${cnpj}`;
    const dir = path.join(DIR_EMPRESAS, s);
    await mkdir(dir, { recursive: true });
    const rota = `/empresa/${s}/`;
    await writeFile(path.join(dir, "index.html"), paginaEmpresa(d, rota), "utf-8");
    urls.push({ loc: `${SITE_URL}${rota}`, lastmod: (e.updated_at || "").slice(0, 10) });
  }

  await escreverSitemap(urls);
  console.log(`Geradas ${urls.length} páginas + sitemap.`);
}

async function escreverSitemap(urls) {
  const hoje = new Date().toISOString().slice(0, 10);
  const fixas = [
    `  <url><loc>${SITE_URL}/</loc><lastmod>${hoje}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    `  <url><loc>${SITE_URL}/termos.html</loc><lastmod>${hoje}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>`,
    `  <url><loc>${SITE_URL}/privacidade.html</loc><lastmod>${hoje}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>`,
  ];
  const dinamicas = urls.map(
    (u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod || hoje}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`
  );
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    [...fixas, ...dinamicas].join("\n") +
    `\n</urlset>\n`;
  await writeFile(path.join(RAIZ, "sitemap.xml"), xml, "utf-8");
}

/* ------------------------- template ------------------------- */

function paginaEmpresa(d, rota) {
  const cnpj = onlyDigits(d.cnpj);
  const cnpjFmt = fmtCnpj(cnpj);
  const razao = d.razao_social || "Empresa";
  const situacao = d.descricao_situacao_cadastral || "";
  const ativa = situacao.toUpperCase() === "ATIVA";
  const badge = ativa
    ? "badge-ativa"
    : /BAIXAD|INAPT|SUSPENS/.test(situacao.toUpperCase())
    ? "badge-inativa"
    : "badge-outra";
  const cidadeUf = [d.municipio, d.uf].filter(Boolean).join(" - ");
  const endereco = [d.logradouro, d.numero, d.complemento, d.bairro].filter(Boolean).join(", ");
  const canonical = `${SITE_URL}${rota}`;
  const desc = `${razao} (CNPJ ${cnpjFmt})${situacao ? " · " + situacao : ""}${cidadeUf ? " · " + cidadeUf : ""}${d.cnae_fiscal_descricao ? " · " + d.cnae_fiscal_descricao : ""}. Consulta grátis de CNPJ na Blendibox.`;
  const sec = Array.isArray(d.cnaes_secundarios) ? d.cnaes_secundarios.filter((c) => c && c.codigo) : [];
  const socios = Array.isArray(d.qsa) ? d.qsa : [];

  const jsonld = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: razao,
    legalName: razao,
    alternateName: d.nome_fantasia || undefined,
    taxID: cnpj,
    foundingDate: d.data_inicio_atividade || undefined,
    url: canonical,
    address: d.municipio
      ? {
          "@type": "PostalAddress",
          streetAddress: [d.logradouro, d.numero].filter(Boolean).join(", ") || undefined,
          addressLocality: d.municipio || undefined,
          addressRegion: d.uf || undefined,
          postalCode: d.cep || undefined,
          addressCountry: "BR",
        }
      : undefined,
  };

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(razao)} — CNPJ ${cnpjFmt} | Busca de Empresa Blendibox</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="${canonical}" />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
  <meta name="theme-color" content="#1f6feb" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Busca de Empresa Blendibox" />
  <meta property="og:title" content="${esc(razao)} — CNPJ ${cnpjFmt}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:image" content="${SITE_URL}/og-image.svg" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <script type="application/ld+json">${JSON.stringify(JSON.parse(JSON.stringify(jsonld)))}</script>
  <link rel="stylesheet" href="/styles.css" />
  <link rel="stylesheet" href="/ads.css" />
</head>
<body>
  <header class="topo">
    <div class="wrap topo-conteudo">
      <a href="/" class="marca">
        <span class="marca-icone">🔎</span>
        <span class="marca-texto">Busca de Empresa <strong>Blendibox</strong></span>
      </a>
      <a class="topo-cta" href="https://chromewebstore.google.com/detail/busca-de-empresa-blendibo/lhglejndpilbffhplpbgmhgdngekcdah" target="_blank" rel="noopener" aria-label="Adicionar a extensão ao Chrome — grátis">
        <span class="cta-full">＋ Adicionar ao Chrome</span>
        <span class="cta-short">＋ Chrome</span>
      </a>
    </div>
  </header>

  <main class="wrap">
    <section class="resultado">
      <div class="card">
        <div class="card-cabecalho">
          <h1 class="razao">${esc(razao)} <span class="badge ${badge}">${esc(situacao) || "—"}</span></h1>
          ${d.nome_fantasia ? `<p class="fantasia">${esc(d.nome_fantasia)}</p>` : ""}
          <div class="cnpj-linha">CNPJ: <strong>${cnpjFmt}</strong></div>
        </div>
        <div class="grade">
          ${item("Abertura", fmtData(d.data_inicio_atividade))}
          ${item("Natureza jurídica", d.natureza_juridica)}
          ${item("Porte", d.porte)}
          ${item("Capital social", fmtMoeda(d.capital_social))}
          ${item("Simples Nacional", simNao(d.opcao_pelo_simples))}
          ${item("MEI", simNao(d.opcao_pelo_mei))}
        </div>
      </div>

      <div id="ads-inline" class="ads-area"></div>

      <div class="card">
        <h2 class="secao-titulo">Atividade principal</h2>
        <div class="item"><div class="valor">${esc(codDesc(d.cnae_fiscal, d.cnae_fiscal_descricao))}</div></div>
        ${
          sec.length
            ? `<h2 class="secao-titulo" style="margin-top:20px">Atividades secundárias</h2>
               <ul class="lista-simples">${sec.map((c) => `<li>${esc(codDesc(c.codigo, c.descricao))}</li>`).join("")}</ul>`
            : ""
        }
      </div>

      <div class="card">
        <h2 class="secao-titulo">Endereço e contato</h2>
        <div class="grade">
          ${item("Logradouro", endereco)}
          ${item("Município / UF", cidadeUf)}
          ${item("CEP", fmtCep(d.cep))}
          ${item("Telefone", maskTel(d.ddd_telefone_1))}
          ${item("E-mail", maskEmail(d.email))}
        </div>
      </div>

      ${
        socios.length
          ? `<div class="card">
               <h2 class="secao-titulo">Quadro societário (${socios.length})</h2>
               <ul class="lista-simples">
                 ${socios
                   .map((s) => `<li class="socio"><span>${esc(maskNome(s.nome_socio)) || "—"}</span><span class="qualif">${esc(s.qualificacao_socio) || ""}</span></li>`)
                   .join("")}
               </ul>
               <p class="fonte-tag">Nomes exibidos parcialmente por privacidade (LGPD).</p>
             </div>`
          : ""
      }

      <p class="optout-linha">
        <a class="busca-btn" style="display:inline-block;text-decoration:none" href="/?cnpj=${cnpj}">Ver contato completo / atualizar</a>
      </p>
    </section>

    <section id="ads-rodape" class="ads-area" aria-label="Produtos recomendados"></section>
  </main>

  <footer class="rodape">
    <div class="wrap">
      <p>Dados públicos da Receita Federal (Dados Abertos CNPJ). Sócios exibidos de forma parcial (LGPD).</p>
      <p><a href="/termos.html">Sobre os dados e privacidade (LGPD)</a></p>
      <p class="rodape-marca">Busca de Empresa — Blendibox</p>
    </div>
  </footer>

  <script src="/ads.js"></script>
</body>
</html>
`;
}

/* ------------------------- helpers ------------------------- */

function item(rotulo, valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  return `<div class="item"><div class="rotulo">${rotulo}</div><div class="valor">${esc(valor)}</div></div>`;
}
function codDesc(cod, d) {
  if (!cod && !d) return "—";
  return `${cod ? cod + " — " : ""}${d || ""}`.trim();
}
function simNao(v) {
  return v === true ? "Sim" : v === false ? "Não" : "";
}
function slug(s) {
  return (
    (s || "empresa")
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "empresa"
  );
}
function onlyDigits(s) {
  return (s || "").toString().replace(/\D/g, "");
}
function fmtCnpj(c) {
  c = onlyDigits(c);
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}
function fmtCep(c) {
  const d = onlyDigits(c);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : c || "";
}
function fmtData(iso) {
  if (!iso) return "";
  const p = String(iso).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}
function fmtMoeda(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isNaN(n) ? "" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function maskNome(nome) {
  if (!nome) return nome || "";
  const p = String(nome).trim().split(/\s+/);
  if (p.length === 1) return p[0];
  return p[0] + " " + p.slice(1).map((w) => w[0] + "*".repeat(Math.max(1, w.length - 1))).join(" ");
}
function maskEmail(email) {
  if (!email) return "";
  const [u, dom] = String(email).split("@");
  if (!dom) return "***";
  const uu = u.length <= 2 ? u[0] + "*" : u.slice(0, 2) + "*".repeat(Math.max(1, u.length - 2));
  return `${uu}@${dom}`;
}
function maskTel(tel) {
  if (!tel) return "";
  const d = String(tel).replace(/\D/g, "");
  if (d.length < 6) return "***";
  return d.slice(0, 2) + "*".repeat(d.length - 4) + d.slice(-2);
}
function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
