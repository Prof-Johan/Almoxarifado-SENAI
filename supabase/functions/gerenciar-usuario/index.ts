// Função de servidor: gerenciar-usuario
// Cria, edita, bloqueia, remove e restaura contas, e define senha provisória.
// Roda no Supabase com a chave de serviço, que nunca vai para o navegador.
// As regras da hierarquia ficam no banco (validar_gestao_usuario), então
// valem para qualquer caminho.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Bloqueio por tempo indeterminado (100 anos).
const BLOQUEIO = '876000h';
const SEM_EMAIL = '@sem-email.local';

type Dados = Record<string, string | boolean | null>;

function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function mensagemErro(erro: unknown): string {
  const msg = String((erro as { message?: string })?.message ?? erro ?? '');
  if (/perfis_email_key|already been registered|email_exists|already registered/i.test(msg)) return 'Já existe um usuário com este e-mail.';
  if (/perfis_matricula_key/.test(msg)) return 'Já existe um usuário com esta matrícula.';
  if (/perfis_cracha_key/.test(msg)) return 'Este número de crachá já está em uso.';
  if (/password/i.test(msg) && /(characters|weak|short|least)/i.test(msg)) return 'Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.';
  if (/invalid.*email|email.*invalid|unable to validate email/i.test(msg)) return 'E-mail inválido.';
  if (/rate limit/i.test(msg)) return 'Limite de envio de e-mails atingido. Use senha provisória ou configure o SMTP no Supabase.';
  if (/not authorized|email_address_not_authorized/i.test(msg)) return 'O Supabase ainda não envia e-mails para fora da equipe. Configure o SMTP ou use senha provisória.';
  return msg || 'Não foi possível concluir a operação.';
}

// Mantém só os campos permitidos e limpa os valores.
function limpar(entrada: Record<string, unknown> = {}): Dados {
  const texto = ['nome', 'email', 'matricula', 'cracha', 'perfil', 'unidade_id', 'setor_id', 'empresa'];
  const saida: Dados = {};
  for (const campo of texto) {
    if (!(campo in entrada)) continue;
    const valor = entrada[campo] === null || entrada[campo] === undefined ? '' : String(entrada[campo]).trim();
    saida[campo] = campo === 'email' ? valor.toLowerCase() || null : valor || null;
  }
  if (typeof entrada.ativo === 'boolean') saida.ativo = entrada.ativo;
  if (typeof saida.perfil === 'string') saida.perfil = saida.perfil.toUpperCase();
  return saida;
}

const emailInterno = (matricula: string) =>
  `${matricula.toLowerCase().replace(/[^a-z0-9._-]/g, '')}${SEM_EMAIL}`;

async function rpc(admin: SupabaseClient, nome: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(nome, args);
  if (error) throw new Error(error.message);
  return data;
}

async function validar(admin: SupabaseClient, ator: string, alvo: string | null, d: Dados, removido: boolean | null = null) {
  await rpc(admin, 'validar_gestao_usuario', {
    p_ator: ator,
    p_alvo: alvo,
    p_perfil: (d.perfil as string) ?? null,
    p_ativo: typeof d.ativo === 'boolean' ? d.ativo : null,
    p_removido: removido,
  });
}

// Confere e-mail, matrícula e crachá repetidos antes de mexer na conta.
async function conferirRepetidos(admin: SupabaseClient, d: Dados, idAtual: string | null) {
  const campos: [string, string][] = [
    ['email', 'Já existe um usuário com este e-mail.'],
    ['matricula', 'Já existe um usuário com esta matrícula.'],
    ['cracha', 'Este número de crachá já está em uso.'],
  ];
  for (const [campo, mensagem] of campos) {
    const valor = d[campo];
    if (!valor) continue;
    let consulta = admin.from('perfis').select('id').eq(campo, valor).limit(1);
    if (idAtual) consulta = consulta.neq('id', idAtual);
    const { data, error } = await consulta;
    if (error) throw new Error(error.message);
    if (data?.length) throw new Error(mensagem);
  }
}

async function salvar(admin: SupabaseClient, ator: string, id: string, dados: Record<string, unknown>) {
  return await rpc(admin, 'salvar_perfil_usuario', { p_ator: ator, p_id: id, p_dados: dados });
}

async function perfilAtual(admin: SupabaseClient, id: string) {
  const { data, error } = await admin.from('perfis').select('id, email, matricula, ativo, removido_em').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Usuário não encontrado.');
  return data;
}

// ---------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------

async function criar(admin: SupabaseClient, ator: string, corpo: Record<string, unknown>) {
  const d = limpar(corpo.dados as Record<string, unknown>);
  const modo = corpo.modo === 'convite' ? 'convite' : 'senha';
  const senha = String(corpo.senha ?? '');
  if (!d.nome || String(d.nome).length < 2) throw new Error('Informe o nome completo.');
  if (!d.email && !d.matricula) throw new Error('Informe o e-mail ou a matrícula.');
  if (d.matricula && !/^[A-Za-z0-9._-]+$/.test(String(d.matricula))) throw new Error('A matrícula aceita só letras, números, ponto, hífen e sublinhado.');
  if (modo === 'convite' && !d.email) throw new Error('Para enviar convite, informe o e-mail.');
  if (modo === 'senha' && senha.length < 8) throw new Error('A senha provisória precisa ter pelo menos 8 caracteres.');

  await validar(admin, ator, null, d);
  await conferirRepetidos(admin, d, null);

  const emailAcesso = (d.email as string) || emailInterno(String(d.matricula));
  const criado = modo === 'convite'
    ? await admin.auth.admin.inviteUserByEmail(emailAcesso, { redirectTo: String(corpo.redirectTo || '') || undefined })
    : await admin.auth.admin.createUser({ email: emailAcesso, password: senha, email_confirm: true });
  if (criado.error || !criado.data.user) throw criado.error ?? new Error('Não foi possível criar a conta.');
  const novoId = criado.data.user.id;

  try {
    const usuario = await salvar(admin, ator, novoId, { ...d, ativo: true, deve_trocar_senha: true });
    return { ok: true, usuario };
  } catch (erro) {
    // Desfaz a conta de acesso se o perfil não foi salvo.
    await admin.auth.admin.deleteUser(novoId);
    throw erro;
  }
}

