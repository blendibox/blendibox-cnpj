const form = document.getElementById("form");
const entrada = document.getElementById("entrada");
const boxErro = document.getElementById("erro");
const boxRes = document.getElementById("resultado");

/* ------------------------- busca ------------------------- */

entrada.addEventListener("input", () => {
  if (/[a-zA-ZÀ-ÿ]/.test(entrada.value)) return; // nome: não formata
  const d = onlyDigits(entrada.value).slice(0, 14);
  entrada.value = d.length > 12
    ? `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`
    : d;
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const valor = entrada.value.trim();
  boxErro.hidden = true;
  // Tem letra? busca por nome. Senão, por CNPJ.
  if (/[a-zA-ZÀ-ÿ]/.test(valor)) {
    if (valor.length < 3) return mostrarErro("Digite ao menos 3 caracteres do nome.");
    return buscarPorNome(valor);
  }
  const cnpj = onlyDigits(valor);
  if (!isValidCnpj(cnpj)) return mostrarErro("Digite um CNPJ válido ou o nome da empresa.");
  buscar(cnpj);
});

async function buscarPorNome(nome) {
  boxRes.innerHTML = `<div class="carregando">Buscando…</div>`;
  try {
    const res = await fetch(API_BASE + "/buscar?nome=" + encodeURIComponent(nome));
    const json = await res.json();
    if (!res.ok) { boxRes.innerHTML = ""; return mostrarErro(json.erro || "Não foi possível buscar."); }
    renderListaNomes(json.resultados, nome);
  } catch (_) {
    boxRes.innerHTML = "";
    mostrarErro("Erro de conexão.");
  }
}

function renderListaNomes(lista, termo) {
  if (!lista || !lista.length) {
    boxRes.innerHTML = `<div class="resumo">Nenhuma empresa encontrada para "<strong>${esc(termo)}</strong>".<br><small>A busca por nome cobre apenas empresas já consultadas por CNPJ.</small></div>`;
    return;
  }
  boxRes.innerHTML = `
    <div class="lista-nomes">
      ${lista
        .map(
          (r) => `<div class="nome-item" data-cnpj="${esc(onlyDigits(r.cnpj))}">
            <div class="nome-razao">${esc(r.razao_social) || "—"}</div>
            <div class="nome-meta">${formatarCnpj(String(r.cnpj || ""))}${r.municipio ? " · " + esc(r.municipio) + "/" + esc(r.uf || "") : ""}</div>
          </div>`
        )
        .join("")}
    </div>
    <div class="nota-lgpd">Cobre empresas já consultadas por CNPJ. Toque para ver os detalhes.</div>`;
}

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
    <iframe class="mapa" src="${mapaEmbedUrl(d)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
    <div class="acoes">
      <a href="${mapsLink(d)}" target="_blank" rel="noopener">📍 Abrir no Maps</a>
      <a href="${rotaLink(d)}" target="_blank" rel="noopener">🧭 Rota</a>
    </div>
    <div class="distancia"><button class="btn-dist" type="button" data-cnpj="${onlyDigits(d.cnpj)}">📏 Distância até você</button></div>
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
  const copy = e.target.closest(".copiar");
  if (copy) {
    try {
      await navigator.clipboard.writeText(copy.dataset.copy);
      toast("Copiado: " + copy.dataset.copy);
    } catch (_) {
      toast("Não foi possível copiar");
    }
    return;
  }
  const dist = e.target.closest(".btn-dist");
  if (dist) { calcularDistancia(dist); return; }

  const nomeItem = e.target.closest(".nome-item");
  if (nomeItem) {
    entrada.value = formatarCnpj(nomeItem.dataset.cnpj);
    buscar(nomeItem.dataset.cnpj);
  }
});

// Distância até você (geolocalização + geocode + haversine)
let _minhaPos = null;
function calcularDistancia(botao) {
  botao.disabled = true;
  botao.textContent = "📏 Calculando…";
  const cnpj = botao.dataset.cnpj;

  const seguir = async (pos) => {
    _minhaPos = pos;
    const geo = await geocodeCnpj(cnpj);
    if (!geo || geo.lat == null) {
      botao.disabled = false;
      botao.textContent = "Endereço não localizado no mapa";
      return;
    }
    const km = haversineKm(pos.lat, pos.lon, geo.lat, geo.lon);
    const txt = km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace(".", ",")} km`;
    botao.parentElement.innerHTML =
      `<span class="dist-ok">📍 A ≈ ${txt} de você${geo.aproximado ? " (aprox.)" : ""}</span>`;
  };

  if (_minhaPos) return seguir(_minhaPos);
  if (!navigator.geolocation) {
    botao.textContent = "Geolocalização indisponível";
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (p) => seguir({ lat: p.coords.latitude, lon: p.coords.longitude }),
    () => {
      botao.disabled = false;
      botao.textContent = "Permita a localização para calcular";
    },
    { enableHighAccuracy: false, timeout: 8000 }
  );
}

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

// CNPJ clicado numa página (content script → background → storage)
function abrirCnpj(c) {
  const cnpj = onlyDigits(c);
  if (!isValidCnpj(cnpj)) return;
  entrada.value = formatarCnpj(cnpj);
  boxErro.hidden = true;
  buscar(cnpj);
}
if (typeof chrome !== "undefined" && chrome.storage) {
  chrome.storage.local.get("pendingCnpj", (d) => {
    if (d && d.pendingCnpj) {
      chrome.storage.local.remove("pendingCnpj");
      abrirCnpj(d.pendingCnpj);
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.pendingCnpj && changes.pendingCnpj.newValue) {
      chrome.storage.local.remove("pendingCnpj");
      abrirCnpj(changes.pendingCnpj.newValue);
    }
  });
}

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
