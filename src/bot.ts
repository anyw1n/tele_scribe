import { autoRetry } from "@grammyjs/auto-retry";
import { apiThrottler } from "@grammyjs/transformer-throttler";
import { Bot, Context, webhookCallback } from 'grammy';
import { Message } from 'grammy/types';

import { Stream, transcribe, TranscriptionStreamEvent } from './ai';
import { deleteFile, downloadVoiceMessage } from './util';

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
 * Adds HTML formatting to message
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
 * Handles incoming voice messages
 * Initiates transcription process and sends status updates
 */
bot.on(':voice', async (ctx) => {
    const voiceMessage = ctx.msg.voice;
    console.log('[Bot] Voice message received:', {
        fileId: voiceMessage.file_id,
        fileSize: voiceMessage.file_size,
        duration: voiceMessage.duration,
        mimeType: voiceMessage.mime_type,
        userId: ctx.from?.id,
        chatId: ctx.chatId,
        messageId: ctx.msgId,
    });

    const msg = await ctx.reply(`<em>Start transcribing...</em>`, {
        ...htmlFmt,
        reply_parameters: { message_id: ctx.msgId },
    });
    botOnVoice(ctx, msg.message_id);
    return msg;
});

// TODO: Add stop button, file size limit (25 MB OpenAI, 20 MB Bot API), ai errors handling
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
    const startTime = Date.now();
    const voiceMessage = ctx.msg.voice;

    console.log('[Bot] Starting voice message processing:', {
        fileId: voiceMessage.file_id,
        fileSize: voiceMessage.file_size,
        duration: voiceMessage.duration,
        returnMsgId,
        userId: ctx.from?.id,
        chatId: ctx.chatId,
    });

    let filePath: string | undefined;
    try {
        const file = await ctx.getFile();
        filePath = await downloadVoiceMessage(getFileUrl(file.file_path!));

        await streamTranscriptionToBot(ctx, returnMsgId, await transcribe(filePath));
        console.log('[Bot] Voice message processing completed successfully in', Date.now() - startTime, 'ms');
    } catch (error: any) {
        console.error('[Bot] Error processing voice message', {
            error: error.message,
            stack: error.stack,
            chatId: ctx.chatId,
            userId: ctx.from?.id,
            fileId: voiceMessage.file_id,
            processingTime: Date.now() - startTime,
            filePath,
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
    const startTime = Date.now();
    console.log('[Stream] Starting transcription streaming:', {
        returnMsgId,
        chatId: ctx.chatId,
        userId: ctx.from?.id,
    });

    let lastMsgTime = Date.now();
    let buffer = '';
    let messageCount = 1; // Start with 1 for the initial message

    for await (const chunk of stream) {
        if (chunk.type === 'transcript.text.delta') {
            console.log('[AI] Chunk generated', {
                deltaLength: chunk.delta.length,
                bufferLength: buffer.length,
                totalLength: buffer.length + chunk.delta.length,
            });

            const now = Date.now();
            if ((buffer + chunk.delta).length + reservedChars <= charsInMessage) {
                buffer += chunk.delta;
                if (now - lastMsgTime > messagesDelay) {
                    lastMsgTime = now;
                    console.log('[Stream] Updating message with new content:', {
                        messageId: returnMsgId,
                        bufferLength: buffer.length,
                        timeSinceLastUpdate: now - lastMsgTime,
                    });
                    editMessageText(ctx, returnMsgId, `${buffer}\n<em>Generating...</em>`, htmlFmt);
                }
            } else {
                console.log('[Stream] Message limit reached, creating new message:', {
                    oldMessageId: returnMsgId,
                    bufferLength: buffer.length,
                    newChunkLength: chunk.delta.length,
                });

                const oldReturnMsgId = returnMsgId;
                returnMsgId = (await ctx.reply(`${chunk.delta}\n<em>Generating...</em>`, {
                    ...htmlFmt,
                    reply_parameters: { message_id: returnMsgId },
                })).message_id;
                messageCount++;

                lastMsgTime = now;
                console.log('[Stream] Finalizing previous message:', {
                    messageId: oldReturnMsgId,
                    finalLength: buffer.length,
                });
                editMessageText(ctx, oldReturnMsgId, buffer);
                buffer = chunk.delta;
            }
        } else if (chunk.type === 'transcript.text.done') {
            console.log('[AI] Response generated', {
                chunk,
                totalMessages: messageCount,
                finalBufferLength: buffer.length,
            });
        } else {
            console.log('[AI] Unknown chunk type:', { chunk });
        }
    }

    const finalDelay = messagesDelay - (Date.now() - lastMsgTime);
    if (finalDelay > 0) {
        console.log('[Stream] Waiting final message delay:', finalDelay, 'ms');
        await new Promise(resolve => setTimeout(resolve, finalDelay));
    }

    console.log('[Stream] Finalizing transcription:', {
        messageId: returnMsgId,
        finalLength: buffer.length,
        totalProcessingTime: Date.now() - startTime,
        totalMessages: messageCount,
    });

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
