/**
 * Scam Shield Core v1.6
 * Full-Featured AI-Driven Phishing Protection
 * YouTube | Facebook | General Web | Speech-to-Text
 */

console.log('🛡️ Scam Shield v1.6: [STARTING] Host:', window.location.hostname);

// --- STATE & CONFIG ---
const host = window.location.hostname;
const isYouTube = host.includes("youtube.com");
const isFacebook = host.includes("facebook.com");
let isTrusted = false;
let customSafeList = [];

let config = { 
    watchdogInterval: 5000, 
    enablePeriodicScan: true,
    enableSpeechScan: true,
    enableYouTubeCards: true,
    enableYouTubeWatch: true,
    enableFacebook: true,
    enableGlobalOverlay: true,
    speechScanInterval: 30000
};

let siteSelectors = {
    youtube: {
        card: "ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer",
        title: "yt-formatted-string.style-scope.ytd-rich-grid-media, #video-title, .yt-lockup-metadata-view-model-wiz__title",
        thumbnail: "ytd-thumbnail, #thumbnail"
    },
    facebook: {
        card: "div[role='article']",
        title: "span[dir='auto']",
        thumbnail: "img"
    }
};

let globalOverlay = null;

// --- STYLING (IRON CURTAIN) ---
const injectIronCurtain = () => {
    if (document.getElementById('scamshield-lockdown')) return;
    const style = document.createElement('style');
    style.id = 'scamshield-lockdown';
    style.textContent = `
        /* General blur for non-YouTube elements */
        .scamshield-blur { 
            filter: blur(25px) grayscale(1) !important; 
            pointer-events: none !important;
            transition: filter 0.5s ease !important;
        }
        .scamshield-safe { 
            filter: none !important; 
            pointer-events: auto !important;
            display: revert !important;
            opacity: 1 !important;
        }
        ${isYouTube ? `
        /* CSS-FIRST: HIDE YouTube cards completely until verified */
        ytd-rich-item-renderer:not(.scamshield-safe),
        ytd-video-renderer:not(.scamshield-safe),
        ytd-grid-video-renderer:not(.scamshield-safe),
        ytd-compact-video-renderer:not(.scamshield-safe) {
            display: none !important;
        }
        /* Smooth reveal animation when verified safe */
        ytd-rich-item-renderer.scamshield-safe,
        ytd-video-renderer.scamshield-safe,
        ytd-grid-video-renderer.scamshield-safe,
        ytd-compact-video-renderer.scamshield-safe {
            animation: scamshield-reveal 0.3s ease forwards;
        }
        @keyframes scamshield-reveal {
            from { opacity: 0; transform: scale(0.95); }
            to { opacity: 1; transform: scale(1); }
        }
        /* Watch page: blur the video player until verified */
        .scamshield-video-blur #movie_player video,
        .scamshield-video-blur .html5-video-container {
            filter: blur(30px) grayscale(1) !important;
            transition: filter 0.5s ease !important;
        }
        .scamshield-video-safe #movie_player video,
        .scamshield-video-safe .html5-video-container {
            filter: none !important;
        }` : ''}
        #scamshield-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.85); z-index: 999999;
            display: flex; align-items: center; justify-content: center;
            flex-direction: column; color: white; font-family: sans-serif;
        }
        #scamshield-overlay h1 { font-size: 2em; margin-bottom: 10px; }
        #scamshield-overlay p { font-size: 1.2em; max-width: 600px; text-align: center; }
        #scamshield-overlay .safe { color: #4caf50; }
        #scamshield-overlay .danger { color: #f44336; }
        #scamshield-overlay .suspicious { color: #ff9800; }
    `;
    (document.head || document.documentElement).appendChild(style);
};
injectIronCurtain();

// --- OVERLAY (Full-Page Warning) ---
const injectOverlay = () => {
    if (globalOverlay) return;
    const target = document.body || document.documentElement;
    if (!target) return;
    
    globalOverlay = document.createElement('div');
    globalOverlay.id = 'scamshield-overlay';
    globalOverlay.innerHTML = `
        <h1>🛡️ ${chrome.i18n.getMessage("overlayTitle") || "Scam Shield"}</h1>
        <p>${chrome.i18n.getMessage("overlayScanning") || "Scanning page for threats..."}</p>
    `;
    target.appendChild(globalOverlay);
};

