import { supabase } from '../lib/supabase.js';
import { $, esc, cabecalho, fmtDataHora, erroAmigavel, toast, contraste } from '../lib/ui.js';
import { rotuloPerfil } from '../lib/permissoes.js';
import { ouvir } from '../lib/tempoReal.js';
import { UNIDADES_MEDIDA, CRITICIDADES, TIPOS_ARMAZENAGEM, nomeDeposito } from '../lib/materiais.js';

const POR_PAGINA = 50;

const AREAS = {
  materiais: 'Materiais',
  depositos: 'Depósitos',
  perfis: 'Usuários',
  classes: 'Classes',
  unidades: 'Unidades',
  setores: 'Setores',
  configuracoes: 'Configurações',
};

const ACOES = {
  CRIOU: { rotulo: 'Criou', classe: 'ok' },
  EDITOU: { rotulo: 'Editou', classe: 'blue' },
  REMOVEU: { rotulo: 'Removeu', classe: 'red' },
  RESTAUROU: { rotulo: 'Restaurou', classe: 'low' },
  EXCLUIU: { rotulo: 'Excluiu', classe: 'red' },
};

// Nomes dos campos como aparecem para o usuário.
const CAMPOS = {
  nome: 'Nome',
  email: 'E-mail',
  matricula: 'Matrícula',
  cracha: 'Crachá',
  perfil: 'Perfil',
  unidade_id: 'Unidade',
  setor_id: 'Setor',
  empresa: 'Empresa',
  ativo: 'Situação',
  deve_trocar_senha: 'Troca de senha pendente',
  cor: 'Cor',
  descricao: 'Descrição',
  sigla: 'Sigla',
  valor: 'Valor',
  numero: 'Número',
  removido_em: 'Remoção',
  prn: 'PRN',
  marca: 'Marca',
  classe_id: 'Classe',
  unidade_medida: 'Unidade de controle',
  embalagem_qtd: 'Quantidade na embalagem',
  embalagem_unidade: 'Unidade da embalagem',
  estoque_minimo: 'Estoque mínimo',
  criticidade: 'Criticidade',
  saldo_emergencial: 'Saldo emergencial',
  peso_kg: 'Peso (kg)',
  epi: 'EPI',
  deposito_id: 'Depósito',
  prateleira: 'Prateleira',
  lado: 'Lado',
  andar: 'Andar',
  posicao: 'Posição',
  foto_path: 'Foto',
  fds_path: 'Ficha de segurança',
  relacionados: 'Itens relacionados',
  prateleiras: 'Prateleiras',
  lados: 'Lados',
  andares: 'Andares',
  posicoes: 'Posições por andar',
  tipo_armazenagem: 'Tipo de armazenagem',
  classes_permitidas: 'Classes aceitas',
};

