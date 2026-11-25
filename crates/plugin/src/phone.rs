//! WestPlay Italia: il telefono in mano. Premendo il tasto del telefono (Ins, o quello scelto in WestPlay) un iPhone 17 Pro arancione
//! sale dal basso sopra la visuale del gioco, come se l'autista lo prendesse in mano; ripremendolo torna giù.
//!
//! Tappa 1: il telefono è disegnato dal plugin stesso (cornice, vetro, isola dinamica, una home di prova), in un
//! solo quadrilatero con uno shader che lo descrive per distanze (SDF), sopra il back buffer, subito prima che il
//! gioco lo presenti. Lo stato del gioco non si tocca: si lavora in un `ID3DDeviceContextState` nostro, scambiato
//! con quello del gioco e rimesso al suo posto dopo. Lo schermo vivo (una seconda pagina di WestPlay) è la tappa 2.

use std::ffi::c_void;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Instant;

use windows::Win32::Graphics::Direct3D::Fxc::{D3DCOMPILE_OPTIMIZATION_LEVEL3, D3DCompile};
use windows::Win32::Graphics::Direct3D::{D3D_PRIMITIVE_TOPOLOGY_TRIANGLESTRIP, D3D_SRV_DIMENSION_TEXTURE2D, ID3DBlob};
use windows::Win32::Graphics::Direct3D11::{
    D3D11_FILTER_MIN_MAG_MIP_LINEAR, D3D11_SAMPLER_DESC, D3D11_SHADER_RESOURCE_VIEW_DESC,
    D3D11_SHADER_RESOURCE_VIEW_DESC_0, D3D11_TEX2D_SRV, D3D11_TEXTURE_ADDRESS_CLAMP, ID3D11SamplerState,
    ID3D11ShaderResourceView,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_B8G8R8A8_UNORM_SRGB, DXGI_FORMAT_R8G8B8A8_UNORM_SRGB,
};
use windows::Win32::Graphics::Direct3D11::{
    D3D11_BIND_CONSTANT_BUFFER, D3D11_BLEND_DESC, D3D11_BLEND_INV_SRC_ALPHA, D3D11_BLEND_ONE, D3D11_BLEND_OP_ADD,
    D3D11_BUFFER_DESC, D3D11_COLOR_WRITE_ENABLE_ALL, D3D11_CULL_NONE, D3D11_FILL_SOLID, D3D11_RASTERIZER_DESC,
    D3D11_RENDER_TARGET_BLEND_DESC, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT, D3D11_VIEWPORT,
    ID3D11BlendState, ID3D11Buffer, ID3D11Device, ID3D11Device1, ID3D11DeviceContext1, ID3D11PixelShader,
    ID3D11RasterizerState, ID3D11RenderTargetView, ID3D11Texture2D, ID3D11VertexShader, ID3DDeviceContextState,
};
use windows::Win32::Graphics::Dxgi::IDXGISwapChain;
use windows::core::{Interface, PCSTR, s};

use westplay_shared::Keybind;

use crate::frame::FrameSource;
use crate::log;

/// Quanto dura la salita o la discesa (secondi).
const DURATA: f32 = 0.28;
/// Altezza del telefono rispetto all'immagine del gioco, e proporzioni dell'iPhone 17 Pro (71,9 × 150 mm).
const ALTEZZA: f32 = 0.74;
const PROPORZIONE: f32 = 71.9 / 150.0;
/// Dove sta il telefono in mano: il suo centro, in quote della larghezza; sotto, quanto spazio resta.
const CENTRO_X: f32 = 0.76;
const MARGINE_SOTTO: f32 = 0.05;
/// Il margine attorno al telefono per la sua ombra, in quote della sua larghezza.
const OMBRA: f32 = 0.12;

static IN_MANO: AtomicBool = AtomicBool::new(false);
/// Le pressioni del tasto del telefono già viste (keybinds.rs le conta).
static VISTE: AtomicU32 = AtomicU32::new(0);

struct Animazione {
    dal: Instant,
    da: f32,
    verso: f32,
}

