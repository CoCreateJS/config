/********************************************************************************
 * Copyright (C) 2023 CoCreate and Contributors.
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

import { dotNotationToObject, getValueFromObject } from '@cocreate/utils';

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
let localStorageImpl = null;

if (isBrowser) {
    import('@cocreate/local-storage')
        .then((mod) => {
            localStorageImpl = mod.default || mod;
        })
        .catch(() => {
            localStorageImpl = window.localStorage;
        });
}

/**
 * Synchronously retrieves a key-value pair.
 * Isomorphic: Reads from local cache/localStorage in the browser,
 * or process.env/globalThis on the server.
 */
function get(key) {
    if (isBrowser) {
        if (window.CoCreateConfig && window.CoCreateConfig[key] !== undefined) {
            return window.CoCreateConfig[key];
        }

        if (localStorageImpl) {
            const val = localStorageImpl.getItem(key);
            if (val !== null && val !== undefined) return val;
        }

        return null;
    } else {
        const globalRef = globalThis.CoCreateConfig || {};
        if (globalRef[key] !== undefined) return globalRef[key];
        
        return process.env[key] !== undefined ? process.env[key] : null;
    }
}

/**
 * Synchronously sets a key-value pair.
 * Isomorphic: Syncs memory and localStorage in browser;
 * syncs globalThis and process.env on server.
 */
function set(key, value) {
    if (isBrowser) {
        if (!window.CoCreateConfig) {
            window.CoCreateConfig = { [key]: value };
        } else {
            window.CoCreateConfig[key] = value;
        }

        if (localStorageImpl) {
            localStorageImpl.setItem(key, value);
        }
    } else {
        if (!globalThis.CoCreateConfig) {
            globalThis.CoCreateConfig = {};
        }
        globalThis.CoCreateConfig[key] = value;
        process.env[key] = value;
    }
    return this;
}

/**
 * Synchronously deletes a key-value pair across all storage engines.
 */
function remove(key) {
    if (isBrowser) {
        if (window.CoCreateConfig) {
            delete window.CoCreateConfig[key];
        }
        
        if (localStorageImpl) {
            localStorageImpl.removeItem(key);
        }
    } else {
        if (globalThis.CoCreateConfig) {
            delete globalThis.CoCreateConfig[key];
        }
        delete process.env[key];
    }
    return this;
}

/**
 * Check if the key exists inside our active isomorphic config scopes.
 */
function has(key) {
    return get(key) !== null;
}

/**
 * Clears the memory context and resets local storage scopes.
 */
function clear() {
    if (isBrowser) {
        window.CoCreateConfig = {};
        if (localStorageImpl && typeof localStorageImpl.clear === 'function') {
            localStorageImpl.clear();
        }
    } else {
        globalThis.CoCreateConfig = {};
    }
    return this;
}

/**
 * Server-only helper function to safely load configurations.
 * Lazily dynamic-imports node dependencies to bypass frontend compilation bottlenecks.
 */
async function loadConfig(filePath) {
    const fs = await import('node:fs');
    if (!fs.existsSync(filePath)) return {};
    
    try {
        const { pathToFileURL } = await import('node:url');
        const fileUrl = pathToFileURL(filePath).href;
        const module = await import(fileUrl);
        return module.default || module;
    } catch (esmError) {
        try {
            const { createRequire } = await import('node:module');
            const require = createRequire(import.meta.url);
            return require(filePath);
        } catch (cjsError) {
            console.error(`[@cocreate/config] Failed to load configuration at ${filePath}:`, esmError.message);
            return {};
        }
    }
}

/**
 * Main Settings & Prompts Orchestration Engine.
 * Dynamically requests missing configurations.
 * Fully Isomorphic: Runs interactive CLI on server, or dynamic UI modals in the browser.
 */