const hoje = () => new Date().toISOString().slice(0, 10);
const diasAtras = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export async function montar(el, ctx) {
  const filtro = { de: diasAtras(30), ate: hoje(), tabela: '', acao: '', pessoa: '' };
  let registros = [];
  let fim = false;
  const nomes = { unidades: new Map(), setores: new Map(), classes: new Map(), depositos: new Map(), materiais: new Map() };

  async function carregarNomes() {
    const respostas = await Promise.all([
      supabase.from('unidades').select('id,nome'),
      supabase.from('setores').select('id,nome'),
      supabase.from('classes').select('id,nome'),
      supabase.from('depositos').select('id,numero,nome'),
      supabase.from('materiais').select('id,codigo').limit(5000),
    ]);
    const erro = respostas.find(r => r.error);
    if (erro) throw erro.error;
    const [u, s, c, d, m] = respostas.map(r => r.data);
    u.forEach(x => nomes.unidades.set(String(x.id), x.nome));
    s.forEach(x => nomes.setores.set(String(x.id), x.nome));
    c.forEach(x => nomes.classes.set(String(x.id), x.nome));
    d.forEach(x => nomes.depositos.set(String(x.id), nomeDeposito(x)));
    m.forEach(x => nomes.materiais.set(String(x.id), x.codigo));
  }

  async function buscar(inicio) {
    let q = supabase.from('auditoria').select('*').order('em', { ascending: false }).range(inicio, inicio + POR_PAGINA - 1);
    if (filtro.de) q = q.gte('em', new Date(filtro.de + 'T00:00:00').toISOString());
    if (filtro.ate) q = q.lte('em', new Date(filtro.ate + 'T23:59:59.999').toISOString());
    if (filtro.tabela) q = q.eq('tabela', filtro.tabela);
    if (filtro.acao) q = q.eq('acao', filtro.acao);
    if (filtro.pessoa) q = q.ilike('usuario_nome', `%${filtro.pessoa.replace(/[%_]/g, '')}%`);
    const { data, error } = await q;
    if (error) throw error;
    fim = data.length < POR_PAGINA;
    return data;
  }

  function valorLegivel(campo, valor) {
    if (valor === null || valor === undefined || valor === '') return '<span class="muted">vazio</span>';
    if (campo === 'ativo') return valor ? 'Ativo' : 'Bloqueado';
    if (campo === 'deve_trocar_senha') return valor ? 'Sim' : 'Não';
    if (campo === 'perfil') return esc(rotuloPerfil(valor));
    if (campo === 'unidade_id') return esc(nomes.unidades.get(String(valor)) || `nº ${valor}`);
    if (campo === 'setor_id') return esc(nomes.setores.get(String(valor)) || `nº ${valor}`);
    if (campo === 'classe_id') return esc(nomes.classes.get(String(valor)) || `nº ${valor}`);
    if (campo === 'deposito_id') return esc(nomes.depositos.get(String(valor)) || `nº ${valor}`);
    if (campo === 'criticidade') return esc(CRITICIDADES[valor]?.rotulo || valor);
    if (campo === 'unidade_medida' || campo === 'embalagem_unidade') return esc(UNIDADES_MEDIDA[valor] ? `${UNIDADES_MEDIDA[valor]} (${valor})` : valor);
    if (campo === 'tipo_armazenagem') return esc(TIPOS_ARMAZENAGEM[valor] || valor);
    if (campo === 'foto_path' || campo === 'fds_path') return 'arquivo enviado';
    if (campo === 'lados') return esc((valor || []).join(' e '));
    if (campo === 'classes_permitidas') return valor?.length ? esc(valor.map(id => nomes.classes.get(String(id)) || id).join(', ')) : 'todas';
    if (campo === 'relacionados') return valor?.length ? esc(valor.map(id => nomes.materiais.get(String(id)) || id).join(', ')) : 'nenhum';
    if (campo === 'cor') return `<span class="cor-amostra" style="background:${esc(valor)};color:${contraste(valor)}">${esc(valor)}</span>`;
    if (campo === 'removido_em') return esc(fmtDataHora(valor));
    if (typeof valor === 'object') return esc(JSON.stringify(valor));
    return esc(valor);
  }

  function mudancas(r) {
    if (r.acao === 'CRIOU') {
      const d = r.depois || {};
      const partes = [];
      if (r.tabela === 'perfis') partes.push(`Perfil ${esc(rotuloPerfil(d.perfil))}`);
      if (r.tabela === 'classes') partes.push(`Cor ${valorLegivel('cor', d.cor)}`);
      if (r.tabela === 'materiais') partes.push(`${esc(d.codigo || '')} · PRN ${esc(d.prn || '')}`);
      if (r.tabela === 'depositos') partes.push(`${d.prateleiras} prateleiras · ${d.andares} andares · ${d.posicoes} posições`);
      return partes.length ? partes.join(' · ') : '<span class="muted">Cadastro criado</span>';
    }
    if (r.acao === 'EXCLUIU') return '<span class="muted">Registro apagado</span>';
    const campos = (r.campos || []).filter(c => c !== 'removido_em' || r.acao === 'EDITOU');
    if (!campos.length) return '<span class="muted">Sem outras alterações</span>';
    return `<ul class="mudancas">${campos.map(c => `<li><b>${esc(CAMPOS[c] || c)}:</b> ${valorLegivel(c, r.antes?.[c])} <span aria-label="para">→</span> ${valorLegivel(c, r.depois?.[c])}</li>`).join('')}</ul>`;
  }

  function nomeRegistro(r) {
    const d = r.depois || r.antes || {};
    if (r.tabela === 'depositos') return esc(nomeDeposito(d));
    return esc(d.nome || d.chave || `Registro ${r.registro_id}`);
  }

  function linhas() {
    if (!registros.length) return '<tr><td colspan="5" class="empty">Nenhuma alteração encontrada neste período.</td></tr>';
    return registros.map(r => `<tr>
      <td class="nowrap">${fmtDataHora(r.em)}</td>
      <td>${esc(r.usuario_nome || 'Sistema')}</td>
      <td><span class="pill ${ACOES[r.acao]?.classe || 'gray'}">${ACOES[r.acao]?.rotulo || esc(r.acao)}</span></td>
      <td><div class="strong">${nomeRegistro(r)}</div><div class="small muted">${AREAS[r.tabela] || esc(r.tabela)}</div></td>
      <td>${mudancas(r)}</td>
    </tr>`).join('');
  }

  function desenharTabela() {
    $('#corpoHistorico', el).innerHTML = linhas();
    $('#maisHistorico', el).hidden = fim;
  }

  async function aplicar() {
    try {
      registros = await buscar(0);
      desenharTabela();
    } catch (erro) {
      toast(erroAmigavel(erro), 'erro');
    }
  }

  await carregarNomes();
  registros = await buscar(0);

  el.innerHTML = `
    ${cabecalho('Histórico de alterações', 'Quem criou, editou, removeu ou restaurou cada cadastro. Este registro não pode ser alterado nem apagado.')}
    <section class="card card-pad">
      <form class="toolbar filtros" id="formFiltro">
        <label class="filtro-campo">De<input type="date" id="fDe" value="${filtro.de}"></label>
        <label class="filtro-campo">Até<input type="date" id="fAte" value="${filtro.ate}"></label>
        <label class="filtro-campo">Área
          <select id="fTabela"><option value="">Todas</option>${Object.entries(AREAS).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
        </label>
        <label class="filtro-campo">Ação
          <select id="fAcao"><option value="">Todas</option>${Object.entries(ACOES).filter(([v]) => v !== 'EXCLUIU').map(([v, a]) => `<option value="${v}">${a.rotulo}</option>`).join('')}</select>
        </label>
        <label class="filtro-campo filtro-largo">Quem fez<input type="search" id="fPessoa" placeholder="Nome da pessoa"></label>
        <button class="btn btn-primary" type="submit">Filtrar</button>
      </form>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Data e hora</th><th>Quem fez</th><th>Ação</th><th>Onde</th><th>O que mudou</th></tr></thead>
          <tbody id="corpoHistorico">${linhas()}</tbody>
        </table>
      </div>
      <div class="mais"><button class="btn btn-light" type="button" id="maisHistorico" ${fim ? 'hidden' : ''}>Carregar mais</button></div>
    </section>`;

  $('#formFiltro', el).addEventListener('submit', e => {
    e.preventDefault();
    filtro.de = $('#fDe', el).value;
    filtro.ate = $('#fAte', el).value;
    filtro.tabela = $('#fTabela', el).value;
    filtro.acao = $('#fAcao', el).value;
    filtro.pessoa = $('#fPessoa', el).value.trim();
    aplicar();
  });

  // Tempo real: alterações novas aparecem no topo, mantendo os filtros.
  ctx.aoSair(ouvir(['auditoria'], async () => {
    if (!ctx.ativa()) return;
    try {
      await carregarNomes();
      const quantos = Math.max(registros.length, POR_PAGINA);
      const atualizados = [];
      for (let inicio = 0; inicio < quantos; inicio += POR_PAGINA) {
        const parte = await buscar(inicio);
        atualizados.push(...parte);
        if (parte.length < POR_PAGINA) break;
      }
      registros = atualizados;
      desenharTabela();
    } catch { /* tenta de novo na próxima mudança */ }
  }));

  $('#maisHistorico', el).addEventListener('click', async e => {
    const botao = e.currentTarget;
    botao.disabled = true;
    try {
      registros = registros.concat(await buscar(registros.length));
      desenharTabela();
    } catch (erro) {
      toast(erroAmigavel(erro), 'erro');
    } finally {
      botao.disabled = false;
    }
  });
}
