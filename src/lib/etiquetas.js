import QRCode from 'qrcode';
import { esc, contraste, fmtData } from './ui.js';
import { dadosEtiqueta } from './materiais.js';

export const FORMATOS = {
  pequena: {
    rotulo: 'Pequena, 100 × 50 mm',
    descricao: 'Uma etiqueta por página, para impressora de etiquetas. Serve para caixas e prateleiras.',
  },
  grande: {
    rotulo: 'Grande, 100 × 150 mm',
    descricao: 'Para caixas grandes. Tem o quadro de quantidade atual para anotar cada retirada à mão.',
  },
  a4: {
    rotulo: 'Folha A4, 10 por folha',
    descricao: 'Para impressora comum. Imprime em folha de etiquetas adesivas ou em papel para recortar.',
  },
};

// Endereço aberto ao ler o QR com o celular.
export const linkMaterial = codigo => `${window.location.origin}/#/materiais/${encodeURIComponent(codigo)}`;

const nomeArquivo = texto => texto.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);

// Precisa ser chamada direto no clique; senão o navegador bloqueia a janela.
export function abrirJanelaEtiquetas() {
  const janela = window.open('', '_blank');
  if (!janela) throw new Error('O navegador bloqueou a janela de impressão. Libere as janelas pop-up deste site e tente de novo.');
  janela.document.write('<p style="font-family:Arial,sans-serif;padding:24px;color:#33475b">Preparando as etiquetas...</p>');
  return janela;
}

function cabecalhoEtiqueta(d) {
  const fundo = d.cor || '#ffffff';
  const branco = fundo.toUpperCase() === '#FFFFFF';
  return `<div class="faixa" style="background:${esc(fundo)};color:${contraste(fundo)};${branco ? 'border-bottom:0.3mm solid #333;' : ''}">
    <span class="classe">${esc(d.classe.toUpperCase())}</span><span class="uso">USO INTERNO</span>
  </div>`;
}

function etiquetaHtml(m, qr, formato, impressoPor) {
  const d = dadosEtiqueta(m);
  const rodape = `${d.centro ? `CC ${esc(d.centro)} · ` : ''}Impressa em ${fmtData(new Date())}${impressoPor ? ' por ' + esc(impressoPor) : ''}`;
  const dados = `
    <div class="campos">
      <div><span>Cód. SAP</span><b>${esc(d.prn)}</b></div>
      <div><span>Código</span><b>${esc(d.codigo)}</b></div>
      <div><span>Unidade</span><b>${esc(d.unidade)}</b></div>
    </div>`;
  if (formato === 'grande') {
    return `<section class="etq grande">
      ${cabecalhoEtiqueta(d)}
      <div class="corpo">
        <div class="texto">
          <div class="rotulo">PRODUTO</div>
          <div class="nome">${esc(d.nome)}</div>
          ${d.descricao ? `<div class="desc">${esc(d.descricao)}</div>` : ''}
          <div class="rotulo">LOCALIZAÇÃO</div>
          <div class="local">${esc(d.local)}</div>
        </div>
        <div class="qr">${qr}</div>
      </div>
      ${dados}
      ${d.embalagem ? `<div class="embalagem">${esc(d.embalagem)}</div>` : ''}
      <table class="quadro">
        <caption>QUANTIDADE ATUAL</caption>
        <thead><tr><th>Data</th><th>Assinatura</th><th>Qtd.</th><th>Un.</th></tr></thead>
        <tbody>${'<tr><td></td><td></td><td></td><td></td></tr>'.repeat(12)}</tbody>
      </table>
      <div class="rodape">${rodape}</div>
    </section>`;
  }
  return `<section class="etq ${formato === 'a4' ? 'folha' : 'pequena'}">
    ${cabecalhoEtiqueta(d)}
    <div class="corpo">
      <div class="texto">
        <div class="nome">${esc(d.nome)}</div>
        ${d.descricao ? `<div class="desc">${esc(d.descricao)}</div>` : ''}
        <div class="rotulo">LOCALIZAÇÃO</div>
        <div class="local">${esc(d.local)}</div>
      </div>
      <div class="qr">${qr}</div>
    </div>
    ${dados}
    <div class="rodape">${d.embalagem ? esc(d.embalagem) + ' · ' : ''}${rodape}</div>
  </section>`;
}

