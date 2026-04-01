// ----- DOM -----
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const photo = document.getElementById('photo');
const camStatus = document.getElementById('camStatus');
const apiStatus = document.getElementById('apiStatus');

const btnStart = document.getElementById('btnStart');
const btnSnap = document.getElementById('btnSnap');
const btnSnapText = document.getElementById('btnSnapText');
const btnSnapSpinner = document.getElementById('btnSnapSpinner');
const btnRetake = document.getElementById('btnRetake');
const nativeCaptureInput = document.getElementById('nativeCaptureInput');
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
const stepShare = document.getElementById('step-share');
const resultPhoto = document.getElementById('resultPhoto');
const btnChangeStyle = document.getElementById('btnChangeStyle');
const btnShareResult = document.getElementById('btnShareResult');
const btnPrintResult = document.getElementById('btnPrintResult');
const btnRestart = document.getElementById('btnRestart');
const printingMessage = document.getElementById('printingMessage');
const stepFooter = document.querySelector('.step-footer');
const styleTitle = document.querySelector('.style-title');
const stylePreview = document.getElementById('stylePreview');
const shareQRCode = document.getElementById('shareQRCode');
const shareQrWrapper = document.getElementById('shareQrWrapper');
const shareInstruction = document.getElementById('shareInstruction');
const shareSocial = document.getElementById('shareSocial');
const btnNativeShare = document.getElementById('btnNativeShare');
const shareWhatsapp = document.getElementById('shareWhatsapp');
const shareFacebook = document.getElementById('shareFacebook');
const shareX = document.getElementById('shareX');
const shareLinkedIn = document.getElementById('shareLinkedIn');
const shareTelegram = document.getElementById('shareTelegram');
const shareEmail = document.getElementById('shareEmail');
const btnBackFromShare = document.getElementById('btnBackFromShare');

let currentStep = 'screensaver';
let idleTimer = null;
let idleTimeoutMs = 120000; // 2 minutes in milliseconds
let isTakingSnapshot = false; // Prevent auto-taking pictures
let styleStepClickBlocked = false; // Block clicks on style step immediately after navigation

// ----- Print/Download Toggle -----
// Set to true to download instead of print, false to use print dialog
const PRINT_BUTTON_DOWNLOADS = true;

const wizardSteps = {
  screensaver: stepScreensaver,
  welcome: stepWelcome,
  camera: stepCamera,
  style: stepStyle,
  result: stepResult,
  share: stepShare,
};

