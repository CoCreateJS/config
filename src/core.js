/********************************************************************************
 * Copyright (C) 2026 CoCreate and Contributors.
 *
 * Licensed under GNU AGPLv3.
 ********************************************************************************/

import { dotNotationToObject, getValueFromObject } from '@cocreate/utils';

// Global in-memory key-value state store for runtime configuration settings
let configMemory = {};

// Cache stores for loaded local and global configuration files
let localConfigCache = {};
let globalConfigCache = {};

/**
 * Adapter holding environment-specific behaviors.
 * Injected statically by environment wrappers (Browser or Node/Deno Server adapters).
 */
let adapter = {
    isBrowser: false,
    getLocalStorageItem: (key) => null,
    setLocalStorageItem: (key, value) => { },
    removeLocalStorageItem: (key) => { },
    clearLocalStorage: () => { },
    getGlobalConfig: () => ({}),
    setGlobalConfig: (config) => { },
    getEnv: (key) => null,
    setEnv: (key, value) => { },
    removeEnv: (key) => { },
    getGitBranch: async () => null,
    prompt: async (question) => "",
    loadConfig: async (filePath) => ({}),
    saveConfig: async (filePath, content) => { }
};

/**
 * Registers the environment adapter context.
 * Called during boot by environment-specific wrapper scripts (e.g. browser.js, server.js).
 * 
 * @param {Object} envAdapter - Runtime adapter implementation object
 */
export function registerAdapter(envAdapter) {
    adapter = { ...adapter, ...envAdapter };
}

/**
 * Synchronously retrieves a configuration value by key.
 * Checks active in-memory overrides first, falling back to cached local/global config,
 * LocalStorage (browser), or process environment variables (server).
 * 
 * @param {string} key - Configuration key name
 * @returns {*} Configuration value, or null if not resolved
 */
export function get(key) {
    if (!key || typeof key !== 'string') return null;

    // 1. Check in-memory runtime overrides using dot-notation lookup
    const memoryVal = getValueFromObject(configMemory, key);
    if (memoryVal !== undefined && memoryVal !== null) {
        return memoryVal;
    }

    // 2. Check cached local config file (e.g., CoCreate.config.js)
    const localVal = getValueFromObject(localConfigCache, key);
    if (localVal !== undefined && localVal !== null) {
        return localVal;
    }

    // 3. Check cached global config file (~/.cocreate/config.json)
    const globalVal = getValueFromObject(globalConfigCache, key);
    if (globalVal !== undefined && globalVal !== null) {
        return globalVal;
    }

    // 4. Fall back to environment adapters (Browser LocalStorage or Node env)
    if (adapter.isBrowser) {
        const storageVal = adapter.getLocalStorageItem(key);
        if (storageVal !== null && storageVal !== undefined) return storageVal;
    } else {
        const envVal = adapter.getEnv(key);
        if (envVal !== null && envVal !== undefined) return envVal;
    }

    return null;
}

/**
 * Synchronously sets a configuration key-value pair in memory and persistent storage adapters.
 * 
 * @param {string} key - Configuration key name
 * @param {*} value - Value to store
 * @returns {Object} API context for method chaining
 */
export function set(key, value) {
    configMemory[key] = value;

    if (adapter.isBrowser) {
        adapter.setLocalStorageItem(key, value);
    } else {
        adapter.setEnv(key, value);
    }
    return configAPI;
}

/**
 * Synchronously deletes a configuration key across memory and persistent environment scopes.
 * 
 * @param {string} key - Configuration key name
 * @returns {Object} API context for method chaining
 */
export function del(key) {
    delete configMemory[key];
    delete localConfigCache[key];
    delete globalConfigCache[key];

    if (adapter.isBrowser) {
        adapter.removeLocalStorageItem(key);
    } else {
        adapter.removeEnv(key);
    }
    return configAPI;
}

export const remove = del;

/**
 * Checks if a specific key exists inside the active configuration scope.
 * 
 * @param {string} key - Configuration key name
 * @returns {boolean} True if key exists and is non-null/non-undefined
 */
export function has(key) {
    const val = get(key);
    return val !== null && val !== undefined;
}

/**
 * Clears the active memory context and resets storage scopes.
 * 
 * @returns {Object} API context for method chaining
 */
export function clear() {
    configMemory = {};
    localConfigCache = {};
    globalConfigCache = {};
    if (adapter.isBrowser) {
        adapter.clearLocalStorage();
    }
    return configAPI;
}

/**
 * Helper to resolve dynamic configuration values (such as Git branch-specific mappings).
 * 
 * @param {*} val - Value or branch mapping object
 * @returns {Promise<*>} Resolved target value
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
 * Interactive setup routine (`prompt` / `request`).
 * Orchestrates user CLI prompts, choices, configuration file imports, and env variable synchronization.
 * 
 * @param {Object|string} [items] - Configuration structure or singular key to look up
 * @param {boolean} [env=true] - Synced environment options
 * @param {boolean} [globalSetting=true] - Sync back to global user config file (~/.cocreate/config.json)
 * @param {string} [configPath='CoCreate.config.js'] - Configuration file path
 * @returns {Promise<Object>} Resolved configuration object
 */
