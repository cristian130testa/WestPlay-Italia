import { describe, expect, it } from 'vitest'
import { stringsFor } from '../state/strings'
import type { Step } from './guidance'
import { daDire, distanzaParlata, frase, limiteDaDire, memoriaNuova } from './voiceGuidance'

const it_ = stringsFor('it_it')
const destra: Step = { kind: 'turn', maneuver: { node: 10, turn: 'right', angle: 90, exit: null } }
const rotonda: Step = { kind: 'turn', maneuver: { node: 20, turn: 'roundabout', angle: 0, exit: 2 } }
const arrivo: Step = { kind: 'arrive' }

describe('distanzaParlata', () => {
  it('dice metri e chilometri come a voce', () => {
    expect(distanzaParlata(40)).toBe('40 metri')
    expect(distanzaParlata(480)).toBe('500 metri')
    expect(distanzaParlata(1000)).toBe('1 chilometro')
    expect(distanzaParlata(2400)).toBe('2,5 chilometri')
    expect(distanzaParlata(2000)).toBe('2 chilometri')
    expect(distanzaParlata(23_400)).toBe('23 chilometri')
  })
})

describe('frase', () => {
  it('annuncia la svolta con la distanza', () => {
    expect(frase(destra, 500, it_)).toBe('Tra 500 metri, svolta a destra.')
    expect(frase(rotonda, 2000, it_)).toBe('Tra 2 chilometri, alla rotonda, prendi la seconda uscita.')
  })
  it('da vicino dice solo cosa fare', () => {
    expect(frase(destra, 20, it_)).toBe('Svolta a destra.')
    expect(frase(arrivo, 10, it_)).toBe('Sei arrivato a destinazione.')
  })
})

describe('daDire', () => {
  it('annuncia una svolta nuova, poi le soglie attraversate, poi adesso, una volta sola', () => {
    const m = memoriaNuova()
    expect(daDire(destra, 3500, m, it_)).toBe('Tra 3,5 chilometri, svolta a destra.')
    expect(daDire(destra, 3000, m, it_)).toBeNull()
    expect(daDire(destra, 1990, m, it_)).toBe('Tra 2 chilometri, svolta a destra.')
    expect(daDire(destra, 1500, m, it_)).toBeNull()
    expect(daDire(destra, 490, m, it_)).toBe('Tra 500 metri, svolta a destra.')
    expect(daDire(destra, 300, m, it_)).toBeNull()
    expect(daDire(destra, 40, m, it_)).toBe('Svolta a destra.')
    expect(daDire(destra, 20, m, it_)).toBeNull()
    expect(daDire(rotonda, 800, m, it_)).toBe('Tra 800 metri, alla rotonda, prendi la seconda uscita.')
  })
  it('tace senza percorso', () => {
    const m = memoriaNuova()
    expect(daDire(null, 0, m, it_)).toBeNull()
  })
  it('non ripete una soglia se la distanza risale e riscende', () => {
    const m = memoriaNuova()
    daDire(destra, 3000, m, it_)
    expect(daDire(destra, 1900, m, it_)).not.toBeNull()
    daDire(destra, 2100, m, it_)
    expect(daDire(destra, 1900, m, it_)).toBeNull()
  })
})

describe('limiteDaDire', () => {
  it('annuncia solo i cambi di limite, non il primo', () => {
    const m = memoriaNuova()
    expect(limiteDaDire(25, false, m)).toBeNull()
    expect(limiteDaDire(25, false, m)).toBeNull()
    expect(limiteDaDire(13.89, false, m)).toBe('Limite di velocità 50.')
    expect(limiteDaDire(0, false, m)).toBeNull()
  })
})
