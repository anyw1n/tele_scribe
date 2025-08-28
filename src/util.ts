import { join } from 'path';
import { tmpdir } from 'os';
import { writeFile, unlink } from 'fs/promises';
import { Readable } from 'stream';
import { spawn } from 'child_process';

/**
 * Download from URL and save to a temporary file.
 * Returns the path to the downloaded file.
 * 
 * @param url - The URL to download from
 * @returns Promise that resolves to the path of the downloaded file
 * 
 * @example
 * ```typescript
 * const filePath = await download('https://api.telegram.org/file/bot<token>/voice.oga');
 * console.log('File downloaded to:', filePath);
 * ```
 * 
 * @throws {Error} When HTTP request fails or file writing fails
 */
export async function download(url: string) {
    const startTime = Date.now();
    console.log('[download] Starting download', { url });

    const fileName = url.split('/').pop()!.replace('.oga', '.ogg');
    const filePath = join(tmpdir(), `${fileName}`);

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const stream = Readable.fromWeb(response.body!);
        await writeFile(filePath, stream);

        console.log('[download] File downloaded to', { filePath });
        return filePath;
    } catch (error: any) {
        console.error('[download] Error downloading file', {
            error: error.message,
            stack: error.stack,
        });
        throw error;
    } finally {
        const endTime = Date.now();
        const executionTime = endTime - startTime;
        console.log('[download] Execution time, ms', { executionTime });
    }
}

/**
 * Deletes a file from the filesystem asynchronously
 * Logs success or failure
 * 
 * @param filePath - Path to the file to delete
 * 
 * @example
 * ```typescript
 * deleteFile('/tmp/voice_123.ogg');
 * // File will be deleted and result logged
 * ```
 */
export async function deleteFile(filePath: string) {
    try {
        await unlink(filePath);
        console.log(`[deleteFile] File deleted`, { filePath });
    } catch (error: any) {
        console.error(`[deleteFile] File not deleted`, { filePath, error });
    }
}

/**
 * Extracts audio from a video file using ffmpeg.
 * Returns the path to the extracted audio file (preserves original audio format).
 * 
 * @param filePath - Path to the video file
 * @returns Promise that resolves to the path of the extracted audio file
 * 
 * @example
 * ```typescript
 * const audioPath = await extractAudioFromVideo('/path/to/video.mp4');
 * console.log('Audio extracted to:', audioPath);
 * ```
 * 
 * @throws {Error} When ffmpeg is not available or extraction fails
 */
export async function extractAudioFromVideo(filePath: string): Promise<string> {
    const startTime = Date.now();
    console.log('[extractAudioFromVideo] Starting audio extraction', { filePath });

    const fileName = filePath.split('/').pop()!;
    const outputPath = join(tmpdir(), `${fileName}.m4a`);

    return new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
            '-i', filePath,           // Input file
            '-vn',                    // No video
            '-acodec', 'copy',        // Copy audio stream without re-encoding
            '-y',                     // Overwrite output file if it exists
            outputPath,               // Output file
        ]);

        let stderr = '';

        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ffmpeg.on('close', (code) => {
            const endTime = Date.now();
            const executionTime = endTime - startTime;

            if (code === 0) {
                console.log('[extractAudioFromVideo] Audio extraction completed', {
                    inputPath: filePath,
                    outputPath,
                    executionTime,
                });
                resolve(outputPath);
            } else {
                const error = new Error(`FFmpeg process exited with code ${code}: ${stderr}`);
                console.error('[extractAudioFromVideo] Audio extraction failed', {
                    inputPath: filePath,
                    error: error.message,
                    executionTime,
                });
                reject(error);
            }
        });

        ffmpeg.on('error', (error) => {
            const endTime = Date.now();
            const executionTime = endTime - startTime;

            console.error('[extractAudioFromVideo] FFmpeg process error', {
                inputPath: filePath,
                error: error.message,
                executionTime,
            });
            reject(error);
        });
    });
}
