document.addEventListener('DOMContentLoaded', async () => {
    const trustBtn = document.getElementById('trustBtn');
    const statusDiv = document.getElementById('status');
    const listContainer = document.getElementById('listContainer');

    document.getElementById('trustedSitesLabel').innerText = chrome.i18n.getMessage("trustedSites");

    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let currentDomain = new URL(tab.url).hostname.replace(/^www\./, '');

    trustBtn.innerText = `${chrome.i18n.getMessage("trustSiteBtn")} (${currentDomain})`;

    chrome.storage.local.get({ customSafeList: [] }, (data) => {
        updateListUI(data.customSafeList);
    });

    // --- FEATURE FLAGS ---
    const flagMap = {
        'flag-ytCards': 'enableYouTubeCards',
        'flag-ytWatch': 'enableYouTubeWatch',
        'flag-fb': 'enableFacebook',
        'flag-periodic': 'enablePeriodicScan',
        'flag-speech': 'enableSpeechScan',
        'flag-overlay': 'enableGlobalOverlay',
        'flag-automicro': 'enableAutoAllowMic'
    };

    const config = await getConfig();
    Object.keys(flagMap).forEach(id => {
        const el = document.getElementById(id);
        const configKey = flagMap[id];
        el.checked = config[configKey];
        el.addEventListener('change', () => {
            config[configKey] = el.checked;
            chrome.storage.local.set({ config: config }, () => {
                statusDiv.innerHTML = `<span style="color: blue;">⚙️ Zapisano zmiany</span>`;
                setTimeout(() => statusDiv.innerHTML = '', 2000);
            });
        });
    });

    // --- AI SETTINGS ---
    const aiModelInput = document.getElementById('ai-model');
    const aiUrlInput = document.getElementById('ai-url');
    const aiKeyInput = document.getElementById('ai-key');
    const saveAiBtn = document.getElementById('saveAiBtn');

    aiModelInput.value = config.aiModel;
    aiUrlInput.value = config.aiUrl;
    aiKeyInput.value = config.aiApiKey;

    saveAiBtn.addEventListener('click', () => {
        config.aiModel = aiModelInput.value;
        config.aiUrl = aiUrlInput.value;
        config.aiApiKey = aiKeyInput.value;
        chrome.storage.local.set({ config: config }, () => {
            statusDiv.innerHTML = `<span style="color: blue;">🚀 AI Config Zaktualizowany!</span>`;
            setTimeout(() => statusDiv.innerHTML = '', 2000);
        });
    });

    trustBtn.addEventListener('click', () => {
        chrome.storage.local.get({ customSafeList: [] }, (data) => {
            let currentList = data.customSafeList;
            if (!currentList.includes(currentDomain)) {
                currentList.push(currentDomain);
                chrome.storage.local.set({ customSafeList: currentList }, () => {
                    statusDiv.innerHTML = `<span style="color: green;">✔️ Dodano!</span>`;
                    updateListUI(currentList);
                    chrome.tabs.reload(tab.id);
                });
            }
        });
    });

    function updateListUI(list) {
        listContainer.innerHTML = '';
        list.forEach(domain => {
            listContainer.innerHTML += `<div class="domain-item">✔️ ${domain}</div>`;
        });
    }
});