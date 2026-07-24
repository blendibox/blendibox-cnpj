# Buscador de Empresas - Blendibox

Site de consulta de CNPJ (estilo cnpj.biz) usando **dados públicos** da Receita Federal.

Arquitetura **cache-aside**, tudo dentro do plano gratuito:

```
Usuário → GitHub Pages (site estático)
              │ fetch(cnpj)
              ▼
        Cloudflare Worker  ← nossa API
              │
        tem no D1?  ── SIM → responde do cache (rápido, sem tocar na BrasilAPI)
              │
              └─ NÃO → BrasilAPI → responde + grava no D1 (nossa "base de consultas")
```

- **Frontend** (`frontend/`): HTML/CSS/JS puro, publicável no GitHub Pages.
- **Worker** (`worker/`): API de consulta, cache no D1, TTL de 30 dias, sócios mascarados (LGPD).
- **Cron**: reprocessa registros vencidos automaticamente.

---

## 1. Publicar o Worker (Cloudflare)

Pré-requisito: conta gratuita na Cloudflare e Node.js instalado.

```bash
cd worker
npm install -g wrangler        # ou use: npx wrangler ...
wrangler login
```

Crie o banco D1 e cole o `database_id` no `wrangler.jsonc`:

```bash
wrangler d1 create buscador-empresas-blendibox
```

Crie as tabelas:

```bash
wrangler d1 execute buscador-empresas-blendibox --remote --file=./schema.sql
```

Publique:

```bash
wrangler deploy
```

O comando mostra a URL do Worker, algo como:
`https://buscador-empresas-blendibox.SEU-USUARIO.workers.dev`

### Testar localmente (opcional)

```bash
wrangler d1 execute buscador-empresas-blendibox --local --file=./schema.sql
wrangler dev
```

A API sobe em `http://localhost:8787`. Teste:
`http://localhost:8787/cnpj/65025894000110`

---

## 2. Configurar o Frontend

Edite `frontend/app.js` e troque a constante `API_BASE` pela URL do seu Worker:

```js
const API_BASE = "https://buscador-empresas-blendibox.SEU-USUARIO.workers.dev";
```

(Para testar local, use `"http://localhost:8787"`.)

---

## 3. Publicar o site no GitHub Pages

1. Crie um repositório no GitHub e suba este projeto.
2. Em **Settings → Pages**, aponte a fonte para a branch e a pasta `/frontend`
   (ou mova o conteúdo de `frontend/` para a raiz e use a raiz).
3. O site fica em `https://SEU-USUARIO.github.io/SEU-REPO/`.

---

## Configurações (worker/wrangler.jsonc)

| Variável          | Padrão | O que faz                                    |
|-------------------|--------|----------------------------------------------|
| `CACHE_TTL_DAYS`  | `30`   | Dias até um registro cacheado ser reconsultado |
| `MASK_SOCIOS`     | `true` | Mascara nome/CPF de sócios na resposta        |

---

## Limites do plano gratuito (aproximados)

| Serviço       | Grátis                    |
|---------------|---------------------------|
| Workers       | 100.000 req/dia           |
| D1            | 5 GB · 5M linhas lidas/dia |
| Cron Triggers | incluído                  |
| GitHub Pages  | estático grátis           |
| BrasilAPI     | grátis com rate limit     |

---

## Aviso legal (LGPD)

Os dados são públicos (Dados Abertos CNPJ da Receita Federal), mas o quadro
societário contém dados de **pessoas físicas**. Por padrão, nomes e documentos
de sócios são exibidos de forma **parcial**. Avalie a legislação antes de expor
a base publicamente.
