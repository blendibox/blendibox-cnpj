/**
 * Buscador de Empresas - Blendibox
 * Frontend estatico (GitHub Pages) — chama o Cloudflare Worker.
 */

// ==========================================================================
// Configuração vem de config.js (window.APP_CONFIG). Fallbacks abaixo.
// Para testar local com "wrangler dev", ajuste API_BASE no config.js.
// ==========================================================================
const CFG = window.APP_CONFIG || {};
const API_BASE = CFG.API_BASE || "https://buscador-empresas-blendibox.blendibox.workers.dev";
const SITE_URL = (CFG.SITE_URL || "https://buscadeempresa.blendibox.com.br").replace(/\/$/, "");
const STORE_URL = CFG.CHROME_STORE_URL || "";

const form = document.getElementById("form-busca");
const input = document.getElementById("entrada-cnpj");
const btn = form.querySelector("button");
const boxErro = document.getElementById("msg-erro");
const boxResultado = document.getElementById("resultado");

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const valor = input.value.trim();

  // Tem letra? É busca por nome. Senão, é busca por CNPJ.
  if (/[a-zA-ZÀ-ÿ]/.test(valor)) {
    if (valor.length < 3) {
      mostrarErro("Digite ao menos 3 caracteres do nome.");
      return;
    }
    buscarPorNome(valor);
    return;
  }

  const cnpj = onlyDigits(valor);
  if (cnpj.length !== 14) {
    mostrarErro("Digite um CNPJ com 14 dígitos ou o nome da empresa.");
    return;
  }
  consultar(cnpj);
});

// Formata como CNPJ enquanto digita — só quando não há letras (nome).
input.addEventListener("input", () => {
  if (/[a-zA-ZÀ-ÿ]/.test(input.value)) return; // busca por nome: não formata
  const d = onlyDigits(input.value).slice(0, 14);
  input.value = formatarCnpj(d);
});

