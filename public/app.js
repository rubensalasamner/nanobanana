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
const btnBackFromShare = document.getElementById('btnBackFromShare');

let currentStep = 'screensaver';
let idleTimer = null;
const IDLE_TIMEOUT = 120000; // 2 minutes in milliseconds
let isTakingSnapshot = false; // Prevent auto-taking pictures
let styleStepClickBlocked = false; // Block clicks on style step immediately after navigation

const wizardSteps = {
  screensaver: stepScreensaver,
  welcome: stepWelcome,
  camera: stepCamera,
  style: stepStyle,
  result: stepResult,
  share: stepShare,
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

  if (stepName === 'style') {
    // Ensure title shows "Choose your style" when navigating to style step
    if (styleTitle) {
      styleTitle.textContent = 'Choose your style';
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
      btnSnapText.textContent = 'Take picture';
    }
    // Keep button disabled on error
    if (btnSnap) {
      btnSnap.disabled = true;
    }
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

async function applyPreset() {
  if (!latestBlob || !selectedPrompt) {
    apiStatus.textContent = 'Take a picture and select a preset first.';
    return;
  }

  if (isApplying) return;
  isApplying = true;

  // Update title to show generating status (static)
  if (styleTitle) {
    styleTitle.textContent = 'Generating Image...';
  }

  // Find and update the clicked style card button with spinner
  // Store original text in a data attribute before replacing
  const clickedCard = grid?.querySelector(`[data-prompt="${CSS.escape(selectedPrompt)}"]`);
  if (clickedCard) {
    // Store original text if not already stored
    if (!clickedCard.dataset.originalText) {
      clickedCard.dataset.originalText = clickedCard.textContent.trim();
    }
    clickedCard.innerHTML = '<span class="style-card-spinner"></span>';
    clickedCard.disabled = true;
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

    // Restore clicked style card button
    const clickedCard = grid?.querySelector(`[data-prompt="${CSS.escape(selectedPrompt)}"]`);
    if (clickedCard && clickedCard.dataset.originalText) {
      clickedCard.innerHTML = clickedCard.dataset.originalText;
      clickedCard.disabled = false;
      delete clickedCard.dataset.originalText;
    }

    apiStatus.textContent = 'Done. Scan the QR to open your photo.';
    showStep('result');
    updateResultButtons();
  } catch (err) {
    console.log(
      'Error caught in applyPreset:',
      err,
      'status:',
      err.status,
      'statusCode:',
      err.statusCode
    );

    // If 422 error, redirect to welcome page
    // Check multiple ways the status might be stored
    const status =
      err.status || err.statusCode || (err.message && err.message.match(/422/) ? 422 : null);
    if (status === 422) {
      // Reset state
      isApplying = false;
      const tempPrompt = selectedPrompt;
      latestBlob = null;
      latestShare = null;
      selectedPrompt = null;

      // Restore title
      if (styleTitle) {
        styleTitle.textContent = 'Choose your style';
      }

      // Restore clicked style card button
      if (tempPrompt) {
        const clickedCard = grid?.querySelector(`[data-prompt="${CSS.escape(tempPrompt)}"]`);
        if (clickedCard && clickedCard.dataset.originalText) {
          clickedCard.innerHTML = clickedCard.dataset.originalText;
          clickedCard.disabled = false;
          delete clickedCard.dataset.originalText;
        }
      }

      // Stop spinner and reset button
      applySpinner.classList.add('hidden');
      applyText.textContent = 'Apply preset';
      btnApply.disabled = false;

      // Navigate to welcome page
      showStep('welcome');
      return;
    }

    apiStatus.textContent = 'Failed: ' + err.message + ' (check server logs)';
    // Restore title on error
    if (styleTitle) {
      styleTitle.textContent = 'Choose your style';
    }

    // Restore clicked style card button on error
    if (selectedPrompt) {
      const clickedCard = grid?.querySelector(`[data-prompt="${CSS.escape(selectedPrompt)}"]`);
      if (clickedCard && clickedCard.dataset.originalText) {
        clickedCard.innerHTML = clickedCard.dataset.originalText;
        clickedCard.disabled = false;
        delete clickedCard.dataset.originalText;
      }
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

    // Restore all style cards if still on style step (cleanup)
    if (currentStep === 'style' && grid) {
      const allCards = grid.querySelectorAll('.style-card');
      allCards.forEach((card) => {
        if (card.dataset.originalText && card.innerHTML.includes('spinner')) {
          card.innerHTML = card.dataset.originalText;
          card.disabled = false;
          delete card.dataset.originalText;
        }
      });
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
  onTap(btnChangeStyle, (e) => {
    // Stop event propagation to prevent the click from registering on the style page
    if (e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
    // Reset style step state
    selectedPrompt = null;
    isApplying = false; // Reset applying flag

    // Clear all style card outlines and restore cards
    if (grid) {
      grid.querySelectorAll('[data-prompt]').forEach((el) => {
        // Always clear outline - remove inline style completely
        el.style.removeProperty('outline');
        el.style.outline = '';
        el.style.outlineWidth = '';
        el.style.outlineColor = '';
        el.style.outlineStyle = '';
        // Always re-enable cards
        el.disabled = false;

        // Check if card has a spinner (either as element or in innerHTML)
        const hasSpinnerElement = el.querySelector('.style-card-spinner') !== null;
        const hasSpinnerInHTML =
          el.innerHTML.includes('style-card-spinner') || el.innerHTML.includes('spinner');
        const innerHTMLTrimmed = el.innerHTML.trim();
        const isOnlySpinner =
          hasSpinnerElement ||
          hasSpinnerInHTML ||
          innerHTMLTrimmed === '<span class="style-card-spinner"></span>' ||
          (innerHTMLTrimmed.startsWith('<span') && innerHTMLTrimmed.includes('spinner'));

        // ALWAYS restore card text if it has originalText stored OR if it has a spinner
        // Priority: use originalText if available, otherwise detect spinner and restore
        if (el.dataset.originalText) {
          // If we have stored originalText, always use it to restore
          el.innerHTML = el.dataset.originalText;
          // Keep originalText stored for future use, don't delete it
        } else if (isOnlySpinner) {
          // Card has spinner but no stored originalText - restore from prompt
          const prompt = el.dataset.prompt || '';
          let restoredText = 'Style'; // default
          if (prompt.includes('figurine')) restoredText = '3D figurine';
          else if (prompt.includes('yearbook')) restoredText = "1980's yearbook";
          else if (prompt.includes('Polaroid') || prompt.includes('instant-camera'))
            restoredText = 'Polaroid';
          else if (prompt.includes('Hairstyle') || prompt.includes('hair'))
            restoredText = 'Hairstyle change';
          else if (prompt.includes('headshot') || prompt.includes('LinkedIn'))
            restoredText = 'Professional headshot';
          else if (prompt.includes('painting') || prompt.includes('Impressionist'))
            restoredText = 'Photo to painting';

          el.innerHTML = restoredText;
          // Store this as originalText for future use
          el.dataset.originalText = restoredText;
        }
      });
    }

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
      styleTitle.textContent = 'Choose your style';
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

// Initialize share step functionality
function initShareStep() {
  if (!latestShare?.qrDataUrl || !latestShare?.shareUrl) {
    if (shareQRCode) {
      shareQRCode.alt = 'QR Code not available';
      shareQRCode.style.display = 'none';
    }
    return;
  }

  // Display QR code that links to share.html
  if (shareQRCode) {
    shareQRCode.src = latestShare.qrDataUrl;
    shareQRCode.style.display = 'block';
  }
}

if (btnBackFromShare) {
  onTap(btnBackFromShare, () => {
    showStep('screensaver');
  });
}

showStep(currentStep);
updateResultButtons();
