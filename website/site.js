const repositoryUrl = "https://github.com/hust-open-atom-club/oh-dsh";
const latestReleaseUrl = `${repositoryUrl}/releases/latest`;
const releaseApiUrl =
    "https://api.github.com/repos/hust-open-atom-club/oh-dsh/releases/latest";
const atomgitRepositoryUrl =
    "https://atomgit.com/hust-open-atom-club/oh-dsh";
const atomgitReleasesUrl = `${atomgitRepositoryUrl}/releases`;
const atomgitReleaseApiUrl =
    "https://api.atomgit.com/api/v5/repos/hust-open-atom-club/oh-dsh/releases/latest";
const releasesApiUrl =
    "https://api.github.com/repos/hust-open-atom-club/oh-dsh/releases?per_page=100";
const downloadsCacheKey = "oh-dsh-site-downloads";
const downloadsCacheTtl = 30 * 60 * 1000;
const qqGroupShareUrl = "https://qm.qq.com/q/2uEd11lkWk";
const qqGroupSchemeUrl =
    "mqqapi://card/show_pslcard?src_type=internal&version=1&uin=554359007&card_type=group&source=qrcode";

const translations = {
    "zh-CN": {
        star: "星标",
        downloads: "下载",
        pageTitle: "Oh-DSH｜一套 Runtime，三种开发体验",
        sloganRuntime: "一套 DSH runtime，",
        sloganSurfaces: "Desktop、Web 与 TUI",
        sloganExperience: "三种开发体验。",
        desktopDetail: "本地工作台",
        webDetail: "浏览器即开",
        tuiDetail: "终端优先",
        downloadLatest: "下载最新版",
        downloadMac: "下载 macOS 版",
        downloadWindows: "下载 Windows 版",
        downloadLinux: "下载 Linux 版",
        installCaptionTerminal: "终端安装（macOS / Linux）",
        installCaptionPowerShell: "PowerShell 安装（Windows）",
        copyCommand: "复制",
        copiedCommand: "已复制",
        downloadReady: "准备下载",
        downloadTitle: "下载前，顺手点亮一颗 Star？",
        downloadDescription:
            "Oh-DSH 完全开源。可前往 GitHub 点亮 Star 并继续下载，或直接使用 AtomGit 镜像；国内网络下可能更快。",
        detectedPlatform: "已识别当前平台",
        starAndDownload: "去 GitHub Star，并继续下载",
        githubDirectDownload: "直接从 GitHub 下载",
        atomgitMirrorDownload: "从 AtomGit 镜像下载",
        unknownPlatform: "其他平台",
        footer: "开放、可组合的 DeepSeek Harness 工作台",
        qqGroup: "QQ 群",
        screenshotAlt: "Oh-DSH Desktop 深色界面，包含工作区、对话和插件入口",
        pageDescription:
            "Oh-DSH 以一套 DSH runtime 提供 Desktop、Web UI 与 TUI 三种开发体验。",
    },
    en: {
        star: "Star",
        downloads: "Downloads",
        pageTitle: "Oh-DSH — One Runtime, Three Interfaces",
        sloganRuntime: "One DSH runtime.",
        sloganSurfaces: "Desktop · Web · TUI",
        sloganExperience: "Three ways to build.",
        desktopDetail: "Local workbench",
        webDetail: "Browser-ready",
        tuiDetail: "Terminal-first",
        downloadLatest: "Download latest",
        downloadMac: "Download for macOS",
        downloadWindows: "Download for Windows",
        downloadLinux: "Download for Linux",
        installCaptionTerminal: "Install from the terminal (macOS / Linux)",
        installCaptionPowerShell: "Install with PowerShell (Windows)",
        copyCommand: "Copy",
        copiedCommand: "Copied",
        downloadReady: "Ready to download",
        downloadTitle: "Before you go, leave us a Star?",
        downloadDescription:
            "Oh-DSH is fully open source. Star it on GitHub and continue downloading, or use the AtomGit mirror directly; it may be faster in mainland China.",
        detectedPlatform: "Detected platform",
        starAndDownload: "Star on GitHub and continue",
        githubDirectDownload: "Download directly from GitHub",
        atomgitMirrorDownload: "Download from AtomGit mirror",
        unknownPlatform: "Other platform",
        footer: "An open, composable DeepSeek Harness workbench",
        qqGroup: "QQ Group",
        screenshotAlt:
            "Oh-DSH Desktop dark interface with workspace, conversation, and plugin navigation",
        pageDescription:
            "Oh-DSH brings Desktop, Web UI, and TUI together on one DSH runtime.",
    },
};

