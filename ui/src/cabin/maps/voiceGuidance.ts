/**
 * WestPlay Italia: il navigatore che parla. Legge ad alta voce le indicazioni svolta per svolta che il
 * cruscotto già mostra (guidance.ts), con la voce del sistema (Windows: "Microsoft Elsa" o "Isabella" per
 * l'italiano), più il cambio del limite di velocità e l'arrivo.
 *
 * Quando parla, per ogni svolta: appena la svolta diventa la prossima (con la sua distanza), poi quando
 * passa sotto i 2 km e sotto i 500 m, e "adesso" quando è a pochi metri. Una soglia si annuncia solo
 * quando la si attraversa venendo da più lontano, così all'avvio di un percorso non parte una raffica.
 */

import { useLive } from '../state/store'
import { languageOf, stringsFor } from '../state/strings'
import { googleVoiceKey } from './googleVoiceKey'
import { guidanceOf } from './guidance'
import { daDire, fileDellaFrase, limiteDaDire, memoriaNuova } from './voiceLines'

const CHIAVE_ATTIVA = 'westplay-italia:voce'

/** Se la voce è accesa (impostazione salvata nella WebView; accesa se mai toccata). */
export function voceAttiva(): boolean {
  try {
    return localStorage.getItem(CHIAVE_ATTIVA) !== 'no'
  } catch {
    return true
  }
}

export function impostaVoce(attiva: boolean): void {
  try {
    localStorage.setItem(CHIAVE_ATTIVA, attiva ? 'si' : 'no')
  } catch {
    // WebView senza archivio: resta accesa
  }
  if (!attiva) window.speechSynthesis?.cancel()
}

let voce: SpeechSynthesisVoice | null = null

function scegliVoce(locale: string): SpeechSynthesisVoice | null {
  const voci = window.speechSynthesis?.getVoices() ?? []
  const lingua = locale.slice(0, 2).toLowerCase()
  const adatte = voci.filter((v) => v.lang.toLowerCase().startsWith(lingua))
  // Le voci "Natural"/"Online" di Edge sono le più umane; poi quelle di Windows.
  return (
    adatte.find((v) => /natural|online/i.test(v.name)) ??
    adatte.find((v) => v.lang.toLowerCase() === locale.toLowerCase()) ??
    adatte[0] ??
    null
  )
}

/** Le voci Google italiane, dalla più naturale: se una non c'è per la chiave del giocatore, si prova la successiva. */
const VOCI_GOOGLE = ['it-IT-Neural2-A', 'it-IT-Wavenet-A', 'it-IT-Standard-A']
const CACHE = 'westplay-italia:tts:'
/** Le frasi già generate, in memoria (base64 MP3) e salvate nella WebView, così la stessa frase non si
 * richiede due volte: le frasi del navigatore sono poche e sempre quelle. */
const memoriaAudio = new Map<string, string>()
let vociGoogle = 0

function audioSalvato(testo: string): string | null {
  const chiave = CACHE + testo
  const inMemoria = memoriaAudio.get(chiave)
  if (inMemoria) return inMemoria
  try {
    const salvato = localStorage.getItem(chiave)
    if (salvato) memoriaAudio.set(chiave, salvato)
    return salvato
  } catch {
    return null
  }
}

function salvaAudio(testo: string, audio: string): void {
  const chiave = CACHE + testo
  memoriaAudio.set(chiave, audio)
  try {
    localStorage.setItem(chiave, audio)
  } catch {
    // Archivio pieno: si tolgono le frasi salvate e si riparte (restano quelle in memoria).
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(CACHE)) localStorage.removeItem(k)
    } catch {
      // niente da fare
    }
  }
}

/** La frase con la voce Google (MP3 in base64), o `null` se non si riesce. */
async function sintesiGoogle(testo: string, chiaveApi: string): Promise<string | null> {
  const salvato = audioSalvato(testo)
  if (salvato) return salvato
  while (vociGoogle < VOCI_GOOGLE.length) {
    const risposta = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(chiaveApi)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text: testo },
          voice: { languageCode: 'it-IT', name: VOCI_GOOGLE[vociGoogle] },
          audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0 },
        }),
      },
    )
    if (risposta.ok) {
      const { audioContent } = (await risposta.json()) as { audioContent?: string }
      if (!audioContent) return null
      salvaAudio(testo, audioContent)
      return audioContent
    }
    // 400 per una voce che non c'è: la prossima; chiave sbagliata, quota finita o rete: voce di Windows.
    if (risposta.status === 400 && vociGoogle < VOCI_GOOGLE.length - 1) {
      vociGoogle++
      continue
    }
    console.warn(`[WestPlay Italia] voce Google: errore ${risposta.status}`)
    return null
  }
  return null
}

