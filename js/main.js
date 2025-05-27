import { PianoRoll } from './PianoRoll.js';
import { ModalManager } from './ModalManager.js';
import { MenuManager } from './MenuManager.js';
import { PanBar } from './PanBar.js';
import { VelocityBar } from './VelocityBar.js';
import { DEFAULT_VOLUME } from './constants.js';

// Initialize managers
const modalManager = new ModalManager();
const menuManager = new MenuManager();
let pianoRoll = null;
let panBar = null;
let velocityBar = null;
let currentFilename = null;

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
    }
    
    
    // Setup UI controls
    setupControls();
    setupModals();
    setupMenus();
    
    // Initialize UI state
    updatePlayButton();
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
    volumeSlider.addEventListener('input', (e) => {
        pianoRoll.audioEngine.setMasterVolume(parseInt(e.target.value));
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
    // Direct song links
    const songLinks = document.querySelectorAll('[data-org]');
    songLinks.forEach(link => {
        link.addEventListener('click', async (e) => {
            const orgPath = e.target.getAttribute('data-org');
            
            // Check if it's a directory
            if (orgPath.endsWith('/')) {
                await showSongDirectory(orgPath);
            } else {
                await loadOrgFromPath(orgPath);
            }
            
            menuManager.closeAll();
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

async function handleClearAll() {
    const confirmed = await modalManager.confirm(
        'Are you sure you want to clear all notes? This cannot be undone.'
    );
    
    if (confirmed) {
        pianoRoll.noteManager.clearAll();
        pianoRoll.stop();
        pianoRoll.dirty = true;
        modalManager.notify('All notes cleared', 'info');
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
            <span class="shortcut-desc">Stop</span>
        </div>
    </div>

    <div class="shortcut-section">
        <h3>Selection</h3>
        <div class="shortcut-item">
            <span class="shortcut-key">Ctrl+A</span>
            <span class="shortcut-desc">Select All</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Ctrl+Drag</span>
            <span class="shortcut-desc">Box select multiple notes</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Shift+Click</span>
            <span class="shortcut-desc">Add note to selection</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Shift+Drag</span>
            <span class="shortcut-desc">Add multiple notes to selection</span>
        </div>
    </div>

    <div class="shortcut-section">
        <h3>Editing</h3>
        <div class="shortcut-item">
            <span class="shortcut-key">Ctrl+C</span>
            <span class="shortcut-desc">Copy</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Ctrl+X</span>
            <span class="shortcut-desc">Cut</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Ctrl+V</span>
            <span class="shortcut-desc">Paste</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Delete</span>
            <span class="shortcut-desc">Delete selected</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Arrow Keys</span>
            <span class="shortcut-desc">Move selected notes</span>
        </div>
    </div>

    <div class="shortcut-section">
        <h3>Navigation</h3>
        <div class="shortcut-item">
            <span class="shortcut-key">Mouse Wheel</span>
            <span class="shortcut-desc">Vertical scroll</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Shift+Wheel</span>
            <span class="shortcut-desc">Horizontal scroll</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Home</span>
            <span class="shortcut-desc">Go to start</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">End</span>
            <span class="shortcut-desc">Go to end</span>
        </div>
    </div>

    <div class="shortcut-section">
        <h3>Notes</h3>
        <div class="shortcut-item">
            <span class="shortcut-key">Left Click</span>
            <span class="shortcut-desc">Create note</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Right Click</span>
            <span class="shortcut-desc">Delete note</span>
        </div>
        <div class="shortcut-item">
            <span class="shortcut-key">Drag edges</span>
            <span class="shortcut-desc">Resize note</span>
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
That 72edo Piano Roll
Version 1.1

A microtonal piano roll sequencer supporting 72 equal divisions of the octave.

Features:
- 72edo tuning system with 12 cents per step
- Organya (.org) file import
- Multi-track sequencing
- Loop playback
- 100 melodic instruments + 6 drum shots

Sounds from Org Maker
Sample music by Pixel

Created with ❤️ for microtonal music exploration.`;
    
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
        currentFilename = null;  // Reset filename when loading .org files
        modalManager.notify(`Loaded: ${filename}`, 'info');
    } catch (error) {
        modalManager.notify(`Failed to load file: ${error.message}`, 'error');
    }
}

/**
 * Show song directory
 */
async function showSongDirectory(basePath) {
    try {
        const response = await fetch(basePath + 'index.json');
        const songs = await response.json();
        
        // Create song list
        const songList = document.getElementById('songList');
        songList.innerHTML = '';
        
        songs.forEach(song => {
            const li = document.createElement('li');
            li.className = 'song-item';
            li.textContent = song.replace('.org', '');
            li.onclick = () => {
                loadOrgFromPath(basePath + song);
                modalManager.close('songModal');
            };
            songList.appendChild(li);
        });
        
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

