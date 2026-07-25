/**
 * Helpers compartilhados (content script + popup).
 * Usa `var`/`function` para serem visíveis entre arquivos do content script.
 */

var API_BASE = "https://buscador-empresas-blendibox.blendibox.workers.dev";
var SITE_URL = "https://buscadeempresa.blendibox.com.br";

function onlyDigits(s) {
  return (s || "").toString().replace(/\D/g, "");
}

function isValidCnpj(cnpj) {
  cnpj = onlyDigits(cnpj);
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
  const b = cnpj.slice(0, 12);
  const d1 = calc(b);
  const d2 = calc(b + d1);
  return cnpj === b + String(d1) + String(d2);
}

function formatarCnpj(d) {
  d = onlyDigits(d).slice(0, 14);
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
function formatarCep(c) {
  const d = onlyDigits(c);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : c || "";
}
function formatarData(iso) {
  if (!iso) return "";
  const p = String(iso).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}
function formatarMoeda(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isNaN(n) ? "" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function formatarTelefone(tel) {
  const d = onlyDigits(tel);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return tel || "";
}
function simNao(v) {
  return v === true ? "Sim" : v === false ? "Não" : "";
}
function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function anoDe(iso) {
  const m = String(iso || "").match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}
function anosDeMercado(d) {
  const a = anoDe(d.data_inicio_atividade);
  return a ? new Date().getFullYear() - a : null;
}

function classeSituacao(sit) {
  const s = String(sit || "").toUpperCase();
  if (s === "ATIVA") return "ok";
  if (/BAIXAD|INAPT|SUSPENS/.test(s)) return "ruim";
  return "neutro";
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
function paginaEmpresaUrl(d) {
  return `${SITE_URL}/empresa/${slug(d.razao_social || d.nome_fantasia)}-${onlyDigits(d.cnpj)}/`;
}

function enderecoTexto(d) {
  return [d.logradouro, d.numero, d.bairro, d.municipio, d.uf, formatarCep(d.cep)]
    .filter(Boolean)
    .join(", ");
}
function mapsLink(d) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(enderecoTexto(d));
}
function rotaLink(d) {
  return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(enderecoTexto(d));
}

// "Conheça esta empresa" — resumo em linguagem simples, sem IA
function resumoEmpresa(d) {
  const partes = [];
  const ano = anoDe(d.data_inicio_atividade);
  partes.push(`${d.razao_social || "A empresa"}${ano ? ` foi aberta em ${ano}` : ""}`);
  if (d.cnae_fiscal_descricao) partes.push(`atua em ${d.cnae_fiscal_descricao.toLowerCase()}`);
  const sit = (d.descricao_situacao_cadastral || "").toLowerCase();
  if (sit) partes.push(`está ${sit}`);
  if (d.porte) partes.push(String(d.porte).toLowerCase());
  if (d.opcao_pelo_simples === true) partes.push("optante do Simples Nacional");
  const uf = [d.municipio, d.uf].filter(Boolean).join("/");
  if (uf) partes.push(`em ${uf}`);
  return partes.join(", ") + ".";
}

// Chamada à API com cache em memória
var _cacheEmpresa = {};
async function getEmpresa(cnpj) {
  cnpj = onlyDigits(cnpj);
  if (_cacheEmpresa[cnpj]) return _cacheEmpresa[cnpj];
  try {
    const r = await fetch(API_BASE + "/cnpj/" + cnpj);
    const j = await r.json();
    const out = { ok: r.ok, status: r.status, ...j };
    _cacheEmpresa[cnpj] = out;
    return out;
  } catch (e) {
    return { ok: false, erro: "Sem conexão com a API." };
  }
}
