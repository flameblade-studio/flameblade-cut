<p align="center">
  <img src="../apps/desktop/build/icon.png" width="120" alt="炎劍剪輯 Flameblade Cut" />
</p>

<h1 align="center">炎劍剪輯 Flameblade Cut</h1>

<p align="center">
  <b>AI 動画生成 → 編集 → 字幕 → ナレーション → 書き出し</b>を、自分の PC だけで一気通貫に。<br />
  アップロード不要、クレジット不要、月額料金なし。
</p>

<p align="center">
  <a href="../README.md">繁體中文</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.en.md">English</a> ·
  <b>日本語</b>
</p>

---

> **開発中（0.2.0 プレビュー版）。** 機能と画面はまだ磨き込み中です。不具合の報告を歓迎します。

## できること

| 機能 | 説明 |
|---|---|
| **AI 生成** | テキストから動画、画像から動画、最初と最後のフレーム指定、動画の延長、複数の参考画像からの動画生成。お使いの PC 上の [LTX-2.5](https://huggingface.co/Lightricks)（ComfyUI 経由）で動作し、動画には音声も付きます。 |
| **ディレクターボード** | 1 カット 1 行で絵コンテを書き、ワンクリックで全カットを生成。完成したものから順に編集タイムラインへ並べます。 |
| **編集** | マルチトラックのタイムライン、トリミングと分割、トランジション、フィルターと色調整、キーフレーム、速度変更、グリーンバック合成、縦型への自動リフレーム、無音区間の自動カット。 |
| **字幕** | ローカル音声認識（Whisper）による自動字幕、繁体字変換、改行調整、二言語字幕、単語ハイライト、SNS 用セーフエリア、SRT／文字起こしの書き出し。 |
| **ナレーション** | Windows 内蔵音声（無料・オフライン）、Azure Speech、OpenAI の音声。字幕をワンクリックでナレーションに変換できます。 |
| **AI ハイライト** | 長い動画を入れるだけで、ショート動画にする価値の高い場面を自動で抽出。動画内のセリフをテキストで検索できます。 |
| **書き出し** | MP4（H.264）ほか。横型・縦型・正方形、最大 4K。 |

画面表示は **繁體中文・简体中文・English・日本語** に対応しています。

## 動作環境

- Windows 10／11（64 ビット）
- **編集のみ**：一般的な PC で動作します。
- **AI 動画生成**：NVIDIA の GPU（VRAM 16 GB 以上を推奨）、システムメモリ 64 GB、および以下を各自でインストールしてください：
  - [ComfyUI](https://github.com/comfyanonymous/ComfyUI)（git 版・ポータブル版どちらでも可）
  - LTX-2.5 のモデルファイル（[Hugging Face](https://huggingface.co/Lightricks) で Lightricks のライセンスに同意してからダウンロードし、ComfyUI 公式 LTX-2.5 テンプレートの説明に従って `models` 内の該当フォルダーに配置）：
    - メインモデルは GPU に合わせて 1 つ：RTX 50 シリーズは `ltx-2.5-22b-distilled-transformer-nvfp4.safetensors`（18.7 GB、最速）、RTX 30／40 シリーズなどその他の GPU は `ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors`（21.5 GB）、または元の精度の `ltx-2.5-22b-distilled-transformer-bf16.safetensors`（42 GB）
    - `gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors`、`gemma4_e2b_it_int8_convrot.safetensors`
    - `ltx-2.5-video-vae-conv-bf16.safetensors`、`ltx-2.5-audio-vae-bf16.safetensors`
    - `ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors`
    - 参考画像からの動画生成には、さらに `ltx-2.5-22b-ic-lora-ingredients-0.9.safetensors` と [ComfyUI-LTXVideo](https://github.com/Lightricks/ComfyUI-LTXVideo) のカスタムノードが必要です

  インストール後、「AI 生成」ページ右上の歯車ボタンで ComfyUI のフォルダーを設定するだけです。**ComfyUI を自分で起動する必要はありません。** 炎劍剪輯が必要なときにバックグラウンドで起動し、終了時に自動で閉じます。メインモデルの初期設定は「自動」で、RTX 50 シリーズでは NVFP4、その他の GPU では INT8 を使います。同じ設定画面で手動指定もできます。INT8 版と BF16 版はワークフローの動作確認のみで、RTX 30／40 シリーズでの速度はまだ実測していません。

## インストール

[Releases](https://github.com/flameblade-studio/flameblade-cut/releases) から `FlamebladeCut-<バージョン>-x64.exe` をダウンロードして実行してください。

プレビュー版のインストーラーはまだコード署名されていないため、「Windows によって PC が保護されました」と表示されることがあります。「詳細情報」→「実行」を押してください。各リリースには SHA256 チェックサムを掲載しています。`certutil -hashfile FlamebladeCut-<バージョン>-x64.exe SHA256` で照合できます。

## プライバシー

- 動画・画像・字幕・プロジェクトはすべてお使いの PC に保存されます。
- 利用状況の送信やクラッシュレポートの送信は行いません。
- Azure Speech や OpenAI に接続するのは、**ご自身でキーを設定して使用したときだけ**です。キーは Windows の暗号化機能（DPAPI）でローカルに保存され、画面・ログ・プロジェクトファイルに表示されることはありません。
- 自動字幕を初めて使うとき、音声認識モデル（約 760 MB）を Hugging Face からダウンロードします。以降はオフラインで使えます。

## ソースからのビルド

Node.js 24 以上と pnpm 11 が必要です。

```bash
pnpm install
pnpm --filter @openreel/desktop build      # 画面とデスクトップのメインプロセスをビルド
pnpm --filter @openreel/desktop dist       # Windows インストーラーを作成（apps/desktop/release/）
```

パッケージ作成時に「Cannot create symbolic link」と表示された場合は、パッケージャーがシンボリックリンクを作成できる必要があります。Windows の「開発者モード」をオンにするか、一度だけ管理者として実行してください。

開発でよく使うコマンド：

```bash
pnpm --filter @openreel/web typecheck
pnpm --filter @openreel/web test:run
pnpm --filter @openreel/desktop test:run
```

## ライセンスと謝辞

- 本プロジェクトのソースコードは **MIT ライセンス**で公開しており、[OpenReel Video](https://github.com/Augani/openreel-video)（MIT、© 2024-2026 Augustus Otu and Contributors）を改変したものです。元プロジェクトの説明は [docs/UPSTREAM-README.md](UPSTREAM-README.md) に残しています。すべてのサードパーティ構成要素とライセンスは [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) に記載しています。
- ComfyUI、ComfyUI-LTXVideo、およびすべての AI モデルは**本ソフトウェアに含まれていません**。各自でインストールしてください。炎劍剪輯はローカルの ComfyUI を独立したプログラムとして呼び出すだけです。
- 「炎劍剪輯」「Flameblade Cut」の名称と炎劍の紋章は炎劍文化工作室（Flameblade Studio）を示す標章であり、MIT ライセンスの対象外です。改変版ではご自身の名称とアイコンをお使いください。
- デスクトップ版のインストーラーに同梱している FFmpeg は独立した実行ファイルで、GPL ライセンスに基づいて提供しています。詳しくは `apps/desktop/LICENSES/` をご覧ください。
- AI モデルは本ソフトウェアと一緒に配布していません。LTX-2.5 などのモデルを使う際は、各モデルのライセンスに従ってください（たとえば LTX-2 Community License では、公開する生成物に AI 生成であることの表示が求められます）。
- プロンプトのローカル翻訳には [Helsinki-NLP/opus-mt-zh-en](https://huggingface.co/Helsinki-NLP/opus-mt-zh-en)（© Language Technology Research Group, University of Helsinki、CC BY 4.0。ONNX 変換版 [Xenova/opus-mt-zh-en](https://huggingface.co/Xenova/opus-mt-zh-en)）を使用しています。初回使用時に Hugging Face からダウンロードし、本ソフトウェアとは一緒に配布していません。

---

開発・メンテナンス：[炎劍文化工作室 Flameblade Studio](https://www.flamebladestudio.com.tw)
