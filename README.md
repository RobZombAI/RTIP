<div align="center">
  <br>
  <pre>
██████╗ ████████╗██╗██████╗
██╔══██╗╚══██╔══╝██║██╔══██╗
██████╔╝   ██║   ██║██████╔╝
██╔══██╗   ██║   ██║██╔═══╝
██║  ██║   ██║   ██║██║
╚═╝  ╚═╝   ╚═╝   ╚═╝╚═╝
  </pre>
  <h1 align="center">📖 RTIP — ReadingTextImgPdf</h1>
  <p align="center">
    <b>AI-powered OCR + Document Reader for macOS</b><br>
    Extract text from images & PDFs · Analyze documents with LLM · All local
  </p>

  <p align="center">
    <img src="https://img.shields.io/badge/macOS-Sequoia-blue?logo=apple">
    <img src="https://img.shields.io/badge/Apple_Silicon-M5_Max-8A2BE2?logo=apple">
    <img src="https://img.shields.io/badge/license-MIT-green">
    <img src="https://img.shields.io/badge/python-3.9%2B-yellow?logo=python">
    <img src="https://img.shields.io/badge/models-local_GGUF-orange">
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen">
  </p>
</div>

---

## ✨ What is RTIP?

**RTIP** is a native macOS app that turns your Mac into an AI-powered reading and OCR workstation. All processing happens **100% locally** — no cloud, no API keys, no data leaves your machine.

| Feature | What it does |
|---------|-------------|
| 🖼️ **OCR** | Extract text from images and scanned PDFs (Baidu **Unlimited-OCR**, 3B params) |
| 📖 **Read** | Chat with an LLM to analyze documents, summarize, extract data (**Agents A1**, 256×2.6B MoE) |
| 📄 **PDF** | Extract text, OCR scanned pages, or send directly to AI for analysis |

### 🧠 Why it's special

- **Intelligent model lifecycle** — only ONE model loads at a time. Switch from OCR to Read: the LLM unloads (frees 34GB), OCR loads (3.9GB). Switch back: OCR unloads, LLM reloads. **Minimal RAM/VRAM usage always.**
- **Idle timeout** — models auto-unload after 5 minutes of inactivity
- **One-click** — open the app, pick a file, start
- **Runs on Apple Silicon** — optimized for Metal GPU via llama.cpp

---

## 🚀 Quick Start (2 minutes)

### Prerequisites

- **macOS Sequoia** (or later)
- **Apple Silicon Mac** (M1–M5) with 16GB+ RAM
- **Homebrew** installed
- **~50 GB free disk** for models

### 1. Install llama.cpp

```bash
brew install llama.cpp
```

### 2. Download the models

```bash
# Unlimited-OCR model (3.1 GB)
mkdir -p ~/unlimited-ocr/gguf
cd ~/unlimited-ocr/gguf
curl -L -o Unlimited-OCR-Q8_0.gguf "https://huggingface.co/robzombai/unlimited-ocr-gguf/resolve/main/Unlimited-OCR-Q8_0.gguf"
curl -L -o mmproj-Unlimited-OCR-F16.gguf "https://huggingface.co/robzombai/unlimited-ocr-gguf/resolve/main/mmproj-Unlimited-OCR-F16.gguf"

# Agents A1 model (34 GB)
curl -L -o ~/Downloads/Agents-A1-Q8_0.gguf "https://huggingface.co/robzombai/Agents-A1-GGUF/resolve/main/Agents-A1-Q8_0.gguf"
```

