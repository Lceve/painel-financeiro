// Agrupa por fornecedor os títulos do CSV gerado por omie-orfaos-check.js,
// lendo os dados direto do Supabase da empresa (sem precisar copiar SQL).
//
// Uso (na pasta do sync da empresa):
//   node orfaos-por-fornecedor.js <ref_supabase>
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

const ref = process.argv[2];
if (!ref) { console.error('Uso: node orfaos-por-fornecedor.js <ref_supabase>'); process.exit(1); }
const payloadJwt = k => { try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString()); } catch { return {}; } };
const key = Object.values(process.env).find(v => /^eyJ/.test(v || '') && payloadJwt(v).ref === ref && payloadJwt(v).role === 'service_role');
if (!key) { console.error('Sem chave service_role pro projeto', ref); process.exit(1); }

const brl = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const ids = fs.readFileSync(`orfaos-${ref}.csv`, 'utf8').split('\n').slice(1).map(l => l.split(';')[0]).filter(Boolean);
  const linhas = [];
  for (let i = 0; i < ids.length; i += 150) {
    const lote = ids.slice(i, i + 150).join(',');
    const url = `https://${ref}.supabase.co/rest/v1/omie_accounts_payable?select=codigo_lancamento_omie,codigo_cliente_fornecedor,valor_documento,data_emissao,numero_documento,status_titulo,codigo_categoria&codigo_lancamento_omie=in.(${lote})`;
    const r = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
    linhas.push(...await r.json());
  }
  const grupos = new Map();
  linhas.forEach(l => {
    const k = String(l.codigo_cliente_fornecedor);
    const g = grupos.get(k) || { fornecedor: k, qtd: 0, valor: 0, de: l.data_emissao, ate: l.data_emissao, exemplo_doc: l.numero_documento || '', exemplo_id: l.codigo_lancamento_omie, categoria: l.codigo_categoria };
    g.qtd++; g.valor += Number(l.valor_documento || 0);
    if (l.data_emissao && (!g.de || l.data_emissao < g.de)) g.de = l.data_emissao;
    if (l.data_emissao && (!g.ate || l.data_emissao > g.ate)) g.ate = l.data_emissao;
    grupos.set(k, g);
  });
  console.log(`${linhas.length} títulos lidos de ${ids.length} no CSV\n`);
  console.table([...grupos.values()].sort((a, b) => b.valor - a.valor).slice(0, 15).map(g => ({ ...g, valor: brl(g.valor) })));
})().catch(e => { console.error('Falhou:', e.message); process.exit(1); });
