# Telegram Bot for GPX Route Videos

This Telegram bot allows users to submit GPX files and receive rendered route videos directly in Telegram.

## Features

- 📤 Upload GPX files directly in Telegram
- 📊 Real-time rendering progress updates
- 📥 Receive videos directly in chat
- 🎥 Vertical video format (perfect for mobile)
- ✨ Automatic intro/outro animations

## Setup

1. Install dependencies:
```bash
cd telegram-bot
npm install
```

2. Make sure the API server is running:
```bash
cd ../server
npm start
```

3. Start the bot:
```bash
cd ../telegram-bot
npm start
```

## Usage

1. Open Telegram and search for your bot
2. Send `/start` to begin
3. Upload a GPX file (as document)
4. Wait for processing (~2-3 minutes)
5. Receive your video!

## Commands

- `/start` - Start the bot and see welcome message
- `/help` - Show help and usage instructions
- `/status` - Check current render status
- `/logs` - View detailed rendering logs

## Environment Variables

Set these environment variables for production:

```bash
# Bot Token from @BotFather (required)
BOT_TOKEN=your_bot_token_here

# Internal API server (for bot to communicate with API)
API_SERVER=http://localhost:3000

# Public URL for download links (what users access from outside)
PUBLIC_URL=http://195.133.27.96:3000
```

### Production Setup

When deploying with PM2:
```bash
pm2 start telegram-bot/index.js \
  --name telegram-bot \
  --env PUBLIC_URL=http://your-server-ip:3000
```

## Video Size Management (NEW!)

The bot automatically handles Telegram's **50MB file size limit**:

### How it works:
1. ✅ **Pre-check**: Checks file size before attempting upload
2. 📊 **Smart fallback**: If file > 50MB, provides direct download link
3. 🔄 **Error handling**: Catches 413 errors and provides download link
4. 📋 **Size estimation**: Logs expected file size during encoding

### When video exceeds limit:

Users receive a message with:
```
⚠️ Video is too large for Telegram!

📊 File size: 51.23 MB
📏 Telegram limit: 50 MB

📥 Download your video here:
http://your-server:3000/output/route_XXX/route-video.mp4

💡 The video file is available for download from our server.
```

### Current video settings:
- **Bitrate**: 2500k (keeps typical routes under 50MB)
- **CRF**: 28 (medium quality, good compression)
- **Preset**: medium (balanced encoding)
- **Expected size**: ~20-30MB for 2-3 minute routes

## Bot Features

### Progress Updates
The bot sends updates during processing:
- ✅ GPX file received
- ⏳ Processing started
- 📊 Rendering progress
- ✅ Video ready
- 📤 Uploading to Telegram

### Video Specifications
- **Resolution**: 1080x1920 (vertical, mobile-optimized)
- **Framerate**: 60 FPS
- **Animation Speed**: 100x
- **Intro**: 5 seconds (zoom from space)
- **Outro**: 4 seconds (zoom to space)

## Troubleshooting

### Bot not responding
- Check that the bot token is correct
- Make sure the API server is running on port 3000
- Check bot logs for errors

### Video upload fails
- Large videos (>50MB) may take time to upload
- Check Telegram file size limits
- Verify output directory permissions

## Configuration

Edit `index.js` to configure:
- `BOT_TOKEN` - Your Telegram bot token
- `API_SERVER` - API server URL (default: http://localhost:3000)

## Development

Run with auto-reload:
```bash
npm run dev
```