static ANIMAZIONE: Mutex<Option<Animazione>> = Mutex::new(None);

/// Le risorse del telefono su un device del gioco (il suo indirizzo, per rifarle se il gioco ne crea un altro).
struct Risorse {
    device: usize,
    stato: ID3DDeviceContextState,
    vs: ID3D11VertexShader,
    ps: ID3D11PixelShader,
    costanti: ID3D11Buffer,
    blend: ID3D11BlendState,
    raster: ID3D11RasterizerState,
    campione: ID3D11SamplerState,
    /// La pagina del telefono (la sua texture condivisa) e la vista per leggerla, con la texture di cui è.
    fonte: FrameSource,
    vista: Option<(usize, ID3D11ShaderResourceView)>,
}

// SAFETY: usate solo dal thread che presenta i fotogrammi del gioco, sotto il Mutex.
unsafe impl Send for Risorse {}

static RISORSE: Mutex<Option<Risorse>> = Mutex::new(None);
/// Le risorse non si sono potute fare su questo device (non riprovare a ogni fotogramma).
static FALLITO: Mutex<usize> = Mutex::new(0);

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Costanti {
    /// Il quadrilatero in coordinate dello schermo (NDC): x0, y0 (in alto), x1, y1.
    rettangolo: [f32; 4],
    /// Le sue dimensioni in pixel, la larghezza del telefono in pixel, il margine dell'ombra in pixel.
    misure: [f32; 4],
    /// Il tempo (secondi), quanto è alzato (0..1).
    extra: [f32; 4],
}

const SHADER: &str = r#"
cbuffer C : register(b0) { float4 rettangolo; float4 misure; float4 extra; };
Texture2D schermoVivo : register(t0);
SamplerState campione : register(s0);
struct V { float4 pos : SV_Position; float2 uv : TEXCOORD0; };

V vs(uint id : SV_VertexID) {
    float2 t = float2(id & 1, id >> 1);
    V o;
    o.pos = float4(lerp(rettangolo.x, rettangolo.z, t.x), lerp(rettangolo.y, rettangolo.w, t.y), 0, 1);
    o.uv = t;
    return o;
}

float scatola(float2 p, float2 centro, float2 meta, float r) {
    float2 q = abs(p - centro) - meta + r;
    return length(max(q, 0)) + min(max(q.x, q.y), 0) - r;
}

float copre(float d) { return saturate(0.5 - d); }

float4 sopra(float4 sotto, float3 colore, float a) { return float4(lerp(sotto.rgb, colore, a), max(sotto.a, a)); }

