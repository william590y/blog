#!/bin/bash
set -euo pipefail
printf '\nScriptorium - Obsidian configuration installer\n'
default_path="$HOME/Documents/Scriptorium"
printf 'New vault folder (Enter for %s): ' "$default_path"
read -r destination
destination="${destination:-$default_path}"
case "$destination" in /*) ;; *) printf 'Please enter an absolute path.\n'; exit 1 ;; esac
if [ -e "$destination" ] || [ -L "$destination" ]; then
  printf 'Folder already exists: %s. Choose a new folder; nothing was changed.\n' "$destination"
  exit 1
fi
for utility in curl unzip; do
  command -v "$utility" >/dev/null || { printf 'Please install %s and try again.\n' "$utility"; exit 1; }
done
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
curl --fail --location --proto '=https' --tlsv1.2 'https://williamliaw.com/assets/downloads/Scriptorium.zip' -o "$work_dir/Writing.zip"
if command -v shasum >/dev/null; then
  actual_hash="$(shasum -a 256 "$work_dir/Writing.zip")"
elif command -v sha256sum >/dev/null; then
  actual_hash="$(sha256sum "$work_dir/Writing.zip")"
else
  printf 'Please install shasum or sha256sum for package verification.\n'; exit 1
fi
actual_hash="${actual_hash%% *}"
[ "$actual_hash" = '8cac15037dbb04e33c48f267fe4d60139c718aae9030e2d9fd8050a15b92da20' ] || { printf 'Package verification failed. Download the current installer from the Projects page.\n'; exit 1; }
unzip -q "$work_dir/Writing.zip" -d "$work_dir/vault"
[ -f "$work_dir/vault/.obsidian/appearance.json" ] || { printf 'Invalid configuration archive.\n'; exit 1; }
# mkdir fails if the destination appeared during the download; never merge into an existing vault.
mkdir -p "$(dirname "$destination")"
mkdir "$destination"
cp -R "$work_dir/vault/." "$destination/"
printf '\nInstalled in %s\n' "$destination"
printf 'Install EB Garamond and Cormorant Garamond for the intended typography.\nOpen Lorem Ipsum in Reading view. Review community plugins before enabling them.\n'
# Encode each byte so spaces, punctuation, and non-ASCII paths survive the URI.
encoded_path=''
while read -r byte; do
  [ -z "$byte" ] || encoded_path="${encoded_path}%${byte}"
done < <(printf '%s' "$destination" | od -An -v -tx1 | tr -s ' ' '\n')
if [ "$(uname -s)" = Darwin ]; then
  if ! open "obsidian://open?path=$encoded_path" 2>/dev/null; then
    open 'https://obsidian.md/download'
    printf 'After installing Obsidian, choose Open folder as vault and select the folder above.\n'
  fi
elif command -v xdg-open >/dev/null; then
  if command -v xdg-mime >/dev/null && [ -n "$(xdg-mime query default x-scheme-handler/obsidian)" ]; then
    xdg-open "obsidian://open?path=$encoded_path" || true
  else
    xdg-open 'https://obsidian.md/download' || true
    printf 'After installing Obsidian, choose Open folder as vault and select the folder above.\n'
  fi
fi
printf '\nPress Enter to close. '
read -r _
