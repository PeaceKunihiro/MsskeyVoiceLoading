# Misskey Reader v0.1

`https://misskey.niri.la/` のタイムラインに新しく表示されたノート本文を、棒読みちゃん WebSocket Plugin へ送る Chromium 拡張です。Misskey API、Cookie、ログイン情報は使用しません。

## インストール

1. [BouyomiChan WebSocket Plugin](https://github.com/chocoa/BouyomiChan-WebSocket-Plugin) を導入し、棒読みちゃんの「その他」タブでWebSocketサーバーを有効にします。
2. Chrome は `chrome://extensions/`、Edge は `edge://extensions/` を開きます。
3. 「デベロッパー モード」を有効にし、「パッケージ化されていない拡張機能を読み込む」でこのフォルダーを選びます。
4. 拡張機能の詳細画面から「拡張機能のオプション」を開き、WebSocket Plugin URLを確認します（現行プラグインの既定値 `ws://localhost:55000/`）。保存後、「テスト読み上げ」で接続を確認できます。
5. Misskeyを再読み込みします。読み込み時点の既存ノートは読まず、その後追加されたノートだけを読みます。

## 動作と制限

- DOMの `data-scroll-anchor`、`article`、表示状態を中心に判定し、右カラム、折り畳まれたCW、引用先、添付、カスタム絵文字を除外します。
- 本文がない画像・ファイルだけのノートと、通常Renoteは読みません。
- 引用Renoteは外側に入力されたコメントのみを候補にします。
- MisskeyのDOM構造変更により本文を検出できなくなる可能性があります。開発者ツールの `[MisskeyReader]` ログで判定状況を確認できます。
- WebSocket送信形式は `command: "talk"` と `speed`、`pitch`、`volume`、`voiceType`、`text` を含む現行プラグインのJSON形式です。
- 棒読みちゃん本体の「Socket通信」ポート50001は独自TCPプロトコルであり、WebSocketではありません。この拡張は50001への接続を拒否します。本体のSocket通信設定は、この拡張とWebSocket Pluginの連携には使用しません。
- 旧WebSocket Pluginではポートと送信形式が異なります。この試作版は現行のJSON対応版を対象にしています。
- 棒読みちゃんやプラグインが未起動の場合は設定画面とConsoleに接続エラーを表示し、Misskey側の処理は継続します。次の読み上げまたはテスト時に再接続します。

## セキュリティ

通信先権限は `localhost` と `127.0.0.1` のWebSocketだけです。外部サーバーへノート本文を送信しません。
