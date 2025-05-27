import { PianoRoll } from './PianoRoll.js';
import { ModalManager } from './ModalManager.js';
import { MenuManager } from './MenuManager.js';
import { PanBar } from './PanBar.js';
import { VelocityBar } from './VelocityBar.js';
import { DEFAULT_VOLUME } from './constants.js';

// Initialize managers
const modalManager = new ModalManager();
window.modalManager = modalManager; // Make it globally accessible
const menuManager = new MenuManager();
let pianoRoll = null;
let panBar = null;
let velocityBar = null;
let currentFilename = null;

// Update page title based on current file
function updatePageTitle() {
    if (currentFilename) {
        document.title = `${currentFilename} - that72.org`;
    } else {
        document.title = 'that72.org - 72-EDO Composition Tool';
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize piano roll
    const canvas = document.getElementById('pianoRoll');
    pianoRoll = new PianoRoll(canvas);
    
    // Initialize pan and velocity bars
    const panCanvas = document.getElementById('panCanvas');
    const velocityCanvas = document.getElementById('velocityCanvas');
    
    if (panCanvas) {
        panBar = new PanBar(panCanvas, pianoRoll);
    }
    
    if (velocityCanvas) {
        velocityBar = new VelocityBar(velocityCanvas, pianoRoll);
        pianoRoll.velocityBar = velocityBar;
    }
    
    
    // Setup UI controls
    setupControls();
    setupModals();
    setupMenus();
    
    // Initialize UI state
    updatePlayButton();
    updatePageTitle();
});

/**
 * Setup control panel interactions
 */
function setupControls() {
    // Play/Pause button
    const playBtn = document.getElementById('playBtn');
    playBtn.addEventListener('click', () => {
        if (pianoRoll.isPlaying && !pianoRoll.isPaused) {
            pianoRoll.pause();
        } else {
            pianoRoll.play();
        }
        updatePlayButton();
    });
    
    // Stop button
    const stopBtn = document.getElementById('stopBtn');
    stopBtn.addEventListener('click', () => {
        pianoRoll.stop();
        updatePlayButton();
    });
    
    // Volume slider
    const volumeSlider = document.getElementById('volumeSlider');
    volumeSlider.value = DEFAULT_VOLUME;
    
    // Create a style for the volume slider fill
    const updateVolumeSliderFill = () => {
        const value = volumeSlider.value;
        const percentage = value;
        volumeSlider.style.background = `linear-gradient(to right, #ff8800 0%, #ff8800 ${percentage}%, #444 ${percentage}%, #444 100%)`;
    };
    
    // Initialize the fill
    updateVolumeSliderFill();
    
    volumeSlider.addEventListener('input', (e) => {
        pianoRoll.audioEngine.setMasterVolume(parseInt(e.target.value));
        updateVolumeSliderFill();
    });
    
    // Instrument selector
    const waveformSelect = document.getElementById('waveformSelect');
    waveformSelect.addEventListener('change', (e) => {
        pianoRoll.currentSample = e.target.value;
        pianoRoll.updateInstrumentColorIndicator();
    });
    
    // Loop button
    const loopBtn = document.getElementById('loopBtn');
    loopBtn.addEventListener('click', () => {
        pianoRoll.loopEnabled = !pianoRoll.loopEnabled;
        loopBtn.classList.toggle('active', pianoRoll.loopEnabled);
    });
    
    
    // Loop range inputs
    const loopStartInput = document.getElementById('loopStartInput');
    const loopEndInput = document.getElementById('loopEndInput');
    
    loopStartInput.addEventListener('change', (e) => {
        const value = parseInt(e.target.value) - 1;
        if (value >= 0 && value < pianoRoll.loopEnd) {
            pianoRoll.loopStart = value;
        } else {
            e.target.value = pianoRoll.loopStart + 1;
        }
    });
    
    loopEndInput.addEventListener('change', (e) => {
        const value = parseInt(e.target.value) - 1;
        if (value > pianoRoll.loopStart && value < pianoRoll.totalMeasures) {
            pianoRoll.loopEnd = value;
        } else {
            e.target.value = pianoRoll.loopEnd + 1;
        }
    });
}

/**
 * Update play button icon
 */
