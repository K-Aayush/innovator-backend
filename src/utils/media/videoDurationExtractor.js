const ffmpeg = require("fluent-ffmpeg");
const path = require("path");

class VideoDurationExtractor {
  static async getVideoDuration(videoPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          console.error("Error getting video duration:", err);
          reject(err);
          return;
        }

        try {
          const duration = metadata.format.duration;
          if (duration) {
            resolve({
              seconds: Math.round(duration),
              formatted: this.formatDuration(duration),
              metadata: {
                bitrate: metadata.format.bit_rate,
                size: metadata.format.size,
                format: metadata.format.format_name,
              },
            });
          } else {
            reject(new Error("Duration not found in video metadata"));
          }
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  // Get comprehensive video metadata
  static async getVideoMetadata(videoPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          console.error("Error getting video metadata:", err);
          reject(err);
          return;
        }

        try {
          const videoStream = metadata.streams.find(
            (stream) => stream.codec_type === "video"
          );
          const audioStream = metadata.streams.find(
            (stream) => stream.codec_type === "audio"
          );

          const result = {
            duration: {
              seconds: Math.round(metadata.format.duration || 0),
              formatted: this.formatDuration(metadata.format.duration || 0),
            },
            video: videoStream
              ? {
                  codec: videoStream.codec_name,
                  width: videoStream.width,
                  height: videoStream.height,
                  aspectRatio: this.calculateAspectRatio(
                    videoStream.width,
                    videoStream.height
                  ),
                  frameRate: this.parseFrameRate(videoStream.r_frame_rate),
                  bitrate: videoStream.bit_rate,
                }
              : null,
            audio: audioStream
              ? {
                  codec: audioStream.codec_name,
                  sampleRate: audioStream.sample_rate,
                  channels: audioStream.channels,
                  bitrate: audioStream.bit_rate,
                }
              : null,
            format: {
              name: metadata.format.format_name,
              size: metadata.format.size,
              bitrate: metadata.format.bit_rate,
            },
            quality: this.determineVideoQuality(videoStream),
          };

          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  // Format duration from seconds to HH:MM:SS
  static formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return "00:00:00";

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    return [hours, minutes, secs]
      .map((unit) => unit.toString().padStart(2, "0"))
      .join(":");
  }

  // Calculate aspect ratio
  static calculateAspectRatio(width, height) {
    if (!width || !height) return "unknown";

    const gcd = this.greatestCommonDivisor(width, height);
    const ratioWidth = width / gcd;
    const ratioHeight = height / gcd;

    // Common aspect ratios
    const commonRatios = {
      "16:9": [16, 9],
      "4:3": [4, 3],
      "21:9": [21, 9],
      "1:1": [1, 1],
      "9:16": [9, 16], //
    };

    for (const [ratio, [w, h]] of Object.entries(commonRatios)) {
      if (ratioWidth === w && ratioHeight === h) {
        return ratio;
      }
    }

    return `${ratioWidth}:${ratioHeight}`;
  }

  // Parse frame rate from fraction string
  static parseFrameRate(frameRateString) {
    if (!frameRateString) return 0;

    try {
      const [numerator, denominator] = frameRateString.split("/").map(Number);
      return denominator
        ? Math.round((numerator / denominator) * 100) / 100
        : 0;
    } catch (error) {
      return 0;
    }
  }

  // Determine video quality based on resolution
  static determineVideoQuality(videoStream) {
    if (!videoStream || !videoStream.height) return "unknown";

    const height = videoStream.height;

    if (height >= 2160) return "4K";
    if (height >= 1440) return "2K";
    if (height >= 1080) return "1080p";
    if (height >= 720) return "720p";
    if (height >= 480) return "480p";
    if (height >= 360) return "360p";
    return "240p";
  }

  // Greatest common divisor helper
  static greatestCommonDivisor(a, b) {
    return b === 0 ? a : this.greatestCommonDivisor(b, a % b);
  }

  // Batch process multiple videos
  static async batchGetDurations(videoPaths) {
    const results = [];

    for (const videoPath of videoPaths) {
      try {
        const duration = await this.getVideoDuration(videoPath);
        results.push({
          path: videoPath,
          success: true,
          duration,
        });
      } catch (error) {
        results.push({
          path: videoPath,
          success: false,
          error: error.message,
        });
      }
    }

    return results;
  }

  // Check if file is a video
  static isVideoFile(filePath) {
    const videoExtensions = [
      ".mp4",
      ".avi",
      ".mov",
      ".wmv",
      ".flv",
      ".webm",
      ".mkv",
      ".m4v",
      ".3gp",
      ".ogv",
    ];

    const ext = path.extname(filePath).toLowerCase();
    return videoExtensions.includes(ext);
  }

  static async getBestThumbnailTime(videoPath) {
    try {
      const metadata = await this.getVideoMetadata(videoPath);
      const duration = metadata.duration.seconds;

      const thumbnailTime = Math.max(1, Math.floor(duration * 0.1));
      return thumbnailTime;
    } catch (error) {
      console.error("Error getting best thumbnail time:", error);
      return 1;
    }
  }
}

module.exports = VideoDurationExtractor;
