// Apaga títulos ÓRFÃOS (confirmados fora do Omie) da base de ORIGEM da empresa
// e do CONSOLIDADO, com BACKUP completo antes, e permite restaurar.
//
// Uso (na pasta do dashboard-sync, que tem as chaves das 4 bases):
//   node limpar-orfaos.js <EMPRESA> <arquivo_csv>              -> só MOSTRA o que apagaria
//   node limpar-orfaos.js <EMPRESA> <arquivo_csv> --apagar     -> faz backup e apaga
//   ... --extrato  -> o CSV é de lançamentos de conta corrente (omie-extrato-orfaos-check.js)
//   node limpar-orfaos.js --restaurar <arquivo_backup.json>    -> devolve tudo do backup
//
// <arquivo_csv>: gerado por omie-orfaos-check.js (1ª coluna = codigo_lancamento_omie).
// EMPRESA: KMNO | NOVAH | RT

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
const chavePorRef = ref => {
  const k = Object.values(process.env).find(v => /^eyJ/.test(v || '') && payloadJwt(v).ref === ref && payloadJwt(v).role === 'service_role');
  if (!k) throw new Error(`sem chave service_role pro projeto ${ref} no .env`);
  return k;
};

const CONSOLIDADO = 'ihekejwxdvipgldblskn';
const EMPRESAS = { KMNO: 'enedbeguahicctwwhpmb', NOVAH: 'yppfzhptzcesmxiruaxk', RT: 'jdifejativsnghfxxeqe' };

// Onde cada título aparece: [projeto, tabela, coluna do id, filtro extra]
const alvosExtrato = empresa => [
  { ref: EMPRESAS[empresa], tabela: 'omie_current_account_transactions', col: 'cod_lanc' },
  { ref: CONSOLIDADO, tabela: 'dash_current_account_transactions', col: 'cod_lanc', extra: `&empresa_id=eq.${empresa}` },
];
const alvosTitulo = empresa => [
  { ref: EMPRESAS[empresa], tabela: 'omie_accounts_payable_categorias', col: 'parent_omie_id' },
  { ref: EMPRESAS[empresa], tabela: 'omie_financial_movements', col: 'cod_titulo' },
  { ref: EMPRESAS[empresa], tabela: 'omie_accounts_payable', col: 'codigo_lancamento_omie' },
  { ref: CONSOLIDADO, tabela: 'dash_accounts_payable_categorias', col: 'parent_omie_id', extra: `&empresa_id=eq.${empresa}` },
  { ref: CONSOLIDADO, tabela: 'dash_financial_movements', col: 'cod_titulo', extra: `&empresa_id=eq.${empresa}` },
  { ref: CONSOLIDADO, tabela: 'dash_accounts_payable', col: 'codigo_lancamento_omie', extra: `&empresa_id=eq.${empresa}` },
];

async function rest(ref, metodo, caminho, corpo, prefer) {
  const key = chavePorRef(ref);
  const r = await fetch(`https://${ref}.supabase.co/rest/v1/${caminho}`, {
    method: metodo,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (!r.ok) throw new Error(`${metodo} ${caminho.split('?')[0]}@${ref} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

const lotes = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
// Coluna de id pode ser texto ou número: aspas funcionam nos dois casos no PostgREST
const inFiltro = ids => `in.(${ids.map(i => `"${i}"`).join(',')})`;

async function restaurar(arquivo) {
  const backup = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  // ordem inversa da exclusão: pai antes dos filhos
  for (const b of [...backup.tabelas].reverse()) {
    for (const lote of lotes(b.linhas, 500)) await rest(b.ref, 'POST', b.tabela, lote, 'return=minimal');
    console.log(`restaurado ${b.tabela}@${b.ref}: ${b.linhas.length} linhas`);
  }
}

(async () => {
  if (process.argv[2] === '--restaurar') return restaurar(process.argv[3]);

  const [empresa, csv, ...flags] = process.argv.slice(2);
  const alvos = flags.includes('--extrato') ? alvosExtrato : alvosTitulo;
  if (!EMPRESAS[empresa] || !csv) {
    console.error('Uso: node limpar-orfaos.js <KMNO|NOVAH|RT> <arquivo_csv> [--extrato] [--apagar]');
    process.exit(1);
  }
  const apagar = flags.includes('--apagar');
  const ids = fs.readFileSync(csv, 'utf8').split('\n').slice(1).map(l => l.split(';')[0].trim()).filter(Boolean);
  console.log(`${ids.length} títulos no CSV | modo: ${apagar ? 'APAGAR (com backup)' : 'SÓ CONFERIR'}\n`);

  const backup = { empresa, csv, criado_em: new Date().toISOString(), tabelas: [] };
  for (const a of alvos(empresa)) {
    const linhas = [];
    for (const lote of lotes(ids, 150)) {
      linhas.push(...await rest(a.ref, 'GET', `${a.tabela}?select=*&${a.col}=${inFiltro(lote)}${a.extra || ''}`));
    }
    backup.tabelas.push({ ref: a.ref, tabela: a.tabela, col: a.col, linhas });
    console.log(`${a.tabela.padEnd(34)} ${a.ref === CONSOLIDADO ? 'consolidado' : 'origem     '}  ${linhas.length} linhas`);
  }

  if (!apagar) {
    console.log('\nNada foi apagado. Pra apagar, rode de novo com --apagar no final.');
    return;
  }

  const arquivo = path.join(process.cwd(), `backup-orfaos-${empresa}-${Date.now()}.json`);
  fs.writeFileSync(arquivo, JSON.stringify(backup));
  console.log(`\nBACKUP salvo em ${arquivo}`);

  for (const a of alvos(empresa)) {
    for (const lote of lotes(ids, 150)) {
      await rest(a.ref, 'DELETE', `${a.tabela}?${a.col}=${inFiltro(lote)}${a.extra || ''}`, null, 'return=minimal');
    }
    console.log(`apagado: ${a.tabela}@${a.ref === CONSOLIDADO ? 'consolidado' : 'origem'}`);
  }
  console.log(`\nPronto. Pra desfazer: node limpar-orfaos.js --restaurar ${arquivo}`);
})().catch(e => { console.error('Falhou:', e.message); process.exit(1); });