function showStep(stepName) {
  if (appMode === APP_MODES.MOBILE && (stepName === 'screensaver' || stepName === 'welcome')) {
    stepName = 'camera';
  }

  Object.values(wizardSteps).forEach((el) => el?.classList.remove('active'));

  if (wizardSteps[stepName]) {
    wizardSteps[stepName].classList.add('active');
    currentStep = stepName;
  }

  if (stepName === 'camera') {
    if (useNativeMobileCapture) {
      setupNativeMobileCameraStep();
    } else if (!stream) {
      startCamera();
    }
  }

  if (stepName === 'style') {
    // Ensure title shows "Choose your style" when navigating to style step
    if (styleTitle) {
      styleTitle.textContent = getStyleTitleDefaultText();
    }
    // Don't show cropped image preview
    if (stylePreview) {
      stylePreview.classList.add('hidden');
    }
    // Clear all style card selections and focus immediately
    if (grid) {
      grid.querySelectorAll('[data-prompt]').forEach((el) => {
        el.style.outline = '';
        el.blur(); // Remove focus to prevent focus outline
      });
    }
    // Block clicks for a short time after navigating to prevent accidental selection from previous button click
    styleStepClickBlocked = true;
    // Use requestAnimationFrame to ensure clearing happens after any potential style application
    requestAnimationFrame(() => {
      if (grid) {
        grid.querySelectorAll('[data-prompt]').forEach((el) => {
          el.style.outline = '';
          el.blur();
        });
      }
    });
    setTimeout(() => {
      styleStepClickBlocked = false;
    }, 300); // 300ms should be enough to prevent the click event from registering
  }

  if (stepName === 'result' && resultPhoto && resultPhoto.src) {
    resultPhoto.classList.remove('hidden');
  }

  if (stepName === 'share') {
    initShareStep();
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

  // Set new timer to go back to screensaver after inactivity timeout
  idleTimer = setTimeout(() => {
    showStep(modeStrategy.initialStep);
    // Stop camera if running
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }, idleTimeoutMs);
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
let nativeCapturePending = false;
const APP_MODES = Object.freeze({
  BOOTH: 'booth',
  MOBILE: 'mobile',
});
const COMPANY_IDS = Object.freeze({
  DEFAULT: 'default',
  BOLIDEN: 'boliden',
});

const BOLIDEN_SCENES = Object.freeze([
  {
    id: 'underground-drill',
    label: 'Underground drilling',
    ppeHint: 'Hard hat with mounted lamp, reflective yellow safety jacket, work gloves.',
  },
  {
    id: 'mine-inspection',
    label: 'Mine inspection',
    ppeHint: 'Safety helmet, reflective vest, protective eyewear, steel-toe workwear.',
  },
  {
    id: 'tunnel-shift',
    label: 'Tunnel shift',
    ppeHint: 'Helmet, high-visibility outerwear, utility belt, rugged boots.',
  },
  {
    id: 'site-overview',
    label: 'Site overview',
    ppeHint: 'Industrial PPE matching workers in the scene, keep high-visibility details.',
  },
]);

function resolveAppMode() {
  const mode = new URLSearchParams(window.location.search).get('mode');
  return mode === APP_MODES.MOBILE ? APP_MODES.MOBILE : APP_MODES.BOOTH;
}

function resolveCompany() {
  const company = new URLSearchParams(window.location.search).get('company');
  return company === COMPANY_IDS.BOLIDEN ? COMPANY_IDS.BOLIDEN : COMPANY_IDS.DEFAULT;
}

function getStyleTitleDefaultText() {
  return companyId === COMPANY_IDS.BOLIDEN ? 'Choose your Boliden scene' : 'Choose your style';
}

function shouldUseNativeMobileCapture() {
  if (appMode !== APP_MODES.MOBILE) return false;

  const uaDataMobile = navigator.userAgentData?.mobile === true;
  const ua = navigator.userAgent || '';
  const isHandheldUa = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const isDesktopUa = /Windows NT|Macintosh|X11|CrOS/i.test(ua);

  if (uaDataMobile) return true;
  if (isDesktopUa) return false;
  return isHandheldUa;
}

const MODE_STRATEGIES = Object.freeze({
  [APP_MODES.BOOTH]: {
    cameraConstraints: {
      facingMode: 'user',
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30, max: 30 },
    },
    enableKeyboardShortcuts: true,
    idleTimeoutMs: 120000,
    initialStep: 'screensaver',
    applyLayout() {
      document.body.dataset.mode = APP_MODES.BOOTH;
      if (btnPrintResult) btnPrintResult.textContent = 'Print';
    },
  },
  [APP_MODES.MOBILE]: {
    cameraConstraints: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 24, max: 30 },
    },
    enableKeyboardShortcuts: false,
    idleTimeoutMs: 300000,
    initialStep: 'camera',
    applyLayout() {
      document.body.dataset.mode = APP_MODES.MOBILE;
      if (btnPrintResult) {
        btnPrintResult.textContent = 'Download';
      }
    },
  },
});

const appMode = resolveAppMode();
const companyId = resolveCompany();
const modeStrategy = MODE_STRATEGIES[appMode];
idleTimeoutMs = modeStrategy.idleTimeoutMs;
const useNativeMobileCapture = shouldUseNativeMobileCapture();
let selectedSceneId = null;

