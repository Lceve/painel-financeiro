// Edge Function: approve-password-change
// 15/10/2026: a propria funcao cuida do status. Aceita 'pendente' ou
// 'aprovado' e so marca 'processado' depois de trocar a senha.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const adminId = await exigirAdmin(req, admin, 'Apenas administradores podem aprovar troca de senha.');
    if (adminId instanceof Response) return adminId;

    const { solicitacao_id } = await req.json();
    if (!solicitacao_id) return resp({ error: 'solicitacao_id e obrigatorio.' }, 400);

    const { data: sol, error: solErr } = await admin.from('solicitacoes_troca_senha').select('*').eq('id', solicitacao_id).maybeSingle();
    if (solErr || !sol) return resp({ error: 'Solicitacao nao encontrada.' }, 404);
    if (!STATUS_ACEITOS.includes(sol.status)) return resp({ error: `Solicitacao ja esta "${sol.status}".` }, 409);

    const tempPassword = randomPassword();
    const { error: updateErr } = await admin.auth.admin.updateUserById(sol.user_id, { password: tempPassword });
    if (updateErr) return resp({ error: updateErr.message }, 400);

    await admin.from('solicitacoes_troca_senha')
      .update({ status: 'processado', decidido_em: new Date().toISOString(), decidido_por: adminId })
      .eq('id', solicitacao_id);

    return resp({ ok: true, email: sol.email, senha_temporaria: tempPassword });
  } catch (e) {
    return resp({ error: String(e) }, 500);
  }
});
