# Running it on an old Android phone (unsupported)

appetito started on an old phone: a rooted Android with a Debian chroot, always on a charger in a drawer. It works, and it's a good use for a phone you'd otherwise throw away. It is also **unsupported**: the installer expects a normal Debian or Ubuntu box with systemd, and a phone isn't one. This page is the list of traps I hit, so you don't have to rediscover them. It is not a rooting guide.

## Before you start

- **Rooting is not included.** Every model is different, and getting it wrong can brick the phone or wipe it. Ask your agent for your exact model and firmware, read twice, and accept that the phone (and its warranty) is expendable.
- **A phone rooted with a vbmeta signed by the AOSP test key is a zero-trust device.** Verified boot no longer protects it: anyone with the phone in their hands can flash anything. Don't keep anything on it you wouldn't keep on a USB stick, and never use it as your daily phone again.
- **Never accept system updates** afterwards: an over-the-air update rewrites the boot images and drops root. Turn automatic updates off. On phones with A/B partitions, also never unlock or wipe with a half-applied update pending (`fastboot getvar snapshot-update-status` must be `none`), or you'll be stuck in a boot loop until a recovery reset.

## The traps

- **No Docker.** Android's kernels usually lack the namespaces and cgroups Docker needs (PID namespaces, SysV IPC, pids/devices cgroups…), and they're built in: you can't add them as modules. Run services natively inside a Debian chroot (images from images.linuxcontainers.org, checksum verified).
- **No systemd in a chroot.** appetito installs systemd units; in a chroot you need a small supervisor instead (runit works well) and you'll have to adapt the deploy runner's apply step. That's the main reason this setup is unsupported: treat it as a project for your agent, not a configuration.
- **Mounts.** `/data` is mounted `nosuid`: bind-mount the chroot root onto itself, make it private, and remount it `suid,dev,exec`, or `sudo` breaks and mounts show up twice. Start everything in the global mount namespace (with Magisk, `su --mount-master`).
- **Boot scripts run with umask 000.** Set `umask 022` first thing, or sshd refuses its own world-writable runtime directory.
- **Deep sleep kills the server.** Take a kernel wake lock (`echo appetito > /sys/power/wake_lock`) when the chroot starts, and force Wi-Fi out of power saving: screen-off power save adds hundreds of milliseconds of latency.
- **No screen lock.** With a PIN, many phones keep Wi-Fi without an IP (and USB data off) until the first unlock after a reboot: the server stays offline until someone types the PIN. Remove the screen lock; the phone lives in a drawer.
- **Tailscale must run in userspace mode** (`tailscaled --tun=userspace-networking`): kernel TUN mode fights Android's policy routing. In userspace mode **every port bound to 127.0.0.1 is reachable from the whole tailnet**, so localhost is not access control any more: your tailnet policy is the firewall, and it must deny everything but the ports you publish.
- **The uid ≥ 10000 firewall trap.** Android's netd drops network traffic from uids in the app range (10000+) that have no INTERNET permission, and chroot users share the kernel's uids. Give the chroot's service users uids below 1000 that Android doesn't use (1000-9999 are Android system ids: uid 1001 is the radio, for example).
- **Power.** A phone charging from a PC's USB port may get 2 W, less than it uses under load: it slowly discharges and dies. Use a wall charger, and set a charge limit (around 80%) if your phone has one, to keep the battery from swelling.
- **A dead phone can't tell you it's dead.** Have an outside check (a free healthchecks.io check pinged every minute) that emails you when the pings stop.

## Is it worth it?

For a first home server, a 4–8 GB phone from a drawer is free, silent, and has a built-in UPS. For anything you'll rely on, a used mini PC with Debian is less work: that is what appetito targets.
