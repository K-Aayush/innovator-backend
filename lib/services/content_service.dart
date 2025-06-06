import 'dart:convert';
import 'package:shared_preferences.dart';
import 'package:http/http.dart' as http;
import 'package:flutter/foundation.dart';

class ContentService {
  static const String _baseUrl = 'YOUR_API_BASE_URL';
  static const String _cacheKey = 'cached_contents';
  static const int _cacheExpiryMinutes = 30;
  static const int _pageSize = 10;

  final SharedPreferences _prefs;
  DateTime? _lastFetchTime;
  List<Map<String, dynamic>> _cachedContents = [];
  String? _nextCursor;
  bool _hasMore = true;

  ContentService(this._prefs) {
    _loadCache();
  }

  Future<void> _loadCache() async {
    final cachedData = _prefs.getString(_cacheKey);
    if (cachedData != null) {
      final data = json.decode(cachedData);
      _cachedContents = List<Map<String, dynamic>>.from(data['contents']);
      _nextCursor = data['nextCursor'];
      _hasMore = data['hasMore'] ?? true;
      _lastFetchTime = DateTime.parse(data['lastFetchTime']);
    }
  }

  Future<void> _saveCache() async {
    final data = {
      'contents': _cachedContents,
      'nextCursor': _nextCursor,
      'hasMore': _hasMore,
      'lastFetchTime': DateTime.now().toIso8601String(),
    };
    await _prefs.setString(_cacheKey, json.encode(data));
  }

  bool _isCacheValid() {
    if (_lastFetchTime == null) return false;
    final difference = DateTime.now().difference(_lastFetchTime!);
    return difference.inMinutes < _cacheExpiryMinutes;
  }

  Future<List<Map<String, dynamic>>> getContents({bool forceRefresh = false}) async {
    if (!forceRefresh && _isCacheValid() && _cachedContents.isNotEmpty) {
      return _cachedContents;
    }

    try {
      final response = await http.get(
        Uri.parse('$_baseUrl/contents?pageSize=$_pageSize${_nextCursor != null ? '&lastId=$_nextCursor' : ''}'),
        headers: {'Content-Type': 'application/json'},
      );

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final contents = List<Map<String, dynamic>>.from(data['data']['contents']);
        
        if (_nextCursor == null) {
          _cachedContents = contents;
        } else {
          _cachedContents.addAll(contents);
        }

        _nextCursor = data['data']['nextCursor'];
        _hasMore = data['data']['hasMore'] ?? false;
        _lastFetchTime = DateTime.now();
        
        await _saveCache();
        return _cachedContents;
      } else {
        throw Exception('Failed to load contents');
      }
    } catch (e) {
      debugPrint('Error fetching contents: $e');
      if (_cachedContents.isNotEmpty) {
        return _cachedContents;
      }
      rethrow;
    }
  }

  Future<void> refreshContents() async {
    _nextCursor = null;
    _hasMore = true;
    await getContents(forceRefresh: true);
  }

  Future<List<Map<String, dynamic>>> loadMore() async {
    if (!_hasMore) return _cachedContents;
    return getContents();
  }

  Future<void> incrementView(String contentId) async {
    try {
      await http.post(
        Uri.parse('$_baseUrl/content/$contentId/view'),
        headers: {'Content-Type': 'application/json'},
      );
    } catch (e) {
      debugPrint('Error incrementing view: $e');
    }
  }

  Future<void> clearCache() async {
    await _prefs.remove(_cacheKey);
    _cachedContents = [];
    _nextCursor = null;
    _hasMore = true;
    _lastFetchTime = null;
  }
} 