# MacBook Air から gadget-pi への SSH 接続

## 概要

MacBook Air から `work-mac` を経由して、Raspberry Pi の
`admin@gadget-pi.local` に接続する。

```text
MacBook Air → work-mac → admin@gadget-pi.local
```

パスワードはPCに保存せず、SSH公開鍵認証を使用する。

## 接続方法

MacBook Air のターミナルで次のコマンドを実行する。

```bash
ssh -t work-mac 'ssh admin@gadget-pi.local'
```

設定が正常であれば、パスワード入力なしで `gadget-pi` にログインできる。

ログアウトするには、次のコマンドを実行する。

```bash
exit
```

## 今回設定した内容

### MacBook Air

`~/.ssh/config` に `work-mac` の接続設定がある。

```sshconfig
Host work-mac
    HostName 10.252.0.168
    User tamaki
    IdentityFile ~/.ssh/id_ed25519_work_mac
    IdentitiesOnly yes
    ServerAliveInterval 30
    ServerAliveCountMax 3
```

### work-mac

`gadget-pi` 接続専用の鍵を作成した。

```text
~/.ssh/id_ed25519_gadget_pi
~/.ssh/id_ed25519_gadget_pi.pub
```

`~/.ssh/config` に次の設定を追加した。

```sshconfig
Host gadget-pi.local
  User admin
  IdentityFile ~/.ssh/id_ed25519_gadget_pi
  IdentitiesOnly yes
```

公開鍵 `~/.ssh/id_ed25519_gadget_pi.pub` は、`gadget-pi` の
`admin` ユーザーの `~/.ssh/authorized_keys` に登録済み。

## 接続確認

対話せずに鍵認証を確認する場合は、MacBook Air で次を実行する。

```bash
ssh work-mac \
  'ssh -o BatchMode=yes admin@gadget-pi.local "id -un; hostname"'
```

正常な場合は、次のように表示される。

```text
admin
gadget-pi
```

## 鍵を再登録する場合

`gadget-pi` の再セットアップなどで鍵が消えた場合は、MacBook Air から
次を実行する。

```bash
ssh -t work-mac \
  'ssh-copy-id -i ~/.ssh/id_ed25519_gadget_pi.pub admin@gadget-pi.local'
```

表示されたプロンプトに `gadget-pi` の `admin` パスワードを入力する。
入力中の文字は画面には表示されない。

## 注意事項

- 秘密鍵 `id_ed25519_gadget_pi` を他人に渡さない。
- 秘密鍵の内容をメール、チャット、Gitなどに貼り付けない。
- `work-mac` を初期化した場合は、専用鍵の再作成と公開鍵の再登録が必要。
- `gadget-pi.local` が見つからない場合は、`work-mac` と `gadget-pi` が
  同じネットワークに接続されているか確認する。

## 関連（対象PC・ファイルサーバ）

対象PC経由で `\\10.4.144.75\miharaDB` を見る手順・共有一覧・**今後の方針**は次を参照:

- メモ: `~/対象PC経由_miharaDBアクセスメモ.md`  
  （USB切断の理由、SDステージング、inbox/outbox、実装バックログを「今後の方針」節に記載）
- **玉城先生フォルダ（頻回）**: `~/玉城先生フォルダ_クイック参照.md`
- クイックコマンド: `~/bin/mihara-dir`
