import Foundation
import AVFoundation
import AVKit
import UIKit
import MediaPlayer

class IvsPlayerManager: NSObject {
    
    private var player: AVPlayer?
    private var playerViewController: AVPlayerViewController?
    private var playerLayer: AVPlayerLayer?
    private var containerView: UIView?
    private var parentViewController: UIViewController?
    private var isFullscreen = false
    private var playerId: String = ""
    
    // Badge view for LIVE/RECORDING indicator
    private var badgeView: UIView?
    private var badgeLabel: UILabel?
    
    // Observers
    private var timeObserver: Any?
    private var statusObserver: NSKeyValueObservation?
    
    override init() {
        super.init()
        setupAudioSession()
        setupRemoteCommandCenter()
        setupNotifications()
    }
    
    deinit {
        destroy()
    }
    
    // MARK: - Audio Session Setup for Background Playback
    
    private func setupAudioSession() {
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playback, mode: .moviePlayback, options: [.allowAirPlay])
            try audioSession.setActive(true)
            print("[IvsPlayerManager] Audio session configured for background playback")
        } catch {
            print("[IvsPlayerManager] Failed to setup audio session: \(error)")
        }
    }
    
    // MARK: - Remote Command Center (Lock Screen Controls)
    
    private func setupRemoteCommandCenter() {
        let commandCenter = MPRemoteCommandCenter.shared()
        
        commandCenter.playCommand.isEnabled = true
        commandCenter.playCommand.addTarget { [weak self] _ in
            self?.play()
            return .success
        }
        
        commandCenter.pauseCommand.isEnabled = true
        commandCenter.pauseCommand.addTarget { [weak self] _ in
            self?.pause()
            return .success
        }
        
        commandCenter.togglePlayPauseCommand.isEnabled = true
        commandCenter.togglePlayPauseCommand.addTarget { [weak self] _ in
            if self?.player?.rate == 0 {
                self?.play()
            } else {
                self?.pause()
            }
            return .success
        }
    }
    
    private func updateNowPlayingInfo() {
        var nowPlayingInfo = [String: Any]()
        nowPlayingInfo[MPMediaItemPropertyTitle] = "Live Stream"
        nowPlayingInfo[MPMediaItemPropertyArtist] = "Sampradaya Events"
        
        if let player = player, let currentItem = player.currentItem {
            let duration = CMTimeGetSeconds(currentItem.duration)
            if !duration.isNaN && duration.isFinite {
                nowPlayingInfo[MPMediaItemPropertyPlaybackDuration] = duration
            }
            
            let currentTime = CMTimeGetSeconds(player.currentTime())
            if !currentTime.isNaN {
                nowPlayingInfo[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime
            }
        }
        
        nowPlayingInfo[MPNowPlayingInfoPropertyPlaybackRate] = player?.rate ?? 0
        
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nowPlayingInfo
    }
    
    // MARK: - Notifications
    
    private func setupNotifications() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleInterruption),
            name: AVAudioSession.interruptionNotification,
            object: nil
        )
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleRouteChange),
            name: AVAudioSession.routeChangeNotification,
            object: nil
        )
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(playerDidFinishPlaying),
            name: .AVPlayerItemDidPlayToEndTime,
            object: nil
        )
    }
    
    @objc private func handleInterruption(notification: Notification) {
        guard let userInfo = notification.userInfo,
              let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else {
            return
        }
        
        switch type {
        case .began:
            pause()
        case .ended:
            if let optionsValue = userInfo[AVAudioSessionInterruptionOptionKey] as? UInt {
                let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
                if options.contains(.shouldResume) {
                    play()
                }
            }
        @unknown default:
            break
        }
    }
    
    @objc private func handleRouteChange(notification: Notification) {
        guard let userInfo = notification.userInfo,
              let reasonValue = userInfo[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue) else {
            return
        }
        
        switch reason {
        case .oldDeviceUnavailable:
            // Headphones were unplugged - pause playback
            pause()
        default:
            break
        }
    }
    
    @objc private func playerDidFinishPlaying(notification: Notification) {
        print("[IvsPlayerManager] Playback finished")
    }
    
    // MARK: - Player Initialization
    
    func initialize(url: String, playerId: String, autoplay: Bool, viewController: UIViewController) throws {
        self.playerId = playerId
        self.parentViewController = viewController
        
        guard let videoURL = URL(string: url) else {
            throw NSError(domain: "IvsPlayerManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid URL"])
        }
        
        // Create AVPlayer with HLS stream
        let playerItem = AVPlayerItem(url: videoURL)
        player = AVPlayer(playerItem: playerItem)
        player?.allowsExternalPlayback = true // Enable AirPlay/Chromecast
        
        // Observe player status
        statusObserver = playerItem.observe(\.status, options: [.new]) { [weak self] item, _ in
            switch item.status {
            case .readyToPlay:
                print("[IvsPlayerManager] Player ready to play")
                self?.updateNowPlayingInfo()
            case .failed:
                print("[IvsPlayerManager] Player failed: \(item.error?.localizedDescription ?? "Unknown error")")
            case .unknown:
                print("[IvsPlayerManager] Player status unknown")
            @unknown default:
                break
            }
        }
        
        // Add periodic time observer for Now Playing info updates
        timeObserver = player?.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 1, preferredTimescale: 1),
            queue: .main
        ) { [weak self] _ in
            self?.updateNowPlayingInfo()
        }
        
        // Create fullscreen player view controller
        playerViewController = AVPlayerViewController()
        playerViewController?.player = player
        playerViewController?.allowsPictureInPicturePlayback = true
        playerViewController?.showsPlaybackControls = true
        
        // Present in fullscreen
        presentFullscreen(autoplay: autoplay)
        
        print("[IvsPlayerManager] Player initialized with URL: \(url)")
    }
    
    private func presentFullscreen(autoplay: Bool) {
        guard let playerVC = playerViewController, let parentVC = parentViewController else { return }
        
        playerVC.modalPresentationStyle = .fullScreen
        
        parentVC.present(playerVC, animated: true) { [weak self] in
            self?.isFullscreen = true
            if autoplay {
                self?.play()
            }
        }
    }
    
    // MARK: - Playback Controls
    
    func play() {
        player?.play()
        updateNowPlayingInfo()
        print("[IvsPlayerManager] Playing")
    }
    
    func pause() {
        player?.pause()
        updateNowPlayingInfo()
        print("[IvsPlayerManager] Paused")
    }
    
    func toggleFullscreen() -> Bool {
        if isFullscreen {
            // Exit fullscreen
            playerViewController?.dismiss(animated: true) { [weak self] in
                self?.isFullscreen = false
            }
        } else {
            // Enter fullscreen
            presentFullscreen(autoplay: false)
        }
        return !isFullscreen
    }
    
    func getCurrentTime() -> Double {
        guard let player = player else { return 0 }
        return CMTimeGetSeconds(player.currentTime()) * 1000 // Return in milliseconds
    }
    
    func getDuration() -> Double {
        guard let player = player, let currentItem = player.currentItem else { return 0 }
        let duration = CMTimeGetSeconds(currentItem.duration)
        return duration.isNaN ? 0 : duration * 1000 // Return in milliseconds
    }
    
    func seekTo(timeMs: Double) {
        let time = CMTime(seconds: timeMs / 1000, preferredTimescale: 1000)
        player?.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero)
        print("[IvsPlayerManager] Seeking to \(timeMs)ms")
    }
    
    func handleBackPress() -> Bool {
        if isFullscreen {
            playerViewController?.dismiss(animated: true) { [weak self] in
                self?.isFullscreen = false
                self?.destroy()
            }
            return true
        }
        return false
    }
    
    func setPlayerBounds(x: Int, y: Int, width: Int, height: Int) {
        // For fullscreen mode, bounds are managed by AVPlayerViewController
        // This is mainly for embedded mode which we're not using
        print("[IvsPlayerManager] setPlayerBounds called - using fullscreen mode")
    }
    
    // MARK: - Badge (LIVE/RECORDING indicator)
    
    func showBadge(text: String, isLive: Bool) {
        guard let playerVC = playerViewController else { return }
        
        // Remove existing badge
        hideBadge()
        
        // Create badge view
        let badge = UIView()
        badge.backgroundColor = isLive ? UIColor.red : UIColor.orange
        badge.layer.cornerRadius = 4
        badge.translatesAutoresizingMaskIntoConstraints = false
        
        let label = UILabel()
        label.text = text
        label.textColor = .white
        label.font = UIFont.boldSystemFont(ofSize: 12)
        label.translatesAutoresizingMaskIntoConstraints = false
        
        badge.addSubview(label)
        playerVC.contentOverlayView?.addSubview(badge)
        
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: badge.leadingAnchor, constant: 8),
            label.trailingAnchor.constraint(equalTo: badge.trailingAnchor, constant: -8),
            label.topAnchor.constraint(equalTo: badge.topAnchor, constant: 4),
            label.bottomAnchor.constraint(equalTo: badge.bottomAnchor, constant: -4),
            
            badge.topAnchor.constraint(equalTo: playerVC.contentOverlayView!.safeAreaLayoutGuide.topAnchor, constant: 16),
            badge.leadingAnchor.constraint(equalTo: playerVC.contentOverlayView!.safeAreaLayoutGuide.leadingAnchor, constant: 16)
        ])
        
        badgeView = badge
        badgeLabel = label
    }
    
    func hideBadge() {
        badgeView?.removeFromSuperview()
        badgeView = nil
        badgeLabel = nil
    }
    
    // MARK: - Cleanup
    
    func destroy() {
        // Remove observers
        if let observer = timeObserver {
            player?.removeTimeObserver(observer)
            timeObserver = nil
        }
        statusObserver?.invalidate()
        statusObserver = nil
        
        // Stop playback
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        
        // Dismiss player view controller
        if isFullscreen {
            playerViewController?.dismiss(animated: false)
        }
        
        // Clear references
        player = nil
        playerViewController = nil
        containerView?.removeFromSuperview()
        containerView = nil
        playerLayer = nil
        hideBadge()
        
        // Clear Now Playing info
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        
        isFullscreen = false
        
        print("[IvsPlayerManager] Player destroyed")
    }
    
    func isFullscreenMode() -> Bool {
        return isFullscreen
    }
}
