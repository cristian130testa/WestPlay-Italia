/**
 * WestPlay Italia: la chiave della voce Google del navigatore, come la manda l'app (Impostazioni del PC →
 * Mappa → Navigatore vocale). Vuota: il navigatore parla con la voce di Windows. Un modulo a sé, senza
 * dipendenze, perché lo usano sia lo store (che la riceve) sia la voce (che la usa).
 */

let chiave = ''

export function setGoogleVoiceKey(key: string): void {
  chiave = key.trim()
}

export function googleVoiceKey(): string {
  return chiave
}
