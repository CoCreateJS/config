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

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { promisify } from 'node:util';
import { exec as childExec } from 'node:child_process';

import { configAPI, registerAdapter } from './core.js';

const exec = promisify(childExec);

/**
 * Retrieves the current active git branch name on the system.
 * 
 * @returns {Promise<string|null>} The branch name, or null on error.
 */
async function getGitBranch() {
    try {
        const { stdout } = await exec('git branch --show-current');
        return stdout.trim();
    } catch {
        return null;
    }
}

/**
 * Prompts the CLI operator for input interactively using Node's standard readline module.
 * 
 * @param {string} question - Question to print on stdout.
 * @returns {Promise<string>} User input response.
 */
async function cliPrompt(question) {
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

/**
 * Binary-safe server configuration file loader. Bypasses static compiler
 * tree issues by parsing configuration files dynamically under a sandboxed function wrapper.
 * 
 * @param {string} filePath - Absolute path to the config file on disk.
 * @returns {Promise<Object>} The parsed configuration object.
 */
async function loadConfig(filePath) {
    try {
        const resolvedPath = path.resolve(process.cwd(), filePath);
        if (!fs.existsSync(resolvedPath)) return {};
        
        // Load, clean comments, and normalize script syntax for evaluation
        const content = fs.readFileSync(resolvedPath, 'utf8');
        const cleanContent = content.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1').trim();
        
        try {
            return JSON.parse(cleanContent);
        } catch {
            const script = cleanContent
                .replace(/export\s+default\s+/, 'return ')
                .replace(/module\.exports\s*=\s*/, 'return ');

            const fn = new Function('module', 'exports', script);
            const exports = {};
            const module = { exports };
            const result = fn(module, exports);
            
            return result || module.exports || {};
        }
    } catch (error) {
        console.error(`[@cocreate/config] Failed to load configuration at ${filePath}:`, error.message);
        return {};
    }
}

/**
 * Writes or updates global settings on the user's host filesystem safely.
 * 
 * @param {string} filePath - Path to save the config.
 * @param {Object} content - The JSON payload to persist.
 */
async function saveConfig(filePath, content) {
    try {
        const targetPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
        const outputString = `export default ${JSON.stringify(content, null, 2)};\n`;
        fs.writeFileSync(targetPath, outputString, 'utf8');
    } catch (error) {
        console.error(`[@cocreate/config] Failed to save configuration at ${filePath}:`, error.message);
    }
}

// Register standard Node.js server/Deno adapter capabilities
registerAdapter({
    isBrowser: false,
    getLocalStorageItem: () => null,
    setLocalStorageItem: () => {},
    removeLocalStorageItem: () => {},
    clearLocalStorage: () => {},

    getGlobalConfig: async () => {
        const globalConfigPath = path.resolve(os.homedir(), 'CoCreate.config.js');
        return await loadConfig(globalConfigPath);
    },

    setGlobalConfig: async (config) => {
        const globalConfigPath = path.resolve(os.homedir(), 'CoCreate.config.js');
        await saveConfig(globalConfigPath, config);
    },

    getEnv: (key) => {
        return process.env[key] !== undefined ? process.env[key] : null;
    },

    setEnv: (key, value) => {
        process.env[key] = value;
    },

    removeEnv: (key) => {
        delete process.env[key];
    },

    getGitBranch,
    prompt: cliPrompt,
    loadConfig,
    saveConfig
});

export default configAPI;