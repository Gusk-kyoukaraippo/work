# Cloudflare Zero Trust経由 SSH接続・保守手順

最終更新: 2026-08-03

## 1. 目的と接続構成

このMacからCloudflare Zero Trustを経由して `work-mac` へSSH接続し、必要に応じてさらに `gadget-pi.local` へSSH接続する。

```text
このMac
  │ Cloudflare One Client / Zero Trust
  ▼
work-mac
  ├─ IP: 10.252.0.168
  ├─ SSHユーザー: tamaki
  ├─ tmuxセッション: remote
  └─ ホスト名: tamakinoMac-mini.local
       │ SSH（接続元はwork-mac）
       ▼
     gadget-pi.local
       ├─ 確認時IP: 10.252.0.224
       └─ SSHユーザー: admin
```

`gadget-pi.local` のIPはDHCPなどにより変わる可能性があるため、通常は `.local` 名を使用する。

## 2. 構築時の環境

- Mac: macOS 26.5.2（build 25F84）
- CPU: Apple M1（Apple Silicon / arm64）
- Cloudflare One Client: 2026.6.880.0
- Zero Trust組織名: `quiet-mountain-91f3`
- Enrollmentポリシー: `Allow kyoukaraippo device enrollment`
- Enrollment対象メール: `kyoukaraippo@gmail.com`
- WARPトンネル: MASQUE（HTTPS via UDP）

Cloudflare One ClientはCloudflare公式配布のmacOS用PKGを使用している。

- [Cloudflare One Clientのダウンロード](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/download/)
- [macOSへの手動導入手順](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/deployment/manual-deployment/)
- [必要な通信先・ポート](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/deployment/firewall/)

## 3. 通常の接続手順

### 3.1 Cloudflare接続を確認する

Cloudflare One Clientを起動し、表示が `Connected` であることを確認する。

コマンドでも確認できる。

```bash
/Applications/Cloudflare\ WARP.app/Contents/Resources/warp-cli status
```

正常時の表示:

```text
Status update: Connected
Network: healthy
```

### 3.2 work-macへSSH接続する

```bash
ssh work-mac
```

専用のEd25519鍵が使用されるため、通常はSSHパスワードを要求されない。

### 3.3 tmuxセッションへ接続する

`work-mac` にSSH接続した後で実行する。

```bash
tmux attach -t remote
```

このMacから直接tmuxまで接続する場合:

```bash
ssh -t work-mac '/opt/homebrew/bin/tmux attach -t remote'
```

`work-mac` の非対話SSH環境ではHomebrewのパスがPATHに含まれないため、1行接続ではtmuxの絶対パスを使用する。

### 3.4 gadget-pi.localへ2段SSH接続する

このMacから実行する。

```bash
ssh gadget-pi
```

`~/.ssh/config` の `ProxyJump work-mac` により、Cloudflare Zero Trust経由の `work-mac` を中継して `admin@gadget-pi.local` へ接続する。専用のEd25519鍵が使用されるため、通常はSSHパスワードを要求されない。

すでに `work-mac` へ接続している場合は、次のコマンドでも接続できる。

```bash
ssh admin@gadget-pi.local
```

この場合は `gadget-pi` 用の秘密鍵が `work-mac` にないため、パスワード認証になる。秘密鍵を `work-mac` へコピーしない。

tmux内から2段目へ接続する場合は、必要に応じてtmuxの新しいウィンドウまたはペインを開いてからSSHする。

## 4. SSH鍵と設定

### 4.1 work-mac専用鍵

```text
秘密鍵: ~/.ssh/id_ed25519_work_mac
公開鍵: ~/.ssh/id_ed25519_work_mac.pub
```

公開鍵の指紋:

```text
SHA256:gsSH/qF+pqKAdreH5ux+BCrOArseUXf9DrHXsqyPOBE
```

### 4.2 gadget-pi専用鍵

```text
秘密鍵: ~/.ssh/id_ed25519_gadget_pi
公開鍵: ~/.ssh/id_ed25519_gadget_pi.pub
```

公開鍵の指紋:

```text
SHA256:hVjs/dQhkPhsXSJVjxhHJyXjuXQc1HdHoecBiztPlCo
```

いずれの秘密鍵も `work-mac` や `gadget-pi.local` へコピーしない。

### 4.3 ~/.ssh/config

既存設定の末尾に次の設定が追加されている。

