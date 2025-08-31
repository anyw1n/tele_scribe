import { join } from 'path';
import { tmpdir } from 'os';
import { writeFile, unlink } from 'fs/promises';
import { Readable } from 'stream';
import { spawn } from 'child_process';
import { utilLogger as logger } from './logger';

/**
 * Downloads a file from a URL and saves it to a temporary location
 * 
 * Downloads media files and stores them in the system's
 * temporary directory. Automatically converts .oga files to .ogg extension
 * for better compatibility with audio processing tools.
 * 
 * @param url - The URL to download from
 * @param signal - An AbortSignal that can be used to cancel the request
 * @returns Promise that resolves to the path of the downloaded file
 * 
 * @example
 * ```typescript
 * const filePath = await download('https://api.telegram.org/file/bot<token>/voice.oga', signal);
 * // Returns: /tmp/voice.ogg
 * ```
 * 
 * @throws {Error} When HTTP request fails or file writing fails
 * @throws {AbortError} When the download is cancelled via AbortSignal
 */
export async function download(url: string, signal: AbortSignal) {
    const log = logger.startDownload(url);

    const fileName = url.split('/').pop()!.replace('.oga', '.ogg');
    const filePath = join(tmpdir(), `${fileName}`);

    try {
        const response = await fetch(url, { signal });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const stream = Readable.fromWeb(response.body!);
        await writeFile(filePath, stream, { signal });

        log.downloaded(filePath);
        return filePath;
    } catch (error: any) {
        log.error(error);
        throw error;
    }
}

/**
 * Deletes a file from the filesystem asynchronously
 * 
 * Safely removes temporary files created during processing.
 * Logs success or failure for debugging purposes.
 * Does not throw errors if file doesn't exist or cannot be deleted.
 * 
 * @param filePath - Path to the file to delete
 * 
 * @example
 * ```typescript
 * await deleteFile('/tmp/voice_123.ogg');
 * // File will be deleted and result logged
 * // If file doesn't exist, error is logged but not thrown
 * ```
 */
export async function deleteFile(filePath: string) {
    const log = logger.startFileDeleting(filePath);
    try {
        await unlink(filePath);
        log.deleted();
    } catch (error: any) {
        log.error(error);
    }
}

/**
 * Extracts audio from a video file using FFmpeg
 * 
 * Uses FFmpeg to extract the audio track from video files (like video notes)
 * while preserving the original audio format and quality. The extracted audio
 * is saved as an M4A file in the system's temporary directory.
 * 
 * Requirements:
 * - FFmpeg must be installed and available in the system PATH
 * - Sufficient disk space for temporary files
 * 
 * @param filePath - Path to the video file to extract audio from
 * @param signal - An AbortSignal that can be used to cancel the request
 * @returns Promise that resolves to the path of the extracted audio file
 * 
 * @example
 * ```typescript
 * const audioPath = await extractAudioFromVideo('/tmp/video_note.mp4', signal);
 * console.log('Audio extracted to:', audioPath);
 * // Returns: /tmp/video_note.mp4.m4a
 * ```
 * 
 * @throws {Error} When FFmpeg is not available, extraction fails, or process is killed
 * @throws {AbortError} When the extraction is cancelled via AbortSignal
 */
export async function extractAudioFromVideo(filePath: string, signal: AbortSignal) {
    const log = logger.startAudioExtracting(filePath);

    const fileName = filePath.split('/').pop()!;
    const outputPath = join(tmpdir(), `${fileName}.m4a`);

    return new Promise<string>((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
            '-i', filePath,           // Input file
            '-vn',                    // No video
            '-acodec', 'copy',        // Copy audio stream without re-encoding
            '-y',                     // Overwrite output file if it exists
            outputPath,               // Output file
        ], { signal });

        let stderr = '';

        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                log.extracted(outputPath);
                resolve(outputPath);
            } else {
                const error = new Error(`FFmpeg process exited with code ${code}: ${stderr}`);
                log.error(error);
                reject(error);
            }
        });

        ffmpeg.on('error', (error) => {
            log.error(error);
            reject(error);
        });
    });
}

/**
 * Splits a string into chunks of specified size
 * 
 * Useful for breaking down long text messages that exceed Telegram's character limit.
 * Each chunk will be at most the specified size, with the last chunk potentially being smaller.
 * 
 * @param str - The string to split into chunks
 * @param chunkSize - Maximum size of each chunk
 * @returns Array of string chunks
 * 
 * @example
 * ```typescript
 * const text = 'This is a very long message that needs to be split';
 * const chunks = chunked(text, 10);
 * // Returns: ['This is a v', 'ery long m', 'essage th', 'at needs ', 'to be spl', 'it']
 * ```
 */
export function chunked(str: string, chunkSize: number) {
    const numberOfChunks = Math.ceil(str.length / chunkSize);
    const chunks: string[] = [];

    for (let i = 0; i < numberOfChunks; i++) {
        chunks.push(str.slice(i * chunkSize, (i + 1) * chunkSize));
    }

    return chunks;
}
