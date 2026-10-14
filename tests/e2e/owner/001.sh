#!/bin/sh
# The owner's (HITL) part of starter issue 001 (Vaultwarden), as the e2e plays it: a throwaway age
# key pair (the private key stays in /root, standing in for the owner's own devices). No Tailscale
# in the box, so the HTTPS step is skipped (said in the owner's comment).
set -eu
install -d -m 755 /etc/appetito/services/vaultwarden
age-keygen -o /root/vaultwarden-backup.key 2>/dev/null
age-keygen -y /root/vaultwarden-backup.key > /etc/appetito/services/vaultwarden/backup.age.pub
chmod 644 /etc/appetito/services/vaultwarden/backup.age.pub
echo "Done: my age public key is in /etc/appetito/services/vaultwarden/backup.age.pub. No Tailscale on this server, so I skipped the HTTPS step."
