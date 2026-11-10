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
verify_hash() {
  local actual_hash
  if command -v shasum >/dev/null; then
    actual_hash="$(shasum -a 256 "$1")"
  elif command -v sha256sum >/dev/null; then
    actual_hash="$(sha256sum "$1")"
  else
    printf 'Please install shasum or sha256sum for package verification.\n'; exit 1
  fi
  actual_hash="${actual_hash%% *}"
  [ "$actual_hash" = "$2" ] || { echo "Download verification failed for $1."; exit 1; }
}
verify_hash "$work_dir/Writing.zip" '3c7353f7822f0bd31d51fab2f1a94b5160d163cc10b76828005e8ba7762b5683'
unzip -q "$work_dir/Writing.zip" -d "$work_dir/vault"
[ -f "$work_dir/vault/.obsidian/appearance.json" ] || { printf 'Invalid configuration archive.\n'; exit 1; }
app_path="$(osascript -l JavaScript -e 'ObjC.import("AppKit"); const url = $.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier("md.obsidian"); if (url && !url.isNil()) ObjC.unwrap(url.path)' 2>/dev/null || true)"
if [ ! -d "$app_path" ] && [ -d /Applications/Obsidian.app ]; then
  app_path=/Applications/Obsidian.app
fi
if [ ! -d "$app_path" ]; then
  app_path="$HOME/Applications/Obsidian.app"
  if [ ! -d "$app_path" ]; then
    echo "Installing Obsidian in $HOME/Applications ..."
    curl --fail --location --proto '=https' --tlsv1.2 'https://github.com/obsidianmd/obsidian-releases/releases/download/v1.15.0/Obsidian-1.15.0.dmg' -o "$work_dir/Obsidian.dmg"
    verify_hash "$work_dir/Obsidian.dmg" 'd3f837e6fd3efaf65fa0bec987b18296982995d4ddae3171a7f7f67e0e2b7aa8'
    mount_dir="$work_dir/disk"
    mkdir "$mount_dir"
    hdiutil attach -readonly -nobrowse -mountpoint "$mount_dir" "$work_dir/Obsidian.dmg" >/dev/null
    trap 'hdiutil detach "$mount_dir" >/dev/null && rm -rf "$work_dir"' EXIT
    mkdir -p "$HOME/Applications"
    staging_app="$(mktemp -d "$HOME/Applications/.obsidian-XXXXXXXX")"
    if ! ditto "$mount_dir/Obsidian.app" "$staging_app/Obsidian.app" || ! mv -n "$staging_app/Obsidian.app" "$app_path"; then
      rm -rf "$staging_app"
      exit 1
    fi
    rm -rf "$staging_app"
    hdiutil detach "$mount_dir" >/dev/null
    trap 'rm -rf "$work_dir"' EXIT
  fi
fi
# mkdir fails if the destination appeared during the download; never merge into an existing vault.
mkdir -p "$(dirname "$destination")"
mkdir "$destination"
cp -R "$work_dir/vault/." "$destination/"
printf '\nInstalled in %s\n' "$destination"
printf 'Install EB Garamond and Cormorant Garamond for the intended typography.\nOpen Lorem Ipsum in Reading view. Review community plugins before enabling them.\n'
printf 'In Obsidian, choose Open folder as vault and select %s\n' "$destination"
open -a "$app_path" obsidian://choose-vault
printf '\nPress Enter to close. '
read -r _
