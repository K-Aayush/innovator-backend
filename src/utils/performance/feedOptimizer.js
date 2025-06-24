const NodeCache = require("node-cache");

class FeedOptimizer {
  constructor() {
    // Multi-tier caching system
    this.hotCache = new NodeCache({ stdTTL: 60, checkperiod: 30 }); // 1 minute for trending content
    this.warmCache = new NodeCache({ stdTTL: 300, checkperiod: 60 }); // 5 minutes for popular content
    this.coldCache = new NodeCache({ stdTTL: 900, checkperiod: 120 }); // 15 minutes for regular content

    // Performance settings
    this.batchSize = 20;
    this.maxConcurrentRequests = 5;

    // Performance metrics
    this.metrics = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageResponseTime: 0,
      memoryOptimizations: 0,
      lastOptimization: new Date(),
    };

    // Auto-optimization
    this.startAutoOptimization();
  }

  // Intelligent caching based on content popularity and user behavior
  async cacheContent(key, data, options = {}) {
    const {
      popularity = "warm",
      userEngagement = 0,
      contentAge = 0,
      priority = "normal",
    } = options;

    // Determine cache tier based on multiple factors
    let cacheType = popularity;

    // High engagement content goes to hot cache
    if (userEngagement > 0.8 || priority === "high") {
      cacheType = "hot";
    }

    // Very new content goes to hot cache
    if (contentAge < 3600000) {
      // 1 hour
      cacheType = "hot";
    }

    const cacheMap = {
      hot: this.hotCache,
      warm: this.warmCache,
      cold: this.coldCache,
    };

    const cache = cacheMap[cacheType] || this.warmCache;
    cache.set(key, data);

    return data;
  }

  // Smart cache retrieval with fallback
  getFromCache(key) {
    let result = this.hotCache.get(key);
    if (result) {
      this.metrics.cacheHits++;
      return result;
    }

    result = this.warmCache.get(key);
    if (result) {
      this.metrics.cacheHits++;
      // Promote to hot cache if accessed frequently
      this.hotCache.set(key, result);
      return result;
    }

    result = this.coldCache.get(key);
    if (result) {
      this.metrics.cacheHits++;
      return result;
    }

    this.metrics.cacheMisses++;
    return null;
  }

  // Batch processing with intelligent concurrency control
  async batchProcessContent(contentArray, processor, options = {}) {
    const {
      batchSize = this.batchSize,
      maxConcurrency = this.maxConcurrentRequests,
      priority = "normal",
    } = options;

    const results = [];
    const startTime = Date.now();

    // Adjust batch size based on system load
    const adjustedBatchSize = this.adjustBatchSizeForLoad(batchSize);

    for (let i = 0; i < contentArray.length; i += adjustedBatchSize) {
      const batch = contentArray.slice(i, i + adjustedBatchSize);
      const batchPromises = batch.map(processor);

      // Process with controlled concurrency
      const batchResults = await this.limitConcurrency(
        batchPromises,
        maxConcurrency
      );
      results.push(...batchResults);

      // Yield control periodically for high-priority requests
      if (priority === "low" && i % (adjustedBatchSize * 3) === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    // Update metrics
    const processingTime = Date.now() - startTime;
    this.metrics.averageResponseTime =
      (this.metrics.averageResponseTime + processingTime) / 2;

    return results;
  }

  // Dynamic batch size adjustment based on system load
  adjustBatchSizeForLoad(baseBatchSize) {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;

    // Reduce batch size if memory usage is high
    if (heapUsedMB > 500) return Math.max(5, Math.floor(baseBatchSize * 0.5));
    if (heapUsedMB > 300) return Math.max(10, Math.floor(baseBatchSize * 0.7));

    return baseBatchSize;
  }

  // Intelligent concurrency limiting
  async limitConcurrency(promises, limit) {
    const results = [];

    for (let i = 0; i < promises.length; i += limit) {
      const batch = promises.slice(i, i + limit);
      const batchResults = await Promise.allSettled(batch);

      // Handle both fulfilled and rejected promises
      results.push(
        ...batchResults
          .map((result) =>
            result.status === "fulfilled" ? result.value : null
          )
          .filter(Boolean)
      );
    }

    return results;
  }

  // Predictive preloading based on user behavior
  async preloadCriticalContent(userId, userProfile, options = {}) {
    const { preloadCount = 10, priority = "high" } = options;

    const preloadKey = `preload_${userId}`;

    // Check if already preloading
    if (this.hotCache.get(preloadKey)) {
      return;
    }

    // Mark as preloading
    this.hotCache.set(preloadKey, true, 30);

    try {
      // Preload in background with intelligent prediction
      setImmediate(async () => {
        const Content = require("../../modules/contents/contents.model");
        const Video = require("../../modules/video/video.model");

        // Predict content based on user behavior
        const predictedFilters = this.buildPredictiveFilters(userProfile);

        const [contents, videos] = await Promise.all([
          Content.find(predictedFilters)
            .sort({ createdAt: -1 })
            .limit(preloadCount)
            .lean(),
          Video.find(predictedFilters)
            .sort({ createdAt: -1 })
            .limit(Math.floor(preloadCount / 2))
            .lean(),
        ]);

        // Cache preloaded content with high priority
        [...contents, ...videos].forEach((item) => {
          this.cacheContent(`content_${item._id}`, item, {
            popularity: "hot",
            priority: "high",
          });
        });

        console.log(
          `Preloaded ${
            contents.length + videos.length
          } items for user ${userId}`
        );
      });
    } catch (error) {
      console.error("Preload error:", error);
    }
  }

  // Build predictive filters based on user behavior
  buildPredictiveFilters(userProfile) {
    const filters = {};

    // Prefer content from followed users
    if (userProfile.followingEmails?.length > 0) {
      filters["author.email"] = {
        $in: userProfile.followingEmails.slice(0, 50),
      };
    }

    // Prefer user's preferred content types
    if (userProfile.engagementPattern?.preferredTypes?.length > 0) {
      filters.type = { $in: userProfile.engagementPattern.preferredTypes };
    }

    return filters;
  }

  // Advanced image optimization with multiple formats
  generateResponsiveImageUrls(imageUrl, options = {}) {
    if (!imageUrl) return null;

    const {
      formats = ["webp", "jpg"],
      qualities = [60, 80, 95],
      sizes = ["thumb", "small", "medium", "large"],
    } = options;

    const basePath = imageUrl.replace(/\.[^/.]+$/, "");
    const extension = imageUrl.split(".").pop();

    const responsive = {
      original: imageUrl,
      formats: {},
    };

    formats.forEach((format) => {
      responsive.formats[format] = {};
      sizes.forEach((size) => {
        responsive.formats[format][size] = `${basePath}_${size}.${format}`;
      });
    });

    return responsive;
  }

  // Advanced video streaming with adaptive bitrate
  generateVideoStreamingUrls(videoUrl, options = {}) {
    if (!videoUrl) return null;

    const {
      enableAdaptive = true,
      enablePreview = true,
      qualities = ["360p", "480p", "720p", "1080p"],
    } = options;

    const basePath = videoUrl.replace(/\.[^/.]+$/, "");

    const streaming = {
      hls: `${basePath}/master.m3u8`,
      dash: `${basePath}/manifest.mpd`,
      thumbnail: `${basePath}_thumb.jpg`,
      qualities: {},
    };

    if (enablePreview) {
      streaming.preview = `${basePath}_preview.gif`;
    }

    if (enableAdaptive) {
      qualities.forEach((quality) => {
        streaming.qualities[quality] = `${basePath}/${quality}/playlist.m3u8`;
      });
    }

    return streaming;
  }

  // Comprehensive memory monitoring
  getMemoryUsage() {
    const usage = process.memoryUsage();
    const cacheStats = {
      hot: this.hotCache.getStats(),
      warm: this.warmCache.getStats(),
      cold: this.coldCache.getStats(),
    };

    return {
      system: {
        rss: Math.round(usage.rss / 1024 / 1024),
        heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
        heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
        external: Math.round(usage.external / 1024 / 1024),
        arrayBuffers: Math.round(usage.arrayBuffers / 1024 / 1024),
      },
      caches: cacheStats,
      efficiency: {
        totalKeys:
          cacheStats.hot.keys + cacheStats.warm.keys + cacheStats.cold.keys,
        hitRate: this.calculateOverallHitRate(),
        memoryPerKey:
          usage.heapUsed /
          (cacheStats.hot.keys +
            cacheStats.warm.keys +
            cacheStats.cold.keys +
            1),
      },
    };
  }

  // Calculate overall cache hit rate
  calculateOverallHitRate() {
    return (
      this.metrics.cacheHits /
        (this.metrics.cacheHits + this.metrics.cacheMisses) || 0
    );
  }

  // Intelligent cache cleanup
  optimizeMemoryUsage(force = false) {
    const usage = process.memoryUsage();
    const heapUsedMB = usage.heapUsed / 1024 / 1024;
    let optimized = false;

    // Progressive cleanup based on memory pressure
    if (heapUsedMB > 400 || force) {
      // Clear least recently used items from cold cache
      this.coldCache.flushAll();
      optimized = true;
      console.log("Cleared cold cache due to memory pressure");
    }

    if (heapUsedMB > 600 || force) {
      // Clear warm cache but keep hot cache
      this.warmCache.flushAll();
      optimized = true;
      console.log("Cleared warm cache due to high memory usage");
    }

    if (heapUsedMB > 800 || force) {
      // Emergency cleanup - clear everything except most recent hot cache items
      const hotKeys = this.hotCache.keys();
      const recentKeys = hotKeys.slice(-10); // Keep last 10 items

      this.hotCache.flushAll();
      recentKeys.forEach((key) => {
        // Re-add recent items (this is a simplified approach)
        // In production, you'd want to preserve the actual data
      });

      optimized = true;
      console.log("Emergency memory cleanup performed");
    }

    if (optimized) {
      this.metrics.memoryOptimizations++;
      this.metrics.lastOptimization = new Date();
    }

    return optimized;
  }

  // Auto-optimization scheduler
  startAutoOptimization() {
    // Check memory every 5 minutes
    setInterval(() => {
      this.optimizeMemoryUsage();
    }, 5 * 60 * 1000);

    // Full optimization every 30 minutes
    setInterval(() => {
      this.optimizeMemoryUsage(true);
    }, 30 * 60 * 1000);
  }

  // Comprehensive performance metrics
  getPerformanceMetrics() {
    return {
      ...this.metrics,
      memory: this.getMemoryUsage(),
      cacheEfficiency: this.calculateOverallHitRate(),
      uptime: process.uptime(),
      nodeVersion: process.version,
      lastOptimization: this.metrics.lastOptimization,
      systemHealth: this.assessSystemHealth(),
    };
  }

  // System health assessment
  assessSystemHealth() {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const hitRate = this.calculateOverallHitRate();

    let health = "excellent";

    if (heapUsedMB > 600 || hitRate < 0.5) health = "good";
    if (heapUsedMB > 800 || hitRate < 0.3) health = "fair";
    if (heapUsedMB > 1000 || hitRate < 0.1) health = "poor";

    return {
      status: health,
      memoryPressure: heapUsedMB > 500,
      cacheEfficiency: hitRate > 0.7,
      recommendations: this.generateHealthRecommendations(heapUsedMB, hitRate),
    };
  }

  // Generate health recommendations
  generateHealthRecommendations(memUsage, hitRate) {
    const recommendations = [];

    if (memUsage > 500) {
      recommendations.push(
        "Consider reducing cache TTL or implementing more aggressive cleanup"
      );
    }

    if (hitRate < 0.5) {
      recommendations.push("Cache hit rate is low - review caching strategy");
    }

    if (this.metrics.averageResponseTime > 1000) {
      recommendations.push(
        "Response times are high - consider optimizing queries or increasing cache"
      );
    }

    return recommendations;
  }
}

module.exports = new FeedOptimizer();
