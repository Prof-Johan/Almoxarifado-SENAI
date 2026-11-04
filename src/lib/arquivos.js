import { supabase } from './supabase.js';

const BALDE = 'materiais';

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
    return blob ? new File([blob], 'foto.jpg', { type: 'image/jpeg' }) : arquivo;
  } catch {
    return arquivo;
  }
}

export async function enviarArquivo(caminho, arquivo) {
  if (arquivo.size > 5 * 1024 * 1024) throw new Error('O arquivo passa de 5 MB. Escolha um arquivo menor.');
  const { error } = await supabase.storage.from(BALDE).upload(caminho, arquivo, {
    upsert: true,
    contentType: arquivo.type || 'application/octet-stream',
    cacheControl: '3600',
  });
  if (error) {
    if (/mime|type/i.test(error.message)) throw new Error('Tipo de arquivo não aceito. Use foto (JPG, PNG ou WEBP) ou PDF.');
    if (/size|large/i.test(error.message)) throw new Error('O arquivo é grande demais (máximo 5 MB).');
    throw error;
  }
  return caminho;
}

export async function apagarArquivo(caminho) {
  if (!caminho) return;
  await supabase.storage.from(BALDE).remove([caminho]).catch(() => {});
}

export const urlArquivo = caminho => (caminho ? supabase.storage.from(BALDE).getPublicUrl(caminho).data.publicUrl : '');