// Delegação de eventos no bloco de resultado
boxResultado.addEventListener("click", (e) => {
  const btnCopiar = e.target.closest(".btn-copiar");
  if (btnCopiar) {
    copiar(btnCopiar.dataset.copy || "");
    return;
  }

  const btnMostrar = e.target.closest(".btn-mostrar");
  if (btnMostrar) {
    revelarContato(btnMostrar);
    return;
  }

  const btnOptout = e.target.closest(".btn-optout");
  if (btnOptout) {
    abrirModalOptout(btnOptout.dataset.cnpj, btnOptout.dataset.razao);
    return;
  }

  const itemNome = e.target.closest(".resultado-nome");
  if (itemNome) {
    input.value = formatarCnpj(itemNome.dataset.cnpj);
    consultar(itemNome.dataset.cnpj);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
});

// Busca por nome dentro da base já cacheada
async function buscarPorNome(nome) {
  limparErro();
  btn.disabled = true;
  boxResultado.hidden = false;
  boxResultado.innerHTML = `<div class="carregando">Buscando…</div>`;

  try {
    const res = await fetch(`${API_BASE}/buscar?nome=${encodeURIComponent(nome)}`);
    const json = await res.json();

    if (!res.ok) {
      boxResultado.hidden = true;
      mostrarErro(json.erro || "Não foi possível buscar.");
      return;
    }
    renderizarListaNomes(json.resultados, nome);
    esconderLanding();
    rolarParaResultado();
  } catch (_) {
    boxResultado.hidden = true;
    mostrarErro("Erro de conexão com o servidor.");
  } finally {
    btn.disabled = false;
  }
}

function renderizarListaNomes(lista, termo) {
  if (!lista || lista.length === 0) {
    boxResultado.innerHTML = `
      <div class="card">
        <p>Nenhuma empresa encontrada para <strong>${esc(termo)}</strong> na base já consultada.</p>
        <p class="fonte-tag">A busca por nome cobre apenas empresas que já foram consultadas por CNPJ aqui.</p>
      </div>`;
    boxResultado.hidden = false;
    return;
  }

  boxResultado.innerHTML = `
    <div class="card">
      <h3 class="secao-titulo">Resultados para "${esc(termo)}" (${lista.length})</h3>
      <ul class="lista-resultados">
        ${lista
          .map(
            (r) => `<li class="resultado-nome" data-cnpj="${esc(r.cnpj)}">
              <div>
                <div class="resultado-razao">${esc(r.razao_social) || "—"}</div>
                ${r.nome_fantasia ? `<div class="resultado-fantasia">${esc(r.nome_fantasia)}</div>` : ""}
              </div>
              <div class="resultado-meta">
                <span>${formatarCnpj(String(r.cnpj || ""))}</span>
                <span class="resultado-cidade">${esc([r.municipio, r.uf].filter(Boolean).join(" - "))}</span>
              </div>
            </li>`
          )
          .join("")}
      </ul>
      <p class="fonte-tag">Cobre apenas empresas já consultadas por CNPJ. Clique para ver os detalhes.</p>
    </div>`;
  boxResultado.hidden = false;
}

// Revela e-mail/telefone completos (chama o endpoint com rate limit)
async function revelarContato(botao) {
  const cnpj = botao.dataset.cnpj;
  const campo = botao.dataset.campo;
  botao.disabled = true;
  const original = botao.textContent;
  botao.textContent = "…";

  try {
    const res = await fetch(`${API_BASE}/cnpj/${cnpj}/contato`);
    const json = await res.json();
    if (!res.ok) {
      toast(json.erro || "Não foi possível revelar.");
      botao.disabled = false;
      botao.textContent = original;
      return;
    }
    const valores = { telefone1: json.telefone1, telefone2: json.telefone2, email: json.email };
    const completo = valores[campo];
    const span = botao.parentElement.querySelector(
      `.valor-contato[data-campo="${campo}"]`
    );
    if (span && completo) {
      span.textContent = campo === "email" ? completo : formatarTelefone(completo);
    }
    botao.remove();
  } catch (_) {
    toast("Erro ao revelar contato.");
    botao.disabled = false;
    botao.textContent = original;
  }
}

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

    if (json.removido) {
      boxResultado.hidden = false;
      boxResultado.innerHTML = `<div class="card card-removido"><p>🔒 ${esc(json.mensagem)}</p></div>`;
      restaurarSeoPadrao();
      esconderLanding();
      rolarParaResultado();
      return;
    }

    renderizar(json.data, json.fonte);
    atualizarUrlEmpresa(cnpj);
    atualizarSeoEmpresa(json.data);
    adicionarHistorico(json.data);
    esconderLanding();
    rolarParaResultado();
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

    <div id="ads-inline" class="ads-area"></div>

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
        ${itemContato("Telefone", d.ddd_telefone_1, "telefone1", d.cnpj)}
        ${itemContato("E-mail", d.email, "email", d.cnpj)}
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

    <div class="optout-linha">
      <button type="button" class="btn-optout"
        data-cnpj="${esc(onlyDigits(d.cnpj || ""))}"
        data-razao="${esc(d.razao_social || "")}">
        É a sua empresa? Solicitar remoção dos resultados (LGPD)
      </button>
    </div>
  `;
  boxResultado.hidden = false;
  if (window.Ads) window.Ads.inline(); // carrossel entre os cards
}

/* ------------------------- helpers ------------------------- */

function item(rotulo, valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  return `<div class="item"><div class="rotulo">${rotulo}</div><div class="valor">${esc(valor)}</div></div>`;
}

// Campo de contato mascarado + botão "mostrar" (revela via endpoint)
function itemContato(rotulo, valorMasc, campo, cnpj) {
  if (!valorMasc) return "";
  return `<div class="item">
    <div class="rotulo">${rotulo}</div>
    <div class="valor">
      <span class="valor-contato" data-campo="${campo}">${esc(valorMasc)}</span>
      <button type="button" class="btn-mostrar" data-cnpj="${esc(onlyDigits(cnpj || ""))}" data-campo="${campo}" title="Mostrar ${rotulo.toLowerCase()} completo">mostrar</button>
    </div>
  </div>`;
}

function formatarTelefone(tel) {
  const d = onlyDigits(tel);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return tel;
}

function codDesc(cod, desc) {
  if (!cod && !desc) return "—";
  return `${cod ? cod + " — " : ""}${desc || ""}`.trim();
}

function onlyDigits(s) {
  return (s || "").replace(/\D/g, "");
}

// Mesmo slug do gerador de páginas estáticas (URL canônica da empresa)
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

function rotaEmpresa(d) {
  return `${SITE_URL}/empresa/${slug(d.razao_social || d.nome_fantasia)}-${onlyDigits(d.cnpj)}/`;
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

/* ------------------------- Histórico de consultas ------------------------- */

function histGet() {
  try { return JSON.parse(localStorage.getItem("historico") || "[]"); }
  catch (_) { return []; }
}
function histSet(a) {
  try { localStorage.setItem("historico", JSON.stringify(a)); } catch (_) {}
}
function adicionarHistorico(d) {
  const cnpj = onlyDigits(d.cnpj);
  if (cnpj.length !== 14) return;
  let a = histGet().filter((x) => x.cnpj !== cnpj);
  a.unshift({ cnpj, razao: d.razao_social || "", ts: Date.now() });
  a = a.slice(0, 12);
  histSet(a);
  renderHistorico(a);
}
function renderHistorico(a) {
  const sec = document.getElementById("historico");
  const ul = document.getElementById("hist-lista");
  if (!sec || !ul) return;
  if (!a || !a.length) { sec.hidden = true; ul.innerHTML = ""; return; }
  sec.hidden = false;
  ul.innerHTML = a
    .map(
      (h) => `<li class="hist-item" data-cnpj="${esc(h.cnpj)}">
        <span class="hist-ic">🔎</span>
        <div class="hist-info">
          <div class="hist-razao">${esc(h.razao) || formatarCnpj(h.cnpj)}</div>
          <div class="hist-meta">${formatarCnpj(h.cnpj)} · ${dataHora(h.ts)}</div>
        </div>
        <button class="hist-del" data-cnpj="${esc(h.cnpj)}" title="Remover" aria-label="Remover">×</button>
      </li>`
    )
    .join("");
}
function dataHora(ts) {
  try {
    return new Date(ts).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch (_) { return ""; }
}

(function ligarHistorico() {
  const ul = document.getElementById("hist-lista");
  const limpar = document.getElementById("hist-limpar");
  if (ul) {
    ul.addEventListener("click", (e) => {
      const del = e.target.closest(".hist-del");
      if (del) {
        e.stopPropagation();
        const a = histGet().filter((x) => x.cnpj !== del.dataset.cnpj);
        histSet(a);
        renderHistorico(a);
        return;
      }
      const item = e.target.closest(".hist-item");
      if (item) {
        input.value = formatarCnpj(item.dataset.cnpj);
        consultar(item.dataset.cnpj);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }
  if (limpar) {
    limpar.addEventListener("click", () => { histSet([]); renderHistorico([]); });
  }
  renderHistorico(histGet());
})();

// Landing da extensão: some quando há resultado, volta na home
function esconderLanding() {
  document.body.classList.add("com-resultado");
}
function mostrarLanding() {
  document.body.classList.remove("com-resultado");
}

// Botões "Adicionar ao Chrome": link da loja (ou "em breve")
function ligarBotoesExtensao() {
  document.querySelectorAll("[data-store]").forEach((a) => {
    if (STORE_URL) {
      a.href = STORE_URL;
      a.target = "_blank";
      a.rel = "noopener";
    } else {
      a.classList.add("em-breve");
      a.textContent = a.classList.contains("ext-bar-btn") ? "🔜 Em breve" : "🔜 Em breve na Chrome Web Store";
      a.addEventListener("click", (e) => e.preventDefault());
    }
  });

  // Barra fina: fechar (com memória)
  try {
    if (localStorage.getItem("extBarOff") === "1") document.body.classList.add("ext-bar-off");
  } catch (_) {}
  const x = document.querySelector(".ext-bar-x");
  if (x) {
    x.addEventListener("click", () => {
      document.body.classList.add("ext-bar-off");
      try { localStorage.setItem("extBarOff", "1"); } catch (_) {}
    });
  }
}
ligarBotoesExtensao();

// Rola suavemente até o resultado, compensando o cabeçalho fixo
function rolarParaResultado() {
  requestAnimationFrame(() => {
    const y = boxResultado.getBoundingClientRect().top + window.scrollY - 76;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  });
}

function mostrarErro(msg) {
  boxErro.textContent = msg;
  boxErro.hidden = false;
}
function limparErro() {
  boxErro.hidden = true;
  boxErro.textContent = "";
}

/* ------------------------- Opt-out (LGPD) ------------------------- */

const modal = document.getElementById("modal-optout");

function abrirModalOptout(cnpj, razao) {
  if (!modal) return;
  modal.querySelector("#optout-cnpj").value = formatarCnpj(cnpj);
  modal.querySelector("#optout-cnpj-raw").value = cnpj;
  modal.querySelector("#optout-empresa").textContent = razao || formatarCnpj(cnpj);
  modal.querySelector("#optout-msg").hidden = true;
  modal.querySelector("#optout-form").hidden = false;
  modal.querySelector("#optout-form").reset();
  modal.querySelector("#optout-cnpj").value = formatarCnpj(cnpj);
  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function fecharModalOptout() {
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = "";
}

if (modal) {
  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.closest("[data-fechar]")) fecharModalOptout();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) fecharModalOptout();
  });

  modal.querySelector("#optout-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const dados = {
      cnpj: modal.querySelector("#optout-cnpj-raw").value,
      nome: modal.querySelector("#optout-nome").value.trim(),
      vinculo: modal.querySelector("#optout-vinculo").value,
      email: modal.querySelector("#optout-email").value.trim(),
      motivo: modal.querySelector("#optout-motivo").value.trim(),
    };
    const btnEnviar = modal.querySelector("#optout-enviar");
    btnEnviar.disabled = true;
    btnEnviar.textContent = "Enviando…";

    try {
      const res = await fetch(`${API_BASE}/optout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dados),
      });
      const json = await res.json();
      const box = modal.querySelector("#optout-msg");
      box.hidden = false;
      box.className = res.ok ? "optout-msg ok" : "optout-msg erro";
      box.textContent = json.mensagem || json.erro || "Não foi possível enviar.";
      if (res.ok) modal.querySelector("#optout-form").hidden = true;
    } catch (_) {
      const box = modal.querySelector("#optout-msg");
      box.hidden = false;
      box.className = "optout-msg erro";
      box.textContent = "Erro de conexão. Tente novamente.";
    } finally {
      btnEnviar.disabled = false;
      btnEnviar.textContent = "Enviar solicitação";
    }
  });
}

