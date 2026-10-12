# Third-party notices

Flameblade Cut's own source code is released under the MIT License (see `LICENSE`).
This file lists third-party material that is included in, or used by, the project.

## Included in this repository

| Component | Use | License |
|---|---|---|
| [OpenReel Video](https://github.com/Augani/openreel-video) | Base editor this project is derived from | MIT — © 2024-2026 Augustus Otu and Contributors (kept in `LICENSE`) |
| [ComfyUI workflow templates](https://github.com/Comfy-Org/workflow_templates) | `apps/web/src/services/ltx/workflows/ltx25-{t2v,i2v,flf2v}.api.json` are API-format exports of the official LTX-2.5 templates, with model file names changed | MIT — © 2023-present Comfy Org (full text below) |

`apps/web/src/services/ltx/workflows/ltx25-ref2v.api.json` (reference-to-video) was written
for this project from the public node interfaces of ComfyUI and ComfyUI-LTXVideo; it does
not copy an upstream example workflow.

npm dependencies keep their own licenses; see each package under `node_modules` or
`pnpm licenses list`.

## Downloaded or used at run time (not included in this repository)

| Component | When | License / terms |
|---|---|---|
| [ComfyUI](https://github.com/comfyanonymous/ComfyUI) | Installed by the user; started as a separate program for AI generation | GPL-3.0 (not linked or bundled) |
| [ComfyUI-LTXVideo](https://github.com/Lightricks/ComfyUI-LTXVideo) | Installed by the user; required only for reference-to-video | LTX-2 Community License |
| [LTX-2.5 models](https://huggingface.co/Lightricks) | Downloaded by the user from Hugging Face | LTX-2 Community License — includes labelling published output as AI-generated |
| [Whisper large-v3-turbo / tiny (ONNX)](https://huggingface.co/onnx-community) | Downloaded on first auto-caption use | MIT (OpenAI Whisper) |
| [Helsinki-NLP/opus-mt-zh-en (ONNX via Xenova)](https://huggingface.co/Helsinki-NLP/opus-mt-zh-en) | Downloaded on first Chinese-prompt translation | CC BY 4.0 — © Language Technology Research Group, University of Helsinki |
| FFmpeg 6.1.1 static build ([ffmpeg-static b6.1.1](https://github.com/eugeneware/ffmpeg-static)) | Bundled in the Windows installer only (`resources/bin`), run as a separate process for export | GPL — see `apps/desktop/LICENSES/FFMPEG.md` |
| Windows OneCore voices, Azure Speech, OpenAI | Voiceover, translation and highlight ranking; cloud services only with the user's own key | Each provider's terms |

## Trademarks

"炎劍剪輯", "Flameblade Cut" and the Flameblade Studio crest (`apps/desktop/build/icon.*`,
`apps/web/public/brand/`, `apps/web/src/desktop/brand/flameblade-crest.png`) identify
Flameblade Studio and are not licensed under MIT. Forks must use their own name and icon.

## ComfyUI workflow templates — MIT License

```
MIT License

Copyright (c) 2023-present Comfy Org

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
