import { supabase } from '../lib/supabase.js';
import { $, esc, abrirModal, fecharModal, executando, toast } from '../lib/ui.js';
import { estado, temEmailReal } from '../lib/sessao.js';
import { PERFIS } from '../lib/permissoes.js';

export function abrirMinhaConta() {
  const p = estado.perfil;
  const emailAcesso = estado.usuario?.email || '';
  const fundo = abrirModal({
    titulo: 'Minha conta',
    subtitulo: esc(p.nome),
    pequeno: true,
    corpo: `
      <div class="kv conta-dados">
        <div class="box"><span>Perfil</span><b>${esc(PERFIS[p.perfil]?.rotulo || p.perfil)}</b></div>
        <div class="box"><span>Acesso</span><b>${temEmailReal(emailAcesso) ? esc(emailAcesso) : `Matrícula ${esc(p.matricula || '')}`}</b></div>
        <div class="box"><span>Unidade</span><b>${esc(p.unidade?.nome || 'Não informada')}</b></div>
        <div class="box"><span>Setor</span><b>${esc(p.setor?.nome || 'Não informado')}</b></div>
      </div>
      <p class="small muted">Para mudar nome, e-mail, setor ou perfil, fale com o gestor do almoxarifado.</p>
      <form id="formMinhaSenha" class="form-section" novalidate>
        <h3>Alterar senha</h3>
        <div class="fields">
          <div class="field wide"><label for="mAtual">Senha atual</label><input id="mAtual" type="password" autocomplete="current-password" required></div>
          <div class="field"><label for="mNova">Nova senha</label><input id="mNova" type="password" autocomplete="new-password" minlength="8" required></div>
          <div class="field"><label for="mNova2">Repita a nova senha</label><input id="mNova2" type="password" autocomplete="new-password" minlength="8" required></div>
        </div>
        <p class="form-erro" id="mErro" role="alert" hidden></p>
      </form>`,
    rodape: `<button class="btn btn-ghost" type="button" data-fechar>Fechar</button>
             <button class="btn btn-primary" type="submit" form="formMinhaSenha">Alterar senha</button>`,
  });

  $('#formMinhaSenha', fundo).addEventListener('submit', async e => {
    e.preventDefault();
    const erro = $('#mErro', fundo);
    const falhar = m => { erro.textContent = m; erro.hidden = false; };
    const atual = $('#mAtual', fundo).value;
    const nova = $('#mNova', fundo).value;
    if (!atual) return falhar('Digite a senha atual.');
    if (nova.length < 8) return falhar('A nova senha precisa ter pelo menos 8 caracteres.');
    if (!/[A-Za-z]/.test(nova) || !/\d/.test(nova)) return falhar('Use letras e números na nova senha.');
    if (nova !== $('#mNova2', fundo).value) return falhar('As duas senhas novas não são iguais.');
    if (nova === atual) return falhar('A nova senha precisa ser diferente da atual.');
    erro.hidden = true;
    await executando(e.submitter, async () => {
      // Confirma a senha atual antes de trocar.
      const conferencia = await supabase.auth.signInWithPassword({ email: emailAcesso, password: atual });
      if (conferencia.error) return falhar('A senha atual está incorreta.');
      const { error } = await supabase.auth.updateUser({ password: nova });
      if (error) return falhar(/weak|characters/i.test(error.message) ? 'Senha fraca. Use mais caracteres, misturando letras e números.' : error.message);
      fecharModal(true);
      toast('Senha alterada.');
    });
  });
}