float4 ps(V i) : SV_Target {
    float2 dim = misure.xy;
    float W = misure.z;
    float2 p = i.uv * dim;
    float2 c = dim * 0.5;
    float2 metaCorpo = float2(W, W / 0.47933) * 0.5;
    float r = W * 0.15;

    float dCorpo = scatola(p, c, metaCorpo, r);
    float4 col = float4(0, 0, 0, 0.45 * exp(-max(dCorpo, 0) / (W * 0.035)) * step(0, dCorpo));

    // La scocca in titanio arancione, più chiara sul bordo.
    float bordo = saturate(-dCorpo / (W * 0.03));
    float3 arancio = lerp(float3(0.95, 0.58, 0.30), float3(0.78, 0.38, 0.15), bordo);
    col = sopra(col, arancio, copre(dCorpo));

    // La cornice nera e il vetro.
    float bezel = W * 0.016;
    float dNero = scatola(p, c, metaCorpo - bezel, r - bezel);
    col = sopra(col, float3(0.01, 0.01, 0.012), copre(dNero));
    float vetro = W * 0.034;
    float2 metaSchermo = metaCorpo - vetro;
    float dSchermo = scatola(p, c, metaSchermo, r - vetro);

    // La home di prova: sfondo tricolore sfumato, una griglia di icone, il dock.
    float2 s = (p - (c - metaSchermo)) / (metaSchermo * 2);
    float3 sfondo = lerp(float3(0.0, 0.45, 0.22), float3(0.95, 0.94, 0.9), smoothstep(0.1, 0.5, s.x + s.y * 0.2));
    sfondo = lerp(sfondo, float3(0.78, 0.12, 0.17), smoothstep(0.55, 0.95, s.x + s.y * 0.2));
    sfondo *= 0.75;
    float3 schermo = sfondo;
    float lato = metaSchermo.x * 2;
    if (extra.z > 0.5) {
        // Lo schermo vivo: la pagina del telefono di WestPlay.
        schermo = schermoVivo.Sample(campione, saturate(s)).rgb;
    } else {
    float icona = lato * 0.16;
    float passo = lato * 0.225;
    float2 origine = c - metaSchermo + float2(lato * 0.1 + icona * 0.5, lato * 0.42);
    for (int riga = 0; riga < 5; riga++) {
        for (int col4 = 0; col4 < 4; col4++) {
            float2 centroIcona = origine + float2(col4 * passo, riga * passo * 1.18);
            float dIcona = scatola(p, centroIcona, icona * 0.5, icona * 0.24);
            float3 tinta = 0.55 + 0.45 * cos(6.2831 * (float(riga * 4 + col4) * 0.13 + float3(0, 0.33, 0.67)));
            schermo = lerp(schermo, tinta, copre(dIcona));
        }
    }
    float2 centroDock = float2(c.x, c.y + metaSchermo.y - lato * 0.2);
    float dDock = scatola(p, centroDock, float2(metaSchermo.x - lato * 0.04, lato * 0.13), lato * 0.1);
    schermo = lerp(schermo, float3(0.85, 0.85, 0.88), copre(dDock) * 0.35);
    // La barra della home.
    float dBarra = scatola(p, float2(c.x, c.y + metaSchermo.y - lato * 0.025), float2(lato * 0.18, lato * 0.007), lato * 0.007);
    schermo = lerp(schermo, float3(1, 1, 1), copre(dBarra) * 0.9);
    }
    // L'isola dinamica.
    float2 centroIsola = float2(c.x, c.y - metaSchermo.y + lato * 0.07);
    float dIsola = scatola(p, centroIsola, float2(lato * 0.16, lato * 0.046), lato * 0.046);
    schermo = lerp(schermo, float3(0, 0, 0), copre(dIsola));
    // Un riflesso leggero sul vetro.
    schermo += 0.05 * saturate(1 - length(s - float2(0.2, 0.1)) * 1.5);

    col = sopra(col, schermo, copre(dSchermo));
    return float4(col.rgb * col.a, col.a);
}
"#;

/// Una volta per fotogramma, prima che il gioco lo presenti: il tasto, l'animazione, il disegno.
///
/// # Safety
/// Dal `Present` del gioco, con la sua swap chain viva.
pub unsafe fn on_present(swapchain: *mut c_void) {
    tasto();
    let alzato = quanto_alzato();
    if alzato <= 0.0 {
        return;
    }
    // SAFETY: la swap chain del gioco, viva durante il suo Present (il contratto di chi chiama).
    unsafe {
        if let Some(swapchain) = IDXGISwapChain::from_raw_borrowed(&swapchain)
            && let Err(errore) = disegna(swapchain, alzato)
        {
            static DETTO: AtomicBool = AtomicBool::new(false);
            if !DETTO.swap(true, Ordering::Relaxed) {
                log!("[telefono] non disegnato: {errore}");
            }
        }
    }
}

fn tasto() {
    // Il tasto lo sceglie il giocatore nella finestra di WestPlay (Comandi → Telefono in mano); keybinds.rs ne conta
    // le pressioni, che qui diventano "prendi" e "posa".
    let Some(bridge) = crate::bridge::get() else { return };
    let contate = bridge.plugin.keybind_presses[Keybind::Phone as usize].load(Ordering::Acquire);
    let viste = VISTE.swap(contate, Ordering::AcqRel);
    if contate == viste || contate.wrapping_sub(viste) > 10 {
        return;
    }
    if contate.wrapping_sub(viste) % 2 == 0 {
        return;
    }
    let mano = !IN_MANO.load(Ordering::Relaxed);
    IN_MANO.store(mano, Ordering::Relaxed);
    let ora = quanto_alzato();
    *ANIMAZIONE.lock().unwrap_or_else(|e| e.into_inner()) =
        Some(Animazione { dal: Instant::now(), da: ora, verso: if mano { 1.0 } else { 0.0 } });
    log!("[telefono] {}", if mano { "in mano" } else { "posato" });
}

