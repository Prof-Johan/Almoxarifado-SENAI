import { supabase } from '../lib/supabase.js';
import { $, esc, executando } from '../lib/ui.js';
import { entrar, resolverEmail, temEmailReal, estado, sair, registrarSessao } from '../lib/sessao.js';

const raiz = () => $('#raiz');

function cartao(conteudo) {
  return `<div class="auth-layer"><main class="auth-card">
    <img class="auth-logo-senai" src="/senai-logo.png" alt="SENAI" width="150" height="43">
    ${conteudo}
  </main></div>`;
}

function campoSenha(id, rotulo, autocomplete, placeholder = '') {
  return `<div class="auth-field">
    <label for="${id}">${rotulo}</label>
    <div class="senha-campo">
      <input id="${id}" type="password" autocomplete="${autocomplete}" required minlength="${autocomplete === 'new-password' ? 8 : 1}" placeholder="${placeholder}">
      <button type="button" class="senha-ver" data-ver="${id}" aria-label="Mostrar senha">Mostrar</button>
    </div>
  </div>`;
}

function ligarMostrarSenha(base) {
  base.addEventListener('click', e => {
    const botao = e.target.closest('[data-ver]');
    if (!botao) return;
    const campo = $('#' + botao.dataset.ver);
    const mostrar = campo.type === 'password';
    campo.type = mostrar ? 'text' : 'password';
    botao.textContent = mostrar ? 'Ocultar' : 'Mostrar';
    botao.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
  });
}

function mostrarErro(id, mensagem) {
  const el = $('#' + id);
  el.textContent = mensagem;
  el.hidden = !mensagem;
}

export function mostrarLogin(aviso = '', aoEntrar) {
  raiz().innerHTML = cartao(`
    <h1 class="auth-heading">Entrar no almoxarifado</h1>
    <p class="auth-description">Use o e-mail ou a matrícula que o gestor cadastrou para você.</p>
    ${aviso ? `<div class="notice auth-aviso" role="status">${esc(aviso)}</div>` : ''}
    <form id="formLogin" class="auth-fields" novalidate>
      <div class="auth-field">
        <label for="login">E-mail ou matrícula</label>
        <input id="login" autocomplete="username" autocapitalize="none" spellcheck="false" required>
      </div>
      ${campoSenha('senha', 'Senha', 'current-password')}
      <p class="auth-erro" id="erroLogin" role="alert" hidden></p>
      <button class="btn btn-primary auth-btn" type="submit">Entrar</button>
    </form>
    <button class="auth-link" type="button" id="abrirEsqueci">Esqueci minha senha</button>
    <p class="auth-footer">Não tem acesso? Peça ao gestor do almoxarifado para criar a sua conta.</p>
  `);
  ligarMostrarSenha($('.auth-card'));
  setTimeout(() => $('#login')?.focus(), 30);

  $('#formLogin').addEventListener('submit', async e => {
    e.preventDefault();
    const login = $('#login').value.trim();
    const senha = $('#senha').value;
    if (!login || !senha) return mostrarErro('erroLogin', 'Preencha o e-mail ou a matrícula e a senha.');
    mostrarErro('erroLogin', '');
    await executando(e.submitter || $('#formLogin button[type=submit]'), async () => {
      try {
        await entrar(login, senha);
        await aoEntrar?.();
      } catch (erro) {
        mostrarErro('erroLogin', erro.message);
        $('#senha').select();
      }
    });
  });

  $('#abrirEsqueci').addEventListener('click', () => mostrarEsqueci(aoEntrar));
}

