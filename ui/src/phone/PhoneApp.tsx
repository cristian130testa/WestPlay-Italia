import { useEffect } from 'react'
import { cabClock } from '../shared/host'
import { connectHost, useLive } from '../cabin/state/store'
import { followTimeZone } from '../cabin/state/timeZone'

/**
 * WestPlay Italia: lo schermo dell'iPhone 17 Pro in mano (tappa 2: la home). La pagina è catturata da WestPlay e
 * disegnata dal plugin nel telefono sopra la visuale del gioco; riceve gli stessi messaggi della cabina (ora del
 * gioco, missione, telemetria). L'isola dinamica la disegna il plugin, sopra: qui il suo posto resta libero.
 */

const GIORNI = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica']

function ora(minuti: number): string {
  const m = Math.floor(minuti) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function km(metri: number): string {
  if (metri >= 10_000) return `${Math.round(metri / 1000)} km`
  if (metri >= 1000) return `${(metri / 1000).toFixed(1).replace('.', ',')} km`
  return `${Math.max(0, Math.round(metri / 10) * 10)} m`
}

type Glifo = 'tel' | 'msg' | 'map' | 'yt' | 'mus' | 'bank' | 'fuel' | 'cam' | 'foto' | 'sos' | 'cal' | 'imp' | 'meteo'

const GLIFI: Record<Glifo, string> = {
  tel: '<path fill="#fff" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z"/>',
  msg: '<path fill="#fff" d="M12 3C6.5 3 2 6.6 2 11c0 2.5 1.4 4.7 3.7 6.2L5 21l4.2-2.3c.9.2 1.8.3 2.8.3 5.5 0 10-3.6 10-8s-4.5-8-10-8z"/>',
  map: '<path fill="#fff" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/>',
  yt: '<path fill="#fff" d="M9 7.5v9l7.5-4.5z"/>',
  mus: '<path fill="#fff" d="M19 3v12.5a3.5 3.5 0 1 1-2-3.2V7.2L9 8.9v8.6A3.5 3.5 0 1 1 7 14.3V5.5z"/>',
  bank: '<path fill="#fff" d="M12 2 2 7v2h20V7zM4 11v7h3v-7zm6.5 0v7h3v-7zM17 11v7h3v-7zM2 20v2h20v-2z"/>',
  fuel: '<path fill="#fff" d="M5 3h9a1 1 0 0 1 1 1v8h1.5a2 2 0 0 1 2 2v3.5a1 1 0 0 0 2 0V9l-2.5-2.5 1.4-1.4L22 8.6V17.5a3 3 0 0 1-6 0V14h-1v7H4V4a1 1 0 0 1 1-1zm1 2v5h7V5z"/>',
  cam: '<path fill="#fff" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/>',
  foto: '<g fill="none" stroke-width="2.4"><circle cx="12" cy="6.5" r="3.5" stroke="#ff9f0a"/><circle cx="17.5" cy="12" r="3.5" stroke="#30d158"/><circle cx="12" cy="17.5" r="3.5" stroke="#0a84ff"/><circle cx="6.5" cy="12" r="3.5" stroke="#ff453a"/></g>',
  sos: '<text x="12" y="16" text-anchor="middle" font-size="9" font-weight="800" fill="#fff" font-family="Inter Variable, Arial">SOS</text>',
  cal: '<rect x="3" y="4" width="18" height="17" rx="3" fill="#fff"/><rect x="3" y="4" width="18" height="5" rx="2" fill="#ff3b30"/>',
  imp: '<path fill="#fff" d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1L11 21h4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>',
  meteo: '<circle cx="9" cy="9" r="4" fill="#ffd60a"/><path fill="#fff" d="M7 20a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.4A4 4 0 0 1 17 20z"/>',
}

interface App {
  nome: string
  glifo: Glifo
  sfondo: string
}

const APP: App[] = [
  { nome: 'Mappe', glifo: 'map', sfondo: 'linear-gradient(135deg,#34a853 0 25%,#fbbc04 25% 50%,#4285f4 50% 75%,#ea4335 75%)' },
  { nome: 'YouTube', glifo: 'yt', sfondo: '#ff0000' },
  { nome: 'Banca', glifo: 'bank', sfondo: 'linear-gradient(135deg,#0e7a43,#0a3a24 60%,#9c1b27)' },
  { nome: 'Pieno', glifo: 'fuel', sfondo: 'linear-gradient(#ffb340,#ff8a00)' },
  { nome: 'Musica', glifo: 'mus', sfondo: 'linear-gradient(#fd5c76,#f2263f)' },
  { nome: 'Fotocamera', glifo: 'cam', sfondo: 'linear-gradient(#d1d1d6,#8e8e93)' },
  { nome: 'Foto', glifo: 'foto', sfondo: '#fff' },
  { nome: 'Calendario', glifo: 'cal', sfondo: '#fff' },
  { nome: 'Meteo', glifo: 'meteo', sfondo: 'linear-gradient(#4aa3ff,#1c6fd8)' },
  { nome: 'SOS', glifo: 'sos', sfondo: 'linear-gradient(#ff5b4f,#d70015)' },
  { nome: 'Impostazioni', glifo: 'imp', sfondo: 'linear-gradient(#a1a1a6,#636366)' },
]

const DOCK: App[] = [
  { nome: 'Telefono', glifo: 'tel', sfondo: 'linear-gradient(#5ef57a,#1fc93f)' },
  { nome: 'Messaggi', glifo: 'msg', sfondo: 'linear-gradient(#5ef57a,#1fc93f)' },
  { nome: 'Mappe', glifo: 'map', sfondo: APP[0].sfondo },
  { nome: 'YouTube', glifo: 'yt', sfondo: '#ff0000' },
]

function Icona({ app, etichetta = true }: { app: App; etichetta?: boolean }) {
  return (
    <div className="ip-app">
      <span className="ip-icona" style={{ background: app.sfondo }}>
        {/* eslint-disable-next-line react/no-danger -- glifi nostri, statici */}
        <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: GLIFI[app.glifo] }} />
      </span>
      {etichetta && <span className="ip-nome">{app.nome}</span>}
    </div>
  )
}

