// Sync de Peças Faturadas -> Supabase CONSOLIDADO (dash_pecas_faturadas)
// 15/10/2026 (pedido Lucas): substitui o /tmp/sync_pecas_faturadas.js manual.
// Lê ListarPedidos do Omie, pega só pedidos faturados (dFat), classifica por
// nome do produto e grava por empresa/mês/produto no consolidado com empresa_id.
// Cada mês do período é REESCRITO inteiro (apaga e grava) -- só depois que a
// busca no Omie terminou sem erro. Se falhar no meio, não grava nada.
//
// Uso: node sync-pecas-faturadas.js EMPRESA /caminho/.env [AAAA-MM-de] [AAAA-MM-ate]
// Sem datas: mês anterior + mês atual.
// Ex.: node sync-pecas-faturadas.js KMNO /root/omie-sync/omie-supabase-sync-KMNO/.env 2026-06 2026-10

const fs = require('fs');
const https = require('https');

const [, , EMPRESA, ENV_FILE, DE_ARG, ATE_ARG] = process.argv;
if (!EMPRESA || !ENV_FILE) {
  console.error('Uso: node sync-pecas-faturadas.js EMPRESA /caminho/.env [AAAA-MM-de] [AAAA-MM-ate]');
  process.exit(1);
}

// lê o .env sem dependência externa (tira \r e aspas)
const env = {};
for (const linha of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
  const m = linha.replace(/\r$/, '').match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const APP_KEY = env.OMIE_APP_KEY, APP_SECRET = env.OMIE_APP_SECRET;
const SB_URL = env.DASHBOARD_SUPABASE_URL;
const SB_KEY = env.DASHBOARD_SUPABASE_SERVICE_ROLE_KEY || env.DASHBOARD_SUPABASE_SERVICE_KEY;
if (!APP_KEY || !APP_SECRET || !SB_URL || !SB_KEY) {
  console.error('Faltam variáveis no .env (OMIE_APP_KEY, OMIE_APP_SECRET, DASHBOARD_SUPABASE_URL, DASHBOARD_SUPABASE_SERVICE_ROLE_KEY).');
  process.exit(1);
}

// período alvo (meses inteiros)
const hoje = new Date();
const ym = (d) => ({ ano: d.getFullYear(), mes: d.getMonth() + 1 });
const parseYm = (s) => { const [a, m] = s.split('-').map(Number); return { ano: a, mes: m }; };
const ini = DE_ARG ? parseYm(DE_ARG) : ym(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1));
const fim = ATE_ARG ? parseYm(ATE_ARG) : ym(hoje);
const meses = [];
for (let a = ini.ano, m = ini.mes; a < fim.ano || (a === fim.ano && m <= fim.mes); m === 12 ? (a++, m = 1) : m++) meses.push({ ano: a, mes: m });
const chaveMes = (a, m) => `${a}-${String(m).padStart(2, '0')}`;
const mesesAlvo = new Set(meses.map(x => chaveMes(x.ano, x.mes)));

// a busca no Omie começa 3 meses antes: pedido incluído antes e faturado
// dentro do período também precisa entrar (o filtro do Omie é por inclusão)
const buscaDe = new Date(ini.ano, ini.mes - 1 - 3, 1);
const buscaAte = new Date(fim.ano, fim.mes, 0);
const br = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

// classificação por nome (regras de 26/08 + kimono_gb de 01/09) -- 1ª que bater vence
const REGRAS = [
  [/KIMONO GB/, 'kimono_gb'],
  [/FAIXA GB EDITION/, 'faixa_gb_rt'],
  [/FAIXA JIU|MORMAII FAIXA|FAIXA BJJ|FAIXA ATOS/, 'faixa_kmno'],
  [/CAL[CÇ]A JIU/, 'calca'],
  [/GANDOLA JIU/, 'gandola'],
  [/BERMUDA CUSTON/, 'bermuda'],
  [/RASH GUARD/, 'rash_guard'],
];
const classificar = (desc) => {
  const d = String(desc || '').toUpperCase();
  for (const [re, g] of REGRAS) if (re.test(d)) return g;
  return null;
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function req(url, method, headers, body) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const r = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers, timeout: 60000 }, (res) => {
      let s = ''; res.on('data', c => s += c); res.on('end', () => resolve({ status: res.statusCode, body: s }));
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', (e) => resolve({ status: 0, body: JSON.stringify({ faultstring: String(e.message || e) }) }));
    if (body) r.write(body);
    r.end();
  });
}