```sshconfig
Host work-mac
    HostName 10.252.0.168
    User tamaki
    IdentityFile ~/.ssh/id_ed25519_work_mac
    IdentitiesOnly yes
    ServerAliveInterval 30
    ServerAliveCountMax 3

Host gadget-pi
    HostName gadget-pi.local
    User admin
    ProxyJump work-mac
    IdentityFile ~/.ssh/id_ed25519_gadget_pi
    IdentitiesOnly yes
    ServerAliveInterval 30
    ServerAliveCountMax 3
```

実際に適用される設定の確認:

```bash
ssh -G work-mac | grep -E '^(hostname|user|identityfile|identitiesonly|serveraliveinterval|serveralivecountmax) '
ssh -G gadget-pi | grep -E '^(hostname|user|proxyjump|identityfile|identitiesonly|serveraliveinterval|serveralivecountmax) '
```

### 4.4 パーミッション

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/config
chmod 600 ~/.ssh/id_ed25519_work_mac
chmod 644 ~/.ssh/id_ed25519_work_mac.pub
chmod 600 ~/.ssh/id_ed25519_gadget_pi
chmod 644 ~/.ssh/id_ed25519_gadget_pi.pub
```

確認:

```bash
stat -f '%Sp %N' \
  ~/.ssh \
  ~/.ssh/config \
  ~/.ssh/id_ed25519_work_mac \
  ~/.ssh/id_ed25519_work_mac.pub \
  ~/.ssh/id_ed25519_gadget_pi \
  ~/.ssh/id_ed25519_gadget_pi.pub
```

## 5. 接続確認コマンド

### 5.1 Cloudflare経路

```bash
route -n get 10.252.0.168
```

正常時は `interface: utun...` と表示される。Wi-Fiインターフェースへ直接向いている場合は、Cloudflare接続を先に確認する。

### 5.2 SSHポート

```bash
nc -zvw 5 10.252.0.168 22
```

正常時:

```text
Connection to 10.252.0.168 port 22 [tcp/ssh] succeeded!
```

### 5.3 work-macの鍵認証試験

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 work-mac \
  'printf "user="; id -un; printf "host="; hostname'
```

正常時はユーザー `tamaki`、ホスト `tamakinoMac-mini.local` が表示される。

### 5.4 gadget-piのProxyJump鍵認証試験

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 gadget-pi \
  'printf "user="; id -un; printf "host="; hostname'
