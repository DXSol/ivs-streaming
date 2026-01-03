package com.dxsoltech.sampradayaevents.videoplayer;

import android.app.Activity;
import android.content.ComponentName;
import android.content.pm.ActivityInfo;
import android.content.res.ColorStateList;
import android.os.Build;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.graphics.Color;
import android.view.Gravity;
import android.view.ContextThemeWrapper;

import androidx.media.session.MediaButtonReceiver;
import androidx.mediarouter.app.MediaRouteButton;
import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.MediaLoadRequestData;
import com.google.android.gms.cast.MediaMetadata;
import com.google.android.gms.cast.framework.CastButtonFactory;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.SessionManager;
import com.google.android.gms.cast.framework.SessionManagerListener;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;
import com.google.android.material.button.MaterialButton;

import com.getcapacitor.Bridge;
import com.google.android.exoplayer2.ExoPlayer;
import com.google.android.exoplayer2.MediaItem;
import com.google.android.exoplayer2.Player;
import com.google.android.exoplayer2.ui.AspectRatioFrameLayout;
import com.google.android.exoplayer2.ui.StyledPlayerView;
import com.google.android.exoplayer2.util.MimeTypes;

import com.dxsoltech.sampradayaevents.R;

public class IvsPlayerManager {
    
    private final Activity activity;
    private final Bridge bridge;
    private ExoPlayer player;
    private StyledPlayerView playerView;
    private MediaSessionCompat mediaSession;
    
    private FrameLayout fullscreenRoot;
    private FrameLayout playerContainer;
    private boolean isFullscreen = false;
    private MaterialButton fullscreenButton;
    private MediaRouteButton castButton;
    private android.widget.TextView badgeView;
    private int originalOrientation;
    
    // Cast support (Chromecast)
    private CastContext castContext;
    private SessionManager sessionManager;
    private CastSession castSession;
    private String currentMediaUrl;
    private SessionManagerListener<CastSession> sessionManagerListener;
    
    // DLNA support
    private DlnaService dlnaService;
    private MaterialButton dlnaButton;
    
    // Overlay dimensions (centered on screen when not fullscreen)
    private static final float OVERLAY_WIDTH_PERCENT = 0.85f; // 85% of screen width
    private static final float OVERLAY_ASPECT_RATIO = 16f / 9f;
    
    // Controls timeout in milliseconds (2 seconds as requested)
    private static final int CONTROLS_TIMEOUT_MS = 2000;
    
    public IvsPlayerManager(Activity activity, Bridge bridge) {
        this.activity = activity;
        this.bridge = bridge;
        this.originalOrientation = activity.getRequestedOrientation();
    }
    