async function omie(pagina) {
  const payload = JSON.stringify({
    call: 'ListarPedidos', app_key: APP_KEY, app_secret: APP_SECRET,
    param: [{ pagina, registros_por_pagina: 50, apenas_importado_api: 'N',
      filtrar_por_data_de: br(buscaDe), filtrar_por_data_ate: br(buscaAte) }],
  });
  for (let t = 1; t <= 6; t++) {
    const r = await req('https://app.omie.com.br/api/v1/produtos/pedido/', 'POST',
      { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, payload);
    let j; try { j = JSON.parse(r.body); } catch { j = { faultstring: r.body.slice(0, 200) }; }
    if (r.status === 200 && !j.faultstring) return j;
    const msg = String(j.faultstring || '');
    if (/n[aã]o existem registros/i.test(msg)) return { total_de_paginas: 0, pedido_venda_produto: [] };
    const espera = /redundante|consumo indevido/i.test(msg) ? 65000 : 5000 * t;
    console.log(`  página ${pagina}: tentativa ${t} falhou (${msg.slice(0, 120)}), esperando ${espera / 1000}s`);
    await sleep(espera);
  }
  throw new Error(`Omie falhou na página ${pagina} depois de 6 tentativas`);
}

async function sb(path, method, body) {
  const r = await req(`${SB_URL}/rest/v1/${path}`, method, {
    apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal',
  }, body ? JSON.stringify(body) : undefined);
  if (r.status < 200 || r.status >= 300) throw new Error(`Supabase ${method} ${path.split('?')[0]}: ${r.status} ${r.body.slice(0, 300)}`);
}

(async () => {
  console.log(`[${new Date().toISOString()}] ${EMPRESA}: meses ${[...mesesAlvo].join(', ')} (busca Omie ${br(buscaDe)} a ${br(buscaAte)})`);
  const agg = new Map();
  let pagina = 1, total = 1, pedidosFat = 0;
  while (pagina <= total) {
    const j = await omie(pagina);
    total = j.total_de_paginas || 0;
    for (const p of j.pedido_venda_produto || []) {
      const ic = p.infoCadastro || {};
      if (ic.faturado !== 'S' || ic.cancelado === 'S') continue;
      const dataRef = ic.dFat || ic.dInc;
      if (!dataRef) continue;
      const [, mm, aaaa] = dataRef.split('/').map(Number);
      const k = chaveMes(aaaa, mm);
      if (!mesesAlvo.has(k)) continue;
      pedidosFat++;
      for (const it of p.det || []) {
        const pr = it.produto || {};
        const grupo = classificar(pr.descricao);
        if (!grupo) continue;
        const kk = `${k}|${pr.codigo}`;
        const atual = agg.get(kk) || { empresa_id: EMPRESA, ano: aaaa, mes: mm, grupo,
          codigo_produto: String(pr.codigo), descricao_produto: pr.descricao, quantidade: 0 };
        atual.quantidade += Math.round(Number(pr.quantidade || 0));
        agg.set(kk, atual);
      }
    }
    if (pagina % 10 === 0 || pagina === total) console.log(`  página ${pagina}/${total}`);
    pagina++;
    await sleep(1200);
  }
  const linhas = [...agg.values()];
  console.log(`  ${pedidosFat} pedidos faturados no período, ${linhas.length} linhas produto/mês`);

  for (const { ano, mes } of meses) {
    await sb(`dash_pecas_faturadas?empresa_id=eq.${EMPRESA}&ano=eq.${ano}&mes=eq.${mes}`, 'DELETE');
    const doMes = linhas.filter(l => l.ano === ano && l.mes === mes);
    for (let i = 0; i < doMes.length; i += 500) await sb('dash_pecas_faturadas', 'POST', doMes.slice(i, i + 500));
    const pecas = doMes.reduce((s, l) => s + l.quantidade, 0);
    console.log(`  ${chaveMes(ano, mes)}: ${doMes.length} produtos, ${pecas} peças gravadas`);
  }
  console.log('  ok');
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
