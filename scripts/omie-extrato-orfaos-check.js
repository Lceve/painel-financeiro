// Detecta lançamentos de conta corrente ÓRFÃOS: estão em omie_current_account_transactions
// (base de origem da empresa) mas não existem mais na listagem completa do Omie (ListarLancCC).
// NÃO consulta lançamento por lançamento (isso fez o Omie bloquear a chave em 25/09):
// só compara a listagem completa com a base.
//
// Uso (na pasta do sync da empresa):
//   node omie-extrato-orfaos-check.js <ref_supabase>
//
// Só LÊ. Gera extrato-orfaos-<ref>.csv (1ª coluna = cod_lanc) pra usar no limpar-orfaos.js.

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

const ref = process.argv[2];
if (!ref) { console.error('Uso: node omie-extrato-orfaos-check.js <ref_supabase>'); process.exit(1); }
const envPor = re => Object.keys(process.env).filter(k => re.test(k)).map(k => process.env[k])[0];
const APP_KEY = envPor(/APP_KEY/);
const APP_SECRET = envPor(/APP_SECRET/);
const payloadJwt = k => { try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString()); } catch { return {}; } };
const SB_KEY = Object.values(process.env).find(v => /^eyJ/.test(v || '') && payloadJwt(v).ref === ref && payloadJwt(v).role === 'service_role');
if (!APP_KEY || !APP_SECRET || !SB_KEY) { console.error('Faltou credencial no .env', { omie: !!APP_KEY, supabase: !!SB_KEY }); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const brl = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  // Listagem completa: "alterados desde 2000" = todos os lançamentos
  const hoje = new Date();
  const pad = n => String(n).padStart(2, '0');
  const omieIds = new Set();
  for (let p = 1, t = 1; p <= t; p++) {
    const r = await omie('financas/contacorrentelancamentos/', 'ListarLancCC', {
      nPagina: p, nRegPorPagina: 500,
      dDtAltDe: '01/01/2000', dDtAltAte: `${pad(hoje.getDate())}/${pad(hoje.getMonth() + 1)}/${hoje.getFullYear()}`,
    });
    t = r.nTotPaginas || 1;
    (r.listaLancamentos || []).forEach(l => omieIds.add(String(l.nCodLanc)));
    if (p % 10 === 0 || p === t) console.log(`  ListarLancCC página ${p}/${t}`);
    await sleep(400);
  }

  const base = [];
  for (let off = 0; ; off += 1000) {
    const url = `https://${ref}.supabase.co/rest/v1/omie_current_account_transactions?select=cod_lanc,dt_lanc,valor_lanc,cod_categoria,natureza,origem,cod_titulo&order=cod_lanc&limit=1000&offset=${off}`;
    const r = await fetch(url, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const lote = await r.json(); base.push(...lote); if (lote.length < 1000) break;
  }
  const orfaos = base.filter(l => !omieIds.has(String(l.cod_lanc)));
  console.log(`\nOmie lista ${omieIds.size} lançamentos | base tem ${base.length} | ${orfaos.length} na base e fora do Omie`);

  // Resumo por origem x ano
  const grupos = new Map();
  orfaos.forEach(l => {
    const k = `${l.origem}|${String(l.dt_lanc || '????').slice(0, 4)}`;
    const g = grupos.get(k) || { origem: l.origem, ano: String(l.dt_lanc || '????').slice(0, 4), qtd: 0, valor: 0 };
    g.qtd++; g.valor += Number(l.valor_lanc || 0); grupos.set(k, g);
  });
  console.table([...grupos.values()].sort((a, b) => a.ano.localeCompare(b.ano) || String(a.origem).localeCompare(String(b.origem))).map(g => ({ ...g, valor: brl(g.valor) })));
  console.log('Maiores 15:');
  console.table(orfaos.sort((a, b) => Number(b.valor_lanc) - Number(a.valor_lanc)).slice(0, 15));

  fs.writeFileSync(`extrato-orfaos-${ref}.csv`, ['cod_lanc;dt_lanc;valor;categoria;natureza;origem;cod_titulo']
    .concat(orfaos.map(l => [l.cod_lanc, l.dt_lanc, l.valor_lanc, l.cod_categoria, l.natureza, l.origem, l.cod_titulo].join(';'))).join('\n'));
  console.log(`\nLista em ${path.join(process.cwd(), `extrato-orfaos-${ref}.csv`)}`);
})().catch(e => { console.error('Falhou:', e.message); process.exit(1); });