function mostrarEsqueci(aoEntrar) {
  raiz().innerHTML = cartao(`
    <h1 class="auth-heading">Recuperar a senha</h1>
    <p class="auth-description">Informe o e-mail ou a matrícula. Se a conta tiver e-mail cadastrado, você recebe um link para criar uma nova senha.</p>
    <form id="formEsqueci" class="auth-fields" novalidate>
      <div class="auth-field">
        <label for="loginEsqueci">E-mail ou matrícula</label>
        <input id="loginEsqueci" autocomplete="username" autocapitalize="none" spellcheck="false" required>
      </div>
      <p class="auth-erro" id="erroEsqueci" role="alert" hidden></p>
      <div class="notice" id="okEsqueci" role="status" hidden></div>
      <button class="btn btn-primary auth-btn" type="submit">Enviar link</button>
    </form>
    <button class="auth-link" type="button" id="voltarLogin">Voltar para o login</button>
  `);
  setTimeout(() => $('#loginEsqueci')?.focus(), 30);
  $('#voltarLogin').addEventListener('click', () => mostrarLogin('', aoEntrar));

  $('#formEsqueci').addEventListener('submit', async e => {
    e.preventDefault();
    const login = $('#loginEsqueci').value.trim();
    mostrarErro('erroEsqueci', '');
    $('#okEsqueci').hidden = true;
    if (!login) return mostrarErro('erroEsqueci', 'Informe o e-mail ou a matrícula.');
    await executando(e.submitter, async () => {
      try {
        const email = await resolverEmail(login);
        if (email && !temEmailReal(email)) {
          return mostrarErro('erroEsqueci', 'Esta conta não tem e-mail cadastrado. Peça ao gestor uma senha provisória.');
        }
        if (email) {
          const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
          if (error && !/rate limit/i.test(error.message)) throw error;
          if (error) return mostrarErro('erroEsqueci', 'Muitos pedidos em pouco tempo. Aguarde alguns minutos e tente de novo.');
        }
        // A mesma mensagem aparece exista ou não a conta, para não revelar quem está cadastrado.
        const ok = $('#okEsqueci');
        ok.textContent = 'Se houver uma conta com esse acesso, o link foi enviado. Confira também a caixa de spam.';
        ok.hidden = false;
      } catch (erro) {
        mostrarErro('erroEsqueci', erro.message || 'Não foi possível enviar o link.');
      }
    });
  });
}

// motivo: 'primeiro' (senha provisória ou convite) ou 'recuperacao'.
export function mostrarDefinirSenha(motivo, aoConcluir) {
  const nome = estado.perfil?.nome?.split(' ')[0] || '';
  const titulo = motivo === 'recuperacao' ? 'Criar uma nova senha' : `Boas-vindas${nome ? ', ' + esc(nome) : ''}`;
  const texto = motivo === 'recuperacao'
    ? 'Escolha a nova senha da sua conta.'
    : 'Antes de começar, crie a sua senha pessoal. A senha provisória deixa de valer.';
  raiz().innerHTML = cartao(`
    <h1 class="auth-heading">${titulo}</h1>
    <p class="auth-description">${texto}</p>
    <form id="formNovaSenha" class="auth-fields" novalidate>
      ${campoSenha('novaSenha', 'Nova senha', 'new-password', 'Pelo menos 8 caracteres')}
      ${campoSenha('novaSenha2', 'Repita a nova senha', 'new-password')}
      <p class="auth-dica">Use letras e números. Evite datas de aniversário e o próprio nome.</p>
      <p class="auth-erro" id="erroNovaSenha" role="alert" hidden></p>
      <button class="btn btn-primary auth-btn" type="submit">Salvar senha e entrar</button>
    </form>
    <button class="auth-link" type="button" id="sairDefinir">Sair</button>
  `);
  ligarMostrarSenha($('.auth-card'));
  setTimeout(() => $('#novaSenha')?.focus(), 30);
  $('#sairDefinir').addEventListener('click', () => sair());

  $('#formNovaSenha').addEventListener('submit', async e => {
    e.preventDefault();
    const senha = $('#novaSenha').value;
    const repetida = $('#novaSenha2').value;
    if (senha.length < 8) return mostrarErro('erroNovaSenha', 'A senha precisa ter pelo menos 8 caracteres.');
    if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return mostrarErro('erroNovaSenha', 'Use letras e números na senha.');
    if (senha !== repetida) return mostrarErro('erroNovaSenha', 'As duas senhas não são iguais.');
    mostrarErro('erroNovaSenha', '');
    await executando(e.submitter, async () => {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) {
        const mensagem = /different from the old|same_password/i.test(error.message + error.code)
          ? 'A nova senha precisa ser diferente da senha atual.'
          : /weak|characters/i.test(error.message) ? 'Senha fraca. Use mais caracteres, misturando letras e números.' : error.message;
        return mostrarErro('erroNovaSenha', mensagem);
      }
      await supabase.rpc('confirmar_troca_senha');
      if (estado.perfil) estado.perfil.deve_trocar_senha = false;
      estado.recuperacao = false;
      await registrarSessao().catch(() => {});
      await aoConcluir?.();
    });
  });
}

export function mostrarSemConfiguracao() {
  raiz().innerHTML = cartao(`
    <h1 class="auth-heading">Falta configurar o Supabase</h1>
    <p class="auth-description">O sistema não encontrou as variáveis <b>VITE_SUPABASE_URL</b> e <b>VITE_SUPABASE_ANON_KEY</b>.</p>
    <div class="notice">Na Vercel, cadastre as duas em Settings, Environment Variables, e faça um novo deploy. No computador, crie o arquivo .env.local a partir do .env.example.</div>
  `);
}
