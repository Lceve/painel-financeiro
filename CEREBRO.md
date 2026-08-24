# CÉREBRO — Painel Financeiro

> Este é o arquivo de contexto vivo do projeto. Qualquer sessão de IA
> (Claude, outra conta, etc) deve ler este arquivo no início do trabalho
> e atualizá-lo no fim, sempre que houver commit/push de mudança no
> dashboard, decisão tomada, ou bug encontrado/corrigido.
>
> Última atualização: 24/08/2026

---

## Quem somos

- **Lucas Ceve** (lucas.ceve@levitsbpo.net) — responsável técnico 100% do
  projeto (dashboard + sync + VPS). Toda mudança passa por ele.
- **Camilli** — também usa a mesma ferramenta de IA neste projeto.
- **Edgar** — dono da empresa, decisor de negócio, não mexe em código.

## O que é o projeto

Dashboard financeiro multi-empresa para 3 empresas: **KMNO Sports**,
**RT Esportes e Eventos**, **NOVAH** (ex-Blue Line, rebranding concluído
20/07/2026 — usar sempre `NOVAH` no código, nunca `BLUELINE`).

- Front-end: `index.html` único (~21k linhas), vanilla JS + Chart.js,
  hospedado no GitHub Pages.
- Repo: **`Lceve/painel-financeiro`** (username do GitHub trocado de novo
  em 24/08/2026, de `LMC404-lang` pra `Lceve` — confirmado que push/pull
  continuam funcionando sem reconfiguração, o GitHub redireciona sozinho.
  Se algo quebrar depois, é o primeiro lugar a checar).

- Backend: 4 projetos Supabase — KMNO (`enedbeguahicctwwhpmb`), Novah
  (`yppfzhptzcesmxiruaxk`), RT (`jdifejativsnghfxxeqe`), consolidado/dashboard
  (`ihekejwxdvipgldblskn`).
- Fonte de dados: Omie ERP via API → sync Node.js na VPS → Supabase.
- Jan–Mai/2026: dados congelados de Excel. Jun/2026+: só Omie/Supabase
  (fonte única da verdade).
- VPS: Hostinger Ubuntu 24.04, `srv1817879`, usuário `lucasadmin`, todo
  comando precisa de `sudo`.
- **GitHub Actions**: todos os workflows automáticos foram desativados
  (24/08/2026) — `dashboard-sync` e `omie-sync-kmno` (repo separado do
  de conta corrente) rodavam a cada 2h em paralelo com o cron da VPS,
  duplicando trabalho e gastando o limite de minutos (90% usado, quase
  travando o repo). VPS é a **única** fonte de execução agora. Se algo
  parar de sincronizar, primeiro checar o cron da VPS, não o GitHub.

## Regras de trabalho (sempre seguir)

1. Mudança que afeta mais de um local no `index.html` → pedir permissão
   antes, explicando o quê e onde.
2. Qualquer dúvida, por menor que seja → perguntar antes de agir, nunca
   assumir.
3. Sempre dizer o que vai fazer **antes** de fazer.
4. Lucas valida tudo — nada vai pra produção sem passar por ele.
5. Nunca sugerir F5/Ctrl+Shift+R, exceto último recurso.
6. Toda mudança no dashboard → entregar arquivo atualizado + resumo
   rápido e direto do que mudou.
7. Comandos de VPS sempre com `sudo`.
8. Ao final de qualquer sessão com commit/push, mudança de escopo, ou
   descoberta relevante → atualizar este arquivo antes de encerrar.
9. **[NOVA, 24/08/2026] Regra de negócio antes de código.** Não aplicar
   fix em produção baseado só em "o número bateu numa comparação" — isso
   pode ser coincidência, não confirma a causa. Confirmar a regra de
   negócio (cadastro do Omie, resposta do suporte, ou Lucas confirmando)
   **antes** de escrever qualquer código. Motivo: nesta sessão um fix foi
   aplicado, revertido, e retestado depois de confirmar com o suporte que
   a lógica estava errada desde o início — retrabalho evitável.

## Aprendizados críticos (nunca esquecer)