function updatePlayButton() {
    const playIcon = document.getElementById('playIcon');
    const pauseIcon = document.getElementById('pauseIcon');
    
    if (pianoRoll.isPlaying && !pianoRoll.isPaused) {
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
    } else {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
    }
}

/**
 * Setup modal systems
 */
function setupModals() {
    // Register modals
    modalManager.register('songModal');
    modalManager.register('infoModal', {
        onShow: (data) => {
            document.getElementById('infoModalTitle').textContent = data.title || 'Information';
            document.getElementById('infoModalContent').innerHTML = data.content || '';
        }
    });
    modalManager.register('confirmModal');
    modalManager.register('saveAsModal');
    modalManager.register('trackInfoModal');
}

/**
 * Setup menu system
 */
function setupMenus() {
    // Menu configuration
    const menuConfig = {
        file: [
            {
                id: 'menu-new',
                handler: () => handleNew(),
                shortcut: 'Ctrl+N'
            },
            {
                id: 'menu-open',
                handler: () => handleOpen(),
                shortcut: 'Ctrl+O'
            },
            {
                id: 'menu-save',
                handler: () => handleSave(),
                shortcut: 'Ctrl+S'
            },
            {
                id: 'menu-save-as',
                handler: () => handleSaveAs(),
                shortcut: 'Ctrl+Shift+S'
            },
            {
                id: 'menu-import-org',
                handler: () => handleImportOrg()
            },
            {
                id: 'menu-import-midi',
                handler: () => handleImportMidi()
            },
            {
                id: 'menu-clear-all',
                handler: () => handleClearAll()
            }
        ],
        edit: [
            {
                id: 'menu-cut',
                handler: () => handleCut(),
                shortcut: 'Ctrl+X'
            },
            {
                id: 'menu-copy',
                handler: () => handleCopy(),
                shortcut: 'Ctrl+C'
            },
            {
                id: 'menu-paste',
                handler: () => handlePaste(),
                shortcut: 'Ctrl+V'
            },
            {
                id: 'menu-delete',
                handler: () => handleDelete()
                // Remove shortcut to allow Delete key to work in input fields
            },
            {
                id: 'menu-select-all',
                handler: () => handleSelectAll(),
                shortcut: 'Ctrl+A'
            }
        ],
        view: [
            {
                id: 'menu-grid-snap',
                type: 'checkbox',
                checked: true,
                handler: (checked) => {
                    pianoRoll.gridSnap = checked;
                }
            },
            {
                id: 'menu-show-fps',
                type: 'checkbox',
                checked: true,
                handler: (checked) => {
                    pianoRoll.showFPS = checked;
                    pianoRoll.dirty = true;
                }
            },
            {
                id: 'menu-follow-mode',
                type: 'checkbox',
                checked: true,
                handler: (checked) => {
                    pianoRoll.followMode = checked;
                }
            },
            {
                id: 'menu-track-info',
                handler: () => {
                    const trackData = pianoRoll.buildTrackData();
                    pianoRoll.showTrackInfoModal(trackData);
                }
            }
        ],
        tools: [
            {
                id: 'menu-clear-all',
                handler: () => handleClearAll()
            }
        ],
        help: [
            {
                id: 'menu-shortcuts',
                handler: () => showShortcuts()
            },
            {
                id: 'menu-about',
                handler: () => showAbout()
            }
        ]
    };
    
    // Register menus
    menuManager.registerMenus(menuConfig);
    
    // Setup song menu items
    setupSongMenuItems();
}

/**
 * Setup sample song menu items
 */
function setupSongMenuItems() {
    // Direct ORG song links (exclude items with submenus)
    const orgLinks = document.querySelectorAll('[data-org]:not(.has-submenu)');
    orgLinks.forEach(link => {
        link.addEventListener('click', async (e) => {
            e.stopPropagation();
            const orgPath = e.target.getAttribute('data-org');
            
            // Check if it's a directory
            if (orgPath.endsWith('/')) {
                await showSongDirectory(orgPath, false);
            } else {
                await loadOrgFromPath(orgPath);
            }
            
            menuManager.closeAll();
        });
    });
    
    // Direct MIDI song links
    const midiLinks = document.querySelectorAll('[data-midi]');
    midiLinks.forEach(link => {
        link.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();
            const midiPath = e.target.getAttribute('data-midi');
            if (midiPath) {
                await loadMidiFromPath(midiPath);
                menuManager.closeAll();
            }
        });
    });
    
    // MIDI directory links
    const midiDirLinks = document.querySelectorAll('[data-midi-dir]');
    midiDirLinks.forEach(link => {
        link.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();
            const midiDirPath = e.target.getAttribute('data-midi-dir');
            if (midiDirPath) {
                await showSongDirectory(midiDirPath, true);
                menuManager.closeAll();
            }
        });
    });
}

