import { supabase } from './supabase.js';

// Dois espaços de arquivos no Supabase Storage:
// "materiais" (público): fotos e fichas de segurança dos materiais.
// "recebimentos" (privado): notas fiscais e fotos de divergência.

// Reduz fotos grandes do celular antes de enviar (máximo 1400 px, JPEG).
export async function prepararImagem(arquivo, maximo = 1400) {
  if (!arquivo?.type?.startsWith('image/')) return arquivo;
  try {
    const imagem = await createImageBitmap(arquivo);
    const escala = Math.min(1, maximo / Math.max(imagem.width, imagem.height));
    const largura = Math.round(imagem.width * escala);
    const altura = Math.round(imagem.height * escala);
    const tela = document.createElement('canvas');
    tela.width = largura;
    tela.height = altura;
    tela.getContext('2d').drawImage(imagem, 0, 0, largura, altura);
    const blob = await new Promise(ok => tela.toBlob(ok, 'image/jpeg', 0.85));
    return blob ? new File([blob], (arquivo.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : arquivo;
  } catch {
    return arquivo;
  }
}

export const extensao = arquivo => (arquivo.name?.match(/\.([a-z0-9]+)$/i)?.[1] || (arquivo.type === 'application/pdf' ? 'pdf' : 'jpg')).toLowerCase();

export async function enviarArquivo(caminho, arquivo, balde = 'materiais') {
  const limite = balde === 'recebimentos' ? 10 : 5;
  if (arquivo.size > limite * 1024 * 1024) throw new Error(`O arquivo passa de ${limite} MB. Escolha um arquivo menor.`);
  const { error } = await supabase.storage.from(balde).upload(caminho, arquivo, {
    upsert: true,
    contentType: arquivo.type || 'application/octet-stream',
    cacheControl: '3600',
  });
  if (error) {
    if (/mime|type/i.test(error.message)) throw new Error('Tipo de arquivo não aceito. Use PDF ou foto (JPG, PNG ou WEBP).');
    if (/size|large/i.test(error.message)) throw new Error(`O arquivo é grande demais (máximo ${limite} MB).`);
    if (/bucket/i.test(error.message)) throw new Error('O espaço de arquivos ainda não existe. Rode os scripts SQL mais recentes no Supabase.');
    throw error;
  }
  return caminho;
}

export async function apagarArquivo(caminho, balde = 'materiais') {
  if (!caminho) return;
  await supabase.storage.from(balde).remove([caminho]).catch(() => {});
}

export const urlArquivo = caminho => (caminho ? supabase.storage.from('materiais').getPublicUrl(caminho).data.publicUrl : '');

// Arquivo privado: gera um link que vale por uma hora.
export async function abrirArquivoPrivado(caminho, balde = 'recebimentos') {
  const janela = window.open('', '_blank');
  const { data, error } = await supabase.storage.from(balde).createSignedUrl(caminho, 3600);
  if (error || !data?.signedUrl) {
    janela?.close();
    throw new Error('Não foi possível abrir o arquivo. Ele pode ter sido apagado ou você está sem conexão.');
  }
  if (janela) janela.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
}
