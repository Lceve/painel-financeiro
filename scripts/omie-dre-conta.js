// Compara uma ou mais CONTAS do DRE (codigo_dre, ex: 2.11.01) entre o Omie
// e o que o dashboard conta, categoria por categoria e título por título.
//
// Uso (na VPS, dentro da pasta do sync da empresa, pra pegar o .env dela):
//   node omie-dre-conta.js <AAAA-MM> <dre1,dre2> "<pares do dashboard>"
// Os pares vêm do snippet de console do dashboard (formato id:categoria:valor|...).
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

const [mesArg, dreArg, paresArg] = process.argv.slice(2);
if (!mesArg || !dreArg) {
  console.error('Uso: node omie-dre-conta.js AAAA-MM dre1,dre2 "id:cat:valor|id:cat:valor|..."');
  process.exit(1);
}
const [ano, mes] = mesArg.split('-').map(Number);
const pad = n => String(n).padStart(2, '0');
const dtDe = `01/${pad(mes)}/${ano}`;
const dtAte = `${new Date(ano, mes, 0).getDate()}/${pad(mes)}/${ano}`;
const contasDre = new Set(dreArg.split(',').map(s => s.trim()));

// Lado dashboard: id:cat:valor (valor já com sinal: despesa positiva, estorno negativo).
// Aceita o caminho de um arquivo com os pares (recomendado) ou a string direto.
const textoPares = (paresArg && fs.existsSync(paresArg)) ? fs.readFileSync(paresArg, 'utf8') : (paresArg || '');
const dash = textoPares.trim().split('|').filter(Boolean).map(p => {
  const [id, cat, valor] = p.trim().split(':');
  return { id, cat, valor: Number(valor) };
});
if (textoPares.trim() && (!dash.length || dash.some(l => !l.id || !l.cat || Number.isNaN(l.valor)))) {
  console.error('Pares do dashboard vazios ou inválidos (esperado id:cat:valor|...). Recebido:', textoPares.slice(0, 80));
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const r2 = v => Math.round(v * 100) / 100;
const brl = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    // Omie rejeita tag desconhecida: cada endpoint tem seu nome de campo de página
    const r = await omie(endpoint, call, { ...param, [chavePagina]: pagina });
    total = r.total_de_paginas || r.nTotPaginas || 1;
    (r[chaveLista] || []).forEach(x => todos.push(x));
    pagina++;
    await sleep(400);
  } while (pagina <= total);
  return todos;
}

// ListarMovimentos não traz o rateio (título com várias categorias vem só com
// a 1ª): as categorias de cada título vêm do cadastro do próprio título.
function partesDoTitulo(t) {
  const rateio = (t.categorias || []).filter(c => c.codigo_categoria);
  if (rateio.length) return rateio.map(c => ({ cat: c.codigo_categoria, valor: Number(c.valor || 0) }));
  return [{ cat: t.codigo_categoria, valor: Number(t.valor_documento || 0) }];
}