/**
 * Menu handlers
 */
async function handleNew() {
    const confirmed = await modalManager.confirm(
        'Are you sure you want to create a new project? All unsaved changes will be lost.'
    );
    
    if (confirmed) {
        pianoRoll.noteManager.clearAll();
        pianoRoll.stop();
        pianoRoll.dirty = true;
        pianoRoll.emit('notesChanged');
        currentFilename = null;
        updatePageTitle();
        modalManager.notify('New project created', 'info');
    }
}

async function handleImportOrg() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.org';
    
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const buffer = await file.arrayBuffer();
                await pianoRoll.loadOrgFile(buffer);
                modalManager.notify(`Loaded: ${file.name}`, 'info');
            } catch (error) {
                modalManager.notify(`Failed to load file: ${error.message}`, 'error');
            }
        }
    };
    
    input.click();
}

async function handleImportMidi() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mid,.midi';
    
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const buffer = await file.arrayBuffer();
                await pianoRoll.loadMidiFile(buffer);
                modalManager.notify(`Loaded: ${file.name}`, 'info');
            } catch (error) {
                modalManager.notify(`Failed to load MIDI file: ${error.message}`, 'error');
            }
        }
    };
    
    input.click();
}

async function handleClearAll() {
    const confirmed = await modalManager.confirm(
        'Are you sure you want to clear all notes? This cannot be undone.'
    );
    
    if (confirmed) {
        pianoRoll.noteManager.clearAll();
        pianoRoll.stop();
        
        // Reset loop settings
        pianoRoll.loopEnabled = false;
        pianoRoll.loopStart = 0;
        pianoRoll.loopEnd = 4;
        document.getElementById('loopBtn').classList.remove('active');
        document.getElementById('loopStartInput').value = 1;
        document.getElementById('loopEndInput').value = 5;
        
        // Reset tempo to default
        pianoRoll.setTempo(120);
        
        // Clear filename
        pianoRoll.currentFilename = null;
        updatePageTitle();
        pianoRoll.orgTrackInfo = null;
        
        pianoRoll.dirty = true;
        modalManager.notify('New project created', 'info');
    }
}

function handleCut() {
    pianoRoll.noteManager.cutSelectedNotes();
    pianoRoll.emit('notesChanged');
    pianoRoll.dirty = true;
}

function handleCopy() {
    pianoRoll.noteManager.copySelectedNotes();
    modalManager.notify('Notes copied to clipboard', 'info');
}

function handlePaste() {
    // Paste at current mouse position or playhead
    const pasteX = pianoRoll.inputHandler.mouseX || pianoRoll.playheadPos;
    const pasteY = pianoRoll.inputHandler.mouseY || 0;
    
    pianoRoll.noteManager.pasteNotes(pasteX, pasteY);
    pianoRoll.emit('notesChanged');
    pianoRoll.dirty = true;
}

function handleDelete() {
    pianoRoll.noteManager.deleteSelectedNotes();
    pianoRoll.emit('notesChanged');
    pianoRoll.dirty = true;
}

function handleSelectAll() {
    pianoRoll.noteManager.selectAll();
    pianoRoll.dirty = true;
}

/**
 * Show mobile songs menu
 */
