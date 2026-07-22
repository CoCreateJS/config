import { dotNotationToObject, getValueFromObject } from '@cocreate/utils';

// Global in-memory state holding configuration variables
let configMemory = {};

/**
 * Adapter holding environment-specific behaviors.
 * These are injected statically by the environment wrappers (Browser or Node/Deno Server).
 * @type {Object}
 */
let adapter = {
    isBrowser: false,
    getLocalStorageItem: (key) => null,
    setLocalStorageItem: (key, value) => {},
    removeLocalStorageItem: (key) => {},
    clearLocalStorage: () => {},
    getGlobalConfig: () => ({}),
    setGlobalConfig: (config) => {},
    getEnv: (key) => null,
    setEnv: (key, value) => {},
    removeEnv: (key) => {},
    getGitBranch: async () => null,
    prompt: async (question) => "",
    loadConfig: async (filePath) => ({}),
    saveConfig: async (filePath, content) => {}
};

/**
 * Registers the environment adapter. Called statically by wrapper modules at startup.
 * 
 * @param {Object} envAdapter - The runtime adapter implementation.
 */
export function registerAdapter(envAdapter) {
    adapter = { ...adapter, ...envAdapter };
}

/**
 * Synchronously retrieves a configuration value by key.
 * 
 * @param {string} key - The configuration key to look up.
 * @returns {*} The configuration value, or null if not found.
 */
export function get(key) {
    if (adapter.isBrowser) {
        if (configMemory[key] !== undefined) {
            return configMemory[key];
        }
        
        const localVal = adapter.getLocalStorageItem(key);
        if (localVal !== null && localVal !== undefined) return localVal;

        return null;
    } else {
        if (configMemory[key] !== undefined) return configMemory[key];
        
        return adapter.getEnv(key);
    }
}

/**
 * Synchronously sets a configuration key-value pair.
 * 
 * @param {string} key - The configuration key to store.
 * @param {*} value - The value to assign to the configuration key.
 * @returns {Function} The hoisted configuration request API context for chaining.
 */
export function set(key, value) {
    configMemory[key] = value;
    
    if (adapter.isBrowser) {
        adapter.setLocalStorageItem(key, value);
    } else {
        adapter.setEnv(key, value);
    }
    return request;
}

/**
 * Synchronously removes a key-value pair across all storage scopes.
 * 
 * @param {string} key - The configuration key to delete.
 * @returns {Function} The hoisted configuration request API context for chaining.
 */
export function remove(key) {
    delete configMemory[key];
    
    if (adapter.isBrowser) {
        adapter.removeLocalStorageItem(key);
    } else {
        adapter.removeEnv(key);
    }
    return request;
}

/**
 * Checks if a specific key exists inside the active configuration scope.
 * 
 * @param {string} key - The configuration key to check.
 * @returns {boolean} True if the key exists and is non-null, false otherwise.
 */
export function has(key) {
    return get(key) !== null;
}

/**
 * Clears the active memory context and resets storage scopes.
 * 
 * @returns {Function} The hoisted configuration request API context for chaining.
 */
export function clear() {
    configMemory = {};
    if (adapter.isBrowser) {
        adapter.clearLocalStorage();
    }
    return request;
}

/**
 * Normalizes values, substituting dynamic evaluations (like Git branch lookups).
 * 
 * @param {*} val - Config value configuration structure.
 * @returns {*} Resolved value context.
 */
async function resolveValue(val) {
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        return val;
    } else if (val && val.$branch) {
        const branch = await adapter.getGitBranch();
        return branch ? val.$branch[branch] : null;
    } else {
        return val;
    }
}

/**
 * Orchestrates prompts, files, and updates.
 * 
 * @param {Object|string} [items] - Targeted configuration structure or a singular key to lookup.
 * @param {boolean} [env=true] - Synced environments options.
 * @param {boolean} [globalSetting=true] - Flag indicating whether values should sync back to global user configurations.
 * @param {string} [configPath='CoCreate.config.js'] - The relative filepath name of the configuration module.
 * @returns {Promise<Object>} Resolved configuration data key map.
 */
export async function request(items, env = true, globalSetting = true, configPath = 'CoCreate.config.js') {
    let localConfig = {};
    let globalConfig = {};

    // Load configurations statically via environment-isolated wrapper adapter
    localConfig = await adapter.loadConfig(configPath);
    globalConfig = await adapter.getGlobalConfig();

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

    let configData = {};
    let updateGlobalFile = false;
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
                        let choiceValue = configMemory[choicekey] || getValueFromObject(localConfig, choicekey) || getValueFromObject(globalConfig, choicekey);
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
                    const answer = await adapter.prompt(userPrompt || `${key}: `);
                    const choice = choices[answer];
                    if (choice) {
                        await getConfig(choice);
                    }
                }
            } else if (variable) {
                let variableValue = configMemory[key] || getValueFromObject(localConfig, key) || getValueFromObject(globalConfig, key);
                if (!variableValue) {
                    variables[`{{${variable}}}`] = value || await adapter.prompt(userPrompt || `${variable}: `);
                } else {
                    variables[`{{${variable}}}`] = Object.keys(variableValue)[0];
                }
            } else {
                if (value || value === "") {
                    configData[key] = value;
                    if (globalSetting) {
                        updateGlobalFile = true;
                    }
                } else if (!adapter.isBrowser && adapter.getEnv(key)) {
                    configData[key] = adapter.getEnv(key);
                } else {
                    let localKey, globalKey;
                    if ((localKey = getValueFromObject(localConfig, key))) {
                        configData[key] = await resolveValue(localKey);
                    } else if ((globalKey = getValueFromObject(globalConfig, key))) {
                        configData[key] = await resolveValue(globalKey);
                    } else if (userPrompt || userPrompt === '') {
                        configData[key] = await adapter.prompt(userPrompt || `${key}: `);
                        if (globalSetting) updateGlobalFile = true;
                    }
                }

                if (configData[key] !== undefined) {
                    set(key, configData[key]);
                }
            }
        }
    }

    if (items) {
        await getConfig(items);

        if (updateGlobalFile && !adapter.isBrowser) {
            let updatedGlobalConfig = filterEmptyValues(
                dotNotationToObject(configData, globalConfig)
            );
            await adapter.setGlobalConfig(updatedGlobalConfig);
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

// Bind configuration API methods directly to the request function to safely bypass Temporal Dead Zone (TDZ) limits.
request.request = request;
request.get = get;
request.set = set;
request.delete = remove;
request.remove = remove;
request.has = has;
request.clear = clear;

/**
 * Consolidated API Object.
 */
export const configAPI = request;