export function PhoneApp() {
  useEffect(() => connectHost(), [])
  useEffect(() => followTimeZone(), [])
  const minuti = useLive((state) => (state.telemetry ? cabClock(state.telemetry, state.clockShift) : null))
  const job = useLive((state) => state.job)
  const distanza = useLive((state) => state.telemetry?.navigationDistance ?? 0)
  const carburante = useLive((state) => state.telemetry?.fuel ?? null)

  return (
    <div className="ip">
      <div className="ip-stato">
        <span className="ip-ora">{minuti === null ? '--:--' : ora(minuti)}</span>
        <span className="ip-destra">
          <span className="ip-rete">5G</span>
          <span className="ip-batteria">
            <i />
          </span>
        </span>
      </div>

      <div className="ip-widget">
        {job?.active ? (
          <>
            <div className="ip-w-titolo">🚛 IN VIAGGIO</div>
            <div className="ip-w-grande">
              {job.destinationCity}
              {distanza > 0 ? ` · ${km(distanza)}` : ''}
            </div>
            <div className="ip-w-sotto">
              {job.cargo}
              {job.destinationCompany ? ` · ${job.destinationCompany}` : ''}
            </div>
          </>
        ) : (
          <>
            <div className="ip-w-titolo">🇮🇹 WESTPLAY ITALIA</div>
            <div className="ip-w-grande">
              {minuti === null ? 'In attesa del gioco' : `${GIORNI[Math.floor(minuti / 1440) % 7]}`}
            </div>
            <div className="ip-w-sotto">
              {carburante === null ? 'Avvia Euro Truck Simulator 2' : `Serbatoio: ${Math.round(carburante)} litri`}
            </div>
          </>
        )}
      </div>

      <div className="ip-griglia">
        {APP.map((app) => (
          <Icona key={app.nome} app={app} />
        ))}
      </div>

      <div className="ip-dock">
        {DOCK.map((app) => (
          <Icona key={app.nome} app={app} etichetta={false} />
        ))}
      </div>
      <div className="ip-barra" />
    </div>
  )
}
