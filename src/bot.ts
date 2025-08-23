import { Bot, Context, webhookCallback } from 'grammy';
import { Message } from 'grammy/types';
import { apiThrottler } from "@grammyjs/transformer-throttler";
import { autoRetry } from "@grammyjs/auto-retry";

import { deleteFile, downloadVoiceMessage } from './util';
import { transcribe, Stream, TranscriptionStreamEvent } from './ai';

const { BOT_TOKEN: botToken, WH_DOMAIN: whDomain } = process.env;

/**
 * Telegram bot instance with throttling and auto-retry middleware
 */
const bot = new Bot(botToken!);
bot.api.config.use(apiThrottler(), autoRetry());

/**
 * Creates and configures a webhook for the Telegram bot
 * 
 * @returns Express middleware function for handling webhook requests
 * 
 * @example
 * ```typescript
 * app.use(express.json(), await createWebhook());
 * ```
 */
export async function createWebhook() {
    await bot.api.setWebhook(whDomain!);
    return webhookCallback(bot, 'express');
}

/**
 * Adds HTML formatting to message
 */
const htmlFmt = { parse_mode: 'HTML' } as const;

// TODO: Make bot private
/**
 * Handles the /start command
 */
bot.command('start', (ctx) => ctx.reply('Hello!'));

/**
 * Handles incoming voice messages
 * Initiates transcription process and sends status updates
 */
bot.on(':voice', async (ctx) => {
    const msg = await ctx.reply(`<em>Start transcribing...</em>`, {
        ...htmlFmt,
        reply_parameters: { message_id: ctx.msgId },
    });
    botOnVoice(ctx, msg.message_id);
    return msg;
});

// TODO: Add stop button, file size limit (25 MB OpenAI, 20 MB Bot API), ai errors handling, logs
/**
 * Processes voice messages by downloading, transcribing, and streaming results
 * 
 * @param ctx - Bot context with voice message
 * @param returnMsgId - ID of the message to update with transcription results
 * 
 * @example
 * ```typescript
 * await botOnVoice(ctx, messageId);
 * ```
 */
async function botOnVoice(ctx: Context & { msg: Message.VoiceMessage }, returnMsgId: number) {
    let filePath: string | undefined;
    try {
        const file = await ctx.getFile();
        filePath = await downloadVoiceMessage(getFileUrl(file.file_path!));

        await streamTranscriptionToBot(ctx, returnMsgId, await transcribe(filePath));
    } catch (error: any) {
        console.error('[Bot] Error processing voice message', {
            error: error.message,
            stack: error.stack,
            chatId: ctx.chatId,
            userId: ctx.from?.id,
            fileId: ctx.msg.voice.file_id,
        });
        editMessageText(ctx, returnMsgId, `Error processing voice message: ${error.message}`);
    } finally {
        if (filePath) deleteFile(filePath);
    }
}

/**
 * Delay between message updates in milliseconds
 */
const messagesDelay = 1000;
/**
 * Maximum characters allowed in a single Telegram message
 */
const charsInMessage = 4096;
/**
 * Reserved characters for status indicators like "Generating..."
 */
const reservedChars = 23;

/**
 * Streams transcription results to the bot, handling message splitting and updates
 * 
 * @param ctx - Bot context for sending messages
 * @param returnMsgId - ID of the initial message to update
 * @param stream - Stream of transcription events from OpenAI
 * 
 * @example
 * ```typescript
 * await streamTranscriptionToBot(ctx, messageId, transcriptionStream);
 * ```
 */
async function streamTranscriptionToBot(
    ctx: Context,
    returnMsgId: number,
    stream: Stream<TranscriptionStreamEvent>,
) {
    let lastMsgTime = Date.now();
    let buffer = '';
    for await (const chunk of stream) {
        if (chunk.type === 'transcript.text.delta') {
            console.log('[AI] Chunk generated', { chunk });

            const now = Date.now();
            if ((buffer + chunk.delta).length + reservedChars <= charsInMessage) {
                buffer += chunk.delta;
                if (now - lastMsgTime > messagesDelay) {
                    lastMsgTime = now;
                    editMessageText(ctx, returnMsgId, `${buffer}\n<em>Generating...</em>`, htmlFmt);
                }
            } else {
                const oldReturnMsgId = returnMsgId;
                returnMsgId = (await ctx.reply(`${chunk.delta}\n<em>Generating...</em>`, {
                    ...htmlFmt,
                    reply_parameters: { message_id: returnMsgId },
                })).message_id;
                lastMsgTime = now;
                editMessageText(ctx, oldReturnMsgId, buffer);
                buffer = chunk.delta;
            }
        } else if (chunk.type === 'transcript.text.done') {
            console.log('[AI] Response generated', { chunk });
        } else {
            console.log('[AI] Unknown chunk type:', { chunk });
        }
    }
    await new Promise(resolve => setTimeout(resolve, messagesDelay - (Date.now() - lastMsgTime)));
    return editMessageText(ctx, returnMsgId, buffer);
}

/**
 * Helper function for editing message text with optional HTML formatting
 * 
 * @param ctx - Bot context
 * @param messageId - ID of the message to edit
 * @param text - New text content
 * @param format - Optional HTML formatting options
 * @returns Promise that resolves when message is edited
 * 
 * @example
 * ```typescript
 * await editMessageText(ctx, messageId, "Updated text");
 * await editMessageText(ctx, messageId, "<b>Bold text</b>", htmlFmt);
 * ```
 */
const editMessageText = (ctx: Context, messageId: number, text: string, format?: typeof htmlFmt) =>
    ctx.api.editMessageText(ctx.chatId!, messageId, text, format ? htmlFmt : undefined);

/**
 * Constructs the full URL for downloading a file from Telegram
 * 
 * @param filePath - File path from Telegram API
 * @returns Complete download URL
 * 
 * @example
 * ```typescript
 * const url = getFileUrl('documents/file_123.ogg');
 * // Returns: https://api.telegram.org/file/bot<token>/documents/file_123.ogg
 * ```
 */
const getFileUrl = (filePath: string) => `https://api.telegram.org/file/bot${bot.token}/${filePath}`;
