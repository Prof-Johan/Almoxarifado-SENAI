import { $, abrirModal, modalAberto } from './ui.js';

// Atalhos de teclado (pedido da entrevista: "atalhos do Windows funcionais").
const LISTA = [
  ['/ ou Ctrl+K', 'Ir para a busca da página'],
  ['Alt+N', 'Novo cadastro na página (material, pedido, recebimento...)'],
  ['Ctrl+S', 'Salvar o formulário aberto'],
  ['Enter', 'Confirmar o formulário'],
  ['Esc', 'Fechar a janela aberta'],
  ['?', 'Mostrar esta lista'],
];

const digitando = alvo => alvo.closest('input, textarea, select, [contenteditable]');

export function mostrarAtalhos() {
  abrirModal({
    titulo: 'Atalhos de teclado',
    pequeno: true,
    corpo: `<table class="table tabela-compacta"><tbody>${LISTA.map(([t, d]) => `<tr><td class="nowrap"><kbd>${t}</kbd></td><td>${d}</td></tr>`).join('')}</tbody></table>`,
    rodape: '<button class="btn btn-primary" type="button" data-fechar>Entendi</button>',
  });
}

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    const salvar = $('#modalHost .modal-foot button[type=submit]') || $('#modalHost .modal-foot .btn-primary');
    if (salvar) { e.preventDefault(); salvar.click(); }
    return;
  }
  if (modalAberto()) return;
  if ((e.ctrlKey && e.key.toLowerCase() === 'k') || (e.key === '/' && !digitando(e.target))) {
    const busca = $('#app input[type=search], #app .search');
    if (busca) { e.preventDefault(); busca.focus(); busca.select?.(); }
    return;
  }
  if (e.altKey && e.key.toLowerCase() === 'n') {
    const novo = $('#app [data-acao="novo"]');
    if (novo) { e.preventDefault(); novo.click(); }
    return;
  }
  if (e.key === '?' && !digitando(e.target)) { e.preventDefault(); mostrarAtalhos(); }
});
