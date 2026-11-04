export const $ = (seletor, base = document) => base.querySelector(seletor);
export const $$ = (seletor, base = document) => [...base.querySelectorAll(seletor)];

export const esc = valor => String(valor ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export const fmtDataHora = d => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
export const fmtData = d => (d ? new Date(d).toLocaleDateString('pt-BR') : '');

export function toast(mensagem, tipo = 'ok') {
  const host = $('#toastHost');
  if (!host) return;
  const item = document.createElement('div');
  item.className = 'toast' + (tipo === 'erro' ? ' error' : '');
  item.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
  item.textContent = mensagem;
  host.appendChild(item);
  setTimeout(() => item.remove(), tipo === 'erro' ? 6500 : 4200);
}

// Cor do texto que fica legível sobre a cor de fundo.
export function contraste(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '#13283C';
  const canais = [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const luz = 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
  return luz > 0.18 ? '#152432' : '#ffffff';
}

export function pillClasse(classe) {
  if (!classe) return '<span class="pill gray">Sem classe</span>';
  const borda = classe.cor?.toUpperCase() === '#FFFFFF' ? '#9aabb9' : classe.cor;
  return `<span class="cat-pill" style="background:${esc(classe.cor)};color:${contraste(classe.cor)};border-color:${esc(borda)}">${esc(classe.nome)}</span>`;
}

// ---------------------------------------------------------------------
// Janela (modal). Não fecha ao clicar fora, para não perder o que foi
// digitado. Fechar com algo preenchido pede confirmação.
// ---------------------------------------------------------------------
function encerrarModalAtual() {
  const fundo = $('#modalHost .modal-backdrop');
  if (!fundo) return;
  (fundo._aoFechar || []).forEach(fn => { try { fn(); } catch { /* ignora */ } });
  fundo._aoFechar = [];
}

export function abrirModal({ titulo, subtitulo = '', corpo, rodape = '', pequeno = false, largo = false, aoFechar }) {
  encerrarModalAtual();
  const host = $('#modalHost');
  host.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal ${pequeno ? 'small' : ''} ${largo ? 'largo' : ''}" role="dialog" aria-modal="true" aria-labelledby="modalTitulo">
        <div class="modal-head">
          <div><div class="modal-title" id="modalTitulo">${titulo}</div>${subtitulo ? `<p>${subtitulo}</p>` : ''}</div>
          <button class="close" type="button" data-fechar aria-label="Fechar">×</button>
        </div>
        <div class="modal-body">${corpo}</div>
        ${rodape ? `<div class="modal-foot">${rodape}</div>` : ''}
      </div>
    </div>`;
  const fundo = host.firstElementChild;
  fundo._aoFechar = aoFechar ? [aoFechar] : [];
  fundo.addEventListener('input', e => { if (!e.target.closest('[data-nao-altera]')) fundo.dataset.alterado = '1'; });
  fundo.addEventListener('click', e => { if (e.target.closest('[data-fechar]')) fecharModal(); });
  setTimeout(() => $('input:not([type=hidden]):not([disabled]):not([type=checkbox]), select:not([disabled]), textarea', fundo)?.focus(), 40);
  return fundo;
}

// Registra algo para fazer quando a janela fechar (por exemplo, parar de ouvir mudanças).
export function aoFecharModal(fundo, fn) {
  (fundo._aoFechar ||= []).push(fn);
}

export function fecharModal(forcar = false) {
  const fundo = $('#modalHost .modal-backdrop');
  if (!fundo) return true;
  if (!forcar && fundo.dataset.alterado && !window.confirm('Descartar o que foi preenchido?')) return false;
  encerrarModalAtual();
  $('#modalHost').innerHTML = '';
  return true;
}

export const modalAberto = () => Boolean($('#modalHost .modal-backdrop'));

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && modalAberto()) fecharModal();
});

// Janela de confirmação de operação concluída.
export function mostrarConcluido(titulo, mensagemHtml) {
  abrirModal({
    titulo,
    corpo: `<div class="concluido"><div class="concluido-marca" aria-hidden="true">✓</div><div>${mensagemHtml}</div></div>`,
    rodape: '<button class="btn btn-primary" type="button" data-fechar>Entendi</button>',
    pequeno: true,
  });
}

// Desativa o botão enquanto a tarefa roda.
export async function executando(botao, tarefa) {
  const texto = botao?.textContent;
  if (botao) { botao.disabled = true; botao.textContent = 'Aguarde...'; }
  try {
    return await tarefa();
  } finally {
    if (botao && document.body.contains(botao)) { botao.disabled = false; botao.textContent = texto; }
  }
}

// Traduz os erros do banco para mensagens que o usuário entende.
export function erroAmigavel(erro) {
  const msg = String(erro?.message || erro || '');
  const codigo = erro?.code || '';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
  if (codigo === '23505' || /duplicate key/i.test(msg)) {
    if (/classes_nome/.test(msg)) return 'Já existe uma classe com esse nome.';
    if (/materiais_prn/.test(msg)) return 'Já existe um material com este PRN.';
    if (/materiais_posicao/.test(msg)) return 'Essa posição já está ocupada por outro material. Escolha outra ou use "Sugerir posição livre".';
    if (/depositos_numero/.test(msg)) return 'Já existe um depósito com esse número nesta unidade.';
    if (/unidades_nome/.test(msg)) return 'Já existe uma unidade com esse nome.';
    if (/setores_nome/.test(msg)) return 'Já existe um setor com esse nome.';
    return 'Já existe um cadastro com esses dados.';
  }
  if (codigo === '42501' || /row-level security|permission denied/i.test(msg)) return 'Seu perfil não tem permissão para esta ação.';
  if (codigo === '23514' || /check constraint/i.test(msg)) return 'Algum campo está fora do formato esperado.';
  return msg || 'Não foi possível concluir a operação.';
}

// Senha provisória sem caracteres que se confundem (0/O, 1/l).
// Sempre tem pelo menos uma letra e um número.
export function gerarSenha(tamanho = 10) {
  const letras = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const numeros = '23456789';
  const todos = letras + numeros;
  const sorteio = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const chars = [letras[sorteio(letras.length)], numeros[sorteio(numeros.length)]];
  while (chars.length < tamanho) chars.push(todos[sorteio(todos.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = sorteio(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function cabecalho(titulo, descricao = '', acao = '') {
  return `<div class="pagehead"><div><h1>${titulo}</h1>${descricao ? `<p class="lead">${descricao}</p>` : ''}</div>${acao ? `<div class="pagehead-acao">${acao}</div>` : ''}</div>`;
}
