# Extensão Chrome — Busca de Empresa (Blendibox)

Consulta de CNPJ em qualquer página. **v1 (grátis).**

## O que faz (v1)

- **Detecta CNPJs automaticamente** em qualquer página e destaca. Ao passar o
  mouse, mostra um resumo (razão social, situação, porte, Simples/MEI, tempo de
  mercado, CNAE). Clique abre a página completa no site.
- **Painel lateral** (abre ao clicar no ícone, estilo Google Maps — fica fixo ao
  lado enquanto você navega): busca de CNPJ, resumo "Conheça esta empresa",
  dados, **Ver no mapa / Rota** (Google Maps), copiar, sócios (mascarados) e
  link para a página completa.
- **Histórico de consultas** salvo no navegador (data/hora, excluir individual,
  clicar para refazer a busca) — aparece abaixo da busca.
- **Rodapé de ofertas** (espaço publicitário, feed próprio) fixo no painel.

Usa a mesma API (Cloudflare Worker) do site `buscadeempresa.blendibox.com.br`.

## Instalar (modo desenvolvedor / uso local)

1. Abra **chrome://extensions**
2. Ative **Modo do desenvolvedor** (canto superior direito)
3. **Carregar sem compactação** → selecione a pasta `extension/`
4. Fixe o ícone 🔎. **Clique no ícone** para abrir o painel lateral, ou passe o
   mouse sobre um CNPJ em qualquer página.

## Publicar na Chrome Web Store (opcional)

- Taxa única de **US$ 5** (registro de desenvolvedor).
- Compacte a pasta `extension/` em .zip e envie pelo painel de desenvolvedor.

## Arquivos

| Arquivo | Função |
|---|---|
| `manifest.json` | Configuração (MV3) |
| `background.js` | Abre o painel lateral ao clicar no ícone |
| `common.js` | Helpers compartilhados (validação, formatação, API, resumo) |
| `content.js` / `content.css` | Detecção de CNPJ na página + tooltip |
| `sidepanel.html` / `sidepanel.js` | Painel lateral (busca + histórico) |
| `ads-popup.js` | Carrossel de ofertas do rodapé |
| `popup.css` | Estilos do painel |
| `icons/` | Ícones 16/48/128 |

## Configuração

A URL da API está em `common.js` (`API_BASE`) — valor público, não é segredo.

## Próximas versões (roadmap)

- **v2 (grátis):** mapa embutido + distância (geocodificação), detecção em
  Mercado Livre/LinkedIn, clique no CNPJ da página abre o painel, início do
  histórico de mudanças cadastrais.
- **Premium:** IA (Copilot), concorrentes/proximidade por raio, alertas de
  mudança cadastral, exportação para CRM.
