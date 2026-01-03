import Foundation
import Capacitor
import AVFoundation
import AVKit

@objc(IvsVideoPlayerPlugin)
public class IvsVideoPlayerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IvsVideoPlayerPlugin"
    public let jsName = "IvsVideoPlayer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "toggleFullscreen", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "destroy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCurrentTime", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDuration", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seekTo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "handleBackPress", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPlayerBounds", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showBadge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hideBadge", returnType: CAPPluginReturnPromise)
    ]
    
    private var playerManager: IvsPlayerManager?
    
    public override func load() {
        playerManager = IvsPlayerManager()
    }
    
    @objc func initialize(_ call: CAPPluginCall) {
        guard let url = call.getString("url") else {
            call.reject("URL is required")
            return
        }
        
        let playerId = call.getString("playerId") ?? "ivs-player"
        let autoplay = call.getBool("autoplay") ?? true
        
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let bridge = self.bridge else {
                call.reject("Plugin not initialized")
                return
            }
            
            do {
                try self.playerManager?.initialize(
                    url: url,
                    playerId: playerId,
                    autoplay: autoplay,
                    viewController: bridge.viewController!
                )
                call.resolve(["success": true])
            } catch {
                call.reject("Failed to initialize player: \(error.localizedDescription)")
            }
        }
    }
    
    @objc func play(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.playerManager?.play()
            call.resolve(["success": true])
        }
    }
    
    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.playerManager?.pause()
            call.resolve(["success": true])
        }
    }
    
    @objc func toggleFullscreen(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            let isFullscreen = self?.playerManager?.toggleFullscreen() ?? false
            call.resolve([
                "success": true,
                "isFullscreen": isFullscreen
            ])
        }
    }
    
    @objc func destroy(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.playerManager?.destroy()
            call.resolve(["success": true])
        }
    }
    
    @objc func getCurrentTime(_ call: CAPPluginCall) {
        let currentTime = playerManager?.getCurrentTime() ?? 0
        call.resolve(["currentTime": currentTime])
    }
    
    @objc func getDuration(_ call: CAPPluginCall) {
        let duration = playerManager?.getDuration() ?? 0
        call.resolve(["duration": duration])
    }
    
    @objc func seekTo(_ call: CAPPluginCall) {
        guard let seekTime = call.getDouble("seekTime") else {
            call.reject("seekTime is required")
            return
        }
        
        DispatchQueue.main.async { [weak self] in
            self?.playerManager?.seekTo(timeMs: seekTime)
            call.resolve(["success": true])
        }
    }
    
    @objc func handleBackPress(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            let handled = self?.playerManager?.handleBackPress() ?? false
            call.resolve(["handled": handled])
        }
    }
    
    @objc func setPlayerBounds(_ call: CAPPluginCall) {
        guard let x = call.getInt("x"),
              let y = call.getInt("y"),
              let width = call.getInt("width"),
              let height = call.getInt("height") else {
            call.reject("x, y, width, and height are required")
            return
        }
        
        DispatchQueue.main.async { [weak self] in
            self?.playerManager?.setPlayerBounds(x: x, y: y, width: width, height: height)
            call.resolve(["success": true])
        }
    }
    
    @objc func showBadge(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? "LIVE"
        let isLive = call.getBool("isLive") ?? true
        
        DispatchQueue.main.async { [weak self] in
            self?.playerManager?.showBadge(text: text, isLive: isLive)
            call.resolve(["success": true])
        }
    }
    
    @objc func hideBadge(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.playerManager?.hideBadge()
            call.resolve(["success": true])
        }
    }
}
