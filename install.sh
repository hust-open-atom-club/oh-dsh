#!/bin/sh
# Oh-DSH latest-release installer.
#
# Installs a published Oh-DSH release from GitHub without cloning the
# repository: resolves the latest stable release (or a pinned --version),
# downloads the artifact for the detected OS/architecture, verifies the
# published SHA-256 digest, and swaps the previous installation only after
# the new one is fully staged. Supported surfaces: desktop, web, tui.
#
# Usage:
#   curl -fsSL \
#     https://raw.githubusercontent.com/hust-open-atom-club/oh-dsh/main/install.sh \
#     | bash
#   sh install.sh --surface web --version v0.1.8
#   sh install.sh --uninstall --surface desktop
#   sh install.sh --local --surface tui        # install the local repo build
#
# Unix/macOS only; Windows uses install.ps1 from the same repository.
# On Windows under Git Bash, run install.ps1 from PowerShell instead.

set -eu

REPO_DEFAULT='hust-open-atom-club/oh-dsh'
API_BASE_DEFAULT='https://api.github.com'
DOWNLOAD_BASE_DEFAULT='https://github.com'
APP_NAME='Oh-DSH Desktop'
LEGACY_APP_NAME='Oh-DSH-Desktop.app'
BUNDLE_ID='ai.deepseek.oh-dsh-desktop'
LSREGISTER_DEFAULT='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
PLUTIL_DEFAULT='/usr/bin/plutil'

usage() {
  cat <<'EOF'
install.sh — install Oh-DSH from the latest GitHub Release

Usage:
  sh install.sh [options]

Options:
  -s, --surface NAME    Surface to install: tui (default), desktop, or web.
                        Each surface installs only its own files and launcher.
  -v, --version TAG     Release tag to install (for example v0.1.8).
                        Default: the latest stable Release. Prereleases are
                        never selected implicitly; pin --version to install one.
  -d, --dest DIR        Install destination.
                        desktop on macOS: directory receiving the .app
                          (default /Applications).
                        desktop on Linux: directory receiving the AppImage
                          (default ~/.local/bin).
                        web/tui: payload directory
                          (default ~/.local/share/oh-dsh/<surface>).
      --bin-dir DIR     Directory receiving the `ohdsh` launcher symlink for
                        web/tui (default ~/.local/bin).
      --local           Install the artifacts this repository's
                        pnpm run dist:<surface> commands placed under
                        release/ instead of downloading a GitHub Release.
                        The script must run from a repository checkout
                        (see --local-root for another path), and --version /
                        --repo are rejected beside it. The installed
                        version is the checkout's package.json version.
      --local-root DIR  Repository checkout to install from with --local
                        (default: the directory containing install.sh).
      --repo SLUG       GitHub owner/repo (default hust-open-atom-club/oh-dsh).
      --uninstall       Remove the installed surface instead of installing.
      --force           Reinstall even when the same version is installed.
      --os NAME         Override OS detection: darwin or linux (advanced).
      --arch NAME       Override architecture detection: arm64 or x64
                        (advanced).
  -h, --help            Show this help.

Environment:
  OH_DSH_SURFACE, OH_DSH_VERSION, OH_DSH_INSTALL_DIR, OH_DSH_BIN_DIR,
  OH_DSH_REPO       Same meaning as the matching options; options win.
  OH_DSH_LOCAL      Same as --local when set to 1.
  OH_DSH_OS, OH_DSH_ARCH   Same meaning as --os/--arch.
  OH_DSH_API_BASE, OH_DSH_DOWNLOAD_BASE
                   Override the GitHub API and download base URLs.
  GH_TOKEN, GITHUB_TOKEN
                   Optional token for authenticated GitHub API requests.

Uninstall:
  sh install.sh --uninstall [--surface NAME] [--dest DIR] [--bin-dir DIR]

Files:
  web/tui installs a payload plus an `ohdsh` dispatcher in --bin-dir; desktop
  installs its native app and registers the same dispatcher when possible.
EOF
}

die() {
  printf 'install.sh: %s\n' "$1" >&2
  exit 1
}

log() {
  printf '==> %s\n' "$1"
}

# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------

surface=${OH_DSH_SURFACE:-tui}
version_arg=${OH_DSH_VERSION:-}
dest_arg=${OH_DSH_INSTALL_DIR:-}
bin_dir_arg=${OH_DSH_BIN_DIR:-}
repo=${OH_DSH_REPO:-$REPO_DEFAULT}
os_arg=${OH_DSH_OS:-}
arch_arg=${OH_DSH_ARCH:-}
force=0
uninstall=0
local_install=${OH_DSH_LOCAL:-0}
local_root=

while [ "$#" -gt 0 ]; do
  case "$1" in
    -s|--surface)
      [ "$#" -ge 2 ] || die "$1 requires a value"
      surface=$2
      shift 2
      ;;
    -v|--version)
      [ "$#" -ge 2 ] || die "$1 requires a value"
      version_arg=$2
      shift 2
      ;;
    -d|--dest)
      [ "$#" -ge 2 ] || die "$1 requires a value"
      dest_arg=$2
      shift 2
      ;;
    --bin-dir)
      [ "$#" -ge 2 ] || die "$1 requires a value"
      bin_dir_arg=$2
      shift 2
      ;;
    --repo)
      [ "$#" -ge 2 ] || die "$1 requires a value"
      repo=$2
      shift 2
      ;;
    --local)
      local_install=1
      shift
      ;;
    --local-root)
      [ "$#" -ge 2 ] || die "$1 requires a value"
      local_root=$2
      local_install=1
      shift 2
      ;;
    --force)
      force=1
      shift
      ;;
    --uninstall)
      uninstall=1
      shift
      ;;
    --os)
      [ "$#" -ge 2 ] || die "$1 requires a value"
      os_arg=$2
      shift 2
      ;;
    --arch)
      [ "$#" -ge 2 ] || die "$1 requires a value"
      arch_arg=$2
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1 (see --help)"
      ;;
  esac
done

case "$surface" in
  desktop|web|tui) ;;
  *) die "unsupported surface '$surface' (expected desktop, web, or tui)" ;;
esac

[ -n "${HOME:-}" ] || die 'HOME is not set; cannot determine default locations'
[ "$local_install" = 1 ] || command -v curl >/dev/null 2>&1   || die 'curl is required (https://curl.se)'