function buildBolidenPrompt(scene) {
  return [
    'Use image 1 as the person source and image 2 as the background scene.',
    'Add the person from image 1 as a separate, full-body subject placed naturally into image 2 with realistic scale, perspective, and lighting.',
    'Preserve the person identity and face from image 1 on the inserted subject.',
    `Match PPE and outfit to the work context. ${scene.ppeHint}`,
    'Keep existing people already present in image 2 unchanged.',
    'Add only the person from image 1 as the new inserted subject.',
    'The inserted person from image 1 must be clearly visible in the final image.',
    'Do not replace, edit, or swap any existing face or head in image 2.',
    'No face swap. No head replacement.',
    'No text or watermark.',
  ].join(' ');
}

function applyCompanyExperience() {
  document.body.dataset.company = companyId;

  if (companyId !== COMPANY_IDS.BOLIDEN || !grid) return;

  const cards = Array.from(grid.querySelectorAll('[data-prompt]'));
  const brandEls = document.querySelectorAll('.camera-brand, .share-brand');

  brandEls.forEach((el) => {
    el.textContent = 'Boliden';
  });

  if (styleTitle) styleTitle.textContent = getStyleTitleDefaultText();
  if (apiStatus) apiStatus.textContent = 'Take a full-body photo, then choose a Boliden scene.';

  cards.forEach((card, index) => {
    const scene = BOLIDEN_SCENES[index];
    if (!scene) {
      card.classList.add('hidden');
      card.disabled = true;
      card.removeAttribute('data-scene-id');
      return;
    }
    card.classList.remove('hidden');
    card.disabled = false;
    card.textContent = scene.label;
    card.dataset.prompt = buildBolidenPrompt(scene);
    card.dataset.sceneId = scene.id;
  });
}

// Hourly cleanup ping (hits Vercel serverless /api/cleanup)
setInterval(() => fetch('/api/cleanup').catch(() => {}), 60 * 60 * 1000);

// ----- Helpers -----
/**
 * Fit image to target aspect ratio with padding instead of cropping
 * @param {HTMLImageElement | HTMLVideoElement} image - Source image or video element
 * @param {number} targetW - Target width
 * @param {number} targetH - Target height
 * @returns {string} - Base64 data URL of fitted image
 */
function cropToAspectRatio(image, targetW, targetH) {
  const inputW = image.videoWidth || image.width;
  const inputH = image.videoHeight || image.height;
  const inputRatio = inputW / inputH;
  const targetRatio = targetW / targetH;

  // Calculate scale to fit entire image within target dimensions
  let scale, drawW, drawH, offsetX, offsetY;

  if (inputRatio > targetRatio) {
    // Input is wider → fit to width, add padding top/bottom
    scale = targetW / inputW;
    drawW = targetW;
    drawH = inputH * scale;
    offsetX = 0;
    offsetY = (targetH - drawH) / 2;
  } else {
    // Input is taller → fit to height, add padding left/right
    scale = targetH / inputH;
    drawW = inputW * scale;
    drawH = targetH;
    offsetX = (targetW - drawW) / 2;
    offsetY = 0;
  }

  // Draw into canvas with padding
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');

  // Fill with white background (or black if you prefer)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetW, targetH);

  // Draw the scaled image centered
  ctx.drawImage(image, offsetX, offsetY, drawW, drawH);

  return canvas.toDataURL('image/jpeg', 0.9);
}

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

