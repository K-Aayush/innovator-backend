const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs").promises;

class HLSProcessor {
  static async generateHLSPlaylist(videoPath, outputDir) {
    try {
      // Ensure output directory exists
      await fs.mkdir(outputDir, { recursive: true });

      const playlistPath = path.join(outputDir, "playlist.m3u8");

      return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .outputOptions([
            "-profile:v baseline",
            "-level 3.0",
            "-start_number 0",
            "-hls_time 10",
            "-hls_list_size 0",
            "-f hls",
          ])
          .output(playlistPath)
          .on("end", () => {
            console.log("HLS playlist generated successfully");
            resolve(playlistPath);
          })
          .on("error", (err) => {
            console.error("Error generating HLS playlist:", err);
            reject(err);
          })
          .run();
      });
    } catch (error) {
      console.error("HLS processing error:", error);
      throw error;
    }
  }

  static async generateMultiQualityHLS(videoPath, outputDir) {
    try {
      await fs.mkdir(outputDir, { recursive: true });

      const qualities = [
        { name: "360p", width: 640, height: 360, bitrate: "800k" },
        { name: "480p", width: 854, height: 480, bitrate: "1400k" },
        { name: "720p", width: 1280, height: 720, bitrate: "2800k" },
      ];

      const promises = qualities.map((quality) => {
        const qualityDir = path.join(outputDir, quality.name);
        const playlistPath = path.join(qualityDir, "playlist.m3u8");

        return new Promise(async (resolve, reject) => {
          await fs.mkdir(qualityDir, { recursive: true });

          ffmpeg(videoPath)
            .size(`${quality.width}x${quality.height}`)
            .videoBitrate(quality.bitrate)
            .outputOptions([
              "-profile:v baseline",
              "-level 3.0",
              "-start_number 0",
              "-hls_time 10",
              "-hls_list_size 0",
              "-f hls",
            ])
            .output(playlistPath)
            .on("end", () =>
              resolve({ quality: quality.name, path: playlistPath })
            )
            .on("error", reject)
            .run();
        });
      });

      const results = await Promise.all(promises);

      // Generate master playlist
      const masterPlaylist = this.generateMasterPlaylist(results, qualities);
      const masterPath = path.join(outputDir, "master.m3u8");
      await fs.writeFile(masterPath, masterPlaylist);

      return masterPath;
    } catch (error) {
      console.error("Multi-quality HLS processing error:", error);
      throw error;
    }
  }

  static generateMasterPlaylist(results, qualities) {
    let playlist = "#EXTM3U\n#EXT-X-VERSION:3\n\n";

    results.forEach((result, index) => {
      const quality = qualities[index];
      playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${
        parseInt(quality.bitrate) * 1000
      },RESOLUTION=${quality.width}x${quality.height}\n`;
      playlist += `${quality.name}/playlist.m3u8\n\n`;
    });

    return playlist;
  }

  static async generateThumbnail(
    videoPath,
    outputPath,
    timeOffset = "00:00:01"
  ) {
    try {
      const outputDir = path.dirname(outputPath);
      await fs.mkdir(outputDir, { recursive: true });

      return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .seekInput(timeOffset)
          .frames(1)
          .size("400x300")
          .output(outputPath)
          .on("end", () => {
            console.log("Thumbnail generated successfully");
            resolve(outputPath);
          })
          .on("error", (err) => {
            console.error("Error generating thumbnail:", err);
            reject(err);
          })
          .run();
      });
    } catch (error) {
      console.error("Thumbnail generation error:", error);
      throw error;
    }
  }

  static async compressImage(imagePath, outputPath, quality = 80) {
    try {
      const outputDir = path.dirname(outputPath);
      await fs.mkdir(outputDir, { recursive: true });

      return new Promise((resolve, reject) => {
        ffmpeg(imagePath)
          .size("800x600")
          .outputOptions([`-q:v ${quality}`])
          .output(outputPath)
          .on("end", () => {
            console.log("Image compressed successfully");
            resolve(outputPath);
          })
          .on("error", (err) => {
            console.error("Error compressing image:", err);
            reject(err);
          })
          .run();
      });
    } catch (error) {
      console.error("Image compression error:", error);
      throw error;
    }
  }
}

module.exports = HLSProcessor;
