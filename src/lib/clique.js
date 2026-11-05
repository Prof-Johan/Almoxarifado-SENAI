// Som sutil de clique, gerado na hora (sem arquivo de áudio).
let contexto = null;

export function tocarClique(intensidade = 1) {
  try {
    contexto ||= new (window.AudioContext || window.webkitAudioContext)();
    if (contexto.state === 'suspended') contexto.resume();
    const agora = contexto.currentTime;
    const tom = contexto.createOscillator();
    const volume = contexto.createGain();
    const filtro = contexto.createBiquadFilter();
    tom.type = 'triangle';
    tom.frequency.setValueAtTime(1800, agora);
    tom.frequency.exponentialRampToValueAtTime(600, agora + 0.035);
    filtro.type = 'highpass';
    filtro.frequency.value = 400;
    volume.gain.setValueAtTime(0.0001, agora);
    volume.gain.exponentialRampToValueAtTime(0.05 * intensidade, agora + 0.004);
    volume.gain.exponentialRampToValueAtTime(0.0001, agora + 0.05);
    tom.connect(filtro).connect(volume).connect(contexto.destination);
    tom.start(agora);
    tom.stop(agora + 0.06);
  } catch { /* navegador sem áudio */ }
}
