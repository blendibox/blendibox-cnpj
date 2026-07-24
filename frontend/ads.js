/**
 * Buscador de Empresas - Blendibox
 * Áreas de produtos (carrossel) — alimentadas pelo feed próprio da Blendibox.
 *
 * Estratégias de conversão aplicadas:
 *  - Rótulo "Patrocinado" (transparência + familiaridade estilo AdSense)
 *  - Prova social (label "comprado essa semana", estrelas)
 *  - Ancoragem de preço (preço antigo riscado + % de desconto)
 *  - CTA claro ("Ver oferta") e card inteiro clicável
 *  - Carrossel com autoplay, setas e swipe (mostra vários produtos)
 *  - Links de afiliado com rel="sponsored noopener"
 */

// Fonte primária (feed real com deeplink). Fallback local para dev/offline.
const BANNERS_URL = "https://comprar.blendibox.com.br/data/banners.json";
const BANNERS_FALLBACK = "data/banners.sample.json";

// Carrega os produtos uma vez e reaproveita (mesma promise).
let _produtosPromise = null;
function getProdutos() {
  if (!_produtosPromise) _produtosPromise = carregarProdutos();
  return _produtosPromise;
}

async function montarEmContainer(id, titulo, n) {
  const container = document.getElementById(id);
  if (!container) return;
  const produtos = await getProdutos();
  if (!produtos.length) return;
  montarCarrossel(container, titulo, shuffle(produtos).slice(0, n));
}

// Exposto para o app.js chamar ao renderizar um resultado (carrossel inline).
window.Ads = {
  inline: () => montarEmContainer("ads-inline", "Ofertas Blendibox", 8),
};

// Na carga da página: preenche o rodapé sempre, e o inline SE já existir
// (caso das páginas estáticas de empresa, que não têm app.js).
document.addEventListener("DOMContentLoaded", () => {
  montarEmContainer("ads-rodape", "Você também pode gostar", 8);
  montarEmContainer("ads-inline", "Ofertas Blendibox", 8);
});

async function carregarProdutos() {
  for (const url of [BANNERS_URL, BANNERS_FALLBACK]) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data) && data.length) return data;
    } catch (_) {
      /* tenta o próximo */
    }
  }
  return [];
}

function montarCarrossel(container, titulo, produtos) {
  if (!container || !produtos.length) return;

  const cards = produtos.map(cardProduto).join("");
  container.innerHTML = `
    <div class="ads-cabecalho">
      <span class="ads-titulo">${esc(titulo)}</span>
      <span class="ads-rotulo" title="Conteúdo publicitário da própria Blendibox">Patrocinado</span>
    </div>
    <div class="carrossel">
      <button class="carrossel-seta prev" type="button" aria-label="Anterior">‹</button>
      <div class="carrossel-track">${cards}</div>
      <button class="carrossel-seta next" type="button" aria-label="Próximo">›</button>
    </div>`;

  ativarCarrossel(container.querySelector(".carrossel"));
}

function cardProduto(p) {
  const preco = formatarPreco(p.price, p.currency);
  const temDesconto = p.oldPrice && Number(p.oldPrice) > Number(p.price);
  const desconto = temDesconto
    ? Math.round((1 - Number(p.price) / Number(p.oldPrice)) * 100)
    : 0;

  const url = p.url || "#";
  const alvo = url !== "#" ? `target="_blank" rel="sponsored noopener nofollow"` : "";

  return `
    <a class="produto-card" href="${esc(url)}" ${alvo}>
      ${p.label ? `<span class="produto-social">${esc(p.label)}</span>` : ""}
      ${temDesconto ? `<span class="produto-desconto">-${desconto}%</span>` : ""}
      <div class="produto-img">
        <img src="${esc(p.image)}" alt="${esc(p.productName)}" loading="lazy" />
      </div>
      <div class="produto-info">
        ${p.merchant ? `<div class="produto-merchant">${esc(p.merchant)}</div>` : ""}
        <div class="produto-nome">${esc(p.productName)}</div>
        ${estrelas(p.rating)}
        <div class="produto-precos">
          <span class="produto-preco">${preco}</span>
          ${temDesconto ? `<span class="produto-preco-antigo">${formatarPreco(p.oldPrice, p.currency)}</span>` : ""}
        </div>
        <span class="produto-cta">Ver oferta</span>
      </div>
    </a>`;
}

function estrelas(rating) {
  if (!rating) return "";
  const n = Number(rating);
  const cheias = Math.round(n);
  const estrelasHtml = "★".repeat(cheias) + "☆".repeat(5 - cheias);
  return `<div class="produto-rating"><span class="estrelas">${estrelasHtml}</span><span class="rating-num">${n.toFixed(1)}</span></div>`;
}

/* ---------------- carrossel: autoplay + setas + swipe ---------------- */

function ativarCarrossel(carrossel) {
  if (!carrossel) return;
  const track = carrossel.querySelector(".carrossel-track");
  const prev = carrossel.querySelector(".prev");
  const next = carrossel.querySelector(".next");

  const passo = () => {
    const card = track.querySelector(".produto-card");
    return card ? card.offsetWidth + 14 : 240;
  };

  next.addEventListener("click", () => track.scrollBy({ left: passo(), behavior: "smooth" }));
  prev.addEventListener("click", () => track.scrollBy({ left: -passo(), behavior: "smooth" }));

  // Autoplay suave; pausa ao interagir/hover.
  let timer = setInterval(avancar, 4000);
  function avancar() {
    const fim = track.scrollWidth - track.clientWidth - 4;
    if (track.scrollLeft >= fim) {
      track.scrollTo({ left: 0, behavior: "smooth" });
    } else {
      track.scrollBy({ left: passo(), behavior: "smooth" });
    }
  }
  const pausar = () => clearInterval(timer);
  const retomar = () => {
    clearInterval(timer);
    timer = setInterval(avancar, 4000);
  };
  carrossel.addEventListener("mouseenter", pausar);
  carrossel.addEventListener("mouseleave", retomar);
  track.addEventListener("touchstart", pausar, { passive: true });
  track.addEventListener("touchend", retomar, { passive: true });
}

/* ---------------- helpers ---------------- */

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatarPreco(v, currency) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (Number.isNaN(n)) return "";
  try {
    return n.toLocaleString("pt-BR", { style: "currency", currency: currency || "BRL" });
  } catch (_) {
    return `R$ ${n.toFixed(2)}`;
  }
}

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
