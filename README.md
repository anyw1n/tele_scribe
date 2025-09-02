# TeleScribe

A Telegram bot for transcribing voice messages using OpenAI.

## Features

- Voice message transcription using OpenAI
- Real-time streaming transcription updates
- TypeScript support with full type safety
- Express server with webhook support
- Error handling and logging
- Auto-retry and throttling for Telegram API calls

## Prerequisites

- Node.js 22 or higher
- npm installed
- Telegram Bot Token
- OpenAI API Key
- Google Cloud Platform account
- gcloud CLI installed

## Installation

1. Clone the repository
2. Install dependencies:

   ```bash
   npm install
   ```

3. Create env files for different environments:

   Example of env file - [.env.example](.env.example). Replace `example` with your environment name. Set env by `NODE_ENV=env_name` (see scripts in [package.json](package.json)).

## Development

For local development:

```bash
npm run local
```

## Building

To compile TypeScript to JavaScript:

```bash
npm run compile
```

## Production

To run the compiled version:

```bash
npm start
```

## Deployment

To deploy to Google Cloud App Engine:

```bash
npm run deploy
```

## Project Structure

```
tele_scribe/
├── src/
│   ├── app.ts          # Main application entry point
│   ├── bot.ts          # Telegram bot implementation
│   ├── ai.ts           # OpenAI integration
│   └── util.ts         # Utility functions
├── dist/               # Compiled JavaScript output (generated)
├── tsconfig.json       # TypeScript configuration
├── package.json        # Dependencies and scripts
├── app.yaml            # Google Cloud App Engine configuration
└── .vscode/            # VS Code configuration
```

## Key Features

1. **Type Safety**: All functions and variables are properly typed
2. **Interface Definitions**: Clear interfaces for Telegram message structures
3. **Error Handling**: Typed error handling with proper error types
4. **Documentation**: JSDoc comments for better code documentation
5. **Build Process**: Proper TypeScript compilation with source maps
6. **Development Tools**: Support for TypeScript-aware development tools
7. **Streaming Transcription**: Real-time updates as transcription progresses
8. **File Management**: Automatic cleanup of temporary audio files

## Scripts

- `npm run compile`: Compile TypeScript to JavaScript
- `npm run local`: Run locally with ts-node
- `npm start`: Run the compiled JavaScript version in production
- `npm run deploy`: Build and deploy to Google Cloud App Engine

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `BOT_TOKEN` | Telegram Bot token | Yes | - |
| `WH_DOMAIN` | Server domain for bot webhook | Yes | - |
| `PORT` | Server Port | No* | Defined by App Engine when deployed. Required when run locally |
| `OPENAI_API_KEY` | OpenAI API Key | Yes | - |
| `CHATS_ALLOWLIST` | Chat Ids where bot will respond | No | Bot will respond in every chat |

## Usage

1. Start the bot using one of the available scripts
2. Send a voice message to your Telegram bot
3. The bot will transcribe the message and send back the text
4. Transcription updates are streamed in real-time

## Deployment Configuration

The project is configured for Google Cloud App Engine with:

- Node.js 22 runtime
- F1 instance class
- Automatic scaling with minimum 1 instance

See [app.yaml](app.yaml).

## Dependencies

### Production Dependencies

- `grammy`: Telegram Bot API framework
- `@grammyjs/auto-retry`: Auto-retry functionality for API calls
- `@grammyjs/transformer-throttler`: Rate limiting for API calls
- `express`: Web server framework
- `openai`: OpenAI API client
- `dotenv`: Environment variable management

### Development Dependencies

- `typescript`: TypeScript compiler
- `ts-node`: TypeScript execution engine
- `@types/express`: Express type definitions
- `@types/node`: Node.js type definitions