const elements = {
    atomgitDownload: document.querySelector("[data-atomgit-download]"),
    descriptionMeta: document.querySelector('meta[name="description"]'),
    dialog: document.querySelector("[data-download-dialog]"),
    dialogClose: document.querySelector("[data-dialog-close]"),
    downloadCount: document.querySelector("[data-download-count]"),
    downloadTrigger: document.querySelector("[data-download-trigger]"),
    installCaption: document.querySelector("[data-install-caption]"),
    installCommand: document.querySelector("[data-install-command]"),
    installCopy: document.querySelector("[data-install-copy]"),
    installCopyLabel: document.querySelector("[data-install-copy] [data-i18n]"),
    languageToggle: document.querySelector("[data-language-toggle]"),
    githubDownload: document.querySelector("[data-github-download]"),
    platformLabel: document.querySelector("[data-platform-label]"),
    particles: document.querySelector("[data-harness-particles]"),
    qqGroupLink: document.querySelector("[data-qq-group-link]"),
    starCount: document.querySelector("[data-star-count]"),
    starDownload: document.querySelector("[data-star-download]"),
};

const installCommands = {
    unix: "curl -fsSL https://raw.githubusercontent.com/hust-open-atom-club/oh-dsh/main/install.sh | bash",
    windows: "irm https://raw.githubusercontent.com/hust-open-atom-club/oh-dsh/main/install.ps1 | iex",
};

