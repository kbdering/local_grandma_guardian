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
        card: 'div[role="article"], .x1yzt60o, [data-testid="fbfeed_story"]',
        title: 'h3, [dir="auto"]',
        chat: '[role="main"] [role="row"], .x78zum5.xdt5ytf.x1iyjqo2.x6ikm8r.x10wlt62',
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
        /* General security states */
        .scamshield-blur { 
            filter: blur(25px) grayscale(1) !important; 
            pointer-events: none !important;
            transition: filter 0.6s ease, opacity 0.6s ease !important;
        }
        .scamshield-hidden { 
            opacity: 0 !important; 
            visibility: hidden !important; 
            pointer-events: none !important;
            transition: opacity 0.8s ease !important;
        }
        .scamshield-safe { 
            filter: none !important; 
            opacity: 1 !important; 
            visibility: visible !important;
            pointer-events: auto !important;
            transition: opacity 0.6s ease, filter 0.6s ease !important;
        }

        /* YouTube specific hiding */
        ${isYouTube ? `
        ytd-rich-item-renderer:not(.scamshield-safe),
        ytd-video-renderer:not(.scamshield-safe),
        ytd-grid-video-renderer:not(.scamshield-safe),
        ytd-compact-video-renderer:not(.scamshield-safe) {
            display: none !important;
        }
        ` : ''}

        /* Global Warning Overlays */
        #scamshield-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.92); z-index: 2147483647;
            display: flex; align-items: center; justify-content: center;
            flex-direction: column; color: white; font-family: sans-serif;
            text-align: center; padding: 20px; backdrop-filter: blur(15px);
        }
        #scamshield-overlay h1 { font-size: 2.5em; margin-bottom: 15px; }
        #scamshield-overlay p { font-size: 1.3em; max-width: 700px; line-height: 1.6; }
        #scamshield-overlay .safe { color: #4caf50; }
        #scamshield-overlay .danger { color: #ff5252; font-weight: bold; }
        #scamshield-overlay .suspicious { color: #ffab40; }
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
const scanCards = () => {
    const ytOverride = config.ytOverride || {};
    const cardSelector = ytOverride.card || 'ytd-video-renderer, ytd-grid-video-renderer, ytd-rich-item-renderer, ytd-ad-slot-renderer, ytd-reel-item-renderer';
    const titleSelector = ytOverride.title || '#video-title, #title, .ytd-reel-item-renderer #video-title';
    
    let cards;
    try {
        cards = document.querySelectorAll(cardSelector);
    } catch (e) {
        console.error("🛡️ Scam Shield: [INVALID SELECTOR] Resetting YT override.", cardSelector);
        chrome.storage.local.get("config", (data) => {
            const newConfig = { ...data.config, ytOverride: null };
            chrome.storage.local.set({ config: newConfig });
            config.ytOverride = null;
        });
        return;
    }
    
    if (cards.length === 0 && isYouTube) {
        discoverNewSelectors('youtube', cardSelector);
        return;
    }
    
    // DIAGNOSTIC: Always log — never suppress. Also check individual selectors.
    const unscanned = [...cards].filter(c => !c.dataset.scanned);
    console.log(`🛡️ Scam Shield: [SCAN] Total=${cards.length} (unscanned=${unscanned.length})`);
    
    if (cards.length === 0) return;

    const queue = [];
    cards.forEach(card => {
        if (card.dataset.scanned) return;
        
        // --- TITLE EXTRACTION (multiple fallbacks) ---
        let title = "";
        let extractSource = "";
        
        // 1. yt-formatted-string#video-title (classic layout)
        const videoTitle = card.querySelector(titleSelector);
        if (videoTitle) {
            title = (videoTitle.title || videoTitle.getAttribute('aria-label') || videoTitle.innerText || "").trim();
            if (title) extractSource = titleSelector;
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
    const ytBatchSystem = `You are a YouTube security filter. Your ONLY job is to flag scam titles.

DANGER (Flag as DANGER immediately):
- ANY "Giveaway" or "Airdrop" (MrBeast, Elon Musk, etc.)
- ANY "Live" price predictions or "Secret" investment platforms.
- "Promoted" or Ad content that uses celebrity deepfakes or promises free money.
- Deceptive clickbait about death or scandals meant to steal clicks for fraud.

IMPORTANT: Normal YouTube hype is okay, but if it promises FREE MONEY, FREE CRYPTO, or a "SECRET SYSTEM", it is 100% DANGER.`;

    const titles = items.map(i => i.title);
    console.log(`🛡️ Scam Shield: [FETCHING] Sending ${titles.length} titles:`, titles);
    
    chrome.runtime.sendMessage({ action: "scanYouTubeBatch", titles, systemPrompt: ytBatchSystem }, (response) => {
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
const discoverNewSelectors = (platform, sampleSelector) => {
    if (window.scamShieldHealing) return;
    window.scamShieldHealing = true;
    
    console.warn(`🛡️ Scam Shield: [HEALING] No ${platform} elements found. Attempting AI Self-Repair...`);
    
    // Grab a structure-only snapshot (tags and classes of top 50 divs)
    const html = Array.from(document.querySelectorAll('div')).slice(0, 80).map(el => `<${el.tagName.toLowerCase()} class="${el.className}">`).join('\n');
    
    chrome.runtime.sendMessage({ action: "discoverSelectors", domain: host, html }, (res) => {
        if (res && res.selector) {
            console.log(`🛡️ Scam Shield: [HEALED] AI discovered new ${platform} selector: ${res.selector}`);
            chrome.storage.local.get("config", (data) => {
                const overrideKey = platform === 'facebook' ? 'fbOverride' : 'ytOverride';
                const newConfig = { ...data.config, [overrideKey]: res.selector };
                chrome.storage.local.set({ config: newConfig });
                config[overrideKey] = res.selector;
            });
        }
        // Allow healing again after some time if it failed
        setTimeout(() => { window.scamShieldHealing = false; }, 60000);
    });
};

// --- CORE SCANNER: FACEBOOK ---
const scanFacebook = () => {
    // Use override if exists
    const cardSelector = config.fbOverride || siteSelectors.facebook.card;
    let posts;
    try {
        posts = document.querySelectorAll(cardSelector);
    } catch (e) {
        console.error("🛡️ Scam Shield: [INVALID SELECTOR] Resetting FB override.", cardSelector);
        chrome.storage.local.get("config", (data) => {
            const newConfig = { ...data.config, fbOverride: null };
            chrome.storage.local.set({ config: newConfig });
            config.fbOverride = null;
        });
        posts = document.querySelectorAll(siteSelectors.facebook.card);
    }
    
    // Messenger Fallback: Scan chat bubbles
    const chatBubbles = document.querySelectorAll(siteSelectors.facebook.chat);
    
    // HEALING MODE: If no posts found, trigger AI discovery
    if (posts.length === 0 && chatBubbles.length === 0) {
        discoverNewSelectors('facebook', siteSelectors.facebook.card);
        // Immediate fallback while waiting for AI
        posts = document.querySelectorAll('div > div > span[dir="auto"]');
    }

    const allElements = [...posts, ...chatBubbles];
    
    allElements.forEach(post => {
        if (post.dataset.scanned) return;
        
        // Find text: either from standard title selector or the element itself
        const titleEl = post.querySelector(siteSelectors.facebook.title);
        const text = (titleEl ? titleEl.innerText : (post.innerText || post.textContent)).trim();
        
        // Find main image in the post
        const imgEl = post.querySelector(siteSelectors.facebook.thumbnail);
        const imageUrl = imgEl ? imgEl.src : null;
        
        if (text && text.length > 15) {
            // --- ANTI-SPONSORED LOGIC ---
            const isSponsored = text.includes("Sponsored") || text.includes("Sponsorowane") || text.includes("Płatna promocja");
            
            post.dataset.scanned = "pending";
            post.style.transition = "opacity 0.8s ease, filter 0.5s";
            post.classList.add('scamshield-hidden');
            
            if (isSponsored) {
                console.log(`🛡️ Scam Shield: [SPONSORED] Detected paid ad: ${text.substring(0, 30)}...`);
            }
            
            chrome.runtime.sendMessage({ 
                action: "scanFacebookPost", 
                text: `${isSponsored ? '[SPONSORED AD] ' : ''}${text}`, 
                image: imageUrl,
                isVisual: !!imageUrl
            }, (res) => {
                post.dataset.scanned = "true";
                if (res && res.result && (res.result.includes("[SAFE]") || res.result.toUpperCase().includes("SAFE"))) {
                    post.classList.remove('scamshield-hidden');
                    post.classList.add('scamshield-safe');
                } else {
                    console.warn(`🛡️ Scam Shield: [BLOCKED FB/MSG] Found threat in: ${text.substring(0, 50)}...`);
                    // Reveal it but keep it BLURRED if it's dangerous, so the warning overlay can be seen on top
                    post.classList.remove('scamshield-hidden');
                    post.classList.add('scamshield-blur');
                }
            });
        }
    });
};

// --- GENERAL PAGE SCANNER ---
const initialScan = () => {
    if (window.scamShieldInitialDone || window.scamShieldScanInProgress) return;
    
    injectOverlay();
    console.log("🛡️ Scam Shield: [INITIAL SCAN] Checking page safety (Full Text + Visual)...");
    const text = document.body ? document.body.innerText.substring(0, 100000) : "";
    
    window.scamShieldScanInProgress = true;
    chrome.runtime.sendMessage(
        { action: "scanFullPage", text, url: window.location.href, domain: host, isVisual: true }, 
        (res) => {
            window.scamShieldScanInProgress = false;
            window.scamShieldInitialDone = true;
            handleGeneralVerdict(res, globalOverlay);
        }
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
        if (!isYouTube && !isFacebook && window.scamShieldInitialDone && config.enablePeriodicScan && !window.scamShieldScanInProgress) {
            const now = Date.now();
            if (!window.lastPeriodicScan || (now - window.lastPeriodicScan > 30000)) {
                console.log("🛡️ Scam Shield: [PERIODIC] Running silent re-scan (Full Text + Visual)...");
                window.lastPeriodicScan = now;
                const text = document.body ? document.body.innerText.substring(0, 100000) : "";
                window.scamShieldScanInProgress = true;
                chrome.runtime.sendMessage(
                    { action: "scanFullPage", text, url: window.location.href, domain: host, isVisual: true },
                    (res) => {
                        window.scamShieldScanInProgress = false;
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