document.addEventListener('DOMContentLoaded', () => {
    const mainToggle = document.getElementById('mainToggle');
    const statusBadge = document.getElementById('statusBadge');
    const statusDescription = document.getElementById('statusDescription');
    const autoFetchToggle = document.getElementById('autoFetchToggle');
    const highlightToggle = document.getElementById('highlightToggle');
    const clearCacheBtn = document.getElementById('clearCacheBtn');
    const toastMessage = document.getElementById('toastMessage');

    let toastTimer;

    function showToast(msg) {
        if (toastMessage) {
            toastMessage.textContent = msg;
            toastMessage.classList.add('is-visible');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => {
                toastMessage.classList.remove('is-visible');
            }, 1800);
        }
    }

    function updateUI(isEnabled) {
        if (mainToggle) mainToggle.checked = isEnabled;
        if (statusBadge) {
            statusBadge.textContent = isEnabled ? 'Active' : 'Paused';
            statusBadge.classList.toggle('is-paused', !isEnabled);
        }
        if (statusDescription) {
            statusDescription.textContent = isEnabled
                ? 'Smart client data is enabled'
                : 'Insights are currently paused';
        }
    }

    // Load saved settings
    chrome.storage.local.get(['isEnabled', 'autoFetchOnHover', 'highlightBorders'], (res) => {
        const isEnabled = res.isEnabled !== undefined ? res.isEnabled : true;
        const autoFetch = res.autoFetchOnHover !== undefined ? res.autoFetchOnHover : true;
        const highlight = res.highlightBorders !== undefined ? res.highlightBorders : true;

        updateUI(isEnabled);
        if (autoFetchToggle) autoFetchToggle.checked = autoFetch;
        if (highlightToggle) highlightToggle.checked = highlight;
    });

    // Notify all active Upwork tabs
    function broadcastToTabs(payload) {
        chrome.tabs.query({ url: '*://*.upwork.com/*' }, (tabs) => {
            tabs.forEach((tab) => {
                chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
            });
        });
    }

    // Toggle main extension status
    if (mainToggle) {
        mainToggle.addEventListener('change', () => {
            const isEnabled = mainToggle.checked;
            updateUI(isEnabled);
            chrome.storage.local.set({ isEnabled }, () => {
                broadcastToTabs({ action: 'toggleStatus', status: isEnabled });
                showToast(isEnabled ? 'Accelerator activated' : 'Accelerator paused');
            });
        });
    }

    // Option toggles
    if (autoFetchToggle) {
        autoFetchToggle.addEventListener('change', () => {
            const autoFetchOnHover = autoFetchToggle.checked;
            chrome.storage.local.set({ autoFetchOnHover }, () => {
                broadcastToTabs({ action: 'updateSettings', autoFetchOnHover });
                showToast('Settings saved');
            });
        });
    }

    if (highlightToggle) {
        highlightToggle.addEventListener('change', () => {
            const highlightBorders = highlightToggle.checked;
            chrome.storage.local.set({ highlightBorders }, () => {
                broadcastToTabs({ action: 'updateSettings', highlightBorders });
                showToast('Settings saved');
            });
        });
    }

    // Clear cache
    if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', () => {
            chrome.storage.local.remove('hireRateCache', () => {
                broadcastToTabs({ action: 'clearCache' });
                showToast('Cache cleared');
            });
        });
    }
});