api_base=${OH_DSH_API_BASE:-$API_BASE_DEFAULT}
download_base=${OH_DSH_DOWNLOAD_BASE:-$DOWNLOAD_BASE_DEFAULT}
# Payload destinations follow the XDG data home; installer bookkeeping
# (launcher records and system-install markers) lives under the shared Oh-DSH
# state root owned by src/data-root.ts, so one OH_DSH_HOME override moves it.
data_home=${XDG_DATA_HOME:-$HOME/.local/share}/oh-dsh
# OH_DSH_INSTALLER_HOME is the installers' explicit record-root knob (what
# install.ps1's -DataHome and the generated dispatcher export); it wins over
# deriving the root from OH_DSH_HOME so relocated records stay put.
if [ -n "${OH_DSH_INSTALLER_HOME:-}" ]; then
  record_home=$OH_DSH_INSTALLER_HOME
else
  record_home=${OH_DSH_HOME:-$HOME/.ohdsh}/installer
fi

# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------

kernel=$(uname -s)
case "$kernel" in
  Darwin) detected_os=darwin ;;
  Linux) detected_os=linux ;;
  MINGW*|MSYS*|CYGWIN*)
    die "install.sh does not support Windows shells ($kernel). Run install.ps1 from PowerShell: irm https://raw.githubusercontent.com/$repo/main/install.ps1 | iex"
    ;;
  *)
    die "unsupported operating system '$kernel' (supported: macOS, Linux)"
    ;;
esac

machine=$(uname -m)
case "$machine" in
  arm64|aarch64) detected_arch=arm64 ;;
  x86_64|amd64) detected_arch=x64 ;;
  *)
    die "unsupported architecture '$machine' (published targets: darwin arm64/x64, linux x64, windows x64)"
    ;;
esac

os=${os_arg:-$detected_os}
arch=${arch_arg:-$detected_arch}

case "$os" in
  darwin|linux) ;;
  win|win32|windows)
    die "install.sh does not install Windows releases; run install.ps1 from PowerShell: irm https://raw.githubusercontent.com/$repo/main/install.ps1 | iex"
    ;;
  *) die "unsupported --os '$os' (expected darwin or linux)" ;;
esac
case "$arch" in
  arm64|x64) ;;
  *) die "unsupported --arch '$arch' (expected arm64 or x64)" ;;
esac

if [ "$os" = linux ] && [ "$arch" = arm64 ]; then
  die "no linux-arm64 Release assets are published yet; see https://github.com/$repo/releases for available targets"
fi

# ---------------------------------------------------------------------------
# Destinations
# ---------------------------------------------------------------------------

bin_dir=${bin_dir_arg:-$HOME/.local/bin}
case "$bin_dir" in
  */) bin_dir=${bin_dir%/} ;;
esac

case "$surface" in
  web|tui)
    dest=${dest_arg:-$data_home/$surface}
    ;;
  desktop)
    if [ "$os" = darwin ]; then
      dest=${dest_arg:-/Applications}
    else
      dest=${dest_arg:-$bin_dir}
    fi
    ;;
esac
case "$dest" in
  */) dest=${dest%/} ;;
esac
# Records, markers, and dispatchers must carry absolute paths: a relative
# --dest would otherwise resolve against whatever directory the launcher is
# invoked from later.
# Records, markers, and dispatchers must carry canonical absolute paths:
# `./apps`, `../apps`, and their absolute spelling must compare equal, or a
# rerun would treat the same directory as a relocation and retire it.
canonicalize_path() {
  # $1: path. Existing components are resolved with pwd -P; a missing leaf
  # keeps its parent's canonical form.
  if [ -d "$1" ]; then
    (cd "$1" && pwd -P)
    return
  fi
  canon_dir=$(dirname -- "$1")
  canon_base=$(basename -- "$1")
  if [ -d "$canon_dir" ]; then
    printf '%s/%s' "$(cd "$canon_dir" && pwd -P)" "$canon_base"
  else
    printf '%s' "$1"
  fi
}
dest=$(canonicalize_path "$dest")
bin_dir=$(canonicalize_path "$bin_dir")

desktop_marker=$record_home/desktop.env

relocated_desktop_dest=''
workdir=''
cleanup() {
  if [ -n "$workdir" ] && [ -d "$workdir" ]; then
    rm -rf "$workdir"
  fi
}
trap cleanup EXIT INT TERM

make_workdir() {
  workdir=$(mktemp -d "${TMPDIR:-/tmp}/oh-dsh-install.XXXXXXXXXX")
}

timestamp() {
  date +%Y%m%d-%H%M%S
}

version_older() {
  # True when dotted version $1 is strictly older than $2, mirroring the
  # numeric compare in src/mac-bundle-migration.ts.
  left=$1
  right=$2
  while :; do
    left_part=${left%%.*}
    right_part=${right%%.*}
    case "$left_part" in ''|*[!0-9]*) left_part=0 ;; esac
    case "$right_part" in ''|*[!0-9]*) right_part=0 ;; esac
    if [ "$left_part" -lt "$right_part" ]; then return 0; fi
    if [ "$left_part" -gt "$right_part" ]; then return 1; fi
    case "$left" in *.*) left=${left#*.} ;; *) left=0 ;; esac
    case "$right" in *.*) right=${right#*.} ;; *) right=0 ;; esac
    if [ "$left" = 0 ] && [ "$right" = 0 ]; then return 1; fi
  done
}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    die 'neither shasum nor sha256sum is available to verify downloads'
  fi
}

gh_curl() {
  # The token is a GitHub credential: it is attached only when the API base
  # is the GitHub API itself, never to a mirror or test override.
  auth=''
  if { [ -n "${GH_TOKEN:-}" ] || [ -n "${GITHUB_TOKEN:-}" ]; } \
    && [ "$api_base" = "$API_BASE_DEFAULT" ]; then
    auth="Authorization: Bearer ${GH_TOKEN:-$GITHUB_TOKEN}"
  fi
  if [ -n "$auth" ]; then
    curl -fsSL --retry 3 --retry-delay 2 \
      -H "$auth" \
      -H 'Accept: application/vnd.github+json' \
      -H 'User-Agent: oh-dsh-install' \
      "$@"
  else
    curl -fsSL --retry 3 --retry-delay 2 \
      -H 'Accept: application/vnd.github+json' \
      -H 'User-Agent: oh-dsh-install' \
      "$@"
  fi
}

download_curl() {
  curl -fsSL --retry 3 --retry-delay 2 \
    -H 'User-Agent: oh-dsh-install' \
    "$@"
}

json_compact() {
  # GitHub responses are normally compact, but tolerate pretty-printed JSON
  # from proxies or future API changes: strip all whitespace before parsing.
  # Neither the asset names nor the digests we match contain whitespace.
  printf '%s' "$1" | tr -d ' \t\r\n'
}

json_tag() {
  json_compact "$1" | tr ',' '\n' | sed -n 's/^"tag_name":"\([^"]*\)"$/\1/p' | head -n 1
}