async function request(items, env = true, globalSetting = true, configPath = 'CoCreate.config.js') {
    let promptForInput;

    if (isBrowser) {
        promptForInput = async (question) => {
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
        };
    } else {
        const readline = (await import('node:readline')).default;
        promptForInput = async (question) => {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            return new Promise((resolve) => {
                rl.question(question, (answer) => {
                    rl.close();
                    resolve(answer.trim());
                });
            });
        };
    }

    const filterEmptyValues = (obj) => {
        return Object.fromEntries(
            Object.entries(obj).filter(([_, val]) => {
                if (typeof val === 'object' && !Array.isArray(val)) {
                    return Object.keys(val).length > 0;
                } else if (Array.isArray(val)) {
                    return val.length > 0;
                } else {
                    return val !== '';
                }
            })
        );
    };

    async function getValue(val) {
        if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
            return val;
        } else if (val.$branch && !isBrowser) {
            try {
                const { promisify } = await import('node:util');
                const { exec: childExec } = await import('node:child_process');
                const exec = promisify(childExec);
                const { stdout } = await exec('git branch --show-current');
                return val.$branch[stdout.trim()];
            } catch (error) {
                console.error(`exec error: ${error}`);
                return null;
            }
        } else {
            return val;
        }
    }

    let configData = {};
    let update = false;
    let variables = {};

    async function getConfig(targetItems) {
        if (typeof targetItems === 'string') {
            targetItems = { [targetItems]: '' };
        }
        for (let key of Object.keys(targetItems)) {
            let { value, prompt: userPrompt, choices, variable } = targetItems[key] || {};

            const placeholders = key.match(/{{\s*([\w\W]+?)\s*}}/g);
            if (placeholders && placeholders.length) {
                for (let placeholder of placeholders) {
                    placeholder.trim();
                    if (variables[placeholder]) {
                        key = key.replace(placeholder, variables[placeholder]);
                    }
                }
            }

            if (choices) {
                if (!userPrompt && userPrompt !== '') continue;

                let isAnswered = false;
                for (let choice of Object.keys(choices)) {
                    let isAnsweredChoice = true;
                    for (let choicekey of Object.keys(choices[choice])) {
                        let choiceValue = localConfig[choicekey] || globalConfig[choicekey];
                        if (choiceValue) {
                            configData[choicekey] = choiceValue;
                        } else {
                            isAnsweredChoice = false;
                        }
                    }
                    if (isAnsweredChoice) {
                        isAnswered = true;
                    }
                }

                if (!isAnswered) {
                    const answer = await promptForInput(userPrompt || `${key}: `);
                    const choice = choices[answer];
                    if (choice) {
                        await getConfig(choice);
                    }
                }
            } else if (variable) {
                let variableValue = localConfig[key] || globalConfig[key];
                if (!variableValue) {
                    variables[`{{${variable}}}`] = value || await promptForInput(userPrompt || `${variable}: `);
                } else {
                    variables[`{{${variable}}}`] = Object.keys(variableValue)[0];
                }
            } else {
                if (value || value === "") {
                    configData[key] = value;
                    if (globalSetting) {
                        update = true;
                    }
                } else if (!isBrowser && process.env[key]) {
                    configData[key] = process.env[key];
                } else {
                    let localKey, globalKey;
                    if ((localKey = getValueFromObject(localConfig, key))) {
                        configData[key] = await getValue(localKey);
                    } else if ((globalKey = getValueFromObject(globalConfig, key))) {
                        configData[key] = await getValue(globalKey);
                    } else if (userPrompt || userPrompt === '') {
                        configData[key] = await promptForInput(userPrompt || `${key}: `);
                        if (globalSetting) update = true;
                    }
                    if (env && !isBrowser) {
                        if (typeof configData[key] === 'object') {
                            process.env[key] = JSON.stringify(configData[key]);
                        } else {
                            process.env[key] = configData[key];
                        }
                    }
                }

                if (configData[key] !== undefined) {
                    set(key, configData[key]);
                }
            }
        }
    }

    let localConfig = {};
    let globalConfig = {};

    if (isBrowser) {
        localConfig = window.CoCreateConfig || {};
    } else {
        const path = (await import('node:path')).default;
        const os = (await import('node:os')).default;

        const localConfigPath = path.resolve(process.cwd(), configPath);
        localConfig = await loadConfig(localConfigPath);

        const globalConfigPath = path.resolve(os.homedir(), 'CoCreate.config.js');
        globalConfig = await loadConfig(globalConfigPath);
    }

    if (items) {
        await getConfig(items);

        if (update && !isBrowser) {
            const path = (await import('node:path')).default;
            const os = (await import('node:os')).default;
            const fs = (await import('node:fs')).default;
            
            const globalConfigPath = path.resolve(os.homedir(), 'CoCreate.config.js');
            let updatedGlobalConfig = filterEmptyValues(
                dotNotationToObject(configData, globalConfig)
            );

            const globalConfigString = `export default ${JSON.stringify(updatedGlobalConfig, null, 2)};\n`;
            fs.writeFileSync(globalConfigPath, globalConfigString);
        }
    } else {
        configData = {
            ...filterEmptyValues(globalConfig),
            ...filterEmptyValues(localConfig)
        };
        
        for (const [key, value] of Object.entries(configData)) {
            set(key, value);
        }
    }

    configData = dotNotationToObject(configData);
    return configData;
}

const configAPI = request;

configAPI.request = request;
configAPI.get = get;
configAPI.set = set;
configAPI.delete = remove;
configAPI.remove = remove;
configAPI.has = has;
configAPI.clear = clear;

export default configAPI;
