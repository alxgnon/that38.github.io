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
        
        this.setupEventListeners();
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
        // For narrow notes, make resize zones proportionally smaller
        let resizeZoneWidth;
        if (note.width <= GRID_WIDTH) {
            // For 1-unit notes, use very small resize zones (3 pixels each side)
            resizeZoneWidth = 3;
        } else if (note.width <= GRID_WIDTH * 2) {
            // For 2-unit notes, use 5 pixels
            resizeZoneWidth = 5;
        } else {
            // For wider notes, use the standard size
            resizeZoneWidth = RESIZE_HANDLE_WIDTH;
        }
        
        return {
            left: x <= note.x + resizeZoneWidth,
            right: x >= note.x + note.width - resizeZoneWidth
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
        const note = this.pianoRoll.noteManager.getNoteAt(x, y);
        
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
        const note = this.pianoRoll.noteManager.getNoteAt(x, y);
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
        this.dragStartX = x - note.x;
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
        
        if (direction === 'right') {
            this.originalNoteWidth = note.width;
        } else {
            this.originalNoteX = note.x;
            this.originalNoteEnd = note.x + note.width;
        }
        
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
        
        const snappedX = this.pianoRoll.gridSnap ? this.pianoRoll.snapXToGrid(x) + PIANO_KEY_WIDTH : x;
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
        
        // Extend note width based on current position
        const newWidth = x - this.dragNote.x;
        if (newWidth > 0) {
            if (this.pianoRoll.gridSnap) {
                // Snap the end position to grid
                const subdivisionWidth = GRID_WIDTH / GRID_SUBDIVISIONS;
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
        
        // Snap x to grid if grid snap is enabled
        if (this.pianoRoll.gridSnap) {
            const subdivisionWidth = GRID_WIDTH / GRID_SUBDIVISIONS;
            x = Math.round(x / subdivisionWidth) * subdivisionWidth;
        }
        
        const deltaX = x - this.dragStartX;
        
        if (this.pianoRoll.noteManager.selectedNotes.has(this.dragNote)) {
            // Resize all selected notes
            this.pianoRoll.noteManager.resizeSelectedNotes(deltaX, this.resizeDirection, this.originalWidths, this.originalPositions);
        } else {
            // Resize single note
            const minWidth = GRID_WIDTH / GRID_SUBDIVISIONS;
            
            if (this.resizeDirection === 'right') {
                // Right edge resize - calculate new width based on original width + delta
                const newWidth = this.originalNoteWidth + deltaX;
                this.dragNote.width = Math.max(minWidth, newWidth);
            } else {
                // Left edge resize - move left edge while keeping right edge fixed
                const newX = this.originalNoteX + deltaX;
                const newWidth = this.originalNoteEnd - newX;
                
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
        
        // Calculate the target position (where the mouse is minus the offset within the note)
        const targetX = x - this.dragStartX;
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
                    const subdivisionWidth = GRID_WIDTH / GRID_SUBDIVISIONS;
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
        this.pianoRoll.noteManager.selectNotesInRegion(this.selectionBox, this.shiftKeyHeld);
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
                this.pianoRoll.noteManager.deleteNotesInRegion(this.selectionBox);
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
            case 'Delete':
            case 'Backspace':
                this.pianoRoll.noteManager.deleteSelectedNotes();
                this.pianoRoll.dirty = true;
                e.preventDefault();
                break;
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
}