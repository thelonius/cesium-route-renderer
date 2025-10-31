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
