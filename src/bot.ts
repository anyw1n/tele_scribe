import { autoRetry } from '@grammyjs/auto-retry';
import { apiThrottler } from '@grammyjs/transformer-throttler';
import { Bot, Context, Filter, InlineKeyboard, RawApi, webhookCallback } from 'grammy';
import { Other } from 'grammy/out/core/api';
import { Message } from 'grammy/types';

import { transcribe } from './ai';
import * as util from './util';

const { BOT_TOKEN: botToken, WH_DOMAIN: whDomain } = process.env;

/**
 * Maximum characters allowed in a single Telegram message
 * Used for chunking long transcription results
 */
const charsInMessage = 4096;

/**
 * Telegram bot instance with throttling and auto-retry middleware
 */
const bot = new Bot(botToken!);
bot.api.config.use(apiThrottler(), autoRetry());

/**
 * Map to track active transcription cancellations
 * Key: cancellation ID (message ID), Value: AbortController
 */
const cancellations = new Map<string, AbortController>();

/**
 * Creates and configures a webhook for the Telegram bot
 * 
 * @returns Express middleware function for handling webhook requests
 * 
 * @example
 * ```typescript
 * app.use(express.json(), await createWebhook());
 * ```
 * 
 * @throws {Error} When webhook setup fails or domain is invalid
 */
export async function createWebhook() {
    console.log('[Webhook] Creating webhook with domain:', whDomain);

    try {
        await bot.api.setWebhook(whDomain!);
        const webhook = webhookCallback(bot, 'express');
        console.log('[Webhook] Webhook created successfully');
        return webhook;
    } catch (error) {
        console.error('[Webhook] Failed to create webhook:', error);
        throw error;
    }
}

/**
 * HTML formatting configuration for Telegram messages
 */
const htmlFmt = { parse_mode: 'HTML' } as const;

// TODO: Make bot private
/**
 * Handles the /start command
 */
bot.command('start', (ctx) => {
    console.log('[Bot] /start command received from user:', {
        userId: ctx.from?.id,
        username: ctx.from?.username,
        chatId: ctx.chatId,
        chatType: ctx.chat?.type,
    });
    return ctx.reply('Hello!');
});

/**
 * Handles callback queries from inline keyboards
 */
bot.on('callback_query:data', async (ctx) => {
    const [action, data] = ctx.callbackQuery.data.split(':');
    switch (action) {
        case 'stop':
            const abortController = data && cancellations.get(data);
            if (!abortController) {
                return ctx.answerCallbackQuery({ text: 'Error' });
            }
            abortController.abort();
            return ctx.answerCallbackQuery({ text: 'Stopped' });
    }
    return ctx.answerCallbackQuery({ text: 'Not implemented' });
});

/**
 * Handles incoming voice and video note messages
 * 
 * Initiates transcription process for audio content and sends status updates.
 * Creates a cancellation mechanism to allow users to stop transcription.
 */
bot.on([':voice', ':video_note'], async (ctx) => {
    console.log('[Bot] Message received:', {
        messageType: 'voice' in ctx.msg ? 'voice' : 'video_note',
        userId: ctx.from?.id,
        chatId: ctx.chatId,
        messageId: ctx.msgId,
    });

    const cancellationId = `${ctx.msgId}`;
    const abortController = new AbortController();
    cancellations.set(cancellationId, abortController);

    const msg = await ctx.reply(`<em>Start transcribing...</em>`, {
        ...htmlFmt,
        reply_parameters: { message_id: ctx.msgId },
        reply_markup: new InlineKeyboard().text('Stop', `stop:${cancellationId}`),
    });
    transcribeMedia(ctx, msg, abortController.signal)
        .finally(() => cancellations.delete(cancellationId));
    return msg;
});

