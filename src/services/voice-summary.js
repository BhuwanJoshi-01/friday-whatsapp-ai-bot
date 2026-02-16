'use strict';

/**
 * Voice Summary — converts text summaries to audio using free TTS services.
 * Falls back to text-only if TTS fails.
 */

const config = require('../config');
const logger = require('../core/logger');
const axios = require('axios');

/**
 * Generate a voice note from text using free TTS services.
 * @param {string} text - Text to convert to speech
 * @returns {Promise<Buffer|null>} Audio buffer or null if TTS unavailable
 */
async function generateVoiceNote(text) {
  if (!config.summary.voiceEnabled) {
    logger.debug('Voice summary disabled');
    return null;
  }

  try {
    // Use TTSMP3 free service (limited but free)
    const ttsUrl = `https://ttsmp3.com/makemp3_new.php`;

    // Limit text to 2000 characters for free tier
    const limitedText = text.substring(0, 2000);

    const response = await axios.post(ttsUrl, new URLSearchParams({
      msg: limitedText,
      lang: 'Matthew', // English male voice
      source: 'ttsmp3'
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0'
      },
      timeout: 30000
    });

    if (response.data && response.data.URL) {
      // Download the audio file
      const audioResponse = await axios.get(response.data.URL, {
        responseType: 'arraybuffer',
        timeout: 30000
      });

      const audioBuffer = Buffer.from(audioResponse.data);

      // Convert to OGG if needed (TTSMP3 returns MP3)
      return await _convertToOgg(audioBuffer);
    }

    logger.warn('TTSMP3 returned no URL');
    return null;

  } catch (err) {
    logger.warn({ err: err.message }, 'Free TTS failed, falling back to text');
    return null;
  }
}

/**
 * Convert MP3 buffer to OGG Opus format for WhatsApp.
 */
async function _convertToOgg(mp3Buffer) {
  try {
    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegPath = require('ffmpeg-static');
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    ffmpeg.setFfmpegPath(ffmpegPath);

    const tmpDir = os.tmpdir();
    const inputFile = path.join(tmpDir, `tts_input_${Date.now()}.mp3`);
    const outputFile = path.join(tmpDir, `tts_output_${Date.now()}.ogg`);

    // Write input MP3
    fs.writeFileSync(inputFile, mp3Buffer);

    return new Promise((resolve, reject) => {
      ffmpeg(inputFile)
        .audioCodec('libopus')
        .audioBitrate('64k')
        .audioFrequency(16000)
        .audioChannels(1)
        .format('ogg')
        .output(outputFile)
        .on('end', () => {
          try {
            const result = fs.readFileSync(outputFile);
            // Cleanup
            [inputFile, outputFile].forEach(f => {
              try { fs.unlinkSync(f); } catch { /* ignore */ }
            });
            resolve(result);
          } catch (e) {
            reject(e);
          }
        })
        .on('error', (e) => {
          // Cleanup
          [inputFile, outputFile].forEach(f => {
            try { fs.unlinkSync(f); } catch { /* ignore */ }
          });
          reject(e);
        })
        .run();
    });
  } catch (err) {
    logger.debug({ err: err.message }, 'Audio conversion failed, returning original');
    return mp3Buffer; // Return MP3 as fallback
  }
}

module.exports = { generateVoiceNote };