- **Saldo bancário KMNO**: o bloco "CAIXAS" da planilha/dashboard para
  KMNO inclui contas físicas nomeadas "RT" (Brasil RT, Sicredi RT) — são
  contas físicas da KMNO, **não** uma seleção separada da empresa RT.
  Nunca tratar isoladamente.
- **Categorias dinâmicas**: nomes de categoria (ex: "Transferências entre
  contas") vêm do Supabase em tempo de execução, não são hardcoded —
  filtrar por `cat.descricao` no JS, nunca buscar no arquivo estático.
- **`buildArvoreNativaDre`**: fonte primária pra DRE por Competência.
  KMNO/Jun validada linha a linha em 24/08/2026 contra pivot nativo
  exportado do Omie (ver pendência de Impostos abaixo pro detalhe
  completo, conta por conta).
- **NFe de nota de ENTRADA (compra) nunca compõe o DRE por Competência**
  — confirmado com o suporte do Omie em 24/08/2026. Ela não é imposto
  sobre venda, e o valor dela fica embutido no custo do estoque de um
  jeito interno do Omie que só é replicável se sincronizarmos o módulo
  de estoque (não sincronizamos, e não vamos — decisão do Lucas). Nota
  de saída (venda) continua contando normalmente. **Não tentar de novo
  "redirecionar" imposto de nota de compra pra nenhuma outra conta do
  DRE — já foi tentado e revertido em 24/08/2026.**
- **CMC de Remessa/Produtos usados em serviço**: opção configurável na
  tela de gerar DRE no Omie ("Considerar o CMC das remessas" / "...dos
  produtos utilizados na prestação de serviços"). Confirmado com Lucas
  em 24/08/2026: **sempre fica desmarcada** nos relatórios de referência
  usados pra comparação. Não é a causa de nenhum gap.
- **`sudo cd` falha silenciosamente** na VPS — sempre usar
  `sudo bash -c "cd /path && comando"`.
- **Escrever arquivos na VPS**: usar `sudo tee /path/arquivo > /dev/null`
  com heredoc — `sudo` com `>` de redirecionamento falha (redirect roda
  como não-root).
- **Tabelas certas pra cada relatório**: DRE por Competência usa
  `dash_accounts_receivable`/`dash_accounts_payable` (título,
  `valor_documento`, data de registro/emissão). DFC por Caixa usa
  `dash_financial_movements` (baixa real, `val_pago`, data de
  pagamento — tem duplicação por parcela/baixa se usado pra
  competência, então nunca usar essa tabela pra montar DRE).
- **Fallback de categoria**: títulos com `codigo_categoria` nulo no
  cadastro do Omie resolvem a categoria via `cod_titulo` batendo com
  `dash_financial_movements` (mesmo título, categoria lá preenchida).
  Mecanismo legítimo desde 20/08/2026, não é bug — some se você comparar
  duas queries e uma não aplicar esse fallback.

## Links úteis

- Repo: https://github.com/Lceve/painel-financeiro
- Dashboard: https://lceve.github.io/painel-financeiro/

---

## PENDÊNCIAS ABERTAS

### 🔴 Divergência de Impostos/Custo — DRE por Competência KMNO

Sessão de 24/08/2026 validou as **14 contas** do DRE nativo (KMNO,
Jun/2026) linha a linha contra pivot exportado do Omie. Resultado:

| Conta | Nativo | Nosso | Diferença | Status |
|---|---|---|---|---|
| Receita Bruta de Vendas | 902.596,83 | 909.486,63 | +6.889,80 | 🟡 sem causa |
| Impostos | -234.359,00 | -233.357,63 | -1.001,36 | ✅ resolvido |
| Deduções de Receita | -22.962,52 | -22.962,52 | 0 | ✅ resolvido |
| Outras Receitas | 39.295,94 | 39.295,94 | 0 | ✅ já batia |
| Receitas Financeiras | 178,33 | — | — | ⬜ não testado |
| Custo Médio (CMC) das Vendas | -47.319,16 | -47.253,16 | +66,00 | ✅ já batia |
| Custo dos Serviços Prestados | -508.048,07 | -446.383,85 | -61.664,22 | ❌ sem causa |
| Outros Custos | 0 | — | — | ⬜ não testado |
| Despesas Variáveis | -42.679,59 | -42.679,59 | 0 | ✅ já batia |
| Recuperação Desp. Variáveis | 69,90 | 69,90 | 0 | ✅ já batia |
| Despesas com Pessoal | -58.902,84 | -81.171,46 | -22.268,62 | 🟠 explicado |
| Despesas Administrativas | -72.301,85 | -74.824,99 | -2.523,14 | 🟡 pista fraca |
| Despesas Financeiras | -8.289,23 | -6.120,83 | +2.168,40 | 🟡 sem causa |
| Despesas Vendas/Marketing | -17.337,25 | -17.337,25 | 0 | ✅ já batia |
| Outros Tributos | -82.776,86 | -82.776,86 | 0 | ✅ já batia |
| Ativos | -5.218,58 | -5.218,58 | 0 | ✅ resolvido |

**✅ Resolvido — Impostos e Ativos**: bug de código real em
`buildArvoreNativaDre` (~linha 5810): imposto embutido de NFe caía
sempre em Impostos, sem checar `tipo_nf` (entrada/saída). Corrigido:
`nfeRows` agora ignora nota de entrada (`tipo_nf='0'`) por completo — não
soma imposto em NENHUMA conta do DRE (ver Aprendizados Críticos acima).
Campo `tipo_nf` adicionado em `omie_nfe` (KMNO + Novah) e propagado pra
`dash_nfe` — precisa fazer o mesmo pra RT quando o sync de NFe dela for
corrigido (ver pendência RT abaixo). Commit `3bbf662`.

**✅ Resolvido — Deduções de Receita**: **não era bug, era cadastro do
Omie**. Categoria "Serviços (Outras Facções)" (`2.01.02`, despesa real —
KMNO paga a Novah por facção) estava com "Conta do DRE" = "(-) Deduções
de Receita" (`1.01.03`) em vez de "Custo dos Serviços Prestados"
(`1.21.02`). Corrigido direto no Omie (Categorias → Serviços) por Lucas
em 24/08/2026, sincronizado (`sync-single.js categories --full` +
`dashboard-sync`). Efeito: R$33.636,15/mês movidos de Deduções de
Receita pra Custo dos Serviços.

**🟠 Despesas com Pessoal — explicado, não é bug**: gap de R$22.268,62 =
soma EXATA de 3 títulos de "PJ Comercial" (fornecedores 10400274766,
10400274762, 10390862281) com `data_registro` NULA no Omie — caem em
Jun via fallback pra `data_emissao`, mas o padrão de pares desses mesmos
fornecedores sugere que a Data de Registro real (quando o Omie fechar)
vai cair em Julho. Não corrigir — vai se resolver sozinho quando o Omie
processar. Não é código nosso, não é cadastro errado.

**❌ Custo dos Serviços Prestados — R$61.664,22 sem causa confirmada**.
Hipóteses testadas e **descartadas** em 24/08/2026, todas com evidência:
1. Redirecionar imposto de NFe de compra pra essa conta — **errado**,
   confirmado pelo suporte Omie, revertido (ver Aprendizados Críticos).
2. CMC de Remessa de Produtos — checkbox sempre desmarcada, não é isso.
3. Rateio de categoria (título dividido em 2+ categorias) — não existe
   nenhum título rateado em Jun/2026 pra KMNO.
4. Duplicidade de título (mesmo documento + mesmo valor repetido) —
   achado real mas pequeno (R$2.274,42, só taxas de cartão), não fecha
   o gap.

Resposta do suporte Omie (24/08/2026) deixa a porta aberta pra uma causa
que não temos como testar: "a conta 1.21.02 pode incluir CMC (Custo
Médio Contábil) calculado automaticamente sobre consumo de estoque,
quando ativado" — mas a config verificada tá desmarcada, e mesmo se
fosse isso, não temos estoque/inventário sincronizado (decisão
consciente de não sincronizar, não vale a pena reconstruir isso).
**Próximo passo, se retomar**: levar esse valor exato (R$61.664,22,
Jun/2026, KMNO) pro suporte do Omie como exemplo concreto, perguntando
o que compõe a conta além do título — não testar mais hipótese sem
confirmação prévia (ver regra #9 acima).

**🟡 Despesas Administrativas — pista fraca, não confirmada**: gap de
R$2.523,14. Único candidato achado: um título de R$25.456,23 na
categoria "Cartão Corporativo" (fatura consolidada, sem número de
documento) — pode ser que o Omie nativo quebre isso por trás em várias
categorias/contas (por transação da fatura), e nós contamos tudo numa
linha só. Não confirmado — não temos detalhe item a item da fatura.

**🟡 Despesas Financeiras**: gap de R$2.168,40. Direção oposta (nosso
valor é MENOS negativo — falta despesa, não sobra). Verificado: sem
título/lançamento na borda do mês (nada em 30/06-01/07 fora do lugar).
Sem pista até agora.

**🟡 Receita Bruta de Vendas**: gap de R$6.889,80. Verificado: sem
duplicata, sem cancelado escondido, sem título com data nula. Sem pista.

**⬜ Não testado ainda**: Receitas Financeiras (R$178,33), Outros Custos
(R$0 nativo).

**Ainda não validado**: Julho/2026 (só Junho foi comparado), e **Novah
e RT no período ao vivo — zero testado**. O fix de `tipo_nf` afeta as
duas (é código genérico), mas ninguém validou se ajudou, piorou, ou não
mudou nada nelas. RT em particular provavelmente ainda tem problema de
Impostos por causa da pendência de sync abaixo.

---

### 🔴 RT — sync de NFe incompleto

`omie_nfe` da RT nunca recebeu as colunas `dt_cancelamento`, `denegada`,
`dt_inutilizacao`, `tipo_nf` que foram adicionadas pra KMNO e Novah
(21/08 e 24/08/2026). O `dashboard-sync` (consolidador) dá erro toda vez
que roda pra RT: `column omie_nfe.dt_cancelamento does not exist` — RT
fica sem `dash_nfe` atualizado a cada rodada. Não bloqueante pro resto
(RT continua sincronizando as outras tabelas normalmente), mas o
Impostos/DRE da RT deve estar incompleto até isso ser corrigido.
**Ação pendente**: rodar a mesma migration + mapear os 4 campos em
`config/omie-tables.js` do repo de sync da RT.


### 🟡 DRE por CMC (novo card)

Tela separada no menu principal, replica a cascata do "Resumo (Grupo,
R$)" trocando CMV por CMC (custo real de estoque: quantidade vendida ×
custo unitário do produto).

