/**
 * Carrossel de ofertas no rodapé do popup (espaço publicitário — feed próprio).
 * Feed: comprar.blendibox.com.br/data/banners.json (deeplink Awin).
 */
(function () {
  const FEED = "https://comprar.blendibox.com.br/data/banners.json";

  document.addEventListener("DOMContentLoaded", carregar);

  async function carregar() {
    let produtos = [];
    try {
      const r = await fetch(FEED, { cache: "no-store" });
      if (r.ok) produtos = await r.json();
    } catch (_) {}
    if (!Array.isArray(produtos) || !produtos.length) return;

    const track = document.getElementById("ofertas-track");
    track.innerHTML = shuffle(produtos).slice(0, 12).map(card).join("");
    document.getElementById("ofertas").hidden = false;
  }

  function card(p) {
    const url = p.url || "#";
    const preco = precoBR(p.price, p.currency);
    return `<a class="of-card" href="${esc(url)}" target="_blank" rel="sponsored noopener nofollow" title="${esc(p.productName)}">
      <div class="of-img"><img src="${esc(p.image)}" alt="" loading="lazy" /></div>
      <div class="of-nome">${esc(p.productName)}</div>
      <div class="of-preco">${preco}</div>
    </a>`;
  }

  function precoBR(v, cur) {
    if (v === null || v === undefined || v === "") return "";
    const n = Number(v);
    if (Number.isNaN(n)) return "";
    try {
      return n.toLocaleString("pt-BR", { style: "currency", currency: cur || "BRL" });
    } catch (_) {
      return "R$ " + n.toFixed(2);
    }
  }

  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
})();