```

正常時はユーザー `admin`、ホスト `gadget-pi` が表示される。

### 5.5 2段目の名前解決とポート確認

```bash
ssh work-mac '/usr/bin/dscacheutil -q host -a name gadget-pi.local'
ssh work-mac 'nc -zvw 5 gadget-pi.local 22'
```

## 6. ホスト鍵

### 6.1 work-mac

再構築時にCloudflare Zero Trust経路で観測した `work-mac` のホスト鍵指紋:

```text
ED25519 SHA256:LEt5PYHrrTX7P49zd5yp5AJ93+Q9VmUsd24Axe4TL2k
ECDSA   SHA256:C200uMkPiZEZWXY+9mFXN1TyBk6bsOGM1+gI+qVo9G4
RSA     SHA256:j85eUdcBmyWqR/2i4/2P/JxC8wFWqX77ugEHEV9vSDI
```

このMacの `known_hosts` にはED25519鍵を登録している。

### 6.2 gadget-pi.local

構築時に観測した `gadget-pi.local` のホスト鍵指紋:

```text
ED25519 SHA256:mQVkB/gXr7+RwIHYTm9wp8to8js3EPLc+izyD/+YxSo
ECDSA   SHA256:WKZdO/KP2w/mS7KoUg6Tw5DnpqyjFZM684I4jvhyXjQ
RSA     SHA256:nXy/iWWQanGqJaf59HIe0vnCh8m9+1ini64BOJcD6qg
```

初回接続時やホスト鍵変更時は、可能であれば接続先の管理情報や実機側の指紋とも照合する。OS再インストールなど正当な理由なく指紋が変わった場合は、安易に `known_hosts` を削除せず原因を確認する。

## 7. 障害時の切り分け

必ず「Cloudflare接続状態 → 経路 → SSHポート → SSH認証」の順で確認する。推測でSSH設定を変更しない。

### 7.1 CloudflareがConnectedにならない

```bash
/Applications/Cloudflare\ WARP.app/Contents/Resources/warp-cli status
/Applications/Cloudflare\ WARP.app/Contents/Resources/warp-cli tunnel stats
```

今回、元のWi-Fi `mihara-ibbv-pub` では次の問題が確認された。

- Cloudflare向けUDP通信が全対象ポートでタイムアウト
- TCP 443のフォールバック通信がFortinetのTLS検査により差し替え
- 観測した証明書発行元: `Fortinet / FG100FTK20022128`
- Cloudflareクライアント側では `UnknownIssuer` とTLS handshake resetが発生

この場合は端末のSSH設定では直らない。次のいずれかで対処する。

1. 今回使用したテザリングなど、TLS検査やUDP遮断のないネットワークへ切り替える。
2. ネットワーク管理者へCloudflare通信のTLS検査除外と必要ポートの許可を依頼する。

CloudflareのMASQUE接続では、公式ドキュメントに記載されたCloudflare宛てUDP 443およびフォールバックポートなどが必要になる。正確な最新情報はCloudflareの[Firewall documentation](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/deployment/firewall/)を確認する。

次の対処は行わない。

- TLS証明書検証の無効化
- macOSファイアウォールの無効化・推測変更
- ルーターのSSHポート開放
- Tailscaleの新規導入や推測変更

### 7.2 CloudflareはConnectedだがSSHポートへ届かない

```bash
route -n get 10.252.0.168
nc -zvw 5 10.252.0.168 22
```

- 経路が `utun...` でなければCloudflareのSplit Tunnelまたはネットワークルートを確認する。
- 経路が正しくポートだけ失敗する場合は、接続先Macの稼働状態、SSHサービス、接続先側ファイアウォールの順で確認する。
- ルーターのポート開放は不要。

### 7.3 SSHポートは開いているが鍵認証に失敗する

```bash
ssh -G work-mac
ssh -vvv -o BatchMode=yes -o ConnectTimeout=10 work-mac true
```

確認項目:

- `User tamaki`
- `IdentityFile ~/.ssh/id_ed25519_work_mac`
- `IdentitiesOnly yes`
- 秘密鍵が存在し、モード600である
- `work-mac` の `tamaki` ユーザーの `authorized_keys` に対応する公開鍵がある

`-vvv` のログには接続情報が含まれるため、外部へ共有する前に内容を確認する。

### 7.4 2段目だけ失敗する

このMacから確認する。

```bash
ssh -G gadget-pi
ssh -vvv -o BatchMode=yes -o ConnectTimeout=10 gadget-pi true
ssh work-mac '/usr/bin/dscacheutil -q host -a name gadget-pi.local'
ssh work-mac 'nc -zvw 5 gadget-pi.local 22'
```

- `.local` が解決しない場合は、`work-mac` と `gadget-pi` がmDNSで相互到達できるネットワークにいるか確認する。
- `ProxyJump work-mac`、`User admin`、`IdentityFile ~/.ssh/id_ed25519_gadget_pi`、`IdentitiesOnly yes` が適用されていることを確認する。
- `gadget-pi` の `admin` ユーザーの `authorized_keys` に対応する公開鍵があることを確認する。
- 確認時IPは `10.252.0.224` だが、固定IPであることが保証されていない限り恒久設定には使用しない。

## 8. 鍵の更新手順

既存鍵を直接上書きしない。新しいファイル名で鍵を作り、接続試験後に切り替える。

例:

```bash
ssh-keygen -t ed25519 \
  -f ~/.ssh/id_ed25519_work_mac_YYYYMM \
  -C 'work-mac via Cloudflare Zero Trust'
```

公開鍵登録:

```bash
ssh-copy-id \
  -i ~/.ssh/id_ed25519_work_mac_YYYYMM.pub \
  tamaki@10.252.0.168
```

SSHパスワードはターミナルへ直接入力する。新しい鍵でBatchMode接続が成功してから `IdentityFile` を切り替える。旧公開鍵・旧秘密鍵の削除は、ロールバック不要であることを確認した後に別作業として行う。

## 9. 変更禁止・情報管理

- ルーターのポート開放をしない。
- macOSファイアウォールを無効化・推測変更しない。
- Tailscaleを新規導入しない。既存Tailscaleも、明確な理由と影響確認なしに変更しない。
- 既存SSH鍵や `~/.ssh/config` を上書きしない。
- パスワード、OTP、秘密鍵、Cloudflare Enrollmentトークンをチャット、ログ、コマンド引数、ファイルへ保存しない。
- 公開鍵を再登録するときも秘密鍵は転送しない。

## 10. 構築完了時の確認結果

- Cloudflare One Client: `Connected / Network: healthy`
- `10.252.0.168` の経路: Cloudflareの `utun11`（`utun` 番号は接続ごとに変わる可能性あり）
- `10.252.0.168:22`: 到達成功
- `work-mac` のSSH鍵認証: 成功
- SSH接続ユーザー: `tamaki`
- tmuxセッション `remote`: 存在・attach成功
- `work-mac` から `gadget-pi.local:22`: 到達成功
- `gadget-pi` のProxyJump鍵認証: 成功
- SSH接続ユーザー: `admin`

## 11. work-macからこのMacへの逆方向SSH

### 11.1 採用した構成

`work-mac` ではVPNを使用できず、Cloudflareアカウントには公開SSHホストに使用できる管理対象ドメインがない。そのため、公開ホスト方式ではなく、既存のCloudflare経路上に逆方向SSHポートフォワードを常時確立する。

```text
このMac
  ├─ Cloudflare One Client / WARP
  ├─ Remote Login: 有効
  └─ launchdで逆方向SSHを維持
       │ SSH -R（Cloudflare Zero Trust経路）
       ▼