/// Quanto è alzato il telefono adesso: 0 posato, 1 in mano (con la curva della salita).
fn quanto_alzato() -> f32 {
    let animazione = ANIMAZIONE.lock().unwrap_or_else(|e| e.into_inner());
    let Some(a) = animazione.as_ref() else {
        return if IN_MANO.load(Ordering::Relaxed) { 1.0 } else { 0.0 };
    };
    let t = (a.dal.elapsed().as_secs_f32() / DURATA).min(1.0);
    let curva = 1.0 - (1.0 - t).powi(3);
    a.da + (a.verso - a.da) * curva
}

/// # Safety
/// Sul thread di rendering del gioco, durante il suo Present.
unsafe fn disegna(swapchain: &IDXGISwapChain, alzato: f32) -> windows::core::Result<()> {
    // SAFETY: chiamate D3D11 sugli oggetti del gioco e nostri, sul suo thread di rendering, con il suo stato
    // rimesso com'era alla fine (SwapDeviceContextState).
    unsafe {
        let back: ID3D11Texture2D = swapchain.GetBuffer(0)?;
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        back.GetDesc(&mut desc);
        let device: ID3D11Device = back.GetDevice()?;
        let mut risorse = RISORSE.lock().unwrap_or_else(|e| e.into_inner());
        let indirizzo = device.as_raw() as usize;
        if risorse.as_ref().is_none_or(|r| r.device != indirizzo) {
            let mut fallito = FALLITO.lock().unwrap_or_else(|e| e.into_inner());
            if *fallito == indirizzo {
                return Ok(());
            }
            match crea(&device) {
                Ok(nuove) => {
                    log!("[telefono] pronto");
                    *risorse = Some(nuove);
                }
                Err(errore) => {
                    *fallito = indirizzo;
                    return Err(errore);
                }
            }
        }
        let context = device.GetImmediateContext()?;
        let context1: ID3D11DeviceContext1 = context.cast()?;
        let Some(r) = risorse.as_mut() else { return Ok(()) };
        // Lo schermo vivo, se WestPlay lo manda (tappa 2); senza, la home di prova.
        let srgb = matches!(desc.Format, DXGI_FORMAT_B8G8R8A8_UNORM_SRGB | DXGI_FORMAT_R8G8B8A8_UNORM_SRGB);
        let vivo = match r.fonte.update(&device, &context) {
            Some((texture, _)) => {
                let chiave = texture.as_raw() as usize;
                if r.vista.as_ref().is_none_or(|(di, _)| *di != chiave) {
                    let mut vista: Option<ID3D11ShaderResourceView> = None;
                    let formato =
                        if srgb { DXGI_FORMAT_B8G8R8A8_UNORM_SRGB } else { DXGI_FORMAT_B8G8R8A8_UNORM };
                    let srv = D3D11_SHADER_RESOURCE_VIEW_DESC {
                        Format: formato,
                        ViewDimension: D3D_SRV_DIMENSION_TEXTURE2D,
                        Anonymous: D3D11_SHADER_RESOURCE_VIEW_DESC_0 {
                            Texture2D: D3D11_TEX2D_SRV { MostDetailedMip: 0, MipLevels: 1 },
                        },
                    };
                    device.CreateShaderResourceView(&texture, Some(&srv), Some(&mut vista))?;
                    r.vista = vista.map(|v| (chiave, v));
                }
                r.vista.is_some()
            }
            None => false,
        };
        let r = &*r;

        let (w, h) = (desc.Width as f32, desc.Height as f32);
        let alto = h * ALTEZZA;
        let largo = alto * PROPORZIONE;
        let ombra = largo * OMBRA;
        let cx = w * CENTRO_X;
        let sotto_in_mano = h - h * MARGINE_SOTTO;
        let sotto_posato = h + alto + ombra * 2.0;
        let fondo = sotto_posato + (sotto_in_mano - sotto_posato) * alzato;
        let (x0, x1) = (cx - largo / 2.0 - ombra, cx + largo / 2.0 + ombra);
        let (y0, y1) = (fondo - alto - ombra, fondo + ombra);
        let ndc_x = |x: f32| x / w * 2.0 - 1.0;
        let ndc_y = |y: f32| 1.0 - y / h * 2.0;
        let costanti = Costanti {
            rettangolo: [ndc_x(x0), ndc_y(y0), ndc_x(x1), ndc_y(y1)],
            misure: [x1 - x0, y1 - y0, largo, ombra],
            extra: [0.0, alzato, if vivo { 1.0 } else { 0.0 }, 0.0],
        };

        let mut rtv: Option<ID3D11RenderTargetView> = None;
        device.CreateRenderTargetView(&back, None, Some(&mut rtv))?;
        let Some(rtv) = rtv else { return Ok(()) };

        let mut del_gioco: Option<ID3DDeviceContextState> = None;
        context1.SwapDeviceContextState(&r.stato, Some(&mut del_gioco));
        context1.UpdateSubresource(&r.costanti, 0, None, std::ptr::from_ref(&costanti).cast(), 0, 0);
        context1.OMSetRenderTargets(Some(&[Some(rtv.clone())]), None);
        context1.OMSetBlendState(&r.blend, None, 0xffff_ffff);
        context1.RSSetState(&r.raster);
        context1.RSSetViewports(Some(&[D3D11_VIEWPORT {
            TopLeftX: 0.0,
            TopLeftY: 0.0,
            Width: w,
            Height: h,
            MinDepth: 0.0,
            MaxDepth: 1.0,
        }]));
        context1.IASetPrimitiveTopology(D3D_PRIMITIVE_TOPOLOGY_TRIANGLESTRIP);
        context1.IASetInputLayout(None);
        context1.VSSetShader(&r.vs, None);
        context1.PSSetShader(&r.ps, None);
        context1.VSSetConstantBuffers(0, Some(&[Some(r.costanti.clone())]));
        context1.PSSetConstantBuffers(0, Some(&[Some(r.costanti.clone())]));
        context1.PSSetSamplers(0, Some(&[Some(r.campione.clone())]));
        let vista = if vivo { r.vista.as_ref().map(|(_, v)| v.clone()) } else { None };
        context1.PSSetShaderResources(0, Some(&[vista]));
        context1.Draw(4, 0);
        context1.PSSetShaderResources(0, Some(&[None]));
        context1.OMSetRenderTargets(None, None);
        if let Some(gioco) = del_gioco {
            context1.SwapDeviceContextState(&gioco, None);
        }
        Ok(())
    }
}

