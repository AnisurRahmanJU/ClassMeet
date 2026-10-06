
(function () {
  // ⚠️ Replace with your own OAuth 2.0 Client ID if this is a different domain
  // than your other apps — each Client ID's "Authorized JavaScript origins"
  // must include the exact https:// URL this page is served from.
  const GOOGLE_CLIENT_ID = "67521400455-0bt9eptaruohutmhnmlo4mpbm4lj6dqt.apps.googleusercontent.com";

  // ─── Host whitelist ───────────────────────────────────────────────────
  // Only these email addresses are allowed to START (host) a class.
  // Anyone can still JOIN a class with a Meeting ID + password.
  // There is no backend/database here, so this list is hardcoded — to
  // add or remove a host, edit this array and redeploy the file.
  const HOST_EMAILS = [
    "poetanis@gmail.com",
    "co-teacher@gmail.com"
  ];

  const STORAGE_KEY = 'cm_user';
  let currentUser = null;
  let jitsiApi = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordStream = null;

  function getStoredUser() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function setStoredUser(u) { localStorage.setItem(STORAGE_KEY, JSON.stringify(u)); }
  function clearStoredUser() { localStorage.removeItem(STORAGE_KEY); }

  function parseJwt(token) {
    try {
      const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(atob(base64).split('').map(c =>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      return JSON.parse(json);
    } catch (e) { return null; }
  }

  function isHostEmail(email) {
    return HOST_EMAILS.map(e => e.toLowerCase()).includes((email || '').toLowerCase());
  }

  function updateAuthUI() {
    currentUser = getStoredUser();
    const loginBtn = document.getElementById('login-btn');
    const userChip = document.getElementById('user-chip');
    const gateMsg = document.getElementById('gate-msg');
    const dashContent = document.getElementById('dashboard-content');
    const notHostNote = document.getElementById('not-host-note');
    const hostBtn = document.getElementById('host-btn');

    if (currentUser) {
      loginBtn.style.display = 'none';
      userChip.style.display = 'flex';
      document.getElementById('user-avatar').src = currentUser.picture || '';
      document.getElementById('user-name').textContent = currentUser.name || currentUser.email;
      gateMsg.classList.add('hidden');
      dashContent.classList.remove('hidden');
      document.getElementById('join-name-input').value = currentUser.name || '';

      if (isHostEmail(currentUser.email)) {
        notHostNote.classList.add('hidden');
        hostBtn.disabled = false;
      } else {
        notHostNote.classList.remove('hidden');
        hostBtn.disabled = true;
      }
    } else {
      loginBtn.style.display = 'inline-flex';
      userChip.style.display = 'none';
      gateMsg.classList.remove('hidden');
      dashContent.classList.add('hidden');
    }
  }

  function openLoginModal() {
    document.getElementById('login-modal-overlay').style.display = 'flex';
    try {
      if (window.google && google.accounts && google.accounts.id) {
        const c = document.getElementById('g_id_signin_container');
        c.innerHTML = '';
        google.accounts.id.renderButton(c, { theme: 'filled_blue', size: 'large', shape: 'pill' });
        google.accounts.id.prompt();
      }
    } catch (e) { console.error(e); }
  }

  function handleCredentialResponse(response) {
    const payload = parseJwt(response.credential);
    if (!payload) return;
    setStoredUser({ name: payload.name, email: payload.email, picture: payload.picture });
    document.getElementById('login-modal-overlay').style.display = 'none';
    updateAuthUI();
  }
  window.handleCredentialResponse = handleCredentialResponse;

  function initGoogle() {
    if (window.google && google.accounts && google.accounts.id) {
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true
      });
      return true;
    }
    return false;
  }
  function waitForGoogle(retries) {
    if (initGoogle()) return;
    if (retries <= 0) return;
    setTimeout(() => waitForGoogle(retries - 1), 150);
  }

  // ─── Meeting ID / password helpers ────────────────────────────────────
  function randomId(len, digitsOnly) {
    const chars = digitsOnly ? '0123456789' : 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  // The actual Jitsi room name is derived from BOTH the Meeting ID and the
  // password. This way, nobody can join just by guessing the ID — without
  // the exact password too, they land in a different (empty) room. No
  // database needed to "check" the password; a wrong one simply never
  // reaches the same room as everyone else.
  function roomNameFor(meetingId, password) {
    return 'classmeet-' + meetingId + '-' + password;
  }

  // ─── Recording (captures the shared tab/screen, not just the webcam) ──
  async function startRecording() {
    try {
      recordStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 }, audio: true
      });
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(recordStream, { mimeType: 'video/webm;codecs=vp9,opus' });
      mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorder.start(1000);
      document.getElementById('rec-dot').style.display = 'inline-block';
      // If the user stops sharing from the browser's own UI, finish gracefully.
      recordStream.getVideoTracks()[0].addEventListener('ended', downloadRecording);
    } catch (e) {
      console.warn('Recording not started (user may have cancelled the screen-share prompt):', e);
    }
  }

  function downloadRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    if (recordStream) recordStream.getTracks().forEach(t => t.stop());
    document.getElementById('rec-dot').style.display = 'none';

    setTimeout(() => {
      if (!recordedChunks.length) return;
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      a.href = url;
      a.download = `class-recording-${ts}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      recordedChunks = [];
    }, 300);
  }

  // ─── Launch a Jitsi call ───────────────────────────────────────────────
  function launchCall(roomName, displayName, label) {
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('topbar').style.display = 'none';
    document.getElementById('call-screen').style.display = 'flex';
    document.getElementById('call-label').textContent = label;

    jitsiApi = new JitsiMeetExternalAPI('meet.jit.si', {
      roomName: roomName,
      parentNode: document.getElementById('jitsi-container'),
      width: '100%',
      height: '100%',
      userInfo: { displayName: displayName || 'Guest' },
      configOverwrite: { prejoinPageEnabled: true },
      interfaceConfigOverwrite: { SHOW_JITSI_WATERMARK: false }
    });

    // Kick off tab/screen recording once the person actually joins.
    jitsiApi.addEventListener('videoConferenceJoined', startRecording);
    jitsiApi.addEventListener('readyToClose', leaveCall);
  }

  function leaveCall() {
    downloadRecording();
    if (jitsiApi) { jitsiApi.dispose(); jitsiApi = null; }
    document.getElementById('jitsi-container').innerHTML = '';
    document.getElementById('call-screen').style.display = 'none';
    document.getElementById('topbar').style.display = 'flex';
    document.getElementById('dashboard').style.display = 'block';
  }

  window.addEventListener('load', function () {
    updateAuthUI();
    waitForGoogle(40);

    document.getElementById('login-btn').addEventListener('click', openLoginModal);
    document.getElementById('login-modal-overlay').addEventListener('click', function (e) {
      if (e.target === this) this.style.display = 'none';
    });
    document.getElementById('logout-btn').addEventListener('click', function () {
      if (!confirm('Do you want to logout?')) return;
      clearStoredUser();
      updateAuthUI();
      if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    });

    // Host a class
    document.getElementById('host-btn').addEventListener('click', function () {
      if (!currentUser || !isHostEmail(currentUser.email)) return;
      const className = document.getElementById('class-name-input').value.trim() || 'Class';
      const meetingId = randomId(6, true);
      const password = randomId(6, false);

      document.getElementById('mc-id').textContent = meetingId;
      document.getElementById('mc-pass').textContent = password;
      document.getElementById('meeting-created').style.display = 'block';

      launchCall(roomNameFor(meetingId, password), currentUser.name, className + ' — hosted by ' + currentUser.name);
    });

    document.getElementById('mc-copy-btn').addEventListener('click', function () {
      const id = document.getElementById('mc-id').textContent;
      const pass = document.getElementById('mc-pass').textContent;
      const text = `Join my class on ClassMeet\nMeeting ID: ${id}\nPassword: ${pass}`;
      navigator.clipboard.writeText(text).then(() => {
        this.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
        setTimeout(() => { this.innerHTML = '<i class="fa-solid fa-copy"></i> Copy details to share with students'; }, 1800);
      });
    });

    // Join a class
    document.getElementById('join-btn').addEventListener('click', function () {
      const id = document.getElementById('join-id-input').value.trim();
      const pass = document.getElementById('join-pass-input').value.trim();
      const name = document.getElementById('join-name-input').value.trim() || 'Guest';
      if (!id || !pass) { alert('Please enter both the Meeting ID and password.'); return; }
      launchCall(roomNameFor(id, pass), name, 'Class ' + id);
    });

    document.getElementById('leave-btn').addEventListener('click', function () {
      if (confirm('Leave the class? Your recording will be downloaded automatically.')) leaveCall();
    });
  });
})();
