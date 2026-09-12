# Build the pinned deepseek-harness runtime from the npm release recorded in
# this repository's dsh-source.json. The npm package ships compiled `lib/`
# and `config/`, so only the dependency graph needs installation.

{ lib
, stdenv
, fetchPnpmDeps
, fetchurl
, nodejs_24
, pnpm
, pnpmConfigHook
, runCommand
, dshSourceSpec
}:

assert dshSourceSpec.source == "npm";

let
  tarball = fetchurl {
    url = dshSourceSpec.tarball;
    hash = dshSourceSpec.integrity;
  };

  # pnpm install needs the lockfile, the devDependencies-stripped manifest
  # (the published devDeps reference unpublished dsh-experimental-*
  # packages), and the supply-chain policy beside package.json; the npm
  # tarball carries none of these repository files. The
  # workspace shim mirrors scripts/dsh-source.mjs resolveNpmAssembly: pnpm
  # rejects a frozen install whose recorded overrides differ from the
  # current configuration, and the committed lockfile pins the whole
  # @deepseek-ai/dsh-* closure to the release line, so its own overrides
  # section is copied verbatim.
  src = runCommand "dsh-runtime-pinned-src" { } ''
    mkdir -p $out
    tar -xzf ${tarball} -C $out --strip-components=1
    cp ${../.npmrc} $out/.npmrc
    cp ${../scripts}/dsh-runtime-${dshSourceSpec.version}-package.json $out/package.json
    cp ${../scripts}/dsh-runtime-${dshSourceSpec.version}-lock.yaml $out/pnpm-lock.yaml
    printf '%s\n' \
      'packages:' \
      '  - .' \
      "" \
      'minimumReleaseAgeExclude:' \
      "  - '@deepseek-ai/*'" \
      > $out/pnpm-workspace.yaml
    awk '/^overrides:$/ { copying = 1 } copying && !/^overrides:$/ && /^[A-Za-z]/ { exit } copying { print }' \
      $out/pnpm-lock.yaml >> $out/pnpm-workspace.yaml
    test "$(tail -n +2 $out/pnpm-workspace.yaml | grep -c "^  '@deepseek-ai/")" -gt 0 \
      || { echo "no overrides found in the pinned lockfile" >&2; exit 1; }
  '';
in

stdenv.mkDerivation rec {
  pname = "dsh-runtime-pinned";
  version = dshSourceSpec.version;

  inherit src;

  pnpmDeps = fetchPnpmDeps {
    inherit pname version src;
    fetcherVersion = 4;
    hash = "sha256-+Q2FnOVOOyCdXDsHXypywihTkevGgWym28s0LFm6k6g=";
  };

  nativeBuildInputs = [ nodejs_24 pnpm pnpmConfigHook ];

  buildPhase = ''
    runHook preBuild
    # Install with the hoisted linker so the derivation carries the layout
    # scripts/stage-dsh.mjs stages locally (`pnpm deploy --prod --legacy`):
    # the runtime's whole production closure sits at node_modules top level.
    # The default isolated linker only links the assembly root's direct
    # dependencies, so transitive native packages (node-pty) never appeared
    # at the top level and the desktop/web staging's PTY alignment failed.
    # Deploy itself cannot run here: its legacy implementation re-resolves
    # registry metadata, which the offline sandbox cannot fetch.
    pnpm install --frozen-lockfile --ignore-scripts --config.node-linker=hoisted
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/lib/dsh
    cp -r lib package.json node_modules $out/lib/dsh/
    # 0.1.2 npm assemblies ship lib/ without the config/ tree rc.2 carried.
    if [ -d config ]; then cp -r config $out/lib/dsh/; fi
    runHook postInstall
  '';

  meta = with lib; {
    description = "Pinned DeepSeek Harness npm runtime (${dshSourceSpec.version})";
    license = licenses.mit;
    platforms = platforms.unix;
  };
}
