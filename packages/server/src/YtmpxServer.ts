import { WebSocketServer } from 'ws';
import { Client, SetActivity } from '@xhayper/discord-rpc';
import { ActivityType } from 'discord-api-types/v10';
import { DISCORD_CLIENT_ID, WEBSOCKET_PORT } from './constants.js';
import { debounce } from './utils.js';

interface TrackMetadata {
  title: string;
  author: string;
  url: string;
  totalDuration: number;
  currentDuration: number;
  image: string | null;
  artistUrl: string | null;
}

interface WebSocketEvent {
  event: 'track' | 'pause' | 'resume' | 'TURN_ON' | 'TURN_OFF';
  metadata: TrackMetadata;
}

export class YtmpxServer {
  private discordClient: Client;
  private wss: WebSocketServer;
  private currentTrack: TrackMetadata | null = null;
  private isPlaying = false;
  private isDiscordRpcEnabled = true;
  private trackStartedAt: number | null = null;
  // private lastTrackTitle: string | null = null;
  private sessionStartedAt: number | null = null;

  public constructor() {
    this.discordClient = new Client({
      clientId: DISCORD_CLIENT_ID,
    });

    this.wss = new WebSocketServer({ port: WEBSOCKET_PORT });
    this.setupDiscordRpc();
    this.setupWebSocket();
  }

  private setupDiscordRpc(): void {
    this.discordClient.on('ready', () => {
      console.log('Discord RPC: Connected');
    });

    this.discordClient.on('error', (error) => {
      console.error('Discord RPC: Error:', error);
    });

    this.discordClient.login().catch(console.error);
  }

  private setupWebSocket(): void {
    console.log(`YTMPX Server running on ws://localhost:${WEBSOCKET_PORT}`);
    console.log('Discord RPC: Connecting...');

    this.wss.on('connection', (ws) => {
      console.log('YTMPX: Client connected');

      ws.on('message', (data) => {
        try {
          const event: WebSocketEvent = JSON.parse(data.toString());
          this.handleWebSocketEvent(event);
        } catch (error) {
          console.error('YTMPX: Error parsing message:', error);
        }
      });

      ws.on('close', () => {
        console.log('YTMPX: Client disconnected');
        this.clearDiscordActivity().catch(console.error);
      });

      ws.on('error', (err) => {
        console.error('YTMPX: WebSocket error:', err);
      });
    });

    console.log('Waiting for YTMPX extension to connect...');
  }

  private isValidMetadata(metadata: TrackMetadata): boolean {
    return !!(
      metadata.title &&
      metadata.author &&
      metadata.currentDuration >= 0 &&
      metadata.totalDuration >= 0
    );
  }

  private handleWebSocketEvent(event: WebSocketEvent): void {
    const { event: eventType, metadata } = event;

    const updateDiscordActivity = debounce(() =>
      this.updateDiscordActivity().catch(console.error)
    );

    switch (eventType) {
      case 'track':
        if (this.isValidMetadata(metadata) && metadata.currentDuration > 0) {
          this.currentTrack = metadata;
          this.trackStartedAt = Date.now() - metadata.currentDuration;
          // this.lastTrackTitle = metadata.title;
          // Set session start pertama kali aja
          if (!this.sessionStartedAt) {
            this.sessionStartedAt = Date.now();
          }
        }
        updateDiscordActivity();
        break;

      case 'pause':
        if (this.isValidMetadata(metadata) && metadata.currentDuration > 0) {
          const prevDuration = this.currentTrack?.currentDuration ?? 0;
          // Kalau duration naik = lagu jalan, bukan beneran pause
          this.isPlaying = metadata.currentDuration > prevDuration;
          this.currentTrack = metadata;
          this.trackStartedAt = Date.now() - metadata.currentDuration;
          if (!this.sessionStartedAt) {
            this.sessionStartedAt = Date.now();
          }
        }
        updateDiscordActivity();
        break;

      case 'resume':
        this.isPlaying = true;
        if (this.isValidMetadata(metadata) && metadata.currentDuration > 0) {
          this.currentTrack = metadata;
          this.trackStartedAt = Date.now() - metadata.currentDuration;
          if (!this.sessionStartedAt) {
            this.sessionStartedAt = Date.now();
          }
        }
        updateDiscordActivity();
        break;

      case 'TURN_ON':
        this.isDiscordRpcEnabled = true;
        console.log('Discord RPC: Enabled');
        updateDiscordActivity();
        break;

      case 'TURN_OFF':
        this.isDiscordRpcEnabled = false;
        console.log('Discord RPC: Disabled');
        this.clearDiscordActivity().catch(console.error);
        break;

      default:
        console.log('YTMPX: Unknown event type:', eventType);
    }
  }

  private async updateDiscordActivity(): Promise<void> {
    if (!this.isDiscordRpcEnabled || !this.currentTrack) {
      return;
    }

    if (!this.discordClient.isConnected) {
      await this.discordClient.login();
    }

    const { title, author, image, totalDuration, artistUrl } =
      this.currentTrack;

    const currentTrackUrl =
      this.currentTrack.url || 'https://music.youtube.com';

    // Karena extension selalu kirim 'pause', deteksi playing dari isPlaying override di handler
    // Playing: endTimestamp = sisa waktu lagu
    // Pause: startTimestamp = elapsed sesi
    const startTime = this.isPlaying
      ? (this.trackStartedAt ?? undefined)
      : (this.sessionStartedAt ?? undefined);

    const endTime =
      this.isPlaying && totalDuration > 0 && this.trackStartedAt
        ? this.trackStartedAt + totalDuration
        : undefined;

    const activity: SetActivity = {
      details: title || 'Unknown Title',
      state: author || 'Unknown Artist',
      largeImageKey: image ?? undefined,
      type: ActivityType.Listening,
      startTimestamp: startTime,
      endTimestamp: endTime,
      name: 'YouTube Music',
      url: currentTrackUrl,
      detailsUrl: currentTrackUrl,
      stateUrl: artistUrl || currentTrackUrl,
      buttons: [
        {
          label: 'Play on YouTube Music',
          url: currentTrackUrl,
        },
      ],
    };

    try {
      await this.discordClient.user?.setActivity(activity);
    } catch (error) {
      console.error('Discord RPC: Error setting activity:', error);
    }
  }

  private async clearDiscordActivity(): Promise<void> {
    if (this.isDiscordRpcEnabled) {
      try {
        await this.discordClient.user?.setActivity({});
        await this.discordClient.destroy();
      } catch (error) {
        console.error('Discord RPC: Error clearing activity:', error);
      }
    }
  }

  public start(): void {
    console.log('YTMPX Server started');
  }

  public stop(): void {
    this.wss.close();
    this.discordClient.destroy();
    console.log('YTMPX Server stopped');
  }
}