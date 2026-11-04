// Gera planilhas .xlsx no navegador. A biblioteca só é baixada quando alguém exporta.
// planilhas: [{ nome, colunas: [{ titulo, largura }], linhas: [[valor, ...]] }]
function celula(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) return { value: valor, type: Date, format: 'dd/mm/yyyy hh:mm' };
  if (typeof valor === 'number') return { value: valor, type: Number };
  return { value: String(valor) };
}

export async function baixarExcel(nomeArquivo, planilhas) {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const folhas = planilhas.map(p => ({
    sheet: p.nome.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31),
    columns: p.colunas.map(c => ({ width: c.largura || 16 })),
    data: [
      p.colunas.map(c => ({ value: c.titulo, fontWeight: 'bold', backgroundColor: '#DCE6F5' })),
      ...(p.linhas.length ? p.linhas.map(l => l.map(celula)) : [[{ value: 'Nenhum registro no período.' }]]),
    ],
  }));
  const nome = nomeArquivo.replace(/[\\/:*?"<>|]+/g, '-') + (nomeArquivo.endsWith('.xlsx') ? '' : '.xlsx');
  await writeExcelFile(folhas).toFile(nome);
}

export const dataHora = v => (v ? new Date(v) : null);