const handleGeneralVerdict = (res, overlay) => {
    if (!overlay) return;
    if (res && res.error) {
        console.error("🛡️ Scam Shield: [VERDICT ERROR]", res.error);
        overlay.innerHTML = `
            <h1 class="suspicious">${chrome.i18n.getMessage("overlayErrorTitle") || "⚠️ SCAN ERROR"}</h1>
            <p>${chrome.i18n.getMessage("overlayErrorMsg") || "Could not verify page safety (Ollama error). Please check if your local AI is running."}</p>
            <p style="font-size: 0.8em; color: #888;">Error: ${res.error}</p>
        `;
        return;
    }
    if (!res || !res.result) {
        overlay.remove();
        globalOverlay = null;
        return;
    }
    const result = res.result;
    console.log(`🛡️ Scam Shield: [VERDICT] ${result.substring(0, 200)}...`);
    // Only check the FIRST meaningful line for the verdict — don't match reasoning text
    const firstLine = result.split('\n').find(l => l.trim().length > 0) || result;
    if (firstLine.includes("[SAFE]") || (firstLine.toUpperCase().startsWith("SAFE") || firstLine.toUpperCase().startsWith("[SAFE"))) {
        overlay.remove();
        globalOverlay = null;
    } else if (firstLine.includes("[DANGEROUS]") || firstLine.includes("[SUSPICIOUS]")) {
        const isDangerous = firstLine.includes("[DANGEROUS]");
        overlay.innerHTML = `
            <h1 class="${isDangerous ? 'danger' : 'suspicious'}">
                ⚠️ ${isDangerous ? 
                    (chrome.i18n.getMessage("overlayDanger") || "DANGER DETECTED") : 
                    (chrome.i18n.getMessage("overlaySuspicious") || "SUSPICIOUS CONTENT")}
            </h1>
            <p>${result}</p>
        `;
    } else {
        overlay.remove();
        globalOverlay = null;
    }
};

// --- CORE SCANNER: YOUTUBE CARDS ---
const YT_CARD_SELECTOR = "ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer";