function showMobileSongsMenu() {
    // Get current instrument from the selector
    const currentInstrument = document.getElementById('instrumentSelector').value;
    
    const songCategories = `
<div class="mobile-songs-menu">
    <button class="song-category-btn" data-org="songs/Pixel/all/">Cave Story (All Songs)</button>
    <button class="song-category-btn" data-midi-dir="songs/classical/">Classical Music</button>
    <div class="separator"></div>
    <h3>Quick Access</h3>
    <button class="song-quick-btn" data-org="songs/Pixel/all/Cave Story.org">Cave Story</button>
    <button class="song-quick-btn" data-org="songs/Pixel/all/Labyrinth Fight.org">Labyrinth Fight</button>
    <button class="song-quick-btn" data-org="songs/Pixel/all/Mischievous Robot.org">Mischievous Robot</button>
    <button class="song-quick-btn" data-org="songs/Pixel/all/Moonsong.org">Moonsong</button>
    <button class="song-quick-btn" data-org="songs/Pixel/all/Running Hell.org">Running Hell</button>
    <button class="song-quick-btn" data-org="songs/Pixel/all/Torokos Theme.org">Torokos Theme</button>
    <button class="song-quick-btn" data-org="songs/Pixel/all/White.org">White</button>
    <button class="song-quick-btn" data-org="songs/Pixel/all/Wind Fortress.org">Wind Fortress</button>
    <div class="separator"></div>
    <h3>Voice</h3>
    <select id="mobileInstrumentSelector" class="mobile-instrument-select">
        ${Array.from(document.getElementById('instrumentSelector').options).map(option => 
            `<option value="${option.value}" ${option.value === currentInstrument ? 'selected' : ''}>${option.text}</option>`
        ).join('')}
    </select>
</div>`;
    
    modalManager.show('infoModal', {
        title: 'Songs & Voice',
        content: songCategories
    });
    
    // Add event listeners to buttons
    setTimeout(() => {
        document.querySelectorAll('.song-category-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const orgPath = e.target.getAttribute('data-org');
                const midiPath = e.target.getAttribute('data-midi-dir');
                modalManager.close('infoModal');
                if (orgPath) {
                    await showSongDirectory(orgPath, false);
                } else if (midiPath) {
                    await showSongDirectory(midiPath, true);
                }
            });
        });
        
        document.querySelectorAll('.song-quick-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const orgPath = e.target.getAttribute('data-org');
                modalManager.close('infoModal');
                loadOrgFromPath(orgPath);
            });
        });
        
        // Add event listener for mobile instrument selector
        const mobileInstrumentSelector = document.getElementById('mobileInstrumentSelector');
        if (mobileInstrumentSelector) {
            mobileInstrumentSelector.addEventListener('change', (e) => {
                const mainSelector = document.getElementById('instrumentSelector');
                mainSelector.value = e.target.value;
                mainSelector.dispatchEvent(new Event('change'));
            });
        }
    }, 100);
}

/**
 * Show keyboard shortcuts
 */
function showShortcuts() {
    const shortcuts = `
<div class="shortcuts-container">
    <div class="shortcut-section">
        <h3>Playback</h3>
        <div class="shortcut-item">
            <span class="shortcut-key">Space</span>
            <span class="shortcut-desc">Play/Pause</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Enter</span>
            <span class="shortcut-desc">Stop and return to start</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">L</span>
            <span class="shortcut-desc">Toggle loop mode</span>
        </div>
    </div>

    <div class="shortcut-section">
        <h3>File Operations</h3>
        <div class="shortcut-item">
            <span class="shortcut-key">Ctrl+S</span>
            <span class="shortcut-desc">Save project</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Ctrl+O</span>
            <span class="shortcut-desc">Open file</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Ctrl+N</span>
            <span class="shortcut-desc">New project</span>
        </div>
    </div>

    <div class="shortcut-section">
        <h3>Selection & Editing</h3>
        <div class="shortcut-item">
            <span class="shortcut-key">Ctrl+A</span>
            <span class="shortcut-desc">Select all notes</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Ctrl+C</span>
            <span class="shortcut-desc">Copy selected notes</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Ctrl+X</span>
            <span class="shortcut-desc">Cut selected notes</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Ctrl+V</span>
            <span class="shortcut-desc">Paste notes at cursor</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Delete</span>
            <span class="shortcut-desc">Delete selected notes</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Escape</span>
            <span class="shortcut-desc">Deselect all</span>
        </div>
    </div>

    <div class="shortcut-section">
        <h3>Mouse Controls</h3>
        <div class="shortcut-item">
            <span class="shortcut-key">Left Click</span>
            <span class="shortcut-desc">Create/select note</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Right Click</span>
            <span class="shortcut-desc">Delete note</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Middle Click</span>
            <span class="shortcut-desc">Pan view</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Ctrl+Click</span>
            <span class="shortcut-desc">Start box selection</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Shift+Click</span>
            <span class="shortcut-desc">Add to selection</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Alt+Drag</span>
            <span class="shortcut-desc">Duplicate notes</span>
        </div>
    </div>

    <div class="shortcut-section">
        <h3>Navigation</h3>
        <div class="shortcut-item">
            <span class="shortcut-key">Mouse Wheel</span>
            <span class="shortcut-desc">Scroll vertically</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Shift+Wheel</span>
            <span class="shortcut-desc">Scroll horizontally</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Ctrl+Wheel</span>
            <span class="shortcut-desc">Zoom in/out</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Home</span>
            <span class="shortcut-desc">Go to beginning</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">End</span>
            <span class="shortcut-desc">Go to last note</span>
        </div>
    </div>

    <div class="shortcut-section">
        <h3>Touch Controls</h3>
        <div class="shortcut-item">
            <span class="shortcut-key">Single Tap</span>
            <span class="shortcut-desc">Create/select note</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Two Finger Drag</span>
            <span class="shortcut-desc">Scroll view</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Pinch</span>
            <span class="shortcut-desc">Zoom in/out</span>
        </div>
    </div>
</div>`;
    
    modalManager.show('infoModal', {
        title: 'Keyboard Shortcuts',
        content: shortcuts
    });
}