function parlaWindows(testo: string, locale: string): void {
  const sintesi = window.speechSynthesis
  if (!sintesi || typeof SpeechSynthesisUtterance === 'undefined') return
  if (!voce || !voce.lang.toLowerCase().startsWith(locale.slice(0, 2).toLowerCase())) voce = scegliVoce(locale)
  const enunciato = new SpeechSynthesisUtterance(testo)
  enunciato.lang = locale
  if (voce) enunciato.voice = voce
  enunciato.rate = 1
  sintesi.speak(enunciato)
}

function suona(base64: string): Promise<void> {
  return new Promise((fine) => {
    const audio = new Audio(`data:audio/mpeg;base64,${base64}`)
    audio.onended = () => fine()
    audio.onerror = () => fine()
    audio.play().catch(() => fine())
  })
}

/** Le frasi una dopo l'altra, senza sovrapporsi. */
let coda: Promise<void> = Promise.resolve()

/** Le frasi registrate con la voce Paola (tools/voce/genera.py), in `/voce/` con l'installer: il loro elenco. */
let registrate: Promise<Set<string>> | null = null

function frasiRegistrate(): Promise<Set<string>> {
  registrate ??= fetch('/voce/indice.json')
    .then((risposta) => (risposta.ok ? (risposta.json() as Promise<string[]>) : []))
    .then((files) => new Set(files))
    .catch(() => new Set<string>())
  return registrate
}

function suonaFile(url: string): Promise<boolean> {
  return new Promise((fine) => {
    const audio = new Audio(url)
    audio.onended = () => fine(true)
    audio.onerror = () => fine(false)
    audio.play().catch(() => fine(false))
  })
}

/**
 * Dice `testo`, in quest'ordine: con la voce Google se c'è la chiave; con la voce Paola registrata se la frase è
 * tra quelle registrate (tutte quelle del navigatore); altrimenti con la voce di Windows.
 */
export function parla(testo: string, locale = 'it-IT'): void {
  if (!locale.toLowerCase().startsWith('it')) {
    parlaWindows(testo, locale)
    return
  }
  const chiaveApi = googleVoiceKey()
  coda = coda.then(async () => {
    if (chiaveApi) {
      let audio: string | null = null
      try {
        audio = await sintesiGoogle(testo, chiaveApi)
      } catch (errore) {
        console.warn('[WestPlay Italia] voce Google non raggiungibile', errore)
      }
      if (audio) return suona(audio)
    }
    const file = fileDellaFrase(testo)
    if ((await frasiRegistrate()).has(file) && (await suonaFile(`/voce/${file}`))) return
    parlaWindows(testo, locale)
  })
}

/** Quanto spesso il narratore guarda il percorso (ms). */
const OGNI_MS = 250

/** Avvia il navigatore che parla; restituisce come fermarlo. */
export function avviaVoce(): () => void {
  const memoria = memoriaNuova()
  window.speechSynthesis?.addEventListener?.('voiceschanged', () => {
    voce = null
  })
  const timer = window.setInterval(() => {
    const stato = useLive.getState()
    const { route, routeNext, telemetry } = stato
    if (!telemetry || telemetry.paused || !voceAttiva()) return
    const text = stringsFor(languageOf(stato.chosenLanguage ?? stato.gameLanguage))
    const guida = route ? guidanceOf(route.distances, route.maneuvers, routeNext, telemetry.navigationDistance) : null
    const detto = daDire(guida?.step ?? null, guida?.distance ?? 0, memoria, text)
    if (detto) parla(detto, text.locale)
    const limite = limiteDaDire(telemetry.navigationSpeedLimit, stato.mph, memoria)
    if (limite && Math.abs(telemetry.speed) > 3) parla(limite, text.locale)
  }, OGNI_MS)
  return () => window.clearInterval(timer)
}