/* ------------------------- SEO dinâmico + rota por URL ------------------------- */

const SEO_PADRAO = {
  titulo: "Consulta CNPJ Grátis — Busca de Empresa | Blendibox",
  descricao:
    "Consulte CNPJ grátis: razão social, nome fantasia, situação cadastral, endereço, CNAE e quadro societário. Dados públicos da Receita Federal em segundos.",
};

// Coloca ?cnpj=... na URL (compartilhável e indexável) sem recarregar
function atualizarUrlEmpresa(cnpj) {
  const url = `${location.pathname}?cnpj=${onlyDigits(cnpj)}`;
  if (location.search !== `?cnpj=${onlyDigits(cnpj)}`) {
    history.pushState({ cnpj }, "", url);
  }
}

// Atualiza título, descrição, canonical e JSON-LD conforme a empresa exibida
function atualizarSeoEmpresa(d) {
  const cnpjFmt = formatarCnpj(String(d.cnpj || ""));
  const razao = d.razao_social || "Empresa";
  const local = [d.municipio, d.uf].filter(Boolean).join("/");
  const situacao = d.descricao_situacao_cadastral || "";

  document.title = `${razao} — CNPJ ${cnpjFmt} | Busca de Empresa Blendibox`;
  setMeta(
    "description",
    `${razao} (CNPJ ${cnpjFmt})${situacao ? " · " + situacao : ""}${local ? " · " + local : ""}${d.cnae_fiscal_descricao ? " · " + d.cnae_fiscal_descricao : ""}. Consulta grátis de CNPJ na Blendibox.`
  );
  setCanonical(rotaEmpresa(d)); // aponta para a página estática (canônica)
  injetarJsonLdEmpresa(d);
}

