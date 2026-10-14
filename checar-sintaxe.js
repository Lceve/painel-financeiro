// Valida a sintaxe de todos os blocos <script> inline do index.html.
// Uso: node checar-sintaxe.js index.html
const fs = require('fs'), vm = require('vm');
const arq = process.argv[2] || 'index.html';
const s = fs.readFileSync(arq, 'utf8');
const re = /<script>([\s\S]*?)<\/script>/g;
let m, n = 0, erro = false;
while ((m = re.exec(s))) {
  n++;
  try { new vm.Script(m[1], { filename: `${arq} (bloco ${n})` }); }
  catch (e) { erro = true; console.error(`ERRO de sintaxe no bloco ${n}: ${e.message}`); }
}
console.log(`${n} blocos de script verificados${erro ? ' — COM ERRO' : ' — OK'}`);
process.exit(erro ? 1 : 0);
