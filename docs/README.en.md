<p align="center">
  <img src="../apps/desktop/build/icon.png" width="120" alt="Flameblade Cut" />
</p>

<h1 align="center">Flameblade Cut</h1>

<p align="center">
  <b>AI video generation → editing → captions → voiceover → export</b>, all in one app on your own PC.<br />
  No uploads, no credits, no subscription.
</p>

<p align="center">
  <a href="../README.md">繁體中文</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <b>English</b> ·
  <a href="README.ja.md">日本語</a>
</p>

---

> **In development (0.3.0 preview).** Features and UI are still being polished; bug reports are welcome.

## What it does

| Feature | Description |
|---|---|
| **AI generation** | Text-to-video, image-to-video, first/last frame, video extension, and multi-image reference-to-video. Runs [LTX-2.5](https://huggingface.co/Lightricks) on your own PC (through ComfyUI); videos come with sound. Write the way you like — any language, a whole screenplay, posters or design sheets as references — and "AI tidy-up" turns it into an English shot and reference descriptions the model understands (local Gemma, free and offline; or your OpenAI key, which also crops text off the references). |
| **Director board** | Write one line per shot, generate every shot with one click, and have the results placed on the editing timeline in order. |
| **Editing** | Multi-track timeline, trim and split, transitions, filters and color, keyframes, speed changes, green-screen removal, automatic vertical reframing, automatic silence removal. |
| **Captions** | Local speech recognition (Whisper) for automatic captions, Traditional Chinese conversion, line breaking, bilingual captions, word highlighting, social-media safe frames, SRT and transcript export. |
| **Voiceover** | Built-in Windows voices (free and offline), Azure Speech, and OpenAI voices; turn captions into a voiceover with one click. |
| **AI highlights** | Drop in a long video and get the moments most worth turning into shorts; search any spoken line in the video by text. |
| **Export** | MP4 (H.264) and more, landscape, vertical, or square, up to 4K. |

The interface is available in **Traditional Chinese, Simplified Chinese, English, and Japanese**.

## System requirements

- Windows 10/11 (64-bit)
- **Editing only:** any ordinary PC.
- **AI video generation:** an NVIDIA GPU (16 GB of VRAM or more recommended), 64 GB of system RAM, and the following installed by you:
  - [ComfyUI](https://github.com/comfyanonymous/ComfyUI) (git install or portable build)
  - LTX-2.5 model files (download them from [Hugging Face](https://huggingface.co/Lightricks) after accepting Lightricks' license, and place them in the `models` subfolders described by the official ComfyUI LTX-2.5 templates):
    - One main model for your GPU: `ltx-2.5-22b-distilled-transformer-nvfp4.safetensors` for RTX 50 series (18.7 GB, fastest); `ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors` for RTX 30/40 series and other GPUs (21.5 GB); or full-precision `ltx-2.5-22b-distilled-transformer-bf16.safetensors` (42 GB)
    - `gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors`, `gemma4_e2b_it_int8_convrot.safetensors`
    - `ltx-2.5-video-vae-conv-bf16.safetensors`, `ltx-2.5-audio-vae-bf16.safetensors`
    - `ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors`
    - Reference-to-video additionally needs `ltx-2.5-22b-ic-lora-ingredients-0.9.safetensors` and the [ComfyUI-LTXVideo](https://github.com/Lightricks/ComfyUI-LTXVideo) custom nodes

  Once installed, set the ComfyUI folder with the gear button at the top right of the "AI Generate" page. **You never need to open ComfyUI yourself**: Flameblade Cut starts it in the background when needed and closes it when you quit. The main model defaults to "Automatic": NVFP4 on RTX 50 series, INT8 on other GPUs; you can also pick one in the same settings window. The INT8 and BF16 versions have only been checked for a correct workflow so far, not timed on RTX 30/40 hardware.

## Installation

Download `FlamebladeCut-<version>-x64.exe` from [Releases](https://github.com/flameblade-studio/flameblade-cut/releases) and run it.

Preview installers are not yet code-signed, so Windows may show "Windows protected your PC": click "More info" → "Run anyway". Every release lists a SHA256 checksum; verify it with `certutil -hashfile FlamebladeCut-<version>-x64.exe SHA256`.

## Privacy

- Your videos, images, captions, and projects stay on your PC.
- No usage tracking and no crash reports are sent.
- Azure Speech or OpenAI are contacted **only when you set your own key and use them**. Keys are stored locally with Windows encryption (DPAPI) and never appear on screen, in logs, or in project files.
- The first time you use automatic captions, the speech recognition model (about 760 MB) is downloaded from Hugging Face; it works offline after that.

## Building from source

Requires Node.js 24 or later and pnpm 11.

```bash
pnpm install
pnpm --filter @openreel/desktop build      # build the UI and the desktop main process
pnpm --filter @openreel/desktop dist       # produce the Windows installer (apps/desktop/release/)
```

If packaging fails with "Cannot create symbolic link", the packager needs to create symbolic links: turn on Windows "Developer Mode", or run it once as administrator.

Common development commands:

```bash
pnpm --filter @openreel/web typecheck
pnpm --filter @openreel/web test:run
pnpm --filter @openreel/desktop test:run
```

## License and acknowledgements

- This project's source code is released under the **MIT License** and is derived from [OpenReel Video](https://github.com/Augani/openreel-video) (MIT, © 2024-2026 Augustus Otu and Contributors); the original project README is kept at [docs/UPSTREAM-README.md](UPSTREAM-README.md). All third-party components and licenses are listed in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
- ComfyUI, ComfyUI-LTXVideo, and all AI models are **not included in this software**; you install them yourself. Flameblade Cut only calls your local ComfyUI as a separate program.
- The names "炎劍剪輯" and "Flameblade Cut" and the Flameblade crest identify Flameblade Studio and are not licensed under MIT; please use your own name and icon in forks.
- The FFmpeg bundled with the desktop installer is a separate executable provided under its GPL license; see `apps/desktop/LICENSES/`.
- AI models are not distributed with this software. When you use LTX-2.5 or other models, follow each model's license (for example, the LTX-2 Community License requires published output to be labelled as AI-generated).
- Local prompt translation uses [Helsinki-NLP/opus-mt-zh-en](https://huggingface.co/Helsinki-NLP/opus-mt-zh-en) (© Language Technology Research Group, University of Helsinki, CC BY 4.0; ONNX conversion [Xenova/opus-mt-zh-en](https://huggingface.co/Xenova/opus-mt-zh-en)), downloaded from Hugging Face on first use and not distributed with this software.

---

Developed and maintained by [Flameblade Studio](https://www.flamebladestudio.com.tw).
