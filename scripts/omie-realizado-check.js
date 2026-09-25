// Mostra (SEM GRAVAR NADA) o que o Omie devolve hoje no ListarOrcamentos
// (Realizado) de alguns meses: total de receitas (1) e despesas (2) e os
// subgrupos de 2º nível (1.01, 1.02, ..., 2.01, ...), pra comparar com o que
// está em dash_orcamento_realizado e entender a Prova Real.
//
// Uso (na pasta do sync da empresa):
//   node omie-realizado-check.js <AAAA> <mes_ini> <mes_fim>
//   ex: node omie-realizado-check.js 2026 6 8

require('dotenv').config();
const axios = require('axios');

const [ano, mesIni, mesFim] = process.argv.slice(2).map(Number);
if (!ano || !mesIni || !mesFim) { console.error('Uso: node omie-realizado-check.js AAAA mes_ini mes_fim'); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const brl = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const porCod = {};
  const desc = {};
  for (let mes = mesIni; mes <= mesFim; mes++) {
    const { data } = await axios.post('https://app.omie.com.br/api/v1/financas/caixa/', {
      call: 'ListarOrcamentos', app_key: process.env.OMIE_APP_KEY, app_secret: process.env.OMIE_APP_SECRET,
      param: [{ nAno: ano, nMes: mes }],
    });
    (data.ListaOrcamentos || []).forEach(l => {
      if (l.cCodCateg.split('.').length > 2) return; // só total e 2º nível
      (porCod[l.cCodCateg] = porCod[l.cCodCateg] || {})[mes] = l.nValorRealizado;
      desc[l.cCodCateg] = l.cDesCateg || l.cDescricao || '';
    });
    await sleep(3000);
  }
  const meses = [];
  for (let m = mesIni; m <= mesFim; m++) meses.push(m);
  const linhas = Object.keys(porCod).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(c => Object.assign({ cod: c, desc: String(desc[c]).slice(0, 35) }, ...meses.map(m => ({ [`${pad(m)}/${ano}`]: brl(porCod[c][m]) }))));
  function pad(n) { return String(n).padStart(2, '0'); }
  console.table(linhas);
})().catch(e => { console.error('Falhou:', e.response?.data || e.message); process.exit(1); });