function toBlobAsync(canvasEl, mimeType, quality) {
  return new Promise((resolve) => {
    canvasEl.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

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

    // Disable button and show spinner while loading
    if (btnSnap) {
      btnSnap.disabled = true;
    }
    if (btnSnapSpinner) {
      btnSnapSpinner.classList.remove('hidden');
    }
    if (btnSnapText) {
      btnSnapText.textContent = 'Loading camera...';
    }

    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      video: modeStrategy.cameraConstraints,
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

    // Hide spinner and enable button when camera is ready
    if (btnSnapSpinner) {
      btnSnapSpinner.classList.add('hidden');
    }
    if (btnSnapText) {
      btnSnapText.textContent = 'Take picture';
    }
    if (btnSnap) {
      btnSnap.disabled = false;
    }
    btnRetake.classList.add('hidden');

    // Ensure snapshot flag is reset when camera is ready
    isTakingSnapshot = false;

    // Hide Start button after camera is running
    btnStart.classList.add('hidden');

    camStatus.textContent = 'Camera is running. Tap "Take picture".';
  } catch (e) {
    // Reset flag on error
    isTakingSnapshot = false;
    // Hide spinner on error
    if (btnSnapSpinner) {
      btnSnapSpinner.classList.add('hidden');
    }
    if (btnSnapText) {
      btnSnapText.textContent = 'Retry camera';
    }
    // Keep button enabled so user can retry by tapping "Take picture"
    if (btnSnap) {
      btnSnap.disabled = false;
    }
    camStatus.textContent = 'Camera error: ' + e.message;
  }
}

function setupNativeMobileCameraStep() {
  if (video) video.classList.add('hidden');
  if (canvas) canvas.classList.add('hidden');
  if (!photo?.src) {
    photo.classList.add('hidden');
  }
  if (btnSnapSpinner) btnSnapSpinner.classList.add('hidden');
  if (btnSnapText) btnSnapText.textContent = 'Take picture';
  if (btnSnap) btnSnap.disabled = false;
  if (!latestBlob) {
    camStatus.textContent = 'Use your phone camera and confirm the photo.';
  }
}

async function handleNativeCaptureChange(event) {
  nativeCapturePending = false;
  const file = event.target?.files?.[0];
  if (!file) {
    camStatus.textContent = 'No image selected.';
    isTakingSnapshot = false;
    return;
  }

  try {
    const objectUrl = URL.createObjectURL(file);
    const sourceImg = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = objectUrl;
    });

    photo.src = objectUrl;
    photo.classList.remove('hidden');
    video.classList.add('hidden');
    canvas.classList.add('hidden');

    if (stylePreview) {
      stylePreview.src = objectUrl;
    }

    const MAX = 1600;
    const sourceW = sourceImg.width;
    const sourceH = sourceImg.height;
    const longEdge = Math.max(sourceW, sourceH);
    const scale = Math.min(1, MAX / longEdge);
    const upW = Math.round(sourceW * scale);
    const upH = Math.round(sourceH * scale);
    const tmp = document.createElement('canvas');
    tmp.width = upW;
    tmp.height = upH;
    const tmpCtx = tmp.getContext('2d');
    tmpCtx.drawImage(sourceImg, 0, 0, upW, upH);
    latestBlob = await toBlobAsync(tmp, 'image/jpeg', 0.85);

    btnRetake.classList.remove('hidden');
    btnApply.disabled = !selectedPrompt;
    camStatus.textContent = 'Snapshot captured.';

    if (styleStepTimeout) clearTimeout(styleStepTimeout);
    styleStepTimeout = setTimeout(() => {
      styleStepTimeout = null;
      showStep('style');
    }, 600);
  } catch (err) {
    camStatus.textContent = 'Could not process captured image.';
    console.error('Native capture processing failed:', err);
  } finally {
    isTakingSnapshot = false;
    if (nativeCaptureInput) nativeCaptureInput.value = '';
  }
}

