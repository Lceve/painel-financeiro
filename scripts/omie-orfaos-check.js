// Detecta candidatos a ÓRFÃO (título excluído no Omie que continua no Supabase).
// Compara os ids de omie_accounts_payable com a listagem completa do Omie e
// confere por amostra (ConsultarContaPagar) se os que faltam existem ou não.
//
// Uso (na VPS, dentro da pasta do sync da empresa):
//   node omie-orfaos-check.js <ref_do_projeto_supabase> [amostra_por_grupo=5]
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
  // Não depende de synced_at (o cron incremental muda isso a cada 3h):
  // compara os ids da base com a listagem COMPLETA do Omie.
  const omieIds = new Set();
  for (let pagina = 1, total = 1; pagina <= total; pagina++) {
    const r = await omie('financas/contapagar/', 'ListarContasPagar', { pagina, registros_por_pagina: 500, apenas_importado_api: 'N' });
    total = r.total_de_paginas || 1;
    (r.conta_pagar_cadastro || []).forEach(t => omieIds.add(String(t.codigo_lancamento_omie)));
    await sleep(400);
  }
  const base = [];
  for (let off = 0; ; off += 1000) {
    const lote = await sb(`omie_accounts_payable?select=codigo_lancamento_omie,valor_documento,status_titulo,data_emissao,numero_documento&order=codigo_lancamento_omie&limit=1000&offset=${off}`);
    base.push(...lote);
    if (lote.length < 1000) break;
  }
  const candidatos = base.filter(t => !omieIds.has(String(t.codigo_lancamento_omie)));
  console.log(`Omie lista ${omieIds.size} títulos | base tem ${base.length} | ${candidatos.length} na base e fora da listagem do Omie`);

  // Confere no Omie título a título só uma AMOSTRA por grupo (status x ano),
  // pra saber se o grupo é órfão (não existe) ou filtro da listagem (existe).
  const AMOSTRA = Number(process.argv[3] || 5);
  const grupos = new Map();
  candidatos.forEach(t => {
    const k = `${t.status_titulo}|${(t.data_emissao || '????').slice(0, 4)}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(t);
  });
  const resumo = [];
  const resultado = [];
  for (const [k, lista] of grupos) {
    const [status, ano] = k.split('|');
    let existe = 0, naoExiste = 0, erro = 0;
    for (const t of lista.slice(0, AMOSTRA)) {
      try {
        await omie('financas/contapagar/', 'ConsultarContaPagar', { codigo_lancamento_omie: Number(t.codigo_lancamento_omie) });
        existe++; resultado.push({ ...t, situacao: 'EXISTE' });
      } catch (e) {
        if (/não cadastrado/i.test(e.message)) { naoExiste++; resultado.push({ ...t, situacao: 'NAO_EXISTE' }); }
        else { erro++; resultado.push({ ...t, situacao: `ERRO: ${e.message.slice(0, 40)}` }); }
      }
      await sleep(350);
    }
    resumo.push({ status, ano, qtd: lista.length, valor: brl(lista.reduce((a, t) => a + Number(t.valor_documento || 0), 0)), amostra: Math.min(AMOSTRA, lista.length), existe, nao_existe: naoExiste, erro });
  }
  console.log('\n--- NA BASE E FORA DA LISTAGEM DO OMIE (amostra conferida por título) ---');
  console.table(resumo.sort((a, b) => a.ano.localeCompare(b.ano) || a.status.localeCompare(b.status)));

  const csv = ['codigo_lancamento_omie;valor;status;emissao;documento;situacao_amostra']
    .concat(candidatos.map(t => {
      const r = resultado.find(x => x.codigo_lancamento_omie === t.codigo_lancamento_omie);
      return [t.codigo_lancamento_omie, t.valor_documento, t.status_titulo, t.data_emissao, t.numero_documento || '', r ? r.situacao : ''].join(';');
    })).join('\n');
  fs.writeFileSync(`orfaos-${ref}.csv`, csv);
  console.log(`\nLista completa em ${path.join(process.cwd(), `orfaos-${ref}.csv`)}`);
})().catch(e => { console.error('Falhou:', e.message); process.exit(1); });
