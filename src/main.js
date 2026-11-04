import './style.css';
import './app.css';
import './senai.css';
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
import * as materiais from './pages/materiais.js';
import * as depositos from './pages/depositos.js';
import { abrirMinhaConta } from './pages/conta.js';
import { iniciarTempoReal, ouvir, aoMudarConexao } from './lib/tempoReal.js';
import { aplicarTema } from './lib/tema.js';
import * as recebimentos from './pages/recebimentos.js';
import * as pedidos from './pages/pedidos.js';
import * as inventarios from './pages/inventarios.js';
import * as relatorios from './pages/relatorios.js';
import { mostrarAtalhos } from './lib/atalhos.js';
import { iniciarOffline } from './lib/offline.js';

// Páginas e o nível mínimo de perfil para ver cada uma.
const ROTAS = {
  painel: { rotulo: 'Painel', titulo: 'Visão geral', nivel: 1, pagina: painel },
  pedidos: { rotulo: 'Pedidos', titulo: 'Pedidos e retirada', nivel: 1, pagina: pedidos },
  materiais: { rotulo: 'Materiais', titulo: 'Materiais', nivel: 1, pagina: materiais },
  recebimentos: { rotulo: 'Recebimento', titulo: 'Recebimento de materiais', nivel: 1, pagina: recebimentos },
  inventarios: { rotulo: 'Inventário', titulo: 'Inventário periódico', nivel: 1, pagina: inventarios },
  depositos: { rotulo: 'Depósitos', titulo: 'Depósitos e endereços', nivel: 1, pagina: depositos },
  classes: { rotulo: 'Classes e cores', titulo: 'Classes de materiais', nivel: 1, pagina: classes },
  relatorios: { rotulo: 'Relatórios', titulo: 'Relatórios', nivel: 3, pagina: relatorios },
  usuarios: { rotulo: 'Usuários', titulo: 'Usuários e acessos', nivel: 4, pagina: usuarios },
  cadastros: { rotulo: 'Unidades e setores', titulo: 'Unidades e setores', nivel: 4, pagina: cadastros },
  historico: { rotulo: 'Histórico', titulo: 'Histórico de alterações', nivel: 4, pagina: historico },
};

const rotasPermitidas = () => Object.entries(ROTAS).filter(([, r]) => nivel(estado.perfil?.perfil) >= r.nivel);

// Endereços como #/materiais ou #/materiais/MAT-000123 (aberto pelo QR da etiqueta).
function rotaAtual() {
  const [, nome, parametro] = window.location.hash.match(/^#\/([\w-]+)(?:\/([^/?#]+))?/) || [];
  const permitida = rotasPermitidas().some(([id]) => id === nome);
  return permitida ? { nome, parametro: parametro || '' } : { nome: 'painel', parametro: '' };
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
        <div class="brand">
          <img class="brand-logo" src="/senai-logo-branco.png" alt="SENAI" width="132" height="38">
          <h1>Almoxarifado Inteligente</h1><small>Projeto SENAI · Klabin</small>
        </div>
        <nav class="nav" id="nav" aria-label="Menu principal"></nav>
        <div class="sidebar-foot">Atalhos: <kbd>/</kbd> busca, <kbd>Alt</kbd>+<kbd>N</kbd> novo, <kbd>Ctrl</kbd>+<kbd>S</kbd> salvar. <button type="button" class="link-atalhos" id="btnAtalhos">Ver todos</button></div>
      </aside>
      <div class="main">
        <header class="topbar">
          <div class="top-title-group">
            <div class="top-title" id="topTitle"></div>
            <select class="mobile-nav" id="mobileNav" aria-label="Ir para a página"></select>
          </div>
          <div class="account-toolbar">
            <span class="ao-vivo" id="aoVivo" title="Conectando..."><span class="ponto"></span><span class="texto">Conectando</span></span>
            <span class="account-user">${esc(p.nome)} · ${esc(rotuloPerfil(p.perfil))}</span>
            <button class="btn btn-ghost" type="button" data-alternar-tema aria-pressed="false">Modo noturno</button>
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
  $('#btnAtalhos').addEventListener('click', mostrarAtalhos);
  aplicarTema();
  aoMudarConexao(conectado => {
    const marca = $('#aoVivo');
    if (!marca) return;
    marca.classList.toggle('conectado', conectado);
    marca.querySelector('.texto').textContent = conectado ? 'Ao vivo' : 'Reconectando';
    marca.title = conectado ? 'As telas se atualizam sozinhas quando alguém muda algo.' : 'Sem atualização automática no momento. Tentando reconectar.';
  });
}

let renderizacao = 0;
let limpezas = [];

async function desenharPagina() {
  const { nome: atual, parametro } = rotaAtual();
  const rota = ROTAS[atual];
  const permitidas = rotasPermitidas();

  // Para de ouvir as mudanças da página anterior.
  limpezas.forEach(fn => { try { fn(); } catch { /* ignora */ } });
  limpezas = [];

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
  const ctx = {
    perfil: estado.perfil,
    navegar,
    parametro,
    ativa: () => minha === renderizacao,
    aoSair: fn => { if (minha === renderizacao) limpezas.push(fn); else fn(); },
  };
  try {
    await rota.pagina.montar(pagina, ctx);
  } catch (erro) {
    if (minha !== renderizacao) return;
    pagina.innerHTML = `<div class="card card-pad empty"><h3>Não foi possível abrir esta página</h3><p>${esc(erroAmigavel(erro))}</p><button class="btn btn-light" type="button" data-recarregar>Tentar de novo</button></div>`;
    pagina.querySelector('[data-recarregar]').addEventListener('click', desenharPagina);
  }
}

// Se o gestor mudar o seu perfil, o menu e as permissões mudam na hora.
let ouvindoPerfil = false;
function ouvirMeuPerfil() {
  if (ouvindoPerfil) return;
  ouvindoPerfil = true;
  ouvir(['perfis'], async (_t, mudancas) => {
    const meu = mudancas.find(x => (x.novo?.id || x.antigo?.id) === estado.perfil?.id);
    if (!meu || !$('#app')) return;
    const antes = estado.perfil?.perfil;
    const perfil = await carregarPerfil().catch(() => null);
    if (!perfil || !perfil.ativo || perfil.removido_em) return;
    if (perfil.perfil !== antes) {
      fecharModal(true);
      montarLayout();
      await desenharPagina();
    }
  });
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
  iniciarTempoReal();
  ouvirMeuPerfil();
  montarLayout();
  await desenharPagina();
}

async function iniciar() {
  aplicarTema();
  iniciarOffline();
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
