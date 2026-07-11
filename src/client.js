import localStorage from '@cocreate/local-storage'

// Function to get a value by key from localStorage or cookies
function get(key) {
    if (window.CoCreateConfig && window.CoCreateConfig[key])
        return window.CoCreateConfig[key]

    // try localStorage first
    let value = localStorage.getItem(key)
    if (value !== null && value !== undefined) return value

    // fallback to cookie for server-read or legacy support
    const cookies = (typeof document !== 'undefined' && document.cookie) ? document.cookie.split('; ') : [];
    for (const cookie of cookies) {
        const [cookieName, cookieValue] = cookie.split('=');
        if (cookieName === key) {
            // treat empty value as not present
            if (!cookieValue || cookieValue === '') return null;
            return decodeURIComponent(cookieValue || '');
        }
    }
    return null
}

// Function to set a key-value pair in localStorage or cookies
function set(key, value) {
    if (!window.CoCreateConfig)
        window.CoCreateConfig = { [key]: value }
    else
        window.CoCreateConfig[key] = value
    localStorage.setItem(key, value)
    // also set cookie for server-read or legacy support
    try {
        let cookie = key + "=" + encodeURIComponent(value) + "; path=/; SameSite=Lax";
        if (typeof window !== "undefined" && window.location && window.location.protocol === "https:") {
            cookie += "; Secure";
        }
        document.cookie = cookie;
    } catch (e) {
        // ignore if document not available (e.g., SSR)
    }
}

// Function to delete a key-value pair from localStorage or cookies
function remove(key) {
    // remove from in-memory config if present
    if (window.CoCreateConfig) delete window.CoCreateConfig[key]
    // remove from localStorage
    localStorage.removeItem(key)
    // remove cookie as well
    try {
        const secure = (typeof window !== "undefined" && window.location && window.location.protocol === "https:") ? "; Secure" : "";
        // overwrite with empty value first
        document.cookie = key + "=; path=/; SameSite=Lax" + secure;
        // then expire using Max-Age=0 for reliable deletion
        document.cookie = key + "=; Max-Age=0; path=/; SameSite=Lax" + secure;
    } catch (e) {}
}

export default { get, set, remove }