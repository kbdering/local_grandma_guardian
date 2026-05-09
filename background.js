importScripts('config.js');

// --- GLOBAL FETCH PROTECTOR ---
// Silences the "chrome-extension://invalid" errors by intercepting them
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (url, options) {
    if (typeof url === 'string' && url.startsWith('chrome-extension://invalid')) {
        return Promise.reject(new Error('🛡️ Scam Shield: Blocked invalid extension URL access.'));
    }
    return originalFetch(url, options);
};

// --- GLOBAL PERMISSIONS SETUP ---
chrome.runtime.onInstalled.addListener(() => updateMicPermissions());
chrome.runtime.onStartup.addListener(() => updateMicPermissions());

// Also run once when the service worker starts up
updateMicPermissions();

// Listen for config changes to update permissions immediately
chrome.storage.onChanged.addListener((changes) => {
    if (changes.config) {
        updateMicPermissions();
    }
});

async function updateMicPermissions() {
    const config = await getConfig();
    if (chrome.contentSettings && chrome.contentSettings.microphone) {
        // We set the global default to 'ask' to keep Chrome happy
        chrome.contentSettings.microphone.set({
            primaryPattern: '<all_urls>',
            setting: 'ask'
        });
        console.log("🛡️ Scam Shield: Global mic set to 'ask'. Individual site allow active.");
    }
}

// DYNAMIC AUTO-ALLOW: Every time a tab is updated, we explicitly allow mic for that domain
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' && tab.url && tab.url.startsWith('http')) {
        const config = await getConfig();
        if (config.enableAutoAllowMic && config.enableSpeechScan && chrome.contentSettings.microphone) {
            try {
                const url = new URL(tab.url);
                const pattern = `${url.protocol}//${url.hostname}/*`;
                chrome.contentSettings.microphone.set({
                    primaryPattern: pattern,
                    setting: 'allow'
                });
                console.log(`🛡️ Scam Shield: Dynamically ALLOWED microphone for: ${pattern}`);
            } catch (e) {
                console.warn("🛡️ Scam Shield: Could not set mic permission for URL:", tab.url);
            }
        }
    }
});

const grandmaContext = `You are "Cybersecurity Grandma", a protective, wise, and highly suspicious security expert. Your ONLY job is to protect users from threats.

DANGEROUS — Flag these as [DANGEROUS] immediately:
- FINANCIAL SCAMS: Unrealistic profits (e.g., "15k in 10 days"), guaranteed returns, secret investment "technologies", or claims that "banks don't want you to know" about a system.
- CELEBRITY SCAMS: Names like Elon Musk, Bezos, or local billionaires combined with "scandal", "secret method", or "earnings platform".
- URGENCY & THREATS: "Your account will be deleted", "Police warrant issued", "Immediate action required", or BLIK code requests.
- PHISHING: Asking for passwords, PESEL, bank logins, or suspicious "verification" links on weird domains (.xyz, .finance).
- REMOTE ACCESS: Mentions of AnyDesk, TeamViewer, or "help from an assistant" to set up an account.

SUSPICIOUS — Flag as [SUSPICIOUS]:
- Extreme clickbait, dramatic miracle cures, or "get rich" stories without a clear source.

SAFE:
- Actual news, education, weather, hobbies, and normal shopping on reputable domains.

Your tone: Protective but professional. If you see a story about someone making thousands of euros quickly or a "secret the banks hide", it is 100% a SCAM. 
RESPONSE FORMAT: Start with [SAFE], [SUSPICIOUS], or [DANGEROUS]. Then a 1-sentence reason.`;

console.log("🛡️ Scam Shield: Background Worker starting...");

// --- VERDICT CACHE (10-minute TTL) ---
const verdictCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCached(key) {
    const entry = verdictCache.get(key);
    if (entry && (Date.now() - entry.ts < CACHE_TTL)) {
        console.log(`🛡️ Scam Shield: [CACHE HIT] ${key.substring(0, 60)}`);
        return entry.result;
    }
    if (entry) verdictCache.delete(key);
    return null;
}