json_asset_digest() {
  # Asset objects contain a nested "uploader" object, so splitting on
  # '{' would break "name" and "digest" onto different lines. Asset objects
  # are separated by '},{', and nothing inside an asset (the flat uploader
  # object included) matches that sequence, so it isolates one asset per
  # line regardless of field order.
  json_compact "$1" | awk '{ gsub(/\},\{/, "\n"); print }' \
    | grep -F "\"name\":\"$2\"" \
    | grep -o '"digest":"sha256:[0-9a-f]*"' \
    | head -n 1 \
    | sed 's/^"digest":"sha256://; s/"$//'
}

write_marker() {
  # Release-derived values must stay inert text: only the closed token
  # charset is accepted, and readers parse per line without evaluating.
  for value in "$surface" "$tag" "$version" "$asset" "$os" "$arch" "$repo"; do
    case "$value" in
      ''|*[!A-Za-z0-9._+/-]*) die "refusing to write marker with unsafe value: $value" ;;
    esac
  done
  printf 'OH_DSH_INSTALL_SURFACE=%s\n' "$surface" \
    > "$1"
  printf 'OH_DSH_INSTALL_TAG=%s\n' "$tag" >> "$1"
  printf 'OH_DSH_INSTALL_VERSION=%s\n' "$version" >> "$1"
  printf 'OH_DSH_INSTALL_ASSET=%s\n' "$asset" >> "$1"
  printf 'OH_DSH_INSTALL_OS=%s\n' "$os" >> "$1"
  printf 'OH_DSH_INSTALL_ARCH=%s\n' "$arch" >> "$1"
  printf 'OH_DSH_INSTALL_REPO=%s\n' "$repo" >> "$1"
  # Destinations may contain spaces; they are read back whole-line and are
  # never evaluated, so no quoting is needed.
  printf 'OH_DSH_INSTALL_DEST=%s\n' "$dest" >> "$1"
}

marker_field() {
  # $1: marker path, $2: key. Prints the whole-line value or nothing; never
  # interprets the file as shell code.
  [ -f "$1" ] || return 0
  sed -n "s/^$2=//p" "$1" | head -n 1
}

launcher_current() {
  # The requested launcher counts as present only when it is a working
  # dispatcher we generated or a symlink straight into this payload.
  target=$bin_dir/ohdsh
  if [ -L "$target" ]; then
    [ "$(readlink "$target")" = "$dest/bin/ohdsh" ]
    return
  fi
  [ -f "$target" ] && [ -x "$target" ] \
    && grep -q 'Oh-DSH launcher installed by install.sh' "$target" 2>/dev/null
}

same_version_installed() {
  # $1: marker path. Only reports "current" when the marker matches this
  # release AND the artifacts it describes are still present, so a broken
  # launcher or a moved destination is repaired by an ordinary rerun.
  [ -f "$1" ] || return 1
  [ "$(marker_field "$1" OH_DSH_INSTALL_SURFACE)" = "$surface" ] || return 1
  [ "$(marker_field "$1" OH_DSH_INSTALL_VERSION)" = "$version" ] || return 1
  [ "$(marker_field "$1" OH_DSH_INSTALL_ASSET)" = "$asset" ] || return 1
  [ "$(marker_field "$1" OH_DSH_INSTALL_REPO)" = "$repo" ] || return 1
  case "$surface" in
    desktop)
      [ "$(marker_field "$1" OH_DSH_INSTALL_DEST)" = "$dest" ] || return 1
      if [ "$os" = darwin ]; then
        app_current="$dest/$APP_NAME.app"
        stale_bundle_is_ours "$app_current" || return 1
        [ -n "$(find "$app_current/Contents/MacOS" -type f -perm -u+x 2>/dev/null | head -n 1)" ] || return 1
      else
        [ -x "$dest/oh-dsh-desktop" ] || return 1
      fi
      launcher_current || return 1
      ;;
    web|tui)
      [ -x "$dest/bin/ohdsh" ] || return 1
      if ! launcher_current; then return 1; fi
      ;;
  esac
  return 0
}

verify_replaceable_app() {
  # $1: existing bundle path. Accepts bundles carrying our Info.plist
  # identity; a directory without a verifiable Oh-DSH identity is refused
  # instead of being deleted sight unseen.
  app=$1
  plist="$app/Contents/Info.plist"
  if [ ! -f "$plist" ]; then
    die "refusing to replace $app: it has no Contents/Info.plist and may not be an Oh-DSH installation"
  fi
  plutil_bin=${OH_DSH_PLUTIL:-$PLUTIL_DEFAULT}
  if [ ! -x "$plutil_bin" ]; then
    die "refusing to replace $app: its identity cannot be verified (plutil unavailable); remove it manually first"
  fi
  identifier=$("$plutil_bin" -extract CFBundleIdentifier raw -o - "$plist" 2>/dev/null || true)
  if [ "$identifier" != "$BUNDLE_ID" ]; then
    die "refusing to replace $app: bundle identifier ${identifier:-unreadable} is not $BUNDLE_ID"
  fi
}

purge_our_payload_dirs() {
  # Remove only directories that carry this surface's install marker or the
  # payload shape this installer stages (bin/ohdsh + lib); never a foreign
  # sibling that merely shares the staging prefix.
  for entry in "$@"; do
    [ -d "$entry" ] || continue
    if [ "$(marker_field "$entry/.oh-dsh-install.env" OH_DSH_INSTALL_SURFACE)" = "$surface" ] \
      || { [ -x "$entry/bin/ohdsh" ] && [ -d "$entry/lib" ]; }; then
      rm -rf "$entry"
    fi
  done
}

# ---------------------------------------------------------------------------
# Launcher dispatching (web and tui payloads each carry only their own
# surface's dependencies, so one launcher must route each surface to the
# payload that provides it)
# ---------------------------------------------------------------------------

launcher_env=$record_home/launcher.env

surface_dest_key() {
  printf '%s_DEST' "$(printf '%s' "$surface" | tr '[:lower:]' '[:upper:]')"
}