/// # Safety
/// Con un device vivo del gioco.
unsafe fn crea(device: &ID3D11Device) -> windows::core::Result<Risorse> {
    // SAFETY: creazione di risorse su un device vivo; i blob compilati restano vivi finché servono.
    unsafe {
        let device1: ID3D11Device1 = device.cast()?;
        let livelli = [device.GetFeatureLevel()];
        let mut stato: Option<ID3DDeviceContextState> = None;
        device1.CreateDeviceContextState(
            0,
            &livelli,
            D3D11_SDK_VERSION,
            &ID3D11Device::IID,
            None,
            Some(&mut stato),
        )?;
        let stato = stato.ok_or_else(windows::core::Error::empty)?;

        let codice_vs = compila(s!("vs"), s!("vs_4_0"))?;
        let codice_ps = compila(s!("ps"), s!("ps_4_0"))?;
        let mut vs: Option<ID3D11VertexShader> = None;
        device.CreateVertexShader(blob(&codice_vs), None, Some(&mut vs))?;
        let mut ps: Option<ID3D11PixelShader> = None;
        device.CreatePixelShader(blob(&codice_ps), None, Some(&mut ps))?;

        let mut costanti: Option<ID3D11Buffer> = None;
        device.CreateBuffer(
            &D3D11_BUFFER_DESC {
                ByteWidth: size_of::<Costanti>() as u32,
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: D3D11_BIND_CONSTANT_BUFFER.0 as u32,
                ..Default::default()
            },
            None,
            Some(&mut costanti),
        )?;

        let mut blend_desc = D3D11_BLEND_DESC::default();
        blend_desc.RenderTarget[0] = D3D11_RENDER_TARGET_BLEND_DESC {
            BlendEnable: true.into(),
            SrcBlend: D3D11_BLEND_ONE,
            DestBlend: D3D11_BLEND_INV_SRC_ALPHA,
            BlendOp: D3D11_BLEND_OP_ADD,
            SrcBlendAlpha: D3D11_BLEND_ONE,
            DestBlendAlpha: D3D11_BLEND_INV_SRC_ALPHA,
            BlendOpAlpha: D3D11_BLEND_OP_ADD,
            RenderTargetWriteMask: D3D11_COLOR_WRITE_ENABLE_ALL.0 as u8,
        };
        let mut blend: Option<ID3D11BlendState> = None;
        device.CreateBlendState(&blend_desc, Some(&mut blend))?;

        let mut raster: Option<ID3D11RasterizerState> = None;
        device.CreateRasterizerState(
            &D3D11_RASTERIZER_DESC {
                FillMode: D3D11_FILL_SOLID,
                CullMode: D3D11_CULL_NONE,
                DepthClipEnable: true.into(),
                ..Default::default()
            },
            Some(&mut raster),
        )?;

        let mut campione: Option<ID3D11SamplerState> = None;
        device.CreateSamplerState(
            &D3D11_SAMPLER_DESC {
                Filter: D3D11_FILTER_MIN_MAG_MIP_LINEAR,
                AddressU: D3D11_TEXTURE_ADDRESS_CLAMP,
                AddressV: D3D11_TEXTURE_ADDRESS_CLAMP,
                AddressW: D3D11_TEXTURE_ADDRESS_CLAMP,
                MaxLOD: f32::MAX,
                ..Default::default()
            },
            Some(&mut campione),
        )?;

        let vuoto = windows::core::Error::empty;
        Ok(Risorse {
            device: device.as_raw() as usize,
            stato,
            vs: vs.ok_or_else(vuoto)?,
            ps: ps.ok_or_else(vuoto)?,
            costanti: costanti.ok_or_else(vuoto)?,
            blend: blend.ok_or_else(vuoto)?,
            raster: raster.ok_or_else(vuoto)?,
            campione: campione.ok_or_else(vuoto)?,
            fonte: FrameSource::telefono(),
            vista: None,
        })
    }
}

