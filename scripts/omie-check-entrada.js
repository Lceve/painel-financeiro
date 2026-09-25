// Testa a hipótese: o campo `data_entrada` de ListarContasPagar/Receber é a
// "Data de Registro" que o DRE do Omie usa (dDtRegistro do ListarMovimentos).
//
// Uso (na VPS, dentro da pasta do sync da empresa):
//   node omie-check-entrada.js <AAAA-MM>
//
// Só LÊ da API, não altera nada.

const fs = require('fs');
const path = require('path');

function carregarEnv(arquivo) {
  if (!fs.existsSync(arquivo)) return;
  fs.readFileSync(arquivo, 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
  });
}
carregarEnv(path.join(process.cwd(), '.env'));

const envPor = re => Object.keys(process.env).filter(k => re.test(k)).map(k => process.env[k])[0];
const APP_KEY = envPor(/APP_KEY/);
const APP_SECRET = envPor(/APP_SECRET/);
if (!APP_KEY || !APP_SECRET) {
  console.error('Não achei *APP_KEY / *APP_SECRET no .env da pasta atual:', process.cwd());
  process.exit(1);
}

const mesArg = process.argv[2];
if (!mesArg) { console.error('Uso: node omie-check-entrada.js AAAA-MM'); process.exit(1); }
const [ano, mes] = mesArg.split('-').map(Number);
const pad = n => String(n).padStart(2, '0');
const dtDe = `01/${pad(mes)}/${ano}`;
const dtAte = `${new Date(ano, mes, 0).getDate()}/${pad(mes)}/${ano}`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = d => (d && /^\d\d\/\d\d\/\d{4}$/.test(d)) ? d.split('/').reverse().join('-') : (d || null);

async function omie(endpoint, call, param, tentativa = 1) {
  const resp = await fetch(`https://app.omie.com.br/api/v1/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] }),
  });
  const json = await resp.json().catch(() => ({}));
  if (json.faultstring) {
    if (/consumo|bloquead|limite|REDUNDANT/i.test(json.faultstring) && tentativa < 4) {
      await sleep(5000 * tentativa);
      return omie(endpoint, call, param, tentativa + 1);
    }
    throw new Error(json.faultstring);
  }
  return json;
}

async function paginar(endpoint, call, param, chaveLista, chavePagina) {
  const todos = [];
  let pagina = 1, total = 1;
  do {
    const r = await omie(endpoint, call, { ...param, [chavePagina]: pagina });
    total = r.total_de_paginas || r.nTotPaginas || 1;
    (r[chaveLista] || []).forEach(x => todos.push(x));
    pagina++;
    await sleep(400);
  } while (pagina <= total);
  return todos;
}

(async () => {
  const movs = await paginar('financas/mf/', 'ListarMovimentos', { nRegPorPagina: 500, dDtRegDe: dtDe, dDtRegAte: dtAte }, 'movimentos', 'nPagina');
  const pagar = await paginar('financas/contapagar/', 'ListarContasPagar', { registros_por_pagina: 500, apenas_importado_api: 'N' }, 'conta_pagar_cadastro', 'pagina');
  const receber = await paginar('financas/contareceber/', 'ListarContasReceber', { registros_por_pagina: 500, apenas_importado_api: 'N' }, 'conta_receber_cadastro', 'pagina');
  const titulos = new Map();
  pagar.forEach(t => titulos.set(`P|${t.codigo_lancamento_omie}`, t));
  receber.forEach(t => titulos.set(`R|${t.codigo_lancamento_omie}`, t));

  // contagem separada por natureza: conta a receber não tem data_entrada preenchida
  const cont = { P: { igual_entrada: 0, difere_entrada: 0, entrada_nula: 0, igual_emissao: 0, sem_titulo: 0 },
                 R: { igual_entrada: 0, difere_entrada: 0, entrada_nula: 0, igual_emissao: 0, sem_titulo: 0 } };
  const exemplos = [];
  const vistos = new Set();
  movs.forEach(m => {
    const det = m.detalhes || {};
    const nat = det.cNatureza === 'R' ? 'R' : 'P';
    const k = `${nat}|${det.nCodTitulo}`;
    if (vistos.has(k)) return;
    vistos.add(k);
    const t = titulos.get(k);
    const c = cont[nat];
    if (!t) { c.sem_titulo++; return; }
    const reg = iso(det.dDtRegistro), ent = iso(t.data_entrada), emi = iso(t.data_emissao);
    if (reg === emi) c.igual_emissao++;
    if (!ent) { c.entrada_nula++; return; }
    if (reg === ent) c.igual_entrada++;
    else {
      c.difere_entrada++;
      if (exemplos.length < 25) exemplos.push({ id: det.nCodTitulo, nat, registro: reg, entrada: ent, emissao: emi, status: t.status_titulo });
    }
  });

  console.log(`\n=== ${mesArg}: Data de Registro (ListarMovimentos) x data_entrada (cadastro do título) ===`);
  console.log(`${vistos.size} títulos com registro no mês`);
  console.table(cont);
  if (exemplos.length) { console.log('Exemplos onde registro != data_entrada (entrada preenchida):'); console.table(exemplos); }
})().catch(e => { console.error('Falhou:', e.message); process.exit(1); });
