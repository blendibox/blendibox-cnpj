/**
 * Buscador de Empresas - Blendibox
 * Frontend estatico (GitHub Pages) — chama o Cloudflare Worker.
 */

// ==========================================================================
// CONFIG: URL do Worker publicado (produção).
// Para testar localmente com "wrangler dev", troque por "http://localhost:8787".
// ==========================================================================
const API_BASE = "https://buscador-empresas-blendibox.blendibox.workers.dev";

const form = document.getElementById("form-busca");
const input = document.getElementById("entrada-cnpj");
const btn = form.querySelector("button");
const boxErro = document.getElementById("msg-erro");
const boxResultado = document.getElementById("resultado");

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const cnpj = onlyDigits(input.value);
  if (cnpj.length !== 14) {
    mostrarErro("Digite um CNPJ com 14 dígitos.");
    return;
  }
  consultar(cnpj);
});

// Formata o campo enquanto digita (00.000.000/0000-00)
input.addEventListener("input", () => {
  const d = onlyDigits(input.value).slice(0, 14);
  input.value = formatarCnpj(d);
});

// Copiar para a área de transferência (delegação de evento nos botões)
boxResultado.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-copiar");
  if (btn) copiar(btn.dataset.copy || "");
});

async function copiar(texto) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto);
    } else {
      // Fallback para contextos sem a Clipboard API
      const ta = document.createElement("textarea");
      ta.value = texto;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    toast(`Copiado: ${texto}`);
  } catch (_) {
    toast("Não foi possível copiar");
  }
}

let toastTimer;
function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("visivel");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visivel"), 1800);
}

async function consultar(cnpj) {
  limparErro();
  btn.disabled = true;
  boxResultado.hidden = false;
  boxResultado.innerHTML = `<div class="carregando">Consultando…</div>`;

  try {
    const res = await fetch(`${API_BASE}/cnpj/${cnpj}`);
    const json = await res.json();

    if (!res.ok) {
      boxResultado.hidden = true;
      mostrarErro(json.erro || "Não foi possível consultar este CNPJ.");
      return;
    }

    renderizar(json.data, json.fonte);
  } catch (err) {
    boxResultado.hidden = true;
    mostrarErro("Erro de conexão com o servidor. Verifique se a API está no ar.");
  } finally {
    btn.disabled = false;
  }
}

