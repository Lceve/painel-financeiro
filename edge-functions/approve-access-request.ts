// Edge Function: approve-access-request
// 15/10/2026: a propria funcao cuida do status. Aceita solicitacao 'pendente'
// ou 'aprovado' (as que ficaram presas no fluxo antigo) e so marca
// 'processado' no fim, depois de criar usuario + profile. Se falhar no meio,
// nada muda no status e da pra tentar de novo pelo painel.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STATUS_ACEITOS = ['pendente', 'aprovado'];

function randomPassword(length = 14) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let pw = '';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (let i = 0; i < length; i++) pw += chars[bytes[i] % chars.length];
  return pw;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};
const resp = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Valida o chamador e confere se e admin. Retorna o id do admin ou uma Response de erro.
async function exigirAdmin(req: Request, admin: ReturnType<typeof createClient>, msgNegado: string) {
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  if (!token) return resp({ error: 'Nao autenticado.' }, 401);
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return resp({ error: 'Sessao invalida.' }, 401);
  const { data: perfil } = await admin.from('profiles').select('role').eq('id', userData.user.id).maybeSingle();
  if (!perfil || perfil.role !== 'admin') return resp({ error: msgNegado }, 403);
  return userData.user.id as string;
}

async function acharUsuarioPorEmail(admin: ReturnType<typeof createClient>, email: string) {
  const alvo = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const achou = data?.users?.find((u) => (u.email || '').toLowerCase() === alvo);
    if (achou) return achou;
    if (!data?.users || data.users.length < 200) return null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const adminId = await exigirAdmin(req, admin, 'Apenas administradores podem aprovar solicitacoes.');
    if (adminId instanceof Response) return adminId;

    const { solicitacao_id } = await req.json();
    if (!solicitacao_id) return resp({ error: 'solicitacao_id e obrigatorio.' }, 400);

    const { data: sol, error: solErr } = await admin.from('solicitacoes_acesso').select('*').eq('id', solicitacao_id).maybeSingle();
    if (solErr || !sol) return resp({ error: 'Solicitacao nao encontrada.' }, 404);
    if (!STATUS_ACEITOS.includes(sol.status)) return resp({ error: `Solicitacao ja esta "${sol.status}".` }, 409);

    const tempPassword = randomPassword();
    let userId: string;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: sol.email, password: tempPassword, email_confirm: true,
    });
    if (createErr) {
      if (!String(createErr.message || '').toLowerCase().includes('already')) return resp({ error: createErr.message }, 400);
      const existente = await acharUsuarioPorEmail(admin, sol.email);
      if (!existente) return resp({ error: createErr.message }, 400);
      userId = existente.id;
      // usuario ja existia: garante que a senha entregue e a que vale
      const { error: pwErr } = await admin.auth.admin.updateUserById(userId, { password: tempPassword });
      if (pwErr) return resp({ error: pwErr.message }, 400);
    } else {
      userId = created.user.id;
    }

    const { error: profileErr } = await admin.from('profiles').upsert({
      id: userId, email: sol.email, nome: sol.nome, role: 'viewer',
      empresas_permitidas: sol.empresas_solicitadas, ativo: true,
    });
    if (profileErr) return resp({ error: profileErr.message }, 400);

    await admin.from('solicitacoes_acesso')
      .update({ status: 'processado', decidido_em: new Date().toISOString(), decidido_por: adminId })
      .eq('id', solicitacao_id);

    return resp({ ok: true, email: sol.email, senha_temporaria: tempPassword, empresas: sol.empresas_solicitadas });
  } catch (e) {
    return resp({ error: String(e) }, 500);
  }
});
