package com.dxsoltech.sampradayaevents.videoplayer;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "IvsVideoPlayer")
public class IvsVideoPlayerPlugin extends Plugin {

    private IvsPlayerManager playerManager;

    @Override
    public void load() {
        playerManager = new IvsPlayerManager(getActivity(), getBridge());
    }

    @PluginMethod
    public void initialize(PluginCall call) {
        String url = call.getString("url");
        String playerId = call.getString("playerId", "ivs-player");
        boolean autoplay = call.getBoolean("autoplay", true);
        
        if (url == null) {
            call.reject("URL is required");
            return;
        }

        getActivity().runOnUiThread(() -> {
            try {
                playerManager.initialize(url, playerId, autoplay);
                JSObject ret = new JSObject();
                ret.put("success", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to initialize player: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            playerManager.play();
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            playerManager.pause();
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void toggleFullscreen(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                playerManager.toggleFullscreen();
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("isFullscreen", playerManager.isFullscreen());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to toggle fullscreen: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void destroy(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            playerManager.destroy();
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void getCurrentTime(PluginCall call) {
        long currentTime = playerManager.getCurrentTime();
        JSObject ret = new JSObject();
        ret.put("currentTime", currentTime);
        call.resolve(ret);
    }

    @PluginMethod
    public void getDuration(PluginCall call) {
        long duration = playerManager.getDuration();
        JSObject ret = new JSObject();
        ret.put("duration", duration);
        call.resolve(ret);
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        Long seekTime = call.getLong("seekTime");
        if (seekTime == null) {
            call.reject("seekTime is required");
            return;
        }
        
        getActivity().runOnUiThread(() -> {
            playerManager.seekTo(seekTime);
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void handleBackPress(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            boolean handled = playerManager.handleBackPress();
            JSObject ret = new JSObject();
            ret.put("handled", handled);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void setPlayerBounds(PluginCall call) {
        Integer x = call.getInt("x");
        Integer y = call.getInt("y");
        Integer width = call.getInt("width");
        Integer height = call.getInt("height");

        if (x == null || y == null || width == null || height == null) {
            call.reject("x, y, width, and height are required");
            return;
        }

        getActivity().runOnUiThread(() -> {
            playerManager.setPlayerBounds(x, y, width, height);
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void showBadge(PluginCall call) {
        String text = call.getString("text", "LIVE");
        boolean isLive = call.getBoolean("isLive", true);

        getActivity().runOnUiThread(() -> {
            playerManager.showBadge(text, isLive);
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void hideBadge(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            playerManager.hideBadge();
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (playerManager != null) {
            playerManager.destroy();
        }
    }
}
