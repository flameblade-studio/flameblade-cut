<p align="center">
  <img src="apps/desktop/build/icon.png" width="120" alt="炎劍剪輯 Flameblade Cut" />
</p>

<h1 align="center">炎劍剪輯 Flameblade Cut</h1>

<p align="center">
  在自己的電腦上，一條龍完成 <b>AI 生成影片 → 剪輯 → 字幕 → 配音 → 匯出</b>。<br />
  不用上傳、不用積分、不用月費。
</p>

<p align="center">
  <b>繁體中文</b> ·
  <a href="docs/README.zh-CN.md">简体中文</a> ·
  <a href="docs/README.en.md">English</a> ·
  <a href="docs/README.ja.md">日本語</a>
</p>

---

> **開發中（0.3.0 預覽版）。** 功能與介面仍在打磨，歡迎回報問題。

## 能做什麼

| 功能 | 說明 |
|---|---|
| **AI 生成** | 文字轉影片、圖片轉影片、首尾影格、影片延長、多張參考圖生影片。使用你電腦上的 [LTX-2.5](https://huggingface.co/Lightricks)（透過 ComfyUI），影片附帶聲音。提示詞照習慣寫就好：中文、整段劇本、海報或設定集當參考圖都可以，「AI 整理」會在生成前把它們整理成模型看得懂的英文鏡頭與參考說明（本機 Gemma 免費、不上傳；或用你的 OpenAI 金鑰，還會自動裁掉參考圖上的文字）。 |
| **導演台** | 一鏡一句寫分鏡，一鍵全部生成，完成後依序排上剪輯時間軸。 |
| **剪輯** | 多軌時間軸、修剪分割、轉場、濾鏡與調色、關鍵影格、變速、綠幕去背、自動直式構圖、自動剪掉無聲段落。 |
| **字幕** | 本機語音辨識（Whisper）自動上字幕、繁體化、斷句、雙語字幕、逐字高亮、社群安全框、匯出 SRT／逐字稿。 |
| **配音** | Windows 內建語音（免費、離線，含台灣「雅婷」）、Azure Speech、OpenAI 語音；可把字幕一鍵轉成配音。 |
| **AI 精華** | 丟進一支長片，自動找出最值得剪成短影音的片段；可用文字搜尋影片中的任一段話。 |
| **匯出** | MP4（H.264）等格式，橫式、直式、方形，最高 4K。 |

介面支援 **繁體中文、简体中文、English、日本語**。

## 系統需求

- Windows 10／11（64 位元）
- **只剪輯**：一般電腦即可。
- **AI 生成影片**：NVIDIA 顯示卡（建議 16 GB 顯示記憶體以上）、64 GB 系統記憶體，並自行安裝：
  - [ComfyUI](https://github.com/comfyanonymous/ComfyUI)（git 版或免安裝版皆可）
  - LTX-2.5 模型檔（需在 [Hugging Face](https://huggingface.co/Lightricks) 同意 Lightricks 的授權條款後下載，依 ComfyUI 官方 LTX-2.5 範本的說明放進對應的 `models` 子資料夾）：
    - 主模型三選一，依顯示卡挑選：RTX 50 系列用 `ltx-2.5-22b-distilled-transformer-nvfp4.safetensors`（18.7 GB，最快）；RTX 30／40 系列等其他顯示卡用 `ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors`（21.5 GB）；或原始精度 `ltx-2.5-22b-distilled-transformer-bf16.safetensors`（42 GB）
    - `gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors`、`gemma4_e2b_it_int8_convrot.safetensors`
    - `ltx-2.5-video-vae-conv-bf16.safetensors`、`ltx-2.5-audio-vae-bf16.safetensors`
    - `ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors`
    - 參考生影片另需：`ltx-2.5-22b-ic-lora-ingredients-0.9.safetensors` 與 [ComfyUI-LTXVideo](https://github.com/Lightricks/ComfyUI-LTXVideo) 擴充節點

  安裝好之後，在「AI 生成」頁右上角的齒輪設定 ComfyUI 資料夾即可。**你不需要自己開 ComfyUI**，炎劍剪輯會在需要時自動在背景啟動、離開時自動關閉。主模型預設為「自動」：RTX 50 系列用 NVFP4、其他顯示卡用 INT8，也可以在同一個設定視窗手動指定。INT8 與 BF16 版目前只確認過流程正確，尚未在 RTX 30／40 系列實機測過速度。

## 安裝

到 [Releases](https://github.com/flameblade-studio/flameblade-cut/releases) 下載 `FlamebladeCut-<版本>-x64.exe`，執行安裝即可。

預覽版安裝檔尚未數位簽章，Windows 可能顯示「Windows 已保護您的電腦」：按「其他資訊」→「仍要執行」。每個版本都附 SHA256 校驗碼，可用 `certutil -hashfile FlamebladeCut-<版本>-x64.exe SHA256` 核對。

## 隱私

- 影片、圖片、字幕與專案全部留在你的電腦。
- 不回傳使用紀錄、不送當機報告。
- 只有在**你自己設定金鑰並使用**時，才會連線到 Azure Speech 或 OpenAI；金鑰以 Windows 的加密機制（DPAPI）保存在本機，不會出現在畫面、記錄檔或專案檔裡。
- 第一次使用自動字幕時，會從 Hugging Face 下載語音辨識模型（約 760 MB），之後離線可用。

## 從原始碼建置

需要 Node.js 24 以上與 pnpm 11。

```bash
pnpm install
pnpm --filter @openreel/desktop build      # 建置介面與桌面主程式
pnpm --filter @openreel/desktop dist       # 產生 Windows 安裝檔（apps/desktop/release/）
```

打包時若出現「Cannot create symbolic link」，是打包工具需要建立符號連結：開啟 Windows「開發人員模式」，或以系統管理員身分執行一次即可。

開發時常用：

```bash
pnpm --filter @openreel/web typecheck
pnpm --filter @openreel/web test:run
pnpm --filter @openreel/desktop test:run
```

## 授權與致謝

- 本專案原始碼以 **MIT 授權**釋出，改作自 [OpenReel Video](https://github.com/Augani/openreel-video)（MIT，© 2024-2026 Augustus Otu and Contributors），原專案說明保留於 [docs/UPSTREAM-README.md](docs/UPSTREAM-README.md)。所有第三方元件與授權列於 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- ComfyUI、ComfyUI-LTXVideo 與所有 AI 模型**都不包含在本軟體內**，由使用者自行安裝；炎劍剪輯只以獨立程式的方式呼叫本機的 ComfyUI。
- 「炎劍剪輯」「Flameblade Cut」名稱與炎劍徽章為炎劍文化工作室的識別標誌，不隨 MIT 授權提供；改作時請換成自己的名稱與圖示。
- 桌面版附帶的 FFmpeg 為獨立執行檔，依其 GPL 授權提供，詳見 `apps/desktop/LICENSES/`。
- AI 模型不隨本軟體散布。使用 LTX-2.5 等模型時，請遵守各模型的授權條款（例如 LTX-2 Community License 要求公開發表時標示為 AI 生成內容）。
- 提示詞本機翻譯使用 [Helsinki-NLP/opus-mt-zh-en](https://huggingface.co/Helsinki-NLP/opus-mt-zh-en)（© Language Technology Research Group, University of Helsinki，CC BY 4.0；ONNX 轉檔 [Xenova/opus-mt-zh-en](https://huggingface.co/Xenova/opus-mt-zh-en)），首次使用時自 Hugging Face 下載，不隨本軟體散布。

---

由 [炎劍文化工作室 Flameblade Studio](https://www.flamebladestudio.com.tw) 開發維護。
