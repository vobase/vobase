# Media Player

A fully featured media player component supporting video and audio playback with custom controls.

## Installation

> **Prerequisites:** Before installing the media player component, you'll need to update your existing shadcn/ui components to support portal containers.


  
    **DropdownMenu**
    ```diff
    function DropdownMenuContent({
      className,
    + container,
      sideOffset = 4,
      ...props
    -}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
    +}: React.ComponentProps<typeof DropdownMenuPrimitive.Content> & {
    +  container?: DropdownMenuPrimitive.DropdownMenuPortalProps["container"];
    +}) {
      return (
    -    <DropdownMenuPrimitive.Portal>
    +    <DropdownMenuPrimitive.Portal container={container}>
    ```
  
  
  **Tooltip**
    ```diff
    function TooltipContent({
      className,
      sideOffset = 0,
    + container,
      children,
      ...props
    -}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
    +}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
    +  container?: TooltipPrimitive.TooltipPortalProps["container"];
    +}) {
      return (
    -    <TooltipPrimitive.Portal>
    +    <TooltipPrimitive.Portal container={container}>
    ```
  


### CLI


  
    After completing the prerequisite component updates, install the media player:

    ```package-install
    npx shadcn@latest add @diceui/media-player
    ```
  


### Manual


  
     After completing the prerequisite component updates, install the required dependencies:

     ```package-install
     @radix-ui/react-slot @radix-ui/react-slider @radix-ui/react-tooltip lucide-react
     ```
  
  
    Copy and paste the refs composition utilities into your `lib/compose-refs.ts` file.

    
  
  
    Copy and paste the following hook into your `hooks` directory.

    
  
  
    Copy and paste the following code into your project.

    
  
  
    Update the import paths to match your project setup.
  


## Layout

Import the parts, and compose them together.

```tsx

  MediaPlayer,
  MediaPlayerVideo,
  MediaPlayerAudio,
  MediaPlayerLoading,
  MediaPlayerError,
  MediaPlayerVolumeIndicator,
  MediaPlayerControls,
  MediaPlayerControlsOverlay,
  MediaPlayerPlay,
  MediaPlayerSeekBackward,
  MediaPlayerSeekForward,
  MediaPlayerVolume,
  MediaPlayerSeek,
  MediaPlayerTime,
  MediaPlayerPlaybackSpeed,
  MediaPlayerLoop,
  MediaPlayerCaptions,
  MediaPlayerFullscreen,
  MediaPlayerDownload,
  MediaPlayerSettings,
} from "@/components/ui/media-player";

return (
  <MediaPlayer>
    <MediaPlayerVideo>
      <source src="..." type="video/mp4" />
    </MediaPlayerVideo>
    <MediaPlayerLoading />
    <MediaPlayerError />
    <MediaPlayerVolumeIndicator />
    <MediaPlayerControls>
      <MediaPlayerControlsOverlay />
      <MediaPlayerPlay />
      <MediaPlayerSeekBackward />
      <MediaPlayerSeekForward />
      <MediaPlayerVolume />
      <MediaPlayerSeek />
      <MediaPlayerTime />
      <MediaPlayerPlaybackSpeed />
      <MediaPlayerLoop />
      <MediaPlayerCaptions />
      <MediaPlayer.PiP />
      <MediaPlayer.Fullscreen />
      <MediaPlayer.Download />
    </MediaPlayer.Controls>
  </MediaPlayer.Root>
)
```

## Examples

### Audio Player

Use the `Audio` component instead of `Video` for audio playback.


### With Settings Menu

Media player with a settings menu with playback speed, caption option, and resolution selector.


### HLS Playback

Media player with HLS (HTTP Live Streaming) support for adaptive bitrate streaming.

This example demonstrates using the [Mux Video React](https://github.com/muxinc/elements/tree/main/packages/mux-video-react) package as the video element to enable HLS playback.


### With Error Handling

Media player with custom error handling and retry functionality.


### With Playlist

A media player example that includes a playlist, similar to music streaming applications.


## API Reference

### MediaPlayer

The main container component for the media player.

> Props: `MediaPlayerProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/media-player)

### MediaPlayerVideo

The video element, integrated with the player state.

> Props: `MediaPlayerVideoProps`

### MediaPlayerAudio

The audio element, integrated with the player state.

> Props: `MediaPlayerAudioProps`

### MediaPlayerControls

A container for the media player controls.

> Props: `MediaPlayerControlsProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/media-player)

### ControlsOverlay

