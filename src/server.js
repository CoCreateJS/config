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
 *
 ********************************************************************************/

// Commercial Licensing Information:
// For commercial use of this software without the copyleft provisions of the AGPLv3,
// you must obtain a commercial license from CoCreate LLC.
// For details, visit <https://cocreate.app/licenses/> or contact us at sales@cocreate.app.

import readline from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { exec as childExec } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

import { dotNotationToObject, getValueFromObject } from '@cocreate/utils';

const exec = promisify(childExec);
const require = createRequire(import.meta.url);

/**
 * Helper function to dynamically load configurations.
 * Handles both native ES modules and legacy CommonJS/JSON files safely.
 * @param {string} filePath - Absolute path to the config file
 * @returns {Promise<Object>} Evaluated configuration object
 */
async function loadConfig(filePath) {
    if (!fs.existsSync(filePath)) return {};
    try {
        // Attempt native ESM dynamic import
        const fileUrl = pathToFileURL(filePath).href;
        const module = await import(fileUrl);
        return module.default || module;
    } catch (esmError) {
        try {
            // Fallback to Classic CommonJS / JSON Require compatibility
            return require(filePath);
        } catch (cjsError) {
            console.error(`[@cocreate/config] Failed to load configuration at ${filePath}:`, esmError.message);
            return {};
        }
    }
}

/**
 * Asynchronously retrieves configuration values. This function allows for 
 * fetching values from project-specific configuration, global configuration, or 
 * environment variables. Project configuration takes precedence over global and 
 * environment settings. It also supports interactive prompts to gather critical values 
 * from the user if they are not already defined in the configuration.
 *
 * @async
 * @param {Object|string} items - An object representing the configuration items to retrieve. 
 * The keys are the config paths, and the values are objects 
 * specifying the prompt and any variable substitutions.
 * @param {boolean} [env=true] - Flag to consider environment variables during config lookup.
 * @param {boolean} [global=true] - Flag to consider global configuration during config lookup.
 * @param {string} [configPath='CoCreate.config.js'] - Path to the project-specific configuration file.
 * @returns {Promise<Object>} A promise that resolves with the configuration object.
 */
export default async function config(items, env = true, global = true, configPath = 'CoCreate.config.js') {
    async function promptForInput(question) {
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
    }

    const filterEmptyValues = (obj) => {
        return Object.fromEntries(
            Object.entries(obj).filter(([_, value]) => {
                if (typeof value === 'object' && !Array.isArray(value)) {
                    return Object.keys(value).length > 0;
                } else if (Array.isArray(value)) {
                    return value.length > 0;
                } else {
                    return value !== '';
                }
            })
        );
    };

    async function getValue(value) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return value;
        } else if (value.$branch) {
            try {
                const { stdout } = await exec('git branch --show-current');
                return value.$branch[stdout.trim()];
            } catch (error) {
                console.error(`exec error: ${error}`);
                return null;
            }
        } else {
            return value;
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
            let { value, prompt, choices, variable } = targetItems[key];

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
                if (!prompt && prompt !== '') continue;

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
                    const answer = await promptForInput(prompt || `${key}: `);
                    const choice = choices[answer];
                    if (choice) {
                        await getConfig(choice);
                    }
                }
            } else if (variable) {
                let variableValue = localConfig[key] || globalConfig[key];
                if (!variableValue) {
                    variables[`{{${variable}}}`] = value || await promptForInput(prompt || `${variable}: `);
                } else {
                    variables[`{{${variable}}}`] = Object.keys(variableValue)[0];
                }
            } else {
                if (value || value === "") {
                    configData[key] = value;
                    if (global) {
                        update = true;
                    }
                } else if (process.env[key]) {
                    configData[key] = process.env[key];
                } else {
                    let localKey, globalKey;
                    if ((localKey = getValueFromObject(localConfig, key))) {
                        configData[key] = await getValue(localKey);
                    } else if ((globalKey = getValueFromObject(globalConfig, key))) {
                        configData[key] = await getValue(globalKey);
                    } else if (prompt || prompt === '') {
                        configData[key] = await promptForInput(prompt || `${key}: `);
                        if (global) update = true;
                    }
                    if (env) {
                        if (typeof configData[key] === 'object') {
                            process.env[key] = JSON.stringify(configData[key]);
                        } else {
                            process.env[key] = configData[key];
                        }
                    }
                }
            }
        }
    }

    // Resolving paths and dynamically loading configurations with ESM wrappers
    const localConfigPath = path.resolve(process.cwd(), configPath);
    const localConfig = await loadConfig(localConfigPath);

    const globalConfigPath = path.resolve(os.homedir(), 'CoCreate.config.js');
    const globalConfig = await loadConfig(globalConfigPath);

    if (items) {
        await getConfig(items);

        if (update) {
            let updatedGlobalConfig = filterEmptyValues(
                dotNotationToObject(configData, globalConfig)
            );

            // Updated to write modern ES module syntax "export default" instead of "module.exports"
            const globalConfigString = `export default ${JSON.stringify(updatedGlobalConfig, null, 2)};\n`;
            fs.writeFileSync(globalConfigPath, globalConfigString);
        }
    } else {
        configData = {
            ...filterEmptyValues(globalConfig),
            ...filterEmptyValues(localConfig)
        };
    }

    configData = dotNotationToObject(configData);
    return configData;
}