**Decisões fechadas**: tela própria; estrutura pronta pras 3 empresas mas
só populando KMNO agora; Supabase com resumo agregado mensal (sem
detalhe por produto/drill-down); sync dentro de
`/root/omie-sync/omie-supabase-sync-KMNO` na VPS, diário; CMC usa data de
cada venda individual (não fixo de fim de mês).

**Reaproveitamento de código**: usar `buildResumoCategoriasMes`, pegar o
objeto de retorno inteiro, substituir só `cmv` pelo `cmc` novo,
recalcular cascata abaixo. Alternativa: rodar `buildResumo____` normal e
sobrescrever a linha de CMV antes de `extrairMetricasResumo(rows)`.

**API Omie validada**:
- Custo por produto: `ListarPosEstoque`
  (`https://app.omie.com.br/api/v1/estoque/consulta/`), retorna `nCMC` e
  `nSaldo`, paginado, filtro `codigo_local_estoque=10334036177` +
  `cExibeTodos="S"`. ~9.602 produtos / ~193 páginas de 50.
- Quantidade vendida: `ListarPedidos`
  (`https://app.omie.com.br/api/v1/produtos/pedido/`), filtrar por
  período, usar `produto.codigo` + `produto.quantidade`, confirmar
  `infoCadastro.faturado="S"`. Validado Jun/2026: 489 pedidos, 456
  faturados, 536 produtos únicos.
