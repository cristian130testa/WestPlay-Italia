// WestPlay Italia: scrive l'elenco di tutte le frasi del navigatore (testo e nome del file audio), da registrare
// con la voce Paola di Piper (genera.py). Uso: node tools/voce/frasi.mts <file.json>
import { writeFileSync } from 'node:fs'
import { strings } from '../../ui/src/cabin/state/strings/it_it.ts'
import { fileDellaFrase, tutteLeFrasi } from '../../ui/src/cabin/maps/voiceLines.ts'

const frasi = tutteLeFrasi(strings).map((testo) => ({ file: fileDellaFrase(testo), testo }))
writeFileSync(process.argv[2] ?? 'frasi.json', JSON.stringify(frasi, null, 1))
console.log(`${frasi.length} frasi`)
