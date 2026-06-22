// ====================================================================
//  APP CONFIG — the developer/owner fills this ONCE, before deploying.
//  After this is set, every shopkeeper just taps "Sign in with Google"
//  during setup — they never see a Client ID or any technical config.
// ====================================================================
const CONFIG = {
  // One-time Google OAuth Client ID for the whole app (free, 3-min setup — see README).
  // Paste it here once and re-deploy. Leave '' to fall back to manual entry in Settings.
  googleClientId: '',

  // OPTIONAL: bake in a Firebase project for live multi-device sync so shopkeepers
  // don't paste config. Leave null to keep Firebase off / manual. See README.
  firebase: null,   // e.g. { apiKey:'...', authDomain:'...', projectId:'...', appId:'...' }

  // ADMIN remote access control (kill switch). Host a small JSON you control at this URL.
  // Format: { "killAll": false, "blocked": ["<deviceId or shopCode>", ...], "message": "..." }
  // The app checks it when online and locks any blocked device. Leave '' to disable.
  // Each device's ID is shown in the app under More → About (give it to revoke that device).
  accessListUrl: '',

  // Feature flags — turn whole features on/off without touching code.
  // Defaults are all true. Shopkeepers can also toggle these in More → Features.
  flags: {
    billing: true,        // Bill tab + receipts
    reorder: true,        // To-Order list
    scan: true,           // camera barcode scanning
    voice: true,          // voice billing
    khata: true,          // credit ledger
    reports: true,        // sales reports
    purchases: true,      // purchases + suppliers
    labels: true,         // barcode label printing
    dayclose: true,       // day-close summary
    returns: true,        // returns / refunds
    splitPay: true,       // split payment
    parkBill: true,       // park / hold bills
    stockAdjust: true,    // stock adjustment log
    roles: true,          // owner / cashier roles
    gst: true,            // GST fields (HSN, CGST/SGST split)
    driveSync: true,      // Google Drive backup
    liveSync: true,       // Firebase live sync
    receivables: true,    // outstanding/aging + partial payments
    quotes: true,         // quotation → invoice
    statement: true,      // customer statement of account
    wholesale: true,      // tiered/wholesale pricing
    challan: true,        // delivery challan
    expenses: true,       // expense tracking + net P&L
    valuation: true,      // inventory valuation
    favourites: true,     // quick-sell favourites grid
    accessControl: true   // admin remote revoke / kill switch
  }
};
