import { supabase } from '../lib/supabase.js';
import { esc, cabecalho, pillClasse } from '../lib/ui.js';
import { PERFIS, nivel } from '../lib/permissoes.js';
import { buscarTodos } from '../lib/dados.js';
import { ouvir } from '../lib/tempoReal.js';
import { codigoLocalizacao, situacaoEstoque, etiquetaPendente, fmtQtd } from '../lib/materiais.js';

async function contar(tabela, filtro = q => q) {
  const { count, error } = await filtro(supabase.from(tabela).select('*', { count: 'exact', head: true }));
  if (error) throw error;
  return count || 0;
}

export async function montar(el, ctx) {
  const { perfil, navegar } = ctx;
  const gestor = nivel(perfil.perfil) >= 4;
  const operador = nivel(perfil.perfil) >= 3;

  async function desenhar() {
    const [classesR, depositosR, materiais, etiquetas, usuariosAtivos] = await Promise.all([
      supabase.from('classes').select('id,nome,cor,numero,removido_em').order('numero'),
      supabase.from('depositos').select('id,numero').is('removido_em', null),
      buscarTodos(() => supabase.from('materiais').select('*').is('removido_em', null).order('id')),
      buscarTodos(() => supabase.from('etiquetas').select('material_id,dados').order('material_id')),
      gestor ? contar('perfis', q => q.is('removido_em', null).eq('ativo', true)) : Promise.resolve(null),
    ]);
    if (classesR.error) throw classesR.error;
    if (depositosR.error) throw depositosR.error;
    if (!ctx.ativa()) return;
    const classes = classesR.data;
    const porClasse = new Map(classes.map(c => [c.id, c]));
    const porDeposito = new Map(depositosR.data.map(d => [d.id, d]));
    const porEtiqueta = new Map(etiquetas.map(e => [e.material_id, e]));
    const completos = materiais.map(m => {
      const c = { ...m, classe: porClasse.get(m.classe_id), etiqueta: porEtiqueta.get(m.id) };
      c.local = codigoLocalizacao(porDeposito.get(m.deposito_id)?.numero, m.prateleira, m.lado, m.andar, m.posicao);
      c.situacao = situacaoEstoque(c);
      return c;
    });
    const baixos = completos.filter(m => m.situacao.id !== 'ok');
    const pendentes = completos.filter(m => etiquetaPendente(m)).length;
    const classesAtivas = classes.filter(c => !c.removido_em);
    const primeiroNome = esc(perfil.nome.split(' ')[0]);
    const cartao = (ir, rotulo, valor, nota, alerta = false) => `<button type="button" class="card stat stat-link ${alerta && valor ? 'stat-alerta' : ''}" data-ir="${ir}">
      <div class="k">${rotulo}</div><div class="v">${valor}</div><div class="n">${nota}</div></button>`;

    el.innerHTML = `
      ${cabecalho(`Olá, ${primeiroNome}`, `Você entrou como <b>${esc(PERFIS[perfil.perfil].rotulo)}</b>. ${esc(PERFIS[perfil.perfil].descricao)}`)}
      <div class="painel-numeros">
        ${cartao('materiais', 'Materiais', completos.length, 'Cadastrados e ativos')}
        ${cartao('materiais', 'Estoque baixo', baixos.length, 'No mínimo, no emergencial ou zerados', true)}
        ${operador ? cartao('materiais', 'Etiquetas a reimprimir', pendentes, 'Novas ou com dados alterados', true) : ''}
        ${gestor ? cartao('usuarios', 'Usuários ativos', usuariosAtivos, 'Com acesso liberado') : ''}
      </div>

      ${!depositosR.data.length ? `<section class="card card-pad painel-bloco">
        <h2 class="section-title">Primeiro passo: cadastrar os depósitos</h2>
        <p class="section-sub">Os materiais precisam de um endereço. Cadastre os depósitos com as prateleiras, os lados, os andares e as posições.</p>
        <p style="margin-top:12px"><button class="btn btn-primary" type="button" data-ir="depositos">Ir para Depósitos</button></p>
      </section>` : ''}

      ${baixos.length ? `<section class="card card-pad painel-bloco">
        <h2 class="section-title">Para repor</h2>
        <p class="section-sub">Materiais no estoque mínimo ou abaixo dele.</p>
        <div class="table-wrap"><table class="table tabela-compacta">
          <thead><tr><th>Material</th><th>Localização</th><th>Saldo</th><th>Mínimo</th><th>Situação</th></tr></thead>
          <tbody>${baixos.sort((a, b) => a.saldo - b.saldo).slice(0, 8).map(m => `<tr>
            <td><button type="button" class="link-material" data-material="${esc(m.codigo)}"><span class="barra-classe" style="background:${esc(m.classe?.cor || '#ccc')}"></span><span><b>${esc(m.nome)}</b><span class="small muted">${esc(m.codigo)}</span></span></button></td>
            <td><span class="codigo-local">${esc(m.local)}</span></td>
            <td class="nowrap">${fmtQtd(m.saldo)} ${esc(m.unidade_medida)}</td><td>${fmtQtd(m.estoque_minimo)}</td>
            <td><span class="pill ${m.situacao.classe}">${m.situacao.rotulo}</span></td></tr>`).join('')}</tbody>
        </table></div>
      </section>` : ''}

      <section class="card card-pad painel-bloco">
        <h2 class="section-title">Classes em uso</h2>
        <p class="section-sub">A cor da classe vai para a etiqueta do material.</p>
        <div class="painel-classes">${classesAtivas.map(pillClasse).join('') || '<span class="muted">Nenhuma classe cadastrada.</span>'}</div>
      </section>

      <section class="card card-pad painel-bloco">
        <h2 class="section-title">O que vem a seguir</h2>
        <p class="section-sub">Materiais e etiquetas já estão no sistema. As próximas entregas, nesta ordem:</p>
        <ol class="proximas">
          <li><b>Recebimento.</b> Conferência com foto da nota fiscal, checklist e registro de divergências.</li>
          <li><b>Pedidos e retirada.</b> Pedido pelo setor, separação e confirmação por crachá ou foto.</li>
          <li><b>Relatórios e modo offline.</b> Exportação para Excel, relatório semanal, rotatividade e uso sem internet.</li>
        </ol>
      </section>`;
  }

  await desenhar();

  el.addEventListener('click', e => {
    const material = e.target.closest('[data-material]');
    if (material) return navegar(`materiais/${encodeURIComponent(material.dataset.material)}`);
    const alvo = e.target.closest('[data-ir]');
    if (alvo) navegar(alvo.dataset.ir);
  });

  ctx.aoSair(ouvir(['materiais', 'classes', 'depositos', 'etiquetas', 'perfis'], async () => {
    if (ctx.ativa()) await desenhar();
  }));
}
