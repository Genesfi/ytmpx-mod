import type { Metadata } from '../types/metadata';

export class YouTubeMusicDetector {
  public static DEBUG_MODE = false;
  private static lastValidPlaylist: string | null = null;
  private static lastValidListId: string | null = null;

  private static readonly SELECTORS = {
    title: 'ytmusic-player-bar yt-formatted-string.title',
    artist: 'ytmusic-player-bar yt-formatted-string.byline',
    artistUrl:
      'ytmusic-player-bar yt-formatted-string.byline a.yt-simple-endpoint',
    progressBar: 'ytmusic-player-bar tp-yt-paper-slider#progress-bar',
    thumbnail: 'ytmusic-player-bar img.image',
    playButton: 'ytmusic-player-bar yt-icon-button#play-pause-button',
    currentTime: 'ytmusic-player-bar .time-info .current-time',
    duration: 'ytmusic-player-bar .time-info .duration',
    playlist: 'ytmusic-player-queue-header-renderer .subtitle',
  };

  private static readonly ALTERNATIVE_SELECTORS = {
    title: [
      'ytmusic-player-bar .title',
      'ytmusic-player-bar [class*="title"]',
      '.ytmusic-player-bar .title',
      'yt-formatted-string.title',
    ],
    artist: [
      'ytmusic-player-bar .byline',
      'ytmusic-player-bar [class*="byline"]',
      '.ytmusic-player-bar .byline',
      'yt-formatted-string.byline',
    ],
    thumbnail: [
      'ytmusic-player-bar img',
      'ytmusic-player-bar img[src*="googleusercontent"]',
      '.ytmusic-player-bar img',
    ],
    playlist: [
      'ytmusic-player-queue .subtitle',
      '.ytmusic-player-queue-header .subtitle',
      'ytmusic-panel-header-renderer .subtitle',
    ],
  };

