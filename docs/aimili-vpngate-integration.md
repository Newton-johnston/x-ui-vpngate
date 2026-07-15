# AimiliVPN + 3x-ui 集成

本分支将 AimiliVPN 保持为独立的 OpenVPN/VPNGate 守护服务。3x-ui 只创建一个
名为 `vpngate` 的 Xray SOCKS 出站，目标固定为本机地址，默认
`127.0.0.1:7928`。这避免了向公网暴露 Aimili 的代理端口。

## 使用方式

1. 安装并启动 AimiliVPN，确认它的 HTTP/SOCKS5 本地端口已监听。
2. 登录 3x-ui 后调用面板 API：

   `POST /panel/vpngate/status`，表单字段 `host=127.0.0.1`、`port=7928`，检查本地端口。

3. 调用 `POST /panel/vpngate/apply`，使用相同字段；可选 `inboundTags` 为 JSON 数组，例如 `["vless-reality"]`。

保存后，3x-ui 会在下一次后台重启周期重载 Xray。填写入站标签时，仅该入站流量走
VPNGate；不填时只创建出站，随后可在 Xray 路由界面自行引用 `vpngate` 标签。

接口仅接受 `127.0.0.1`、`::1` 或 `localhost`，以防误把 VPNGate 代理开放为远程跳板。

## 服务部署

本仓库提供 `deploy/aimili-vpngate.service`。将源码部署至 `/opt/3x-ui` 后，复制该文件到
`/etc/systemd/system/`，执行 `systemctl daemon-reload` 和 `systemctl enable --now aimili-vpngate`。
服务显式设置 `LOCAL_PROXY_HOST=127.0.0.1`，因此代理不会监听公网接口。
