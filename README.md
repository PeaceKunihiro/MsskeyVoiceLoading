# Misskey Reader v0.2

`https://misskey.niri.la/` のタイムラインに新しく表示されたノート本文を、ローカルのVOICEVOXで読み上げるChromium拡張です。Misskey API、Cookie、ログイン情報は使用しません。

## 必要環境

- Windows 11
- Google Chrome、Microsoft EdgeなどのChromium互換ブラウザ
- [VOICEVOX](https://voicevox.hiroshiba.jp/)

追加プラグイン、ブリッジアプリ、開発環境は必要ありません。

## インストールと設定

1. VOICEVOXを通常どおり起動します。
2. Chromeは `chrome://extensions/`、Edgeは `edge://extensions/` を開きます。
3. 「デベロッパー モード」を有効にし、「パッケージ化されていない拡張機能を読み込む」でこのフォルダーを選びます。
4. Misskey Readerの設定画面を開きます。
5. ENGINE URLが `http://127.0.0.1:50021` であることを確認し、「話者一覧を取得」を押します。
6. 話者とスタイルを選び、設定を保存して「テスト読み上げ」を押します。
7. Misskeyを再読み込みします。読み込み時点の既存ノートは読まず、その後追加されたノートだけを読みます。

## 読み上げ処理

VOICEVOX ENGINEの `/audio_query` と `/synthesis` APIでWAV音声を生成し、Manifest V3のoffscreen documentで再生します。新着ノートはFIFOキューで1件ずつ生成・再生するため、複数の音声が重なりません。

設定画面では話速、音高、抑揚、音量を変更できます。VOICEVOXが起動していない場合もMisskeyの監視は継続し、次の新着ノートや接続テスト時に改めて接続します。

## 動作と制限

- DOMの `data-scroll-anchor`、`article`、表示状態を中心に判定し、右カラム、折り畳まれたCW、引用先、添付、カスタム絵文字を除外します。
- 本文がない画像・ファイルだけのノートと、通常Renoteは読みません。
- 引用Renoteは外側に入力されたコメントのみを候補にします。
- MisskeyのDOM構造変更により本文を検出できなくなる可能性があります。開発者ツールの `[MisskeyReader]` ログで判定状況を確認できます。

## 別PCのVOICEVOX

Tailscale等で到達可能な別PCのENGINE URLも設定できます。初回保存時に、その接続先だけに対するChromeのアクセス権限確認が表示されます。URLには `http` または `https` のみ使用できます。VOICEVOX ENGINEを不特定多数へ公開しないでください。

## プライバシー

ノート本文は設定したVOICEVOX ENGINEにだけ送信します。初期設定では、このPCの `127.0.0.1:50021` だけを使用します。
