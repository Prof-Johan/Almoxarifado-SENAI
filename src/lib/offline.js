// Modo offline: o app fica instalado no aparelho e as consultas usam os
// últimos dados salvos quando a internet cai. Gravar exige conexão.
import { registerSW } from 'virtual:pwa-register';

export function iniciarOffline() {
  if ('serviceWorker' in navigator) registerSW({ immediate: true });
  const atualizar = () => {
    let faixa = document.getElementById('faixaOffline');
    if (navigator.onLine) { faixa?.remove(); return; }
    if (!faixa) {
      faixa = document.createElement('div');
      faixa.id = 'faixaOffline';
      faixa.className = 'faixa-offline';
      faixa.setAttribute('role', 'status');
      faixa.textContent = 'Sem internet. Você está vendo os últimos dados salvos neste aparelho. Para gravar, espere a conexão voltar.';
      document.body.prepend(faixa);
    }
  };
  window.addEventListener('online', atualizar);
  window.addEventListener('offline', atualizar);
  atualizar();
}

// Ao sair, apaga os dados guardados, porque o aparelho pode ser compartilhado.
export async function limparDadosOffline() {
  try {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter(n => n.startsWith('almox-')).map(n => caches.delete(n)));
  } catch { /* sem cache */ }
  localStorage.removeItem('almox-perfil');
}
