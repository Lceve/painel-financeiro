// Compara o EXTRATO SEM TÍTULO (EXTR/EXTP) de um mês, por categoria, entre o
// Omie (ListarLancCC) e o que o dashboard usa (dash_current_account_transactions),
// só nas contas do DRE pedidas. Salva lançamentos brutos de exemplo pra ver
// como o Omie devolve rateio de categoria.
//
// Uso (na pasta do sync da empresa):
//   node omie-extrato-conta.js <EMPRESA> <AAAA-MM> <dre1,dre2>
//   ex: node omie-extrato-conta.js KMNO 2026-06 1.11.01,2.11.03
//
// Só LÊ.

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
const payloadJwt = k => { try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString()); } catch { return {}; } };
const CONSOLIDADO = 'ihekejwxdvipgldblskn';
const SB_KEY = Object.values(process.env).find(v => /^eyJ/.test(v || '') && payloadJwt(v).ref === CONSOLIDADO && payloadJwt(v).role === 'service_role');

const [empresa, mesArg, dreArg] = process.argv.slice(2);
if (!empresa || !mesArg || !dreArg) { console.error('Uso: node omie-extrato-conta.js <EMPRESA> <AAAA-MM> <dre1,dre2>'); process.exit(1); }
if (!APP_KEY || !APP_SECRET || !SB_KEY) { console.error('Faltou credencial no .env', { omie: !!APP_KEY, consolidado: !!SB_KEY }); process.exit(1); }
const contasDre = new Set(dreArg.split(','));
const [ano, mes] = mesArg.split('-').map(Number);
const pad = n => String(n).padStart(2, '0');
const hoje = new Date();
const brl = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = v => Math.round(v * 100) / 100;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = d => (d && /^\d\d\/\d\d\/\d{4}$/.test(d)) ? d.split('/').reverse().join('-') : (d || '');
const noMes = d => iso(d).startsWith(`${ano}-${pad(mes)}`);
const ORIGENS = new Set(['EXTR', 'EXTP']); // mesmas que o index.html usa (ORIGENS_EXTRATO_SEM_TITULO_CONFIRMADAS)

async function omie(endpoint, call, param, tentativa = 1) {
  const resp = await fetch(`https://app.omie.com.br/api/v1/${endpoint}`, {
    signal: AbortSignal.timeout(60000),
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] }),
  });
  const json = await resp.json().catch(() => ({}));
  if (json.faultstring) {
    if (/8020|REDUNDANT/i.test(json.faultstring) && tentativa < 4) { await sleep(5000 * tentativa); return omie(endpoint, call, param, tentativa + 1); }
    throw new Error(json.faultstring);
  }
  return json;
}

