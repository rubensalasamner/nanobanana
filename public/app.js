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

const qrImg = document.getElementById('qr');
const btnCopy = document.getElementById('btnCopy');
const btnOpen = document.getElementById('btnOpen');

// NEW: countdown overlay + spinner elements
const countdown = document.getElementById('countdown');
const applyText = document.getElementById('applyText');
const applySpinner = document.getElementById('applySpinner');

// ----- State -----
let stream = null;
let selectedPrompt = null;
let latestBlob = null; // downscaled upload
let latestShare = null; // { imageUrl, shareUrl, qrDataUrl }

// Hourly cleanup ping (hits Vercel serverless /api/cleanup)
setInterval(() => fetch('/api/cleanup').catch(() => {}), 60 * 60 * 1000);

// ----- Helpers -----
function onTap(el, handler) {
  let armed = false;
  el.addEventListener('pointerdown', () => (armed = true), { passive: true });
  el.addEventListener('pointercancel', () => (armed = false));
  el.addEventListener('pointerup', (e) => {
    if (!armed) return;
    armed = false;
    handler(e);
  });
  el.addEventListener('click', handler);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 3–2–1 countdown overlay
async function runCountdown(n = 3) {
  countdown.classList.remove('hidden');
  for (let i = n; i >= 1; i--) {
    countdown.textContent = i;
    await sleep(700);
  }
  countdown.textContent = '';
  await sleep(120);
  countdown.classList.add('hidden');
}

// ----- Camera controls -----
async function startCamera() {
  try {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    });
    video.srcObject = stream;

    // wait for dimensions
    await new Promise((res) => (video.onloadedmetadata = res));

    const stage = document.querySelector('.stage');
    const ar = video.videoWidth / video.videoHeight;
    if (Number.isFinite(ar) && ar > 0) {
      stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    }
    // responsive media
    video.style.width = '100%';
    canvas.style.width = '100%';
    photo.style.width = '100%';

    video.classList.remove('hidden');
    canvas.classList.add('hidden');
    photo.classList.add('hidden');
    btnSnap.disabled = false;
    btnRetake.classList.add('hidden');

    // Hide Start button after camera is running
    btnStart.classList.add('hidden');

    camStatus.textContent = 'Camera is running. Tap “Take picture”.';
  } catch (e) {
    camStatus.textContent = 'Camera error: ' + e.message;
  }
}

// Now async so we can await the countdown
async function takeSnapshot() {
  const vw = video.videoWidth,
    vh = video.videoHeight;
  if (!vw || !vh) {
    camStatus.textContent = 'Camera not ready yet…';
    return;
  }

  // NEW: 3–2–1 overlay before capture
  await runCountdown(3);

  // High-DPI preview
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);
  canvas.style.width = '100%';
  canvas.style.height = 'auto';

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.drawImage(video, 0, 0, vw, vh);

  // Downscale for upload
  const MAX = 1600; // long edge
  const scale = Math.min(1, MAX / Math.max(vw, vh));
  const upW = Math.round(vw * scale);
  const upH = Math.round(vh * scale);

  const tmp = document.createElement('canvas');
  tmp.width = upW;
  tmp.height = upH;
  tmp.getContext('2d').drawImage(video, 0, 0, upW, upH);
  tmp.toBlob(
    (b) => {
      latestBlob = b;
    },
    'image/jpeg',
    0.85
  );

  // Preview in UI
  photo.src = canvas.toDataURL('image/jpeg', 0.9);
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

// ----- Presets -----
function handlePresetTap(e) {
  const btn = e.target.closest('[data-prompt]');
  if (!btn) return;
  for (const el of grid.querySelectorAll('[data-prompt]')) el.style.outline = '';
  btn.style.outline = '3px solid var(--accent)';
  selectedPrompt = btn.dataset.prompt;
  btnApply.disabled = !latestBlob;
  apiStatus.textContent = 'Selected: ' + (selectedPrompt.split('\n')[0] || 'preset');
}

// ----- API calls -----
async function callImageEditAndShareAPI(imageBlob, prompt) {
  const form = new FormData();
  form.append('image', imageBlob, 'photo.jpg');
  form.append('prompt', prompt);
  const res = await fetch('/api/edit-and-share', { method: 'POST', body: form });
  if (!res.ok) throw new Error('API ' + res.status);
  return await res.json();
}

async function applyPreset() {
  if (!latestBlob || !selectedPrompt) {
    apiStatus.textContent = 'Take a picture and select a preset first.';
    return;
  }

  // NEW: spinner on button
  btnApply.disabled = true;
  applyText.textContent = 'Applying…';
  applySpinner.classList.remove('hidden');

  apiStatus.textContent = 'Applying preset…';
  try {
    const out = await callImageEditAndShareAPI(latestBlob, selectedPrompt);

    photo.src = out.imageUrl;
    latestShare = out;

    btnDownload.disabled = false;
    btnDownload.onclick = () => {
      const a = document.createElement('a');
      a.href = out.imageUrl;
      a.download = 'booth.webp';
      a.click();
    };

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
    // NEW: stop spinner
    applySpinner.classList.add('hidden');
    applyText.textContent = 'Apply preset';
    btnApply.disabled = false;
  }
}

// ----- Bind events -----
onTap(btnStart, startCamera);
onTap(btnSnap, takeSnapshot);
onTap(btnRetake, retake);
onTap(btnApply, applyPreset);
grid.addEventListener('pointerup', handlePresetTap);
grid.addEventListener('click', handlePresetTap);

// ----- Desktop shortcut -----
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (!btnSnap.disabled) takeSnapshot();
  }
});
