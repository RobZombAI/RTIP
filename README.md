<div align="center">
  <h1>📖 RTIP — ReadingTextImgPdf</h1>
  <p><b>AI OCR · PDF Reader · Translate · Summarize</b><br>
  Tutto locale. Nessuna API key. Nessun cloud.</p>
  <p>
    <img src="https://img.shields.io/badge/macOS-Sequoia-blue?logo=apple">
    <img src="https://img.shields.io/badge/license-MIT-green">
    <img src="https://img.shields.io/badge/python-3.10+-yellow?logo=python">
  </p>
</div>

---

## ✨ Cosa fa

| Cosa | Come |
|------|------|
| 🖼️ **OCR immagini** | LightOnOCR-2-1B estrae testo da foto, screenshot, scan |
| 📄 **Legge PDF** | Estrae il testo direttamente (PyMuPDF) — zero GPU |
| 🌐 **Traduce** in 20 lingue | Agents A1 traduce tutto il documento |
| 📝 **Riassume** | Punti chiave in 3-5 bullet |
| ✏️ **Riscrive** | Stile professionale o personale |
| 💬 **Chatta** col documento | Fai domande, ottieni risposte |
| 📂 **Sessioni** | Cronologia, riapri estrazioni passate |

## 🚀 Primo avvio

```bash
open ~/Applications/RTIP.app
```

L'app:
1. **Rileva la RAM** del tuo Mac
2. **Carica i modelli** che il tuo Mac può supportare
3. Se hai **≥ 48GB RAM** → Agents A1 si attiva (traduzione, riassunto, chat)
4. Se hai **≥ 4GB RAM** → OCR funziona sempre
5. Se Agents A1 non è scaricato ma il Mac lo supporta → pulsante **Download**

## 📖 Come si usa

### Immagine
1. Clicca la drop zone → seleziona immagine
2. Clicca **🔍 OCR**
3. Testo estratto → navigabile, copiabile

### PDF
1. Seleziona PDF
2. Clicca **📝 Extract text**
3. Testo in 1 secondo → navigabile pagina per pagina

### Dopo l'estrazione
| Bottone | Cosa fa |
|---------|---------|
| 🌐 Translate | Traduce in 1 di 20 lingue |
| 📝 Summarize | Riassume in punti chiave |
| ✏️ Rewrite | Riscrive in stile professionale |
| 💬 Chat | Fai domande sul testo |

### Altro
- **⏹ STOP** in alto o tasto **Esc** → ferma qualsiasi operazione
- **Sidebar** → cronologia sessioni, riaprile, cancellale
- **📋 Copy** → copia il testo visualizzato

## 🧠 Modelli usati

| Modello | Cosa fa | RAM | Scende se |
|---------|---------|-----|-----------|
| **LightOnOCR-2-1B** | OCR immagini | ~2 GB | Sempre disponibile |
| **Agents A1** (34B Q8) | Traduci, riassumi, chat | ~35 GB | Solo ≥ 48GB RAM |

## 🏗️ Progetto

```
RTIP/
├── RTIP.app/              # App macOS (trascina in Applicazioni)
├── sources/
│   ├── main.py            # Entry point + API + session manager
│   ├── lighton_ocr.py     # LightOnOCR (PyTorch/MPS)
│   └── resources/
│       ├── index.html     # UI
│       └── api.js         # Frontend
├── build.sh               # Compila RTIP.app
└── README.md
```

### Build da sorgente

```bash
git clone https://github.com/RobZombAI/RTIP.git
cd RTIP
./build.sh
```

## 📜 Licenza

MIT — usa, modifica, condividi.

---

<p align="center"><sub>Niente cloud. Niente API key. Solo il tuo Mac.</sub></p>
