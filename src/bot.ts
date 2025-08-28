import { autoRetry } from '@grammyjs/auto-retry';
import { apiThrottler } from '@grammyjs/transformer-throttler';
import { Bot, Context, RawApi, webhookCallback } from 'grammy';
import { Message } from 'grammy/types';
import { Other } from 'grammy/out/core/api';

import { Stream, transcribe, TranscriptionStreamEvent } from './ai';
import { deleteFile, download, extractAudioFromVideo } from './util';

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
 * Handles incoming voice and video note messages
 * Initiates transcription process and sends status updates
 */
bot.on([':voice', ':video_note'], async (ctx) => {
    console.log('[Bot] Message received:', {
        messageType: 'voice' in ctx.msg ? 'voice' : 'video_note',
        userId: ctx.from?.id,
        chatId: ctx.chatId,
        messageId: ctx.msgId,
    });

    const msg = await ctx.reply(`<em>Start transcribing...</em>`, {
        ...htmlFmt,
        reply_parameters: { message_id: ctx.msgId },
    });
    transcribeMedia(ctx, msg);
    return msg;
});

// TODO: Add stop button, check file size limit (25 MB OpenAI, 20 MB Bot API)
/**
 * Processes voice and video note messages by downloading, transcribing, and streaming results
 * 
 * @param ctx - Bot context with media file
 * @param returnMsg - Message to update with transcription results
 * 
 * @example
 * ```typescript
 * await transcribeMedia(ctx, message);
 * ```
 */
async function transcribeMedia(
    ctx: Context & { msg: Message.VoiceMessage | Message.VideoNoteMessage },
    returnMsg: Message,
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
        filePath = await download(getFileUrl(file.file_path!));

        if ('video_note' in ctx.msg) {
            const extractedAudioPath = await extractAudioFromVideo(filePath);
            deleteFile(filePath);
            filePath = extractedAudioPath;
        }

        await streamTranscriptionToBot(returnMsg, await transcribe(filePath));
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
        editMessageText(returnMsg, `Error processing message: ${error.message}`);
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
 * Reserved characters for status indicators like 'Generating...'
 */
const reservedChars = 23;

/**
 * Streams transcription results to the bot, handling message splitting and updates
 * 
 * @param returnMsg - Message that will be updated and used for threading
 * @param stream - Stream of transcription events from OpenAI
 * 
 * @example
 * ```typescript
 * await streamTranscriptionToBot(message, stream);
 * ```
 */
async function streamTranscriptionToBot(
    returnMsg: Message,
    stream: Stream<TranscriptionStreamEvent>,
) {
    const startTime = Date.now();
    console.log('[Stream] Starting transcription streaming');

    let lastMsgTime = startTime;
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
                        messageId: returnMsg.message_id,
                        bufferLength: buffer.length,
                        timeSinceLastUpdate: now - lastMsgTime,
                    });
                    editMessageText(returnMsg, `${buffer}\n<em>Generating...</em>`, htmlFmt);
                }
            } else {
                console.log('[Stream] Message limit reached, creating new message:', {
                    oldMessageId: returnMsg.message_id,
                    bufferLength: buffer.length,
                    newChunkLength: chunk.delta.length,
                });

                const oldReturnMsg = returnMsg;
                returnMsg = await bot.api.sendMessage(
                    returnMsg.chat.id,
                    `${chunk.delta}\n<em>Generating...</em>`, {
                    ...htmlFmt,
                    reply_parameters: { message_id: returnMsg.message_id },
                });
                messageCount++;

                lastMsgTime = now;
                console.log('[Stream] Finalizing previous message:', {
                    messageId: oldReturnMsg.message_id,
                    finalLength: buffer.length,
                });
                editMessageText(oldReturnMsg, buffer);
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
        messageId: returnMsg.message_id,
        finalLength: buffer.length,
        totalProcessingTime: Date.now() - startTime,
        totalMessages: messageCount,
    });

    return editMessageText(returnMsg, buffer);
}

/**
 * Helper function for editing message text with optional HTML formatting
 * 
 * @param msg - Message to edit
 * @param text - New text of the message, 1-4096 characters after entities parsing
 * @param other - Optional remaining parameters, confer the official reference below
 * @returns Promise that resolves when the message is edited
 * 
 * @example
 * ```typescript
 * await editMessageText(ctx, messageId, 'Updated text');
 * await editMessageText(ctx, messageId, '<b>Bold text</b>', htmlFmt);
 * ```
 */
const editMessageText = (
    msg: Message,
    text: string,
    other?: Other<RawApi, 'editMessageText', 'chat_id' | 'message_id' | 'text' | 'inline_message_id'>,
) => bot.api.editMessageText(msg.chat.id, msg.message_id, text, other);

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