write_launcher_env() {
  # Record the surface destination and the launcher directory so `ohdsh
  # update` can reconstruct the exact install locations. Relocating a
  # surface retires the previous installer-owned payload afterwards, so
  # exactly one installation remains per surface.
  key=$(surface_dest_key)
  mkdir -p "$record_home"
  surface_key=${key%_DEST}
  relocated_previous=$(marker_field "$launcher_env" "$key")
  relocated_previous_bin=$(marker_field "$launcher_env" BIN_DIR)
  tmp="$launcher_env.tmp.$$"
  {
    [ -f "$launcher_env" ] \
      && sed -e "/^$key=/d" -e "/^${surface_key}_REPO=/d" \
        -e "/^${surface_key}_OS=/d" -e "/^${surface_key}_EXE=/d" \
        -e '/^BIN_DIR=/d' "$launcher_env"
    printf '%s=%s\n' "$key" "$dest"
    printf 'BIN_DIR=%s\n' "$bin_dir"
    printf '%s_REPO=%s\n' "$surface_key" "$repo"
    printf '%s_OS=%s\n' "$surface_key" "$os"
    if [ "$surface" = desktop ]; then
      case "$os" in
        darwin) printf 'DESKTOP_EXE=%s/Oh-DSH Desktop.app/Contents/MacOS/Oh-DSH Desktop\n' "$dest" ;;
        linux) printf 'DESKTOP_EXE=%s/oh-dsh-desktop\n' "$dest" ;;
      esac
    fi
  } > "$tmp"
  mv -f "$tmp" "$launcher_env"
  if [ -n "$relocated_previous" ] && [ "$relocated_previous" != "$dest" ] \
    && [ "$(marker_field "$relocated_previous/.oh-dsh-install.env" OH_DSH_INSTALL_SURFACE)" = "$surface" ]; then
    rm -rf "$relocated_previous"
    log "Retired the previous $surface installation at $relocated_previous"
  fi
  # Relocating the launcher directory retires the previous dispatcher when
  # it is ours and no remaining record points at it.
  if [ -n "$relocated_previous_bin" ] && [ "$relocated_previous_bin" != "$bin_dir" ] \
    && [ -f "$relocated_previous_bin/ohdsh" ] && [ ! -L "$relocated_previous_bin/ohdsh" ] \
    && grep -q 'Oh-DSH launcher installed by install.sh' "$relocated_previous_bin/ohdsh" 2>/dev/null; then
    rm -f "$relocated_previous_bin/ohdsh"
    log "Retired the previous launcher at $relocated_previous_bin/ohdsh"
  fi
}

# Remove one surface's destination record; returns 1 when no surfaces remain.
remove_launcher_env_key() {
  # $1: key. BIN_DIR stays while another surface still needs the launcher.
  [ -f "$launcher_env" ] || return 1
  tmp="$launcher_env.tmp.$$"
  if [ "$1" = DESKTOP_DEST ]; then
    sed -e "/^$1=/d" -e '/^DESKTOP_EXE=/d' -e "/^${1%_DEST}_REPO=/d" \
      -e "/^${1%_DEST}_OS=/d" "$launcher_env" > "$tmp"
  else
    sed -e "/^$1=/d" -e "/^${1%_DEST}_REPO=/d" -e "/^${1%_DEST}_OS=/d" "$launcher_env" > "$tmp"
  fi
  if grep -Eq '^(DESKTOP|WEB|TUI)_DEST=' "$tmp"; then
    mv -f "$tmp" "$launcher_env"
    return 0
  fi
  rm -f "$tmp" "$launcher_env"
  return 1
}

ensure_dispatcher_target_available() {
  # $1: launcher path. An unrelated file or symlink at the target is never
  # overwritten; a legacy symlink to one of our payload launchers, or a
  # previously generated dispatcher, is.
  target=$1
  if [ -L "$target" ]; then
    link_target=$(readlink "$target")
    for candidate_root in \
      "$(marker_field "$launcher_env" WEB_DEST)" \
      "$(marker_field "$launcher_env" TUI_DEST)" \
      "$(marker_field "$launcher_env" DESKTOP_DEST)" \
      "$data_home/web" \
      "$data_home/tui"; do
      [ -n "$candidate_root" ] || continue
      if [ "$link_target" = "$candidate_root/bin/ohdsh" ]; then
        return 0
      fi
    done
    die "refusing to replace $target: it links to $link_target, not a recorded Oh-DSH payload launcher"
  fi
  if [ -e "$target" ] \
    && ! grep -q 'Oh-DSH launcher installed by install.sh' "$target" 2>/dev/null; then
    die "refusing to replace $target: it is not an Oh-DSH launcher; remove it or pass another --bin-dir"
  fi
}

install_dispatcher() {
  # $1: launcher path. The dispatcher resolves surfaces at run time from
  # launcher.env, so one launcher serves every installed surface and the
  # second surface never steals the first one's link.
  target=$1
  ensure_dispatcher_target_available "$target"
  escaped_env=$(printf '%s' "$launcher_env" | sed "s/'/'\\\\''/g")
  tmp="$target.new.$$"
  rm -f "$tmp"
  cat > "$tmp" <<EOF
#!/bin/sh
# Oh-DSH launcher installed by install.sh. Routes each surface to the
# payload that provides it; destinations live in the launcher env file.
set -eu

ENV_FILE='$escaped_env'

# When the baked record root differs from what the runtime environment would
# derive, export it so the launched payload reads the same records.
default_env=\${OH_DSH_HOME:-\$HOME/.ohdsh}/installer/launcher.env
if [ "\$ENV_FILE" != "\$default_env" ]; then
  OH_DSH_INSTALLER_HOME=\$(dirname -- "\$ENV_FILE")
  export OH_DSH_INSTALLER_HOME
fi

web_dest=''
tui_dest=''
desktop_dest=''
desktop_exec=''
if [ -f "\$ENV_FILE" ]; then
  web_dest=\$(sed -n 's/^WEB_DEST=//p' "\$ENV_FILE" | head -n 1)
  tui_dest=\$(sed -n 's/^TUI_DEST=//p' "\$ENV_FILE" | head -n 1)
  desktop_dest=\$(sed -n 's/^DESKTOP_DEST=//p' "\$ENV_FILE" | head -n 1)
  desktop_exec=\$(sed -n 's/^DESKTOP_EXE=//p' "\$ENV_FILE" | head -n 1)
fi

surface=\${1:-}
case "\$surface" in
  web)
    if [ -z "\$web_dest" ] || [ ! -x "\$web_dest/bin/ohdsh" ]; then
      printf 'Oh-DSH web is not installed. Re-run the install script with --surface web.\\n' >&2
      exit 2
    fi
    exec "\$web_dest/bin/ohdsh" "\$@"
    ;;
  tui)
    if [ -z "\$tui_dest" ] || [ ! -x "\$tui_dest/bin/ohdsh" ]; then
      printf 'Oh-DSH tui is not installed. Re-run the install script with --surface tui.\\n' >&2
      exit 2
    fi
    exec "\$tui_dest/bin/ohdsh" "\$@"
    ;;
  desktop|gui)
    if [ -z "\$desktop_exec" ] || [ ! -x "\$desktop_exec" ]; then
      printf 'Oh-DSH desktop is not installed. Re-run the install script with --surface desktop.\\n' >&2
      exit 2
    fi
    shift
    exec "\$desktop_exec" "\$@"
    ;;
  *)
    if [ -n "\$tui_dest" ] && [ -x "\$tui_dest/bin/ohdsh" ]; then
      exec "\$tui_dest/bin/ohdsh" "\$@"
    elif [ -n "\$web_dest" ] && [ -x "\$web_dest/bin/ohdsh" ]; then
      exec "\$web_dest/bin/ohdsh" "\$@"
    else
      if [ -n "\$desktop_exec" ] && [ -x "\$desktop_exec" ]; then
        exec "\$desktop_exec" "\$@"
      fi
    fi
    printf 'Oh-DSH is not installed. Re-run the install script from the repository README.\\n' >&2
    exit 2
    ;;