const scanCards = () => {
    const cards = document.querySelectorAll(YT_CARD_SELECTOR);
    
    // DIAGNOSTIC: Always log — never suppress. Also check individual selectors.
    const unscanned = [...cards].filter(c => !c.dataset.scanned);
    const richItems = document.querySelectorAll('ytd-rich-item-renderer');
    const videoRenderers = document.querySelectorAll('ytd-video-renderer');
    const compactRenderers = document.querySelectorAll('ytd-compact-video-renderer');
    console.log(`🛡️ Scam Shield: [SCAN] Total=${cards.length} (unscanned=${unscanned.length}) | rich=${richItems.length} video=${videoRenderers.length} compact=${compactRenderers.length}`);
    
    if (cards.length === 0) return;

    const queue = [];
    cards.forEach(card => {
        if (card.dataset.scanned) return;
        
        // --- TITLE EXTRACTION (multiple fallbacks) ---
        let title = "";
        let extractSource = "";
        
        // 1. yt-formatted-string#video-title (classic layout)
        const videoTitle = card.querySelector('#video-title');
        if (videoTitle) {
            title = (videoTitle.title || videoTitle.getAttribute('aria-label') || videoTitle.innerText || "").trim();
            if (title) extractSource = "#video-title";
        }
        
        // 2. Title link specifically (not the thumbnail link)
        if (!title || title.length <= 5) {
            const titleLink = card.querySelector('a#video-title-link, h3 a[href*="/watch"]');
            if (titleLink) {
                title = (titleLink.title || titleLink.getAttribute('aria-label') || "").trim();
                if (title) extractSource = "title-link";
            }
        }
        
        // 3. Any <a> with a non-empty title attribute pointing to /watch
        if (!title || title.length <= 5) {
            const allLinks = card.querySelectorAll('a[href*="/watch"]');
            for (const link of allLinks) {
                const t = (link.title || link.getAttribute('aria-label') || "").trim();
                if (t && t.length > 5 && !/^\d{1,2}:\d{2}/.test(t)) {
                    title = t;
                    extractSource = "a[watch]";
                    break;
                }
            }
        }
        
        // 4. Lockup metadata (newer YouTube layouts)
        if (!title || title.length <= 5) {
            const lockup = card.querySelector('.yt-lockup-metadata-view-model-wiz__title');
            if (lockup) {
                title = (lockup.innerText || lockup.textContent || "").trim();
                if (title) extractSource = "lockup-meta";
            }
        }
        
        // 5. aria-label on the card itself (some layouts put the full title here)
        if (!title || title.length <= 5) {
            const ariaLabel = card.getAttribute('aria-label');
            if (ariaLabel && ariaLabel.length > 5) {
                title = ariaLabel.trim();
                extractSource = "card-aria";
            }
        }
        
        // Strip duration metadata that YouTube appends to title/aria-label
        // Matches patterns like: "31 minut", "2 minuty i 37 sekund", "1 godzina i 10 minut", "20 minutes"
        title = title.replace(/\s+\d+\s*(minut[aey]?|sekund[aey]?|godzin[aey]?|hour[s]?|minute[s]?|second[s]?)(\s+i\s+\d+\s*(minut[aey]?|sekund[aey]?|godzin[aey]?))*\s*$/i, '').trim();
        
        // Filter garbage
        const isTimestamp = /^\d{1,2}:\d{2}(:\d{2})?$/.test(title);
        const isUILabel = ['obejrzyj', 'watch', 'shorts', 'składanka', 'mix', 'teraz grasz', 'now playing'].includes(title.toLowerCase());
        const isValidTitle = title && title.length > 5 && !isTimestamp && !isUILabel;
        
        if (isValidTitle) {
            card.dataset.scanned = "pending";
            console.log(`🛡️ Scam Shield: [EXTRACT] "${title.substring(0, 60)}" (via: ${extractSource})`);
            queue.push({ id: Math.random(), title, element: card });
        } else {
            // Title not available yet — track retries
            const retries = parseInt(card.dataset.retries || "0", 10);
            if (retries >= 8) {
                // After 8 retries (40s), fall back to THUMBNAIL visual scan
                console.log(`🛡️ Scam Shield: [EXTRACT-FAIL] No title after ${retries} retries, trying thumbnail scan. Tag: ${card.tagName}`);
                card.dataset.scanned = "pending-visual";
                scanThumbnail(card);
            } else {
                card.dataset.retries = (retries + 1).toString();
            }
        }
    });

    if (queue.length > 0) {
        console.log(`🛡️ Scam Shield: Found ${queue.length} new videos. Processing in mini-batches...`);
        const BATCH_SIZE = 20;
        for (let i = 0; i < queue.length; i += BATCH_SIZE) {
            const batch = queue.slice(i, i + BATCH_SIZE);
            processBatch(batch);
        }
    }
};

// --- THUMBNAIL VISUAL SCAN (fallback when title extraction fails) ---
const scanThumbnail = (card) => {
    const img = card.querySelector('img');
    if (!img || !img.src || img.src.startsWith('data:')) {
        console.warn("🛡️ Scam Shield: [VISUAL] No thumbnail found for card. Resetting for future rescan.");
        // Reset the card so future scan cycles can retry once YouTube hydrates
        delete card.dataset.scanned;
        card.dataset.retries = "0";
        return;
    }
    
    console.log(`🛡️ Scam Shield: [VISUAL] Scanning thumbnail: ${img.src.substring(0, 60)}...`);
    
    // Draw image to canvas to get base64
    const canvas = document.createElement('canvas');
    const tempImg = new Image();
    tempImg.crossOrigin = "anonymous";
    tempImg.onload = () => {
        canvas.width = tempImg.width;
        canvas.height = tempImg.height;
        canvas.getContext('2d').drawImage(tempImg, 0, 0);
        try {
            const base64 = canvas.toDataURL('image/jpeg', 0.5);
            chrome.runtime.sendMessage({ action: "scanScreenshot", image: base64 }, (res) => {
                card.dataset.scanned = "true";
                if (res && res.result && res.result.includes("[SAFE]")) {
                    card.classList.add('scamshield-safe');
                    console.log("🛡️ Scam Shield: [VISUAL] Thumbnail verified SAFE.");
                } else {
                    console.warn("🛡️ Scam Shield: [VISUAL] Thumbnail flagged. Resetting for retry.");
                    delete card.dataset.scanned;
                    card.dataset.retries = "0";
                }
            });
        } catch (e) {
            // CORS restriction — card stays blurred (strict security)
            console.warn("🛡️ Scam Shield: [VISUAL] Canvas blocked by CORS. Resetting for retry.");
            delete card.dataset.scanned;
            card.dataset.retries = "0";
        }
    };
    tempImg.onerror = () => {
        console.warn("🛡️ Scam Shield: [VISUAL] Failed to load thumbnail. Resetting for retry.");
        delete card.dataset.scanned;
        card.dataset.retries = "0";
    };
    tempImg.src = img.src;
};