- Descartado: `ObterResumoProdutos` (só resumo executivo, sem detalhe por
  produto).
- CORS: API só via backend/VPS, nunca do `index.html` direto.
- Fórmula: `CMC do mês = Σ (quantidade vendida do produto × nCMC na data
  de posição de estoque usada)`.

**Exceção de produto**: códigos `307209-0-UNICO` e `307210-0-UNICO`
("PATCH KIMONO BORDADO") vendidos por ponto de bordado (unidade
"milheiro"), não por peça — excluir do cálculo de CMC.

**Credenciais**: `/root/omie-sync/omie-supabase-sync-KMNO/.env` tem
`OMIE_APP_KEY`/`OMIE_APP_SECRET` (sem sufixo `_KMNO`). Padrão de chamada:
```bash
sudo bash -c 'set -a; source /root/omie-sync/omie-supabase-sync-KMNO/.env; set +a; <comando>'
```

**Pendente antes de escrever código**: desenhar tabela Supabase; escrever
script de sync (paginar `ListarPosEstoque` e `ListarPedidos`, cruzar por
`nCodProd`/`produto.codigo`, agregar); cruzar quantidade-por-produto de
Jun/2026 contra `PosicaoEstoque` pra validar contra referência esperada
(não feito ainda); construir tela nova seguindo padrão visual do "Resumo
(Grupo, R$)".