export async function prompt(items, env = true, globalSetting = true, configPath = 'CoCreate.config.js') {
    let localConfig = await adapter.loadConfig(configPath);
    let globalConfig = await adapter.getGlobalConfig();

    localConfigCache = localConfig || {};
    globalConfigCache = globalConfig || {};

    const filterEmptyValues = (obj) => {
        if (!obj || typeof obj !== 'object') return {};
        return Object.fromEntries(
            Object.entries(obj).filter(([_, val]) => {
                if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
                    return Object.keys(val).length > 0;
                } else if (Array.isArray(val)) {
                    return val.length > 0;
                } else {
                    return val !== '' && val !== undefined;
                }
            })
        );
    };

    let configData = {};
    let updateGlobalFile = false;
    let variables = {};

    async function processPromptItems(targetItems) {
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
                        let choiceValue = configMemory[choicekey] || getValueFromObject(localConfigCache, choicekey) || getValueFromObject(globalConfigCache, choicekey);
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
                        await processPromptItems(choice);
                    }
                }
            } else if (variable) {
                let variableValue = configMemory[key] || getValueFromObject(localConfigCache, key) || getValueFromObject(globalConfigCache, key);
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
                    if ((localKey = getValueFromObject(localConfigCache, key))) {
                        configData[key] = await resolveValue(localKey);
                    } else if ((globalKey = getValueFromObject(globalConfigCache, key))) {
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
        await processPromptItems(items);

        if (updateGlobalFile && !adapter.isBrowser) {
            let updatedGlobalConfig = filterEmptyValues(
                dotNotationToObject(configData, globalConfigCache)
            );
            await adapter.setGlobalConfig(updatedGlobalConfig);
        }
    } else {
        configData = {
            ...filterEmptyValues(globalConfigCache),
            ...filterEmptyValues(localConfigCache)
        };

        for (const [key, value] of Object.entries(configData)) {
            set(key, value);
        }
    }

    configData = dotNotationToObject(configData);
    return configData;
}

export const request = prompt;

/**
 * Helper to check if a document's target key matches a runtime target scope ID.
 * 
 * @param {string|Array<string>} [docTarget] - Target scope defined on the micro-config document
 * @param {string} [currentTargetId] - Active scope ID of the requesting server/worker/cluster
 * @returns {boolean} True if scope matches
 */
function isTargetMatch(docTarget, currentTargetId) {
    if (!docTarget || docTarget === "default" || docTarget === "*") return true;
    if (!currentTargetId) return true;
    if (Array.isArray(docTarget)) return docTarget.includes(currentTargetId);
    return docTarget === currentTargetId;
}

/**
 * Utility to merge multiple micro-configuration documents matching target scope rules.
 * Configuration paths and merge behavior are defined entirely by each document's
 * config object. Dot-notation paths create nested objects, `path[]` appends to an
 * array, and ordinary paths replace the existing value.
 * 
 * @param {Array<Object>} docs - List of micro-configuration documents
 * @param {Object} [scope] - Runtime target scope ({ cluster, server, worker })
 * @returns {Object} Consolidated operational configuration state
 */
function mergeServerConfigs(docs = [], scope = {}) {
    const consolidated = {};

    for (const doc of docs) {
        if (!doc || doc.enabled === false) continue;

        const matchesCluster = isTargetMatch(doc.cluster, scope.cluster);
        const matchesServer = isTargetMatch(doc.server, scope.server);
        const matchesWorker = isTargetMatch(doc.worker, scope.worker);

        if (matchesCluster && matchesServer && matchesWorker && doc.config) {
            dotNotationToObject(doc.config, consolidated);
        }
    }

    return consolidated;
}

/**
 * Asynchronously queries the `servers_config` collection via CoCreate CRUD (`object.read`)
 * matching the target runtime scope (`cluster`, `server`, `worker`) and merges them into an operational object.
 * 
 * @param {Object} [options={}] - Query filters and runtime scope targets
 * @param {Object} [crud] - Initialized CoCreate CRUD interface
 * @returns {Promise<Object>} Consolidated runtime configuration state
 */
export async function query(options = {}, crud) {
    const { cluster, server, worker, type, enabled = true } = options;
    const organization_id = options.organization_id || get('organization_id');

    const queryFilter = { enabled };
    if (type) queryFilter.type = type;

    const scopeConditions = [];
    if (cluster) {
        scopeConditions.push({ cluster: { $in: [cluster, "default", "*"] } }, { cluster: { $exists: false } });
    }
    if (server) {
        scopeConditions.push({ server: { $in: [server, "default", "*"] } }, { server: { $exists: false } });
    }
    if (worker) {
        scopeConditions.push({ worker: { $in: [worker, "default", "*"] } }, { worker: { $exists: false } });
    }

    if (scopeConditions.length > 0) {
        queryFilter.$or = scopeConditions;
    }

    const crudRequest = {
        method: "object.read",
        array: "servers_config",
        organization_id,
        filter: {
            query: queryFilter
        }
    };

    if (crud?.send) {
        const response = await crud.send(crudRequest);
        const docs = response?.data || response?.object || [];
        return mergeServerConfigs(docs, { cluster, server, worker });
    }

    return {};
}

// Bind configuration API methods directly to request/prompt function
request.prompt = prompt;
request.get = get;
request.set = set;
request.delete = del;
request.remove = del;
request.has = has;
request.clear = clear;
request.query = query;
request.registerAdapter = registerAdapter;

export const configAPI = request;

export { del as delete };
export default configAPI;
