const NodeCache = require("node-cache");

class FeedOptimizer {
  constructor() {
    // Different cache layers with optimized TTLs
    this.hotCache = new NodeCache({ stdTTL: 60, checkperiod: 30 }); // 1 minute for hot content
    this.warmCache = new NodeCache({ stdTTL: 300, checkperiod: 60 }); // 5 minutes for warm content
    this.coldCache = new NodeCache({ stdTTL: 900, checkperiod: 120 }); // 15 minutes for cold content

    this.batchSize = 20;
    this.maxConcurrentRequests = 5;
  }

  // Intelligent caching based on content popularity
  async cacheContent(key, data, popularity = "warm") {
    const cacheMap = {
      hot: this.hotCache,
      warm: this.warmCache,
      cold: this.coldCache,
    };

    const cache = cacheMap[popularity] || this.warmCache;
    cache.set(key, data);
    return data;
  }

  // Get from appropriate cache layer
  getFromCache(key) {
    return (
      this.hotCache.get(key) ||
      this.warmCache.get(key) ||
      this.coldCache.get(key)
    );
  }

  // Batch process content for better performance
  async batchProcessContent(contentArray, processor) {
    const results = [];

    for (let i = 0; i < contentArray.length; i += this.batchSize) {
      const batch = contentArray.slice(i, i + this.batchSize);
      const batchPromises = batch.map(processor);

      // Limit concurrent processing
      const batchResults = await this.limitConcurrency(
        batchPromises,
        this.maxConcurrentRequests
      );
      results.push(...batchResults);
    }

    return results;
  }

  // Limit concurrent operations
  async limitConcurrency(promises, limit) {
    const results = [];

    for (let i = 0; i < promises.length; i += limit) {
      const batch = promises.slice(i, i + limit);
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);
    }

    return results;
  }

  // Preload critical content
  async preloadCriticalContent(userId, contentIds) {
    const preloadKey = `preload_${userId}`;

    // Check if already preloading
    if (this.hotCache.get(preloadKey)) {
      return;
    }

    // Mark as preloading
    this.hotCache.set(preloadKey, true, 30);

    try {
      // Preload in background
      setImmediate(async () => {
        const Content = require("../modules/contents/contents.model");
        const Video = require("../modules/video/video.model");

        const [contents, videos] = await Promise.all([
          Content.find({ _id: { $in: contentIds } }).lean(),
          Video.find({ _id: { $in: contentIds } }).lean(),
        ]);

        // Cache preloaded content
        [...contents, ...videos].forEach((item) => {
          this.cacheContent(`content_${item._id}`, item, "hot");
        });
      });
    } catch (error) {
      console.error("Preload error:", error);
    }
  }

  // Optimize images for different screen sizes
  generateResponsiveImageUrls(imageUrl) {
    if (!imageUrl) return null;

    const basePath = imageUrl.replace(/\.[^/.]+$/, "");
    const extension = imageUrl.split(".").pop();

    return {
      thumbnail: `${basePath}_thumb.${extension}`,
      small: `${basePath}_small.${extension}`,
      medium: `${basePath}_medium.${extension}`,
      large: `${basePath}_large.${extension}`,
      original: imageUrl,
    };
  }

  // Generate video streaming URLs
  generateVideoStreamingUrls(videoUrl) {
    if (!videoUrl) return null;

    const basePath = videoUrl.replace(/\.[^/.]+$/, "");

    return {
      hls: `${basePath}/playlist.m3u8`,
      dash: `${basePath}/manifest.mpd`,
      thumbnail: `${basePath}_thumb.jpg`,
      preview: `${basePath}_preview.gif`,
      qualities: {
        "360p": `${basePath}/360p/playlist.m3u8`,
        "480p": `${basePath}/480p/playlist.m3u8`,
        "720p": `${basePath}/720p/playlist.m3u8`,
        "1080p": `${basePath}/1080p/playlist.m3u8`,
      },
    };
  }

  // Memory usage monitoring
  getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
      rss: Math.round(usage.rss / 1024 / 1024),
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
      external: Math.round(usage.external / 1024 / 1024),
      cacheStats: {
        hot: this.hotCache.getStats(),
        warm: this.warmCache.getStats(),
        cold: this.coldCache.getStats(),
      },
    };
  }

  // Clear caches when memory is high
  clearCachesIfNeeded() {
    const usage = process.memoryUsage();
    const heapUsedMB = usage.heapUsed / 1024 / 1024;

    if (heapUsedMB > 500) {
      // If using more than 500MB
      this.coldCache.flushAll();
      console.log("Cleared cold cache due to high memory usage");
    }

    if (heapUsedMB > 750) {
      // If using more than 750MB
      this.warmCache.flushAll();
      console.log("Cleared warm cache due to high memory usage");
    }
  }

  // Performance metrics
  getPerformanceMetrics() {
    return {
      memory: this.getMemoryUsage(),
      cacheHitRates: {
        hot: this.calculateHitRate(this.hotCache),
        warm: this.calculateHitRate(this.warmCache),
        cold: this.calculateHitRate(this.coldCache),
      },
      uptime: process.uptime(),
      nodeVersion: process.version,
    };
  }

  calculateHitRate(cache) {
    const stats = cache.getStats();
    return stats.hits / (stats.hits + stats.misses) || 0;
  }
}

module.exports = new FeedOptimizer();
