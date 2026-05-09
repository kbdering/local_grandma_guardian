/**
 * ScamShield Feature Flags and Configuration
 * These are stored in chrome.storage.local
 */
const DEFAULT_CONFIG = {
    enableYouTubeCards: true,
    enableYouTubeWatch: true,
    enableFacebook: true,
    enablePeriodicScan: true,
    enableSpeechScan: true,
    enableGlobalOverlay: true,
    enableAutoAllowMic: true,
    speechScanInterval: 30000,
    periodicScanInterval: 60000,
    batchSize: 15,
    aiModel: 'gemma4:e2b-it-q4_K_M',
    aiUrl: 'http://localhost:11434/api/generate',
    aiApiKey: '',
    language: chrome.i18n.getUILanguage()
};

// Helper to get config with defaults
async function getConfig() {
    return new Promise((resolve) => {
        chrome.storage.local.get({ config: DEFAULT_CONFIG }, (data) => {
            // Merge defaults with stored data to handle new flags
            resolve({ ...DEFAULT_CONFIG, ...data.config });
        });
    });
}
