/**
 * Semeadura do cache com CNPJs notáveis (empresas de alta procura).
 * Lê uma lista de CNPJs e chama a API (/cnpj/{cnpj}) para cachear cada um.
 * As páginas estáticas são criadas depois pelo gerar-paginas.mjs.
 *
 * Uso:  node scripts/semear.mjs [arquivo]
 * Env:  API_BASE, DELAY_MS (padrão 1500 — respeita o limite da fonte)
 *
 * Falhas (CNPJ inválido/inexistente) são apenas puladas — nada de errado é gerado.
 */
import { readFile } from "node:fs/promises";

const API_BASE = process.env.API_BASE || "https://buscador-empresas-blendibox.blendibox.workers.dev";
const DELAY = parseInt(process.env.DELAY_MS || "1500", 10);
const arquivo = process.argv[2] || "scripts/sementes-notaveis.txt";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const onlyDigits = (s) => (s || "").replace(/\D/g, "");

const txt = await readFile(arquivo, "utf-8");
const cnpjs = [
  ...new Set(
    txt
      .split("\n")
      .map((l) => onlyDigits(l.split("#")[0])) // ignora comentário após #
      .filter((c) => c.length === 14)
  ),
];

console.log(`Semeando ${cnpjs.length} CNPJs em ${API_BASE} (delay ${DELAY}ms)...\n`);
let ok = 0, fail = 0;
for (const cnpj of cnpjs) {
  try {
    const r = await fetch(`${API_BASE}/cnpj/${cnpj}`);
    const j = await r.json();
    if (r.ok && j.data) {
      ok++;
      console.log(`  ✓ ${cnpj}  ${j.data.razao_social}  [${j.fonte}]`);
    } else {
      fail++;
      console.log(`  ✗ ${cnpj}  ${j.erro || r.status}`);
    }
  } catch (_) {
    fail++;
    console.log(`  ✗ ${cnpj}  erro de conexão`);
  }
  await sleep(DELAY);
}
console.log(`\nConcluído: ${ok} cacheadas, ${fail} puladas.`);
