// ----- DOM -----
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const photo = document.getElementById('photo');
const camStatus = document.getElementById('camStatus');
const apiStatus = document.getElementById('apiStatus');

const btnStart = document.getElementById('btnStart');
const btnSnap = document.getElementById('btnSnap');
const btnRetake = document.getElementById('btnRetake');
const btnApply = document.getElementById('btnApply');
const btnDownload = document.getElementById('btnDownload');
const grid = document.getElementById('presetGrid');

// ----- State -----
let stream = null;
let selectedPrompt = null;
let latestBlob = null;

setInterval(() => fetch('/api/cleanup').catch(() => {}), 60 * 60 * 1000);

// ----- Helpers: onTap = works for touch + mouse + pen -----
function onTap(el, handler) {
  // guard against double firing
  let armed = false;
  el.addEventListener('pointerdown', () => (armed = true), { passive: true });
  el.addEventListener('pointercancel', () => (armed = false));
  el.addEventListener('pointerup', (e) => {
    if (!armed) return;
    armed = false;
    handler(e);
  });
  // fallback
  el.addEventListener('click', handler);
}

// ----- Camera controls -----
async function startCamera() {
  try {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: false,
    });
    video.srcObject = stream;
    video.classList.remove('hidden');
    canvas.classList.add('hidden');
    photo.classList.add('hidden');
    btnSnap.disabled = false;
    btnRetake.classList.add('hidden');
    camStatus.textContent = 'Camera is running. Tap “Take picture”.';
  } catch (e) {
    camStatus.textContent = 'Camera error: ' + e.message;
  }
}

function takeSnapshot() {
  const w = video.videoWidth,
    h = video.videoHeight;
  if (!w || !h) {
    camStatus.textContent = 'Camera not ready yet…';
    return;
  }
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, w, h);
  canvas.toBlob(
    (b) => {
      latestBlob = b;
    },
    'image/jpeg',
    0.95
  );
  photo.src = canvas.toDataURL('image/jpeg', 0.95);
  video.classList.add('hidden');
  canvas.classList.add('hidden');
  photo.classList.remove('hidden');
  btnRetake.classList.remove('hidden');
  btnApply.disabled = !selectedPrompt;
  camStatus.textContent = 'Snapshot captured.';
}

function retake() {
  photo.classList.add('hidden');
  video.classList.remove('hidden');
  btnApply.disabled = true;
  camStatus.textContent = 'Ready to retake.';
}

// ----- Presets (supports touch & click) -----
function handlePresetTap(e) {
  const btn = e.target.closest('[data-prompt]');
  if (!btn) return;
  for (const el of grid.querySelectorAll('[data-prompt]')) el.style.outline = '';
  btn.style.outline = '3px solid var(--accent)';
  selectedPrompt = btn.dataset.prompt;
  btnApply.disabled = !latestBlob;
  apiStatus.textContent = 'Selected: ' + selectedPrompt;
}

// ----- API call -----
async function callImageEditAPI(imageBlob, prompt) {
  const form = new FormData();
  form.append('image', imageBlob, 'photo.jpg');
  form.append('prompt', prompt);
  const res = await fetch('/api/edit', { method: 'POST', body: form });
  if (!res.ok) throw new Error('API ' + res.status);
  return await res.blob();
}

async function applyPreset() {
  if (!latestBlob || !selectedPrompt) {
    apiStatus.textContent = 'Take a picture and select a preset first.';
    return;
  }
  btnApply.disabled = true;
  apiStatus.textContent = 'Applying preset…';
  try {
    const out = await callImageEditAndShareAPI(latestBlob, selectedPrompt);
    // Show the edited image from the hosted URL (so QR is exactly the same asset)
    photo.src = out.imageUrl;

    latestShare = out;

    // Enable download of the exact hosted file
    btnDownload.disabled = false;
    btnDownload.onclick = () => {
      const a = document.createElement('a');
      a.href = out.imageUrl;
      a.download = 'booth.jpg';
      a.click();
    };

    // Show QR + link helpers
    qrImg.src = out.qrDataUrl;
    qrImg.classList.remove('hidden');

    btnOpen.href = out.shareUrl;
    btnOpen.classList.remove('hidden');

    btnCopy.classList.remove('hidden');
    btnCopy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(out.shareUrl);
        apiStatus.textContent = 'Link copied to clipboard.';
      } catch {
        apiStatus.textContent = 'Could not copy link.';
      }
    };

    apiStatus.textContent = 'Done. Scan the QR to open your photo.';
  } catch (err) {
    apiStatus.textContent = 'Failed: ' + err.message + ' (check server logs)';
  } finally {
    btnApply.disabled = false;
  }
}

async function callImageEditAndShareAPI(imageBlob, prompt) {
  const form = new FormData();
  form.append('image', imageBlob, 'photo.jpg');
  form.append('prompt', prompt);
  const res = await fetch('/api/edit-and-share', { method: 'POST', body: form });
  if (!res.ok) throw new Error('API ' + res.status);
  return await res.json();
}

// ----- Bind events (touch + click) -----
onTap(btnStart, startCamera);
onTap(btnSnap, takeSnapshot);
onTap(btnRetake, retake);
onTap(btnApply, applyPreset);
grid.addEventListener('pointerup', handlePresetTap);
grid.addEventListener('click', handlePresetTap); // fallback

// ----- Desktop testing shortcuts (optional) -----
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (!btnSnap.disabled) takeSnapshot();
  }
});

const qrImg = document.getElementById('qr');
const btnCopy = document.getElementById('btnCopy');
const btnOpen = document.getElementById('btnOpen');

let latestShare = null; // { imageUrl, shareUrl, qrDataUrl }