(async () => {
  // Categorias -> conta DRE (do Omie)
  const cats = [];
  for (let p = 1, t = 1; p <= t; p++) {
    const r = await omie('geral/categorias/', 'ListarCategorias', { pagina: p, registros_por_pagina: 500 });
    t = r.total_de_paginas || 1; cats.push(...(r.categoria_cadastro || [])); await sleep(400);
  }
  const desc = new Map(cats.map(c => [c.codigo, c.descricao]));
  const naConta = new Set(cats.filter(c => contasDre.has(c.codigo_dre)).map(c => c.codigo));

  // Omie: lançamentos alterados desde o 1º dia do mês até hoje (pega tudo lançado no mês)
  const lancs = [];
  for (let p = 1, t = 1; p <= t; p++) {
    const r = await omie('financas/contacorrentelancamentos/', 'ListarLancCC', {
      nPagina: p, nRegPorPagina: 500,
      dDtAltDe: `01/${pad(mes)}/${ano}`, dDtAltAte: `${pad(hoje.getDate())}/${pad(hoje.getMonth() + 1)}/${hoje.getFullYear()}`,
    });
    t = r.nTotPaginas || 1; lancs.push(...(r.listaLancamentos || []));
    console.log(`  ListarLancCC página ${p}/${t}`);
    await sleep(400);
  }
  const doMes = lancs.filter(l => noMes(l.cabecalho && l.cabecalho.dDtLanc)
    && ORIGENS.has(l.diversos && l.diversos.cOrigem)
    && !Number(l.detalhes && l.detalhes.nCodTitulo));
  console.log(`${lancs.length} lançamentos alterados desde 01/${pad(mes)} | ${doMes.length} EXTR/EXTP sem título com data em ${mesArg}`);

  // Guarda exemplos brutos: 1 qualquer + os que têm algo parecido com rateio
  const comLista = doMes.filter(l => JSON.stringify(l).match(/"(categorias|aCodCateg|rateio|distribuicao)"/i));
  fs.writeFileSync(`extrato-exemplos-${empresa}-${mesArg}.json`, JSON.stringify({ exemplo: doMes[0], com_rateio: comLista.slice(0, 5) }, null, 2));
  console.log(`${comLista.length} lançamentos com campo de rateio | exemplos em extrato-exemplos-${empresa}-${mesArg}.json`);

  const porCat = new Map();
  const soma = (lado, cat, v) => {
    if (!naConta.has(cat)) return;
    const g = porCat.get(cat) || { cat, desc: desc.get(cat) || '?', dashboard: 0, omie: 0 };
    g[lado] += v; porCat.set(cat, g);
  };
  // sinal: despesa (P) positiva, receita (R) negativa — igual ao omie-dre-conta.js
  doMes.forEach(l => soma('omie', l.detalhes.cCodCateg, (l.diversos.cNatureza === 'R' ? -1 : 1) * Number(l.cabecalho.nValorLanc || 0)));

  // Dashboard: mesma tabela e mesmo filtro que o index.html usa
  const dash = [];
  for (let off = 0; ; off += 1000) {
    const url = `https://${CONSOLIDADO}.supabase.co/rest/v1/dash_current_account_transactions?select=cod_lanc,dt_lanc,valor_lanc,cod_categoria,natureza,cod_titulo,origem&empresa_id=eq.${empresa}&dt_lanc=gte.${ano}-${pad(mes)}-01&dt_lanc=lte.${ano}-${pad(mes)}-${new Date(ano, mes, 0).getDate()}&order=cod_lanc&limit=1000&offset=${off}`;
    const r = await fetch(url, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const lote = await r.json(); dash.push(...lote); if (lote.length < 1000) break;
  }
  const dashDoMes = dash.filter(t => (!t.cod_titulo || Number(t.cod_titulo) === 0) && ORIGENS.has(t.origem));
  dashDoMes.forEach(t => soma('dashboard', t.cod_categoria, (t.natureza === 'R' ? -1 : 1) * Number(t.valor_lanc || 0)));
  console.log(`${dashDoMes.length} EXTR/EXTP sem título no consolidado em ${mesArg}`);

  const tabela = [...porCat.values()].map(g => ({ ...g, dashboard: r2(g.dashboard), omie: r2(g.omie), dif: r2(g.dashboard - g.omie) }))
    .sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif));
  console.log('\n--- EXTRATO SEM TÍTULO POR CATEGORIA (dif = dashboard - omie; receita negativa) ---');
  console.table(tabela);
  const tD = tabela.reduce((a, g) => a + g.dashboard, 0), tO = tabela.reduce((a, g) => a + g.omie, 0);
  console.log(`TOTAL dashboard ${brl(tD)} | omie ${brl(tO)} | dif ${brl(tD - tO)}`);

  // Lançamentos que existem num lado e não no outro, ou com categoria diferente
  const mapaO = new Map(doMes.map(l => [String(l.nCodLanc), l]));
  const mapaD = new Map(dashDoMes.map(t => [String(t.cod_lanc), t]));
  const difs = [];
  new Set([...mapaO.keys(), ...mapaD.keys()]).forEach(id => {
    const o = mapaO.get(id), d = mapaD.get(id);
    const catO = o && o.detalhes.cCodCateg, catD = d && d.cod_categoria;
    if (!naConta.has(catO) && !naConta.has(catD)) return;
    if (o && d && catO === catD && r2(Number(o.cabecalho.nValorLanc)) === r2(Number(d.valor_lanc))) return;
    difs.push({ cod_lanc: id, data: iso(o ? o.cabecalho.dDtLanc : d.dt_lanc), cat_omie: catO || '(não tem)', cat_dash: catD || '(não tem)', valor_omie: o ? Number(o.cabecalho.nValorLanc) : 0, valor_dash: d ? Number(d.valor_lanc) : 0, obs: o ? String(o.detalhes.cObs || '').slice(0, 40) : '' });
  });
  console.log(`\n--- LANÇAMENTOS DIFERENTES (${difs.length}) ---`);
  console.table(difs.slice(0, 40));
})().catch(e => { console.error('Falhou:', e.message); process.exit(1); });
