# bone_detect

ブラウザだけで動く、子ども向けのじゃんけんデモです。  
カメラ映像の中からブラウザ内AIで人を見つけて、あいさつ、じゃんけん、勝ち負けエフェクトまでを `index.html` ひとつで動かします。

## いまの構成

- `index.html`: 本番画面
- `?view=edit` または `edit.html`: 調整用画面
- `assets/audio/*.wav`: ずんだもん音声
- `assets/nojima_character_couple.png`: アバター画像

## 使い方

1. HTTPS のURLでこのサイトを開く
2. 最初に画面を1回タップする
3. ブラウザでカメラを許可する
4. 人が10フレーム続けて映ると `いらっしゃいませ`
5. 人が30フレーム続けて映ると `じゃんけんでいっしょに遊ぼう`
6. そのあと `さいしょはグー` の音声が流れたあとで、カメラに `ぐー / ちょき / ぱー` の手を見せる

## 音声

- `assets/audio/welcome.wav`: いらっしゃいませ
- `assets/audio/invite.wav`: じゃんけんでいっしょに遊ぼう
- `assets/audio/janken.wav`: さいしょはグー、じゃんけん
- `assets/audio/draw.wav`: あいこだ、もういっかい
- `assets/audio/lose.wav`: ざんねん、また…
- `assets/audio/win.wav`: やったー、きみのかち

## ローカル確認

カメラは `localhost` なら使えます。試すだけなら、フォルダで静的サーバーを立てれば十分です。

```bash
python3 -m http.server 8000
```

開くURL:

- 本番: `http://127.0.0.1:8000/`
- 編集: `http://127.0.0.1:8000/?view=edit`

## 公開

この版は Python サーバーや YOLO バックエンドなしで配信できます。  
`HTTPS` で静的ファイルを置けるサービスなら動きます。


- GitHub Pages


## メモ

- `control.html` は旧リモコンURL用の案内ページです。PCなし版ではメインURLをそのまま使います
- 別端末に `操作だけの画面` を同期表示したい場合は、バックエンドやリアルタイム同期が別で必要です