// Now async so we can await the countdown
async function takeSnapshot() {
  if (useNativeMobileCapture) {
    if (!nativeCaptureInput) {
      camStatus.textContent = 'Camera input unavailable.';
      return;
    }
    if (nativeCapturePending) {
      return;
    }
    nativeCapturePending = true;
    nativeCaptureInput.value = '';
    nativeCaptureInput.click();
    return;
  }

  // Prevent auto-taking pictures - only allow explicit button clicks
  if (isTakingSnapshot) {
    return;
  }

  // Ensure we're on the camera step
  if (currentStep !== 'camera') {
    isTakingSnapshot = false; // Reset flag if not on camera step
    return;
  }

  // Recover if stream is missing (e.g., permission hiccup or previous init error)
  if (!stream) {
    await startCamera();
    if (!stream) {
      camStatus.textContent = 'Camera is not available. Check camera permissions and retry.';
      isTakingSnapshot = false;
      return;
    }
  }

  let vw = video.videoWidth,
    vh = video.videoHeight;
  if (!vw || !vh) {
    // One retry pass: metadata can lag on some devices even with active stream
    await new Promise((resolve) => setTimeout(resolve, 150));
    vw = video.videoWidth;
    vh = video.videoHeight;
    if (!vw || !vh) {
      camStatus.textContent = 'Camera not ready yet. Tap again in a moment.';
      isTakingSnapshot = false;
      return;
    }
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

  // Show the original photo (not cropped) in the camera step
  photo.src = canvas.toDataURL('image/jpeg', 0.9);
  video.classList.add('hidden');
  canvas.classList.add('hidden');
  photo.classList.remove('hidden');

  // Crop to 1:1 square aspect ratio for API in the background
  // Use a reasonable size for cropping, then downscale for upload
  const cropTargetW = 1800; // Target width for 1:1 ratio
  const cropTargetH = 1800; // Target height for 1:1 ratio
  const croppedDataUrl = cropToAspectRatio(video, cropTargetW, cropTargetH);

  // Downscale cropped image for upload
  const MAX = 1600; // long edge
  const scale = Math.min(1, MAX / cropTargetW); // cropTargetW is the longer edge for 1:1
  const upW = Math.round(cropTargetW * scale);
  const upH = Math.round(cropTargetH * scale);

  // Convert cropped data URL to blob for upload (in background)
  const croppedImg = new Image();
  croppedImg.onload = () => {
    const tmp = document.createElement('canvas');
    tmp.width = upW;
    tmp.height = upH;
    const tmpCtx = tmp.getContext('2d');
    tmpCtx.drawImage(croppedImg, 0, 0, upW, upH);
    tmp.toBlob(
      (b) => {
        latestBlob = b;
      },
      'image/jpeg',
      0.85
    );
  };
  croppedImg.src = croppedDataUrl;

  // Store cropped image for style step preview (but don't show it)
  if (stylePreview) {
    stylePreview.src = croppedDataUrl;
  }
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
  selectedSceneId = null;
  // Hide style preview when retaking
  if (stylePreview) {
    stylePreview.classList.add('hidden');
    stylePreview.removeAttribute('src');
  }
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
  selectedSceneId = null;
  latestShare = null;
  grid?.querySelectorAll('[data-prompt]').forEach((el) => (el.style.outline = ''));
  retake();
  showStep('welcome');
}

// ----- Presets -----
function handlePresetTap(e) {
  // Block clicks immediately after navigating to style step (prevents accidental selection from change style button click)
  if (styleStepClickBlocked) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    // Clear any visual state that might have been set
    const btn = e.target.closest('[data-prompt]');
    if (btn) {
      btn.style.outline = '';
      btn.blur();
    }
    return;
  }

  const btn = e.target.closest('[data-prompt]');
  if (!btn) return;

  // Don't allow clicking if already applying or if button is disabled
  if (isApplying || btn.disabled) return;

  for (const el of grid.querySelectorAll('[data-prompt]')) el.style.outline = '';
  btn.style.outline = '3px solid var(--accent)';
  selectedPrompt = btn.dataset.prompt;
  selectedSceneId = btn.dataset.sceneId || null;
  btnApply.disabled = !latestBlob;
  apiStatus.textContent = 'Selected: ' + (btn.textContent.trim() || 'preset');

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
function createEditAndShareFormData(imageBlob, prompt, sceneId) {
  const form = new FormData();
  form.append('image', imageBlob, 'photo.jpg');
  form.append('prompt', prompt);
  form.append('mode', appMode);
  form.append('company', companyId);
  if (sceneId) form.append('sceneId', sceneId);
  return form;
}

async function callImageEditAndShareAPI(imageBlob, prompt, sceneId) {
  const form = createEditAndShareFormData(imageBlob, prompt, sceneId);
  const res = await fetch('/api/edit-and-share', { method: 'POST', body: form });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    const error = new Error(errorData.error || `API error ${res.status}: ${res.statusText}`);
    error.status = res.status; // Attach status code to error for handling
    error.statusCode = res.status; // Also add statusCode as backup
    console.log('API error:', res.status, errorData);
    throw error;
  }
  return await res.json();
}

