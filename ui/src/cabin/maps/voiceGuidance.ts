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
import { languageOf, type Strings, stringsFor } from '../state/strings'
import { guidanceOf, type Step } from './guidance'

/** Soglie (metri, come li conta il gioco) a cui si annuncia la prossima svolta. */
export const SOGLIE = [2000, 500] as const
/** Sotto questa distanza la svolta si annuncia come "adesso". */
export const ADESSO_ENTRO = 60

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

/** Una distanza come si dice a voce: "300 metri", "1 chilometro", "2,5 chilometri". */
export function distanzaParlata(metri: number, decimale = ','): string {
  if (metri < 975) {
    const m = metri < 100 ? Math.max(10, Math.round(metri / 10) * 10) : Math.round(metri / 50) * 50
    return `${m} metri`
  }
  const km = metri / 1000
  if (km < 9.95) {
    const arrotondato = Math.round(km * 2) / 2
    if (arrotondato === 1) return '1 chilometro'
    const testo = Number.isInteger(arrotondato) ? String(arrotondato) : arrotondato.toFixed(1).replace('.', decimale)
    return `${testo} chilometri`
  }
  return `${Math.round(km)} chilometri`
}

/** Cosa dice un passo: "svolta a destra", "alla rotonda, prendi la seconda uscita". */
export function istruzione(step: Step, text: Strings): string {
  if (step.kind === 'arrive') return text.arrive
  const { turn, exit } = step.maneuver
  return turn === 'roundabout' ? text.roundabout(exit ?? 1) : text.turns[turn]
}

const minuscola = (s: string) => s.charAt(0).toLocaleLowerCase('it-IT') + s.slice(1)

/** La frase per un passo a una certa distanza ("Tra 500 metri, svolta a destra"; da vicino solo l'istruzione). */
export function frase(step: Step, metri: number, text: Strings): string {
  const cosa = istruzione(step, text)
  if (metri < ADESSO_ENTRO) {
    return step.kind === 'arrive' ? 'Sei arrivato a destinazione.' : `${cosa}.`
  }
  return `Tra ${distanzaParlata(metri, text.decimal)}, ${minuscola(cosa)}.`
}

/** La chiave di un passo: la stessa finché è la stessa svolta. */
export function chiaveDi(step: Step): string {
  return step.kind === 'arrive' ? 'arrivo' : `${step.maneuver.node}:${step.maneuver.turn}`
}

/** Stato del narratore, tra una lettura e l'altra. */
export interface Memoria {
  chiave: string | null
  distanza: number
  detto: Set<string>
  limite: number
}

export const memoriaNuova = (): Memoria => ({ chiave: null, distanza: Infinity, detto: new Set(), limite: 0 })

/**
 * Cosa dire adesso (o `null`), dato il passo attuale e quanto manca. Aggiorna `memoria`.
 * Funzione pura a parte `memoria`, così si prova senza voce (voiceGuidance.test.ts).
 */
export function daDire(step: Step | null, metri: number, memoria: Memoria, text: Strings): string | null {
  if (!step) {
    memoria.chiave = null
    memoria.distanza = Infinity
    return null
  }
  const chiave = chiaveDi(step)
  const prima = memoria.chiave === chiave ? memoria.distanza : Infinity
  let detto: string | null = null
  if (memoria.chiave !== chiave) {
    // Svolta nuova: la si annuncia subito, con la sua distanza.
    memoria.chiave = chiave
    detto = frase(step, metri, text)
    memoria.detto.add(`${chiave}@inizio`)
    if (metri < ADESSO_ENTRO) memoria.detto.add(`${chiave}@adesso`)
  } else if (metri < ADESSO_ENTRO && prima >= ADESSO_ENTRO && !memoria.detto.has(`${chiave}@adesso`)) {
    memoria.detto.add(`${chiave}@adesso`)
    detto = frase(step, metri, text)
  } else {
    for (const soglia of SOGLIE) {
      const nome = `${chiave}@${soglia}`
      if (metri <= soglia && prima > soglia && metri >= ADESSO_ENTRO && !memoria.detto.has(nome)) {
        memoria.detto.add(nome)
        detto = frase(step, metri, text)
        break
      }
    }
  }
  memoria.distanza = metri
  if (memoria.detto.size > 500) memoria.detto.clear()
  return detto
}

/** Il limite di velocità da annunciare quando cambia (km/h o mph come il profilo), o `null`. */
export function limiteDaDire(limiteMs: number, mph: boolean, memoria: Memoria): string | null {
  const limite = limiteMs > 0 ? Math.round((limiteMs * (mph ? 2.236936 : 3.6)) / 5) * 5 : 0
  const prima = memoria.limite
  memoria.limite = limite
  if (limite === 0 || limite === prima || prima === 0) return null
  return `Limite di velocità ${limite}.`
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