// --- BATCH PROCESSOR ---
const processBatch = (items) => {
    const titles = items.map(i => i.title);
    console.log(`🛡️ Scam Shield: [FETCHING] Sending ${titles.length} titles:`, titles);
    
    chrome.runtime.sendMessage({ action: "scanYouTubeBatch", titles }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("🛡️ Scam Shield: [CRITICAL]", chrome.runtime.lastError.message);
            // Cards stay blurred — no verification
            return;
        }
        if (response && response.error) {
            console.error("🛡️ Scam Shield: [AI ERROR]", response.error);
            // Cards stay blurred — no verification
            return;
        }
        if (response && response.result) {
            console.log("🛡️ Scam Shield: [RAW RESPONSE]", response.result);
            try {
                const results = JSON.parse(response.result);
                console.log(`🛡️ Scam Shield: [SUCCESS] ${results.length} verdicts for ${items.length} items.`);
                items.forEach((item, index) => {
                    const res = results[index];
                    const isSafe = (res === true || res === 1 || res === "true" || res === "SAFE");
                    const el = item.element;
                    el.dataset.scanned = "true";
                    if (isSafe) {
                        el.classList.remove('scamshield-blur');
                        el.classList.add('scamshield-safe');
                        console.log(`🛡️ Scam Shield: [SAFE] ${item.title}`);
                    } else {
                        // Keep hidden — never show dangerous content
                        console.warn(`🛡️ Scam Shield: [BLOCKED] ${item.title}`);
                    }
                });
            } catch (e) {
                console.error("🛡️ Scam Shield: [PARSE ERROR]", response.result);
                // Cards stay blurred — parse failure is not a pass
            }
        } else {
            console.warn("🛡️ Scam Shield: [EMPTY] No response from background.");
            // Cards stay blurred — silence is not a pass
        }
    });
};


// --- CORE SCANNER: YOUTUBE WATCH PAGE ---
const scanWatchPage = () => {
    if (!window.location.pathname.startsWith("/watch")) return;
    if (window.scamShieldWatchScanned) return;
    
    const titleEl = document.querySelector("h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string, #title h1");
    if (!titleEl) return;
    
    const title = (titleEl && titleEl.innerText) ? titleEl.innerText.trim() : "";
    if (!title) return;
    
    window.scamShieldWatchScanned = true;
    console.log(`🛡️ Scam Shield: [WATCH] Scanning video: "${title.substring(0, 50)}..."`);
    
    // Blur and pause the video while scanning
    const playerContainer = document.querySelector('#player-container, ytd-player');
    if (playerContainer) {
        document.body.classList.add('scamshield-video-blur');
    }
    const video = document.querySelector('video.html5-main-video, video');
    if (video && !video.paused) {
        video.pause();
        console.log('🛡️ Scam Shield: [WATCH] Video PAUSED for verification.');
    }
    
    const descEl = document.querySelector("#description-inline-expander, #description");
    const description = (descEl && descEl.innerText) ? descEl.innerText.substring(0, 500) : "";
    
    chrome.runtime.sendMessage({ action: "scanYouTubeVideo", title, description }, (res) => {
        if (res && res.result) {
            const firstLine = res.result.split('\n').find(l => l.trim().length > 0) || res.result;
            if (firstLine.includes("[DANGEROUS]") || firstLine.includes("[SUSPICIOUS]")) {
                // Keep blurred and paused, show overlay
                injectOverlay();
                handleGeneralVerdict(res, globalOverlay);
            } else {
                // SAFE — unblur and resume
                document.body.classList.remove('scamshield-video-blur');
                document.body.classList.add('scamshield-video-safe');
                const vid = document.querySelector('video.html5-main-video, video');
                if (vid) {
                    vid.play().catch(() => {}); // May require user gesture
                    console.log('🛡️ Scam Shield: [WATCH] Video RESUMED — verified safe.');
                }
            }
        } else {
            // No response — unblur to avoid blocking indefinitely
            document.body.classList.remove('scamshield-video-blur');
        }
    });
};