function setStyleTitleGenerating(isGenerating) {
  if (!styleTitle) return;
  styleTitle.textContent = isGenerating ? 'Generating Image...' : getStyleTitleDefaultText();
}

function setApplyButtonLoading(isLoading) {
  btnApply.disabled = isLoading;
  applyText.textContent = isLoading ? 'Applying…' : 'Apply preset';
  applySpinner.classList.toggle('hidden', !isLoading);
}

function getSelectedStyleCard(prompt) {
  if (!grid || !prompt) return null;
  return grid.querySelector(`[data-prompt="${CSS.escape(prompt)}"]`);
}

function setStyleCardLoading(prompt, isLoading) {
  const card = getSelectedStyleCard(prompt);
  if (!card) return;
  if (!card.dataset.originalText) {
    card.dataset.originalText = card.textContent.trim();
  }
  card.innerHTML = isLoading ? '<span class="style-card-spinner"></span>' : card.dataset.originalText;
  card.disabled = isLoading;
}

function restoreStyleCards() {
  if (!grid) return;
  for (const card of grid.querySelectorAll('[data-prompt]')) {
    if (card.dataset.originalText) {
      card.innerHTML = card.dataset.originalText;
    }
    card.disabled = false;
  }
}

function attachResultActions(out) {
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

  if (out.qrDataUrl) {
    qrImg.src = out.qrDataUrl;
    qrImg.classList.remove('hidden');
  } else {
    qrImg.removeAttribute('src');
    qrImg.classList.add('hidden');
  }

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
}

function buildSocialShareTargets(shareUrl) {
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedText = encodeURIComponent('Check out my Nano Banana image');
  return {
    whatsapp: `https://wa.me/?text=${encodedText}%20${encodedUrl}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    x: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    telegram: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`,
    email: `mailto:?subject=${encodeURIComponent('My Nano Banana image')}&body=${encodedText}%0A%0A${encodedUrl}`,
  };
}

function setupMobileShareActions(shareUrl) {
  const targets = buildSocialShareTargets(shareUrl);
  if (shareWhatsapp) shareWhatsapp.href = targets.whatsapp;
  if (shareFacebook) shareFacebook.href = targets.facebook;
  if (shareX) shareX.href = targets.x;
  if (shareLinkedIn) shareLinkedIn.href = targets.linkedin;
  if (shareTelegram) shareTelegram.href = targets.telegram;
  if (shareEmail) shareEmail.href = targets.email;

  if (!btnNativeShare) return;
  if (typeof navigator.share === 'function') {
    btnNativeShare.classList.remove('hidden');
    btnNativeShare.onclick = async () => {
      try {
        await navigator.share({
          title: 'Nano Banana image',
          text: 'Check out my Nano Banana image',
          url: shareUrl,
        });
      } catch {
        // Swallow cancellation/errors; user can still use social links.
      }
    };
  } else {
    btnNativeShare.classList.add('hidden');
    btnNativeShare.onclick = null;
  }
}

