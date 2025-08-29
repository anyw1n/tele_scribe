import OpenAI from 'openai';
import { createReadStream } from 'fs';

// TODO: Add enhancing, summary

/**
 * OpenAI client instance for AI operations
 */
const ai = new OpenAI({ logLevel: 'info' });

/**
 * Transcribes audio files using OpenAI's Whisper model
 * 
 * @param audioFilePath - Path to the audio file to transcribe
 * @param signal - An AbortSignal that can be used to cancel the request
 * @returns Promise that resolves to the transcribed text
 * 
 * @example
 * ```typescript
 * const text = await transcribe('/tmp/voice_message.ogg', abortController.signal);
 * console.log('Transcribed text:', text);
 * ```
 * 
 * @throws {Error} When OpenAI API request fails or file cannot be read
 * @throws {AbortError} When the request is cancelled via AbortSignal
 */
export async function transcribe(audioFilePath: string, signal: AbortSignal) {
    const startTime = Date.now();
    console.log('[AI] Starting audio transcription', { audioFilePath });

    const tr = await ai.audio.transcriptions.create({
        model: 'whisper-1',
        file: createReadStream(audioFilePath),
    }, { signal });

    console.log('[AI] Audio transcribed', { tr, executionTime: Date.now() - startTime });
    return tr.text;
}
