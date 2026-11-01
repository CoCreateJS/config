/********************************************************************************
 * Copyright (C) 2026 CoCreate and Contributors.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 ********************************************************************************/

import { configAPI, registerAdapter } from './core.js';

let localStorageImpl = null;
// Config is read synchronously during socket initialization, before imports settle.
try {
    if (typeof window !== 'undefined') localStorageImpl = window.localStorage;
} catch {
    // The optional storage adapter can still provide its in-memory fallback.
}

// Bypassing top-level await by using standard promise syntax for ES2017 compatibility
import('@cocreate/local-storage')
    .then((mod) => {
        localStorageImpl = mod.default || mod;
    })
    .catch(() => {
        // Retain the synchronous browser storage implementation.
    });

/**
 * Renders an interactive fallback HTML modal overlay in the browser
 * to handle real-time configurations or missing setup questions.
 *
 * @param {string} question - The prompt question to display.
 * @returns {Promise<string>} The user's input response.
 * @private
 * @environment client
 */
async function browserPrompt(question) {
    return new Promise((resolve) => {
        const container = document.createElement('div');
        container.innerHTML = `
            <div style="position:fixed;inset:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:999999;font-family:system-ui,-apple-system,sans-serif;">
                <div style="background:#ffffff;padding:24px;border-radius:12px;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);width:100%;max-width:360px;box-sizing:border-box;">
                    <div style="font-weight:600;font-size:16px;color:#1e293b;margin-bottom:12px;">${question}</div>
                    <input id="prompt-input" type="text" placeholder="Enter your response..." style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;outline:none;margin-bottom:16px;box-sizing:border-box;">
                    <button id="prompt-submit" style="width:100%;padding:10px;background:#2563eb;color:#ffffff;border:none;border-radius:6px;font-size:14px;font-weight:500;cursor:pointer;transition:background 0.15s ease;">Submit</button>
                </div>
            </div>
        `;
        document.body.appendChild(container);
        
        const input = container.querySelector('#prompt-input');
        const button = container.querySelector('#prompt-submit');
        
        input.focus();

        const submitValue = () => {
            const val = input.value.trim();
            container.remove();
            resolve(val);
        };

        button.addEventListener('click', submitValue);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitValue();
        });
    });
}

// Bind platform capabilities directly into the core adapter engine
registerAdapter({
    isBrowser: true,
    
    getLocalStorageItem: (key) => {
        return localStorageImpl ? localStorageImpl.getItem(key) : null;
    },
    
    setLocalStorageItem: (key, value) => {
        if (localStorageImpl) {
            localStorageImpl.setItem(key, value);
        }
    },
    
    removeLocalStorageItem: (key) => {
        if (localStorageImpl) {
            localStorageImpl.removeItem(key);
        }
    },
    
    clearLocalStorage: () => {
        if (localStorageImpl && typeof localStorageImpl.clear === 'function') {
            localStorageImpl.clear();
        }
    },

    getGlobalConfig: () => {
        return (typeof window !== 'undefined' && window.CoCreateConfig) || {};
    },

    setGlobalConfig: (config) => {
        if (typeof window !== 'undefined') {
            window.CoCreateConfig = config;
        }
    },

    getEnv: () => null,
    setEnv: () => {},
    removeEnv: () => {},
    
    getGitBranch: async () => null,
    prompt: browserPrompt,
    
    loadConfig: async () => {
        return (typeof window !== 'undefined' && window.CoCreateConfig) || {};
    },
    
    saveConfig: async () => {}
});

export default configAPI;

/**
 *
 * @name default
 * @kind member
 * @public
 * @environment client
 */

/**
 * A convenient chain handler allows user to chain multiple CoCreate components together. When one action is complete next one will start. The sequence goes untill all config completed. Grounded on Vanilla javascript, easily configured using HTML5 attributes and/or JavaScript API.
 *
 * @module config
 * @environment client
 */