    public void initialize(String url, String playerId, boolean autoplay) {
        // Store media URL for casting
        this.currentMediaUrl = url;
        
        // Initialize Cast context
        initializeCast();
        
        // Create ExoPlayer instance
        player = new ExoPlayer.Builder(activity).build();
        
        // Create PlayerView (ExoPlayer uses TextureView by default in StyledPlayerView)
        playerView = new StyledPlayerView(activity);
        playerView.setUseController(true);
        playerView.setPlayer(player);
        
        // Set controls timeout to 2 seconds
        playerView.setControllerShowTimeoutMs(CONTROLS_TIMEOUT_MS);
        
        // Add controller visibility listener to show/hide fullscreen, cast, and DLNA buttons with controls
        playerView.setControllerVisibilityListener(new StyledPlayerView.ControllerVisibilityListener() {
            @Override
            public void onVisibilityChanged(int visibility) {
                if (fullscreenButton != null) {
                    fullscreenButton.setVisibility(visibility == View.VISIBLE ? View.VISIBLE : View.GONE);
                }
                if (castButton != null) {
                    castButton.setVisibility(visibility == View.VISIBLE ? View.VISIBLE : View.GONE);
                }
                if (dlnaButton != null) {
                    dlnaButton.setVisibility(visibility == View.VISIBLE ? View.VISIBLE : View.GONE);
                }
            }
        });
        
        // Set background color
        playerView.setShutterBackgroundColor(0xFF000000);
        
        // Set resize mode to FIXED_WIDTH to maintain aspect ratio
        playerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        
        // Create a container for the player with controls overlay
        playerContainer = new FrameLayout(activity);
        playerContainer.setBackgroundColor(Color.BLACK);
        playerContainer.setElevation(10f);
        playerContainer.setZ(10f);
        // Add player view to container
        playerContainer.addView(playerView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
        
        // Add fullscreen button
        addFullscreenButton();
        
        // Add Cast button (Chromecast)
        addCastButton();
        
        // Add DLNA button
        addDlnaButton();
        
        // Add badge view
        addBadgeView();
        
        // Initialize DLNA service
        initializeDlna();
        
        // Create fullscreen root container (used only when in fullscreen)
        fullscreenRoot = new FrameLayout(activity);
        fullscreenRoot.setBackgroundColor(Color.BLACK);
        fullscreenRoot.setElevation(100f);
        
        // Add player container to decor view - start in fullscreen landscape
        ViewGroup decor = (ViewGroup) activity.getWindow().getDecorView();
        FrameLayout.LayoutParams fullscreenParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
        decor.addView(playerContainer, fullscreenParams);
        playerContainer.bringToFront();
        
        // Start in fullscreen landscape mode
        enterFullscreenOnInit();
        
        // Setup MediaSession for background audio and lockscreen controls
        setupMediaSession();
        
        // Prepare media item
        MediaItem mediaItem = new MediaItem.Builder()
            .setUri(url)
            .setMimeType(MimeTypes.APPLICATION_M3U8)
            .build();
        
        player.setMediaItem(mediaItem);
        player.prepare();
        
        if (autoplay) {
            player.setPlayWhenReady(true);
        }
        
        // Add player listener for state changes
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int playbackState) {
                updateMediaSessionState(playbackState);
            }
            
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                updateMediaSessionPlaybackState(isPlaying);
            }
        });
    }
    
    /**
     * Position player as overlay below toolbar (called when exiting fullscreen)
     */
    private void positionAsCenteredOverlay() {
        if (playerContainer == null) return;
        
        // Get screen dimensions
        int screenWidth = activity.getResources().getDisplayMetrics().widthPixels;
        int screenHeight = activity.getResources().getDisplayMetrics().heightPixels;
        
        // Calculate overlay size (85% of screen width, 16:9 aspect ratio)
        int overlayWidth = (int) (screenWidth * OVERLAY_WIDTH_PERCENT);
        int overlayHeight = (int) (overlayWidth / OVERLAY_ASPECT_RATIO);
        
        // Ensure overlay doesn't exceed screen height (with some padding)
        int maxHeight = (int) (screenHeight * 0.5f);
        if (overlayHeight > maxHeight) {
            overlayHeight = maxHeight;
            overlayWidth = (int) (overlayHeight * OVERLAY_ASPECT_RATIO);
        }
        
        // Get status bar height
        int statusBarHeight = 0;
        int resourceId = activity.getResources().getIdentifier("status_bar_height", "dimen", "android");
        if (resourceId > 0) {
            statusBarHeight = activity.getResources().getDimensionPixelSize(resourceId);
        }
        
        // Position below toolbar: status bar + toolbar (~56dp) + 33dp gap
        int toolbarHeight = dp(56);
        int gap = dp(25);
        int topMargin = statusBarHeight + toolbarHeight + gap;
        
        // Center horizontally
        int leftMargin = (screenWidth - overlayWidth) / 2;
        
        android.util.Log.d("IvsPlayerManager", "positionAsCenteredOverlay: screen(" + screenWidth + "x" + screenHeight + ") overlay(" + overlayWidth + "x" + overlayHeight + ") pos(" + leftMargin + "," + topMargin + ")");
        
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(overlayWidth, overlayHeight);
        params.leftMargin = leftMargin;
        params.topMargin = topMargin;
        playerContainer.setLayoutParams(params);
    }
    
    /**
     * Set player bounds - kept for compatibility but now just triggers overlay positioning
     */
    public void setPlayerBounds(int x, int y, int width, int height) {
        // No longer used for positioning - player is either fullscreen or centered overlay
        android.util.Log.d("IvsPlayerManager", "setPlayerBounds called but ignored - using fullscreen/overlay mode");
    }

    
    private int dp(int value) {
        return (int) (value * activity.getResources().getDisplayMetrics().density);
    }
    
    private void addFullscreenButton() {
        // Wrap activity context with Material theme to ensure MaterialButton works
        ContextThemeWrapper materialContext = new ContextThemeWrapper(activity, R.style.AppTheme);
        fullscreenButton = new MaterialButton(materialContext);
        fullscreenButton.setIconResource(R.drawable.ic_fullscreen);
        fullscreenButton.setIconTint(ColorStateList.valueOf(Color.WHITE));
        fullscreenButton.setBackgroundColor(Color.TRANSPARENT);
        fullscreenButton.setIconSize(dp(24));
        fullscreenButton.setPadding(dp(8), dp(8), dp(8), dp(8));
        fullscreenButton.setInsetTop(0);
        fullscreenButton.setInsetBottom(0);
        fullscreenButton.setMinWidth(0);
        fullscreenButton.setMinHeight(0);
        
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        );
        params.gravity = Gravity.BOTTOM | Gravity.RIGHT;
        // Position at bottom right corner with small margin
        params.setMargins(0, 0, dp(8), dp(8));
        
        fullscreenButton.setOnClickListener(v -> toggleFullscreen());
        
        // Initially hidden - will show/hide with player controls
        fullscreenButton.setVisibility(View.GONE);
        
        // Bring to front to ensure it's above player view
        fullscreenButton.setElevation(20f);
        
        playerContainer.addView(fullscreenButton, params);
        fullscreenButton.bringToFront();
    }
    
    private void updateFullscreenButtonIcon() {
        if (fullscreenButton != null) {
            fullscreenButton.setIconResource(isFullscreen ? R.drawable.ic_fullscreen_exit : R.drawable.ic_fullscreen);
        }
    }
    
    private void addCastButton() {
        try {
            castButton = new MediaRouteButton(activity);
            CastButtonFactory.setUpMediaRouteButton(activity, castButton);
            
            // Use custom light cyan cast icon for visibility on dark backgrounds
            android.graphics.drawable.Drawable customDrawable = androidx.core.content.ContextCompat.getDrawable(
                activity, R.drawable.ic_cast_light);
            if (customDrawable != null) {
                castButton.setRemoteIndicatorDrawable(customDrawable);
            }
            
            FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            );
            params.gravity = Gravity.TOP | Gravity.END;
            params.setMargins(0, dp(8), dp(8), 0);
            
            playerContainer.addView(castButton, params);
            
            // Ensure cast button is always visible
            castButton.setVisibility(View.VISIBLE);
            castButton.setAlwaysVisible(true);
            
            // Bring cast button to front so it's visible in fullscreen
            castButton.bringToFront();
        } catch (Exception e) {
            // Cast not available, ignore
            android.util.Log.w("IvsPlayerManager", "Cast button setup failed: " + e.getMessage());
        }
    }
    
    private void addDlnaButton() {
        // Wrap activity context with Material theme
        ContextThemeWrapper materialContext = new ContextThemeWrapper(activity, R.style.AppTheme);
        dlnaButton = new MaterialButton(materialContext);
        dlnaButton.setIconResource(R.drawable.ic_dlna);
        dlnaButton.setIconTint(ColorStateList.valueOf(0xFF80DEEA)); // Light cyan like cast button
        dlnaButton.setBackgroundColor(Color.TRANSPARENT);
        dlnaButton.setIconSize(dp(24));
        dlnaButton.setPadding(dp(8), dp(8), dp(8), dp(8));
        dlnaButton.setInsetTop(0);
        dlnaButton.setInsetBottom(0);
        dlnaButton.setMinWidth(0);
        dlnaButton.setMinHeight(0);
        dlnaButton.setElevation(25f);
        
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        );
        params.gravity = Gravity.TOP | Gravity.END;
        // Position next to cast button (cast button is at right edge, DLNA is to its left)
        params.setMargins(0, dp(8), dp(56), 0);
        
        dlnaButton.setOnClickListener(v -> showDlnaDevicePicker());
        
        // Initially hidden - will show/hide with player controls
        dlnaButton.setVisibility(View.GONE);
        
        playerContainer.addView(dlnaButton, params);
        dlnaButton.bringToFront();
    }
    
    private void initializeDlna() {
        dlnaService = new DlnaService(activity);
        dlnaService.setDeviceListener(new DlnaService.DlnaDeviceListener() {
            @Override
            public void onDeviceFound(DlnaService.DlnaDevice device) {
                android.util.Log.d("IvsPlayerManager", "DLNA device found: " + device.name);
            }
            
            @Override
            public void onDeviceRemoved(DlnaService.DlnaDevice device) {
                android.util.Log.d("IvsPlayerManager", "DLNA device removed: " + device.name);
            }
            
            @Override
            public void onPlaybackStarted() {
                android.util.Log.d("IvsPlayerManager", "DLNA playback started");
                // Pause local playback when casting to DLNA
                activity.runOnUiThread(() -> {
                    if (player != null) {
                        player.setPlayWhenReady(false);
                    }
                });
            }
            
            @Override
            public void onPlaybackError(String error) {
                android.util.Log.e("IvsPlayerManager", "DLNA playback error: " + error);
                // Show error toast
                activity.runOnUiThread(() -> {
                    android.widget.Toast.makeText(activity, "DLNA Error: " + error, android.widget.Toast.LENGTH_SHORT).show();
                });
            }
        });
        
        // Start DLNA discovery
        dlnaService.startDiscovery();
    }
    
    private void showDlnaDevicePicker() {
        if (dlnaService != null && currentMediaUrl != null) {
            dlnaService.showDevicePicker(currentMediaUrl);
        } else {
            android.widget.Toast.makeText(activity, "DLNA service not ready", android.widget.Toast.LENGTH_SHORT).show();
        }
    }
    
    private void addBadgeView() {
        badgeView = new android.widget.TextView(activity);
        badgeView.setTextColor(Color.WHITE);
        badgeView.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 12);
        badgeView.setPadding(dp(8), dp(4), dp(8), dp(4));
        badgeView.setElevation(25f);
        
        // Create rounded background
        android.graphics.drawable.GradientDrawable background = new android.graphics.drawable.GradientDrawable();
        background.setCornerRadius(dp(4));
        background.setColor(0xFFE53935); // Red color for LIVE/RECORDING
        badgeView.setBackground(background);
        
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        );
        params.gravity = Gravity.TOP | Gravity.LEFT;
        params.setMargins(dp(12), dp(12), 0, 0);
        
        // Initially hidden
        badgeView.setVisibility(View.GONE);
        
        playerContainer.addView(badgeView, params);
        badgeView.bringToFront();
    }
    
    /**
     * Show badge on the player (LIVE or RECORDING)
     */
    public void showBadge(String text, boolean isLive) {
        if (badgeView == null) return;
        
        activity.runOnUiThread(() -> {
            badgeView.setText("● " + text);
            
            // Set color based on type
            android.graphics.drawable.GradientDrawable background = 
                (android.graphics.drawable.GradientDrawable) badgeView.getBackground();
            if (isLive) {
                background.setColor(0xFFE53935); // Red for LIVE
            } else {
                background.setColor(0xFF1976D2); // Blue for RECORDING
            }
            
            badgeView.setVisibility(View.VISIBLE);
        });
    }
    
    /**
     * Hide the badge
     */
    public void hideBadge() {
        if (badgeView == null) return;
        
        activity.runOnUiThread(() -> {
            badgeView.setVisibility(View.GONE);
        });
    }
    
    private void initializeCast() {
        try {
            castContext = CastContext.getSharedInstance(activity);
            sessionManager = castContext.getSessionManager();
            
            sessionManagerListener = new SessionManagerListener<CastSession>() {
                @Override
                public void onSessionStarting(CastSession session) {
                    android.util.Log.d("IvsPlayerManager", "Cast session starting");
                }
                
                @Override
                public void onSessionStarted(CastSession session, String sessionId) {
                    android.util.Log.d("IvsPlayerManager", "Cast session started: " + sessionId);
                    castSession = session;
                    // Pause local playback and start casting
                    if (player != null) {
                        player.setPlayWhenReady(false);
                    }
                    loadMediaToCast();
                }
                
                @Override
                public void onSessionStartFailed(CastSession session, int error) {
                    android.util.Log.e("IvsPlayerManager", "Cast session start failed: " + error);
                }
                
                @Override
                public void onSessionEnding(CastSession session) {
                    android.util.Log.d("IvsPlayerManager", "Cast session ending");
                }
                
                @Override
                public void onSessionEnded(CastSession session, int error) {
                    android.util.Log.d("IvsPlayerManager", "Cast session ended");
                    castSession = null;
                    // Resume local playback
                    if (player != null) {
                        player.setPlayWhenReady(true);
                    }
                }
                
                @Override
                public void onSessionResuming(CastSession session, String sessionId) {
                    android.util.Log.d("IvsPlayerManager", "Cast session resuming");
                }
                
                @Override
                public void onSessionResumed(CastSession session, boolean wasSuspended) {
                    android.util.Log.d("IvsPlayerManager", "Cast session resumed");
                    castSession = session;
                }
                
                @Override
                public void onSessionResumeFailed(CastSession session, int error) {
                    android.util.Log.e("IvsPlayerManager", "Cast session resume failed: " + error);
                }
                
                @Override
                public void onSessionSuspended(CastSession session, int reason) {
                    android.util.Log.d("IvsPlayerManager", "Cast session suspended");
                }
            };
            
            sessionManager.addSessionManagerListener(sessionManagerListener, CastSession.class);
            
            // Check if already casting
            castSession = sessionManager.getCurrentCastSession();
            
        } catch (Exception e) {
            android.util.Log.w("IvsPlayerManager", "Cast initialization failed: " + e.getMessage());
        }
    }
    
    private void loadMediaToCast() {
        if (castSession == null || currentMediaUrl == null) {
            android.util.Log.w("IvsPlayerManager", "Cannot load media to cast: session or URL is null");
            return;
        }
        
        try {
            RemoteMediaClient remoteMediaClient = castSession.getRemoteMediaClient();
            if (remoteMediaClient == null) {
                android.util.Log.w("IvsPlayerManager", "RemoteMediaClient is null");
                return;
            }
            
            // Create media metadata
            MediaMetadata metadata = new MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE);
            metadata.putString(MediaMetadata.KEY_TITLE, "Live Stream");
            metadata.putString(MediaMetadata.KEY_SUBTITLE, "Sampradaya Events");
            
            // Create MediaInfo for HLS stream
            MediaInfo mediaInfo = new MediaInfo.Builder(currentMediaUrl)
                .setStreamType(MediaInfo.STREAM_TYPE_LIVE)
                .setContentType("application/x-mpegURL")
                .setMetadata(metadata)
                .build();
            
            // Load media
            MediaLoadRequestData loadRequest = new MediaLoadRequestData.Builder()
                .setMediaInfo(mediaInfo)
                .setAutoplay(true)
                .build();
            
            remoteMediaClient.load(loadRequest);
            android.util.Log.d("IvsPlayerManager", "Media loaded to cast: " + currentMediaUrl);
            
        } catch (Exception e) {
            android.util.Log.e("IvsPlayerManager", "Failed to load media to cast: " + e.getMessage());
        }
    }
    
    /**
     * Handle back button press
     * Returns true if handled (fullscreen exited), false if not handled (let page handle it)
     */
    public boolean handleBackPress() {
        if (isFullscreen) {
            exitFullscreen();
            return true; // Handled - exited fullscreen
        }
        // In minimized mode - don't destroy, let the page handle back navigation
        return false; // Not handled - let page back button work
    }
    
    private void setupMediaSession() {
        ComponentName mediaButtonReceiver = new ComponentName(activity, MediaButtonReceiver.class);
        mediaSession = new MediaSessionCompat(activity, "IvsVideoPlayer", mediaButtonReceiver, null);
        
        mediaSession.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS |
            MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
        
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                play();
            }
            
            @Override
            public void onPause() {
                pause();
            }
            
            @Override
            public void onSeekTo(long pos) {
                seekTo(pos);
            }
        });
        
        // Set initial metadata
        MediaMetadataCompat.Builder metadataBuilder = new MediaMetadataCompat.Builder();
        metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_TITLE, "Live Stream");
        metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_ARTIST, "Sampradaya Events");
        mediaSession.setMetadata(metadataBuilder.build());
        
        mediaSession.setActive(true);
        
        // Note: In ExoPlayer 2.19+, MediaSession integration is handled differently
        // The player automatically integrates with MediaSession through the MediaSessionConnector
        // or through the new Media3 library. For now, we'll manage state manually.
    }
    
    private void updateMediaSessionState(int playbackState) {
        int state = PlaybackStateCompat.STATE_NONE;
        switch (playbackState) {
            case Player.STATE_BUFFERING:
                state = PlaybackStateCompat.STATE_BUFFERING;
                break;
            case Player.STATE_READY:
                state = player.getPlayWhenReady() ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
                break;
            case Player.STATE_ENDED:
                state = PlaybackStateCompat.STATE_STOPPED;
                break;
        }
        
        PlaybackStateCompat.Builder stateBuilder = new PlaybackStateCompat.Builder();
        stateBuilder.setState(state, player.getCurrentPosition(), 1.0f);
        stateBuilder.setActions(
            PlaybackStateCompat.ACTION_PLAY |
            PlaybackStateCompat.ACTION_PAUSE |
            PlaybackStateCompat.ACTION_SEEK_TO
        );
        mediaSession.setPlaybackState(stateBuilder.build());
    }
    
    private void updateMediaSessionPlaybackState(boolean isPlaying) {
        int state = isPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
        PlaybackStateCompat.Builder stateBuilder = new PlaybackStateCompat.Builder();
        stateBuilder.setState(state, player.getCurrentPosition(), 1.0f);
        stateBuilder.setActions(
            PlaybackStateCompat.ACTION_PLAY |
            PlaybackStateCompat.ACTION_PAUSE |
            PlaybackStateCompat.ACTION_SEEK_TO
        );
        mediaSession.setPlaybackState(stateBuilder.build());
    }
    
    public void play() {
        if (player != null) {
            player.setPlayWhenReady(true);
        }
    }
    
    public void pause() {
        if (player != null) {
            player.setPlayWhenReady(false);
        }
    }
    
    public void seekTo(long positionMs) {
        if (player != null) {
            player.seekTo(positionMs);
        }
    }
    
    public long getCurrentTime() {
        return player != null ? player.getCurrentPosition() : 0;
    }
    
    public long getDuration() {
        return player != null ? player.getDuration() : 0;
    }
    
    public boolean isFullscreen() {
        return isFullscreen;
    }
    
    /**
     * Toggle fullscreen WITHOUT destroying the player
     * This preserves decoder, buffer, and audio continuity
     */
    public void toggleFullscreen() {
        if (isFullscreen) {
            exitFullscreen();
        } else {
            enterFullscreen();
        }
    }

    /**
     * Enter fullscreen on initialization (called automatically)
     */
    private void enterFullscreenOnInit() {
        isFullscreen = true;
        originalOrientation = activity.getRequestedOrientation();
        activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemUI();
        updateFullscreenButtonIcon();
        android.util.Log.d("IvsPlayerManager", "enterFullscreenOnInit: started in fullscreen landscape");
    }
    
    private void enterFullscreen() {
        if (isFullscreen) return;
        isFullscreen = true;

        originalOrientation = activity.getRequestedOrientation();
        activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);

        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
        params.leftMargin = 0;
        params.topMargin = 0;
        playerContainer.setLayoutParams(params);

        activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemUI();
        updateFullscreenButtonIcon();
        android.util.Log.d("IvsPlayerManager", "enterFullscreen: switched to fullscreen");
    }


    private void exitFullscreen() {
        if (!isFullscreen) return;
        isFullscreen = false;

        activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        showSystemUI();
        
        // Position as centered overlay after a short delay to allow orientation change
        playerContainer.postDelayed(() -> {
            positionAsCenteredOverlay();
        }, 100);
        
        updateFullscreenButtonIcon();
        android.util.Log.d("IvsPlayerManager", "exitFullscreen: switched to centered overlay");
    }


    
    private void hideSystemUI() {
        View decorView = activity.getWindow().getDecorView();
        int uiOptions = View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
        decorView.setSystemUiVisibility(uiOptions);
    }
    
    private void showSystemUI() {
        View decorView = activity.getWindow().getDecorView();
        decorView.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
    }
    
    /**
     * CRITICAL: Only destroy player when truly done
     * NOT on pause or fullscreen toggle
     */
    public void destroy() {
        // Exit fullscreen first if needed
        if (isFullscreen) {
            exitFullscreen();
        }
        
        if (player != null) {
            player.release();
            player = null;
        }
        
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        
        // Clean up Cast session listener
        if (sessionManager != null && sessionManagerListener != null) {
            sessionManager.removeSessionManagerListener(sessionManagerListener, CastSession.class);
        }
        castSession = null;
        
        // Clean up DLNA service
        if (dlnaService != null) {
            dlnaService.destroy();
            dlnaService = null;
        }
        
        // Remove fullscreen root from decor view if present
        if (fullscreenRoot != null && fullscreenRoot.getParent() != null) {
            ((ViewGroup) fullscreenRoot.getParent()).removeView(fullscreenRoot);
        }
        
        // Remove player container from its parent (embedded or fullscreen)
        if (playerContainer != null && playerContainer.getParent() != null) {
            ((ViewGroup) playerContainer.getParent()).removeView(playerContainer);
        }
        
        playerContainer = null;
        fullscreenRoot = null;
        playerView = null;
        fullscreenButton = null;
        castButton = null;
        dlnaButton = null;
    }
}