work-mac 127.0.0.1:2222
       │ 逆方向SSHセッション内
       ▼
このMac 127.0.0.1:22
```

`work-mac` 側の待受は `127.0.0.1:2222` に限定している。このポートはLANやインターネットには公開されず、ルーターのポート開放も不要である。`work-mac` は自身のループバックへ接続するだけなので、WARP/VPNクライアントを必要としない。

### 11.2 work-macから接続する

```bash
ssh home-mac
```

VS CodeではRemote-SSHの接続先として `home-mac` を選択する。

`work-mac` の `~/.ssh/config` には次の設定がある。

```sshconfig
Host home-mac
  HostName 127.0.0.1
  Port 2222
  User tama2025mini
  IdentityFile ~/.ssh/id_ed25519_home_mac
  IdentitiesOnly yes
  ServerAliveInterval 30
  ServerAliveCountMax 3
```

### 11.3 専用鍵とホスト鍵

`work-mac` の専用鍵:

```text
秘密鍵: ~/.ssh/id_ed25519_home_mac
公開鍵: ~/.ssh/id_ed25519_home_mac.pub
公開鍵指紋: SHA256:4ddwTgRV3bl3DMRgSTDFPU/yE1G557OZlRCw/zWqkbo
```

秘密鍵は `work-mac` から移動しない。公開鍵だけを、このMacの `~/.ssh/authorized_keys` に登録している。

このMacのSSHホスト鍵指紋:

```text
ED25519 SHA256:pjzSqVAjspJ4G4/AzCIa563Ow0I8FDJQJE8sXBjNQbc
ECDSA   SHA256:DfQy74y73RW4CshrYSq9yEnz5meEOd1YG/ymIQHLIeI
RSA     SHA256:rERwBBdQmfvWZTkzz9rZkN4y/QFvM4b+W4DKcr+vR5w
```

`work-mac` の `known_hosts` に登録したED25519鍵と照合済みである。

### 11.4 自動再接続

このMacのユーザーLaunchAgentが逆方向SSHを維持する。

```text
設定: ~/Library/LaunchAgents/com.tama2025mini.cloudflare-reverse-ssh.plist
標準ログ: ~/Library/Logs/cloudflare-reverse-ssh.log
エラーログ: ~/Library/Logs/cloudflare-reverse-ssh.error.log
```

状態確認:

```bash
launchctl print \
  gui/$(id -u)/com.tama2025mini.cloudflare-reverse-ssh
```

手動再起動:

```bash
launchctl kickstart -k \
  gui/$(id -u)/com.tama2025mini.cloudflare-reverse-ssh
```

接続確認:

```bash
ssh work-mac 'nc -zvw 5 127.0.0.1 2222'
ssh work-mac \
  'ssh -o BatchMode=yes -o ConnectTimeout=8 home-mac \
  "printf \"user=\"; id -un; printf \"host=\"; hostname"'
```

正常時はユーザー `tama2025mini`、ホスト `tama2025mininoMac-mini.local` が表示される。

### 11.5 利用条件と切り分け

次のすべてが必要である。

- このMacでCloudflare One Clientが `Connected` である。
- このMacの「リモートログイン」が有効である。
- このMacが起動・ログイン済みで、スリープしていない。
- `work-mac` のSSHサービスとCloudflare Tunnelコネクターが稼働している。
- `work-mac` の `127.0.0.1:2222` が別プロセスに使用されていない。

失敗時は、このMacで次の順に確認する。

```bash
warp-cli status
nc -zvw 3 127.0.0.1 22
launchctl print \
  gui/$(id -u)/com.tama2025mini.cloudflare-reverse-ssh
tail -n 50 ~/Library/Logs/cloudflare-reverse-ssh.error.log
ssh work-mac 'nc -zvw 5 127.0.0.1 2222'
```

このLaunchAgentはユーザーログイン後に動作する。ログアウト中も常時接続が必要になった場合は、root権限のLaunchDaemon化を別途検討する。