esac
EOF
  chmod 0755 "$tmp"
  mv -f "$tmp" "$target"
}

shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

ensure_launcher_profile() {
  profile=$1
  marker='# Oh-DSH launcher path'
  end_marker='# End Oh-DSH launcher path'
  mkdir -p "$(dirname "$profile")"
  tmp="$profile.ohdsh.$$"
  if [ -f "$profile" ]; then
    # Replace only the installer-owned stanza; preserve other shell setup.
    awk -v marker="$marker" -v end_marker="$end_marker" '
      $0 == marker { in_block=1; skip_end=0; next }
      in_block {
        if ($0 == end_marker) { in_block=0; next }
        if ($0 == "esac") { in_block=0; skip_end=1; next }
        next
      }
      skip_end && $0 == end_marker { skip_end=0; next }
      { skip_end=0; print }
    ' "$profile" > "$tmp"
  else
    : > "$tmp"
  fi
  quoted_bin=$(shell_quote "$bin_dir")
  {
    if [ -s "$tmp" ]; then printf '\n'; fi
    printf '%s\n' "$marker"
    printf 'case ":${PATH:-}:" in\n'
    printf '  *:%s:*) ;;\n' "$quoted_bin"
    printf "  *) PATH=%s:\${PATH:-}; export PATH ;;\n" "$quoted_bin"
    printf 'esac\n'
    printf '%s\n' "$end_marker"
  } >> "$tmp"
  mv -f "$tmp" "$profile"
  log "Added $bin_dir to PATH for new shells via $profile"
}

ensure_launcher_path() {
  shell_name=$(basename "${SHELL:-}")
  case "$shell_name" in
    bash)
      ensure_launcher_profile "$HOME/.bash_profile"
      ensure_launcher_profile "$HOME/.bashrc"
      ;;
    zsh)
      ensure_launcher_profile "${ZDOTDIR:-$HOME}/.zprofile"
      ensure_launcher_profile "${ZDOTDIR:-$HOME}/.zshrc"
      ;;
    *)
      ensure_launcher_profile "$HOME/.profile"
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------

remove_desktop_mac() {
  app="$dest/$APP_NAME.app"
  removed=0
  if [ -d "$app" ]; then
    verify_replaceable_app "$app"
    rm -rf "$app"
    log "Removed $app"
    removed=1
  fi
  legacy="$dest/$LEGACY_APP_NAME"
  if [ -d "$legacy" ]; then
    verify_replaceable_app "$legacy"
    rm -rf "$legacy"
    log "Removed legacy $legacy"
    removed=1
  fi
  lsregister_bin=${OH_DSH_LSREGISTER:-$LSREGISTER_DEFAULT}
  if [ "$removed" = 1 ] && [ -x "$lsregister_bin" ]; then
    "$lsregister_bin" -u "$app" >/dev/null 2>&1 || true
  fi
  if [ "$removed" = 1 ] && [ -f "$desktop_marker" ]; then
    rm -f "$desktop_marker"
    log "Removed $desktop_marker"
  fi
  if [ "$removed" = 1 ]; then
    remove_desktop_dispatcher
  fi
  [ "$removed" = 1 ] || log "No Oh-DSH Desktop app found under $dest; nothing to remove"
}

remove_desktop_linux() {
  image="$dest/oh-dsh-desktop"
  if [ -f "$image" ]; then
    if [ ! -f "$desktop_marker" ] \
      || [ "$(marker_field "$desktop_marker" OH_DSH_INSTALL_DEST)" != "$dest" ]; then
      die "refusing to remove $image: the desktop marker does not prove this destination is Oh-DSH-owned"
    fi
    rm -f "$image"
    log "Removed $image"
    if [ -f "$desktop_marker" ]; then
      rm -f "$desktop_marker"
      log "Removed $desktop_marker"
    fi
    remove_desktop_dispatcher
  else
    log "No oh-dsh-desktop AppImage found under $dest; nothing to remove"
  fi
}

remove_desktop_dispatcher() {
  link="$bin_dir/ohdsh"
  if remove_launcher_env_key DESKTOP_DEST; then
    install_dispatcher "$link"
    log "Launcher $link now serves the remaining installed surfaces"
  elif [ ! -f "$launcher_env" ] && [ -f "$link" ] && [ ! -L "$link" ] \
    && grep -q 'Oh-DSH launcher installed by install.sh' "$link" 2>/dev/null; then
    rm -f "$link"
    log "Removed launcher $link"
  fi
}

