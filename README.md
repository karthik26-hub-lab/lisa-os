<div align="center">
  <img src="frontend/public/logo.png" alt="Lisa Flow Logo" width="100" />
  <h1>Lisa Flow 🧠✨</h1>
  <p><strong>Your Ultra-Fast, Context-Aware Voice Dictation & Text Polishing Assistant</strong></p>
  
  [![Tauri](https://img.shields.io/badge/Tauri-V2-FFC131?logo=tauri&logoColor=white)](https://v2.tauri.app/)
  [![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://reactjs.org/)
  [![FastAPI](https://img.shields.io/badge/FastAPI-0.100-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
  [![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
</div>

<br>
<div align="center">
  <img src="assets/screenshot.png" alt="Lisa Flow Dashboard" width="48%" style="border-radius: 12px; box-shadow: 0px 8px 24px rgba(0,0,0,0.15);" />
  &nbsp;&nbsp;
  <img src="assets/screenshot_settings.png" alt="Lisa Flow Settings" width="48%" style="border-radius: 12px; box-shadow: 0px 8px 24px rgba(0,0,0,0.15);" />
</div>

---

Lisa Flow is a lightweight, background-running AI assistant that transforms your messy thoughts and phonetic "Tanglish" into perfectly polished, professional text. 

By combining a sleek React/Tauri frontend with a powerful Python/FastAPI sidecar engine, Lisa listens to your global hotkeys anywhere on your system, processes your speech via Google's Gemini models, and instantly types the perfect result right back into your active window.

## 🚀 Key Features

- **⚡ Global Hotkeys:** Press `Alt+X` to dictate from anywhere, or `Ctrl+Shift+X` to polish highlighted text instantly.
- **🎙️ Smart Dictation (Tanglish Support):** Built to understand messy, cross-language phonetic speech (like Tamil + English) and translate it into flawless professional text.
- **🧠 Background Memory Agent:** Lisa silently runs a sub-agent to extract your long-term preferences, active projects, and context from your daily dictations. The more you use her, the smarter she gets!
- **⌨️ Auto-Pasting Engine:** No more copying and pasting. Lisa simulates keyboard inputs to type your polished text directly into Word, Chrome, VS Code, or whatever app you have focused.
- **🎛️ Command Center Dashboard:** A beautiful, glassmorphism-inspired UI to manage your API keys, view system metrics (RAM, CPU, Battery), manage history, and explore Lisa's memory banks.
- **🎵 Micro-Interactions:** Subtle, high-quality audio cues let you know when Lisa starts listening, finishes processing, or encounters an error without you having to look at the screen.

## 🏗️ Architecture

Lisa Flow uses a **Dual-Webview Architecture**:
1. **Frontend (Tauri + React + Vite + Tailwind):** Manages the Dashboard, Settings, and a tiny invisible "Island" overlay that handles global hotkeys, speech-to-text recording, and audio synthesis.
2. **Backend (Python + FastAPI + PyAutoGUI):** Runs silently as a sidecar process. It handles LLM processing via Gemini, memory extraction, system metric tracking, and injecting text back into the OS clipboard and active window.

## 🛠️ Installation & Setup

### Prerequisites
- Node.js (v18+)
- Python (v3.10+)
- Rust (for Tauri compilation)
- Visual Studio C++ Build Tools (Windows)

### 1. Clone the Repository
```bash
git clone https://github.com/karthik26-hub-lab/lisa-os.git
cd lisa-os
```

### 2. Setup the Python Backend
```bash
cd backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Setup the Tauri Frontend
```bash
cd ../frontend
npm install
```

### 4. Running Locally in Dev Mode
To run both the Python backend and the React frontend simultaneously:
```bash
# Terminal 1 (Backend)
cd backend
.\venv\Scripts\activate
python main.py

# Terminal 2 (Frontend)
cd frontend
npm run tauri dev
```

### 5. Building for Production
You can compile Lisa Flow into a single, double-clickable `.exe` file! The Python backend is compiled using PyInstaller and injected as a Tauri Sidecar.
```bash
# In the root directory
.\build.bat
```
Your compiled `.exe` will be located in `frontend/src-tauri/target/release/`.

## ⚙️ Configuration
Upon launching Lisa Flow for the first time, open the **Settings** tab in the Dashboard to input your Google Gemini API key. All API keys and settings are stored locally on your machine.

---
*Designed with ❤️ for a frictionless writing experience.*
