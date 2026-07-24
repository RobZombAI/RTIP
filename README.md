<div align="center">
  <h1>📖 RTIP — ReadingTextImgPdf</h1>
  <p><b>AI OCR · PDF Reader · Video Temporal Grounding</b><br>
  Tutto locale. Nessuna API key. Nessun cloud.</p>
  <p>
    <img src="https://img.shields.io/badge/macOS-Sequoia-blue?logo=apple">
    <img src="https://img.shields.io/badge/C%2B%2B-17-00599C?logo=c%2B%2B">
    <img src="https://img.shields.io/badge/license-MIT-green">
  </p>
</div>

---

## ✨ Cosa fa

| Cosa | Come | Tecnologia |
|------|------|-----------|
| 🖼️ **OCR immagini** | Estrae testo da foto, screenshot, scan | LightOnOCR-2-1B (MPS) |
| 📄 **Legge PDF** | Estrae testo direttamente — zero GPU | PyMuPDF |
| 🌐 **Traduce** in 20 lingue | Agents A1 (llama.cpp) |
| 📝 **Riassume / Riscrive** | Punti chiave, stile professionale | Agents A1 |
| 💬 **Chatta** col documento | Contesto: file intero | Agents A1 |
| 🎬 **TimeLens2-8B** | Trova scene in video da query testuale | Qwen3-VL-8B (MPS) |
| 📂 **Sessioni** | Cronologia, riapri estrazioni passate | JSON-based |

## 🏗️ Architettura

```
┌─────────────────────────────────────────────────┐
│  C++ Server (httplib) :8080                     │
│  - Serve frontend web                           │
│  - REST API                                     │
│  - Process management (respawn worker morti)    │
│  - Session manager                              │
├─────────────────────────────────────────────────┤
│  Python Workers (subprocess)                    │
│  ┌──────────────┐  ┌──────────────────┐         │
│  │ OCR Worker   │  │ TimeLens Worker  │         │
│  │ :9101        │  │ :9102            │         │
│  │ LightOnOCR   │  │ Qwen3-VL-8B MPS  │         │
│  └──────────────┘  └──────────────────┘         │
│  ┌──────────────────────────────────┐            │
│  │ llama-server :8081               │            │
│  │ Agents A1 (34B Q8 GGUF)          │            │
│  └──────────────────────────────────┘            │
├─────────────────────────────────────────────────┤
│  Frontend (HTML/CSS/JS) — Browser                │
│  - 📄 Document: OCR/PDF/LLM                     │
│  - 🎬 Video: timeline + player                  │
│  - Dark modern theme                            │
└─────────────────────────────────────────────────┘
```

## 🚀 Quick Start

```bash
# 1. Build
cd ~/RTIP
./build.sh

# 2. Avvia
./rtip

# 3. Apri nel browser
open http://127.0.0.1:8080
```

### Prerequisiti

- **macOS** (Apple Silicon M-series)
- **Xcode Command Line Tools**: `xcode-select --install`
- **Homebrew**: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
- **Python 3.10+ con venv** (quello usato da RTIP è `~/qwen3-tts-ui/venv`)

### Dipendenze (automatiche)

| Pacchetto | Installato da |
|-----------|-------------|
| `cpp-httplib` | brew |
| `nlohmann-json` | brew |
| `torch`, `transformers`, `qwen-vl-utils` | pip nel venv |
| `torchcodec` | auto-install dal worker |
| `llama-server` | via brew o già in PATH |

## 🎮 Come si usa

### 📄 Document
1. Vai al tab **📄 Document**
2. Clicca la drop zone → seleziona immagine (PNG/JPG) o PDF
3. Clicca **▶ Process**:
   - Immagine → OCR con LightOnOCR-2-1B
   - PDF → estrazione testo con PyMuPDF
4. Post-elaborazione: 🌐 Translate / 📝 Summarize / ✏️ Rewrite / 💬 Chat

### 🎬 Video (TimeLens2-8B)
1. Vai al tab **🎬 Video**
2. Clicca la drop zone → seleziona video MP4/MOV
3. Il video appare in **anteprima** con player
4. Scrivi una query in italiano o inglese (es. `"una persona apre la porta"`)
5. Clicca **🎯 Analyze**
6. La timeline mostra i segmenti trovati — **clicca per riprodurre**

#### Interazione timeline
| Azione | Cosa fa |
|--------|---------|
| Clicca segmento viola | Salta a quel punto nel video |
| Clicca lista intervalli | Riproduce solo quel segmento |
| ▶ Play All | Riproduce tutti i segmenti in sequenza |
| ◀ ▶ Prev/Next | Salta tra segmenti |
| ⏱️ Time label | Tempo corrente aggiornato live |
| 📊 Progress bar | Quanto manca alla fine del segmento |

## 🧠 Modelli usati

| Modello | Cosa fa | RAM | Autoload |
|---------|---------|-----|----------|
| **LightOnOCR-2-1B** | OCR immagini | ~2 GB | All'avvio |
| **Agents A1** (34B Q8 GGUF) | Traduci, riassumi, chat | ~35 GB | All'avvio |
| **TimeLens2-8B** | Video temporal grounding | ~16 GB | Background all'avvio |

## 📁 Struttura

```
~/RTIP/
├── server/
│   ├── main.cpp          # C++ HTTP server (httplib)
│   ├── Makefile          # Build C++
│   └── frontend/         # Static files
│       ├── index.html    # UI
│       ├── style.css     # Dark theme
│       └── app.js        # SPA logic
├── workers/
│   ├── ocr_worker.py     # LightOnOCR worker
│   └── timelens_worker.py # TimeLens2 worker
├── build.sh              # Build all
├── rtip                  # Launcher
└── README.md
```

## ⚙️ Configurazione

| Variabile | Default | Descrizione |
|-----------|---------|-------------|
| `LLM_MODEL` | `~/Downloads/Agents-A1-Q8_0.gguf` | Path modello LLM |
| `PORT` | `8080` | Porta server HTTP |

## 🔧 Troubleshooting

| Problema | Soluzione |
|----------|-----------|
| **Porta 8080 occupata** | `kill -9 $(lsof -ti :8080)` e riavvia |
| **TimeLens non pronto** | Aspetta che il modello finisca di caricarsi (16GB, ~1-2min) |
| **OCR non trova il modello** | `pip install lighton-ocr` nel venv |
| **Worker morto** | Il server lo respawna automaticamente ogni 10s |
| **MPS buffer error** | Parametri video già ridotti; per video molto lunghi prova query più brevi |

## 📜 Licenza

MIT — usa, modifica, condividi.

---

<p align="center"><sub>Niente cloud. Niente API key. Solo il tuo Mac.</sub></p>
