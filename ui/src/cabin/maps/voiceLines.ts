/**
 * WestPlay Italia: le frasi del navigatore che parla (pure, senza voce: provate in voiceLines.test.ts). Legge ad alta voce le indicazioni svolta per svolta che il
 * cruscotto già mostra (guidance.ts), con la voce del sistema (Windows: "Microsoft Elsa" o "Isabella" per
 * l'italiano), più il cambio del limite di velocità e l'arrivo.
 *
 * Quando parla, per ogni svolta: appena la svolta diventa la prossima (con la sua distanza), poi quando
 * passa sotto i 2 km e sotto i 500 m, e "adesso" quando è a pochi metri. Una soglia si annuncia solo
 * quando la si attraversa venendo da più lontano, così all'avvio di un percorso non parte una raffica.
 */

import type { Strings } from '../state/strings'
import type { Step } from './guidance'

/** Soglie (metri, come li conta il gioco) a cui si annuncia la prossima svolta. */
export const SOGLIE = [2000, 500] as const
/** Sotto questa distanza la svolta si annuncia come "adesso". */
export const ADESSO_ENTRO = 60

/** Una distanza come si dice a voce: "300 metri", "1 chilometro", "2,5 chilometri". I valori sono arrotondati a
 * un insieme finito (vedi [`DISTANZE`]), così ogni frase possibile si registra in anticipo con la voce Paola. */
export function distanzaParlata(metri: number, decimale = ','): string {
  if (metri < 975) {
    const m = metri < 100 ? Math.max(10, Math.round(metri / 10) * 10) : Math.round(metri / 50) * 50
    return `${m} metri`
  }
  const km = metri / 1000
  if (km < 9.75) {
    const arrotondato = Math.round(km * 2) / 2
    if (arrotondato === 1) return '1 chilometro'
    const testo = Number.isInteger(arrotondato) ? String(arrotondato) : arrotondato.toFixed(1).replace('.', decimale)
    return `${testo} chilometri`
  }
  if (km < 97.5) return `${Math.max(10, Math.round(km / 5) * 5)} chilometri`
  return `${Math.min(500, Math.round(km / 10) * 10)} chilometri`
}

/** Tutte le distanze che [`distanzaParlata`] può dire (da 60 metri in su: sotto si dice solo l'istruzione). */
export function DISTANZE(): number[] {
  const metri: number[] = []
  for (let m = 60; m < 100; m += 10) metri.push(m)
  for (let m = 100; m <= 950; m += 50) metri.push(m)
  for (let km = 1; km <= 9.5; km += 0.5) metri.push(km * 1000)
  for (let km = 10; km <= 95; km += 5) metri.push(km * 1000)
  for (let km = 100; km <= 500; km += 10) metri.push(km * 1000)
  return metri
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


/** Tutte le frasi che il navigatore può dire, per registrarle in anticipo (tools/voce). */
export function tutteLeFrasi(text: Strings): string[] {
  const passi: Step[] = [{ kind: 'arrive' }]
  for (const turn of Object.keys(text.turns) as (keyof Strings['turns'])[]) {
    passi.push({ kind: 'turn', maneuver: { node: 0, turn, angle: 0, exit: null } })
  }
  for (let exit = 1; exit <= 8; exit++) passi.push({ kind: 'turn', maneuver: { node: 0, turn: 'roundabout', angle: 0, exit } })
  const frasi = new Set<string>(['Navigatore vocale attivo.'])
  for (const passo of passi) {
    frasi.add(frase(passo, 0, text))
    for (const metri of DISTANZE()) frasi.add(frase(passo, metri, text))
  }
  for (let limite = 5; limite <= 150; limite += 5) frasi.add(`Limite di velocità ${limite}.`)
  return [...frasi]
}

/** Il nome del file audio di una frase (FNV-1a a 32 bit, in esadecimale): lo stesso qui e in tools/voce. */
export function fileDellaFrase(testo: string): string {
  let h = 0x811c9dc5
  for (const byte of new TextEncoder().encode(testo)) {
    h ^= byte
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${h.toString(16).padStart(8, '0')}.ogg`
}