function renderApplySuccess(out) {
  photo.src = out.imageUrl;
  latestShare = out;
  if (resultPhoto) {
    resultPhoto.src = out.imageUrl;
    resultPhoto.classList.remove('hidden');
  }
  attachResultActions(out);
  apiStatus.textContent = appMode === APP_MODES.MOBILE ? 'Done. Your image is ready.' : 'Done. Scan the QR to open your photo.';
  showStep('result');
  updateResultButtons();
}

function isUnprocessableEntityError(err) {
  return err.status || err.statusCode || (err.message && err.message.match(/422/) ? 422 : null);
}

function handleApplyError(err, promptAtStart) {
  const status = isUnprocessableEntityError(err);
  if (status === 422) {
    latestBlob = null;
    latestShare = null;
    selectedPrompt = null;
    selectedSceneId = null;
    if (promptAtStart) {
      setStyleCardLoading(promptAtStart, false);
    }
    setStyleTitleGenerating(false);
    setApplyButtonLoading(false);
    showStep('welcome');
    return true;
  }

  apiStatus.textContent = 'Failed: ' + err.message + ' (check server logs)';
  setStyleTitleGenerating(false);
  if (selectedPrompt) {
    setStyleCardLoading(selectedPrompt, false);
  }
  return false;
}

async function applyPreset() {
  if (!latestBlob || !selectedPrompt) {
    apiStatus.textContent = 'Take a picture and select a preset first.';
    return;
  }

  if (isApplying) return;
  isApplying = true;
  const promptAtStart = selectedPrompt;

  setStyleTitleGenerating(true);
  setStyleCardLoading(promptAtStart, true);
  setApplyButtonLoading(true);

  apiStatus.textContent = 'Applying preset…';
  try {
    const out = await callImageEditAndShareAPI(latestBlob, promptAtStart, selectedSceneId);
    setStyleCardLoading(promptAtStart, false);
    renderApplySuccess(out);
  } catch (err) {
    console.log(
      'Error caught in applyPreset:',
      err,
      'status:',
      err.status,
      'statusCode:',
      err.statusCode
    );
    handleApplyError(err, promptAtStart);
  } finally {
    setApplyButtonLoading(false);
    isApplying = false;
    if (styleTitle && currentStep === 'style') {
      setStyleTitleGenerating(false);
    }
    restoreStyleCards();
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
  onTap(btnChangeStyle, (e) => {
    // Stop event propagation to prevent the click from registering on the style page
    if (e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
    // Reset style step state
    selectedPrompt = null;
    selectedSceneId = null;
    isApplying = false; // Reset applying flag

    // Clear all style card outlines and restore cards
    if (grid) {
      grid.querySelectorAll('[data-prompt]').forEach((el) => {
        el.style.removeProperty('outline');
        el.style.outline = '';
      });
    }
    restoreStyleCards();

    // Reset apply button state - set disabled based on whether image is available
    if (btnApply) {
      btnApply.disabled = !latestBlob; // Disable only if no image available
    }
    if (applyText) {
      applyText.textContent = 'Apply preset';
    }
    if (applySpinner) {
      applySpinner.classList.add('hidden');
    }

    // Reset API status
    if (apiStatus) {
      apiStatus.textContent = latestBlob
        ? 'Take a picture, pick a preset, then apply.'
        : 'Take a picture first.';
    }

    // Restore title when navigating back to style step
    if (styleTitle) {
      styleTitle.textContent = getStyleTitleDefaultText();
    }

    showStep('style');
  });
}
if (btnShareResult) {
  onTap(btnShareResult, () => {
    if (btnShareResult.disabled) return;
    if (latestShare?.imageUrl) {
      showStep('share');
    }
  });
}
// ----- Print/Download Functions -----
function handlePrint() {
  let isPrinting = false;
  return function (e) {
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
    }, 10000);
  };
}