  private static findElement(selectors: string[]): Element | null {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
    }
    return null;
  }

  private static isElementVisible(el: Element): boolean {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  static extractMetadata(): Metadata {
    try {
      const titleElement = this.findElement([
        this.SELECTORS.title,
        ...this.ALTERNATIVE_SELECTORS.title,
      ]);

      const artistElement = this.findElement([
        this.SELECTORS.artist,
        ...this.ALTERNATIVE_SELECTORS.artist,
      ]);

      const title = titleElement?.textContent?.trim() || '';

      let playlist: string | null = null;

      // Ambil ID playlist dari link judul di player bar (jauh lebih akurat dari window.location.href yg kadang delay saat ganti lagu)
      const playingTitleLink = document.querySelector('ytmusic-player-bar .title') as HTMLAnchorElement | null;
      const playingHref = playingTitleLink?.getAttribute('href') || playingTitleLink?.href || '';
      const listMatch = playingHref.match(/[?&]list=([^&]+)/) || window.location.href.match(/[?&]list=([^&]+)/);
      const playingListId = listMatch ? listMatch[1] : null;

      const IGNORE_PLAYLIST_REGEX = /up next|berikutnya|antrean|queue|次の曲|putar acak|shuffle/i;

      // 1. [PRIORITY] Cari nama playlist dari URL listID yang sama di semua link yang ada di halaman
      if (!playlist && playingListId) {
        const links = document.querySelectorAll(`a[href*="list=${playingListId}"]`);
        for (const link of Array.from(links)) {
          // Abaikan link video, cari link yang mengarah langsung ke playlist page (tanpa v=)
          const href = link.getAttribute('href') || '';
          if (YouTubeMusicDetector.DEBUG_MODE) {
            console.log('[YTMPX Link Search]', { text: link.textContent?.trim(), href: href });
          }
          if (href.includes('?v=') || href.includes('&v=')) continue;

          // Abaikan elemen halaman lama yang sedang disembunyikan oleh YouTube (SPA Caching)
          if (!this.isElementVisible(link)) continue;

          const titleAttr = link.getAttribute('title');
          if (titleAttr && titleAttr.trim().length > 0 && titleAttr !== title && !/play|memutar/i.test(titleAttr) && !IGNORE_PLAYLIST_REGEX.test(titleAttr)) {
            playlist = titleAttr.trim();
            break;
          }

          const text = link.textContent?.trim();
          if (text && text.length > 0 && text !== title && !/play|memutar/i.test(text) && !IGNORE_PLAYLIST_REGEX.test(text)) {
            playlist = text;
            break;
          }
        }
      }

      // 2. Fallback: Ekstraksi dari Panel Antrean / Queue Header
      if (!playlist) {
        const headerEls = document.querySelectorAll(
          'ytmusic-queue-header-renderer .subtitle, ' +
          'yt-formatted-string.subtitle.ytmusic-queue-header-renderer'
        );

        for (const el of Array.from(headerEls)) {
          if (!this.isElementVisible(el)) continue;

          let possibleName = el.getAttribute('title')?.trim();
          if (!possibleName) possibleName = el.textContent?.trim();

          if (possibleName && !IGNORE_PLAYLIST_REGEX.test(possibleName) && possibleName !== title) {
            possibleName = possibleName.replace(/^(Memutar dari|Playing from|Diputar dari|プレイリストから再生|Dari|From|Playlist)\s*[:•]?\s*/i, '').trim();
            if (possibleName) {
              playlist = possibleName;
              break;
            }
          }
        }
      }

      // 3. Fallback: Header detail playlist di halaman jika sedang dibuka (jika kita ada di halaman playlistnya)
      if (!playlist && playingListId) {
        const headerTitles = document.querySelectorAll('ytmusic-detail-header-renderer h2, ytmusic-header-renderer h2.title');
        for (const headerTitle of Array.from(headerTitles)) {
          if (!this.isElementVisible(headerTitle)) continue;

          const headerText = headerTitle.textContent?.trim();
          const pageUrl = window.location.href;
          if (headerText && pageUrl.includes('list=') && !pageUrl.includes('watch?v=')) {
            playlist = headerText;
            break;
          }
        }
      }

      // 4. Fallback MediaSession API (biasanya ada nama album jika memutar dari album)
      if (!playlist && 'mediaSession' in navigator && navigator.mediaSession.metadata) {
        const album = navigator.mediaSession.metadata.album;
        if (album && album.trim().length > 0 && album.trim() !== title) {
          playlist = album.trim();
        }
      }

      // 5. Fallback Byline Text
      if (!playlist && artistElement) {
        const bylineText = artistElement.textContent || '';
        const parts = bylineText.split('•').map(p => p.trim());
        if (parts.length >= 3) {
          const possibleAlbum = parts[1];
          // Abaikan jika bagian tersebut merupakan views (termasuk 回視聴 dalam bahasa Jepang)
          if (!/views|ditonton|tayang|x|回視聴/i.test(possibleAlbum) && !/^\d+$/.test(possibleAlbum)) {
            playlist = possibleAlbum;
          }
        }
      }

      // Cache / Restore playlist name untuk mengatasi masalah saat user pindah ke tab Lirik/Terkait (dimana panel antrean disembunyikan)
      if (playlist && playingListId && !IGNORE_PLAYLIST_REGEX.test(playlist)) {
        this.lastValidPlaylist = playlist;
        this.lastValidListId = playingListId;
      } else if (!playlist && playingListId && playingListId === this.lastValidListId && this.lastValidPlaylist) {
        playlist = this.lastValidPlaylist;
        if (YouTubeMusicDetector.DEBUG_MODE) console.log('[YTMPX Cache] Restored playlist:', playlist);
      }

      // 6. Fallback Generic: Deteksi nama bawaan berdasar ID (Radio atau Playlist)
      if (!playlist && playingListId) {
        if (playingListId.startsWith('RD') || playingListId.startsWith('LM')) {
          playlist = 'YouTube Music Radio';
        } else if (playingListId.startsWith('PL') || playingListId.startsWith('OL')) {
          playlist = 'YouTube Music Playlist';
        } else {
          playlist = 'YouTube Music Mix';
        }
      }

      const progressBarElement = document.querySelector(
        this.SELECTORS.progressBar
      );

      const thumbnailElement = this.findElement([
        this.SELECTORS.thumbnail,
        ...this.ALTERNATIVE_SELECTORS.thumbnail,
      ]);

      // Extract artist names from <a> tags in byline (excluding album links)
      let author = '';
      if (artistElement) {
        const allLinks = Array.from(artistElement.querySelectorAll('a'));
        const artists: string[] = [];

        for (const link of allLinks) {
          const href = link.getAttribute('href') || '';
          const text = link.textContent?.trim() || '';

          // Only consider links that go to channels (artists), not albums or playlists
          // Channel links typically contain "channel/" in the URL
          if (href.includes('channel/') && text) {
            artists.push(text);
          } else if (!playlist && (href.includes('browse/') || href.includes('playlist')) && text) {
            // Fallback: Ambil nama album/playlist dari byline player bar bawah
            playlist = text;
          }
        }

        // Join multiple artists with proper formatting
        if (artists.length > 0) {
          if (artists.length === 1) {
            author = artists[0];
          } else if (artists.length === 2) {
            author = artists.join(' & ');
          } else {
            // For 3+ artists: "Artist1, Artist2 & Artist3"
            const allButLast = artists.slice(0, -1).join(', ');
            const last = artists[artists.length - 1];
            author = `${allButLast} & ${last}`;
          }
        } else {
          // Fallback if no artist links are found, parse from byline text
          const bylineText = artistElement.textContent || '';
          const parts = bylineText.split('•').map(p => p.trim());
          if (parts.length > 0) {
            const possibleArtist = parts[0];
            // Make sure it's not just a number (like a year) or view count
            if (possibleArtist && !/^\d+$/.test(possibleArtist) && !/views|ditonton|subscribers|tayangan|penayangan|bersponsor/i.test(possibleArtist)) {
              author = possibleArtist;
            }
          }
        }
      }

      // Extract first artist URL
      let artistUrl: string | null = null;
      if (artistElement) {
        let firstArtistLink = artistElement.querySelector(
          'a[href*="channel/"]'
        );

        // Fallback: try to find any link that looks like a channel
        if (!firstArtistLink) {
          firstArtistLink = artistElement.querySelector('a[href*="channel"]');
        }

        // Another fallback: try to find the first link
        if (!firstArtistLink) {
          firstArtistLink = artistElement.querySelector('a');
        }

        if (firstArtistLink) {
          const href = firstArtistLink.getAttribute('href');
          if (href) {
            // Convert relative URL to absolute URL
            if (href.startsWith('/')) {
              artistUrl = `https://music.youtube.com${href}`;
            } else if (href.startsWith('channel/')) {
              artistUrl = `https://music.youtube.com/${href}`;
            } else {
              artistUrl = href;
            }
          }
        }
      }

      const durationInfo = this.extractDurationInfo(progressBarElement);
      const image = thumbnailElement?.getAttribute('src') || null;

      if (YouTubeMusicDetector.DEBUG_MODE) {
        console.log('[YTMPX Extracted] Title:', title, '| Artist:', author, '| Playlist:', playlist);
      }

      const metadata: Metadata = {
        title,
        author,
        url: window.location.href,
        totalDuration: durationInfo.totalDuration,
        currentDuration: durationInfo.currentDuration,
        image: image ? this.upscaledImage(image) : null,
        artistUrl,
        playlist,
      };

      return metadata;
    } catch (e) {
      if (YouTubeMusicDetector.DEBUG_MODE) {
        console.error('[YTMPX] Error during metadata extraction:', e);
      }
      return {
        title: '',
        author: '',
        url: window.location.href,
        totalDuration: 0,
        currentDuration: 0,
        image: null,
        artistUrl: null,
        playlist: null,
      };
    }
  }

  private static upscaledImage(image: string): string {
    const regex = /w\d+-h\d+-/;

    if (!regex.test(image)) return image;

    return image.replace(regex, 'w1024-h1024-');
  }

  static extractDurationInfo(progressBarElement: Element | null): {
    currentDuration: number;
    totalDuration: number;
  } {
    try {
      if (progressBarElement) {
        // Try to get from aria attributes first (most accurate)
        const ariaValueNow = progressBarElement.getAttribute('aria-valuenow');
        const ariaValueMax = progressBarElement.getAttribute('aria-valuemax');

        if (ariaValueNow && ariaValueMax) {
          const currentSeconds = parseInt(ariaValueNow, 10);
          const totalSeconds = parseInt(ariaValueMax, 10);

          return {
            currentDuration: currentSeconds * 1000, // Convert to milliseconds
            totalDuration: totalSeconds * 1000,
          };
        }

        // Fallback: try to parse aria-valuetext
        const ariaValueText = progressBarElement.getAttribute('aria-valuetext');
        if (ariaValueText) {
          // Parse format like "2 Minutes 28 Seconds of 3 Minutes 30 Seconds"
          const timeMatch = ariaValueText.match(
            /(\d+)\s+Minutes?\s+(\d+)\s+Seconds?\s+of\s+(\d+)\s+Minutes?\s+(\d+)\s+Seconds?/
          );
          if (timeMatch) {
            const currentMinutes = parseInt(timeMatch[1], 10);
            const currentSeconds = parseInt(timeMatch[2], 10);
            const totalMinutes = parseInt(timeMatch[3], 10);
            const totalSeconds = parseInt(timeMatch[4], 10);

            return {
              currentDuration: (currentMinutes * 60 + currentSeconds) * 1000,
              totalDuration: (totalMinutes * 60 + totalSeconds) * 1000,
            };
          }
        }
      }

      // Fallback: try to get from time display elements
      const timeInfoElement = document.querySelector(
        this.SELECTORS.currentTime
      );

      if (timeInfoElement) {
        const timeText = timeInfoElement.textContent || '';
        // Parse format like "0:06 / 3:40"
        const timeMatch = timeText.match(/(\d+:\d+)\s*\/\s*(\d+:\d+)/);
        if (timeMatch) {
          const currentTime = this.parseTimeString(timeMatch[1]);
          const totalTime = this.parseTimeString(timeMatch[2]);

          return {
            currentDuration: currentTime,
            totalDuration: totalTime,
          };
        }
      }

      return { currentDuration: 0, totalDuration: 0 };
    } catch {
      return { currentDuration: 0, totalDuration: 0 };
    }
  }

  private static parseTimeString(timeStr: string): number {
    const parts = timeStr.split(':');
    if (parts.length === 2) {
      const minutes = parseInt(parts[0], 10);
      const seconds = parseInt(parts[1], 10);
      return (minutes * 60 + seconds) * 1000; // Convert to milliseconds
    }

    return 0;
  }

  static isPlaying(): boolean {
    try {
      // Cara paling reliable: cek dari video element langsung
      const video = document.querySelector('video');
      if (video) {
        return !video.paused && !video.ended && video.currentTime > 0;
      }

      // Fallback: cek dari play button
      const playButton = document.querySelector(this.SELECTORS.playButton);
      if (playButton) {
        const button = playButton.querySelector('button');
        if (button) {
          const ariaLabel = button.getAttribute('aria-label');
          const title = playButton.getAttribute('title');
          return (
            ariaLabel?.toLowerCase().includes('pause') ||
            title?.toLowerCase().includes('pause') ||
            false
          );
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  static getCurrentTrackId(): string | null {
    try {
      // YouTube Music often uses video IDs in the URL or data attributes
      const url = window.location.href;

      // Try to extract video ID from URL
      const videoIdMatch = url.match(/[?&]v=([^&]+)/);
      if (videoIdMatch) {
        return videoIdMatch[1];
      }

      // Fallback: try to get from metadata
      const metadata = this.extractMetadata();
      if (metadata.title && metadata.author) {
        return `${metadata.title}-${metadata.author}`.replace(
          /[^a-zA-Z0-9]/g,
          '-'
        );
      }

      return null;
    } catch {
      return null;
    }
  }
}