function renderizar(d, fonte) {
  const ativa = String(d.descricao_situacao_cadastral || "").toUpperCase() === "ATIVA";
  const badgeClasse = ativa
    ? "badge-ativa"
    : /BAIXAD|INAPT|SUSPENS/.test(String(d.descricao_situacao_cadastral || "").toUpperCase())
    ? "badge-inativa"
    : "badge-outra";

  const endereco = [
    d.logradouro,
    d.numero,
    d.complemento,
    d.bairro,
  ]
    .filter(Boolean)
    .join(", ");
  const cidadeUf = [d.municipio, d.uf].filter(Boolean).join(" - ");

  const cnaesSec = Array.isArray(d.cnaes_secundarios)
    ? d.cnaes_secundarios.filter((c) => c && c.codigo)
    : [];

  const socios = Array.isArray(d.qsa) ? d.qsa : [];

  boxResultado.innerHTML = `
    <div class="card">
      <div class="card-cabecalho">
        <h2 class="razao">${esc(d.razao_social) || "—"}
          <span class="badge ${badgeClasse}">${esc(d.descricao_situacao_cadastral) || "—"}</span>
        </h2>
        ${d.nome_fantasia ? `<p class="fantasia">${esc(d.nome_fantasia)}</p>` : ""}
        <div class="cnpj-linha">CNPJ: <strong>${formatarCnpj(String(d.cnpj || ""))}</strong>
          <span class="copiar-grupo">
            <button type="button" class="btn-copiar" data-copy="${formatarCnpj(String(d.cnpj || ""))}" title="Copiar com pontuação">⧉ copiar</button>
            <button type="button" class="btn-copiar" data-copy="${esc(onlyDigits(d.cnpj || ""))}" title="Copiar apenas os números">só números</button>
          </span>
        </div>
        ${
          d.inscricao_estadual
            ? `<div class="cnpj-linha">Inscrição estadual: <strong>${esc(d.inscricao_estadual)}</strong>
                 <span class="copiar-grupo">
                   <button type="button" class="btn-copiar" data-copy="${esc(d.inscricao_estadual)}" title="Copiar inscrição estadual">⧉ copiar</button>
                   <button type="button" class="btn-copiar" data-copy="${esc(onlyDigits(d.inscricao_estadual))}" title="Copiar apenas os números">só números</button>
                 </span>
               </div>`
            : ""
        }
        <span class="fonte-tag">fonte: ${esc(fonte)}</span>
      </div>

      <div class="grade">
        ${item("Abertura", formatarData(d.data_inicio_atividade))}
        ${item("Natureza jurídica", d.natureza_juridica)}
        ${item("Porte", d.porte)}
        ${item("Capital social", formatarMoeda(d.capital_social))}
        ${item("Simples Nacional", simNao(d.opcao_pelo_simples))}
        ${item("MEI", simNao(d.opcao_pelo_mei))}
      </div>
    </div>

    <div class="card">
      <h3 class="secao-titulo">Atividade principal</h3>
      <div class="item">
        <div class="valor">${esc(codDesc(d.cnae_fiscal, d.cnae_fiscal_descricao))}</div>
      </div>
      ${
        cnaesSec.length
          ? `<h3 class="secao-titulo" style="margin-top:20px">Atividades secundárias</h3>
             <ul class="lista-simples">
               ${cnaesSec.map((c) => `<li>${esc(codDesc(c.codigo, c.descricao))}</li>`).join("")}
             </ul>`
          : ""
      }
    </div>

    <div class="card">
      <h3 class="secao-titulo">Endereço e contato</h3>
      <div class="grade">
        ${item("Logradouro", endereco)}
        ${item("Município / UF", cidadeUf)}
        ${item("CEP", formatarCep(d.cep))}
        ${item("Telefone", d.ddd_telefone_1)}
        ${item("E-mail", d.email)}
      </div>
    </div>

    ${
      socios.length
        ? `<div class="card">
             <h3 class="secao-titulo">Quadro societário (${socios.length})</h3>
             <ul class="lista-simples">
               ${socios
                 .map(
                   (s) => `<li class="socio">
                     <span>${esc(s.nome_socio) || "—"}</span>
                     <span class="qualif">${esc(s.qualificacao_socio) || ""}</span>
                   </li>`
                 )
                 .join("")}
             </ul>
             <p class="fonte-tag">Nomes exibidos parcialmente por privacidade (LGPD).</p>
           </div>`
        : ""
    }
  `;
  boxResultado.hidden = false;
}

/* ------------------------- helpers ------------------------- */

function item(rotulo, valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  return `<div class="item"><div class="rotulo">${rotulo}</div><div class="valor">${esc(valor)}</div></div>`;
}

function codDesc(cod, desc) {
  if (!cod && !desc) return "—";
  return `${cod ? cod + " — " : ""}${desc || ""}`.trim();
}

function onlyDigits(s) {
  return (s || "").replace(/\D/g, "");
}

function formatarCnpj(d) {
  d = onlyDigits(d).slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function formatarCep(cep) {
  const d = onlyDigits(cep);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : cep;
}

function formatarData(iso) {
  if (!iso) return "";
  const p = String(iso).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}

function formatarMoeda(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function simNao(v) {
  if (v === true) return "Sim";
  if (v === false) return "Não";
  return "";
}

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mostrarErro(msg) {
  boxErro.textContent = msg;
  boxErro.hidden = false;
}
function limparErro() {
  boxErro.hidden = true;
  boxErro.textContent = "";
}
