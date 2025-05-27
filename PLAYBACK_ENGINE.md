# that72.org Playback Engine

A standalone JavaScript library for playing songs created with the that72.org editor. This engine can be embedded in web applications to play back `.json` song files with 72-EDO microtonal support.

## Features

- 🎵 Full 72-EDO (equal divisions of octave) microtonal support
- 🎹 100 Organya wavetable instruments
- 🔁 Loop support with customizable start/end points
- 🎚️ Per-note volume and pan automation
- 👁️ Track visibility control
- 🎯 Precise scheduling with Web Audio API
- 📦 No UI dependencies - bring your own interface

## Installation

Include the required files in your project:

```
js/
├── PlaybackEngine.js    # Main playback engine
├── AudioEngine.js       # Audio synthesis engine
├── constants.js         # Musical constants
└── wavetable.bin        # Organya wavetable data
```

## Quick Start

```javascript
import PlaybackEngine from './PlaybackEngine.js';

// Create and initialize player
const player = new PlaybackEngine();
await player.init();

// Load a song
const songData = {
    version: "1.1",
    tempo: 120,
    notes: [
        {
            pitch: 60,      // MIDI note (60 = C4)
            measure: 0,     // Measure number
            beat: 0,        // Beat position (0-15)
            duration: 4,    // Duration in beats
            velocity: 100,  // Volume (0-127)
            instrument: "ORG_M00"
        }
    ]
};

player.loadSong(songData);

// Play the song
player.play();
```

## API Reference

### Constructor

```javascript
const player = new PlaybackEngine({
    wavetablePath: './wavetable.bin',  // Path to wavetable file
    onNoteStart: (note) => {},         // Called when note starts
    onNoteEnd: (note) => {},           // Called when note ends
    onMeasureChange: (measure) => {},  // Called on measure change
    onStop: () => {}                   // Called when playback stops
});
```

### Methods

#### `async init()`
Initialize the engine and load the wavetable.

#### `loadSong(songData)`
Load a song from JSON data or string.

#### `play(fromMeasure?)`
Start playback from current position or specified measure.

#### `pause()`
Pause playback (maintains position).

#### `stop()`
Stop playback and reset to beginning.

#### `setVolume(volume)`
Set master volume (0-100).

#### `setTempo(bpm)`
Set playback tempo in beats per minute.

#### `setLoop(enabled, start?, end?)`
Configure loop settings.

#### `setTrackVisibility(trackName, visible)`
Show/hide specific instrument tracks.

#### `getTracks()`
Get list of all tracks in the song.

### Song Format

Songs are stored as JSON with the following structure:

```json
{
    "version": "1.1",
    "name": "Song Name",
    "tempo": 120,
    "timeSignature": "4/4",
    "loop": {
        "enabled": true,
        "startMeasure": 0,
        "endMeasure": 8
    },
    "notes": [
        {
            "pitch": 60,
            "measure": 0,
            "beat": 0,
            "duration": 4,
            "velocity": 100,
            "pan": 0,
            "instrument": "ORG_M00",
            "pipi": false,
            "volumeAutomation": [],
            "panAutomation": []
        }
    ]
}
```

### Note Properties

- `pitch`: MIDI note number (0-127) mapped to 72-EDO
- `measure`: Measure number (0-based)
- `beat`: Beat position within measure (0-15 for 16th note resolution)
- `duration`: Note length in beats
- `velocity`: Volume (0-127)
- `pan`: Stereo position (-100 to 100)
- `instrument`: Instrument name (e.g., "ORG_M00", "ORG_D00")
- `pipi`: Boolean for pitch modulation effect
- `volumeAutomation`: Array of volume changes over time
- `panAutomation`: Array of pan changes over time

### Instrument Names

- **Melodic**: ORG_M00 to ORG_M99
- **Drums**: ORG_D00 to ORG_D99

## Example: Custom Player UI

See `example-player.html` for a complete example with:
- Play/pause/stop controls
- Volume slider
- Loop toggle
- Track visibility controls
- Real-time note visualization
- File loading

## Browser Support

Requires modern browsers with:
- ES6 modules
- Web Audio API
- async/await support

## License

This playback engine is part of the that72.org project.