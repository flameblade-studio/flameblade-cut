<p align="center">
  <img src="../apps/desktop/build/icon.png" width="120" alt="炎剑剪辑 Flameblade Cut" />
</p>

<h1 align="center">炎剑剪辑 Flameblade Cut</h1>

<p align="center">
  在自己的电脑上，一站式完成 <b>AI 生成视频 → 剪辑 → 字幕 → 配音 → 导出</b>。<br />
  无需上传、无需积分、无需月费。
</p>

<p align="center">
  <a href="../README.md">繁體中文</a> ·
  <b>简体中文</b> ·
  <a href="README.en.md">English</a> ·
  <a href="README.ja.md">日本語</a>
</p>

---

> **开发中（0.2.0 预览版）。** 功能与界面仍在打磨，欢迎反馈问题。

## 能做什么

| 功能 | 说明 |
|---|---|
| **AI 生成** | 文字生成视频、图片生成视频、首尾帧、视频延长、多张参考图生成视频。使用你电脑上的 [LTX-2.5](https://huggingface.co/Lightricks)（通过 ComfyUI），视频自带声音。 |
| **导演台** | 一个镜头写一句分镜，一键全部生成，完成后按顺序排上剪辑时间线。 |
| **剪辑** | 多轨时间线、修剪分割、转场、滤镜与调色、关键帧、变速、绿幕抠像、自动竖屏构图、自动剪掉静音片段。 |
| **字幕** | 本地语音识别（Whisper）自动生成字幕、繁体转换、断句、双语字幕、逐字高亮、社交平台安全框、导出 SRT／文字稿。 |
| **配音** | Windows 内置语音（免费、离线）、Azure Speech、OpenAI 语音；可将字幕一键转成配音。 |
| **AI 精华** | 放入一段长视频，自动找出最值得剪成短视频的片段；可用文字搜索视频中的任意一句话。 |
| **导出** | MP4（H.264）等格式，横屏、竖屏、方形，最高 4K。 |

界面支持 **繁體中文、简体中文、English、日本語**。

## 系统要求

- Windows 10／11（64 位）
- **仅剪辑**：普通电脑即可。
- **AI 生成视频**：NVIDIA 显卡（建议 16 GB 以上显存）、64 GB 系统内存，并自行安装：
  - [ComfyUI](https://github.com/comfyanonymous/ComfyUI)（git 版或便携版均可）
  - LTX-2.5 模型文件（需在 [Hugging Face](https://huggingface.co/Lightricks) 同意 Lightricks 的许可条款后下载，按 ComfyUI 官方 LTX-2.5 模板的说明放进对应的 `models` 子文件夹）：
    - 主模型三选一，按显卡选择：RTX 50 系列用 `ltx-2.5-22b-distilled-transformer-nvfp4.safetensors`（18.7 GB，最快）；RTX 30／40 系列等其他显卡用 `ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors`（21.5 GB）；或原始精度 `ltx-2.5-22b-distilled-transformer-bf16.safetensors`（42 GB）
    - `gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors`、`gemma4_e2b_it_int8_convrot.safetensors`
    - `ltx-2.5-video-vae-conv-bf16.safetensors`、`ltx-2.5-audio-vae-bf16.safetensors`
    - `ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors`
    - 参考图生成视频另需：`ltx-2.5-22b-ic-lora-ingredients-0.9.safetensors` 与 [ComfyUI-LTXVideo](https://github.com/Lightricks/ComfyUI-LTXVideo) 扩展节点

  安装好之后，在“AI 生成”页右上角的齿轮中设置 ComfyUI 文件夹即可。**你不需要自己打开 ComfyUI**，炎剑剪辑会在需要时自动在后台启动、退出时自动关闭。主模型默认为“自动”：RTX 50 系列用 NVFP4、其他显卡用 INT8，也可以在同一个设置窗口手动指定。INT8 与 BF16 版目前只确认过流程正确，尚未在 RTX 30／40 系列实机测过速度。

## 安装

到 [Releases](https://github.com/flameblade-studio/flameblade-cut/releases) 下载 `FlamebladeCut-<版本>-x64.exe`，运行安装即可。

预览版安装包尚未进行数字签名，Windows 可能显示“Windows 已保护你的电脑”：点击“更多信息”→“仍要运行”。每个版本都附 SHA256 校验值，可用 `certutil -hashfile FlamebladeCut-<版本>-x64.exe SHA256` 核对。

## 隐私

- 视频、图片、字幕与项目全部保存在你的电脑上。
- 不上传使用记录、不发送崩溃报告。
- 只有在**你自己设置密钥并使用**时，才会连接 Azure Speech 或 OpenAI；密钥通过 Windows 的加密机制（DPAPI）保存在本机，不会出现在界面、日志或项目文件中。
- 第一次使用自动字幕时，会从 Hugging Face 下载语音识别模型（约 760 MB），之后可离线使用。

## 从源码构建

需要 Node.js 24 及以上与 pnpm 11。

```bash
pnpm install
pnpm --filter @openreel/desktop build      # 构建界面与桌面主程序
pnpm --filter @openreel/desktop dist       # 生成 Windows 安装包（apps/desktop/release/）
```

打包时如果出现“Cannot create symbolic link”，是打包工具需要创建符号链接：开启 Windows“开发者模式”，或以管理员身份运行一次即可。

开发常用命令：

```bash
pnpm --filter @openreel/web typecheck
pnpm --filter @openreel/web test:run
pnpm --filter @openreel/desktop test:run
```

## 许可与致谢

- 本项目源码以 **MIT 许可**发布，改编自 [OpenReel Video](https://github.com/Augani/openreel-video)（MIT，© 2024-2026 Augustus Otu and Contributors），原项目说明保留在 [docs/UPSTREAM-README.md](UPSTREAM-README.md)。所有第三方组件与许可列于 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。
- ComfyUI、ComfyUI-LTXVideo 与所有 AI 模型**均不包含在本软件内**，由用户自行安装；炎剑剪辑仅以独立程序的方式调用本机的 ComfyUI。
- “炎劍剪輯”“Flameblade Cut”名称与炎剑徽章为炎剑文化工作室的识别标志，不随 MIT 许可提供；改编时请换成自己的名称与图标。
- 桌面版附带的 FFmpeg 为独立可执行文件，依其 GPL 许可提供，详见 `apps/desktop/LICENSES/`。
- AI 模型不随本软件分发。使用 LTX-2.5 等模型时，请遵守各模型的许可条款（例如 LTX-2 Community License 要求公开发布时标注为 AI 生成内容）。
- 提示词本地翻译使用 [Helsinki-NLP/opus-mt-zh-en](https://huggingface.co/Helsinki-NLP/opus-mt-zh-en)（© Language Technology Research Group, University of Helsinki，CC BY 4.0；ONNX 转换版 [Xenova/opus-mt-zh-en](https://huggingface.co/Xenova/opus-mt-zh-en)），首次使用时从 Hugging Face 下载，不随本软件分发。

---

由 [炎剑文化工作室 Flameblade Studio](https://www.flamebladestudio.com.tw) 开发维护。
