import { PIANO_KEY_WIDTH, RESIZE_HANDLE_WIDTH, NUM_OCTAVES, NOTES_PER_OCTAVE, NOTE_HEIGHT, GRID_WIDTH, GRID_SUBDIVISIONS } from './constants.js';

/**
 * Handles all user input events
 */
export class InputHandler {
    constructor(pianoRoll) {
        this.pianoRoll = pianoRoll;
        this.canvas = pianoRoll.canvas;
        
        // Mouse state
        this.mouseX = 0;
        this.mouseY = 0;
        this.isDragging = false;
        this.isResizing = false;
        this.isCreatingNote = false;
        this.isSelecting = false;
        this.isDeleteSelecting = false;
        
        // Drag state
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragNote = null;
        this.resizeDirection = null;
        this.selectionBox = null;
        
        // Piano key state
        this.isGlissando = false;
        this.lastGlissandoKey = -1;
        this.currentPlayingKey = null;
        this.pressedKeys = new Set();
        
        // Keyboard state
        this.shiftKeyHeld = false;
        this.ctrlKeyHeld = false;
        this.altKeyHeld = false;
        
        // MIDI state
        this.midiAccess = null;
        this.midiInputs = [];
        this.midiNoteMap = new Map(); // Maps MIDI note numbers to playing notes
        
        this.setupEventListeners();
        this.setupMIDI();
    }

    /**
     * Setup all event listeners
     */
    setupEventListeners() {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.canvas.addEventListener('mouseleave', (e) => this.onMouseLeave(e));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        this.canvas.addEventListener('wheel', (e) => this.onWheel(e));
        
        // Touch events
        this.canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
        this.canvas.addEventListener('touchend', (e) => this.onTouchEnd(e), { passive: false });
        this.canvas.addEventListener('touchcancel', (e) => this.onTouchEnd(e), { passive: false });
        
        // Global mouse up to catch releases outside canvas
        window.addEventListener('mouseup', (e) => this.onMouseUp(e));
        
        // Keyboard events
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => this.onKeyUp(e));
        
