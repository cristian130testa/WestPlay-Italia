"""WestPlay Italia: registra tutte le frasi del navigatore con la voce italiana "Paola" di Piper (CC0).

Uso: python genera.py <frasi.json> <modello.onnx> <cartella di uscita>
Scrive un file .ogg (Opus) per frase, con il nome che gli dà fileDellaFrase (voiceLines.ts), più indice.json.
Il testo registrato ha i numeri in lettere, come li dice un navigatore: "Tra 2,5 chilometri" diventa
"Tra due chilometri e mezzo", "1 chilometro" diventa "un chilometro".
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import wave

UNITA = ["zero", "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove", "dieci",
         "undici", "dodici", "tredici", "quattordici", "quindici", "sedici", "diciassette", "diciotto", "diciannove"]
DECINE = ["", "", "venti", "trenta", "quaranta", "cinquanta", "sessanta", "settanta", "ottanta", "novanta"]


def in_lettere(n: int) -> str:
    """Un numero da 0 a 999 in lettere, all'italiana (ventuno, ventotto, centotto)."""
    if n < 20:
        return UNITA[n]
    if n < 100:
        decina, unita = divmod(n, 10)
        parola = DECINE[decina]
        if unita in (1, 8):
            parola = parola[:-1]
        return parola + (UNITA[unita] if unita else "")
    centinaia, resto = divmod(n, 100)
    parola = "cento" if centinaia == 1 else UNITA[centinaia] + "cento"
    if resto == 0:
        return parola
    coda = in_lettere(resto)
    if coda.startswith("o") and resto >= 80 and resto < 90:
        parola = parola[:-1]
    return parola + coda


def distanza(m: re.Match) -> str:
    intero, mezzo, unita = int(m.group(1)), m.group(2), m.group(3)
    if unita == "chilometro" and intero == 1 and not mezzo:
        return "un chilometro"
    testo = f"{in_lettere(intero)} {unita}"
    if mezzo == "5":
        testo += " e mezzo"
    return testo


def parlato(testo: str) -> str:
    testo = re.sub(r"(\d+)(?:,(\d))? (metri|chilometri|chilometro)", distanza, testo)
    testo = re.sub(r"\d+", lambda m: in_lettere(int(m.group(0))), testo)
    return testo


def registra(voce, testo: str, percorso: str) -> None:
    with wave.open(percorso, "wb") as wav:
        if hasattr(voce, "synthesize_wav"):  # piper-tts 1.3 e successivi
            voce.synthesize_wav(testo, wav)
        else:  # piper-tts 1.2
            voce.synthesize(testo, wav)


def main() -> None:
    frasi_json, modello, uscita = sys.argv[1:4]
    from piper import PiperVoice

    voce = PiperVoice.load(modello)
    os.makedirs(uscita, exist_ok=True)
    frasi = json.load(open(frasi_json, encoding="utf-8"))
    with tempfile.TemporaryDirectory() as tmp:
        for i, frase in enumerate(frasi):
            wav = os.path.join(tmp, "frase.wav")
            registra(voce, parlato(frase["testo"]), wav)
            subprocess.run(
                ["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-ac", "1", "-c:a", "libopus", "-b:a", "32k",
                 os.path.join(uscita, frase["file"])],
                check=True,
            )
            if i % 200 == 0:
                print(f"{i}/{len(frasi)}: {frase['testo']} -> {parlato(frase['testo'])}", flush=True)
    with open(os.path.join(uscita, "indice.json"), "w", encoding="utf-8") as indice:
        json.dump(sorted(f["file"] for f in frasi), indice)
    print(f"Fatto: {len(frasi)} frasi in {uscita}")


if __name__ == "__main__":
    main()