// --- CORE SCANNER: FACEBOOK ---
const scanFacebook = () => {
    const posts = document.querySelectorAll(siteSelectors.facebook.card);
    posts.forEach(post => {
        if (post.dataset.scanned) return;
        post.classList.add('scamshield-blur');
        
        const titleEl = post.querySelector(siteSelectors.facebook.title);
        const text = titleEl ? (titleEl.innerText || titleEl.textContent).trim() : "";
        
        if (text && text.length > 10) {
            post.dataset.scanned = "pending";
            chrome.runtime.sendMessage({ action: "scanFacebookPost", text }, (res) => {
                post.dataset.scanned = "true";
                if (res && res.result && (res.result.includes("[SAFE]") || res.result.toUpperCase().includes("SAFE"))) {
                    post.classList.remove('scamshield-blur');
                    post.classList.add('scamshield-safe');
                } else {
                    console.warn(`🛡️ Scam Shield: [BLOCKED FB] ${text.substring(0, 50)}...`);
                }
            });
        }
    });
};

// --- GENERAL PAGE SCANNER ---
const initialScan = () => {
    if (window.scamShieldInitialDone || isYouTube || isFacebook || isTrusted) return;
    window.scamShieldInitialDone = true;
    
    injectOverlay();
    console.log("🛡️ Scam Shield: [INITIAL SCAN] Checking page safety (Full Text + Visual)...");
    const text = document.body ? document.body.innerText : "";
    chrome.runtime.sendMessage(
        { action: "scanFullPage", text, url: window.location.href, domain: host, isVisual: true }, 
        (res) => handleGeneralVerdict(res, globalOverlay)
    );
};

// --- SPEECH-TO-TEXT SCANNER ---
let speechRecognition = null;
let speechTranscript = ""; // Global to persist across tab visibility toggles

const startSpeechScan = () => {
    if (!config.enableSpeechScan) return;
    if (speechRecognition) return;
    
    // ONLY start if the tab is visible to avoid competing with other tabs for the mic
    if (document.visibilityState !== 'visible') return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.warn("🛡️ Scam Shield: Speech Recognition not supported in this browser.");
        return;
    }
    
    speechRecognition = new SpeechRecognition();
    speechRecognition.continuous = true;
    speechRecognition.interimResults = false;
    speechRecognition.lang = chrome.i18n.getUILanguage() || 'pl';
    
    speechRecognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
                const text = event.results[i][0].transcript.trim();
                console.log(`🛡️ Scam Shield: 🎙️ Speech Detected: "${text}"`);
                speechTranscript += text + " ";
            }
        }
    };
    
    speechRecognition.onerror = (event) => {
        if (event.error !== 'no-speech' && event.error !== 'network' && event.error !== 'not-allowed' && event.error !== 'aborted') {
            console.warn("🛡️ Scam Shield: Speech error:", event.error);
        }
        // Don't auto-restart on network/permission errors
        if (event.error === 'network' || event.error === 'not-allowed' || event.error === 'aborted') {
            speechRecognition = null;
        }
    };
    
    speechRecognition.onend = () => {
        // Auto-restart if still enabled AND tab is visible
        if (config.enableSpeechScan && speechRecognition && document.visibilityState === 'visible') {
            try { speechRecognition.start(); } catch (e) {}
        } else {
            speechRecognition = null;
        }
    };

    try {
        speechRecognition.start();
        console.log("🛡️ Scam Shield: 🎙️ Speech monitoring ACTIVE.");
    } catch (e) {
        console.warn("🛡️ Scam Shield: Could not start speech recognition:", e.message);
        speechRecognition = null;
        return;
    }
};

// Handle tab switching: stop mic on hidden, start on visible (global listener)
if (!window.scamShieldSpeechInited) {
    window.scamShieldSpeechInited = true;
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            if (config.enableSpeechScan && !speechRecognition) {
                startSpeechScan();
            }
        } else {
            if (speechRecognition) {
                const sr = speechRecognition;
                speechRecognition = null; // Prevent onend auto-restart
                try { sr.stop(); } catch(e) {}
            }
        }
    });
}
    
// Periodically send accumulated transcript for analysis
setInterval(() => {
    if (speechTranscript.trim().length > 20) {
        const textToScan = speechTranscript.trim();
        console.log(`🛡️ Scam Shield: [SPEECH] Analyzing transcript: "${textToScan}"`);
        chrome.runtime.sendMessage({ action: "scanSpeech", text: textToScan }, (res) => {
            if (res && res.result && (res.result.includes("[DANGEROUS]") || res.result.includes("[SUSPICIOUS]"))) {
                injectOverlay();
                handleGeneralVerdict(res, globalOverlay);
            }
        });
        speechTranscript = "";
    }
}, 30000);

