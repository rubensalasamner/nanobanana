# Nano Banana Kiosk (Touch + Mouse)

A minimal kiosk-style web app (camera + presets) served by Express. Works with **touch** and
**mouse**; good for desktop testing and expo kiosks.

## Local Development

```bash
npm install
npm start
```

## Kiosk Mode Setup

To run this app in kiosk mode (fullscreen, no browser UI, no dialogs), you can configure Chrome to
launch in kiosk mode.

### Windows Setup

1. **Create a Chrome Shortcut:**
   - Navigate to Chrome's installation folder (usually
     `C:\Program Files\Google\Chrome\Application\`)
   - Right-click on `chrome.exe` → "Create shortcut"
   - Move the shortcut to your Desktop or desired location

2. **Configure Kiosk Mode:**
   - Right-click the shortcut → "Properties"
   - In the "Target" field, add the following flags after `chrome.exe`:

   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --kiosk [application_url]
   ```

   **For production, replace with your URL:**

   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --kiosk [application_url]
   ```

3. **Additional Flags (Optional):**
   - `--kiosk` - Fullscreen kiosk mode
   - `--app=URL` - Opens as an app window (no address bar)
   - `--disable-infobars` - Hides "Chrome is being controlled" message
   - `--no-first-run` - Skips first-run dialogs
   - `--disable-session-crashed-bubble` - Prevents crash recovery dialogs
   - `--disable-restore-session-state` - Prevents session restore dialogs
   - `--autoplay-policy=no-user-gesture-required` - Allows autoplay (useful for camera)

4. **Set as Startup Application (Optional):**
   - Press `Win + R`, type `shell:startup`, press Enter
   - Copy your Chrome shortcut to this folder
   - Chrome will launch in kiosk mode on Windows startup

### macOS Setup

1. **Create an AppleScript Application:**
   - Open "Script Editor" (Applications → Utilities)
   - Paste the following script:

   ```applescript
   do shell script "open -a 'Google Chrome' --args --kiosk --app=https://your-app.vercel.app --disable-infobars --no-first-run"
   ```

   - Save as an Application (File → Export → Format: Application)
   - Add to Login Items (System Preferences → Users & Groups → Login Items)

2. **Or use Terminal:**
   ```bash
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --kiosk --app=https://your-app.app --disable-infobars --no-first-run
   ```

### Kiosk Mode Tips

- **Exit Kiosk Mode:** Press `Alt + F4` (Windows) or `Cmd + Q` (macOS) or `Alt + F4` (Linux)
- **Developer Tools:** Press `F12` (may need to enable in kiosk mode)
- **Camera Permissions:** First launch will prompt for camera access - grant it, then it will
  remember
- **Touch Screen:** Works best with touch-enabled displays
- **Idle Timeout:** The app includes an idle timer that resets to camera view after inactivity

## Vercel Deployment

This app is configured to deploy to Vercel. The project structure uses:

- `public/` - Static files (HTML, CSS, JS, assets) - automatically served by Vercel
- `api/index.js` - Serverless function for API routes

### Required Environment Variables

Set these in your Vercel project settings:

1. **GEMINI_API_KEY** - Your Google Gemini API key (required)
2. **STORAGE_PROVIDER** - Set to `r2` for Cloudflare R2 (recommended) or `vercel` for Vercel Blob
3. **R2_ENDPOINT** - Cloudflare R2 endpoint (e.g., `https://<account-id>.r2.cloudflarestorage.com`)
4. **R2_BUCKET_NAME** - Your R2 bucket name
5. **R2_ACCESS_KEY_ID** - R2 API token access key
6. **R2_SECRET_ACCESS_KEY** - R2 API token secret key
7. **R2_PUBLIC_URL** - R2 public development URL (e.g., `https://pub-xxxxx.r2.dev`)
8. **UPLOAD_TARGET** - Set to `blob` for production (default) or `dataurl` for development

**Note:** If using Vercel Blob instead of R2, you'll also need:

- **BLOB_READ_WRITE_TOKEN** - Vercel Blob storage token

### Deployment Steps

1. Install Vercel CLI (if not already installed):

   ```bash
   npm i -g vercel
   ```

2. Deploy to Vercel:

   ```bash
   vercel
   ```

3. Set environment variables in Vercel dashboard:
   - Go to your project settings
   - Navigate to "Environment Variables"
   - Add the required variables listed above

4. Redeploy after setting environment variables:
   ```bash
   vercel --prod
   ```

### Project Structure

- `public/` - All static files (automatically served)
- `api/index.js` - Serverless function handling `/api/*` routes
- `api/storage.js` - Storage abstraction layer (R2 or Vercel Blob)
- `vercel.json` - Vercel configuration (rewrites, crons)
- `server.js` - Local development server (not used in Vercel)

### API Routes

- `POST /api/edit-and-share` - Main endpoint for image editing and sharing
- `POST /api/edit` - Image editing only
- `GET /api/healthz` - Health check
- `GET /api/diag` - Diagnostics
- `GET /api/cleanup` - Cleanup old images (runs via cron daily)