function restaurarSeoPadrao() {
  document.title = SEO_PADRAO.titulo;
  setMeta("description", SEO_PADRAO.descricao);
  setCanonical(`${SITE_URL}/`);
  removerJsonLd();
}

function injetarJsonLdEmpresa(d) {
  removerJsonLd();
  const dados = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: d.razao_social || undefined,
    legalName: d.razao_social || undefined,
    alternateName: d.nome_fantasia || undefined,
    taxID: d.cnpj || undefined,
    foundingDate: d.data_inicio_atividade || undefined,
    url: rotaEmpresa(d),
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
  // remove chaves undefined
  const limpo = JSON.parse(JSON.stringify(dados));
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.id = "jsonld-empresa";
  script.textContent = JSON.stringify(limpo);
  document.head.appendChild(script);
}

function removerJsonLd() {
  const el = document.getElementById("jsonld-empresa");
  if (el) el.remove();
}

function setMeta(name, content) {
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href) {
  let el = document.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

// Ao carregar a página com ?cnpj=..., já consulta automaticamente
function iniciarPelaUrl() {
  const params = new URLSearchParams(location.search);
  const cnpj = onlyDigits(params.get("cnpj") || "");
  if (cnpj.length === 14) {
    input.value = formatarCnpj(cnpj);
    consultar(cnpj);
  }
}

// Botão voltar/avançar do navegador
window.addEventListener("popstate", () => {
  const params = new URLSearchParams(location.search);
  const cnpj = onlyDigits(params.get("cnpj") || "");
  if (cnpj.length === 14) {
    input.value = formatarCnpj(cnpj);
    consultar(cnpj);
  } else {
    boxResultado.hidden = true;
    boxResultado.innerHTML = "";
    restaurarSeoPadrao();
    mostrarLanding();
  }
});

iniciarPelaUrl();
