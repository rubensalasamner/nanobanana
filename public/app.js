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
const btnPrint = document.getElementById('btnPrint');
const grid = document.getElementById('presetGrid');

const qrImg = document.getElementById('qr');
const btnCopy = document.getElementById('btnCopy');
const btnOpen = document.getElementById('btnOpen');

// NEW: countdown overlay + spinner elements
const countdown = document.getElementById('countdown');
const applyText = document.getElementById('applyText');
const applySpinner = document.getElementById('applySpinner');

// ----- Wizard Flow -----
const stepScreensaver = document.getElementById('step-screensaver');
const stepWelcome = document.getElementById('step-welcome');
const stepCamera = document.getElementById('step-camera');
const screensaverVideo = document.getElementById('screensaver-video');
const btnStartHere = document.getElementById('btnStartHere');
const stepNav = document.getElementById('stepNav');
const stepStyle = document.getElementById('step-style');
const stepResult = document.getElementById('step-result');
const resultPhoto = document.getElementById('resultPhoto');
const btnChangeStyle = document.getElementById('btnChangeStyle');
const btnShareResult = document.getElementById('btnShareResult');
const btnPrintResult = document.getElementById('btnPrintResult');
const btnRestart = document.getElementById('btnRestart');
const printingMessage = document.getElementById('printingMessage');
const stepFooter = document.querySelector('.step-footer');
const styleTitle = document.querySelector('.style-title');

let currentStep = 'screensaver';
let idleTimer = null;
const IDLE_TIMEOUT = 60000; // 1 minute in milliseconds
let isTakingSnapshot = false; // Prevent auto-taking pictures

const wizardSteps = {
  screensaver: stepScreensaver,
  welcome: stepWelcome,
  camera: stepCamera,
  style: stepStyle,
  result: stepResult,
};

function showStep(stepName) {
  Object.values(wizardSteps).forEach((el) => el?.classList.remove('active'));

  if (wizardSteps[stepName]) {
    wizardSteps[stepName].classList.add('active');
    currentStep = stepName;
  }

  if (stepName === 'camera') {
    if (!stream) {
      startCamera();
    }
  }

  if (stepName === 'result' && resultPhoto && resultPhoto.src) {
    resultPhoto.classList.remove('hidden');
  }

  if (stepNav) {
    stepNav.querySelectorAll('[data-step]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.step === stepName);
    });
  }

  // Hide footer on screensaver step
  if (stepFooter) {
    if (stepName === 'screensaver') {
      stepFooter.classList.add('hidden');
    } else {
      stepFooter.classList.remove('hidden');
    }
  }

  // Reset idle timer when navigating
  resetIdleTimer();
}

// Idle timer functions
function resetIdleTimer() {
  // Clear existing timer
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  // Don't start timer if we're on screensaver
  if (currentStep === 'screensaver') {
    return;
  }

  // Set new timer to go back to screensaver after 1 minute of inactivity
  idleTimer = setTimeout(() => {
    showStep('screensaver');
    // Stop camera if running
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }, IDLE_TIMEOUT);
}

function handleUserActivity() {
  resetIdleTimer();
}

if (stepNav) {
  stepNav.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-step]');
    if (!btn) return;
    showStep(btn.dataset.step);
  });
}

// ----- State -----
let stream = null;
let selectedPrompt = null;
let latestBlob = null; // downscaled upload
let latestShare = null; // { imageUrl, shareUrl, qrDataUrl }
let isApplying = false;
let styleStepTimeout = null;

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

// Screensaver tap to go to welcome
if (stepScreensaver) {
  onTap(stepScreensaver, () => {
    if (currentStep === 'screensaver') {
      showStep('welcome');
    }
  });
}

// Welcome button to go to camera
if (btnStartHere) {
  onTap(btnStartHere, () => {
    showStep('camera');
  });
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
    // Reset snapshot flag when starting camera
    isTakingSnapshot = false;

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

    const stage = document.querySelector('.camera-card .stage') || document.querySelector('.stage');
    const ar = video.videoWidth / video.videoHeight;
    if (Number.isFinite(ar) && ar > 0 && stage) {
      // Set aspect ratio to match actual camera dimensions
      stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
      stage.style.setProperty(
        'aspect-ratio',
        `${video.videoWidth} / ${video.videoHeight}`,
        'important'
      );
      // Now show the stage with correct aspect ratio
      stage.classList.remove('hidden');
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

    // Ensure snapshot flag is reset when camera is ready
    isTakingSnapshot = false;

    // Hide Start button after camera is running
    btnStart.classList.add('hidden');

    camStatus.textContent = 'Camera is running. Tap "Take picture".';
  } catch (e) {
    // Reset flag on error
    isTakingSnapshot = false;
    camStatus.textContent = 'Camera error: ' + e.message;
  }
}

// Now async so we can await the countdown
async function takeSnapshot() {
  // Prevent auto-taking pictures - only allow explicit button clicks
  if (isTakingSnapshot) {
    return;
  }

  // Additional safeguard: ensure button is not disabled (user must click)
  if (btnSnap && btnSnap.disabled) {
    return;
  }

  // Ensure we're on the camera step
  if (currentStep !== 'camera') {
    isTakingSnapshot = false; // Reset flag if not on camera step
    return;
  }

  const vw = video.videoWidth,
    vh = video.videoHeight;
  if (!vw || !vh) {
    camStatus.textContent = 'Camera not ready yet…';
    isTakingSnapshot = false; // Reset flag if camera not ready
    return;
  }

  // Set flag to prevent multiple calls
  isTakingSnapshot = true;

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

  // Reset flag after snapshot is complete
  isTakingSnapshot = false;

  if (styleStepTimeout) {
    clearTimeout(styleStepTimeout);
  }
  styleStepTimeout = setTimeout(() => {
    styleStepTimeout = null; // Clear before calling showStep so guard doesn't block
    showStep('style');
  }, 2000);
}

