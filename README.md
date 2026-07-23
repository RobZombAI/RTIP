<div align="center">
  <pre>
██████╗ ████████╗██╗██████╗
██╔══██╗╚══██╔══╝██║██╔══██╗
██████╔╝   ██║   ██║██████╔╝
██╔══██╗   ██║   ██║██╔═══╝
██║  ██║   ██║   ██║██║
╚═╝  ╚═╝   ╚═╝   ╚═╝╚═╝
  </pre>
  <h1>📖 RTIP — ReadingTextImgPdf</h1>
  <p><b>AI OCR + Document Reader for macOS</b><br>
  Extract text from images & PDFs · Analyze with LLM · 100% local · Open Source</p>

  <p>
    <img src="https://img.shields.io/badge/macOS-Sequoia-blue?logo=apple">
    <img src="https://img.shields.io/badge/Apple_Silicon-M5_Max-8A2BE2?logo=apple">
    <img src="https://img.shields.io/badge/license-MIT-green">
    <img src="https://img.shields.io/badge/python-3.10+-yellow?logo=python">
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen">
  </p>
</div>

---

## ✨ What is RTIP?

**RTIP** is a native macOS app that turns your Mac into an AI-powered reading workstation.  
100% local — no cloud, no API keys, no data leaves your machine.

| Feature | What it does |
|---------|-------------|
| 🖼️ **OCR** | Extract text from images and PDFs — **LightOnOCR-2-1B** (SOTA, 1B params) |
| 📖 **Read** | Chat with an LLM to analyze documents (**Agents A1**, 256×2.6B MoE) |

### 🧠 Intelligent Model Lifecycle

- **Only ONE model loaded at a time** — switch tab, the other unloads
- **Manual start/stop** — buttons in the status bar for each model
- **Auto-cleanup** — all processes killed on app close
- **First-run auto-install** — dependencies install automatically

---

## 🚀 Quick Start

### Prerequisites

- macOS Sequoia+ on Apple Silicon
- [Homebrew](https://brew.sh)
- `brew install llama.cpp`
- [Download Agents A1 GGUF](https://huggingface.co/robzombai/Agents-A1-GGUF) in `~/Downloads/`

### Launch

```bash
open ~/Applications/RTIP.app
```

The app auto-installs missing Python packages on first run (torch, transformers, etc.).

---

## 🎮 Usage

### Status Bar

Shows real-time status of both models:
- 🟢 **Loaded** — model active in memory
- 🟡 **Loading** — model loading in progress
- ⚪ **Unloaded** — not in memory (zero RAM)
- ▶ **Start** / ⏹ **Stop** buttons — manual control

### OCR 🖼️

1. Click the drop zone to select an image or PDF
2. Click **OCR**
3. Get clean text — copy, save, or send to Read tab

### Read 📖

1. Load a file or OCR an image
2. Type questions: *"Summarize this"*, *"Extract dates and names"*
3. Agents A1 analyzes and responds

---

## 🧠 Models

### LightOnOCR-2-1B (OCR)

| Property | Value |
|----------|-------|
| Architecture | Mistral3-based VLM |
| Parameters | **1B** |
| GPU RAM | ~2 GB |
| Inference | PyTorch/MPS (Apple GPU) |
| Speed | State-of-the-art on OlmOCR-Bench |

### Agents A1 (LLM)

| Property | Value |
|----------|-------|
| Architecture | Qwen 3.5 MoE |
| Parameters | 256×2.6B (8 active per token) |
| Size | **34 GB** Q8_0 |
| Context | 262k tokens |
| Engine | llama.cpp Metal |

---

## 🔧 Development

```bash
git clone https://github.com/RobZombAI/RTIP.git
cd RTIP
./build.sh     # Build RTIP.app
python3 sources/main.py  # Run directly
```

### Project Structure

```
RTIP/
├── RTIP.app/              # macOS app bundle
├── sources/
│   ├── main.py            # App entry + API
│   ├── lighton_ocr.py     # LightOnOCR wrapper (PyTorch/MPS)
│   └── resources/
│       ├── index.html     # UI
│       └── api.js         # Frontend logic
├── build.sh               # Build script
└── output/                # OCR results
```

---

## 📜 License

MIT — use, modify, share. See [LICENSE](LICENSE).

---

## 🙏 Acknowledgments

- **[LightOnOCR-2-1B](https://huggingface.co/lightonai/LightOnOCR-2-1B)** — OCR model by LightOn AI
- **[Agents A1](https://huggingface.co/robzombai/Agents-A1-GGUF)** — LLM model
- **[llama.cpp](https://github.com/ggml-org/llama.cpp)** — LLM inference engine
- **[pywebview](https://pywebview.flowrl.com/)** — UI framework

---

<p align="center">
  Made with ❤️ for the open-source community<br>
  <sub>No cloud, no tracking, no API keys — just your Mac doing the work.</sub>
</p>