(async () => {
  console.log(`\n=== Omie x Dashboard: ${mesArg} | contas DRE ${[...contasDre].join(', ')} ===\n`);

  // 1) Categorias do Omie -> conta do DRE
  const cats = await paginar('geral/categorias/', 'ListarCategorias', { registros_por_pagina: 500 }, 'categoria_cadastro', 'pagina');
  const catInfo = new Map(cats.map(c => [c.codigo, { desc: c.descricao, dre: c.codigo_dre }]));
  const catsDaConta = new Set(cats.filter(c => contasDre.has(c.codigo_dre)).map(c => c.codigo));
  console.log(`${cats.length} categorias no Omie, ${catsDaConta.size} caem nas contas pedidas`);

  // 2) Movimentos com Data de Registro no mês (P e R — estorno em conta de despesa também conta)
  const movs = await paginar('financas/mf/', 'ListarMovimentos', { nRegPorPagina: 500, dDtRegDe: dtDe, dDtRegAte: dtAte }, 'movimentos', 'nPagina');
  console.log(`${movs.length} movimentos com registro em ${mesArg}`);

  // 3) Cadastro dos títulos (pra pegar o rateio real de categorias)
  const pagar = await paginar('financas/contapagar/', 'ListarContasPagar', { registros_por_pagina: 500, apenas_importado_api: 'N' }, 'conta_pagar_cadastro', 'pagina');
  const receber = await paginar('financas/contareceber/', 'ListarContasReceber', { registros_por_pagina: 500, apenas_importado_api: 'N' }, 'conta_receber_cadastro', 'pagina');
  const titulos = new Map();
  pagar.forEach(t => titulos.set(`P|${t.codigo_lancamento_omie}`, t));
  receber.forEach(t => titulos.set(`R|${t.codigo_lancamento_omie}`, t));
  console.log(`${pagar.length} títulos a pagar e ${receber.length} a receber no cadastro`);

  const omieLinhas = [];
  const vistos = new Set();
  const cancelados = [];
  let semCadastro = 0;
  movs.forEach(m => {
    const det = m.detalhes || {};
    const id = String(det.nCodTitulo);
    const nat = det.cNatureza === 'R' ? 'R' : 'P';
    // um título pode vir 1x por baixa/parcela: conta 1x
    if (vistos.has(`${nat}|${id}`)) return;
    vistos.add(`${nat}|${id}`);
    const t = titulos.get(`${nat}|${id}`);
    if (!t) semCadastro++;
    const partes = t ? partesDoTitulo(t) : [{ cat: det.cCodCateg, valor: Number(det.nValorTitulo || 0) }];
    const naConta = partes.filter(p => catsDaConta.has(p.cat));
    if (!naConta.length) return;
    const sinal = nat === 'R' ? -1 : 1;
    // Cancelado fica de fora do total, mas aparece listado pra conferência
    if (det.cStatus === 'CANCELADO' || (t && t.status_titulo === 'CANCELADO')) {
      naConta.forEach(p => cancelados.push({ id, cat: p.cat, valor: sinal * p.valor }));
      return;
    }
    naConta.forEach(p => omieLinhas.push({ id, cat: p.cat, valor: sinal * p.valor, status: det.cStatus, origem: det.cOrigem }));
  });
  if (semCadastro) console.log(`${semCadastro} movimentos sem título no cadastro (usada a categoria do movimento)`);
  if (cancelados.length) { console.log('\nCANCELADOS no Omie (fora do total do Omie):'); console.table(cancelados); }

  // 3) Por categoria
  const porCat = new Map();
  const soma = (lado, l) => {
    const k = l.cat;
    if (!porCat.has(k)) porCat.set(k, { cat: k, desc: (catInfo.get(k) || {}).desc || '?', dashboard: 0, omie: 0 });
    porCat.get(k)[lado] += l.valor;
  };
  dash.forEach(l => soma('dashboard', l));
  omieLinhas.forEach(l => soma('omie', l));
  const tabela = [...porCat.values()].map(c => ({ ...c, dashboard: r2(c.dashboard), omie: r2(c.omie), dif: r2(c.dashboard - c.omie) }))
    .sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif));
  console.log('\n--- POR CATEGORIA (dif = dashboard - omie) ---');
  console.table(tabela);
  const totD = dash.reduce((a, l) => a + l.valor, 0), totO = omieLinhas.reduce((a, l) => a + l.valor, 0);
  console.log(`TOTAL dashboard ${brl(totD)} | omie ${brl(totO)} | dif ${brl(totD - totO)}`);

  // 4) Título a título, só nas categorias divergentes
  const divergentes = new Set(tabela.filter(c => Math.abs(c.dif) >= 0.01).map(c => c.cat));
  const chave = l => `${l.id}|${l.cat}`;
  const mapaD = new Map(), mapaO = new Map();
  dash.filter(l => divergentes.has(l.cat)).forEach(l => mapaD.set(chave(l), (mapaD.get(chave(l)) || 0) + l.valor));
  omieLinhas.filter(l => divergentes.has(l.cat)).forEach(l => mapaO.set(chave(l), (mapaO.get(chave(l)) || 0) + l.valor));
  const difs = [];
  new Set([...mapaD.keys(), ...mapaO.keys()]).forEach(k => {
    const d = r2(mapaD.get(k) || 0), o = r2(mapaO.get(k) || 0);
    if (Math.abs(d - o) >= 0.01) {
      const [id, cat] = k.split('|');
      difs.push({ id, cat, dashboard: d, omie: o, dif: r2(d - o) });
    }
  });

  // Consulta no Omie cada título divergente pra saber o motivo
  for (const d of difs) {
    try {
      const t = await omie('financas/contapagar/', 'ConsultarContaPagar', { codigo_lancamento_omie: Number(d.id) });
      Object.assign(d, {
        status: t.status_titulo, emissao: iso(t.data_emissao), entrada: iso(t.data_entrada),
        valor_titulo: t.valor_documento, doc: t.numero_documento || '',
        cat_omie: t.codigo_categoria || (t.categorias || []).map(c => `${c.codigo_categoria}:${c.valor}`).join(' '),
      });
    } catch (e) {
      d.status = /não cadastrado/i.test(e.message) ? 'NAO EXISTE NO OMIE (orfao?)' : `ERRO: ${e.message.slice(0, 50)}`;
    }
    await sleep(350);
  }
  console.log('\n--- TÍTULOS DIVERGENTES (só nas categorias com diferença) ---');
  console.table(difs);
  console.log('soma das diferenças:', brl(difs.reduce((a, d) => a + d.dif, 0)));
})().catch(e => { console.error('Falhou:', e.message); process.exit(1); });