function retake() {
  // Reset snapshot flag when retaking
  isTakingSnapshot = false;

  photo.classList.add('hidden');
  video.classList.remove('hidden');
  btnApply.disabled = true;
  btnDownload.disabled = true;
  btnPrint.disabled = true;
  camStatus.textContent = 'Ready to retake.';
  latestBlob = null;
  latestShare = null;
  if (styleStepTimeout) {
    clearTimeout(styleStepTimeout);
    styleStepTimeout = null;
  }
  if (resultPhoto) {
    resultPhoto.classList.add('hidden');
    resultPhoto.removeAttribute('src');
  }
  updateResultButtons();
  showStep('camera');
}

function restartFlow() {
  selectedPrompt = null;
  latestShare = null;
  grid?.querySelectorAll('[data-prompt]').forEach((el) => (el.style.outline = ''));
  retake();
  showStep('welcome');
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

  if (latestBlob && !isApplying) {
    applyPreset();
  } else if (!latestBlob) {
    camStatus.textContent = 'Take a picture first.';
    showStep('camera');
  }
}

function updateResultButtons() {
  const hasResultImage = Boolean(resultPhoto?.src);
  const hasShareLink = Boolean(latestShare?.shareUrl);
  if (btnShareResult) btnShareResult.disabled = !hasShareLink;
  if (btnPrintResult) btnPrintResult.disabled = !hasResultImage;
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

  if (isApplying) return;
  isApplying = true;

  // Update title to show generating status
  if (styleTitle) {
    styleTitle.textContent = 'Generating Image...';
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
    if (resultPhoto) {
      resultPhoto.src = out.imageUrl;
      resultPhoto.classList.remove('hidden');
    }

    btnDownload.disabled = false;
    btnDownload.onclick = () => {
      const a = document.createElement('a');
      a.href = out.imageUrl;
      a.download = 'booth.webp';
      a.click();
    };

    btnPrint.disabled = false;
    btnPrint.onclick = () => {
      window.print();
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
    showStep('result');
    updateResultButtons();
  } catch (err) {
    apiStatus.textContent = 'Failed: ' + err.message + ' (check server logs)';
    // Restore title on error
    if (styleTitle) {
      styleTitle.textContent = 'Choose your style';
    }
  } finally {
    // NEW: stop spinner
    applySpinner.classList.add('hidden');
    applyText.textContent = 'Apply preset';
    btnApply.disabled = false;
    isApplying = false;
    // Restore title when done (if still on style step)
    if (styleTitle && currentStep === 'style') {
      styleTitle.textContent = 'Choose your style';
    }
  }
}

// ----- Bind events -----
onTap(btnStart, startCamera);
onTap(btnSnap, takeSnapshot);
onTap(btnRetake, retake);
onTap(btnApply, applyPreset);
if (grid) {
  grid.addEventListener('pointerup', handlePresetTap);
  grid.addEventListener('click', handlePresetTap);
}

if (btnChangeStyle) {
  onTap(btnChangeStyle, () => {
    // Restore title when navigating back to style step
    if (styleTitle) {
      styleTitle.textContent = 'Choose your style';
    }
    showStep('style');
  });
}
if (btnShareResult) {
  onTap(btnShareResult, () => {
    if (btnShareResult.disabled) return;
    if (latestShare?.shareUrl) {
      window.open(latestShare.shareUrl, '_blank', 'noopener');
    }
  });
}
if (btnPrintResult) {
  let isPrinting = false;
  // Use a single click handler instead of onTap to avoid double-firing
  // (onTap adds both pointerup and click handlers which can cause duplicate prints)
  btnPrintResult.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (btnPrintResult.disabled || isPrinting) return;

    // Prevent multiple print calls
    isPrinting = true;

    // Show printing message and grey out button
    if (printingMessage) {
      printingMessage.classList.remove('hidden');
    }
    btnPrintResult.disabled = true;
    btnPrintResult.style.opacity = '0.5';
    btnPrintResult.style.cursor = 'not-allowed';

    // Trigger print dialog
    window.print();

    // Hide printing message after print dialog closes (or after a delay)
    setTimeout(() => {
      if (printingMessage) {
        printingMessage.classList.add('hidden');
      }
      btnPrintResult.disabled = false;
      btnPrintResult.style.opacity = '';
      btnPrintResult.style.cursor = '';
      isPrinting = false;
    }, 2000);
  });
}
if (btnRestart) {
  onTap(btnRestart, restartFlow);
}

// ----- Desktop shortcut -----
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (!btnSnap.disabled) takeSnapshot();
  }
});

// Set up idle timer - listen for user activity
document.addEventListener('mousemove', handleUserActivity, { passive: true });
document.addEventListener('mousedown', handleUserActivity, { passive: true });
document.addEventListener('touchstart', handleUserActivity, { passive: true });
document.addEventListener('touchmove', handleUserActivity, { passive: true });
document.addEventListener('keydown', handleUserActivity, { passive: true });
document.addEventListener('click', handleUserActivity, { passive: true });

showStep(currentStep);
updateResultButtons();
