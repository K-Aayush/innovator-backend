const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs");

class VideoDurationExtractor {
  static async getVideoDuration(videoPath) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(videoPath)) {
        console.error(`Video file not found: ${videoPath}`);
        reject(new Error(`Video file not found: ${videoPath}`));
        return;
      }

      console.log(`Getting duration for video: ${videoPath}`);

      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          console.error("FFprobe error:", err);
          reject(err);
          return;
        }

        try {
          const duration = metadata.format.duration;
          if (duration && duration > 0) {
            const result = {
              seconds: Math.round(duration),
              formatted: this.formatDuration(duration),
              metadata: {
                bitrate: metadata.format.bit_rate || 0,
                size: metadata.format.size || 0,
                format: metadata.format.format_name || "unknown",
              },
            };
            console.log(`Video duration extracted: ${result.formatted}`);
            resolve(result);
          } else {
            console.error("Duration not found or invalid in video metadata");
            reject(new Error("Duration not found in video metadata"));
          }
        } catch (error) {
          console.error("Error processing video metadata:", error);
          reject(error);
        }
      });
    });
  }

  // Get comprehensive video metadata
  static async getVideoMetadata(videoPath) {
    return new Promise((resolve, reject) => {
      // Check if file exists first
      if (!fs.existsSync(videoPath)) {
        console.error(`Video file not found: ${videoPath}`);
        reject(new Error(`Video file not found: ${videoPath}`));
        return;
      }

      console.log(`Getting metadata for video: ${videoPath}`);

      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          console.error("FFprobe metadata error:", err);
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

          const duration = metadata.format.duration || 0;

          const result = {
            duration: {
              seconds: Math.round(duration),
              formatted: this.formatDuration(duration),
            },
            video: videoStream
              ? {
                  codec: videoStream.codec_name || "unknown",
                  width: videoStream.width || 0,
                  height: videoStream.height || 0,
                  aspectRatio: this.calculateAspectRatio(
                    videoStream.width,
                    videoStream.height
                  ),
                  frameRate: this.parseFrameRate(videoStream.r_frame_rate),
                  bitrate: videoStream.bit_rate || 0,
                }
              : null,
            audio: audioStream
              ? {
                  codec: audioStream.codec_name || "unknown",
                  sampleRate: audioStream.sample_rate || 0,
                  channels: audioStream.channels || 0,
                  bitrate: audioStream.bit_rate || 0,
                }
              : null,
            format: {
              name: metadata.format.format_name || "unknown",
              size: metadata.format.size || 0,
              bitrate: metadata.format.bit_rate || 0,
            },
            quality: this.determineVideoQuality(videoStream),
          };

          console.log(
            `Video metadata extracted successfully: ${result.duration.formatted}, ${result.quality}`
          );
          resolve(result);
        } catch (error) {
          console.error("Error processing video metadata:", error);
          reject(error);
        }
      });
    });
  }

  // Format duration from seconds to HH:MM:SS
  static formatDuration(seconds) {
    if (!seconds || isNaN(seconds) || seconds <= 0) return "00:00:00";

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    return [hours, minutes, secs]
      .map((unit) => unit.toString().padStart(2, "0"))
      .join(":");
  }

  // Calculate aspect ratio
  static calculateAspectRatio(width, height) {
    if (!width || !height || width <= 0 || height <= 0) return "unknown";

    const gcd = this.greatestCommonDivisor(width, height);
    const ratioWidth = width / gcd;
    const ratioHeight = height / gcd;

    // Common aspect ratios
    const commonRatios = {
      "16:9": [16, 9],
      "4:3": [4, 3],
      "21:9": [21, 9],
      "1:1": [1, 1],
      "9:16": [9, 16], // Vertical video
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
      return denominator && denominator > 0
        ? Math.round((numerator / denominator) * 100) / 100
        : 0;
    } catch (error) {
      return 0;
    }
  }

  // Determine video quality based on resolution
  static determineVideoQuality(videoStream) {
    if (!videoStream || !videoStream.height || videoStream.height <= 0)
      return "unknown";

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

  // Extract video info for course system
  static async extractVideoInfo(videoPath) {
    try {
      console.log(`Extracting video info for: ${videoPath}`);
      const metadata = await this.getVideoMetadata(videoPath);

      const result = {
        duration: metadata.duration.formatted,
        durationSeconds: metadata.duration.seconds,
        quality: metadata.quality,
        aspectRatio: metadata.video?.aspectRatio || "unknown",
        fileSize: metadata.format.size || 0,
        bitrate: metadata.format.bitrate || 0,
        width: metadata.video?.width || 0,
        height: metadata.video?.height || 0,
        codec: metadata.video?.codec || "unknown",
        format: metadata.format.name || "unknown",
      };

      console.log(`Video info extracted successfully:`, result);
      return result;
    } catch (error) {
      console.error("Error extracting video info:", error);
      return {
        duration: "00:00:00",
        durationSeconds: 0,
        quality: "unknown",
        aspectRatio: "unknown",
        fileSize: 0,
        bitrate: 0,
        width: 0,
        height: 0,
        codec: "unknown",
        format: "unknown",
      };
    }
  }

  // Validate video file
  static async validateVideoFile(videoPath) {
    try {
      console.log(`Validating video file: ${videoPath}`);

      if (!fs.existsSync(videoPath)) {
        return { valid: false, error: "File does not exist" };
      }

      if (!this.isVideoFile(videoPath)) {
        return { valid: false, error: "File is not a video" };
      }

      const stats = fs.statSync(videoPath);
      if (stats.size === 0) {
        return { valid: false, error: "Video file is empty" };
      }

      const metadata = await this.getVideoMetadata(videoPath);

      if (!metadata.duration.seconds || metadata.duration.seconds <= 0) {
        return { valid: false, error: "Video has no duration" };
      }

      console.log(`Video validation successful: ${videoPath}`);
      return { valid: true, metadata };
    } catch (error) {
      console.error(`Video validation failed: ${error.message}`);
      return { valid: false, error: error.message };
    }
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

  // Get best thumbnail time
  static async getBestThumbnailTime(videoPath) {
    try {
      const metadata = await this.getVideoMetadata(videoPath);
      const duration = metadata.duration.seconds;

      // Get thumbnail at 10% of video duration, but at least 1 second
      const thumbnailTime = Math.max(1, Math.floor(duration * 0.1));
      return thumbnailTime;
    } catch (error) {
      console.error("Error getting best thumbnail time:", error);
      return 1; // Default to 1 second
    }
  }

  // Process video with error handling
  static async processVideoSafely(videoPath) {
    try {
      const validation = await this.validateVideoFile(videoPath);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      const videoInfo = await this.extractVideoInfo(videoPath);
      return {
        success: true,
        data: videoInfo,
      };
    } catch (error) {
      console.error(`Error processing video ${videoPath}:`, error);
      return {
        success: false,
        error: error.message,
        data: {
          duration: "00:00:00",
          durationSeconds: 0,
          quality: "unknown",
          aspectRatio: "unknown",
          fileSize: 0,
          bitrate: 0,
          width: 0,
          height: 0,
          codec: "unknown",
          format: "unknown",
        },
      };
    }
  }
}

module.exports = VideoDurationExtractor;