function setCache(key, result) {
    verdictCache.set(key, { result, ts: Date.now() });
    // Evict old entries if cache gets too big
    if (verdictCache.size > 200) {
        const oldest = verdictCache.keys().next().value;
        verdictCache.delete(oldest);
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    getConfig().then(config => {
        const lang = config.language || 'en';
        console.log(`🛡️ Scam Shield: Received message: ${request.action} (Lang: ${lang})`);

        // Dynamic Context Estimator: Adapts VRAM usage to the actual content
        const estimateCtx = (promptText, responseBuffer = 500) => {
            const estimatedTokens = Math.ceil(promptText.length / 3) + responseBuffer;
            return Math.min(Math.max(estimatedTokens, 1024), 16384); // Clamp between 1k and 16k
        };

        const getRequestData = (prompt) => ({
            model: config.aiModel || 'gemma2:2b',
            system: grandmaContext,
            options: {
                num_ctx: estimateCtx(prompt + (grandmaContext || "")),
                temperature: 0.1
            }
        });

        if (request.action === "scanFullPage") {
            // Check cache first
            const cacheKey = `page:${request.url}`;
            const cached = getCached(cacheKey);
            if (cached) { sendResponse({ result: cached }); return; }

            const analyze = (imageData) => {
                const prompt = `URL: ${request.url}\nDOMAIN: ${request.domain}\n\nAnalyze this page ${imageData ? 'text and screenshot' : 'text'}. Page Text: ${request.text}\n\nSTRICT RULE: YOUR RESPONSE MUST START WITH [SAFE], [SUSPICIOUS], OR [DANGEROUS]. DO NOT THINK ALOUD.`;
                console.log(`🛡️ Scam Shield: [BG] Starting Full Page Scan (${request.text.length} chars, ctx: ${estimateCtx(prompt)})...`);
                
                analyzeWithGemma4({ ...getRequestData(prompt), prompt, images: imageData ? [imageData] : [] })
                    .then(res => {
                        console.log("🛡️ Scam Shield: [BG] Scan Complete. Sending response...");
                        setCache(cacheKey, res);
                        sendResponse({ result: res });
                    })
                    .catch(err => {
                        console.error("🛡️ Scam Shield: [BG] Scan Failed:", err.message);
                        sendResponse({ error: err.message });
                    });
            };

            // Capture screenshot if requested and it's the active tab
            if (request.isVisual) {
                chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 40 }, (dataUrl) => {
                    if (chrome.runtime.lastError || !dataUrl) {
                        analyze(null); // Fallback to text only
                    } else {
                        analyze(dataUrl.replace(/^data:image\/[a-z]+;base64,/, ''));
                    }
                });
            } else {
                analyze(null);
            }
            return true; // Keep channel open for async capture
        }

        else if (request.action === "discoverSelectors") {
            const prompt = `You are a web scraper assistant. Analyze this HTML structure from ${request.domain} and find the most stable CSS selector for a "social media post" or "main content card" container. Reply with ONLY the CSS selector string, no explanation.\n\nHTML Snippet:\n${request.html}`;
            console.log(`🛡️ Scam Shield: [REPAIR] Asking AI to discover new selectors for ${request.domain}...`);
            analyzeWithGemma4({ ...getRequestData(prompt), prompt })
                .then(res => {
                    // CLEANER PARSER: Remove thinking blocks and extra talk
                    let cleaned = res.replace(/<think>[\s\S]*?<\/think>/gi, ''); // Remove explicit <think> tags
                    cleaned = cleaned.replace(/thinking process:[\s\S]*?\n/gi, ''); // Remove common "Thinking Process:" headers
                    
                    // Take the last non-empty line or the first thing in brackets/backticks
                    const matches = cleaned.match(/`([^`]+)`|\[([^\]]+)\]/);
                    let selector = matches ? (matches[1] || matches[2]) : cleaned.trim().split('\n').filter(l => l.length > 0).pop();
                    
                    // Final safety: remove trailing punctuation if AI was chatty
                    selector = selector.replace(/[.!?]$/, '').trim();
                    
                    sendResponse({ selector });
                })
                .catch(err => sendResponse({ error: err.message }));
            return true;
        }

        else if (request.action === "scanChat" || request.action === "scanFacebookPost") {
            const analyze = (imageData) => {
                const prompt = `Analyze this ${imageData ? 'text and image' : 'text'}. Reply strictly with [SAFE], [SUSPICIOUS], or [DANGEROUS]. Include a 1-sentence reason in language "${lang}".\n\nText: ${request.text}`;
                analyzeWithGemma4({ ...getRequestData(prompt), prompt, images: imageData ? [imageData] : [] })
                    .then(res => sendResponse({ result: res }))
                    .catch(err => sendResponse({ error: err.message }));
            };

            if (request.isVisual && request.image) {
                // Fetch image and convert to base64
                fetch(request.image)
                    .then(r => r.blob())
                    .then(blob => {
                        const reader = new FileReader();
                        reader.onloadend = () => analyze(reader.result.replace(/^data:image\/[a-z]+;base64,/, ''));
                        reader.readAsDataURL(blob);
                    })
                    .catch(() => analyze(null)); // Fallback to text-only if fetch fails
            } else {
                analyze(null);
            }
            return true;
        }

        else if (request.action === "scanYouTubeBatch") {
            // Cache key based on sorted titles
            const cacheKey = `batch:${request.titles.slice().sort().join('|').substring(0, 200)}`;
            const cached = getCached(cacheKey);
            if (cached) { sendResponse({ result: cached }); return; }

            // YouTube-specific system prompt
            const ytBatchSystem = `You are a YouTube content quality filter. Your job is to separate genuinely harmful content from normal videos.

DANGER — flag ONLY these:
- SCAM/FRAUD: titles promoting fake investments, crypto schemes, "get rich quick", celebrity-endorsed financial platforms
- PHISHING: "verify your account", "claim your prize", fake giveaways requiring personal info
- PURE CLICKBAIT: title is ENTIRELY misleading with zero real content (e.g. "FREE MONEY GLITCH 2024 WORKING", "CELEBRITIES EXPOSED [GONE WRONG]")
- FEAR-MONGERING MISINFORMATION: titles spreading deliberate false panic (e.g. "PROOF THE GOVERNMENT IS POISONING YOU", "VACCINES EXPOSED: WHAT THEY HIDE")

SAFE — these are normal YouTube content, do NOT flag:
- Tech reviews with dramatic flair: "DON'T Be Fooled", "Is It Worth It?", "The TRUTH About..."
- Gaming videos: challenges, speedruns, funny moments, cutscene compilations
- Science/news commentary even if dramatic: "China Just Did X", "This Changes Everything"
- Comedy, music, tutorials, vlogs, sports, DIY, reactions, essays
- Any title that describes real content even if the wording is dramatic

IMPORTANT: Dramatic wording is a normal YouTube convention, NOT clickbait. Only flag titles that are genuinely deceptive or promote harmful content.`;

            const prompt = `For each title below, reply with ONLY "SAFE" or "DANGER" on a new line. No numbering, no explanations.\n\n${request.titles.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;
            analyzeWithGemma4({ ...getRequestData(prompt), system: ytBatchSystem, prompt })
                .then(res => {
                    console.log("🛡️ Scam Shield: [BATCH] Raw AI response:", res);
                    const lines = res.split("\n").map(l => l.toUpperCase());
                    const results = [];

                    lines.forEach(line => {
                        const isSafe = line.includes("SAFE") || line.includes("BEZPIECZN");
                        const isDanger = line.includes("DANGER") || line.includes("ZAGRO") || line.includes("SCAM") || line.includes("OSZUST");

                        if (isSafe) results.push(true);
                        else if (isDanger) results.push(false);
                    });

                    console.log(`🛡️ Scam Shield: [BATCH] Parsed ${results.length}/${request.titles.length} verdicts.`);
                    if (results.length > 0) {
                        const resultStr = JSON.stringify(results);
                        setCache(cacheKey, resultStr);
                        sendResponse({ result: resultStr });
                    } else {
                        console.error("🛡️ Scam Shield: AI failed line-by-line. Raw Response:", res);
                        sendResponse({ error: `AI didn't use SAFE/DANGER. It said: "${res.substring(0, 50)}..."` });
                    }
                })
                .catch(err => sendResponse({ error: err.message }));
        }

        else if (request.action === "scanYouTubeVideo") {
            const cacheKey = `yt:${request.title.substring(0, 100)}`;
            const cached = getCached(cacheKey);
            if (cached) { sendResponse({ result: cached }); return; }

            const descPart = request.description ? `\n\nDescription: ${request.description}` : '';
            const prompt = `Analyze this YouTube video metadata. Reply strictly with [SAFE], [SUSPICIOUS], or [DANGEROUS]. Include a 1-sentence reason in language "${lang}" AND the exact suspicious quote as [Cytat: <tekst>].\n\nTitle: ${request.title}${descPart}`;
            analyzeWithGemma4({ ...getRequestData(prompt), prompt }).then(res => { setCache(cacheKey, res); sendResponse({ result: res }); }).catch(err => sendResponse({ error: err.message }));
        }

        else if (request.action === "scanSpeech") {
            const prompt = `Analyze this speech transcript. Reply strictly with [SAFE], [SUSPICIOUS], or [DANGEROUS]. Include a 1-sentence reason in language "${lang}" AND the exact suspicious quote as [Cytat: <tekst>].\n\nTranscript: ${request.text}`;
            analyzeWithGemma4({ ...getRequestData(prompt), prompt }).then(res => sendResponse({ result: res })).catch(err => sendResponse({ error: err.message }));
        }

        else if (request.action === "scanScreenshot") {
            const prompt = `Analyze this screenshot. Reply strictly with [SAFE], [SUSPICIOUS], or [DANGEROUS]. Include a 1-sentence reason in language "${lang}" AND the exact suspicious text found as [Cytat: <tekst>].`;
            analyzeWithGemma4({ ...getRequestData(prompt), prompt, images: [request.image.replace(/^data:image\/[a-z]+;base64,/, '')] }).then(res => sendResponse({ result: res })).catch(err => sendResponse({ error: err.message }));
        }

        else if (request.action === "repairSiteSelectors") {
            const context = request.site === 'youtube' ? 'video containers and titles' : 'Facebook posts and Messenger messages';
            const jsonFormat = request.site === 'youtube' ? '{"card": "selector", "title": "selector"}' : '{"post": "selector", "message": "selector"}';
            const prompt = `I am a security extension. ${request.site} layout changed and my selectors failed. Based on this HTML snippet, find the CSS selectors for the ${context}. Reply strictly with a JSON object: ${jsonFormat}. HTML: ${request.html}`;
            analyzeWithGemma4({ ...getRequestData(prompt), prompt }).then(res => sendResponse({ result: res })).catch(err => sendResponse({ error: err.message }));
        }

        else if (request.action === "requestFullScreenshot") {
            chrome.tabs.captureVisibleTab(null, { format: "jpeg", quality: 50 }, (dataUrl) => {
                if (chrome.runtime.lastError || !dataUrl) sendResponse({ error: "Capture failed" });
                else sendResponse({ fullImage: dataUrl });
            });
        }
    });
    return true; // Keep channel open
});

