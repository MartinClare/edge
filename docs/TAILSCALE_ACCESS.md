# Allow people to access this machine via Tailscale

## 1. On this edge device (already done)

- **Tailscale** is installed and **enabled** in `app.config.json`:
  ```json
  "tailscale": {
    "enabled": true,
    "mode": "inbound"
  }
  ```
- **tailscaled** is enabled at boot and the tunnel is up.
- This machine’s Tailscale IP: **100.75.44.93** (or use MagicDNS: `admin.<your-tailnet>.ts.net`).

## 2. How others connect

They must be on the **same Tailscale network (tailnet)** as this device.

- **Option A – Same Tailscale account**  
  Install [Tailscale](https://tailscale.com/download) on their PC/phone and log in with the **same account** used on this edge device. They will then see this machine on the tailnet.

- **Option B – Invite or ACL**  
  In [Tailscale admin](https://login.tailscale.com/admin): add their account to the tailnet, or use ACLs to allow specific users to reach this device.

## 3. URLs they use

Once on the same tailnet they can use:

| What        | URL |
|------------|-----|
| **Web UI** | `http://100.75.44.93:3000` or `http://admin.<tailnet>.ts.net:3000` |
| **SSH**    | `ssh admin@100.75.44.93` or `ssh admin@admin.<tailnet>.ts.net` |

(Replace `<tailnet>` with your tailnet name, e.g. `yourdomain.com`.)

## 4. Toggle Tailscale from the app

- Open **Settings** (gear) in the PPE-UI.
- Under **Tailscale**: check **Enable Tailscale (remote access)** and choose **Inbound access**.
- Click **Save** – the backend will run `tailscale up --ssh` on this device.

To turn off remote access, uncheck **Enable Tailscale** and Save (runs `tailscale down`).

## 5. Ensure Tailscale survives reboot

```bash
sudo systemctl enable tailscaled
```

With `tailscale.enabled: true` in config, the app will bring the tunnel up when the backend starts; you can also run after boot:

```bash
sudo tailscale up --ssh
```