/**
 * Show about dialog
 */
function showAbout() {
    const about = `
<div class="about-container">
    <h2 style="margin-top: 0; color: #4a9eff;">that72.org</h2>
    <p style="color: #ccc; margin-bottom: 20px;">Version 2.0</p>
    
    <p>A microtonal piano roll sequencer featuring 72 equal divisions of the octave (72-EDO), 
    providing precise control with 16.67 cents per step for exploring xenharmonic music.</p>
    
    <h3>Key Features</h3>
    <ul style="list-style: none; padding: 0;">
        <li>• 72-EDO tuning system across 8 octaves</li>
        <li>• Import Organya (.org) and MIDI (.mid) files</li>
        <li>• 100 unique wavetable instruments + 6 drum samples</li>
        <li>• Per-note velocity and pan control</li>
        <li>• Multi-touch support for mobile devices</li>
        <li>• 256 measures with adjustable loop points</li>
        <li>• Real-time visual feedback with follow mode</li>
    </ul>
    
    <h3>Credits</h3>
    <p>Wavetable synthesis engine and instruments from Org Maker<br>
    Cave Story music by Daisuke "Pixel" Amaya<br>
    Classical MIDI arrangements from various sources</p>
    
    <p style="margin-top: 20px; color: #888; font-size: 12px;">
    Built with Web Audio API • Open source on GitHub<br>
    Created for microtonal music exploration and composition
    </p>
</div>`;
    
    modalManager.show('infoModal', {
        title: 'About',
        content: about
    });
}

/**
 * Save song as JSON file
 */
function handleSave() {
    if (currentFilename) {
        downloadSong(currentFilename);
    } else {
        handleSaveAs();
    }
}

/**
 * Save song with custom filename
 */
function handleSaveAs() {
    const input = document.getElementById('saveAsFilename');
    input.value = currentFilename || 'song.json';
    
    // Set up event handlers
    const modal = document.getElementById('saveAsModal');
    const confirmBtn = modal.querySelector('.save-as-confirm');
    const cancelBtn = modal.querySelector('.save-as-cancel');
    const closeBtn = modal.querySelector('.modal-close');
    
    const cleanup = () => {
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        closeBtn.removeEventListener('click', handleCancel);
    };
    
    const handleConfirm = () => {
        let filename = input.value.trim();
        if (filename) {
            if (!filename.endsWith('.json')) {
                filename += '.json';
            }
            currentFilename = filename;
            updatePageTitle();
            downloadSong(filename);
            cleanup();
            modalManager.close('saveAsModal');
        }
    };
    
    const handleCancel = () => {
        cleanup();
        modalManager.close('saveAsModal');
    };
    
    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    closeBtn.addEventListener('click', handleCancel);
    
    // Handle Enter key in input
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            handleConfirm();
        }
    });
    
    modalManager.show('saveAsModal');
    input.focus();
    input.select();
}