const ESTILO = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #e9edf2; font-family: Arial, Helvetica, sans-serif; color: #111; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .barra { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between;
           background: #fff; border-bottom: 1px solid #d5dce4; padding: 12px 18px; }
  .barra b { color: #1b3c73; }
  .barra p { font-size: 12px; color: #55697b; max-width: 640px; line-height: 1.5; }
  .barra button { font: 700 14px Arial, sans-serif; border: 0; border-radius: 4px; padding: 11px 18px; cursor: pointer; }
  .barra .imprimir { background: #2957a4; color: #fff; }
  .barra .fechar { background: #eef2f7; color: #1b3c73; }
  .paginas { padding: 20px; display: flex; flex-wrap: wrap; gap: 14px; justify-content: center; }
  .etq { background: #fff; overflow: hidden; display: flex; flex-direction: column; border: 0.3mm solid #222; }
  .faixa { display: flex; justify-content: space-between; align-items: center; padding: 0 3mm; font-weight: 800; letter-spacing: .3mm; }
  .faixa .uso { font-size: 6pt; font-weight: 700; opacity: .85; }
  .corpo { display: flex; gap: 2.5mm; padding: 2mm 3mm 0; flex: 1; min-height: 0; }
  .texto { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .rotulo { font-size: 5.5pt; font-weight: 800; color: #555; letter-spacing: .3mm; margin-top: 1mm; }
  .nome { font-weight: 800; line-height: 1.12; text-transform: uppercase; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
  .desc { color: #333; line-height: 1.2; margin-top: .6mm; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; overflow: hidden; }
  .local { font-family: "Courier New", Consolas, monospace; font-weight: 800; letter-spacing: -.2mm; white-space: nowrap; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .campos { display: flex; gap: 2mm; padding: 1mm 3mm 0; }
  .campos div { flex: 1; min-width: 0; border-top: 0.25mm solid #999; padding-top: .6mm; }
  .campos span { display: block; font-size: 5pt; font-weight: 800; color: #555; letter-spacing: .2mm; }
  .campos b { display: block; font-size: 7.5pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rodape { font-size: 5pt; color: #444; padding: .8mm 3mm 1.2mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .pequena { width: 100mm; height: 50mm; }
  .pequena .faixa, .folha .faixa { height: 6.5mm; font-size: 8pt; }
  .pequena .nome, .folha .nome { font-size: 10pt; }
  .pequena .desc, .folha .desc { font-size: 6.5pt; }
  .pequena .local, .folha .local { font-size: 13pt; }
  .pequena .qr, .folha .qr { width: 21mm; height: 21mm; flex-shrink: 0; }

  .folha { width: 95mm; height: 55mm; }

  .grande { width: 100mm; height: 150mm; }
  .grande .faixa { height: 10mm; font-size: 12pt; }
  .grande .corpo { padding-top: 3mm; flex: 0 0 auto; }
  .grande .nome { font-size: 15pt; -webkit-line-clamp: 3; }
  .grande .desc { font-size: 8pt; -webkit-line-clamp: 2; }
  .grande .local { font-size: 17pt; }
  .grande .qr { width: 30mm; height: 30mm; flex-shrink: 0; }
  .grande .campos b { font-size: 9pt; }
  .embalagem { font-size: 8pt; font-weight: 700; padding: 1.5mm 3mm 0; }
  .quadro { margin: 2mm 3mm 0; width: calc(100% - 6mm); border-collapse: collapse; font-size: 6.5pt; }
  .quadro caption { text-align: left; font-weight: 800; font-size: 6.5pt; letter-spacing: .3mm; padding-bottom: .8mm; }
  .quadro th, .quadro td { border: 0.25mm solid #555; height: 5.6mm; padding: 0 1mm; text-align: left; }
  .quadro th:nth-child(1) { width: 18mm; } .quadro th:nth-child(3) { width: 14mm; } .quadro th:nth-child(4) { width: 10mm; }
  .grande .rodape { margin-top: auto; }

  @media print {
    html, body { background: #fff; }
    .barra { display: none; }
    .paginas { padding: 0; display: block; }
    .etq { break-after: page; page-break-after: always; border: 0; }
    .paginas.a4 { display: grid; grid-template-columns: 95mm 95mm; grid-auto-rows: 55mm; gap: 0; }
    .paginas.a4 .etq { break-after: auto; page-break-after: auto; break-inside: avoid; border: 0.2mm dashed #bbb; }
  }
`;

const PAGINA = {
  pequena: '@page { size: 100mm 50mm; margin: 0; }',
  grande: '@page { size: 100mm 150mm; margin: 0; }',
  a4: '@page { size: A4 portrait; margin: 10mm; }',
};

export async function montarEtiquetas(janela, materiais, formato, { impressoPor = '', aoImprimir } = {}) {
  const qrs = await Promise.all(materiais.map(m => QRCode.toString(linkMaterial(m.codigo), { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })));
  const titulo = materiais.length === 1
    ? nomeArquivo(`Etiqueta - ${materiais[0].nome} - ${materiais[0].codigo}`)
    : nomeArquivo(`Etiquetas - ${materiais.length} materiais - ${fmtData(new Date()).replace(/\//g, '-')}`);
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
    <style>${PAGINA[formato]}${ESTILO}</style></head><body>
    <div class="barra">
      <div>
        <b>${materiais.length} etiqueta${materiais.length > 1 ? 's' : ''} · ${esc(FORMATOS[formato].rotulo)}</b>
        <p>Na janela de impressão, deixe as margens em "Nenhuma", a escala em 100% e marque "Gráficos de plano de fundo" para sair a cor da classe. Para salvar em PDF, escolha "Salvar como PDF": o arquivo já vem com o nome do material.</p>
      </div>
      <div><button class="imprimir" type="button" onclick="window.print()">Imprimir ou salvar PDF</button>
      <button class="fechar" type="button" onclick="window.close()">Fechar</button></div>
    </div>
    <main class="paginas ${formato}">${materiais.map((m, i) => etiquetaHtml(m, qrs[i], formato, impressoPor)).join('')}</main>
    </body></html>`;
  janela.document.open();
  janela.document.write(html);
  janela.document.close();
  janela.document.title = titulo;
  let avisado = false;
  janela.addEventListener('afterprint', () => {
    if (avisado) return;
    avisado = true;
    aoImprimir?.();
  });
  janela.focus();
}
