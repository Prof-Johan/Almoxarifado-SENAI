import './style.css';
import './app.css';
import { supabase, configurado, tipoLinkInicial } from './lib/supabase.js';
import { $, esc, erroAmigavel, fecharModal, modalAberto } from './lib/ui.js';
import { estado, carregarPerfil, verificarSessao, sair, lerAviso, vigiarSessao } from './lib/sessao.js';
import { nivel, rotuloPerfil } from './lib/permissoes.js';
import { mostrarLogin, mostrarDefinirSenha, mostrarSemConfiguracao } from './pages/acesso.js';
import * as painel from './pages/painel.js';
import * as usuarios from './pages/usuarios.js';
import * as classes from './pages/classes.js';
import * as cadastros from './pages/cadastros.js';
import * as historico from './pages/historico.js';
import { abrirMinhaConta } from './pages/conta.js';

// Páginas e o nível mínimo de perfil para ver cada uma.
const ROTAS = {
  painel: { rotulo: 'Painel', titulo: 'Visão geral', nivel: 1, pagina: painel },
  classes: { rotulo: 'Classes e cores', titulo: 'Classes de materiais', nivel: 1, pagina: classes },
  usuarios: { rotulo: 'Usuários', titulo: 'Usuários e acessos', nivel: 4, pagina: usuarios },
  cadastros: { rotulo: 'Unidades e setores', titulo: 'Unidades e setores', nivel: 4, pagina: cadastros },
  historico: { rotulo: 'Histórico', titulo: 'Histórico de alterações', nivel: 4, pagina: historico },
};

const rotasPermitidas = () => Object.entries(ROTAS).filter(([, r]) => nivel(estado.perfil?.perfil) >= r.nivel);

function rotaAtual() {
  const nome = (window.location.hash.match(/^#\/([\w-]+)/) || [])[1];
  const permitida = rotasPermitidas().some(([id]) => id === nome);
  return permitida ? nome : 'painel';
}

function navegar(nome) {
  if (window.location.hash !== '#/' + nome) window.location.hash = '#/' + nome;
  else desenharPagina();
}

function montarLayout() {
  const p = estado.perfil;
  $('#raiz').innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="brand"><h1>Almoxarifado Inteligente</h1><small>SENAI · Klabin</small></div>
        <nav class="nav" id="nav" aria-label="Menu principal"></nav>
        <div class="sidebar-foot">Versão em desenvolvimento. Os módulos de materiais, recebimento e pedidos entram nas próximas entregas.</div>
      </aside>
      <div class="main">
        <header class="topbar">
          <div class="top-title-group">
            <div class="top-title" id="topTitle"></div>
            <select class="mobile-nav" id="mobileNav" aria-label="Ir para a página"></select>
          </div>
          <div class="account-toolbar">
            <span class="account-user">${esc(p.nome)} · ${esc(rotuloPerfil(p.perfil))}</span>
            <button class="btn btn-ghost" type="button" id="btnConta">Minha conta</button>
            <button class="btn btn-ghost" type="button" id="btnSair">Sair</button>
          </div>
        </header>
        <main class="wrap" id="app"></main>
      </div>
    </div>`;

  $('#nav').addEventListener('click', e => {
    const botao = e.target.closest('[data-rota]');
    if (botao) navegar(botao.dataset.rota);
  });
  $('#mobileNav').addEventListener('change', e => navegar(e.target.value));
  $('#btnConta').addEventListener('click', () => abrirMinhaConta());
  $('#btnSair').addEventListener('click', () => sair());
}

let renderizacao = 0;

async function desenharPagina() {
  const atual = rotaAtual();
  const rota = ROTAS[atual];
  const permitidas = rotasPermitidas();

  $('#nav').innerHTML = permitidas
    .map(([id, r]) => `<button type="button" data-rota="${id}" class="${id === atual ? 'active' : ''}" ${id === atual ? 'aria-current="page"' : ''}>${r.rotulo}</button>`)
    .join('');
  $('#mobileNav').innerHTML = permitidas
    .map(([id, r]) => `<option value="${id}" ${id === atual ? 'selected' : ''}>${r.rotulo}</option>`)
    .join('');
  $('#topTitle').textContent = rota.titulo;
  document.title = `${rota.rotulo} · Almoxarifado Inteligente`;

  // Cada página ganha um elemento novo, para os eventos não se acumularem.
  const pagina = document.createElement('div');
  pagina.className = 'pagina';
  pagina.innerHTML = '<div class="carregando">Carregando...</div>';
  $('#app').replaceChildren(pagina);
  const minha = ++renderizacao;
  try {
    await rota.pagina.montar(pagina, { perfil: estado.perfil, navegar, ativa: () => minha === renderizacao });
  } catch (erro) {
    if (minha !== renderizacao) return;
    pagina.innerHTML = `<div class="card card-pad empty"><h3>Não foi possível abrir esta página</h3><p>${esc(erroAmigavel(erro))}</p><button class="btn btn-light" type="button" data-recarregar>Tentar de novo</button></div>`;
    pagina.querySelector('[data-recarregar]').addEventListener('click', desenharPagina);
  }
}

async function abrirSistema() {
  let perfil;
  try {
    perfil = await carregarPerfil();
  } catch (erro) {
    mostrarLogin(erroAmigavel(erro), abrirSistema);
    return;
  }
  if (!perfil || !perfil.ativo || perfil.removido_em) {
    await sair('Sua conta não tem acesso ao sistema. Procure o gestor do almoxarifado.');
    return;
  }
  if (estado.recuperacao || perfil.deve_trocar_senha) {
    mostrarDefinirSenha(estado.recuperacao ? 'recuperacao' : 'primeiro', abrirSistema);
    return;
  }
  const situacao = await verificarSessao();
  if (situacao === 'outra_sessao') {
    await sair('Sua conta foi acessada em outro aparelho. Por segurança, esta sessão foi encerrada.');
    return;
  }
  montarLayout();
  await desenharPagina();
}

async function iniciar() {
  if (!configurado) {
    mostrarSemConfiguracao();
    return;
  }
  estado.recuperacao = tipoLinkInicial === 'recovery';
  supabase.auth.onAuthStateChange(evento => {
    if (evento === 'PASSWORD_RECOVERY' && !estado.recuperacao) {
      estado.recuperacao = true;
      setTimeout(abrirSistema, 0);
    }
  });

  window.addEventListener('hashchange', () => {
    if (!estado.perfil || !$('#app')) return;
    if (modalAberto() && !fecharModal()) return;
    desenharPagina();
  });

  const { data: { session } } = await supabase.auth.getSession();
  if (session) await abrirSistema();
  else mostrarLogin(lerAviso(), abrirSistema);
  vigiarSessao();
}

iniciar();
