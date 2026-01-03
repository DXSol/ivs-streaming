package com.dxsoltech.sampradayaevents;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;
import com.dxsoltech.sampradayaevents.videoplayer.IvsVideoPlayerPlugin;
import java.util.ArrayList;

public class MainActivity extends BridgeActivity {
    
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register custom plugins BEFORE calling super.onCreate()
        registerPlugin(IvsVideoPlayerPlugin.class);
        
        super.onCreate(savedInstanceState);
        
        // Configure WebView for background audio playback
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebSettings settings = getBridge().getWebView().getSettings();
            
            // Allow media to play without user gesture
            settings.setMediaPlaybackRequiresUserGesture(false);
            
            // Enable JavaScript (already enabled by Capacitor, but explicit for clarity)
            settings.setJavaScriptEnabled(true);
            
            // Allow mixed content for media streaming
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
    }
    
    @Override
    public void onPause() {
        super.onPause();
        // Keep WebView active for background audio
        // Don't call pauseTimers() which would pause media playback
    }
    
    @Override
    public void onResume() {
        super.onResume();
        // Resume WebView timers if needed
    }
}
