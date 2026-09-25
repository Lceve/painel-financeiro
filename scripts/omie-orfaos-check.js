// Detecta candidatos a ÓRFÃO (título excluído no Omie que continua no Supabase).
// Pega os títulos de omie_accounts_payable que o ÚLTIMO full sync não tocou
// (synced_at mais antigo que o último sync - 15 min) e consulta cada um no Omie.
//
// Uso (na VPS, dentro da pasta do sync da empresa):
//   node omie-orfaos-check.js <ref_do_projeto_supabase>
//   ex: node omie-orfaos-check.js enedbeguahicctwwhpmb
//
// Só LÊ (Supabase e Omie). Não apaga nada — gera orfaos-<ref>.csv pra revisão.

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
if (!ref) { console.error('Uso: node omie-orfaos-check.js <ref_supabase>'); process.exit(1); }

const envPor = re => Object.keys(process.env).filter(k => re.test(k)).map(k => process.env[k])[0];
const APP_KEY = envPor(/APP_KEY/);
const APP_SECRET = envPor(/APP_SECRET/);

// Chave service_role do projeto pedido: acha pelo "ref" dentro do próprio JWT
const payloadJwt = k => { try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString()); } catch { return {}; } };
const SB_KEY = Object.values(process.env).find(v => /^eyJ/.test(v || '') && payloadJwt(v).ref === ref && payloadJwt(v).role === 'service_role');
if (!APP_KEY || !APP_SECRET || !SB_KEY) {
  console.error('Faltou credencial no .env:', { omie: !!(APP_KEY && APP_SECRET), supabase_service_role_do_ref: !!SB_KEY });
  process.exit(1);
}
const SB_URL = `https://${ref}.supabase.co/rest/v1`;
const sbHeaders = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const brl = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function sb(query) {
  const r = await fetch(`${SB_URL}/${query}`, { headers: sbHeaders });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.json();
}

async function omie(endpoint, call, param, tentativa = 1) {
  const resp = await fetch(`https://app.omie.com.br/api/v1/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] }),
  });
  const json = await resp.json().catch(() => ({}));
  if (json.faultstring) {
    if (/consumo|bloquead|limite|REDUNDANT|8020/i.test(json.faultstring) && tentativa < 5) {
      await sleep(5000 * tentativa);
      return omie(endpoint, call, param, tentativa + 1);
    }
    throw new Error(json.faultstring);
  }
  return json;
}

(async () => {
  const [ultimo] = await sb('omie_accounts_payable?select=synced_at&order=synced_at.desc&limit=1');
  const corte = new Date(new Date(ultimo.synced_at).getTime() - 15 * 60 * 1000).toISOString();
  console.log(`Último sync: ${ultimo.synced_at} | corte: ${corte}`);

  const candidatos = [];
  for (let off = 0; ; off += 1000) {
    const lote = await sb(`omie_accounts_payable?select=codigo_lancamento_omie,valor_documento,status_titulo,data_emissao,numero_documento&synced_at=lt.${corte}&order=codigo_lancamento_omie&limit=1000&offset=${off}`);
    candidatos.push(...lote);
    if (lote.length < 1000) break;
  }
  console.log(`${candidatos.length} títulos não tocados pelo último sync — consultando no Omie (≈${Math.ceil(candidatos.length * 0.4 / 60)} min)...`);

  const resultado = [];
  for (const [i, t] of candidatos.entries()) {
    let situacao, emissaoOmie = '', statusOmie = '';
    try {
      const o = await omie('financas/contapagar/', 'ConsultarContaPagar', { codigo_lancamento_omie: Number(t.codigo_lancamento_omie) });
      situacao = 'EXISTE';
      emissaoOmie = o.data_emissao || '';
      statusOmie = o.status_titulo || '';
    } catch (e) {
      situacao = /não cadastrado/i.test(e.message) ? 'NAO_EXISTE' : `ERRO: ${e.message.slice(0, 60)}`;
    }
    resultado.push({ ...t, situacao, emissaoOmie, statusOmie });
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${candidatos.length}`);
    await sleep(350);
  }

  // Resumo por situação x status x ano
  const resumo = {};
  resultado.forEach(r => {
    const ano = (r.data_emissao || '????').slice(0, 4);
    const k = `${r.situacao}|${r.status_titulo}|${ano}`;
    resumo[k] = resumo[k] || { situacao: r.situacao, status: r.status_titulo, ano, qtd: 0, valor: 0 };
    resumo[k].qtd++;
    resumo[k].valor += Number(r.valor_documento || 0);
  });
  console.log('\n--- RESUMO ---');
  console.table(Object.values(resumo).sort((a, b) => a.situacao.localeCompare(b.situacao) || a.ano.localeCompare(b.ano))
    .map(r => ({ ...r, valor: brl(r.valor) })));

  const orfaos = resultado.filter(r => r.situacao === 'NAO_EXISTE');
  console.log(`\nNAO_EXISTE no Omie: ${orfaos.length} títulos, R$ ${brl(orfaos.reduce((a, r) => a + Number(r.valor_documento || 0), 0))}`);
  console.log('Maiores 20:');
  console.table(orfaos.sort((a, b) => b.valor_documento - a.valor_documento).slice(0, 20)
    .map(({ codigo_lancamento_omie, valor_documento, status_titulo, data_emissao, numero_documento }) => ({ codigo_lancamento_omie, valor_documento, status_titulo, data_emissao, numero_documento })));

  const existe = resultado.filter(r => r.situacao === 'EXISTE');
  if (existe.length) {
    console.log(`\nEXISTEM no Omie mas o full sync não trouxe: ${existe.length} (amostra):`);
    console.table(existe.slice(0, 10).map(({ codigo_lancamento_omie, status_titulo, statusOmie, data_emissao, emissaoOmie }) => ({ codigo_lancamento_omie, status_titulo, statusOmie, data_emissao, emissaoOmie })));
  }

  const csv = ['codigo_lancamento_omie;valor;status;emissao;documento;situacao']
    .concat(resultado.map(r => [r.codigo_lancamento_omie, r.valor_documento, r.status_titulo, r.data_emissao, r.numero_documento || '', r.situacao].join(';')))
    .join('\n');
  fs.writeFileSync(`orfaos-${ref}.csv`, csv);
  console.log(`\nLista completa em ${path.join(process.cwd(), `orfaos-${ref}.csv`)}`);
})().catch(e => { console.error('Falhou:', e.message); process.exit(1); });