Displays as a subtle backdrop that improves readability for media controls.

> Props: `MediaPlayerControlsOverlayProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/media-player)

### MediaPlayerLoading

A loading indicator that appears when media is loading, similar to YouTube/Netflix style.

> Props: `MediaPlayerLoadingProps`

### MediaPlayerError

An error component that displays when media playback encounters an error, with retry and reload options.

> Props: `MediaPlayerErrorProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/media-player)

### VolumeIndicator

A volume indicator that appears when the volume is changed with keyboard interactions.

> Props: `MediaPlayerVolumeIndicatorProps`

### MediaPlayerPlay

A button to play or pause the media.

> Props: `MediaPlayerPlayProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/media-player)

### SeekBackward

A button to seek backward in the media.

> Props: `MediaPlayerSeekBackwardProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/media-player)

### SeekForward

A button to seek forward in the media.

> Props: `MediaPlayerSeekForwardProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/media-player)

### MediaPlayerSeek

A slider component to seek through the media playback.

> Props: `MediaPlayerSeekProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/media-player)

#### Styling

```tsx
<MediaPlayer.Seek 
  className={
    cn(
      "[&_[data-slot='media-player-seek-buffered']]:bg-primary/60",
      "[&_[data-slot='media-player-seek-hover-range']]:bg-primary/70",
      "[&_[data-slot='media-player-seek-chapter-separator']]:w-1 [&_[data-slot='media-player-seek-chapter-separator']]:bg-muted",
      "[&_[data-slot='media-player-seek-thumbnail']]:border-2 [&_[data-slot='media-player-seek-thumbnail']]:border-ring"
    )
  }
/>
```

### MediaPlayerVolume

A slider component to control the media volume.

> Props: `MediaPlayerVolumeProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/media-player)

### MediaPlayerTime

Displays the current time, duration, or remaining time of the media.

> Props: `MediaPlayerTimeProps`

### PlaybackSpeed

A select dropdown to control the media playback speed.

> Props: `MediaPlayerPlaybackSpeedProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/media-player)

### MediaPlayerLoop

A button to toggle loop mode.

> Props: `MediaPlayerLoopProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/media-player)

### MediaPlayerFullscreen

A button to toggle fullscreen mode.

> Props: `MediaPlayerFullscreenProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/media-player)

### PiP (Picture in picture)

A button to toggle picture in picture mode (video only).

> Props: `MediaPlayerPiPProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/media-player)

### MediaPlayerCaptions

A button to toggle captions or subtitles (video only).

> Props: `MediaPlayerCaptionsProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/media-player)

### MediaPlayerDownload

A button to download the media file.

> Props: `MediaPlayerDownloadProps`

> Data attributes available — see [docs](https://diceui.com/docs/components/media-player)

### MediaPlayerSettings

A dropdown menu with playback speed selector, caption selector, and resolution selector.

> Props: `MediaPlayerSettingsProps`

**Features:**
- Playback speed control with customizable speeds
- Video quality/resolution selection (when available)
- Captions/subtitles control
- Organized in a clean dropdown interface

```tsx
<MediaPlayer.Settings 
  speeds={[0.5, 0.75, 1, 1.25, 1.5, 2]}
/>
```

> Data attributes available — see [docs](https://diceui.com/docs/components/media-player)

## Accessibility

### Keyboard Interactions

> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/media-player) 

## Credits

- [FASSounds](https://pixabay.com/users/fassounds-3433550/?utm_source=link-attribution&utm_medium=referral&utm_campaign=music&utm_content=160166) - For the audio file used in basic examples.
- [Pika](https://pika.art) - For the video file used in basic examples.
- [Elephants Dream](https://orange.blender.org/) - Open movie by the Blender Foundation, used in settings demo under Creative Commons Attribution 2.5.
- [Mux](https://www.mux.com/) - For HLS video streaming and VTT files used in HLS and settings demos.
- [Media Chrome](https://www.media-chrome.org/) - For VTT chapter and caption files used in examples.
- [RandomMind](https://opengameart.org/users/randommind) - For "Medieval: Battle" track used in playlist demo, available under CC0 from OpenGameArt.org.
- [The Lemming Shepherds](https://www.dropbox.com/s/mvvwaw1msplnteq/City%20Lights%20-%20The%20Lemming%20Shepherds.mp3) - For "City Lights" track used in playlist demo.
- [Picsum](https://picsum.photos/) - For placeholder cover images used in playlist demo.