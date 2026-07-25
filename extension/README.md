# Extensão Chrome — Busca de Empresa (Blendibox)

Consulta de CNPJ em qualquer página. **v1 (grátis).**

## O que faz (v1)

- **Detecta CNPJs automaticamente** em qualquer página e destaca. Ao passar o
  mouse, mostra um resumo (razão social, situação, porte, Simples/MEI, tempo de
  mercado, CNAE). Clique abre a página completa no site.
- **Popup de busca:** clique no ícone da extensão e consulte qualquer CNPJ —
  resumo, "Conheça esta empresa", dados, **Ver no mapa / Rota** (Google Maps),
  copiar CNPJ, sócios (mascarados) e link para a página completa.

Usa a mesma API (Cloudflare Worker) do site `buscadeempresa.blendibox.com.br`.

## Instalar (modo desenvolvedor / uso local)

1. Abra **chrome://extensions**
2. Ative **Modo do desenvolvedor** (canto superior direito)
3. **Carregar sem compactação** → selecione a pasta `extension/`
4. Pronto. Fixe o ícone e teste passando o mouse sobre um CNPJ em qualquer página.

## Publicar na Chrome Web Store (opcional)

- Taxa única de **US$ 5** (registro de desenvolvedor).
- Compacte a pasta `extension/` em .zip e envie pelo painel de desenvolvedor.

## Arquivos

| Arquivo | Função |
|---|---|
| `manifest.json` | Configuração (MV3) |
| `common.js` | Helpers compartilhados (validação, formatação, API, resumo) |
| `content.js` / `content.css` | Detecção de CNPJ na página + tooltip |
| `popup.html` / `popup.js` / `popup.css` | Popup de busca manual |
| `icons/` | Ícones 16/48/128 |

## Configuração

A URL da API está em `common.js` (`API_BASE`) — valor público, não é segredo.

## Próximas versões (roadmap)

- **v2 (grátis):** painel lateral, mapa embutido + distância (geocodificação),
  detecção em Mercado Livre/LinkedIn, início do histórico de mudanças.
- **Premium:** IA (Copilot), concorrentes/proximidade por raio, alertas de
  mudança cadastral, exportação para CRM.
