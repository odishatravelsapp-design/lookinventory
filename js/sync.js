// Google Drive backup using Google Identity Services (token model) + Drive REST API.
// Free: uses the shop owner's own 15 GB Drive. The backup file is kept in the app's
// private "appDataFolder", so it never clutters the user's Drive.
//
// Requires a free Google OAuth Client ID (set in Settings). See README for setup.
const Sync = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const FILE_NAME = 'look-inventory-backup.json';
  let tokenClient = null;
  let accessToken = null;
  let gisLoaded = false;

  function loadGis() {
    if (gisLoaded) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = () => { gisLoaded = true; resolve(); };
      s.onerror = () => reject(new Error('No internet — Google sign-in needs a connection.'));
      document.head.appendChild(s);
    });
  }

  async function signIn(clientId) {
    if (!clientId) throw new Error('Enter your Google Client ID first.');
    await loadGis();
    return new Promise((resolve, reject) => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: (resp) => {
          if (resp && resp.access_token) {
            accessToken = resp.access_token;
            resolve(true);
          } else {
            reject(new Error('Sign-in failed.'));
          }
        }
      });
      tokenClient.requestAccessToken({ prompt: 'consent' });
    });
  }

  function isSignedIn() { return !!accessToken; }

  async function findBackupFileId() {
    const url = 'https://www.googleapis.com/drive/v3/files'
      + '?spaces=appDataFolder&fields=files(id,name,modifiedTime)'
      + '&q=' + encodeURIComponent("name='" + FILE_NAME + "'");
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!res.ok) throw new Error('Drive read failed (' + res.status + ').');
    const data = await res.json();
    return data.files && data.files.length ? data.files[0].id : null;
  }

  async function backup(payload) {
    if (!accessToken) throw new Error('Sign in first.');
    const fileId = await findBackupFileId();
    const metadata = fileId ? {} : { name: FILE_NAME, parents: ['appDataFolder'] };
    const boundary = 'bk' + Math.random().toString(36).slice(2);
    const body =
      '--' + boundary + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Type: application/json\r\n\r\n' +
      JSON.stringify(payload) + '\r\n' +
      '--' + boundary + '--';

    const url = fileId
      ? 'https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=multipart'
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    const res = await fetch(url, {
      method: fileId ? 'PATCH' : 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'multipart/related; boundary=' + boundary
      },
      body
    });
    if (!res.ok) throw new Error('Backup failed (' + res.status + ').');
    return true;
  }

  async function restore() {
    if (!accessToken) throw new Error('Sign in first.');
    const fileId = await findBackupFileId();
    if (!fileId) return null;
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media',
      { headers: { Authorization: 'Bearer ' + accessToken } }
    );
    if (!res.ok) throw new Error('Restore failed (' + res.status + ').');
    return res.json();
  }

  return { signIn, isSignedIn, backup, restore };
})();
