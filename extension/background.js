/**
 * Abre o painel lateral ao clicar no ícone da extensão (em vez de popup).
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

// Clique num CNPJ detectado na página → guarda e tenta abrir o painel
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.tipo === "abrirCnpj" && msg.cnpj) {
    chrome.storage.local.set({ pendingCnpj: msg.cnpj });
    if (sender.tab && chrome.sidePanel && chrome.sidePanel.open) {
      chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
    }
  }
});
