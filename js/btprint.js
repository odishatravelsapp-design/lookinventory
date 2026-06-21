// Experimental: print to a cheap 58mm Bluetooth thermal printer via Web Bluetooth + ESC/POS.
// Web Bluetooth works in Chrome on Android over HTTPS. Printer support varies by model;
// this targets the common "printer service" UUIDs used by generic ESC/POS BLE printers.
const BTPrint = (() => {
  // Common GATT services exposed by generic thermal printers / serial bridges.
  const SERVICES = [
    0x18f0,                                   // many ESC/POS printers
    '0000ff00-0000-1000-8000-00805f9b34fb',   // FF00 serial
    '49535343-fe7d-4ae5-8fa9-9fafd205e455'     // Microchip/ISSC UART
  ];

  function isSupported() { return 'bluetooth' in navigator; }

  function encode(text) {
    // ESC/POS: init + text + cut/feed. Latin-only on most cheap printers, so transliterate-safe.
    const enc = new TextEncoder();
    const init = new Uint8Array([0x1b, 0x40]);           // ESC @ (reset)
    const body = enc.encode(text + '\n\n\n');
    const cut = new Uint8Array([0x1d, 0x56, 0x42, 0x00]); // partial cut (ignored if unsupported)
    const out = new Uint8Array(init.length + body.length + cut.length);
    out.set(init, 0); out.set(body, init.length); out.set(cut, init.length + body.length);
    return out;
  }

  async function findWritable(server, services) {
    for (const svcId of services) {
      try {
        const svc = await server.getPrimaryService(svcId);
        const chars = await svc.getCharacteristics();
        const w = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
        if (w) return w;
      } catch (_) { /* try next service */ }
    }
    return null;
  }

  async function print(text) {
    if (!isSupported()) throw new Error('This browser has no Bluetooth. Use Chrome on Android.');
    const device = await navigator.bluetooth.requestDevice({
      filters: SERVICES.map((s) => ({ services: [s] })).concat([{ namePrefix: 'Printer' }]),
      optionalServices: SERVICES
    });
    const server = await device.gatt.connect();
    const ch = await findWritable(server, SERVICES);
    if (!ch) { server.disconnect(); throw new Error('No printable characteristic found on this device.'); }

    const data = encode(text);
    // Send in <=180-byte chunks (BLE MTU limit).
    const CHUNK = 180;
    for (let i = 0; i < data.length; i += CHUNK) {
      const slice = data.slice(i, i + CHUNK);
      if (ch.properties.writeWithoutResponse) await ch.writeValueWithoutResponse(slice);
      else await ch.writeValue(slice);
      await new Promise((r) => setTimeout(r, 30));
    }
    setTimeout(() => server.disconnect(), 600);
    return true;
  }

  return { isSupported, print };
})();