async function editar(admin: SupabaseClient, ator: string, corpo: Record<string, unknown>) {
  const id = String(corpo.id || '');
  const d = limpar(corpo.dados as Record<string, unknown>);
  if ('nome' in d && (!d.nome || String(d.nome).length < 2)) throw new Error('Informe o nome completo.');
  if (d.matricula && !/^[A-Za-z0-9._-]+$/.test(String(d.matricula))) throw new Error('A matrícula aceita só letras, números, ponto, hífen e sublinhado.');

  await validar(admin, ator, id, d);
  await conferirRepetidos(admin, d, id);
  const atual = await perfilAtual(admin, id);

  const mudancas: Record<string, unknown> = {};
  if ('email' in d || 'matricula' in d) {
    const email = 'email' in d ? d.email : atual.email;
    const matricula = 'matricula' in d ? d.matricula : atual.matricula;
    if (!email && !matricula) throw new Error('Informe o e-mail ou a matrícula. Sem um dos dois a pessoa não consegue entrar.');
    const { data: conta, error } = await admin.auth.admin.getUserById(id);
    if (error) throw error;
    const acesso = (email as string) || emailInterno(String(matricula));
    if (acesso !== conta.user.email) {
      mudancas.email = acesso;
      mudancas.email_confirm = true;
    }
  }
  if (typeof d.ativo === 'boolean' && d.ativo !== atual.ativo && !atual.removido_em) {
    mudancas.ban_duration = d.ativo ? 'none' : BLOQUEIO;
  }
  if (Object.keys(mudancas).length) {
    const { error } = await admin.auth.admin.updateUserById(id, mudancas);
    if (error) throw error;
  }
  const usuario = await salvar(admin, ator, id, d);
  return { ok: true, usuario };
}

async function definirSenha(admin: SupabaseClient, ator: string, corpo: Record<string, unknown>) {
  const id = String(corpo.id || '');
  const senha = String(corpo.senha ?? '');
  if (senha.length < 8) throw new Error('A senha provisória precisa ter pelo menos 8 caracteres.');
  if (id === ator) throw new Error('Para trocar a sua própria senha, use Minha conta.');
  await validar(admin, ator, id, {});
  const { error } = await admin.auth.admin.updateUserById(id, { password: senha });
  if (error) throw error;
  const usuario = await salvar(admin, ator, id, { deve_trocar_senha: true });
  return { ok: true, usuario };
}

async function alterarRemocao(admin: SupabaseClient, ator: string, corpo: Record<string, unknown>, remover: boolean) {
  const id = String(corpo.id || '');
  await validar(admin, ator, id, {}, remover);
  const atual = await perfilAtual(admin, id);
  // Removido não entra. Ao restaurar, volta a situação anterior (ativo ou bloqueado).
  const banir = remover || !atual.ativo;
  const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: banir ? BLOQUEIO : 'none' });
  if (error) throw error;
  const usuario = await salvar(admin, ator, id, { removido: remover });
  return { ok: true, usuario };
}

// ---------------------------------------------------------------------
// Entrada da função
// ---------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { erro: 'Método não permitido.' });

  const url = Deno.env.get('SUPABASE_URL');
  const chave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY');
  if (!url || !chave) return resposta(500, { erro: 'A função está sem a chave de serviço. Veja o passo a passo no README.' });

  const admin = createClient(url, chave, { auth: { autoRefreshToken: false, persistSession: false } });

  // Quem está pedindo: confere o login pelo token enviado pelo navegador.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return resposta(401, { erro: 'Entre no sistema novamente.' });
  const { data: quem, error: erroQuem } = await admin.auth.getUser(token);
  if (erroQuem || !quem?.user) return resposta(401, { erro: 'Sessão expirada. Entre no sistema novamente.' });
  const ator = quem.user.id;

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return resposta(400, { erro: 'Pedido inválido.' });
  }

  try {
    switch (corpo.acao) {
      case 'criar': return resposta(200, await criar(admin, ator, corpo));
      case 'editar': return resposta(200, await editar(admin, ator, corpo));
      case 'senha': return resposta(200, await definirSenha(admin, ator, corpo));
      case 'remover': return resposta(200, await alterarRemocao(admin, ator, corpo, true));
      case 'restaurar': return resposta(200, await alterarRemocao(admin, ator, corpo, false));
      default: return resposta(400, { erro: 'Ação desconhecida.' });
    }
  } catch (erro) {
    return resposta(400, { erro: mensagemErro(erro) });
  }
});
