// Feature flags: CONFIG.flags are the defaults; a shopkeeper can override per-device.
// Flags.on('x') is the single source of truth used to gate UI + handlers.
const Flags = (() => {
  const defaults = (typeof CONFIG !== 'undefined' && CONFIG.flags) ? CONFIG.flags : {};
  let overrides = {};   // loaded from DB meta at startup

  function init(saved) { overrides = saved || {}; }
  function on(name) {
    if (overrides[name] != null) return !!overrides[name];
    return defaults[name] !== false;   // default ON unless explicitly disabled
  }
  function set(name, val) { overrides[name] = !!val; return overrides; }
  function all() {
    const keys = new Set([...Object.keys(defaults), ...Object.keys(overrides)]);
    const out = {};
    keys.forEach((k) => { out[k] = on(k); });
    return out;
  }
  return { init, on, set, all, get overrides() { return overrides; } };
})();
