// Confere, direto na API do Omie, quais títulos o DRE nativo conta num mês/categoria
// e cruza com a lista de títulos que o dashboard está contando.
//
// Uso (na VPS, dentro da pasta do sync da empresa, pra pegar o .env dela):
//   node omie-dre-check.js <AAAA-MM> <cat1,cat2,...> [ids_do_dashboard_separados_por_virgula]
//
// Só LÊ da API (Listar*/Consultar*), não altera nada no Omie nem no Supabase.

const fs = require('fs');
const path = require('path');

// .env da Novah tem \r\n — lê na mão, sem depender de dotenv
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

const [mesArg, catsArg, idsArg] = process.argv.slice(2);
if (!mesArg || !catsArg) {
  console.error('Uso: node omie-dre-check.js AAAA-MM cat1,cat2 [id1,id2,...]');
  process.exit(1);
}
const [ano, mes] = mesArg.split('-').map(Number);
const ultimoDia = new Date(ano, mes, 0).getDate();
const pad = n => String(n).padStart(2, '0');
const dtDe = `01/${pad(mes)}/${ano}`;
const dtAte = `${ultimoDia}/${pad(mes)}/${ano}`;
const categorias = new Set(catsArg.split(',').map(s => s.trim()));
const idsDashboard = (idsArg || '').split(',').map(s => s.trim()).filter(Boolean);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function omie(endpoint, call, param, tentativa = 1) {
  const resp = await fetch(`https://app.omie.com.br/api/v1/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] }),
  });
  const json = await resp.json().catch(() => ({}));
  if (json.faultstring) {
    // rate limit do Omie: espera e tenta de novo
    if (/consumo|bloquead|limite|REDUNDANT/i.test(json.faultstring) && tentativa < 4) {
      await sleep(5000 * tentativa);
      return omie(endpoint, call, param, tentativa + 1);
    }
    const err = new Error(json.faultstring);
    err.omie = json;
    throw err;
  }
  return json;
}

// dd/mm/aaaa -> aaaa-mm-dd
const iso = d => (d && /^\d\d\/\d\d\/\d{4}$/.test(d)) ? d.split('/').reverse().join('-') : (d || null);
const dentroDoMes = d => !!d && iso(d).startsWith(`${ano}-${pad(mes)}`);
const brl = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Valor do movimento na(s) categoria(s) alvo, respeitando rateio
function valorNasCategorias(det, cats) {
  if (Array.isArray(cats) && cats.length) {
    // nomes dos campos do rateio variam entre endpoints do Omie
    const cod = c => c.cCodCateg || c.codigo_categoria || c.cCodigoCategoria;
    const val = c => Number(c.nValor ?? c.valor ?? c.nValorCateg ?? 0);
    const soma = cats.filter(c => categorias.has(cod(c))).reduce((a, c) => a + val(c), 0);
    if (soma || cats.some(c => cod(c))) return soma;
  }
  return categorias.has(det.cCodCateg) ? Number(det.nValorTitulo || 0) : 0;
}

async function listarMovimentos() {
  // Tenta filtrar por Data de Registro no servidor; se a tag não existir,
  // cai pra janela de emissão larga e filtra dDtRegistro localmente.
  const filtros = [
    { dDtRegDe: dtDe, dDtRegAte: dtAte },
    { dDtEmisDe: `01/${pad(mes === 1 ? 12 : mes - 1)}/${mes === 1 ? ano - 1 : ano}`, dDtEmisAte: `${new Date(ano, mes + 1, 0).getDate()}/${pad(mes === 12 ? 1 : mes + 1)}/${mes === 12 ? ano + 1 : ano}` },
  ];
  for (const filtro of filtros) {
    try {
      const todos = [];
      let pagina = 1, totalPaginas = 1;
      do {
        const r = await omie('financas/mf/', 'ListarMovimentos', { nPagina: pagina, nRegPorPagina: 500, cNatureza: 'P', ...filtro });
        totalPaginas = r.nTotPaginas || 1;
        (r.movimentos || []).forEach(m => todos.push(m));
        pagina++;
        await sleep(400);
      } while (pagina <= totalPaginas);
      console.log(`ListarMovimentos: filtro ${JSON.stringify(filtro)} -> ${todos.length} movimentos`);
      return todos;
    } catch (e) {
      console.log(`ListarMovimentos com ${JSON.stringify(filtro)} falhou: ${e.message}`);
    }
  }
  return [];
}

(async () => {
  console.log(`\n=== Omie DRE check: ${mesArg} | categorias ${[...categorias].join(', ')} ===\n`);

  // 1) Lado Omie: movimentos com Data de Registro no mês nas categorias alvo
  const movs = await listarMovimentos();
  const porTitulo = new Map();
  movs.forEach(m => {
    const det = m.detalhes || {};
    if (!dentroDoMes(det.dDtRegistro)) return;
    const v = valorNasCategorias(det, m.categorias);
    if (!v) return;
    const id = String(det.nCodTitulo);
    // mesmo título pode vir 1x por parcela/baixa: guarda uma linha por título
    if (!porTitulo.has(id)) porTitulo.set(id, { id, registro: iso(det.dDtRegistro), emissao: iso(det.dDtEmissao), valor: v, status: det.cStatus, origem: det.cOrigem, doc: det.cNumDocFiscal || det.cNumTitulo || '' });
  });
  const ladoOmie = [...porTitulo.values()];
  console.log('\n--- OMIE (ListarMovimentos, Data de Registro no mês) ---');
  console.table(ladoOmie);
  console.log('total Omie:', brl(ladoOmie.reduce((a, l) => a + l.valor, 0)));

  // 2) Lado dashboard: consulta cada título informado
  if (idsDashboard.length) {
    const detalhe = [];
    for (const id of idsDashboard) {
      try {
        const t = await omie('financas/contapagar/', 'ConsultarContaPagar', { codigo_lancamento_omie: Number(id) });
        detalhe.push({
          id,
          no_omie_mes: porTitulo.has(id) ? 'SIM' : 'NAO',
          status: t.status_titulo,
          emissao: iso(t.data_emissao),
          entrada: iso(t.data_entrada),
          previsao: iso(t.data_previsao),
          venc: iso(t.data_vencimento),
          inclusao: iso(t.info && t.info.dInc),
          valor: t.valor_documento,
          cat: t.codigo_categoria || (t.categorias || []).map(c => `${c.codigo_categoria}:${c.valor}`).join(' '),
          doc: t.numero_documento || '',
          nf: t.numero_documento_fiscal || '',
          fornecedor: t.codigo_cliente_fornecedor,
          obs: (t.observacao || '').slice(0, 40),
        });
      } catch (e) {
        detalhe.push({ id, no_omie_mes: porTitulo.has(id) ? 'SIM' : 'NAO', status: `ERRO: ${e.message.slice(0, 60)}` });
      }
      await sleep(350);
    }
    console.log('\n--- TÍTULOS QUE O DASHBOARD CONTA (ConsultarContaPagar) ---');
    console.table(detalhe);

    const soDashboard = detalhe.filter(d => d.no_omie_mes === 'NAO');
    console.log('\n>>> SÓ NO DASHBOARD (Omie não conta no mês):');
    console.table(soDashboard);
    console.log('soma:', brl(soDashboard.reduce((a, d) => a + Number(d.valor || 0), 0)));

    const setDash = new Set(idsDashboard);
    const soOmie = ladoOmie.filter(l => !setDash.has(l.id));
    console.log('\n>>> SÓ NO OMIE (dashboard não conta):');
    console.table(soOmie);
    console.log('soma:', brl(soOmie.reduce((a, l) => a + l.valor, 0)));
  }
})().catch(e => { console.error('Falhou:', e.message); process.exit(1); });