async function analyzeWithGemma4(payload) {
    console.log("🛡️ Scam Shield: AI Request:", payload.prompt.substring(0, 100) + "...");
    const config = await getConfig();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    try {
        const headers = { "Content-Type": "application/json" };
        if (config.aiApiKey) headers["Authorization"] = `Bearer ${config.aiApiKey}`;

        let apiUrl = config.aiUrl || "http://localhost:11434/api/chat";
        if (apiUrl.endsWith("/generate")) apiUrl = apiUrl.replace("/generate", "/chat");
        if (!apiUrl.startsWith('http')) apiUrl = `http://${apiUrl}`;

        let systemPrompt = payload.system;
        const isListTask = payload.prompt.includes("SAFE") || payload.prompt.includes("DANGER");

        if (payload.prompt.includes("JSON")) {
            systemPrompt += "\n\nCRITICAL: Reply ONLY with valid JSON.";
        }

        const chatPayload = {
            model: payload.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: payload.prompt }
            ],
            stream: true,
            think: false, // API-level instruction to skip reasoning blocks
            options: payload.options || {
                temperature: 0.1,
                num_ctx: 4096,
                think: false // Redundant safety in options
            }
        };

        const response = await fetch(apiUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(chatPayload),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";
        let fullThinking = "";
        let lineBuffer = "";
        const expectedVerdicts = isListTask ? (payload.prompt.match(/^\d+\./gm) || []).length : 0;

        return new Promise(async (resolve, reject) => {
            let hasResolved = false;
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    lineBuffer += decoder.decode(value, { stream: true });
                    const lines = lineBuffer.split('\n');
                    lineBuffer = lines.pop();

                    for (const line of lines) {
                        if (!line.trim() || hasResolved) continue;
                        const json = JSON.parse(line);
                        const content = (json.message && json.message.content) || json.response || "";
                        const thinking = (json.message && json.message.thinking) || json.thinking || "";

                        if (content) fullText += content;
                        if (thinking) fullThinking += thinking;

                        if (isListTask && expectedVerdicts > 0 && fullText.length > 10) {
                            const verdictLines = fullText.split('\n').filter(l => {
                                const u = l.toUpperCase();
                                return u.includes('SAFE') || u.includes('DANGER');
                            });
                            if (verdictLines.length >= expectedVerdicts) {
                                hasResolved = true;
                                resolve(fullText.trim());
                                try { reader.cancel(); } catch (e) {}
                                break;
                            }
                        }

                        if (json.done) {
                            hasResolved = true;
                            let cleaned = fullText;
                            cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
                            const verdictRegex = /\[(SAFE|SUSPICIOUS|DANGEROUS|BEZPIECZN|PODEJRZAN|NIEBEZPIECZN)\]/gi;
                            const matches = Array.from(cleaned.matchAll(verdictRegex));
                            
                            if (matches.length > 0) {
                                cleaned = cleaned.substring(matches[matches.length - 1].index);
                            } else {
                                cleaned = cleaned.replace(/thinking process:[\s\S]*?(\n\n|\[)/gi, '[');
                                cleaned = cleaned.replace(/1\.\s+\*\*analyze the request:\*\*[\s\S]*?(\n\n|\[)/gi, '[');
                                cleaned = cleaned.replace(/thinking process:[\s\S]*/gi, '');
                            }
                            
                            cleaned = cleaned.replace(/^(here is the analysis:|analysis:|result:)\s*/gi, '');
                            cleaned = cleaned.trim();

                            if (!cleaned && fullThinking) {
                                const verdictMatch = Array.from(fullThinking.matchAll(verdictRegex)).pop();
                                cleaned = verdictMatch ? verdictMatch[0].trim() : fullThinking.trim();
                            }
                            console.log("🛡️ Scam Shield: AI Response Finalized.");
                            resolve(cleaned);
                            break;
                        }
                    }
                    if (hasResolved) break;
                }
                if (!hasResolved) resolve(fullText.trim());
            } catch (e) {
                if (!hasResolved) reject(e);
            }
        });
    } catch (e) {
        clearTimeout(timeoutId);
        console.error("🛡️ Scam Shield: AI Error:", e);
        throw e;
    }
}
