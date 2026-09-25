// Acha registros que existem no CONSOLIDADO (dash_*) mas não existem mais na
// base de ORIGEM da empresa (omie_*). O dashboard-sync só faz upsert, então
// tudo que foi apagado na origem (ex: limpeza de órfãos) fica sobrando aqui.
//
// Uso (na VPS, na pasta do dashboard-sync, que tem as chaves das 4 bases):
//   cd /root/omie-sync/dashboard-sync && node consolidado-orfaos-check.js
//
// Só LÊ. Gera consolidado-orfaos.csv pra revisão — não apaga nada.

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

const payloadJwt = k => { try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString()); } catch { return {}; } };
const chavePorRef = ref => Object.values(process.env).find(v => /^eyJ/.test(v || '') && payloadJwt(v).ref === ref && payloadJwt(v).role === 'service_role');

const CONSOLIDADO = 'ihekejwxdvipgldblskn';
const EMPRESAS = { KMNO: 'enedbeguahicctwwhpmb', NOVAH: 'yppfzhptzcesmxiruaxk', RT: 'jdifejativsnghfxxeqe' };
// consolidado -> origem, com a coluna que identifica o registro dos dois lados
const TABELAS = [
  { dash: 'dash_accounts_payable', origem: 'omie_accounts_payable', id: 'codigo_lancamento_omie', valor: 'valor_documento' },
  { dash: 'dash_accounts_receivable', origem: 'omie_accounts_receivable', id: 'codigo_lancamento_omie', valor: 'valor_documento' },
  { dash: 'dash_financial_movements', origem: 'omie_financial_movements', id: 'cod_titulo', valor: 'val_pago' },
];

const brl = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function lerTudo(ref, tabela, colunas, filtro = '') {
  const key = chavePorRef(ref);
  if (!key) throw new Error(`sem chave service_role pro projeto ${ref} no .env`);
  const linhas = [];
  for (let off = 0; ; off += 1000) {
    const url = `https://${ref}.supabase.co/rest/v1/${tabela}?select=${colunas}${filtro}&order=${colunas.split(',')[0]}&limit=1000&offset=${off}`;
    const r = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`${tabela}@${ref} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const lote = await r.json();
    linhas.push(...lote);
    if (lote.length < 1000) break;
  }
  return linhas;
}

(async () => {
  const resumo = [];
  const csv = ['empresa;tabela;id;valor'];
  for (const [empresa, ref] of Object.entries(EMPRESAS)) {
    for (const t of TABELAS) {
      const origem = await lerTudo(ref, t.origem, t.id);
      const idsOrigem = new Set(origem.map(r => String(r[t.id])));
      const dash = await lerTudo(CONSOLIDADO, t.dash, `${t.id},${t.valor}`, `&empresa_id=eq.${empresa}`);
      const sobrando = dash.filter(r => r[t.id] != null && !idsOrigem.has(String(r[t.id])));
      // financial_movements tem várias linhas por título: resume por título
      const porId = new Map();
      sobrando.forEach(r => porId.set(String(r[t.id]), (porId.get(String(r[t.id])) || 0) + Number(r[t.valor] || 0)));
      porId.forEach((v, id) => csv.push([empresa, t.dash, id, v].join(';')));
      resumo.push({ empresa, tabela: t.dash, origem: idsOrigem.size, consolidado_linhas: dash.length, ids_sobrando: porId.size, valor_sobrando: brl([...porId.values()].reduce((a, v) => a + v, 0)) });
      console.log(`ok ${empresa} ${t.dash}`);
    }
  }
  console.log('\n--- NO CONSOLIDADO MAS NÃO NA ORIGEM ---');
  console.table(resumo);
  fs.writeFileSync('consolidado-orfaos.csv', csv.join('\n'));
  console.log(`Lista completa em ${path.join(process.cwd(), 'consolidado-orfaos.csv')}`);
})().catch(e => { console.error('Falhou:', e.message); process.exit(1); });