/**
 * Processes voice and video note messages by downloading, transcribing, and streaming results
 * 
 * Downloads the media file from Telegram, extracts audio if needed, transcribes the content,
 * and sends the results back to the user. Handles both voice messages and video notes.
 * 
 * Process flow:
 * 1. Download media file from Telegram
 * 2. Extract audio from video notes (if applicable)
 * 3. Transcribe audio using OpenAI Whisper
 * 4. Split long transcriptions into chunks
 * 5. Send results to user
 * 6. Clean up temporary files
 * 
 * @param ctx - Bot context with media file
 * @param returnMsg - Message to update with transcription results
 * @param signal - An AbortSignal that can be used to cancel the request
 * 
 * @example
 * ```typescript
 * await transcribeMedia(ctx, message, abortController.signal);
 * ```
 * 
 * @throws {Error} When file download, transcription, or message sending fails
 * @throws {AbortError} When the process is cancelled by user
 */
async function transcribeMedia(
    ctx: Filter<Context, ':voice' | ':video_note'>,
    returnMsg: Message.TextMessage,
    signal: AbortSignal,
) {
    const startTime = Date.now();
    let filePath: string | undefined;
    try {
        const file = await ctx.getFile();
        console.log('[Bot] File info received:', {
            fileId: file.file_id,
            fileSize: file.file_size,
            filePath: file.file_path,
            userId: ctx.from?.id,
            chatId: ctx.chatId,
            messageId: ctx.msgId,
        });
        filePath = await util.download(getFileUrl(file.file_path!), signal);

        if ('video_note' in ctx.msg) {
            const extractedAudioPath = await util.extractAudioFromVideo(filePath, signal);
            util.deleteFile(filePath);
            filePath = extractedAudioPath;
        }

        const chunks = util.chunked(await transcribe(filePath, signal), charsInMessage);

        await editMessageText(returnMsg, chunks.shift()!);

        for (const chunk of chunks) {
            returnMsg = await bot.api.sendMessage(
                returnMsg.chat.id,
                chunk,
                { reply_parameters: { message_id: returnMsg.message_id } },
            );
        }

        console.log('[Bot] Message processing completed successfully in', Date.now() - startTime, 'ms');
    } catch (error: any) {
        console.error('[Bot] Error processing message', {
            error: error.message,
            stack: error.stack,
            chatId: ctx.chatId,
            userId: ctx.from?.id,
            processingTime: Date.now() - startTime,
            filePath,
        });
        if (error.name === 'AbortError') {
            editMessageText(returnMsg, `${returnMsg.text}\n<b>Stopped</b>`, htmlFmt);
            return;
        }
        editMessageText(returnMsg, `Error processing message: ${error.message}`);
    } finally {
        if (filePath) util.deleteFile(filePath);
    }
}

/**
 * Helper function for editing message text with optional HTML formatting
 * 
 * Updates an existing message with new text content. Supports HTML formatting
 * for bold, italic, and other text styling.
 * 
 * @param msg - Message to edit (must be a text message)
 * @param text - New text of the message, 1-4096 characters after entities parsing
 * @param other - Optional remaining parameters, confer the official reference below
 * @returns Promise that resolves when the message is edited
 * 
 * @example
 * ```typescript
 * // Edit with plain text
 * await editMessageText(message, 'Updated text');
 * 
 * // Edit with HTML formatting
 * await editMessageText(message, '<b>Bold text</b>', htmlFmt);
 * ```
 * 
 * @throws {Error} When message editing fails or message is not editable
 */
const editMessageText = (
    msg: Message,
    text: string,
    other?: Other<RawApi, 'editMessageText', 'chat_id' | 'message_id' | 'text' | 'inline_message_id'>,
) => bot.api.editMessageText(msg.chat.id, msg.message_id, text, other);

/**
 * Constructs the full URL for downloading a file from Telegram
 * 
 * Combines the Telegram API base URL with the bot token and file path
 * to create a complete download URL for media files.
 * 
 * @param filePath - File path from Telegram API (e.g., 'documents/file_123.ogg')
 * @returns Complete download URL for the file
 * 
 * @example
 * ```typescript
 * const voiceUrl = getFileUrl('voice/voice_456.oga');
 * // Returns: https://api.telegram.org/file/bot<token>/voice/voice_456.oga
 * ```
 */
const getFileUrl = (filePath: string) => `https://api.telegram.org/file/bot${bot.token}/${filePath}`;
