/********************************************************************************
 * Copyright (C) 2026 CoCreate and Contributors.
 *
 * Licensed under GNU AGPLv3.
 ********************************************************************************/

import { dotNotationToObject, getValueFromObject } from '@cocreate/utils';

// Global in-memory key-value state store for runtime configuration settings
let configMemory = {};

/**
 * Adapter holding environment-specific behaviors.
 * Injected statically by environment wrappers (Browser or Node/Deno Server adapters).
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
 * Checks active in-memory overrides first, falling back to LocalStorage (browser) or process environment variables (server).
 * 
 * @param {string} key - Configuration key name
 * @returns {*} Configuration value, or null if not resolved
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
 * @returns {boolean} True if key exists and is non-null
 */
export function has(key) {
    return get(key) !== null;
}

/**
 * Clears the active memory context and resets storage scopes.
 * 
 * @returns {Object} API context for method chaining
 */
export function clear() {
    configMemory = {};
    if (adapter.isBrowser) {
        adapter.clearLocalStorage();
    }
    return configAPI;
}

/**
 * Helper to resolve dynamic configuration values (such as Git branch branch-specific mappings).
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
                        await processPromptItems(choice);
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
        await processPromptItems(items);

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

export const request = prompt;

/**
 * Helper to check if a document's target key matches a runtime target scope ID.
 * Rules:
 * - Omitted, undefined, null, "default", or "*" matches ANY target scope.
 * - Strings match exact ID.
 * - Arrays match if the target ID is contained within the list.
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
 * Filters out documents with `enabled: false` and merges their `config` or `driver` properties.
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

        if (matchesCluster && matchesServer && matchesWorker) {
            if (doc.driver) {
                if (!consolidated.drivers) consolidated.drivers = {};
                consolidated.drivers[doc.driver] = {
                    _id: doc._id,
                    name: doc.name,
                    enabled: doc.enabled,
                    ...doc.config
                };
            } else if (doc.config) {
                Object.assign(consolidated, doc.config);
            }
        }
    }

    return consolidated;
}

/**
 * Asynchronously queries the `servers_config` collection via CoCreate CRUD (`object.read`)
 * matching the target runtime scope (`cluster`, `server`, `worker`) and merges them into an operational object.
 * 
 * @param {Object} [options={}] - Query filters and runtime scope targets
 * @param {string} [options.cluster] - Active cluster ID
 * @param {string} [options.server] - Active server host ID
 * @param {string} [options.worker] - Active worker isolate ID
 * @param {string} [options.type] - Configuration category filter (e.g. "storage", "autoscaling")
 * @param {string} [options.organization_id] - Target platform organization ID
 * @param {boolean} [options.enabled=true] - Status filter
 * @returns {Promise<Object>} Consolidated runtime configuration state
 */
export async function query(options = {}) {
    const { cluster, server, worker, type, enabled = true } = options;
    const organization_id = options.organization_id || get('organization_id');

    const queryFilter = { enabled };
    if (type) queryFilter.type = type;

    // Build scope conditions allowing exact matches, arrays, or unspecified/default entries
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
        filter: queryFilter
    };

    if (typeof crud !== 'undefined' && crud.send) {
        const response = await crud.send(crudRequest);
        const docs = response?.data || response?.object || [];
        return mergeServerConfigs(docs, { cluster, server, worker });
    }

    return {};
}

// Bind configuration API methods directly to the request/prompt function to safely bypass Temporal Dead Zone (TDZ) limits.
request.prompt = prompt;
request.get = get;
request.set = set;
request.delete = del;
request.remove = del;
request.has = has;
request.clear = clear;
request.query = query;
request.registerAdapter = registerAdapter;

/**
 * Consolidated API Object Export.
 */
export const configAPI = request;

export { del as delete };
export default configAPI;