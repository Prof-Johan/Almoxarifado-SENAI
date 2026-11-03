import { createClient } from '@supabase/supabase-js';

// Lido antes de o cliente limpar o endereço: indica se a pessoa chegou
// por um link de recuperação de senha ou de convite.
const parametrosIniciais = new URLSearchParams(window.location.hash.replace(/^#/, ''));
export const tipoLinkInicial = parametrosIniciais.get('type') || '';

const url = import.meta.env.VITE_SUPABASE_URL;
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configurado = Boolean(url && chave);

export const supabase = configurado
  ? createClient(url, chave, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