function installHarnessParticles(canvas) {
    const context = canvas?.getContext("2d", { alpha: true });
    if (!context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = { active: false, x: 0, y: 0 };
    let frame;
    let height = 0;
    let particles = [];
    let width = 0;

    function randomFactory() {
        let state = 0x4f484453;
        return () => {
            state = Math.imul(state ^ (state >>> 15), 1 | state);
            state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
            return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
        };
    }

    function resize() {
        const scale = Math.min(window.devicePixelRatio || 1, 2);
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        context.setTransform(scale, 0, 0, scale, 0, 0);

        const random = randomFactory();
        const count = Math.max(120, Math.min(620, Math.floor((width * height) / 3200)));
        particles = Array.from({ length: count }, () => ({
            x: random() * width,
            y: random() * height,
            phase: random() * Math.PI * 2,
            radius: 0.45 + random() * 0.75,
            opacity: 0.14 + random() * 0.38,
        }));
        if (reducedMotion.matches) draw(performance.now());
    }

    function draw(time) {
        context.clearRect(0, 0, width, height);
        context.fillStyle = "#a6cdff";

        for (const particle of particles) {
            let offsetX = Math.sin(time * 0.00022 + particle.phase) * 1.3;
            let offsetY = Math.cos(time * 0.00018 + particle.phase) * 1.1;
            let strength = 0;

            if (pointer.active && !reducedMotion.matches) {
                const deltaX = particle.x - pointer.x;
                const deltaY = particle.y - pointer.y;
                const distance = Math.hypot(deltaX, deltaY);
                if (distance < 190 && distance > 0) {
                    strength = (1 - distance / 190) ** 2;
                    offsetX += (deltaX / distance) * strength * 22;
                    offsetY += (deltaY / distance) * strength * 22;
                }
            }

            context.globalAlpha = Math.min(0.9, particle.opacity + strength * 0.55);
            context.beginPath();
            context.arc(
                particle.x + offsetX,
                particle.y + offsetY,
                particle.radius + strength * 0.75,
                0,
                Math.PI * 2,
            );
            context.fill();
        }
        context.globalAlpha = 1;
    }

    function animate(time) {
        draw(time);
        frame = reducedMotion.matches || document.hidden
            ? undefined
            : requestAnimationFrame(animate);
    }

    function restart() {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
        draw(performance.now());
        if (!reducedMotion.matches && !document.hidden) {
            frame = requestAnimationFrame(animate);
        }
    }

    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("pointermove", (event) => {
        if (event.pointerType === "touch") return;
        pointer.active = true;
        pointer.x = event.clientX;
        pointer.y = event.clientY;
    }, { passive: true });
    document.documentElement.addEventListener("pointerleave", () => {
        pointer.active = false;
    });
    document.addEventListener("visibilitychange", restart);
    reducedMotion.addEventListener("change", restart);
    resize();
    restart();
}

const storageKey = "oh-dsh-site-language";
const platform = detectPlatform(navigator);
let architecture = detectArchitecture(navigator);
let currentLanguage;
let copyFeedbackTimer;

function detectPlatform(browserNavigator) {
    const value = [
        browserNavigator.userAgentData?.platform,
        browserNavigator.platform,
        browserNavigator.userAgent,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    if (/iphone|ipad/.test(value)) return "unknown";
    if (/mac/.test(value)) return "macos";
    if (/win/.test(value)) return "windows";
    if (/linux|x11/.test(value)) return "linux";
    return "unknown";
}

function detectArchitecture(browserNavigator) {
    const value = [
        browserNavigator.userAgentData?.architecture,
        browserNavigator.userAgent,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    if (/arm64|aarch64/.test(value)) return "arm64";
    if (/x86_64|x64|win64|wow64|amd64/.test(value)) return "x64";
    return "unknown";
}

function normalizeArchitecture(value) {
    const normalized = String(value ?? "").toLowerCase();
    if (/arm|aarch/.test(normalized)) return "arm64";
    if (/x86|x64|amd/.test(normalized)) return "x64";
    return "unknown";
}

function platformName(language) {
    const names = {
        macos: "macOS",
        windows: "Windows",
        linux: "Linux",
    };
    return names[platform] ?? translations[language].unknownPlatform;
}

function downloadCopyKey() {
    const keys = {
        macos: "downloadMac",
        windows: "downloadWindows",
        linux: "downloadLinux",
    };
    return keys[platform] ?? "downloadLatest";
}

function preferredLanguage() {
    let saved;

    try {
        saved = window.localStorage.getItem(storageKey);
    } catch {
        saved = null;
    }

    if (saved && Object.hasOwn(translations, saved)) return saved;
    return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function applyInstallCommand(language) {
    if (!elements.installCommand) return;
    const windows = platform === "windows";
    elements.installCommand.textContent = windows
        ? installCommands.windows
        : installCommands.unix;
    if (elements.installCaption) {
        elements.installCaption.textContent = windows
            ? translations[language].installCaptionPowerShell
            : translations[language].installCaptionTerminal;
    }
}

function applyLanguage(language) {
    const copy = translations[language];
    currentLanguage = language;

    document.documentElement.lang = language;
    document.querySelectorAll("[data-i18n]").forEach((element) => {
        const value = copy[element.dataset.i18n];
        if (value) element.textContent = value;
    });
    document.querySelectorAll("[data-i18n-alt]").forEach((element) => {
        const value = copy[element.dataset.i18nAlt];
        if (value) element.alt = value;
    });

    elements.descriptionMeta.content = copy.pageDescription;
    document.title = copy.pageTitle;
    elements.downloadTrigger.textContent = copy[downloadCopyKey()];
    elements.platformLabel.textContent = platformName(language);
    applyInstallCommand(language);
    elements.languageToggle.textContent = language === "zh-CN" ? "EN" : "中";
    elements.languageToggle.setAttribute(
        "aria-label",
        language === "zh-CN" ? "Switch to English" : "切换到中文",
    );
    elements.languageToggle.dataset.language = language;
}

function chooseReleaseAsset(assets) {
    const safeAssets = assets.filter(
        (asset) => asset.browser_download_url && !/\.blockmap$/i.test(asset.name),
    );
    const platformAssets = safeAssets.filter((asset) => {
        if (platform === "macos") return asset.name.endsWith(".dmg");
        if (platform === "windows") return /\.(exe|msi)$/i.test(asset.name);
        if (platform === "linux") return /\.(AppImage|deb)$/i.test(asset.name);
        return false;
    });
    const architectureAssets = platformAssets.filter((asset) => {
        const name = asset.name.toLowerCase();
        if (architecture === "arm64") return /arm64|aarch64/.test(name);
        if (architecture === "x64") return /x64|x86_64|amd64/.test(name);
        return false;
    });
    const candidates = architectureAssets.length
        ? architectureAssets
        : platformAssets.length === 1
          ? platformAssets
          : [];

    return candidates.sort((left, right) => {
        const score = (asset) => (/\.AppImage$/i.test(asset.name) ? 0 : 1);
        return score(left) - score(right);
    })[0];
}

function setDownloadUrls(elements, url) {
    elements.forEach((element) => {
        element.href = url;
    });
}

function loadReleaseDownloads(apiUrl, fallbackUrl, elements) {
    return fetch(apiUrl)
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((release) => {
            const asset = chooseReleaseAsset(release.assets ?? []);
            setDownloadUrls(
                elements,
                asset?.browser_download_url ?? release.html_url ?? fallbackUrl,
            );
        })
        .catch(() => {
            setDownloadUrls(elements, fallbackUrl);
        });
}

function showCopyFeedback() {
    elements.installCopyLabel.textContent = translations[currentLanguage].copiedCommand;
    elements.installCopy.classList.add("copied");
    window.clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = window.setTimeout(() => {
        elements.installCopyLabel.textContent = translations[currentLanguage].copyCommand;
        elements.installCopy.classList.remove("copied");
    }, 1800);
}

function copyWithExecCommand(command, onSuccess) {
    const textarea = document.createElement("textarea");
    textarea.value = command;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try {
        copied = document.execCommand("copy");
    } catch {
        copied = false;
    }
    textarea.remove();
    if (copied) onSuccess();
}

function copyInstallCommand() {
    const command = elements.installCommand.textContent.trim();
    if (!command) return;

    if (navigator.clipboard?.writeText) {
        navigator.clipboard
            .writeText(command)
            .then(showCopyFeedback)
            .catch(() => copyWithExecCommand(command, showCopyFeedback));
    } else {
        copyWithExecCommand(command, showCopyFeedback);
    }
}

elements.languageToggle.addEventListener("click", () => {
    const language =
        elements.languageToggle.dataset.language === "zh-CN" ? "en" : "zh-CN";
    applyLanguage(language);

    try {
        window.localStorage.setItem(storageKey, language);
    } catch {
        // The language switch still works when persistent storage is blocked.
    }
});

elements.downloadTrigger.addEventListener("click", (event) => {
    if (typeof elements.dialog.showModal !== "function") return;
    event.preventDefault();
    elements.dialog.showModal();
});

elements.dialogClose.addEventListener("click", () => elements.dialog.close());
elements.dialog.addEventListener("click", (event) => {
    if (event.target === elements.dialog) elements.dialog.close();
});

if (elements.installCopy && elements.installCommand) {
    elements.installCopy.addEventListener("click", copyInstallCommand);
}

function openQqGroup(event) {
    // Modified and non-left clicks keep the native share-page navigation.
    if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
    ) {
        return;
    }
    event.preventDefault();

    // Aim the click at an installed QQ client first; when no client claims
    // the private scheme, the share page still offers a manual join.
    const fallback = window.setTimeout(() => {
        window.location.href = qqGroupShareUrl;
    }, 2000);
    const claimed = () => window.clearTimeout(fallback);
    window.addEventListener("blur", claimed, { once: true });
    document.addEventListener(
        "visibilitychange",
        () => {
            if (document.hidden) claimed();
        },
        { once: true },
    );
    window.location.href = qqGroupSchemeUrl;
}

if (elements.qqGroupLink) {
    elements.qqGroupLink.addEventListener("click", openQqGroup);
}

elements.starDownload.addEventListener("click", () => {
    window.open(repositoryUrl, "_blank", "noopener,noreferrer");
});

function cachedDownloadCount() {
    try {
        const cached = JSON.parse(
            window.localStorage.getItem(downloadsCacheKey),
        );
        // A negative age means the device clock moved back after the write;
        // honoring it would pin the badge to a stale total past the TTL.
        const age = cached ? Date.now() - cached.at : Number.NaN;
        if (
            cached &&
            age >= 0 &&
            age < downloadsCacheTtl &&
            Number.isFinite(cached.count)
        ) {
            return cached.count;
        }
    } catch {
        // Corrupt or blocked storage falls through to a live request.
    }
    return null;
}

function storeDownloadCount(count) {
    try {
        window.localStorage.setItem(
            downloadsCacheKey,
            JSON.stringify({ at: Date.now(), count }),
        );
    } catch {
        // The badge still updates this visit when persistent storage is blocked.
    }
}

function totalDownloads(releases) {
    return releases.reduce(
        (total, release) =>
            (release.assets ?? []).reduce(
                (sum, asset) => sum + (asset.download_count ?? 0),
                0,
            ) + total,
        0,
    );
}

function animateDownloadCount(target) {
    const format = new Intl.NumberFormat();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches || target <= 0) {
        elements.downloadCount.textContent = format.format(target);
        elements.downloadCount.hidden = false;
        return;
    }

    const startedAt = performance.now();
    const duration = 700;
    function frame(now) {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - (1 - progress) ** 3;
        elements.downloadCount.textContent = format.format(
            Math.round(target * eased),
        );
        if (progress < 1) requestAnimationFrame(frame);
    }
    elements.downloadCount.hidden = false;
    requestAnimationFrame(frame);
}

function showDownloadCount(count) {
    if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) {
        return;
    }
    animateDownloadCount(count);
}

function loadDownloadCount() {
    const cached = cachedDownloadCount();
    if (cached !== null) {
        showDownloadCount(cached);
        return;
    }
    fetch(releasesApiUrl)
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((releases) => {
            if (!Array.isArray(releases)) return;
            const count = totalDownloads(releases);
            storeDownloadCount(count);
            showDownloadCount(count);
        })
        .catch(() => {
            elements.downloadCount.hidden = true;
        });
}

if (typeof fetch === "function") {
    loadDownloadCount();

    fetch("https://api.github.com/repos/hust-open-atom-club/oh-dsh")
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((repository) => {
            elements.starCount.textContent = new Intl.NumberFormat().format(
                repository.stargazers_count,
            );
            elements.starCount.hidden = false;
        })
        .catch(() => {
            elements.starCount.hidden = true;
        });

    const architecturePromise = navigator.userAgentData?.getHighEntropyValues
        ? navigator.userAgentData
              .getHighEntropyValues(["architecture"])
              .then((values) => {
                  architecture = normalizeArchitecture(values.architecture);
              })
              .catch(() => {})
        : Promise.resolve();

    architecturePromise.then(() => {
        void loadReleaseDownloads(
            atomgitReleaseApiUrl,
            atomgitReleasesUrl,
            [elements.atomgitDownload],
        );
        void loadReleaseDownloads(
            releaseApiUrl,
            latestReleaseUrl,
            [
                elements.downloadTrigger,
                elements.starDownload,
                elements.githubDownload,
            ],
        );
    });
}

applyLanguage(preferredLanguage());
installHarnessParticles(elements.particles);
