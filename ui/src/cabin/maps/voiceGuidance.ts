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
import { guidanceOf } from './guidance'
import { daDire, limiteDaDire, memoriaNuova } from './voiceLines'

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

export function parla(testo: string, locale = 'it-IT'): void {
  const sintesi = window.speechSynthesis
  if (!sintesi || typeof SpeechSynthesisUtterance === 'undefined') return
  if (!voce || !voce.lang.toLowerCase().startsWith(locale.slice(0, 2).toLowerCase())) voce = scegliVoce(locale)
  const enunciato = new SpeechSynthesisUtterance(testo)
  enunciato.lang = locale
  if (voce) enunciato.voice = voce
  enunciato.rate = 1
  sintesi.speak(enunciato)
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
