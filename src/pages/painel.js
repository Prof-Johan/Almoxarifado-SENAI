import { supabase } from '../lib/supabase.js';
import { esc, cabecalho, pillClasse } from '../lib/ui.js';
import { PERFIS, nivel } from '../lib/permissoes.js';

async function contar(tabela, filtro = q => q) {
  const { count, error } = await filtro(supabase.from(tabela).select('*', { count: 'exact', head: true }));
  if (error) throw error;
  return count || 0;
}

export async function montar(el, { perfil, navegar }) {
  const gestor = nivel(perfil.perfil) >= 4;
  const [classes, usuariosAtivos, unidades] = await Promise.all([
    supabase.from('classes').select('id,nome,cor,numero').is('removido_em', null).order('numero'),
    gestor ? contar('perfis', q => q.is('removido_em', null).eq('ativo', true)) : Promise.resolve(null),
    contar('unidades', q => q.is('removido_em', null)),
  ]);
  if (classes.error) throw classes.error;
  const listaClasses = classes.data;
  const primeiroNome = esc(perfil.nome.split(' ')[0]);

  el.innerHTML = `
    ${cabecalho(`Olá, ${primeiroNome}`, `Você entrou como <b>${esc(PERFIS[perfil.perfil].rotulo)}</b>. ${esc(PERFIS[perfil.perfil].descricao)}`)}
    <div class="painel-numeros">
      <button type="button" class="card stat stat-link" data-ir="classes">
        <div class="k">Classes de materiais</div><div class="v">${listaClasses.length}</div><div class="n">Cores usadas nas etiquetas</div>
      </button>
      ${gestor ? `<button type="button" class="card stat stat-link" data-ir="usuarios">
        <div class="k">Usuários ativos</div><div class="v">${usuariosAtivos}</div><div class="n">Com acesso liberado</div>
      </button>` : ''}
      ${gestor ? `<button type="button" class="card stat stat-link" data-ir="cadastros">
        <div class="k">Unidades</div><div class="v">${unidades}</div><div class="n">Filiais cadastradas</div>
      </button>` : ''}
    </div>

    <section class="card card-pad painel-bloco">
      <h2 class="section-title">Classes em uso</h2>
      <p class="section-sub">Cada material vai receber uma destas classes no cadastro. A cor aparece na etiqueta.</p>
      <div class="painel-classes">${listaClasses.map(pillClasse).join('') || '<span class="muted">Nenhuma classe cadastrada.</span>'}</div>
    </section>

    <section class="card card-pad painel-bloco">
      <h2 class="section-title">O que vem a seguir</h2>
      <p class="section-sub">Este é o primeiro módulo do sistema. As próximas entregas, nesta ordem:</p>
      <ol class="proximas">
        <li><b>Materiais e etiquetas.</b> Cadastro com PRN, classe, endereço no depósito e etiqueta com QR.</li>
        <li><b>Recebimento.</b> Conferência com foto da nota fiscal, checklist e registro de divergências.</li>
        <li><b>Pedidos e retirada.</b> Pedido pelo setor, separação e confirmação por crachá ou foto.</li>
        <li><b>Relatórios e modo offline.</b> Exportação para Excel, relatório semanal e uso sem internet.</li>
      </ol>
    </section>`;

  el.addEventListener('click', e => {
    const alvo = e.target.closest('[data-ir]');
    if (alvo) navegar(alvo.dataset.ir);
  });
}
