/**
 * Detecta CNPJs em qualquer página, destaca e mostra um resumo ao passar o mouse.
 * Clique no CNPJ abre a página completa no site.
 */
(function () {
  const CNPJ_RE = /(?<![\w.\/-])(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})(?![\w-])/g;
  const PRE_RE = /\d{2}\D?\d{3}\D?\d{3}\D?\d{4}\D?\d{2}/; // filtro rápido

  /* ---------------- detecção / destaque ---------------- */

  function escanear(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const v = node.nodeValue;
        if (!v || v.length < 14 || !PRE_RE.test(v)) return NodeFilter.FILTER_REJECT;
        const p = node.parentNode;
        if (!p || /SCRIPT|STYLE|TEXTAREA|NOSCRIPT/.test(p.nodeName)) return NodeFilter.FILTER_REJECT;
        if (p.closest && p.closest('.blndbx-cnpj, input, [contenteditable="true"]'))
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const alvos = [];
    let n, count = 0;
    while ((n = walker.nextNode()) && count < 600) {
      alvos.push(n);
      count++;
    }
    alvos.forEach(destacar);
  }

  function destacar(node) {
    const text = node.nodeValue;
    CNPJ_RE.lastIndex = 0;
    let m, last = 0, frag = null;
    while ((m = CNPJ_RE.exec(text))) {
      const raw = m[1];
      const digits = onlyDigits(raw);
      if (!isValidCnpj(digits)) continue;
      frag = frag || document.createDocumentFragment();
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const span = document.createElement("span");
      span.className = "blndbx-cnpj";
      span.dataset.cnpj = digits;
      span.textContent = raw;
      frag.appendChild(span);
      last = m.index + raw.length;
    }
    if (frag) {
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
  }

  /* ---------------- tooltip ---------------- */

  let tip, esconderTimer;
  function elTip() {
    if (tip) return tip;
    tip = document.createElement("div");
    tip.className = "blndbx-tip";
    tip.style.display = "none";
    tip.addEventListener("mouseenter", () => clearTimeout(esconderTimer));
    tip.addEventListener("mouseleave", esconder);
    (document.body || document.documentElement).appendChild(tip);
    return tip;
  }

  function posicionar(span) {
    const r = span.getBoundingClientRect();
    const t = elTip();
    t.style.display = "block";
    const largura = 280;
    const maxLeft = window.scrollX + document.documentElement.clientWidth - largura - 12;
    t.style.left = Math.max(8, Math.min(r.left + window.scrollX, maxLeft)) + "px";
    t.style.top = r.bottom + window.scrollY + 6 + "px";
  }

  async function mostrar(span) {
    clearTimeout(esconderTimer);
    const cnpj = span.dataset.cnpj;
    const t = elTip();
    posicionar(span);
    t.innerHTML = `<div class="blndbx-tip-load">Consultando ${formatarCnpj(cnpj)}…</div>`;
    const r = await getEmpresa(cnpj);
    // se o mouse já saiu e outro CNPJ está ativo, ignora
    if (t.dataset.cnpj && t.dataset.cnpj !== cnpj) return;
    t.dataset.cnpj = cnpj;
    if (!r.ok || r.removido) {
      t.innerHTML = `<div class="blndbx-tip-erro">${esc(r.mensagem || r.erro || "Não foi possível consultar.")}</div>`;
      return;
    }
    t.innerHTML = tipHtml(r.data);
    posicionar(span);
  }

  function tipHtml(d) {
    const anos = anosDeMercado(d);
    const ano = (String(d.data_inicio_atividade || "").match(/^(\d{4})/) || [])[1];
    const linhas = [];
    if (d.opcao_pelo_simples === true) linhas.push("Simples Nacional");
    if (d.opcao_pelo_mei === true) linhas.push("MEI");
    if (ano) linhas.push(`Desde ${ano}${anos ? ` · ${anos} anos` : ""}`);
    return `
      <div class="blndbx-tip-razao">${esc(d.razao_social) || "—"}</div>
      <div class="blndbx-tip-tags">
        <span class="blndbx-badge ${classeSituacao(d.descricao_situacao_cadastral)}">${esc(d.descricao_situacao_cadastral) || "—"}</span>
        ${d.porte ? `<span class="blndbx-badge neutro">${esc(d.porte)}</span>` : ""}
      </div>
      ${linhas.length ? `<div class="blndbx-tip-info">${linhas.map(esc).join(" · ")}</div>` : ""}
      ${d.cnae_fiscal_descricao ? `<div class="blndbx-tip-cnae">${esc(d.cnae_fiscal_descricao)}</div>` : ""}
      <div class="blndbx-tip-cta">Clique para ver detalhes →</div>`;
  }

  function esconder() {
    esconderTimer = setTimeout(() => {
      if (tip) {
        tip.style.display = "none";
        tip.dataset.cnpj = "";
      }
    }, 180);
  }

  /* ---------------- eventos ---------------- */

  document.addEventListener("mouseover", (e) => {
    const s = e.target.closest && e.target.closest(".blndbx-cnpj");
    if (s) mostrar(s);
  });
  document.addEventListener("mouseout", (e) => {
    const s = e.target.closest && e.target.closest(".blndbx-cnpj");
    if (s) esconder();
  });
  document.addEventListener("click", (e) => {
    const s = e.target.closest && e.target.closest(".blndbx-cnpj");
    if (!s) return;
    e.preventDefault();
    e.stopPropagation();
    const fallback = () => window.open(SITE_URL + "/?cnpj=" + s.dataset.cnpj, "_blank", "noopener");
    try {
      chrome.runtime.sendMessage({ tipo: "abrirCnpj", cnpj: s.dataset.cnpj }, () => {
        if (chrome.runtime.lastError) fallback();
      });
    } catch (_) {
      fallback();
    }
  });

  /* ---------------- inicialização + páginas dinâmicas ---------------- */

  const rodar = () => escanear(document.body || document.documentElement);
  if (window.requestIdleCallback) requestIdleCallback(rodar, { timeout: 1500 });
  else setTimeout(rodar, 400);

  // Re-escaneia conteúdo carregado dinamicamente (debounced)
  let obsTimer;
  const obs = new MutationObserver((muts) => {
    clearTimeout(obsTimer);
    obsTimer = setTimeout(() => {
      for (const mu of muts) {
        for (const nd of mu.addedNodes) {
          if (nd.nodeType === 1 && !nd.classList.contains("blndbx-tip")) escanear(nd);
        }
      }
    }, 500);
  });
  if (document.body) obs.observe(document.body, { childList: true, subtree: true });
})();
