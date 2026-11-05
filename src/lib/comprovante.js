import QRCode from 'qrcode';
import { esc, fmtDataHora } from './ui.js';
import { fmtQtd } from './materiais.js';

// Comprovante de retirada: cupom de 80 mm (impressora térmica) ou folha A4.
export const FORMATOS_COMPROVANTE = {
  cupom: 'Cupom, 80 mm (impressora térmica)',
  a4: 'Folha A4',
};

export function abrirJanelaComprovante() {
  const janela = window.open('', '_blank');
  if (!janela) throw new Error('O navegador bloqueou a janela de impressão. Libere as janelas pop-up deste site e tente de novo.');
  janela.document.write('<p style="font-family:Arial,sans-serif;padding:24px">Preparando o comprovante...</p>');
  return janela;
}

// dados: { pedido, itens: [{ codigo, nome, quantidade, unidade, local }], setor, centroCusto, unidade, peso, epis }
export async function montarComprovante(janela, dados, formato = 'cupom') {
  const p = dados.pedido;
  const link = `${window.location.origin}/#/pedidos/${encodeURIComponent(p.numero)}`;
  const qr = await QRCode.toString(link, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  const cupom = formato === 'cupom';
  const linhas = dados.itens.map(i => cupom
    ? `<tr><td colspan="2"><b>${esc(i.nome)}</b><br><span>${esc(i.codigo)} · ${esc(i.local)}</span></td><td class="dir">${fmtQtd(i.quantidade)} ${esc(i.unidade)}</td></tr>`
    : `<tr><td>${esc(i.codigo)}</td><td>${esc(i.nome)}</td><td>${esc(i.local)}</td><td class="dir">${fmtQtd(i.quantidade)} ${esc(i.unidade)}</td></tr>`).join('');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Comprovante de retirada ${esc(p.numero)}</title>
  <style>
    @page { size: ${cupom ? '80mm 200mm' : 'A4 portrait'}; margin: ${cupom ? '3mm' : '15mm'}; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #e9edf2; }
    .barra { display: flex; gap: 10px; justify-content: space-between; align-items: center; padding: 12px 18px; background: #fff; border-bottom: 1px solid #ccd; }
    .barra button { font: 700 14px Arial; border: 0; border-radius: 4px; padding: 10px 16px; cursor: pointer; background: #4a74b8; color: #fff; }
    .barra .fechar { background: #e8edf5; color: #1b3c73; }
    .folha { background: #fff; margin: 20px auto; padding: ${cupom ? '4mm' : '12mm'}; width: ${cupom ? '80mm' : '210mm'}; }
    h1 { font-size: ${cupom ? '13pt' : '18pt'}; text-align: ${cupom ? 'center' : 'left'}; }
    .sub { font-size: ${cupom ? '8pt' : '10pt'}; text-align: ${cupom ? 'center' : 'left'}; margin-top: 1mm; }
    .num { font-size: ${cupom ? '16pt' : '20pt'}; font-weight: 800; text-align: center; margin: 3mm 0; letter-spacing: .5mm; }
    dl { display: grid; grid-template-columns: ${cupom ? '1fr' : '1fr 1fr'}; gap: 1.5mm ${cupom ? '0' : '8mm'}; font-size: ${cupom ? '8.5pt' : '10.5pt'}; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 2.5mm 0; }
    dt { font-weight: 700; display: inline; } dd { display: inline; margin-left: 1mm; }
    table { width: 100%; border-collapse: collapse; margin-top: 3mm; font-size: ${cupom ? '8.5pt' : '10.5pt'}; }
    th { text-align: left; border-bottom: 1px solid #000; padding: 1mm 0; }
    td { padding: 1.2mm 0; border-bottom: 1px dotted #888; vertical-align: top; } td span { font-size: ${cupom ? '7.5pt' : '9pt'}; color: #333; }
    .dir { text-align: right; white-space: nowrap; padding-left: 2mm; }
    .obs { font-size: ${cupom ? '8pt' : '10pt'}; margin-top: 2.5mm; }
    .assinatura { margin-top: ${cupom ? '12mm' : '22mm'}; border-top: 1px solid #000; padding-top: 1mm; font-size: ${cupom ? '8pt' : '10pt'}; text-align: center; }
    .rodape { display: flex; gap: 3mm; align-items: center; margin-top: 4mm; font-size: 7.5pt; ${cupom ? 'flex-direction: column; text-align: center;' : ''} }
    .rodape svg { width: ${cupom ? '24mm' : '26mm'}; height: ${cupom ? '24mm' : '26mm'}; }
    @media print { body { background: #fff; } .barra { display: none; } .folha { margin: 0; padding: 0; width: auto; } }
  </style></head><body>
  <div class="barra"><b>Comprovante de retirada · ${esc(FORMATOS_COMPROVANTE[formato])}</b>
    <div><button type="button" onclick="window.print()">Imprimir ou salvar PDF</button> <button type="button" class="fechar" onclick="window.close()">Fechar</button></div></div>
  <main class="folha">
    <h1>Almoxarifado Inteligente</h1>
    <p class="sub">${esc(dados.unidade || '')} · Comprovante de retirada de material</p>
    <p class="num">${esc(p.numero)}</p>
    <dl>
      <div><dt>Retirado em:</dt><dd>${esc(fmtDataHora(p.retirado_em || new Date()))}</dd></div>
      <div><dt>Setor:</dt><dd>${esc(dados.setor || '')}${dados.centroCusto ? ` · CC ${esc(dados.centroCusto)}` : ''}</dd></div>
      <div><dt>Solicitante:</dt><dd>${esc(p.solicitante_nome || '')}</dd></div>
      <div><dt>Retirado por:</dt><dd>${esc(p.recebedor_nome || '')} (${p.retirada_metodo === 'FOTO' ? 'foto' : 'crachá'})</dd></div>
      <div><dt>Entregue por:</dt><dd>${esc(p.entregue_por_nome || '')}</dd></div>
      <div><dt>Pedido em:</dt><dd>${esc(fmtDataHora(p.criado_em))}</dd></div>
    </dl>
    <table><thead><tr>${cupom ? '<th colspan="2">Material</th><th class="dir">Qtd.</th>' : '<th>Código</th><th>Material</th><th>Endereço</th><th class="dir">Quantidade</th>'}</tr></thead><tbody>${linhas}</tbody></table>
    ${dados.peso ? `<p class="obs"><b>Peso total:</b> ${fmtQtd(dados.peso)} kg</p>` : ''}
    ${dados.epis?.length ? `<p class="obs"><b>EPI necessário:</b> ${esc(dados.epis.join('; '))}</p>` : ''}
    <p class="assinatura">Assinatura de quem retirou</p>
    <div class="rodape">${qr}<span>Confira o pedido no sistema pelo QR.<br>Material retirado deve ser devolvido pelo almoxarifado, nunca descartado sem registro.</span></div>
  </main></body></html>`;
  janela.document.open();
  janela.document.write(html);
  janela.document.close();
  janela.document.title = `Comprovante de retirada ${p.numero}`;
  if (cupom) {
    // Bobina de 80 mm: a altura da página acompanha o tamanho do comprovante.
    const folha = janela.document.querySelector('.folha');
    const alturaMm = Math.ceil((folha.scrollHeight * 25.4) / 96) + 10;
    const estilo = janela.document.createElement('style');
    estilo.textContent = `@page { size: 80mm ${alturaMm}mm; margin: 3mm; }`;
    janela.document.head.appendChild(estilo);
  }
  janela.focus();
}