/// # Safety
/// Il blob è vivo per tutto il tempo in cui si usa la fetta.
unsafe fn blob(codice: &ID3DBlob) -> &[u8] {
    // SAFETY: il puntatore e la lunghezza sono del blob, vivo quanto il riferimento.
    unsafe { std::slice::from_raw_parts(codice.GetBufferPointer() as *const u8, codice.GetBufferSize()) }
}

/// # Safety
/// Chiama il compilatore di shader di Windows (d3dcompiler_47).
unsafe fn compila(ingresso: PCSTR, profilo: PCSTR) -> windows::core::Result<ID3DBlob> {
    // SAFETY: il sorgente è una stringa statica; gli out-param sono nostri.
    unsafe {
        let mut codice: Option<ID3DBlob> = None;
        let mut errori: Option<ID3DBlob> = None;
        let esito = D3DCompile(
            SHADER.as_ptr() as *const c_void,
            SHADER.len(),
            s!("telefono.hlsl"),
            None,
            None,
            ingresso,
            profilo,
            D3DCOMPILE_OPTIMIZATION_LEVEL3,
            0,
            &mut codice,
            Some(&mut errori),
        );
        if let Err(errore) = esito {
            if let Some(errori) = errori {
                log!("[telefono] shader: {}", String::from_utf8_lossy(blob(&errori)));
            }
            return Err(errore);
        }
        codice.ok_or_else(windows::core::Error::empty)
    }
}
