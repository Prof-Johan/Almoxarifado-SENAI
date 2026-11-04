import { supabase } from './supabase.js';
import { ouvir } from './tempoReal.js';

export const estado = { usuario: null, perfil: null, recuperacao: false };

const CHAVE_SESSAO = 'almox-sessao-id';
const CHAVE_AVISO = 'almox-aviso';

export const SEM_EMAIL = '@sem-email.local';
export const temEmailReal = email => Boolean(email) && !String(email).endsWith(SEM_EMAIL);

function traduzirErroLogin(erro) {
  const msg = String(erro?.message || '');
  const codigo = erro?.code || '';
  if (codigo === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return 'E-mail, matrícula ou senha incorretos.';
  if (codigo === 'user_banned' || /banned/i.test(msg)) return 'Conta bloqueada. Procure o gestor do almoxarifado.';
  if (codigo === 'email_not_confirmed' || /not confirmed/i.test(msg)) return 'Acesso ainda não confirmado. Use o link do convite enviado por e-mail.';
  if (/fetch|network/i.test(msg)) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
  return msg || 'Não foi possível entrar.';
}

// Aceita e-mail ou matrícula.
export async function resolverEmail(login) {
  const texto = String(login || '').trim();
  if (texto.includes('@')) return texto.toLowerCase();
  const { data, error } = await supabase.rpc('email_para_login', { p_login: texto });
  if (error) throw new Error(traduzirErroLogin(error));
  return data || '';
}

export async function entrar(login, senha) {
  const email = await resolverEmail(login);
  if (!email) throw new Error('E-mail, matrícula ou senha incorretos.');
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) throw new Error(traduzirErroLogin(error));
  await registrarSessao();
  // Encerra as sessões desta conta em outros aparelhos.
  supabase.auth.signOut({ scope: 'others' }).catch(() => {});
}

export async function carregarPerfil() {
  const { data: { user } } = await supabase.auth.getUser();
  estado.usuario = user || null;
  if (!user) { estado.perfil = null; return null; }
  const { data, error } = await supabase
    .from('perfis')
    .select('*, unidade:unidades(nome), setor:setores(nome)')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw error;
  estado.perfil = data;
  return data;
}

function descreverDispositivo() {
  const ua = navigator.userAgent;
  const sistema = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : 'Outro';
  const navegador = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return `${navegador} no ${sistema}`;
}

export async function registrarSessao() {
  const id = crypto.randomUUID();
  localStorage.setItem(CHAVE_SESSAO, id);
  const { error } = await supabase.rpc('registrar_sessao', { p_sessao: id, p_dispositivo: descreverDispositivo() });
  if (error) throw error;
}

// 'ok', 'outra_sessao', 'sem_acesso' ou 'erro' (sem conexão, por exemplo).
export async function verificarSessao() {
  const id = localStorage.getItem(CHAVE_SESSAO);
  if (!id) {
    try { await registrarSessao(); return 'ok'; } catch { return 'erro'; }
  }
  const { data, error } = await supabase.rpc('situacao_sessao', { p_sessao: id });
  if (error) return 'erro';
  return data;
}

export async function sair(aviso = '') {
  localStorage.removeItem(CHAVE_SESSAO);
  if (aviso) sessionStorage.setItem(CHAVE_AVISO, aviso);
  try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* já saiu */ }
  window.location.replace(window.location.pathname);
}

export function lerAviso() {
  const aviso = sessionStorage.getItem(CHAVE_AVISO) || '';
  sessionStorage.removeItem(CHAVE_AVISO);
  return aviso;
}

// Confere na hora em que a conta entra em outro aparelho ou é bloqueada
// (tempo real), a cada 30 segundos e ao voltar para a aba.
export function vigiarSessao() {
  let checando = false;
  const checar = async () => {
    if (!estado.perfil || checando) return;
    checando = true;
    try {
      const situacao = await verificarSessao();
      if (situacao === 'outra_sessao') await sair('Sua conta foi acessada em outro aparelho. Por segurança, esta sessão foi encerrada.');
      if (situacao === 'sem_acesso') await sair('Sua conta foi bloqueada ou removida. Procure o gestor do almoxarifado.');
    } finally {
      checando = false;
    }
  };
  ouvir(['sessoes_ativas', 'perfis'], (_t, mudancas) => {
    const meuId = estado.perfil?.id;
    if (meuId && mudancas.some(x => [x.novo?.usuario_id, x.novo?.id, x.antigo?.usuario_id, x.antigo?.id].includes(meuId))) checar();
  });
  setInterval(checar, 30000);
  window.addEventListener('focus', checar);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checar(); });
}