> ⚠️ **Agents A1 is 34 GB** — download only on fast internet. Alternatively, use any GGUF model of your choice (see [Custom Models](#-using-custom-models))

### 3. Launch RTIP

```bash
open ~/Applications/RTIP.app
```

That's it. The app starts, loads the first model, and you're ready.

---

## 🎮 How to use

### Tab 1: OCR 🖼️

1. Click the drop zone or drag an image/PDF
2. (Optional) Change the prompt — default is `document parsing.`
3. Click **OCR**
4. Get clean text, copy, or save automatically

### Tab 2: Read/Ask 📖

1. Load a file (text or image → auto-OCR'd)
2. Type your question: *"Summarize this document"*, *"Extract all dates and names"*
3. Agents A1 analyzes the content and answers

### Tab 3: PDF 📄

| Button | What it does |
|--------|-------------|
| 📝 **Extract text** | Direct text extraction from digital PDFs |
| 🔍 **OCR PDF** | Switches to OCR tab to process scanned pages |
| 🤖 **Analyze** | Extracts text then opens Read tab for AI analysis |

### Memory-Smart Switching

When you switch tabs, RTIP automatically:
- ❌ **Unloads the previous model** (frees GPU memory)
- ✅ **Loads the needed model** (typically 3–8 seconds on M5 Max)
- ⏳ **Shows a loading spinner** during model swap

> On idle for 5+ minutes, models auto-unload to keep memory free.

---

## ⚙️ Using Custom Models

You can swap in any GGUF model:

1. Place your model somewhere on disk
2. Edit `~/rtip-app/sources/main.py`:
```python
OCR_MODEL = HOME / 'your-path' / 'your-model.gguf'
OCR_MMPROJ = HOME / 'your-path' / 'your-mmproj.gguf'
LLM_MODEL = HOME / 'your-path' / 'your-llm.gguf'
```
3. Rebuild with `~/rtip-app/build.sh`

---

## 🧠 Model Details

### Unlimited-OCR

| Property | Value |
|----------|-------|
| Architecture | Qwen2-based MoE |
| Parameters | 3B (64 experts, 6 active per token) |
| Quantization | Q8_0 |
| Size on disk | 3.1 GB |
| GPU RAM | ~3.9 GB |
| Load time (M5 Max) | ~2 seconds |

### Agents A1

| Property | Value |
|----------|-------|
| Architecture | Qwen 3.5 MoE |
| Parameters | 256×2.6B (256 experts, 8 active per token) |
| Quantization | Q8_0 |
| Size on disk | 34 GB |
| GPU RAM | ~35 GB |
| Load time (M5 Max) | ~4 seconds |
| Context length | 262,144 tokens |

---

## 🏗️ Project Structure

```
rtip-app/
├── RTIP.app/              # The macOS app (drag to Applications)
│   └── Contents/
│       ├── MacOS/RTIP     # Launcher script
│       ├── Info.plist     # App metadata
│       └── Resources/
│           ├── main.py    # Python backend + API
│           ├── index.html # UI
│           └── api.js     # Frontend logic
├── sources/               # Source code
│   ├── main.py
│   └── resources/
│       ├── index.html
│       └── api.js
├── build.sh               # Build the .app
└── output/                # OCR results saved here
```

---

## 🔧 Development

```bash
git clone https://github.com/RobZombAI/RTIP.git
cd RTIP

# Install dependencies
pip3 install pywebview pyobjc PyMuPDF

# Run directly (no .app)
python3 sources/main.py

# Build .app
./build.sh
```

---

## 📸 Screenshots

*(Coming soon — add your own screenshots and PR them!)*

---

## 🤝 Contributing

**RTIP is open to the community!** Here's how you can help:

- 🐛 **Report bugs** — open an issue
- 💡 **Suggest features** — open a discussion
- 🔧 **Submit PRs** — code improvements, new models, UI tweaks
- 🖼️ **Create icons/mascot** — we need a mascot! 🦎
- 📖 **Improve docs** — better README, more examples

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## 📊 Performance Benchmarks (M5 Max 128GB)

| Operation | Time |
|-----------|------|
| OCR single image (1 MP) | 1–3 seconds |
| OCR 10-page PDF | 15–30 seconds |
| LLM load model | 3–5 seconds |
| LLM first response (cold) | 2–4 seconds |
| LLM chat (subsequent) | 10–30 tok/s |
| Model switch (OCR↔LLM) | 3–8 seconds |

---

## 📜 License

MIT — use it, modify it, share it. See [LICENSE](LICENSE).

---

## 🙏 Acknowledgments

- **[Baidu Unlimited-OCR](https://huggingface.co/baidu/Unlimited-OCR)** — the OCR model
- **[Agents A1](https://huggingface.co/robzombai/Agents-A1-GGUF)** — the LLM model
- **[llama.cpp](https://github.com/ggml-org/llama.cpp)** — inference engine
- **[pywebview](https://pywebview.flowrl.com/)** — UI framework

---

<p align="center">
  Made with ❤️ for the open-source community<br>
  <sub>No cloud, no tracking, no API keys — just your Mac doing the work.</sub>
</p>