### 🟡 Faturador KMNO (projeto separado, não é o dashboard)

Roda em `C:\omie-sync\omie-sync-novah`, máquina Windows do Edgar
(separado da VPS/dashboard).

**Estado**: 15 pedidos KMNO pré-01/07/2026 cancelados no Omie com nota
(exceto nº2733/2271805680, bloqueado pós-cancelamento, deixar como está).
Scripts (`categorizador-final.js`, `megaconsolidacao-coletar.js`,
`criar-consolidado-2.js`) foram perdidos do disco e reconstruídos com
preços validados:

| Item | Preço |
|---|---|
| Gandola Adulto / Infantil | R$18 / R$13,50 |
| Calça Adulto / Infantil | R$12 (PRO/STUCK R$18) / R$9 |
| Faixa Lisa / com Friso | R$2,50 / R$3,50 |
| Bermuda / Rash Guard (incl. Mormaii) | R$7,50 |
| Kimono Infantil Sarja / Mormaii Kimono | R$20 / R$30 |
| Patch Composição / Sublimado P-M-G | R$1,25 / R$3,50-R$5-R$6 |
| Resto | CFOP 5125 |

Excluídos por falta de preço/cadastro inativo: "Patch Gola em Z", "Patch
Sublimado Embutido", família "Patch Kimono Bordado".

**Suspeita não investigada**: `CancelarPedidoVenda` não atualiza `dAlt`,
sync incremental pode perder cancelamentos puros.

**Universo atual (muda diariamente, sempre revalidar)**: ~110 pedidos
candidatos (etapa 50, cliente KMNO, ≥01/07, sem CFOP 6xxx) → ~329 itens
únicos → 3 lotes de até 110 itens. 97 pedidos abertos em etapa=50 (Novah,
cliente KMNO) — não confirmado se são os 77 originais dos consolidados
cancelados nº3835/3836 ou incluem novos.

**Nada criado ainda**: script de consolidação real, decisão de
cancelar+faturar originais, cron real na VPS com log diário.

**Agendamento planejado**: Segunda–Quinta, teto ~90-110 itens/lote (não
por pedido), Quinta libera o resto da semana, meta ~30-31
consolidados/mês.

**Limites técnicos Omie**: `IncluirPedido` com 100+ itens precisa
`AbortController` 240s timeout (servidor pode completar após abort —
sempre checar com `ListarPedidos`); lote confiável máx ~110 itens;
`AlterarPedidoVenda` exige `quantidade` mesmo sem mudança.

---

### ⚪ Outras pendências menores

- `migration_metas.sql` — status de execução não confirmado.
- `index (teste).html` órfão no repo — decisão de remover ou restaurar
  pendente.
- 10 pares de títulos duplicados achados na categoria "Industrialização
  Blue Line" (mesmo número de documento, valores diferentes, um com
  Data de Registro preenchida e outro sem) — total R$2.838,88/mês.
  Achado incidental durante a investigação de Custo de Serviços, nunca
  reportado antes. Vale investigar/limpar num dia dedicado, não
  urgente (valor pequeno, não é a causa de nenhum gap grande).
