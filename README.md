# Nano Banana Kiosk (Touch + Mouse)

A minimal kiosk-style web app (camera + presets) served by Express.
Works with **touch** and **mouse**; good for desktop testing and expo kiosks.

## Local Development
```bash
npm install
npm start
```

## Vercel Deployment

This app is configured to deploy to Vercel. The project structure uses:
- `public/` - Static files (HTML, CSS, JS, assets) - automatically served by Vercel
- `api/index.js` - Serverless function for API routes

### Required Environment Variables

Set these in your Vercel project settings:

1. **GEMINI_API_KEY** - Your Google Gemini API key (required)
2. **BLOB_READ_WRITE_TOKEN** - Vercel Blob storage token (required for image storage)
3. **UPLOAD_TARGET** - Set to `blob` for production (default) or `dataurl` for development

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
- `vercel.json` - Vercel configuration (rewrites, crons)
- `server.js` - Local development server (not used in Vercel)

### API Routes

- `POST /api/edit-and-share` - Main endpoint for image editing and sharing
- `POST /api/edit` - Image editing only
- `GET /api/healthz` - Health check
- `GET /api/diag` - Diagnostics
- `GET /api/cleanup` - Cleanup old images (runs via cron daily)