remove_surface_payload() {
  marker="$dest/.oh-dsh-install.env"
  removed=0
  if [ -d "$dest" ]; then
    # A recursive delete must be gated on proof that this directory is an
    # installer-owned payload for this surface.
    if [ ! -f "$marker" ] || [ "$(marker_field "$marker" OH_DSH_INSTALL_SURFACE)" != "$surface" ]; then
      die "refusing to remove $dest: no $surface installation marker found there; pass the exact --dest used at install time"
    fi
    rm -rf "$dest"
    log "Removed $dest"
    removed=1
  fi

  link="$bin_dir/ohdsh"
  # Retire legacy symlink launchers from earlier installer versions.
  if [ -L "$link" ]; then
    target=$(readlink "$link")
    case "$target" in
      "$dest"|"$dest"/*)
        rm -f "$link"
        log "Removed legacy launcher symlink $link"
        removed=1
        ;;
    esac
  fi

  # Records and the launcher only change when this destination's payload
  # (or its launcher) was actually removed; a mistyped --dest leaves the
  # real installation's records intact.
  if [ "$removed" = 1 ] || [ -n "$(marker_field "$launcher_env" "$(surface_dest_key)")" ]; then
    if [ "$removed" = 1 ] || [ "$(marker_field "$launcher_env" "$(surface_dest_key)")" = "$dest" ]; then
      if remove_launcher_env_key "$(surface_dest_key)"; then
        install_dispatcher "$link"
        log "Launcher $link now serves the remaining installed surfaces"
        removed=1
      elif [ ! -f "$launcher_env" ] && [ -f "$link" ] && [ ! -L "$link" ] \
        && grep -q 'Oh-DSH launcher installed by install.sh' "$link" 2>/dev/null; then
        rm -f "$link"
        log "Removed launcher $link"
        removed=1
      fi
    fi
  fi
  [ "$removed" = 1 ] || log "No $surface installation found at $dest; nothing to remove"
}

if [ "$uninstall" = 1 ]; then
  case "$surface" in
    desktop)
      if [ "$os" = darwin ]; then
        remove_desktop_mac
      else
        remove_desktop_linux
      fi
      ;;
    web|tui)
      remove_surface_payload
      ;;
  esac
  exit 0
fi

# ---------------------------------------------------------------------------
# Release selection
# ---------------------------------------------------------------------------

make_workdir

if [ "$local_install" = 1 ]; then
  [ -z "$version_arg" ] || die '--local installs the checkout version; --version cannot be combined with it'
  [ "$repo" = "$REPO_DEFAULT" ] || die '--local installs this checkout; --repo cannot be combined with it'
  if [ -n "$local_root" ]; then
    local_checkout=$local_root
  else
    local_checkout=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd) \
      || die 'failed to resolve the directory containing install.sh'
  fi
  [ -f "$local_checkout/package.json" ] \
    || die "$local_checkout is not a repository checkout (package.json missing); --local needs the repo after pnpm run dist:<surface>"
  version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$local_checkout/package.json" | head -n 1)
  case "$version" in
    ''|*[!A-Za-z0-9._+-]*) die "could not read a valid version from $local_checkout/package.json" ;;
  esac
  tag="v$version"
  local_artifact_dir=$local_checkout/release
  # The asset name is resolved by the shared case below; the local file must
  # exist under release/ with exactly that name.
else
  if [ -n "$version_arg" ]; then
    case "$version_arg" in
      v*) tag=$version_arg ;;
      *) tag="v$version_arg" ;;
    esac
    release_path="/repos/$repo/releases/tags/$tag"
  else
    release_path="/repos/$repo/releases/latest"
  fi

  log "Resolving $([ -n "$version_arg" ] && printf 'release %s' "$tag" || printf 'latest stable release') from $repo"
  release_json=$(gh_curl "$api_base$release_path") \
    || die "failed to fetch release information from $api_base$release_path"
  [ -n "$release_json" ] || die "empty release response from $api_base$release_path"
fi

if [ -z "${tag:-}" ]; then
  tag=$(json_tag "$release_json")
  [ -n "$tag" ] || die 'could not read tag_name from the release response'
fi
if [ "$local_install" != 1 ]; then
  if [ -z "${tag:-}" ]; then
    tag=$(json_tag "$release_json")
    [ -n "$tag" ] || die 'could not read tag_name from the release response'
  fi
  case "$tag" in
    v*) version=${tag#v} ;;
    *) version=$tag ;;
  esac
fi

case "$surface:$os" in
  desktop:darwin)
    asset="Oh-DSH-Desktop-$version-$arch.zip"
    ;;
  desktop:linux)
    asset="Oh-DSH-Desktop-$version-x86_64.AppImage"
    ;;
  web:*) asset="oh-dsh-web-$version-$os-$arch.tar.gz" ;;
  tui:*) asset="oh-dsh-tui-$version-$os-$arch.tar.gz" ;;
esac

if [ "$local_install" = 1 ]; then
  local_artifact=$local_artifact_dir/$asset
  [ -f "$local_artifact" ] \
    || die "$local_artifact_dir does not contain $asset; build it first (pnpm run dist:$surface produces release/ for this checkout)"
  digest=$(sha256_file "$local_artifact")
else
  digest=$(json_asset_digest "$release_json" "$asset")
  [ -n "$digest" ] \
    || die "release $tag publishes no sha256 digest for $asset; verify the asset list at https://github.com/$repo/releases/tag/$tag"
fi

# Refuse un-markable values before anything is downloaded or replaced, so a
# release identifier the marker cannot record never strands the install.
for value in "$surface" "$tag" "$version" "$asset" "$os" "$arch" "$repo"; do
  case "$value" in
    ''|*[!A-Za-z0-9._+/-]*) die "refusing to install: marker-unsafe release value $value" ;;
  esac
done

# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------

case "$surface" in
  web|tui) current_marker=$dest/.oh-dsh-install.env ;;
  desktop) current_marker=$desktop_marker ;;
esac

if [ "$force" != 1 ] && same_version_installed "$current_marker"; then
  log "$surface $version ($asset) is already installed; pass --force to reinstall"
  exit 0
fi

# ---------------------------------------------------------------------------
# Download and verify
# ---------------------------------------------------------------------------

if [ "$local_install" = 1 ]; then
  archive=$local_artifact
  log "Installing locally built $asset from $local_artifact_dir"
  log "Local build sha256:$digest"
else
  archive="$workdir/$asset"
  url="$download_base/$repo/releases/download/$tag/$asset"
  log "Downloading $asset"
  download_curl -o "$archive" "$url" \
    || die "failed to download $url"

  actual=$(sha256_file "$archive")
  if [ "$actual" != "$digest" ]; then
    die "checksum mismatch for $asset: expected sha256:$digest, got sha256:$actual; the previous installation was left untouched"
  fi
  log "Verified sha256:$digest"
fi

# ---------------------------------------------------------------------------
# Install: web and tui
# ---------------------------------------------------------------------------

install_payload_surface() {
  extract_dir="$workdir/extract"
  mkdir -p "$extract_dir"
  tar -xzf "$archive" -C "$extract_dir" \
    || die "failed to extract $asset; the previous installation was left untouched"

  set -- "$extract_dir"/*
  if [ "$#" -ne 1 ] || [ ! -d "$1" ]; then
    die "unexpected archive layout in $asset (expected one $surface payload directory); the previous installation was left untouched"
  fi
  payload=$1
  if [ ! -x "$payload/bin/ohdsh" ] || [ ! -d "$payload/lib" ]; then
    die "$asset does not contain a runnable $surface payload; the previous installation was left untouched"
  fi

  # The launcher collision check runs before any payload or record is
  # touched, so a refusal cannot strand a half-migrated installation.
  ensure_dispatcher_target_available "$bin_dir/ohdsh"

  parent=$(dirname -- "$dest")
  mkdir -p "$parent"
  staged="$dest.install-pending.$$"
  rm -rf "$staged"
  if ! mv -- "$payload" "$staged"; then
    rm -rf "$staged"
    die "failed to stage the new $surface payload; the previous installation was left untouched"
  fi

  previous="$dest.previous-$(timestamp)"
  had_previous=0
  if [ -e "$dest" ]; then
    # A pre-existing destination is only replaceable when it is an
    # installer-owned payload or an empty directory; unrelated data is never
    # recursively deleted because of a mistyped --dest.
    if [ "$(marker_field "$dest/.oh-dsh-install.env" OH_DSH_INSTALL_SURFACE)" != "$surface" ] \
      && [ -n "$(ls -A "$dest" 2>/dev/null)" ]; then
      die "refusing to replace $dest: it is not an Oh-DSH $surface payload (no matching install marker) and is not empty"
    fi
    mv -- "$dest" "$previous"
    had_previous=1
  fi
  if ! mv -- "$staged" "$dest"; then
    if [ "$had_previous" = 1 ]; then
      mv -- "$previous" "$dest"
    fi
    die "failed to move the staged $surface payload into place; the previous installation was left untouched"
  fi

  mkdir -p "$bin_dir"
  write_launcher_env
  install_dispatcher "$bin_dir/ohdsh"
  # The marker turns the install "current" only after the launcher exists,
  # so a rerun repairs a launcher that failed to materialize.
  write_marker "$dest/.oh-dsh-install.env"
  # Deletions happen only once the records are committed: a failure above
  # leaves the previous payload recoverable beside the new one.
  rm -rf "$previous"
  # Purge staged leftovers from interrupted upgrades — only entries that
  # still look like our own payloads; unrelated siblings sharing the prefix
  # are left alone.
  purge_our_payload_dirs "$dest.previous-"*
  purge_our_payload_dirs "$dest.install-pending."*

  log "Installed Oh-DSH $surface $version to $dest"
  log "Launcher: $bin_dir/ohdsh"
  ensure_launcher_path
  case ":${PATH:-}:" in
    *":$bin_dir:"*) ;;
    *)
      printf '    note: %s is not in PATH; add it with\n      export PATH="%s:$PATH"\n' "$bin_dir" "$bin_dir"
      ;;
  esac
  printf '    start with: %s %s\n' "$bin_dir/ohdsh" "$surface"
}

# ---------------------------------------------------------------------------
# Install: desktop on Linux (AppImage)
# ---------------------------------------------------------------------------

install_desktop_linux() {
  mkdir -p "$bin_dir"
  ensure_dispatcher_target_available "$bin_dir/ohdsh"
  mkdir -p "$dest"
  if [ ! -w "$dest" ]; then
    die "$dest is not writable; pass --dest DIR or rerun with sufficient privileges"
  fi
  staged="$dest/.oh-dsh-desktop.pending.$$"
  rm -f "$staged"
  if ! mv -- "$archive" "$staged"; then
    rm -f "$staged"
    die "failed to stage the new AppImage; the previous installation was left untouched"
  fi
  chmod 0755 "$staged"

  relocated_desktop_dest=$(marker_field "$desktop_marker" OH_DSH_INSTALL_DEST)
  image="$dest/oh-dsh-desktop"
  previous="$dest/.oh-dsh-desktop.previous-$(timestamp)"
  had_previous=0
  if [ -f "$image" ]; then
    # Only replace a file the desktop marker proves this installer owns.
    if [ ! -f "$desktop_marker" ] \
      || [ "$(marker_field "$desktop_marker" OH_DSH_INSTALL_DEST)" != "$dest" ]; then
      die "refusing to replace $image: the desktop marker does not prove this destination is Oh-DSH-owned; remove the file manually first"
    fi
    mv -- "$image" "$previous"
    had_previous=1
  fi
  if ! mv -- "$staged" "$image"; then
    if [ "$had_previous" = 1 ]; then
      mv -- "$previous" "$image"
    fi
    die "failed to move the staged AppImage into place; the previous installation was left untouched"
  fi

  mkdir -p "$record_home"
  write_marker "$desktop_marker"
  write_launcher_env
  install_dispatcher "$bin_dir/ohdsh"
  ensure_launcher_path
  retire_relocated_desktop_dest
  # Deletions happen only once the marker is committed.
  rm -f "$previous"
  # Only clean hidden staging names when the PRE-EXISTING marker proved this
  # destination was ours before this run; a first install into a directory
  # with foreign files never touches them.
  if [ "$relocated_desktop_dest" = "$dest" ]; then
    rm -f "$dest/.oh-dsh-desktop.previous-"* "$dest/.oh-dsh-desktop.pending."*
  fi

  log "Installed Oh-DSH Desktop $version to $image"
  log "Launcher: $bin_dir/ohdsh"
  printf '    start with: %s desktop\n' "$bin_dir/ohdsh"
  case ":${PATH:-}:" in
    *":$dest:"*) ;;
    *)
      printf '    note: %s is not in PATH; add it with\n      export PATH="%s:$PATH"\n' "$dest" "$dest"
      ;;
  esac
  printf '    start with: %s\n' "$image"
}

# ---------------------------------------------------------------------------
# Install: desktop on macOS (.app under /Applications)
# ---------------------------------------------------------------------------

retire_legacy_bundle() {
  # Retire a same-named legacy bundle only when its Info.plist proves it is
  # this application and strictly older than the release being installed.
  # Unverifiable or newer bundles stay in place, matching the probes in
  # src/mac-bundle-migration.ts.
  legacy=$1
  plist="$legacy/Contents/Info.plist"
  plutil_bin=${OH_DSH_PLUTIL:-$PLUTIL_DEFAULT}
  if [ ! -f "$plist" ] || [ ! -x "$plutil_bin" ]; then
    printf 'install.sh: warning: leaving %s in place (bundle could not be verified)\n' "$legacy" >&2
    return 0
  fi
  identifier=$("$plutil_bin" -extract CFBundleIdentifier raw -o - "$plist" 2>/dev/null || true)
  if [ "$identifier" != "$BUNDLE_ID" ]; then
    printf 'install.sh: warning: leaving %s in place (bundle identifier %s is not %s)\n' "$legacy" "${identifier:-unreadable}" "$BUNDLE_ID" >&2
    return 0
  fi
  legacy_version=$("$plutil_bin" -extract CFBundleShortVersionString raw -o - "$plist" 2>/dev/null || true)
  if [ -z "$legacy_version" ] || ! version_older "$legacy_version" "$version"; then
    printf 'install.sh: warning: leaving %s in place (version %s is not older than %s)\n' "$legacy" "${legacy_version:-unknown}" "$version" >&2
    return 0
  fi
  rm -rf "$legacy"
  log "Removed legacy $legacy ($legacy_version)"
}

retire_relocated_desktop_dest() {
  # Remove the installer-owned installation at the previously recorded
  # desktop destination when relocating with a different --dest, so exactly
  # one desktop installation remains.
  [ -n "$relocated_desktop_dest" ] || return 0
  [ "$relocated_desktop_dest" != "$dest" ] || return 0
  if [ "$os" = darwin ]; then
    old_app="$relocated_desktop_dest/$APP_NAME.app"
    if [ -d "$old_app" ]; then
      verify_replaceable_app "$old_app"
      rm -rf "$old_app"
      log "Retired the previous desktop installation at $old_app"
    fi
  else
    old_image="$relocated_desktop_dest/oh-dsh-desktop"
    if [ -f "$old_image" ]; then
      rm -f "$old_image"
      log "Retired the previous desktop installation at $old_image"
    fi
  fi
}

stale_bundle_is_ours() {
  # $1: candidate backup bundle. True only when the Info.plist carries this
  # bundle identifier; unverifiable candidates are never deleted.
  stale=$1
  plist="$stale/Contents/Info.plist"
  plutil_bin=${OH_DSH_PLUTIL:-$PLUTIL_DEFAULT}
  [ -f "$plist" ] && [ -x "$plutil_bin" ] || return 1
  identifier=$("$plutil_bin" -extract CFBundleIdentifier raw -o - "$plist" 2>/dev/null || true)
  [ "$identifier" = "$BUNDLE_ID" ]
}

quit_running_app() {
  osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
  if ! command -v pgrep >/dev/null 2>&1; then
    return 0
  fi
  attempt=0
  while [ "$attempt" -lt 50 ]; do
    if ! pgrep -f "$app_dest/" >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 0.1
  done
  die 'Oh-DSH Desktop did not quit cleanly; close it and rerun the installer'
}


install_desktop_mac() {
  mkdir -p "$bin_dir"
  ensure_dispatcher_target_available "$bin_dir/ohdsh"
  extract_dir="$workdir/extract"
  mkdir -p "$extract_dir"
  if command -v ditto >/dev/null 2>&1; then
    ditto -x -k "$archive" "$extract_dir" \
      || die "failed to extract $asset; the previous installation was left untouched"
  elif command -v unzip >/dev/null 2>&1; then
    unzip -qq "$archive" -d "$extract_dir" \
      || die "failed to extract $asset; the previous installation was left untouched"
  else
    tar -xf "$archive" -C "$extract_dir" \
      || die "failed to extract $asset (no ditto, unzip, or zip-capable tar); the previous installation was left untouched"
  fi

  set -- "$extract_dir"/*.app
  if [ "$#" -ne 1 ] || [ ! -d "$1" ]; then
    die "unexpected archive layout in $asset (expected one .app bundle); the previous installation was left untouched"
  fi
  app_source=$1
  executables=$(find "$app_source/Contents/MacOS" -type f -perm -u+x 2>/dev/null | head -n 1 || true)
  [ -n "$executables" ] \
    || die "$asset does not contain a runnable application bundle; the previous installation was left untouched"

  mkdir -p "$dest"
  if [ ! -w "$dest" ]; then
    die "$dest is not writable; pass --dest DIR (for example ~/Applications) or rerun with sufficient privileges"
  fi

  relocated_desktop_dest=$(marker_field "$desktop_marker" OH_DSH_INSTALL_DEST)
  app_dest="$dest/$APP_NAME.app"
  # Only the default /Applications destination is treated as owned by the
  # installer; custom destinations never touch the running session.
  if [ "$kernel" = Darwin ] \
    && [ "$app_dest" = "/Applications/$APP_NAME.app" ] \
    && [ -d "$app_dest" ]; then
    quit_running_app
  fi

  backup_dir=$dest
  reserve_backup() {
    # $1: base name without .app; the backup lives beside the app only until
    # the new bundle is validated, then it is deleted (no Trash buildup).
    stem="$1-before-$(timestamp)"
    index=0
    while :; do
      if [ "$index" = 0 ]; then
        candidate="$backup_dir/$stem.app"
      else
        candidate="$backup_dir/$stem-$index.app"
      fi
      if [ ! -e "$candidate" ]; then
        printf '%s' "$candidate"
        return 0
      fi
      index=$((index + 1))
    done
  }

  staged="$dest/.$APP_NAME.app.install.$$"
  rm -rf "$staged"
  if command -v ditto >/dev/null 2>&1; then
    copy_ok=0
    ditto "$app_source" "$staged" && copy_ok=1
  else
    copy_ok=0
    cp -R "$app_source" "$staged" && copy_ok=1
  fi
  if [ "$copy_ok" != 1 ]; then
    rm -rf "$staged"
    die "failed to stage the new app bundle; the previous installation was left untouched"
  fi

  backup=''
  had_previous=0
  if [ -e "$app_dest" ]; then
    # Only replace a bundle that is provably ours; a foreign directory that
    # merely shares the name must not be deleted.
    verify_replaceable_app "$app_dest"
    backup=$(reserve_backup "$APP_NAME")
    mv -- "$app_dest" "$backup"
    had_previous=1
  fi
  if ! mv -- "$staged" "$app_dest"; then
    if [ "$had_previous" = 1 ]; then
      mv -- "$backup" "$app_dest"
    fi
    die "failed to move the staged app bundle into place; the previous installation was left untouched"
  fi

  if [ -d "$dest/$LEGACY_APP_NAME" ]; then
    retire_legacy_bundle "$dest/$LEGACY_APP_NAME"
  fi

  # Purge stale pre-upgrade backups so Launch Services and Finder show
  # exactly one Oh-DSH Desktop — but only bundles whose Info.plist proves
  # they are ours; a user-created directory sharing the name survives.
  for stale in "$dest/$APP_NAME-before-"*.app "$dest/Oh-DSH-Desktop-before-"*.app; do
    if [ -e "$stale" ]; then
      if stale_bundle_is_ours "$stale"; then
        rm -rf "$stale"
      else
        printf 'install.sh: warning: leaving %s in place (unverifiable bundle)\n' "$stale" >&2
      fi
    fi
  done
  for stale in "$dest/.$APP_NAME.app.install."*; do
    if [ -d "$stale" ]; then
      if stale_bundle_is_ours "$stale"; then
        rm -rf "$stale"
      else
        printf 'install.sh: warning: leaving %s in place (unverifiable bundle)\n' "$stale" >&2
      fi
    fi
  done

  lsregister_bin=${OH_DSH_LSREGISTER:-$LSREGISTER_DEFAULT}
  if [ -x "$lsregister_bin" ]; then
    "$lsregister_bin" -f "$app_dest" >/dev/null 2>&1 \
      || printf 'install.sh: warning: Launch Services refresh failed; the app is installed but may need one Finder open to register\n' >&2
  fi

  mkdir -p "$record_home"
  write_marker "$desktop_marker"
  write_launcher_env
  install_dispatcher "$bin_dir/ohdsh"
  ensure_launcher_path
  retire_relocated_desktop_dest

  log "Installed $app_dest"
  log "Launcher: $bin_dir/ohdsh"
  printf '    start with: %s desktop\n' "$bin_dir/ohdsh"
  if [ "$had_previous" = 1 ]; then
    rm -rf "$backup"
    log "Removed the previous app bundle"
  fi
}

case "$surface:$os" in
  web:*|tui:*) install_payload_surface ;;
  desktop:linux) install_desktop_linux ;;
  desktop:darwin) install_desktop_mac ;;
  *) die "no install path for surface '$surface' on '$os'" ;;
esac

log "Done"