// --- WATCHDOG ---
const startWatchdog = () => {
    console.log(`🛡️ Scam Shield: [WATCHDOG] Started for ${host}`);
    
    // Polling watchdog — fallback for when MutationObserver misses something
    setInterval(() => {
        if (isYouTube) { scanCards(); scanWatchPage(); }
        if (isFacebook) scanFacebook();
        
        // Periodic re-scan for general sites — runs silently, no overlay
        if (!isYouTube && !isFacebook && window.scamShieldInitialDone && config.enablePeriodicScan) {
            const now = Date.now();
            if (!window.lastPeriodicScan || (now - window.lastPeriodicScan > 30000)) {
                console.log("🛡️ Scam Shield: [PERIODIC] Running silent re-scan (Full Text + Visual)...");
                window.lastPeriodicScan = now;
                const text = document.body ? document.body.innerText : "";
                chrome.runtime.sendMessage(
                    { action: "scanFullPage", text, url: window.location.href, domain: host, isVisual: true },
                    (res) => {
                        if (res && res.result) {
                            console.log(`🛡️ Scam Shield: [PERIODIC RESULT] ${res.result.substring(0, 100)}...`);
                            const firstLine = res.result.split('\n').find(l => l.trim().length > 0) || res.result;
                            if (firstLine.includes("[DANGEROUS]") || firstLine.includes("[SUSPICIOUS]")) {
                                injectOverlay();
                                handleGeneralVerdict(res, globalOverlay);
                            }
                        }
                    }
                );
            }
        }
    }, config.watchdogInterval || 5000);
    
    // --- MUTATION OBSERVER: React INSTANTLY when YouTube adds cards ---
    if (isYouTube) {
        let scanDebounce = null;
        const ytObserver = new MutationObserver((mutations) => {
            let foundNewCards = false;
            for (const mutation of mutations) {
                if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) continue;
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    const tag = node.tagName?.toLowerCase() || '';
                    // Check if the added node IS a video card, or CONTAINS video cards
                    if (tag.startsWith('ytd-rich-item') || tag.startsWith('ytd-video-') || 
                        tag.startsWith('ytd-grid-video') || tag.startsWith('ytd-compact-video') ||
                        (node.querySelector && node.querySelector(YT_CARD_SELECTOR))) {
                        foundNewCards = true;
                        break;
                    }
                }
                if (foundNewCards) break;
            }
            
            if (foundNewCards) {
                // Debounce: YouTube adds cards in rapid bursts, don't scan on every single addition
                clearTimeout(scanDebounce);
                scanDebounce = setTimeout(() => {
                    console.log('🛡️ Scam Shield: [OBSERVER] New cards detected, scanning...');
                    scanCards();
                }, 300);
            }
        });
        
        // Observe the entire body for deep child additions (YouTube uses nested containers)
        ytObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
        console.log('🛡️ Scam Shield: [OBSERVER] MutationObserver watching for YouTube card insertions.');
    }
};

// --- INIT ---
const init = () => {
    chrome.storage.local.get(['siteSelectors', 'config', 'customSafeList'], (data) => {
        if (data.siteSelectors) siteSelectors = { ...siteSelectors, ...data.siteSelectors };
        if (data.config) config = { ...config, ...data.config };
        if (data.customSafeList) customSafeList = data.customSafeList;
        
        // Check if domain is in trusted list
        isTrusted = customSafeList.some(d => host.includes(d));
        if (isTrusted) {
            console.log(`🛡️ Scam Shield v1.6: [TRUSTED] ${host} is whitelisted.`);
            return;
        }
        
        console.log(`🛡️ Scam Shield v1.6: Memory Loaded. Mode: ${isYouTube ? 'YouTube' : (isFacebook ? 'Facebook' : 'Standard')}`);
        
        if (isYouTube || isFacebook) {
            if (isYouTube) { scanCards(); scanWatchPage(); }
            if (isFacebook) scanFacebook();
        } else {
            initialScan();
        }
        
        startWatchdog();
        
        // Start speech monitoring
        if (config.enableSpeechScan) {
            startSpeechScan();
        }
    });
};

// Start as early as possible — don't wait for images/videos to finish loading
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}