        // Window resize
        window.addEventListener('resize', () => this.pianoRoll.resize());
    }

    /**
     * Get mouse coordinates relative to canvas
     */
    getMouseCoordinates(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left + this.pianoRoll.scrollX,
            y: e.clientY - rect.top + this.pianoRoll.scrollY
        };
    }

    /**
     * Get key number from Y coordinate
     */
    getKeyFromY(y) {
        return NUM_OCTAVES * NOTES_PER_OCTAVE - 1 - Math.floor(y / NOTE_HEIGHT);
    }

    /**
     * Check if mouse is in resize zone
     */
    isInResizeZone(note, x) {
        // Scale note position for comparison
        const scaleFactor = this.pianoRoll.gridWidth / this.pianoRoll.baseGridWidth;
        const scaledX = PIANO_KEY_WIDTH + (note.x - PIANO_KEY_WIDTH) * scaleFactor;
        const scaledWidth = note.width * scaleFactor;
        
        // For narrow notes, make resize zones proportionally smaller
        let resizeZoneWidth;
        if (scaledWidth <= this.pianoRoll.gridWidth) {
            // For 1-unit notes, use very small resize zones (3 pixels each side)
            resizeZoneWidth = 3;
        } else if (scaledWidth <= this.pianoRoll.gridWidth * 2) {
            // For 2-unit notes, use 5 pixels
            resizeZoneWidth = 5;
        } else {
            // For wider notes, use the standard size
            resizeZoneWidth = RESIZE_HANDLE_WIDTH;
        }
        
        return {
            left: x <= scaledX + resizeZoneWidth,
            right: x >= scaledX + scaledWidth - resizeZoneWidth
        };
    }

    /**
     * Handle mouse down event
     */
    onMouseDown(e) {
        const { x, y } = this.getMouseCoordinates(e);
        this.mouseX = x;
        this.mouseY = y;
        
        if (e.button === 2) {
            // Right click - delete mode
            this.handleRightClick(x, y);
        } else if (e.button === 0) {
            // Left click
            this.handleLeftClick(x, y, e);
        }
    }

    /**
     * Handle left click
     */
    handleLeftClick(x, y, e) {
        const key = this.getKeyFromY(y);
        
        // Check if clicking on piano keys
        if (x - this.pianoRoll.scrollX < PIANO_KEY_WIDTH && key >= 0 && key < NUM_OCTAVES * NOTES_PER_OCTAVE) {
            this.handlePianoKeyClick(key);
            return;
        }
        
        // Check if clicking on a note
        const scaleFactor = this.pianoRoll.gridWidth / this.pianoRoll.baseGridWidth;
        const note = this.pianoRoll.noteManager.getNoteAt(x, y, scaleFactor);
        
        if (note) {
            this.handleNoteClick(note, x, y, e);
        } else {
            // Clicking on empty space
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
                this.startSelection(x, y, e.shiftKey);
            } else {
                this.createNewNote(x, y);
            }
        }
    }

    /**
     * Handle right click
     */
    handleRightClick(x, y) {
        const scaleFactor = this.pianoRoll.gridWidth / this.pianoRoll.baseGridWidth;
        const note = this.pianoRoll.noteManager.getNoteAt(x, y, scaleFactor);
        if (note) {
            this.pianoRoll.noteManager.deleteNote(note);
            this.pianoRoll.emit('notesChanged');
            this.pianoRoll.dirty = true;
        } else {
            // Start delete selection box
            this.isDeleteSelecting = true;
            this.selectionBox = { x1: x, y1: y, x2: x, y2: y };
            this.pianoRoll.noteManager.selectedNotes.clear();
            this.pianoRoll.emit('selectionChanged');
            this.pianoRoll.dirty = true;
        }
    }

    /**
     * Handle piano key click
     */
    handlePianoKeyClick(key) {
        this.pianoRoll.audioEngine.playNote(key, 100, this.pianoRoll.currentSample, true);
        this.currentPlayingKey = key;
        this.isGlissando = true;
        this.lastGlissandoKey = key;
        this.pressedKeys.add(key);
        this.pianoRoll.dirty = true;
    }

    /**
     * Handle note click
     */
    handleNoteClick(note, x, y, e) {
        // Don't allow editing notes from muted tracks
        if (this.pianoRoll.trackVisibility.get(note.instrument) === false) {
            return;
        }
        
        const isNoteSelected = this.pianoRoll.noteManager.selectedNotes.has(note);
        
        if (e.shiftKey) {
            // Toggle selection
            if (isNoteSelected) {
                this.pianoRoll.noteManager.selectedNotes.delete(note);
            } else {
                this.pianoRoll.noteManager.selectedNotes.add(note);
            }
            this.pianoRoll.emit('selectionChanged');
            this.pianoRoll.dirty = true;
        } else {
            // Check for resize
            const resizeZone = this.isInResizeZone(note, x);
            if (resizeZone.right || resizeZone.left) {
                this.startResize(note, resizeZone.right ? 'right' : 'left', isNoteSelected);
            } else {
                this.startDrag(note, x, y, isNoteSelected);
            }
        }
    }

    /**
     * Start dragging a note
     */
    startDrag(note, x, y, isNoteSelected) {
        this.isDragging = true;
        this.dragNote = note;
        
        // Convert screen position to note space
        const scaleFactor = this.pianoRoll.gridWidth / this.pianoRoll.baseGridWidth;
        const scaledNoteX = PIANO_KEY_WIDTH + (note.x - PIANO_KEY_WIDTH) * scaleFactor;
        
        this.dragStartX = x - scaledNoteX;
        this.dragStartY = y - note.y;
        
        if (!isNoteSelected && !this.shiftKeyHeld) {
            this.pianoRoll.noteManager.selectedNotes.clear();
            this.pianoRoll.emit('selectionChanged');
        }
        
        // Store original positions
        this.originalPositions = new Map();
        if (isNoteSelected || this.pianoRoll.noteManager.selectedNotes.has(note)) {
            // Store positions for all selected notes
            for (const n of this.pianoRoll.noteManager.selectedNotes) {
                this.originalPositions.set(n, { x: n.x, y: n.y });
            }
        } else {
            // Store position for single note
            this.originalPositions.set(note, { x: note.x, y: note.y });
        }
    }

    /**
     * Start resizing a note
     */
    startResize(note, direction, isNoteSelected) {
        this.isResizing = true;
        this.dragNote = note;
        this.resizeDirection = direction;
        this.dragStartX = this.mouseX; // Store the actual mouse position
        
        // Store original dimensions for the dragged note
        this.originalNoteX = note.x;
        this.originalNoteWidth = note.width;
        this.originalNoteEnd = note.x + note.width;
        
        // Store original widths and positions for all selected notes
        if (isNoteSelected || this.pianoRoll.noteManager.selectedNotes.has(note)) {
            this.originalWidths = new Map();
            this.originalPositions = new Map();
            
            // Make sure to include the current note in the maps
            const notesToResize = new Set(this.pianoRoll.noteManager.selectedNotes);
            notesToResize.add(note);
            
            for (const n of notesToResize) {
                this.originalWidths.set(n, n.width);
                this.originalPositions.set(n, { x: n.x, y: n.y });
            }
        } else {
            // Single note resize
            this.originalWidths = new Map([[note, note.width]]);
            this.originalPositions = new Map([[note, { x: note.x, y: note.y }]]);
        }
    }

    /**
     * Start selection box
     */
    startSelection(x, y, addToSelection) {
        this.isSelecting = true;
        this.selectionBox = { x1: x, y1: y, x2: x, y2: y };
        this.shiftKeyHeld = addToSelection;
        if (!addToSelection) {
            this.pianoRoll.noteManager.selectedNotes.clear();
        }
        this.pianoRoll.dirty = true;
    }

    /**
     * Create new note
     */
    createNewNote(x, y) {
        const key = this.getKeyFromY(y);
        if (key < 0 || key >= NUM_OCTAVES * NOTES_PER_OCTAVE || x < PIANO_KEY_WIDTH) return;
        
        // Convert screen position to note position by unscaling
        const scaleFactor = this.pianoRoll.gridWidth / this.pianoRoll.baseGridWidth;
        const unscaledX = PIANO_KEY_WIDTH + (x - PIANO_KEY_WIDTH) / scaleFactor;
        
        const snappedX = this.pianoRoll.gridSnap ? this.pianoRoll.snapXToGrid(unscaledX) + PIANO_KEY_WIDTH : unscaledX;
        const noteData = {
            x: snappedX,
            y: (NUM_OCTAVES * NOTES_PER_OCTAVE - 1 - key) * NOTE_HEIGHT,
            key: key,
            velocity: this.pianoRoll.currentVelocity,
            instrument: this.pianoRoll.currentSample
        };
        
        const newNote = this.pianoRoll.noteManager.createNote(noteData);
        this.dragNote = newNote;
        this.isCreatingNote = true;
        this.createStartX = newNote.x;
        this.pianoRoll.noteManager.selectedNotes.clear();
        this.pianoRoll.emit('notesChanged');
        this.pianoRoll.dirty = true;
    }

    /**
     * Handle note creation (extending width while dragging)
     */
    handleNoteCreation(x, y) {
        if (!this.dragNote) return;
        
        // Convert screen position to note position by unscaling
        const scaleFactor = this.pianoRoll.gridWidth / this.pianoRoll.baseGridWidth;
        const unscaledX = PIANO_KEY_WIDTH + (x - PIANO_KEY_WIDTH) / scaleFactor;
        
        // Extend note width based on current position
        const newWidth = unscaledX - this.dragNote.x;
        if (newWidth > 0) {
            if (this.pianoRoll.gridSnap) {
                // Snap the end position to grid
                const snapDivisions = this.pianoRoll.getSnapDivisions();
                const subdivisionWidth = this.pianoRoll.baseGridWidth * BEATS_PER_MEASURE / snapDivisions;
                const snappedWidth = Math.ceil(newWidth / subdivisionWidth) * subdivisionWidth;
                this.dragNote.width = Math.max(subdivisionWidth, snappedWidth);
            } else {
                this.dragNote.width = newWidth;
            }
            this.pianoRoll.dirty = true;
        }
    }
    
    /**
     * Handle mouse move
     */
    onMouseMove(e) {
        const { x, y } = this.getMouseCoordinates(e);
        this.mouseX = x;
        this.mouseY = y;
        
        // Update hovered row only if changed
        const newHoveredRow = Math.floor(y / NOTE_HEIGHT);
        if (newHoveredRow !== this.pianoRoll.hoveredRow) {
            this.pianoRoll.hoveredRow = newHoveredRow;
            this.pianoRoll.dirty = true;
            // Invalidate piano keys cache when hover changes
            if (this.pianoRoll.renderer) {
                this.pianoRoll.renderer.pianoKeysCacheInvalid = true;
            }
        }
        
        // Handle different drag modes
        if (this.isResizing) {
            this.handleResize(x, y);
        } else if (this.isCreatingNote && this.dragNote) {
            this.handleNoteCreation(x, y);
        } else if (this.isDragging) {
            this.handleDrag(x, y);
        } else if (this.isSelecting || this.isDeleteSelecting) {
            this.updateSelectionBox(x, y);
        } else if (this.isGlissando) {
            this.handleGlissando(x, y);
        } else {
            this.updateCursor(x, y);
        }
    }

    /**
     * Handle resize
     */
    handleResize(x, y) {
        if (!this.dragNote) return;
        
        const snapDivisions = this.pianoRoll.getSnapDivisions();
        const subdivisionWidth = GRID_WIDTH * BEATS_PER_MEASURE / snapDivisions;
        const minWidth = subdivisionWidth;
        
        if (this.pianoRoll.noteManager.selectedNotes.has(this.dragNote)) {
            // Calculate raw delta
            const rawDelta = x - this.dragStartX;
            
            // Resize all selected notes
            this.pianoRoll.noteManager.resizeSelectedNotes(rawDelta, this.resizeDirection, this.originalWidths, this.originalPositions);
        } else {
            // Resize single note
            if (this.resizeDirection === 'right') {
                // Calculate new right edge position
                let newRightEdge = this.originalNoteX + this.originalNoteWidth + (x - this.dragStartX);
                
                // Snap to grid if enabled
                if (this.pianoRoll.gridSnap) {
                    newRightEdge = Math.round((newRightEdge - PIANO_KEY_WIDTH) / subdivisionWidth) * 
                                   subdivisionWidth + PIANO_KEY_WIDTH;
                }
                
                // Calculate new width
                const newWidth = newRightEdge - this.dragNote.x;
                this.dragNote.width = Math.max(minWidth, newWidth);
            } else {
                // Calculate new left edge position
                let newX = this.originalNoteX + (x - this.dragStartX);
                
                // Snap to grid if enabled
                if (this.pianoRoll.gridSnap) {
                    newX = Math.round((newX - PIANO_KEY_WIDTH) / subdivisionWidth) * 
                           subdivisionWidth + PIANO_KEY_WIDTH;
                }
                
                // Keep right edge fixed
                const rightEdge = this.originalNoteX + this.originalNoteWidth;
                const newWidth = rightEdge - newX;
                
                if (newWidth >= minWidth && newX >= PIANO_KEY_WIDTH) {
                    this.dragNote.x = newX;
                    this.dragNote.width = newWidth;
                }
            }
        }
        
        this.pianoRoll.dirty = true;
    }

    /**
     * Handle drag
     */
    handleDrag(x, y) {
        if (!this.dragNote) return;
        
        // Convert screen position to note space
        const scaleFactor = this.pianoRoll.gridWidth / this.pianoRoll.baseGridWidth;
        
        // Calculate the target position (where the mouse is minus the offset within the note)
        const targetScreenX = x - this.dragStartX;
        const targetX = PIANO_KEY_WIDTH + (targetScreenX - PIANO_KEY_WIDTH) / scaleFactor;
        const targetY = y - this.dragStartY;
        
        // Ensure originalPositions exists
        if (!this.originalPositions) {
            this.originalPositions = new Map();
            if (this.pianoRoll.noteManager.selectedNotes.has(this.dragNote)) {
                // Store positions for all selected notes
                for (const n of this.pianoRoll.noteManager.selectedNotes) {
                    this.originalPositions.set(n, { x: n.x, y: n.y });
                }
            } else {
                // Store position for single note
                this.originalPositions.set(this.dragNote, { x: this.dragNote.x, y: this.dragNote.y });
            }
        }
        
        if (this.pianoRoll.noteManager.selectedNotes.has(this.dragNote) && this.originalPositions.size > 1) {
            // Calculate delta from original position of the dragged note
            const originalDragPos = this.originalPositions.get(this.dragNote);
            if (!originalDragPos) return;
            const deltaX = targetX - originalDragPos.x;
            const deltaY = targetY - originalDragPos.y;
            
            // Move all selected notes by the same delta
            for (const [note, originalPos] of this.originalPositions) {
                let newX = originalPos.x + deltaX;
                let newY = originalPos.y + deltaY;
                
                // Apply grid snap if enabled
                if (this.pianoRoll.gridSnap) {
                    const snapDivisions = this.pianoRoll.getSnapDivisions();
                    const subdivisionWidth = GRID_WIDTH * BEATS_PER_MEASURE / snapDivisions;
                    newX = Math.round((newX - PIANO_KEY_WIDTH) / subdivisionWidth) * 
                           subdivisionWidth + PIANO_KEY_WIDTH;
                }
                
                // Ensure note stays within bounds
                newX = Math.max(PIANO_KEY_WIDTH, newX);
                const newKey = this.getKeyFromY(newY + NOTE_HEIGHT / 2);
                if (newKey >= 0 && newKey < NUM_OCTAVES * NOTES_PER_OCTAVE) {
                    note.x = newX;
                    note.y = (NUM_OCTAVES * NOTES_PER_OCTAVE - 1 - newKey) * NOTE_HEIGHT;
                    note.key = newKey;
                }
            }
        } else {
            // Move single note
            let newX = targetX;
            let newY = targetY;
            
            // Apply grid snap if enabled
            if (this.pianoRoll.gridSnap) {
                const subdivisionWidth = GRID_WIDTH / GRID_SUBDIVISIONS;
                newX = Math.round((newX - PIANO_KEY_WIDTH) / subdivisionWidth) * 
                       subdivisionWidth + PIANO_KEY_WIDTH;
            }
            
            // Ensure note stays within bounds
            newX = Math.max(PIANO_KEY_WIDTH, newX);
            const newKey = this.getKeyFromY(newY + NOTE_HEIGHT / 2);
            if (newKey >= 0 && newKey < NUM_OCTAVES * NOTES_PER_OCTAVE) {
                this.dragNote.x = newX;
                this.dragNote.y = (NUM_OCTAVES * NOTES_PER_OCTAVE - 1 - newKey) * NOTE_HEIGHT;
                this.dragNote.key = newKey;
            }
        }
        
        this.pianoRoll.dirty = true;
    }

    /**
     * Update selection box
     */
    updateSelectionBox(x, y) {
        if (!this.selectionBox) return;
        
        this.selectionBox.x2 = x;
        this.selectionBox.y2 = y;
        
        // Update selected notes
        const scaleFactor = this.pianoRoll.gridWidth / this.pianoRoll.baseGridWidth;
        this.pianoRoll.noteManager.selectNotesInRegion(this.selectionBox, this.shiftKeyHeld, scaleFactor);
        this.pianoRoll.emit('selectionChanged');
        this.pianoRoll.dirty = true;
    }

    /**
     * Handle glissando
     */
    handleGlissando(x, y) {
        if (x - this.pianoRoll.scrollX < PIANO_KEY_WIDTH) {
            const key = this.getKeyFromY(y);
            if (key >= 0 && key < NUM_OCTAVES * NOTES_PER_OCTAVE && key !== this.lastGlissandoKey) {
                this.pressedKeys.clear();
                this.pressedKeys.add(key);
                this.pianoRoll.audioEngine.playNote(key, 100, this.pianoRoll.currentSample, true);
                this.currentPlayingKey = key;
                this.lastGlissandoKey = key;
                this.pianoRoll.dirty = true;
            }
        } else if (this.lastGlissandoKey !== -1) {
            // Mouse moved away from piano keys, reset
            this.lastGlissandoKey = -1;
        }
    }

    /**
     * Update cursor based on hover
     */
    updateCursor(x, y) {
        let newCursor;
        
        if (x < PIANO_KEY_WIDTH) {
            newCursor = 'pointer';
        } else {
            const note = this.pianoRoll.noteManager.getNoteAt(x, y);
            if (note) {
                const resizeZone = this.isInResizeZone(note, x);
                newCursor = (resizeZone.left || resizeZone.right) ? 'ew-resize' : 'move';
            } else {
                newCursor = 'crosshair';
            }
        }
        
        // Only update if cursor changed
        if (this.canvas.style.cursor !== newCursor) {
            this.canvas.style.cursor = newCursor;
        }
    }

    /**
     * Handle mouse up
     */
    onMouseUp(e) {
        // Handle selection boxes
        if (this.isSelecting || this.isDeleteSelecting) {
            if (this.isDeleteSelecting && this.selectionBox) {
                const scaleFactor = this.pianoRoll.gridWidth / this.pianoRoll.baseGridWidth;
                this.pianoRoll.noteManager.deleteNotesInRegion(this.selectionBox, scaleFactor);
                this.pianoRoll.emit('notesChanged');
            }
            this.selectionBox = null;
        }
        
        // Stop piano key playback
        if (this.isGlissando) {
            if (this.currentPlayingKey !== null) {
                this.pianoRoll.audioEngine.stopNote(this.currentPlayingKey);
            }
            this.pianoRoll.audioEngine.currentGlissandoNote = null;
            this.pianoRoll.audioEngine.currentGlissandoKey = null;
            this.pressedKeys.clear();
        }
        
        // Emit notesChanged if we were editing notes
        if (this.isDragging || this.isResizing || this.isCreatingNote) {
            this.pianoRoll.emit('notesChanged');
        }
        
        // Reset all states
        this.isDragging = false;
        this.isResizing = false;
        this.isCreatingNote = false;
        this.isSelecting = false;
        this.isDeleteSelecting = false;
        this.isGlissando = false;
        this.dragNote = null;
        this.currentPlayingKey = null;
        this.lastGlissandoKey = -1;
        this.originalPositions = null;
        this.originalWidths = null;
        
        this.canvas.style.cursor = 'crosshair';
        this.pianoRoll.dirty = true;
    }

    /**
     * Handle mouse leave
     */
    onMouseLeave(e) {
        let needsRedraw = false;
        
        if (this.pianoRoll.hoveredRow !== -1) {
            this.pianoRoll.hoveredRow = -1;
            needsRedraw = true;
        }
        
        if (this.isGlissando && this.currentPlayingKey !== null) {
            this.pianoRoll.audioEngine.stopNote(this.currentPlayingKey);
            this.currentPlayingKey = null;
            this.pianoRoll.audioEngine.currentGlissandoNote = null;
            this.pianoRoll.audioEngine.currentGlissandoKey = null;
            needsRedraw = true;
        }
        
        if (needsRedraw) {
            this.pianoRoll.dirty = true;
        }
    }

    /**
     * Handle mouse wheel
     */
    onWheel(e) {
        e.preventDefault();
        
        const delta = e.deltaY;
        const scrollSpeed = 30;
        
        if (e.shiftKey) {
            // Horizontal scroll
            this.pianoRoll.scrollX = Math.max(0, 
                Math.min(this.pianoRoll.totalWidth - this.canvas.width, 
                    this.pianoRoll.scrollX + delta));
        } else {
            // Vertical scroll
            this.pianoRoll.scrollY = Math.max(0, 
                Math.min(this.pianoRoll.totalHeight - this.canvas.height, 
                    this.pianoRoll.scrollY + delta));
        }
        
        this.pianoRoll.emit('scroll', { scrollX: this.pianoRoll.scrollX, scrollY: this.pianoRoll.scrollY });
        this.pianoRoll.dirty = true;
    }

    /**
     * Handle key down
     */
    onKeyDown(e) {
        // Skip if typing in an input field
        if (e.target.matches('input, textarea')) {
            return;
        }
        
        // Update modifier keys
        this.shiftKeyHeld = e.shiftKey;
        this.ctrlKeyHeld = e.ctrlKey || e.metaKey;
        this.altKeyHeld = e.altKey;
        
        // Handle arrow keys for selected notes
        if (this.pianoRoll.noteManager.selectedNotes.size > 0) {
            switch(e.key) {
                case 'ArrowLeft':
                case 'ArrowRight':
                case 'ArrowUp':
                case 'ArrowDown':
                    this.handleArrowKeys(e.key);
                    e.preventDefault();
                    break;
            }
        }
        
        // Handle other shortcuts
        switch(e.key) {
            case 'Home':
                this.pianoRoll.scrollX = 0;
                this.pianoRoll.dirty = true;
                e.preventDefault();
                break;
            case 'End':
                this.pianoRoll.scrollX = this.pianoRoll.totalWidth - this.canvas.width;
                this.pianoRoll.dirty = true;
                e.preventDefault();
                break;
        }
    }

    /**
     * Handle key up
     */
    onKeyUp(e) {
        this.shiftKeyHeld = e.shiftKey;
        this.ctrlKeyHeld = e.ctrlKey || e.metaKey;
        this.altKeyHeld = e.altKey;
    }

    /**
     * Handle arrow keys for note movement
     */
    handleArrowKeys(key) {
        const gridStep = 10; // Pixels to move
        
        switch(key) {
            case 'ArrowLeft':
                this.pianoRoll.noteManager.moveSelectedNotes(-gridStep, 0, this.pianoRoll.gridSnap);
                break;
            case 'ArrowRight':
                this.pianoRoll.noteManager.moveSelectedNotes(gridStep, 0, this.pianoRoll.gridSnap);
                break;
            case 'ArrowUp':
                this.pianoRoll.noteManager.moveSelectedNotes(0, -NOTE_HEIGHT, false);
                break;
            case 'ArrowDown':
                this.pianoRoll.noteManager.moveSelectedNotes(0, NOTE_HEIGHT, false);
                break;
        }
        
        this.pianoRoll.emit('notesChanged');
        this.pianoRoll.dirty = true;
    }
    
    /**
     * Get touch coordinates relative to canvas
     */
    getTouchCoordinates(touch) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: touch.clientX - rect.left + this.pianoRoll.scrollX,
            y: touch.clientY - rect.top + this.pianoRoll.scrollY
        };
    }
    
    /**
     * Handle touch start
     */
    onTouchStart(e) {
        e.preventDefault();
        
        if (e.touches.length === 1) {
            // Single touch - simulate mouse down
            const touch = e.touches[0];
            const { x, y } = this.getTouchCoordinates(touch);
            this.mouseX = x;
            this.mouseY = y;
            
            // Store touch identifier for tracking
            this.currentTouchId = touch.identifier;
            
            // Don't create notes if we're starting a multi-touch gesture
            // Wait a brief moment to see if a second finger is added
            this.touchStartTimeout = setTimeout(() => {
                // Only proceed if still single touch
                if (e.touches.length === 1) {
                    this.handleLeftClick(x, y, e);
                }
            }, 50); // 50ms delay to detect multi-touch
        } else if (e.touches.length === 2) {
            // Two finger touch - prepare for pinch/zoom or pan
            // Clear any pending single touch action
            if (this.touchStartTimeout) {
                clearTimeout(this.touchStartTimeout);
                this.touchStartTimeout = null;
            }
            
            // Cancel any ongoing interactions
            this.cancelCurrentInteraction();
            
            this.handleMultiTouchStart(e);
        }
    }
    
    /**
     * Handle touch move
     */
    onTouchMove(e) {
        e.preventDefault();
        
        // Clear any pending touch start timeout if still waiting
        if (this.touchStartTimeout) {
            clearTimeout(this.touchStartTimeout);
            this.touchStartTimeout = null;
        }
        
        if (e.touches.length === 1 && this.currentTouchId !== undefined) {
            // Find the touch we're tracking
            let touch = null;
            for (let i = 0; i < e.touches.length; i++) {
                if (e.touches[i].identifier === this.currentTouchId) {
                    touch = e.touches[i];
                    break;
                }
            }
            
            if (touch) {
                const { x, y } = this.getTouchCoordinates(touch);
                this.mouseX = x;
                this.mouseY = y;
                
                // Simulate mouse move
                this.onMouseMove({ 
                    clientX: touch.clientX, 
                    clientY: touch.clientY,
                    preventDefault: () => {}
                });
            }
        } else if (e.touches.length === 2) {
            // Two finger touch - handle pinch/zoom or pan
            // If we were in the middle of a single-touch interaction, cancel it
            if (this.currentTouchId !== undefined) {
                this.cancelCurrentInteraction();
                this.currentTouchId = undefined;
            }
            
            this.handleMultiTouchMove(e);
        }
    }
    
    /**
     * Handle touch end
     */
    onTouchEnd(e) {
        e.preventDefault();
        
        // Clear any pending touch start timeout
        if (this.touchStartTimeout) {
            clearTimeout(this.touchStartTimeout);
            this.touchStartTimeout = null;
        }
        
        // Check if our tracked touch ended
        let touchEnded = true;
        for (let i = 0; i < e.touches.length; i++) {
            if (e.touches[i].identifier === this.currentTouchId) {
                touchEnded = false;
                break;
            }
        }
        
        if (touchEnded) {
            // Simulate mouse up
            this.onMouseUp(e);
            this.currentTouchId = undefined;
        }
        
        // Reset multi-touch state if needed
        if (e.touches.length < 2) {
            this.multiTouchStartDistance = null;
            this.multiTouchStartScrollX = null;
            this.multiTouchStartScrollY = null;
        }
    }
    
    /**
     * Cancel current interaction
     */
    cancelCurrentInteraction() {
        // Cancel any ongoing drag, resize, or note creation
        if (this.isDragging || this.isResizing || this.isCreatingNote) {
            // If we were creating a note, remove it
            if (this.isCreatingNote && this.dragNote) {
                this.pianoRoll.noteManager.deleteNote(this.dragNote);
            }
            
            // Reset all interaction states
            this.isDragging = false;
            this.isResizing = false;
            this.isCreatingNote = false;
            this.isSelecting = false;
            this.isDeleteSelecting = false;
            this.dragNote = null;
            this.selectionBox = null;
            
            this.pianoRoll.dirty = true;
        }
    }
    
    /**
     * Handle multi-touch start (for pan/zoom)
     */
    handleMultiTouchStart(e) {
        if (e.touches.length === 2) {
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];
            
            // Calculate initial distance between touches for pinch zoom
            const dx = touch2.clientX - touch1.clientX;
            const dy = touch2.clientY - touch1.clientY;
            this.multiTouchStartDistance = Math.sqrt(dx * dx + dy * dy);
            
            // Store initial scroll position for panning
            this.multiTouchStartScrollX = this.pianoRoll.scrollX;
            this.multiTouchStartScrollY = this.pianoRoll.scrollY;
            
            // Calculate center point
            this.multiTouchCenterX = (touch1.clientX + touch2.clientX) / 2;
            this.multiTouchCenterY = (touch1.clientY + touch2.clientY) / 2;
        }
    }
    
    /**
     * Handle multi-touch move (for pan/zoom)
     */
    handleMultiTouchMove(e) {
        if (e.touches.length === 2 && this.multiTouchStartDistance) {
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];
            
            // Calculate new center point
            const newCenterX = (touch1.clientX + touch2.clientX) / 2;
            const newCenterY = (touch1.clientY + touch2.clientY) / 2;
            
            // Calculate pan delta
            const panDeltaX = this.multiTouchCenterX - newCenterX;
            const panDeltaY = this.multiTouchCenterY - newCenterY;
            
            // Apply panning
            this.pianoRoll.scrollX = Math.max(0, 
                Math.min(this.pianoRoll.totalWidth - this.canvas.width, 
                    this.multiTouchStartScrollX + panDeltaX));
            this.pianoRoll.scrollY = Math.max(0, 
                Math.min(this.pianoRoll.totalHeight - this.canvas.height, 
                    this.multiTouchStartScrollY + panDeltaY));
            
            this.pianoRoll.emit('scroll', { 
                scrollX: this.pianoRoll.scrollX, 
                scrollY: this.pianoRoll.scrollY 
            });
            this.pianoRoll.dirty = true;
        }
    }
    
    /**
     * Setup MIDI access
     */
    async setupMIDI() {
        try {
            // Request MIDI access
            const midiAccess = await navigator.requestMIDIAccess();
            this.midiAccess = midiAccess;
            
            // Connect to all MIDI inputs
            this.connectMIDIInputs();
            
            // Listen for new devices
            midiAccess.onstatechange = (e) => {
                this.connectMIDIInputs();
            };
        } catch (error) {
        }
    }
    
    /**
     * Connect to all available MIDI inputs
     */
    connectMIDIInputs() {
        if (!this.midiAccess) return;
        
        // Clear existing connections
        this.midiInputs.forEach(input => {
            input.onmidimessage = null;
        });
        this.midiInputs = [];
        
        // Connect to all inputs
        for (const input of this.midiAccess.inputs.values()) {
            input.onmidimessage = (e) => this.handleMIDIMessage(e);
            this.midiInputs.push(input);
        }
    }
    
    /**
     * Handle MIDI messages
     */
    handleMIDIMessage(event) {
        const [status, note, velocity] = event.data;
        
        // Parse MIDI message type
        const messageType = status & 0xF0;
        const channel = status & 0x0F;
        
        switch (messageType) {
            case 0x90: // Note On
                if (velocity > 0) {
                    this.handleMIDINoteOn(note, velocity);
                } else {
                    // Note On with velocity 0 is treated as Note Off
                    this.handleMIDINoteOff(note);
                }
                break;
                
            case 0x80: // Note Off
                this.handleMIDINoteOff(note);
                break;
        }
    }
    
    /**
     * Handle MIDI Note On
     */
    handleMIDINoteOn(midiNote, velocity) {
        // Convert MIDI note to 38-EDO key number
        // Import the 12-tone to 38 EDO mapping
        const TWELVE_TO_38_EDO_MAP = {
            0: 0,   // C
            1: 3,   // C#
            2: 6,   // D
            3: 9,   // D#
            4: 12,  // E
            5: 15,  // F
            6: 18,  // F#
            7: 22,  // G
            8: 25,  // G#
            9: 28,  // A
            10: 31, // A#
            11: 34  // B
        };
        
        // MIDI note 60 = Middle C = C4
        const midiC4 = 60;
        const octaveShift = Math.floor((midiNote - midiC4) / 12);
        const noteInOctave = (midiNote % 12 + 12) % 12; // Ensure positive
        
        // C4 should be at key 152 (same as before), which is octave 4 in the old system
        const c4KeyNumber = 4 * NOTES_PER_OCTAVE; // 152 (4 × 38)
        const keyNumber = c4KeyNumber + octaveShift * NOTES_PER_OCTAVE + TWELVE_TO_38_EDO_MAP[noteInOctave];
        
        // Check if key is within valid range (0-575)
        if (keyNumber < 0 || keyNumber >= NUM_OCTAVES * NOTES_PER_OCTAVE) {
            return;
        }
        
        // Play the note
        this.pianoRoll.playPianoKey(keyNumber, velocity);
        
        // Debug: Log the mapping
        console.log(`MIDI ${midiNote} (${this.getMidiNoteName(midiNote)}) -> 38EDO key ${keyNumber}, position in octave: ${keyNumber % NOTES_PER_OCTAVE}`);
        
        // Store the mapping (allow multiple notes)
        if (!this.midiNoteMap.has(midiNote)) {
            this.midiNoteMap.set(midiNote, new Set());
        }
        this.midiNoteMap.get(midiNote).add(keyNumber);
        
        // Update visual state
        this.pressedKeys.add(keyNumber);
        this.pianoRoll.dirty = true;
        
        // Invalidate piano keys cache to show pressed key
        if (this.pianoRoll.renderer) {
            this.pianoRoll.renderer.pianoKeysCacheInvalid = true;
        }
    }
    
    /**
     * Snap key to nearest 12-tone position
     */
    snapToNearest12Tone(key) {
        const exactPositions = [0, 3, 6, 9, 12, 15, 18, 22, 25, 28, 31, 34]; // C, C#, D, D#, E, F, F#, G, G#, A, A#, B
        const octave = Math.floor(key / NOTES_PER_OCTAVE);
        const positionInOctave = key % NOTES_PER_OCTAVE;
        
        // Find the nearest exact position
        let nearestPosition = exactPositions[0];
        let minDistance = Math.abs(positionInOctave - exactPositions[0]);
        
        for (const pos of exactPositions) {
            const distance = Math.abs(positionInOctave - pos);
            if (distance < minDistance) {
                minDistance = distance;
                nearestPosition = pos;
            }
        }
        
        // Handle wrap-around at octave boundary
        if (positionInOctave > 35) {
            const distanceToNextC = 38 - positionInOctave;
            if (distanceToNextC < minDistance) {
                return (octave + 1) * NOTES_PER_OCTAVE;
            }
        }
        
        return octave * NOTES_PER_OCTAVE + nearestPosition;
    }
    
    /**
     * Get MIDI note name for debugging
     */
    getMidiNoteName(midiNote) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const octave = Math.floor(midiNote / 12) - 1;
        const noteName = noteNames[midiNote % 12];
        return `${noteName}${octave}`;
    }
    
    /**
     * Handle MIDI Note Off
     */
    handleMIDINoteOff(midiNote) {
        // Get the corresponding key numbers (could be multiple)
        const keyNumbers = this.midiNoteMap.get(midiNote);
        if (!keyNumbers) return;
        
        // Stop all notes for this MIDI note
        keyNumbers.forEach(keyNumber => {
            this.pianoRoll.stopPianoKey(keyNumber);
            this.pressedKeys.delete(keyNumber);
        });
        
        // Remove from mappings
        this.midiNoteMap.delete(midiNote);
        
        // Update visual state
        this.pianoRoll.dirty = true;
        
        // Invalidate piano keys cache to update visual
        if (this.pianoRoll.renderer) {
            this.pianoRoll.renderer.pianoKeysCacheInvalid = true;
        }
    }
}