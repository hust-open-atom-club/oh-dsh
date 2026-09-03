# Oh-DSH package builder.
#
# dshSource selects where the pinned DeepSeek Harness runtime comes from:
#   "llm-agents"  (default) — numtide/llm-agents.nix, pre-built npm package
#   "pinned"                — this repo's dsh-source.json npm release, with its
#                             committed pnpm dependency lock
#   "nixpkgs"               — pkgs.deepseek-harness (kept as a placeholder; the
#                             nixpkgs PR is not yet merged, so this throws)

{ pkgs, system, llm-agents, dshSourceSpec }:

{ surface # "full" | "web" | "tui"
, dshSource ? "llm-agents"
}:

let
  lib = pkgs.lib;

  isFull = surface == "full";
  includesWeb = surface != "tui";
  includesTui = surface != "web";

  # ---------------------------------------------------------------------------
  # DSH runtime selection
  # ---------------------------------------------------------------------------

  dshRuntime =
    if dshSource == "llm-agents" then
      llm-agents.packages.${system}.dsh
    else if dshSource == "pinned" then
      pkgs.callPackage ./dsh-runtime-pinned.nix { inherit dshSourceSpec; }
    else if dshSource == "nixpkgs" then
      # Reserved: the nixpkgs deepseek-harness PR has not landed yet.
      pkgs.deepseek-harness or (throw ''
        dshSource = "nixpkgs" requires pkgs.deepseek-harness, which is not yet
        in nixpkgs (see NixOS/nixpkgs#552467). Use "llm-agents" (default) or
        "pinned" for now.
      '')
    else
      throw "unknown dshSource: ${dshSource}";

  dshRuntimeRoot =
    if dshSource == "llm-agents" then
      "${dshRuntime}/lib/node_modules/@deepseek-ai/dsh"
    else
      "${dshRuntime}/lib/dsh";

  # ---------------------------------------------------------------------------
  # Oh-DSH front-end bundle. The same build produces all surface adapters;
  # the outer derivation controls which launchers and renderers are exposed.
  cleanSource = lib.cleanSourceWith {
    src = ../.;
    filter = path: type:
      let base = baseNameOf path;
      in !(lib.hasSuffix ".nix" base)
      && base != "flake.lock"
      && base != "release"
      && base != ".stage"
      && base != ".cache"
      && base != "node_modules"
      && base != "dist";
  };

  # NOTE: the fetchFromGitHub nar hashes below (better-sidebar, dsh-TUI,
  # dsh-auth, ecosystem-spec) and both fetchPnpmDeps hashes still carry the
  # 0.1.1-rc.2-era values; this workspace has no nix runner, so they must be
  # refreshed from an actual `nix build` (the mismatch errors print the new
  # hashes). See the dsh-0.1.2-alpha.3 upgrade agent note.
  betterSidebarSrc = pkgs.fetchFromGitHub {
    owner = "omdsh-dev";
    repo = "DSH-better-sidebar";
    rev = "9494774c4867cdb661c8f9a805c40f7982518868";
    hash = "sha256-bfpop+QKF8fRAl/vWjcTJgTkBA2bvHK+/KlBkR0NLa4=";
  };
  contextRelease = pkgs.fetchurl {
    url = "https://registry.npmjs.org/dsh-context/-/dsh-context-0.41.0.tgz";
    hash = "sha512-yPa+brCs/CKlH7bxIvAV3Q6MJzEXgTxqK0yap3tslBs022UKQNR1nV6HR+haPTK4B75BH2ujLYd3foH3vMjxCQ==";
  };
  tuiSrc = pkgs.fetchFromGitHub {
    owner = "ccch1mneyyy";
    repo = "dsh-TUI";
    rev = "f7db605713a861b28c004b2dc18813bb74d61154";
    hash = "sha256-AU3SxnjucUA8yvQia+cw/q3cqItRCFb/njaiRoiOS9c=";
  };
  dshAuthSrc = pkgs.fetchFromGitHub {
    owner = "ccch1mneyyy";
    repo = "dsh-auth";
    rev = "4e7cba3854e8874c8114bac2133aba3a7e1a65fe";
    hash = "sha256-ip/jdsm/YiPvVdZ0o2m/thImd+4ZmRjzQKzXvJ9dAK8=";
  };
  tuiRelease = pkgs.fetchurl {
    url = "https://registry.npmjs.org/@deepseek-harness-tui/dsh-tui/-/dsh-tui-0.10.0-beta.4.tgz";
    hash = "sha512-+DAyd7uWgSibjxiTtC/SFODt/TdNrrmS9dSAYP53VNAhA6sFcJATp1qPNhG/31coVM+mb5HmZD5rwX60MC/cCQ==";
  };
  dshAuthRelease = pkgs.fetchurl {
    url = "https://registry.npmjs.org/@deepseek-harness-tui/dsh-auth/-/dsh-auth-0.1.0.tgz";
    hash = "sha512-vggwtl0+fuZ9Xuwq9NC5MznT3ZpBfnqGTBgPUfEaqoTPXrxI0S+jcNcO3ou9Akn23cUAZikgmS7zHMVr+ZlXbw==";
  };
  tuiEcosystemSpecSrc = pkgs.fetchFromGitHub {
    owner = "T-Auto";
    repo = "dsh-ecosystem-spec";
    rev = "d28c267fe7fd775428ec2dccd65b0b7efd4dacee";
    hash = "sha256-7PK0j8gl3+1esTzjlrKOZkEei6OL13H/4JiIOf5LOR8=";
  };
  tuiStdSrc = pkgs.fetchFromGitHub {
    owner = "Yan-Zero";
    repo = "dsh-std";
    rev = "614dfa1ac168db79fcf4577cf0ebb34e2e3b944b";
    hash = "sha256-aJEykWAXEKTUsNte51+ZEhFAgLT6QNNplNZTNPhgb00=";
  };

  # fetchPnpmDeps and the real build MUST see the same workspace graph.
  source = pkgs.runCommand "oh-dsh-source" { } ''
    cp -r ${cleanSource} $out
    chmod -R u+w $out
    mkdir -p $out/upstream
    rm -rf $out/upstream/DSH-better-sidebar $out/upstream/dsh-TUI $out/upstream/dsh-context
    cp -r ${betterSidebarSrc} $out/upstream/DSH-better-sidebar
    cp -r ${tuiSrc} $out/upstream/dsh-TUI
    chmod -R u+w $out/upstream/dsh-TUI
    rm -rf $out/upstream/dsh-TUI/dsh-ecosystem-spec \
      $out/upstream/dsh-TUI/vendor/dsh-std
    # The renderer's bundled OAuth package arrives as a gitlink inside
    # tuiSrc; place its source so the pnpm resolution of link:./dsh-auth
    # finds the same tree the submodule build compiles.
    rm -rf $out/upstream/dsh-TUI/dsh-auth
    cp -r ${dshAuthSrc} $out/upstream/dsh-TUI/dsh-auth
    mkdir -p $out/upstream/dsh-TUI/vendor
    cp -r ${tuiEcosystemSpecSrc} \
      $out/upstream/dsh-TUI/dsh-ecosystem-spec
    cp -r ${tuiStdSrc} $out/upstream/dsh-TUI/vendor/dsh-std
    mkdir -p $out/upstream/dsh-TUI-release
    tar -xzf ${tuiRelease} --strip-components=1 \
      -C $out/upstream/dsh-TUI-release
    mkdir -p $out/upstream/dsh-auth-release
    tar -xzf ${dshAuthRelease} --strip-components=1 \
      -C $out/upstream/dsh-auth-release
    # The context insight plugin ships prebuilt from npm (same release layout
    # the npm-pinned TUI renderer uses); scripts/build.mjs then sees a lib/
    # already matching the pinned version and skips the sandboxed rebuild.
    mkdir -p $out/upstream/dsh-context
    tar -xzf ${contextRelease} --strip-components=1 \
      -C $out/upstream/dsh-context
  '';

  ohDshBundle = pkgs.stdenv.mkDerivation rec {
    pname = "oh-dsh-${surface}-bundle";
    version = (builtins.fromJSON (builtins.readFile ../package.json)).version;

    src = source;

    pnpmDeps = pkgs.fetchPnpmDeps {
      inherit pname version src;
      fetcherVersion = 4;
      hash = "sha256-mo7azFsAPB+KuizGuP+8+x0Q0s6W/v+iyLbhbNKYOu8=";
    };

    nativeBuildInputs = [
      pkgs.nodejs_24
      pkgs.pnpm
      pkgs.pnpmConfigHook
    ];

    # The upstream build scripts (esbuild) are what produce dist/.
    buildPhase = ''
      runHook preBuild

      # The full release pipeline (build:dsh + stage:dsh) is skipped on purpose:
      # the DSH runtime is provided by ${dshSource} instead of the staged copy.
      node scripts/build.mjs

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p $out/lib/oh-dsh
      cp -r dist $out/lib/oh-dsh/
      cp -r bin $out/lib/oh-dsh/
      cp package.json $out/lib/oh-dsh/

      # Carry package manifests so the final package can register the selected
      # surfaces into dsh-runtime/node_modules (mirrors stage-dsh.mjs).
      mkdir -p $out/lib/oh-dsh/manifests
      cp package.json $out/lib/oh-dsh/manifests/desktop.json
      for p in plugins/*/package.json; do
        name=$(basename $(dirname "$p"))
        cp "$p" "$out/lib/oh-dsh/manifests/$name.json"
      done
      cp web/package.json $out/lib/oh-dsh/manifests/web.json
      cp upstream/dsh-TUI-release/package.json \
        $out/lib/oh-dsh/manifests/tui-renderer.json
      cp upstream/dsh-context/package.json \
        $out/lib/oh-dsh/manifests/dsh-context.json
      cp upstream/dsh-auth-release/package.json \
        $out/lib/oh-dsh/manifests/dsh-auth.json

      # Carry the prebuilt subscription OAuth plugin for registration into
      # the runtime (npm release layout, same as the context plugin).
      mkdir -p $out/lib/oh-dsh/auth
      cp -r upstream/dsh-auth-release/lib $out/lib/oh-dsh/auth/lib
      cp upstream/dsh-auth-release/dsh-plugin.json \
        upstream/dsh-auth-release/cordis.patch.yml \
        upstream/dsh-auth-release/LICENSE \
        $out/lib/oh-dsh/auth/ 2>/dev/null || true
      # Carry the prebuilt context plugin (npm release layout: lib/ + patch +
      # license) for registration into the runtime.
      mkdir -p $out/lib/oh-dsh/context
      cp -r upstream/dsh-context/lib $out/lib/oh-dsh/context/lib
      cp upstream/dsh-context/cordis.patch.yml \
        upstream/dsh-context/LICENSE \
        $out/lib/oh-dsh/context/

      # Copy the pinned renderer and apply the guarded Oh-DSH adaptation.
      mkdir -p $out/lib/oh-dsh/tui-renderer
      cp -r upstream/dsh-TUI-release/lib \
        upstream/dsh-TUI-release/dsh-ecosystem-spec \
        upstream/dsh-TUI-release/presets \
        upstream/dsh-TUI-release/cordis.patch.yml \
        upstream/dsh-TUI-release/cordis.yml \
        upstream/dsh-TUI-release/LICENSE \
        $out/lib/oh-dsh/tui-renderer/
      node -e "import('./scripts/tui-upstream-adapter.mjs').then(({ adaptTuiRendererPackage }) => adaptTuiRendererPackage('$out/lib/oh-dsh/tui-renderer'))"

      # Collect runtime dependency closures that the DSH runtime may not ship.
      mkdir -p $out/lib/oh-dsh/extra-deps
      ${pkgs.python3}/bin/python3 ${./collect-deps.py} \
        node_modules/.pnpm \
        plugins/better-sidebar-runtime/package.json \
        $out/lib/oh-dsh/extra-deps
      ${pkgs.python3}/bin/python3 ${./collect-deps.py} \
        node_modules/.pnpm \
        upstream/dsh-TUI-release/package.json \
        $out/lib/oh-dsh/extra-deps

      # The published TUI release carries its dsh-std packages as compiled
      # bundled dependencies. Prefer those artifacts over unbuilt workspace
      # sources when assembling the offline Nix runtime.
      rm -rf $out/lib/oh-dsh/extra-deps/@dsh-std
      cp -r upstream/dsh-TUI-release/node_modules/@dsh-std \
        $out/lib/oh-dsh/extra-deps/@dsh-std
      # The published renderer depends on the released dsh-auth OAuth package.
      mkdir -p $out/lib/oh-dsh/extra-deps/@deepseek-harness-tui
      cp -r upstream/dsh-auth-release \
        $out/lib/oh-dsh/extra-deps/@deepseek-harness-tui/dsh-auth
      for dep in $out/lib/oh-dsh/extra-deps/@dsh-std/*; do
        ln -s ../.. "$dep/node_modules"
      done

      runHook postInstall
    '';

    # Electron is supplied by nixpkgs only in the full outer package.
    env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
  };

in
pkgs.stdenv.mkDerivation {
  pname = "oh-dsh-${if isFull then "desktop" else surface}${lib.optionalString (dshSource != "llm-agents") "-${dshSource}"}";
  version = ohDshBundle.version;

  dontUnpack = true;

  nativeBuildInputs = [ pkgs.makeWrapper ];

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/oh-dsh $out/bin

    # Oh-DSH built assets
    cp -r ${ohDshBundle}/lib/oh-dsh/dist $out/lib/oh-dsh/dist
    cp ${ohDshBundle}/lib/oh-dsh/package.json $out/lib/oh-dsh/package.json

    # DSH runtime
    mkdir -p $out/dsh-runtime
    cp -r ${dshRuntimeRoot}/. $out/dsh-runtime/
    chmod -R u+w $out/dsh-runtime
    chmod +x $out/dsh-runtime/lib/bin.js || true

    # Keep Nix assembly behind the same configuration-client boundary as the
    # regular staged runtime. The shared patch fails closed when upstream
    # anchors change.
    ${pkgs.nodejs_24}/bin/node ${../scripts/settings-boundary.mjs} \
      $out/dsh-runtime

    # Node runtime: reuse the same nodejs that built the bundle. The DSH
    # runtime's HMR service requires --expose-internals (upstream releases
    # ship the flag baked into their launcher; we wrap node itself).
    mkdir -p $out/node-runtime/bin
    makeWrapper ${pkgs.nodejs_24}/bin/node $out/node-runtime/bin/node \
      --add-flags "--expose-internals"

    # Register Oh-DSH packages into dsh-runtime/node_modules so the DSH
    # profile loader can resolve them (mirrors installDesktopPackages in
    # scripts/stage-dsh.mjs).
    ${pkgs.python3}/bin/python3 ${./register-plugins.py} \
      ${ohDshBundle}/lib/oh-dsh \
      $out/lib/oh-dsh/dist \
      $out/dsh-runtime \
      ${surface}

    # Copy plugin runtime dependencies that the DSH runtime does not ship
    # (e.g. schemastery for better-sidebar-runtime).
    if [ -d "${ohDshBundle}/lib/oh-dsh/extra-deps" ]; then
      for dep in ${ohDshBundle}/lib/oh-dsh/extra-deps/*/; do
        name=$(basename "$dep")
        # Scoped entries (e.g. @deepseek-harness-tui) must merge package by
        # package; a plain skip would drop dsh-auth beside the renderer.
        case "$name" in
          @*)
            mkdir -p "$out/dsh-runtime/node_modules/$name"
            for sub in "$dep"*/; do
              subname="$name/$(basename "$sub")"
              if [ ! -d "$out/dsh-runtime/node_modules/$subname" ]; then
                cp -r "$sub" "$out/dsh-runtime/node_modules/$subname"
                chmod -R u+w "$out/dsh-runtime/node_modules/$subname"
                # Same dependency-root link collect-deps.py gives collected
                # packages: without it the renderer's private link resolves
                # to the store real path and peer imports cannot be found.
                if [ ! -e "$out/dsh-runtime/node_modules/$subname/node_modules" ]; then
                  ln -s ../.. "$out/dsh-runtime/node_modules/$subname/node_modules"
                fi
              fi
            done
            ;;
          *)
            if [ ! -d "$out/dsh-runtime/node_modules/$name" ]; then
              cp -r "$dep" "$out/dsh-runtime/node_modules/$name"
              chmod -R u+w "$out/dsh-runtime/node_modules/$name"
            fi
            ;;
        esac
      done
    fi

    # HMR is a development-time feature that requires --expose-internals;
    # the packaged runtime keeps it enabled (matching upstream releases).

    # ohdsh launcher
    makeWrapper ${pkgs.nodejs_24}/bin/node $out/bin/ohdsh \
      --add-flags "$out/lib/oh-dsh/dist/ohdsh.js" \
      --set DSH_OH_WEB_ROOT "$out" \
      --set DSH_OH_TUI_ROOT "$out" \
      --set OH_DSH_SURFACES "${if isFull then "desktop,web,tui" else surface}" \
      ${lib.optionalString isFull ''
        --set OH_DSH_DESKTOP_APP "$out/bin/oh-dsh-desktop" \
      ''}

    ${lib.optionalString isFull ''
      # Electron wrapper. OH_DSH_RESOURCES_ROOT is required because loading
      # dist/main.js directly keeps app.isPackaged false under Nix.
      makeWrapper ${pkgs.electron_42}/bin/electron $out/bin/oh-dsh-desktop \
        --add-flags "$out/lib/oh-dsh/dist/main.js" \
        --set OH_DSH_RESOURCES_ROOT "$out" \
        --set DSH_OH_WEB_ROOT "$out"

      mkdir -p $out/share/applications
      cat > $out/share/applications/oh-dsh-desktop.desktop <<EOF
      [Desktop Entry]
      Name=Oh-DSH Desktop
      Exec=$out/bin/oh-dsh-desktop
      Type=Application
      Categories=Development;
      EOF
    ''}

    runHook postInstall
  '';

  meta = with lib; {
    description = "Oh-DSH ${if isFull then "full Desktop/Web/TUI" else if includesWeb then "Web" else "TUI"} distribution";
    homepage = "https://github.com/hust-open-atom-club/oh-dsh";
    license = licenses.mit;
    platforms = platforms.linux;
    mainProgram = "ohdsh";
  };
}
