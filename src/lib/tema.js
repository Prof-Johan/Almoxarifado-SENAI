// Modo noturno. A escolha fica salva neste aparelho. Sem escolha,
// segue a configuração do sistema (claro ou escuro).
const CHAVE = 'almox-tema';

export function temaAtual() {
  const salvo = localStorage.getItem(CHAVE);
  if (salvo === 'escuro' || salvo === 'claro') return salvo;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';
}

export function aplicarTema(tema = temaAtual()) {
  document.documentElement.dataset.tema = tema;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', tema === 'escuro' ? '#0d1626' : '#2957a4');
  document.querySelectorAll('[data-alternar-tema]').forEach(botao => {
    botao.textContent = tema === 'escuro' ? 'Modo claro' : 'Modo noturno';
    botao.setAttribute('aria-pressed', String(tema === 'escuro'));
  });
}

export function alternarTema() {
  const novo = temaAtual() === 'escuro' ? 'claro' : 'escuro';
  localStorage.setItem(CHAVE, novo);
  aplicarTema(novo);
}

// Qualquer botão com data-alternar-tema troca o modo.
document.addEventListener('click', e => {
  if (e.target.closest('[data-alternar-tema]')) alternarTema();
});
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  if (!localStorage.getItem(CHAVE)) aplicarTema();
});
