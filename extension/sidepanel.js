const form = document.getElementById("form");
const entrada = document.getElementById("entrada");
const boxErro = document.getElementById("erro");
const boxRes = document.getElementById("resultado");

/* ------------------------- busca ------------------------- */

entrada.addEventListener("input", () => {
  const d = onlyDigits(entrada.value).slice(0, 14);
  entrada.value = d.length > 12
    ? `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`
    : d;
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const cnpj = onlyDigits(entrada.value);
  boxErro.hidden = true;
  if (!isValidCnpj(cnpj)) return mostrarErro("Digite um CNPJ válido (14 dígitos).");
  buscar(cnpj);
});

async function buscar(cnpj) {
  boxRes.innerHTML = `<div class="carregando">Consultando…</div>`;
  const r = await getEmpresa(cnpj);
  if (!r.ok) {
    boxRes.innerHTML = "";
    return mostrarErro(r.erro || (r.status === 404 ? "CNPJ não encontrado." : "Não foi possível consultar."));
  }
  if (r.removido) {
    boxRes.innerHTML = `<div class="resumo">🔒 ${esc(r.mensagem)}</div>`;
    return;
  }
  render(r.data);
  addHistorico(r.data);
}

function render(d) {
  const cnpjFmt = formatarCnpj(d.cnpj);
  const anos = anosDeMercado(d);
  const socios = Array.isArray(d.qsa) ? d.qsa : [];

  boxRes.innerHTML = `
    <div class="razao">${esc(d.razao_social) || "—"}</div>
    ${d.nome_fantasia ? `<div class="fantasia">${esc(d.nome_fantasia)}</div>` : ""}
    <div class="cnpj-linha">
      CNPJ: <strong>${cnpjFmt}</strong>
      <button class="copiar" data-copy="${cnpjFmt}">copiar</button>
      <button class="copiar" data-copy="${onlyDigits(d.cnpj)}">só números</button>
    </div>
    <div class="badges">
      <span class="badge ${classeSituacao(d.descricao_situacao_cadastral)}">${esc(d.descricao_situacao_cadastral) || "—"}</span>
      ${d.porte ? `<span class="badge neutro">${esc(d.porte)}</span>` : ""}
      ${d.opcao_pelo_simples === true ? `<span class="badge neutro">Simples</span>` : ""}
      ${d.opcao_pelo_mei === true ? `<span class="badge neutro">MEI</span>` : ""}
      ${anos ? `<span class="badge neutro">${anos} anos de mercado</span>` : ""}
    </div>
    <div class="resumo">${esc(resumoEmpresa(d))}</div>
    <div class="grade">
      ${item("Abertura", formatarData(d.data_inicio_atividade))}
      ${item("Natureza jurídica", d.natureza_juridica)}
      ${item("Porte", d.porte)}
      ${item("Capital social", formatarMoeda(d.capital_social))}
    </div>
    <div class="secao">Atividade principal</div>
    <div class="cnae">${esc(codDesc(d.cnae_fiscal, d.cnae_fiscal_descricao))}</div>
    <div class="secao">Endereço</div>
    <div class="cnae">${esc(enderecoTexto(d)) || "—"}</div>
    <div class="acoes">
      <a href="${mapsLink(d)}" target="_blank" rel="noopener">📍 Ver no mapa</a>
      <a href="${rotaLink(d)}" target="_blank" rel="noopener">🧭 Rota</a>
    </div>
    ${
      socios.length
        ? `<div class="secao">Sócios (${socios.length})</div>
           <ul class="socios">
             ${socios.map((s) => `<li><span>${esc(s.nome_socio) || "—"}</span><span class="qualif">${esc(s.qualificacao_socio) || ""}</span></li>`).join("")}
           </ul>
           <div class="nota-lgpd">Nomes exibidos parcialmente por privacidade (LGPD).</div>`
        : ""
    }
    <a class="ver-mais" href="${paginaEmpresaUrl(d)}" target="_blank" rel="noopener">Ver página completa →</a>
  `;
}

boxRes.addEventListener("click", async (e) => {
  const b = e.target.closest(".copiar");
  if (!b) return;
  try {
    await navigator.clipboard.writeText(b.dataset.copy);
    toast("Copiado: " + b.dataset.copy);
  } catch (_) {
    toast("Não foi possível copiar");
  }
});

/* ------------------------- histórico (cache do navegador) ------------------------- */

function histGet() {
  return new Promise((res) => {
    try {
      chrome.storage.local.get("historico", (d) => res(d.historico || []));
    } catch (_) {
      res(JSON.parse(localStorage.getItem("historico") || "[]"));
    }
  });
}
function histSet(arr) {
  try {
    chrome.storage.local.set({ historico: arr });
  } catch (_) {
    localStorage.setItem("historico", JSON.stringify(arr));
  }
}

async function addHistorico(d) {
  const cnpj = onlyDigits(d.cnpj);
  let arr = await histGet();
  arr = arr.filter((x) => x.cnpj !== cnpj);
  arr.unshift({ cnpj, razao: d.razao_social || "", ts: Date.now() });
  arr = arr.slice(0, 20);
  histSet(arr);
  renderHistorico(arr);
}

function renderHistorico(arr) {
  const sec = document.getElementById("historico");
  const ul = document.getElementById("hist-lista");
  if (!arr || !arr.length) {
    sec.hidden = true;
    ul.innerHTML = "";
    return;
  }
  sec.hidden = false;
  ul.innerHTML = arr
    .map(
      (h) => `<li class="hist-item" data-cnpj="${h.cnpj}">
        <div class="hist-info">
          <div class="hist-razao">${esc(h.razao) || formatarCnpj(h.cnpj)}</div>
          <div class="hist-meta">${formatarCnpj(h.cnpj)} · ${dataHora(h.ts)}</div>
        </div>
        <button class="hist-del" data-cnpj="${h.cnpj}" title="Remover">×</button>
      </li>`
    )
    .join("");
}

function dataHora(ts) {
  try {
    return new Date(ts).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch (_) {
    return "";
  }
}

document.getElementById("hist-lista").addEventListener("click", async (e) => {
  const del = e.target.closest(".hist-del");
  if (del) {
    e.stopPropagation();
    let arr = await histGet();
    arr = arr.filter((x) => x.cnpj !== del.dataset.cnpj);
    histSet(arr);
    renderHistorico(arr);
    return;
  }
  const item = e.target.closest(".hist-item");
  if (item) {
    entrada.value = formatarCnpj(item.dataset.cnpj);
    boxErro.hidden = true;
    buscar(item.dataset.cnpj);
  }
});

document.getElementById("hist-limpar").addEventListener("click", () => {
  histSet([]);
  renderHistorico([]);
});

// carrega o histórico ao abrir
histGet().then(renderHistorico);

/* ------------------------- helpers ------------------------- */

function item(rotulo, valor) {
  if (!valor) return "";
  return `<div class="item"><div class="rotulo">${rotulo}</div><div class="valor">${esc(valor)}</div></div>`;
}
function codDesc(cod, desc) {
  if (!cod && !desc) return "—";
  return `${cod ? cod + " — " : ""}${desc || ""}`.trim();
}
function mostrarErro(msg) {
  boxErro.textContent = msg;
  boxErro.hidden = false;
}

let toastTimer;
function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), 1600);
}