function handleDownload() {
  let isDownloading = false;
  return async function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (btnPrintResult.disabled || isDownloading) return;

    // Prevent multiple download calls
    isDownloading = true;

    // Show printing message and grey out button
    if (printingMessage) {
      printingMessage.classList.remove('hidden');
    }
    btnPrintResult.disabled = true;
    btnPrintResult.style.opacity = '0.5';
    btnPrintResult.style.cursor = 'not-allowed';

    // Download the image
    const imageUrl = resultPhoto?.src || latestShare?.imageUrl;
    if (imageUrl) {
      try {
        // For cross-origin URLs (like Vercel Blob), we need to fetch as blob first
        // Check if it's a data URL (local) or remote URL
        if (imageUrl.startsWith('data:')) {
          // Data URL - can download directly
          const a = document.createElement('a');
          a.href = imageUrl;
          a.download = 'nanobanana-image.webp';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } else {
          // Remote URL - fetch as blob to enable download
          const response = await fetch(imageUrl);
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = 'nanobanana-image.webp';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          // Clean up the object URL
          URL.revokeObjectURL(blobUrl);
        }
      } catch (error) {
        console.error('Download failed:', error);
        // Fallback: try opening in new tab if download fails
        window.open(imageUrl, '_blank');
      }
    }

    // Hide printing message after download
    setTimeout(() => {
      if (printingMessage) {
        printingMessage.classList.add('hidden');
      }
      btnPrintResult.disabled = false;
      btnPrintResult.style.opacity = '';
      btnPrintResult.style.cursor = '';
      isDownloading = false;
    }, 1000);
  };
}

if (btnPrintResult) {
  // Use a single click handler instead of onTap to avoid double-firing
  // (onTap adds both pointerup and click handlers which can cause duplicate prints)
  // Toggle between print and download based on PRINT_BUTTON_DOWNLOADS flag
  const handler = PRINT_BUTTON_DOWNLOADS ? handleDownload() : handlePrint();
  btnPrintResult.addEventListener('click', handler);
}
if (btnRestart) {
  onTap(btnRestart, restartFlow);
}

// ----- Desktop shortcut -----
document.addEventListener('keydown', (e) => {
  if (!modeStrategy.enableKeyboardShortcuts) return;
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

// Initialize share step functionality
function initShareStep() {
  if (!latestShare?.shareUrl) {
    return;
  }

  const isMobileShareMode = appMode === APP_MODES.MOBILE;
  if (shareQrWrapper) {
    shareQrWrapper.classList.toggle('hidden', isMobileShareMode);
  }
  if (shareSocial) {
    shareSocial.classList.toggle('hidden', !isMobileShareMode);
  }

  if (shareInstruction) {
    shareInstruction.textContent = isMobileShareMode
      ? 'Choose where to share your image.'
      : 'Scan the QR code to view and share your image';
  }

  if (isMobileShareMode) {
    setupMobileShareActions(latestShare.shareUrl);
    if (shareQRCode) {
      shareQRCode.removeAttribute('src');
    }
    return;
  }

  if (!latestShare.qrDataUrl) {
    if (shareQRCode) {
      shareQRCode.alt = 'QR code not available';
      shareQRCode.style.display = 'none';
    }
    return;
  }

  if (shareQRCode) {
    shareQRCode.src = latestShare.qrDataUrl;
    shareQRCode.style.display = 'block';
  }
}

if (btnBackFromShare) {
  onTap(btnBackFromShare, () => {
    showStep(modeStrategy.initialStep);
  });
}

if (nativeCaptureInput) {
  nativeCaptureInput.addEventListener('change', handleNativeCaptureChange);
}

window.addEventListener('focus', () => {
  if (!nativeCapturePending || !nativeCaptureInput) return;
  // If capture was canceled, many browsers return focus without triggering change.
  setTimeout(() => {
    if (!nativeCaptureInput.files?.length) {
      nativeCapturePending = false;
    }
  }, 300);
});

modeStrategy.applyLayout();
applyCompanyExperience();
currentStep = modeStrategy.initialStep;
showStep(currentStep);
updateResultButtons();