/**
 * Download song with given filename
 */
function downloadSong(filename) {
    const jsonData = pianoRoll.exportToJSON();
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    URL.revokeObjectURL(url);
    modalManager.notify('Song saved', 'info');
}

/**
 * Open file dialog to load song
 */
function handleOpen() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            const text = await file.text();
            pianoRoll.importFromJSON(text);
            currentFilename = file.name;
            updatePageTitle();
            modalManager.notify('Song loaded successfully', 'info');
        } catch (error) {
            modalManager.notify('Failed to load song: ' + error.message, 'error');
        }
    };
    
    input.click();
}

/**
 * Load ORG file from path
 */
async function loadOrgFromPath(path) {
    try {
        const response = await fetch(path);
        if (!response.ok) throw new Error('File not found');
        
        const buffer = await response.arrayBuffer();
        await pianoRoll.loadOrgFile(buffer);
        
        const filename = path.split('/').pop();
        currentFilename = filename;
        updatePageTitle();
        modalManager.notify(`Loaded: ${filename}`, 'info');
    } catch (error) {
        modalManager.notify(`Failed to load file: ${error.message}`, 'error');
    }
}

/**
 * Load MIDI file from path
 */
async function loadMidiFromPath(path) {
    try {
        const response = await fetch(path);
        if (!response.ok) throw new Error('File not found');
        
        const buffer = await response.arrayBuffer();
        await pianoRoll.loadMidiFile(buffer);
        
        const filename = path.split('/').pop();
        currentFilename = filename;
        updatePageTitle();
        modalManager.notify(`Loaded: ${filename}`, 'info');
    } catch (error) {
        modalManager.notify(`Failed to load MIDI file: ${error.message}`, 'error');
    }
}

/**
 * Show song directory
 */
async function showSongDirectory(basePath, isMidi = false) {
    try {
        const response = await fetch(basePath + 'index.json');
        const songs = await response.json();
        
        // Create song list
        const songList = document.getElementById('songList');
        songList.innerHTML = '';
        
        songs.forEach(song => {
            const li = document.createElement('li');
            li.className = 'song-item';
            
            // Format display name
            let displayName = song;
            if (isMidi) {
                // Format MIDI filenames for better display
                if (song === 'scarborough1.mid') {
                    displayName = 'Scarborough Fair';
                } else if (song === 'jesu-joy.mid') {
                    displayName = 'Jesu, Joy of Man\'s Desiring';
                } else {
                    displayName = song.replace('.mid', '')
                        .replace(/_/g, ' ')
                        .replace(/\b\w/g, l => l.toUpperCase());
                }
            } else {
                displayName = song.replace('.org', '');
            }
            
            li.textContent = displayName;
            li.onclick = () => {
                if (isMidi) {
                    loadMidiFromPath(basePath + song);
                } else {
                    loadOrgFromPath(basePath + song);
                }
                modalManager.close('songModal');
            };
            songList.appendChild(li);
        });
        
        // Update modal title based on directory
        const modalTitle = document.querySelector('#songModal h2');
        if (modalTitle) {
            if (isMidi) {
                modalTitle.textContent = 'Classical Music';
            } else if (basePath.includes('allbeta')) {
                modalTitle.textContent = 'Cave Story Beta Songs';
            } else {
                modalTitle.textContent = 'Cave Story Songs';
            }
        }
        
        // Show modal
        modalManager.show('songModal');
    } catch (error) {
        modalManager.notify('Failed to load song list', 'error');
    }
}

// Register keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Skip if typing in an input field or textarea
    if (e.target.matches('input, textarea')) {
        return;
    }
    
    // Playback shortcuts
    if (e.code === 'Space') {
        e.preventDefault();
        if (pianoRoll.isPlaying && !pianoRoll.isPaused) {
            pianoRoll.pause();
        } else {
            pianoRoll.play();
        }
        updatePlayButton();
    }
    
    if (e.code === 'Enter') {
        e.preventDefault();
        pianoRoll.stop();
        updatePlayButton();
    }
    
    // Edit shortcuts are handled by MenuManager's registerShortcut
    // Only handle Space, Enter, and Delete here since Delete needs special handling
    if (e.key === 'Delete') {
        e.preventDefault();
        handleDelete();
    }
});

