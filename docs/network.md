# Network

Everything appetito runs listens on `127.0.0.1`. How you reach it from your phone is a choice you make at install time.

## Tailscale (default)

`sudo ./install.sh` asks for a Tailscale auth key (admin console → Settings → Keys → *Generate auth key*), joins the box to your tailnet as `appetito`, and publishes:

| Port | What |
|---|---|
| `https://appetito.<your-tailnet>.ts.net` (443) | the tracker |
| `https://appetito.<your-tailnet>.ts.net:8443` | the tracker's sign-in and confirm pages |

with Tailscale's own HTTPS certificates (turn on *HTTPS Certificates* in the admin console, DNS page, before installing). HTTPS is what lets you install the tracker as an app on your phone (browser menu → *Install app* / *Add to Home Screen*).

Then lock the server down in the tailnet policy: `guard/tailscale/policy.template.hujson` grants your phone and laptop only the ports above (plus Syncthing for the vault and optional SSH), and its `tests` make the admin console refuse a later edit that opens anything else:

```sh
guard/tailscale/render-policy 100.x.y.z 100.a.b.c > policy.hujson   # your phone's and laptop's tailnet IPs
```

Paste `policy.hujson` in the admin console (Access controls), and tag the server `tag:appetito`.

Syncthing (the vault) listens on the server's tailnet address only, with global and local discovery, relays and NAT traversal off: add the server as a device on your phone/laptop with its tailnet address `tcp://100.x.y.z:22000`.

## Without Tailscale

`sudo ./install.sh --no-tailscale` keeps everything on `127.0.0.1`: tracker on 8080, confirm pages on 8081, Syncthing on 22000. Exposing them is your choice and your responsibility. Some options:

- **SSH tunnel** from a laptop: `ssh -L 8080:127.0.0.1:8080 -L 8081:127.0.0.1:8081 you@server`, then open `http://127.0.0.1:8080`.
- **WireGuard**: put the server and your devices on a WireGuard network and publish the two ports with a reverse proxy that terminates HTTPS on the WireGuard address.
- **Cloudflare Tunnel** or similar: possible, but it puts the tracker on the public internet behind your password only; add Cloudflare Access (or equivalent) in front.

Whatever you choose, set `TRACKER_ORIGINS` and `TRACKER_CONFIRM_ORIGINS` in `/etc/appetito/appetito.env` to the exact `https://host[:port]` your browser uses for each, and restart the tracker (`systemctl restart appetito-tracker`): it refuses requests from any other origin or host.

## What the server itself reaches

The users `agent` and `brain` can't open connections except to loopback; their HTTPS goes through the egress proxy on `127.0.0.1:3128`, which allows only the hosts in `guard/firewall/agent.allow` and `brain.allow`. Add your own (a package mirror, a model endpoint) in `/etc/appetito/firewall.d/agent.allow` or `brain.allow` (root), one host per line, `*.example.com` for subdomains. A local model on the same box (Ollama on `127.0.0.1:11434`) needs nothing: for brain, add its port to `APPETITO_BRAIN_LOOPBACK_PORTS` and run `systemctl restart appetito-fw`.
