import { esc, contraste } from './ui.js';

export const UNIDADES_MEDIDA = {
  un: 'Unidade', cx: 'Caixa', pc: 'Peça', par: 'Par', jg: 'Jogo', kit: 'Kit',
  pct: 'Pacote', fd: 'Fardo', rl: 'Rolo', sc: 'Saco', gl: 'Galão', lt: 'Lata',
  fr: 'Frasco', rs: 'Resma', m: 'Metro', kg: 'Quilo', g: 'Grama', L: 'Litro', mL: 'Mililitro',
};

// Só estas unidades aceitam número com vírgula. As outras (unidade, peça,
// caixa, rolo...) são contadas inteiras: não existe 0,4 rolamento.
// A mesma regra está no banco (0007_quantidade_inteira.sql).
const FRACIONAVEIS = ['m', 'kg', 'g', 'l', 'ml'];
export const fracionavel = unidade => FRACIONAVEIS.includes(String(unidade || '').trim().toLowerCase());
export const passoQtd = unidade => (fracionavel(unidade) ? 'any' : '1');

// Devolve a mensagem de erro, ou '' quando a quantidade está certa.
export function erroInteiro(qtd, unidade, nome = 'o material', campo = 'A quantidade') {
  const n = Number(qtd);
  if (qtd === '' || qtd === null || qtd === undefined || Number.isNaN(n) || fracionavel(unidade) || Number.isInteger(n)) return '';
  const chave = Object.keys(UNIDADES_MEDIDA).find(k => k.toLowerCase() === String(unidade || '').toLowerCase());
  const rotulo = chave ? `${UNIDADES_MEDIDA[chave].toLowerCase()} (${unidade})` : unidade;
  return `${campo} de ${nome} precisa ser um número inteiro: o material é contado em ${rotulo}, que não se divide.`;
}

export const CRITICIDADES = {
  BAIXA: { rotulo: 'Baixa', classe: 'gray' },
  MEDIA: { rotulo: 'Média', classe: 'blue' },
  ALTA: { rotulo: 'Alta', classe: 'red' },
};

export const TIPOS_ARMAZENAGEM = {
  PRATELEIRA: 'Prateleira, guarda manual',
  PALETE: 'Palete, com empilhadeira',
};

export const TIPOS_MOVIMENTO = {
  SALDO_INICIAL: 'Saldo inicial',
  ENTRADA: 'Entrada',
  SAIDA: 'Saída',
  DEVOLUCAO: 'Devolução',
  AJUSTE: 'Ajuste',
};

const pad2 = n => String(n).padStart(2, '0');

export const fmtQtd = n => Number(n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export const nomeDeposito = d => (d ? `D${pad2(d.numero)}${d.nome ? ' · ' + d.nome : ''}` : '');

// Código de localização: D01-P03-LA-A3-Po2. Mudar o formato aqui muda em todo o sistema.
export function codigoLocalizacao(numeroDeposito, prateleira, lado, andar, posicao) {
  if (!numeroDeposito || !prateleira || !lado || !andar || !posicao) return '';
  return `D${pad2(numeroDeposito)}-P${pad2(prateleira)}-L${lado}-A${andar}-Po${posicao}`;
}

export function embalagemTexto(m) {
  if (!m.embalagem_qtd || !m.embalagem_unidade) return '';
  return `1 ${m.unidade_medida} = ${fmtQtd(m.embalagem_qtd)} ${m.embalagem_unidade}`;
}

export function situacaoEstoque(m) {
  const saldo = Number(m.saldo);
  if (saldo <= 0) return { id: 'zerado', rotulo: 'Sem estoque', classe: 'red' };
  if (Number(m.saldo_emergencial) > 0 && saldo <= Number(m.saldo_emergencial)) return { id: 'emergencial', rotulo: 'Só o emergencial', classe: 'red' };
  if (saldo <= Number(m.estoque_minimo)) return { id: 'baixo', rotulo: 'Estoque baixo', classe: 'low' };
  return { id: 'ok', rotulo: 'Disponível', classe: 'ok' };
}

// O que vai impresso na etiqueta. Se algo daqui mudar, a etiqueta precisa ser reimpressa.
export function dadosEtiqueta(m) {
  return {
    nome: m.nome,
    descricao: m.descricao || '',
    prn: m.prn,
    codigo: m.codigo,
    classe: m.classe?.nome || '',
    cor: m.classe?.cor || '',
    local: m.local || '',
    unidade: m.unidade_medida,
    embalagem: embalagemTexto(m),
    // Só entra quando o material tem centro de custo, para não mudar as etiquetas antigas.
    ...(m.centro ? { centro: m.centro } : {}),
  };
}

export const etiquetaPendente = m => !m.etiqueta || JSON.stringify(m.etiqueta.dados) !== JSON.stringify(dadosEtiqueta(m));

export function pillCor(nome, cor, extra = '') {
  const fundo = cor || '#cfd9df';
  const borda = fundo.toUpperCase() === '#FFFFFF' ? '#9aabb9' : fundo;
  return `<span class="cat-pill ${extra}" style="background:${esc(fundo)};color:${contraste(fundo)};border-color:${esc(borda)}">${esc(nome)}</span>`;
}

const normalizar = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const textoBusca = (...partes) => normalizar(partes.join(' ')).replace(/[^a-z0-9]+/g, ' ');
export const termoBusca = t => normalizar(t).replace(/[^a-z0-9]+/g, ' ').trim();
