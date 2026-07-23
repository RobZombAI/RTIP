<div align="center">
  <h1>📖 RTIP OCR</h1>
  <p><b>Fast, local OCR for macOS — LightOnOCR-2-1B on Apple Silicon</b><br>
  Extract text from images & PDFs · 100% private · Open Source</p>
  <p>
    <img src="https://img.shields.io/badge/macOS-Sequoia-blue?logo=apple">
    <img src="https://img.shields.io/badge/license-MIT-green">
    <img src="https://img.shields.io/badge/python-3.10+-yellow?logo=python">
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen">
  </p>
</div>

---

**RTIP OCR** is a native macOS app for extracting text from images and PDFs.  
Powered by **LightOnOCR-2-1B** — state-of-the-art 1B-parameter vision-language model.  
Everything runs **locally** on Apple Silicon via PyTorch/MPS. No cloud, no API keys.

### Features

- 🖼️ **Image OCR** — PNG, JPG, etc.
- 📄 **PDF OCR** — page-by-page with progress
- ⏹ **Cancel** — stop mid-process
- 💾 **Auto-save** — every result saved to `~/rtip-ocr/output/`
- ▶️ **Manual model control** — Start/Stop in status bar
- 🚀 **First-run auto-install** — missing packages install automatically

### Quick Start

```bash
brew install llama.cpp
open ~/Applications/RTIP.app
```

### Model

| Model | Params | RAM | Engine |
|-------|--------|-----|--------|
| LightOnOCR-2-1B | 1B | ~2 GB | PyTorch/MPS |

### Build from source

```bash
git clone https://github.com/RobZombAI/RTIP.git
cd RTIP
./build.sh
```

MIT License.
