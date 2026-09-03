# Oh-DSH package builder.
#
# dshSource selects where the pinned DeepSeek Harness runtime comes from:
#   "llm-agents"  (default) — numtide/llm-agents.nix, pre-built npm package
#   "pinned"                — this repo's dsh-source.json npm release, with its
#                             committed pnpm dependency lock
#   "nixpkgs"               — pkgs.deepseek-harness (kept as a placeholder; the
#                             nixpkgs PR is not yet merged, so this throws)
#
# The DSH runtime is assembled with the same shared staging library as the
# official release pipeline (scripts/stage-runtime-lib.mjs, consumed by
# scripts/stage-dsh.mjs), so the packaged surface layout cannot drift from
# the release layout. Nix only fetches sources and wraps launchers.

{ pkgs, system, llm-agents, dshSourceSpec }:

{ surface # "full" | "web" | "tui"
, dshSource ? "llm-agents"
}:

let
  lib = pkgs.lib;

  isFull = surface == "full";
  includesWeb = surface != "tui";
  includesTui = surface != "web";

  # The install-packages surface name understood by the shared assembler:
  # the full Desktop distribution carries every official surface package.
  stageSurface = if isFull then "all" else surface;

  # Repository source for the final derivation: the shared assembler imports
  # sibling scripts and the Liangshen adapter, so the whole tree (not a
  # single-file coercion) must be available for those relative imports.
  repoSrc = cleanSource;


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
  landlockLauncherRelease = pkgs.fetchurl {
    url = "https://registry.npmjs.org/@deepseek-ai/node-addon-landlock-run-linux-x64/-/node-addon-landlock-run-linux-x64-0.1.1.tgz";
    hash = "sha512-OHAzPW2Coe/iYobAJAAA8CeVrBoKV4BnNHsgwvXwOfishxkUVSWSvdyxrZPiwYRXutpIGVrSo9zV3WOQy2euBA==";
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

      # Carry the workspace pnpm package; the final derivation stages it
      # beside node-runtime through the shared stage-runtime-lib.mjs.
      if [ ! -f node_modules/pnpm/dist/pnpm.mjs ]; then
        echo "pnpm package is missing from the Nix build; run pnpm install" >&2
        exit 1
      fi
      mkdir -p $out/lib/oh-dsh/pnpm
      cp -r node_modules/pnpm/bin node_modules/pnpm/dist \
        $out/lib/oh-dsh/pnpm/
      cp node_modules/pnpm/package.json node_modules/pnpm/LICENSE \
        $out/lib/oh-dsh/pnpm/ 2>/dev/null || true

      # Assemble a repository-shaped staging root for the shared runtime
      # assembler: installDesktopPackages reads manifests and compiled files
      # from the same layout the release pipeline uses. dist/, plugins/,
      # web/, and node_modules/ stay on the workspace tree (read-only); the
      # upstream packages are overlaid with their published release trees.
      stage_root="$TMPDIR/oh-dsh-stage-root"
      rm -rf "$stage_root"
      mkdir -p "$stage_root/upstream/dsh-TUI/dsh-auth" \
        "$stage_root/upstream/dsh-context"
      cp package.json "$stage_root/package.json"
      ln -s "$PWD/dist" "$stage_root/dist"
      ln -s "$PWD/plugins" "$stage_root/plugins"
      ln -s "$PWD/web" "$stage_root/web"
      ln -s "$PWD/node_modules" "$stage_root/node_modules"

      # The published TUI release ships compiled lib/skills/presets and
      # bundled compiled @dsh-std packages; mount those and link every
      # remaining dependency to the workspace-installed graph.
      cp upstream/dsh-TUI-release/package.json \
        upstream/dsh-TUI-release/cordis.patch.yml \
        upstream/dsh-TUI-release/cordis.yml \
        upstream/dsh-TUI-release/LICENSE \
        "$stage_root/upstream/dsh-TUI/"
      cp -r upstream/dsh-TUI-release/lib \
        upstream/dsh-TUI-release/dsh-ecosystem-spec \
        upstream/dsh-TUI-release/presets \
        "$stage_root/upstream/dsh-TUI/"
      mkdir -p "$stage_root/upstream/dsh-TUI/node_modules"
      if [ -d upstream/dsh-TUI-release/node_modules ]; then
        cp -r upstream/dsh-TUI-release/node_modules/. \
          "$stage_root/upstream/dsh-TUI/node_modules/"
      fi
      if [ -d upstream/dsh-TUI/node_modules ]; then
        for dep in upstream/dsh-TUI/node_modules/*; do
          name=$(basename "$dep")
          [ -e "$stage_root/upstream/dsh-TUI/node_modules/$name" ] || \
            ln -s "$PWD/$dep" "$stage_root/upstream/dsh-TUI/node_modules/$name"
        done
      fi

      # Subscription OAuth plugin and context insight plugin, published npm
      # release layouts (compiled lib/ beside the manifest).
      cp upstream/dsh-auth-release/package.json \
        upstream/dsh-auth-release/dsh-plugin.json \
        upstream/dsh-auth-release/cordis.patch.yml \
        upstream/dsh-auth-release/LICENSE \
        "$stage_root/upstream/dsh-TUI/dsh-auth/"
      cp -r upstream/dsh-auth-release/lib \
        "$stage_root/upstream/dsh-TUI/dsh-auth/"
      mkdir -p "$stage_root/upstream/dsh-TUI/dsh-auth/node_modules"
      if [ -d upstream/dsh-TUI/dsh-auth/node_modules ]; then
        for dep in upstream/dsh-TUI/dsh-auth/node_modules/*; do
          ln -s "$PWD/$dep" \
            "$stage_root/upstream/dsh-TUI/dsh-auth/node_modules/$(basename "$dep")"
        done
      fi
      cp upstream/dsh-context/package.json \
        upstream/dsh-context/cordis.patch.yml \
        upstream/dsh-context/LICENSE \
        "$stage_root/upstream/dsh-context/"
      cp -r upstream/dsh-context/lib "$stage_root/upstream/dsh-context/"

      # Install the selected surface packages into a copy of the DSH runtime
      # with the same assembler as scripts/stage-dsh.mjs, so the Nix closure
      # carries the official layout: package files, dependency wiring, and
      # the profile-fallback dependency manifest.
      runtime_build="$TMPDIR/dsh-runtime"
      rm -rf "$runtime_build"
      mkdir -p "$runtime_build"
      cp -r ${dshRuntimeRoot}/. "$runtime_build/"
      chmod -R u+w "$runtime_build"
      chmod +x "$runtime_build/lib/bin.js" || true
      node scripts/stage-runtime-lib.mjs install-packages \
        --root "$stage_root" --runtime "$runtime_build" \
        --surface ${stageSurface} --release-graph
      node scripts/stage-runtime-lib.mjs restore-executable-helpers \
        --runtime "$runtime_build"
      cp THIRD_PARTY_NOTICES.md "$runtime_build/THIRD_PARTY_NOTICES.md"

      mkdir -p $out/lib/oh-dsh/dsh-runtime
      cp -r "$runtime_build"/. $out/lib/oh-dsh/dsh-runtime/

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

  # The shared assembler imports sibling scripts and the Liangshen adapter;
  # carry the repository source so those relative imports resolve from $src.
  src = repoSrc;

  nativeBuildInputs = [ pkgs.makeWrapper pkgs.nodejs_24 ];

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/oh-dsh $out/bin

    # Oh-DSH built assets
    cp -r ${ohDshBundle}/lib/oh-dsh/dist $out/lib/oh-dsh/dist
    cp ${ohDshBundle}/lib/oh-dsh/package.json $out/lib/oh-dsh/package.json

    # DSH runtime assembled by the shared stage-dsh assembler.
    mkdir -p $out/dsh-runtime
    cp -r ${ohDshBundle}/lib/oh-dsh/dsh-runtime/. $out/dsh-runtime/
    chmod -R u+w $out/dsh-runtime
    chmod +x $out/dsh-runtime/lib/bin.js || true

    ${lib.optionalString (system == "x86_64-linux") ''
      # The assembler stages the runtime from an offline DSH source, so
      # install the same pinned static Landlock launcher explicitly and
      # validate its published metadata.
      landlock_package="$out/dsh-runtime/node_modules/@deepseek-ai/node-addon-landlock-run-linux-x64"
      landlock_source="$TMPDIR/landlock-launcher-package"
      rm -rf "$landlock_package" "$landlock_source"
      mkdir -p "$landlock_package" "$landlock_source"
      tar -xzf ${landlockLauncherRelease} --strip-components=1 \
        -C "$landlock_source"
      cp "$landlock_source/package.json" "$landlock_source/prebuilds.json" \
        "$landlock_package/"
      ${pkgs.nodejs_24}/bin/node --input-type=module -e \
        "import { restoreLandlockLauncher } from '${../scripts/landlock-launcher.mjs}'; restoreLandlockLauncher({ runtimeRoot: process.argv[1], sourcePackageRoot: process.argv[2] })" \
        "$out/dsh-runtime" "$landlock_source"
      test -x "$landlock_package/bin/landlock-run"
    ''}

    # Keep Nix assembly behind the same configuration-client boundary as the
    # regular staged runtime. The shared patch fails closed when upstream
    # anchors change.
    ${pkgs.nodejs_24}/bin/node ${../scripts/settings-boundary.mjs} \
      $out/dsh-runtime
    ${pkgs.nodejs_24}/bin/node \
      ${../plugins/liangshen/src/upstream-adapter.mjs} \
      ownership $out/dsh-runtime
    ${lib.optionalString includesWeb ''
      ${pkgs.nodejs_24}/bin/node \
        ${../plugins/liangshen/src/upstream-adapter.mjs} \
        dsh $out/dsh-runtime
    ''}

    # Node runtime: reuse the same nodejs that built the bundle. The DSH
    # runtime's HMR service requires --expose-internals (upstream releases
    # ship the flag baked into their launcher; we wrap node itself).
    mkdir -p $out/node-runtime/bin
    makeWrapper ${pkgs.nodejs_24}/bin/node $out/node-runtime/bin/node \
      --add-flags "--expose-internals"

    # Stage pnpm beside the node runtime through the shared assembler:
    # bundledRuntimePaths resolves pnpmEntry at
    # node-runtime/lib/node_modules/pnpm/bin/pnpm.mjs for isolated
    # Marketplace installs.
    ${pkgs.nodejs_24}/bin/node $src/scripts/stage-runtime-lib.mjs stage-pnpm \
      --source ${ohDshBundle}/lib/oh-dsh/pnpm --target $out/node-runtime
    test -f "$out/node-runtime/lib/node_modules/pnpm/bin/pnpm.mjs"
    test -f "$out/node-runtime/bin/pnpm"

    # Guardrail: the assembled runtime must carry exactly the official
    # surface package set; a drift in SURFACE_PACKAGE_NAMES or a missing
    # registration fails the Nix build instead of the running profile.
    ${pkgs.nodejs_24}/bin/node --input-type=module -e "
      import { SURFACE_PACKAGE_NAMES } from '${repoSrc}/scripts/stage-runtime-lib.mjs'
      import { existsSync } from 'node:fs'
      const surface = '${stageSurface}'
      const runtimeRoot = process.argv[1]
      const expected = surface === 'all'
        ? new Set([...SURFACE_PACKAGE_NAMES.desktop, ...SURFACE_PACKAGE_NAMES.web, ...SURFACE_PACKAGE_NAMES.tui])
        : SURFACE_PACKAGE_NAMES[surface]
      const missing = [...expected].filter(name => !existsSync(runtimeRoot + '/node_modules/' + name))
      if (missing.length > 0) {
        throw new Error('Nix surface closure is missing packages: ' + missing.join(', '))
      }
    " "$out/dsh-runtime"

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
