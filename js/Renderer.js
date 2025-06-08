import { 
    COLORS, 
    PIANO_KEY_WIDTH, 
    NOTE_HEIGHT, 
    GRID_WIDTH, 
    NOTES_PER_OCTAVE,
    BEATS_PER_MEASURE,
    VISIBLE_AREA_PADDING
} from './constants.js';

/**
 * Handles all canvas rendering operations
 */
export class Renderer {
    constructor(canvas, pianoRoll) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.pianoRoll = pianoRoll;
        
        // Performance tracking
        this.lastFrameTime = 0;
        this.frameCount = 0;
        this.fps = 0;
        
        // Note name patterns
        this.noteNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
        
        // 12-tone to 38 EDO mapping (A-rooted meantone intervals starting from C)
        this.twelveToThirtyEightMap = {
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
        
        // Cached canvases for static elements
        this.gridCache = null;
        this.pianoKeysCache = null;
        this.lastGridScrollX = -1;
        this.lastGridScrollY = -1;
        this.lastPianoScrollY = -1;
        
        // Dirty regions tracking
        this.dirtyRegions = [];
        this.fullRedraw = true;
        
        // Frame skipping
        this.targetFPS = 60;
        this.frameInterval = 1000 / this.targetFPS;
        this.lastDrawTime = 0;
    }

    /**
     * Main draw function with smart rendering
     */
    draw() {
        const now = performance.now();
        
        // Frame skipping - skip if we're drawing too frequently
        if (now - this.lastDrawTime < this.frameInterval * 0.8) {
            return;
        }
        this.lastDrawTime = now;
        
        // Check if we need full redraw
        if (this.fullRedraw || this.scrollChanged()) {
            this.fullDraw(now);
        } else {
            this.partialDraw(now);
        }
        
        this.fullRedraw = false;
        this.dirtyRegions = [];
    }
    
    /**
     * Check if scroll position changed significantly
     */
    scrollChanged() {
        const scrollThreshold = 5; // pixels
        return Math.abs(this.pianoRoll.scrollX - this.lastGridScrollX) > scrollThreshold ||
               Math.abs(this.pianoRoll.scrollY - this.lastGridScrollY) > scrollThreshold;
    }
    
    /**
     * Full redraw of the canvas
     */
    fullDraw(now) {
        // Clear canvas
        this.ctx.fillStyle = COLORS.background;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Save context state
        this.ctx.save();
        
        // Apply scroll transform
        this.ctx.translate(-this.pianoRoll.scrollX, -this.pianoRoll.scrollY);
        
        // Draw layers in order
        this.drawGrid();
        this.drawMeasureNumbers();
        this.drawLoopMarkers();
        this.drawNotes();
        this.drawSelectionBox();
        
        // Restore context state
        this.ctx.restore();
        
        // Draw piano keys (not affected by scroll)
        this.drawPianoKeys();
        
        // Draw playhead last so it appears on top
        this.ctx.save();
        this.ctx.translate(-this.pianoRoll.scrollX, -this.pianoRoll.scrollY);
        this.drawPlayhead();
        this.ctx.restore();
        
        // Draw FPS if enabled
        if (this.pianoRoll.showFPS) {
            this.drawFPS();
        }
        
        // Update scroll positions
        this.lastGridScrollX = this.pianoRoll.scrollX;
        this.lastGridScrollY = this.pianoRoll.scrollY;
        
        // Update FPS counter
        this.updateFPS(now);
    }
    
    /**
     * Partial redraw only dirty regions
     */
    partialDraw(now) {
        // For now, just do a full draw
        // TODO: Implement partial redraw based on dirty regions
        this.fullDraw(now);
    }

    /**
     * Draw grid lines with culling optimization
     */
    drawGrid() {
        const startX = Math.max(0, this.pianoRoll.scrollX - VISIBLE_AREA_PADDING);
        const endX = Math.min(this.pianoRoll.totalWidth, 
            this.pianoRoll.scrollX + this.canvas.width + VISIBLE_AREA_PADDING);
        const startY = Math.max(0, this.pianoRoll.scrollY - VISIBLE_AREA_PADDING);
        const endY = Math.min(this.pianoRoll.totalHeight, 
            this.pianoRoll.scrollY + this.canvas.height + VISIBLE_AREA_PADDING);
        
        // Batch vertical lines for better performance
        this.ctx.save();
        
        // Draw beat lines
        this.ctx.strokeStyle = COLORS.grid;
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        
        for (let x = PIANO_KEY_WIDTH; x < endX; x += this.pianoRoll.gridWidth) {
            if (x < startX) continue;
            
            const beatIndex = (x - PIANO_KEY_WIDTH) / this.pianoRoll.gridWidth;
            if (beatIndex % BEATS_PER_MEASURE !== 0) {
                this.ctx.moveTo(x, startY);
                this.ctx.lineTo(x, endY);
            }
        }
        this.ctx.stroke();
        
        // Draw measure lines separately (thicker)
        this.ctx.strokeStyle = '#444';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        
        const measureWidth = this.pianoRoll.gridWidth * BEATS_PER_MEASURE;
        const firstMeasure = Math.floor((startX - PIANO_KEY_WIDTH) / measureWidth);
        const startMeasureX = PIANO_KEY_WIDTH + firstMeasure * measureWidth;
        
        for (let x = startMeasureX; x < endX; x += measureWidth) {
            if (x >= startX) {
                this.ctx.moveTo(x, startY);
                this.ctx.lineTo(x, endY);
            }
        }
        this.ctx.stroke();
        
        this.ctx.restore();
    }

    /**
     * Draw measure numbers
     */
    drawMeasureNumbers() {
        this.ctx.fillStyle = COLORS.text;
        this.ctx.font = '11px Arial';
        this.ctx.textAlign = 'center';
        
        const startMeasure = Math.floor(this.pianoRoll.scrollX / (this.pianoRoll.gridWidth * BEATS_PER_MEASURE));
        const endMeasure = Math.ceil((this.pianoRoll.scrollX + this.canvas.width) / 
            (this.pianoRoll.gridWidth * BEATS_PER_MEASURE));
        
        // Draw measure numbers at the top of the visible area
        const yPosition = this.pianoRoll.scrollY + 12;
        
        for (let measure = startMeasure; measure <= endMeasure; measure++) {
            const x = PIANO_KEY_WIDTH + measure * this.pianoRoll.gridWidth * BEATS_PER_MEASURE;
            this.ctx.fillText((measure + 1).toString(), x + this.pianoRoll.gridWidth * 2, yPosition);
        }
    }

    /**
     * Draw loop markers
     */
    drawLoopMarkers() {
        if (!this.pianoRoll.loopEnabled) return;
        
        const loopStartX = PIANO_KEY_WIDTH + this.pianoRoll.loopStart * this.pianoRoll.gridWidth * BEATS_PER_MEASURE;
        const loopEndX = PIANO_KEY_WIDTH + this.pianoRoll.loopEnd * this.pianoRoll.gridWidth * BEATS_PER_MEASURE;
        
        // Draw loop background
        this.ctx.fillStyle = COLORS.loopBackground;
        this.ctx.fillRect(
            loopStartX,
            0,
            loopEndX - loopStartX,
            this.pianoRoll.totalHeight
        );
        
        // Draw loop markers
        this.ctx.strokeStyle = COLORS.loopMarker;
        this.ctx.lineWidth = 2;
        
        // Start marker
        this.ctx.beginPath();
        this.ctx.moveTo(loopStartX, 0);
        this.ctx.lineTo(loopStartX, this.pianoRoll.totalHeight);
        this.ctx.stroke();
        
        // End marker
        this.ctx.beginPath();
        this.ctx.moveTo(loopEndX, 0);
        this.ctx.lineTo(loopEndX, this.pianoRoll.totalHeight);
        this.ctx.stroke();
        
        // Draw labels with background boxes
        const labelY = this.pianoRoll.scrollY + 20;
        this.ctx.font = 'bold 12px Arial';
        this.ctx.textAlign = 'center';
        
        // A label - offset to the right of the line
        const aLabelX = loopStartX + 15;
        // Draw background box
        this.ctx.fillStyle = 'rgba(34, 34, 34, 0.9)';
        this.ctx.fillRect(aLabelX - 10, labelY - 12, 20, 18);
        // Draw text
        this.ctx.fillStyle = COLORS.loopMarker;
        this.ctx.fillText('A', aLabelX, labelY);
        
        // B label - offset to the left of the line
        const bLabelX = loopEndX - 15;
        // Draw background box
        this.ctx.fillStyle = 'rgba(34, 34, 34, 0.9)';
        this.ctx.fillRect(bLabelX - 10, labelY - 12, 20, 18);
        // Draw text
        this.ctx.fillStyle = COLORS.loopMarker;
        this.ctx.fillText('B', bLabelX, labelY);
    }

    /**
     * Draw all notes with culling and batching
     */
    drawNotes() {
        const viewLeft = this.pianoRoll.scrollX - VISIBLE_AREA_PADDING;
        const viewRight = this.pianoRoll.scrollX + this.canvas.width + VISIBLE_AREA_PADDING;
        const viewTop = this.pianoRoll.scrollY - VISIBLE_AREA_PADDING;
        const viewBottom = this.pianoRoll.scrollY + this.canvas.height + VISIBLE_AREA_PADDING;
        
        // Notes are stored with base grid positions, so we need to convert view bounds back to base coordinates
        const scaleFactor = this.pianoRoll.gridWidth / this.pianoRoll.baseGridWidth;
        
        // Convert screen coordinates to base grid coordinates
        const baseViewLeft = PIANO_KEY_WIDTH + (viewLeft - PIANO_KEY_WIDTH) / scaleFactor;
        const baseViewRight = PIANO_KEY_WIDTH + (viewRight - PIANO_KEY_WIDTH) / scaleFactor;
        
        const startMeasure = Math.floor((baseViewLeft - PIANO_KEY_WIDTH) / (this.pianoRoll.baseGridWidth * BEATS_PER_MEASURE));
        const endMeasure = Math.ceil((baseViewRight - PIANO_KEY_WIDTH) / (this.pianoRoll.baseGridWidth * BEATS_PER_MEASURE));
        
        const visibleNotes = this.pianoRoll.noteManager.getNotesInMeasures(startMeasure, endMeasure, this.pianoRoll.baseGridWidth);
        
        // Group notes by instrument for batch rendering
        const notesByInstrument = new Map();
        
        for (const note of visibleNotes) {
            // Additional culling - skip notes outside vertical view
            if (note.y + note.height < viewTop || note.y > viewBottom) {
                continue;
            }
            
            if (!notesByInstrument.has(note.instrument)) {
                notesByInstrument.set(note.instrument, []);
            }
            notesByInstrument.get(note.instrument).push(note);
        }
        
        // Draw notes grouped by instrument for better batching
        for (const [instrument, notes] of notesByInstrument) {
            // Skip this instrument if it's hidden
            if (this.pianoRoll.trackVisibility.get(instrument) === false) {
                continue;
            }
            
            // Sort notes by position to ensure consistent z-order
            // Notes further to the right and lower down appear on top
            notes.sort((a, b) => {
                if (a.x !== b.x) return a.x - b.x;
                return a.y - b.y;
            });
            
            const instrumentColor = this.pianoRoll.getInstrumentColor(instrument);
            
            // Draw all note bodies of this instrument first
            this.ctx.fillStyle = instrumentColor.note;
            for (const note of notes) {
                if (!this.pianoRoll.noteManager.selectedNotes.has(note)) {
                    const scaledX = PIANO_KEY_WIDTH + (note.x - PIANO_KEY_WIDTH) * scaleFactor;
                    const scaledWidth = note.width * scaleFactor;
                    this.ctx.fillRect(scaledX, note.y, scaledWidth, note.height);
                }
            }
            
            // Then draw borders
            this.ctx.strokeStyle = instrumentColor.border;
            this.ctx.lineWidth = 1;
            for (const note of notes) {
                if (!this.pianoRoll.noteManager.selectedNotes.has(note)) {
                    const scaledX = PIANO_KEY_WIDTH + (note.x - PIANO_KEY_WIDTH) * scaleFactor;
                    const scaledWidth = note.width * scaleFactor;
                    this.ctx.strokeRect(scaledX, note.y, scaledWidth, note.height);
                }
            }
            
            // Draw pipi indicators
            for (const note of notes) {
                if (note.pipi && !this.pianoRoll.noteManager.selectedNotes.has(note)) {
                    const scaledX = PIANO_KEY_WIDTH + (note.x - PIANO_KEY_WIDTH) * scaleFactor;
                    this.ctx.save();
                    this.ctx.fillStyle = '#ffff00';
                    this.ctx.font = 'bold 10px Arial';
                    this.ctx.fillText('P', scaledX + 2, note.y + 10);
                    this.ctx.restore();
                }
            }
            
            // Draw microtonal indicators for 38 EDO
            this.ctx.fillStyle = '#cccccc';
            for (const note of notes) {
                if (!this.pianoRoll.noteManager.selectedNotes.has(note)) {
                    const keyInOctave = note.key % NOTES_PER_OCTAVE;
                    
                    // Check if this is NOT an exact 12-tone match
                    let isExactMatch = false;
                    const exactPositions = [0, 3, 6, 9, 12, 15, 18, 22, 25, 28, 31, 34]; // C, C#, D, D#, E, F, F#, G, G#, A, A#, B
                    for (const edoStep of exactPositions) {
                        if (keyInOctave === edoStep) {
                            isExactMatch = true;
                            break;
                        }
                    }
                    
                    if (!isExactMatch) {
                        // Find the closest 12-tone notes (before and after)
                        let closestLower = -1;
                        let closestUpper = 38;
                        let lowerNote = -1;
                        let upperNote = -1;
                        
                        // Create sorted array of EDO positions
                        const edoPositions = [0, 3, 6, 9, 12, 15, 18, 22, 25, 28, 31, 34]; // C, C#, D, D#, E, F, F#, G, G#, A, A#, B
                        
                        for (let i = 0; i < edoPositions.length; i++) {
                            const edoStep = edoPositions[i];
                            if (edoStep < keyInOctave && edoStep > closestLower) {
                                closestLower = edoStep;
                                lowerNote = i;
                            }
                            if (edoStep > keyInOctave && edoStep < closestUpper) {
                                closestUpper = edoStep;
                                upperNote = i;
                            }
                        }
                        
                        // Handle wrap-around at octave boundary
                        if (closestUpper === 38 && keyInOctave > 35) {
                            closestUpper = 38; // Next C
                            upperNote = 0;
                        }
                        
                        // Determine which 12-tone note we're closest to
                        const distToLower = keyInOctave - closestLower;
                        const distToUpper = closestUpper - keyInOctave;
                        
                        let numArrows = 0;
                        let isUp = false;
                        
                        // Each step in 38 EDO is about 31.58 cents
                        // Show arrows based on distance from nearest 12-tone note
                        // Max 3 arrows to avoid clutter
                        if (distToLower <= distToUpper) {
                            numArrows = Math.min(distToLower, 3);
                            isUp = true; // Sharp from lower note
                        } else {
                            numArrows = Math.min(distToUpper, 3);
                            isUp = false; // Flat from upper note
                        }
                        
                        // Draw arrows
                        if (numArrows > 0) {
                            const scaledX = PIANO_KEY_WIDTH + (note.x - PIANO_KEY_WIDTH) * scaleFactor;
                            const scaledWidth = note.width * scaleFactor;
                            const arrowSpacing = 4;
                            const startX = scaledX + scaledWidth - 8 - (numArrows - 1) * arrowSpacing;
                            const arrowY = note.y + note.height; // Position at bottom of note
                            
                            for (let i = 0; i < numArrows; i++) {
                                const arrowX = startX + i * arrowSpacing;
                                
                                if (!isUp) {
                                    // Down arrow for flat microtones
                                    this.ctx.beginPath();
                                    this.ctx.moveTo(arrowX, arrowY + 3);
                                    this.ctx.lineTo(arrowX - 2, arrowY);
                                    this.ctx.lineTo(arrowX + 2, arrowY);
                                    this.ctx.closePath();
                                    this.ctx.fill();
                                } else {
                                    // Up arrow for sharp microtones
                                    this.ctx.beginPath();
                                    this.ctx.moveTo(arrowX, arrowY);
                                    this.ctx.lineTo(arrowX - 2, arrowY + 3);
                                    this.ctx.lineTo(arrowX + 2, arrowY + 3);
                                    this.ctx.closePath();
                                    this.ctx.fill();
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // Draw selected notes on top
        for (const note of this.pianoRoll.noteManager.selectedNotes) {
            // Skip if track is hidden
            if (this.pianoRoll.trackVisibility.get(note.instrument) === false) {
                continue;
            }
            
            // Scale note position for visibility check
            const scaledX = PIANO_KEY_WIDTH + (note.x - PIANO_KEY_WIDTH) * scaleFactor;
            const scaledWidth = note.width * scaleFactor;
            
            if (scaledX + scaledWidth >= viewLeft && scaledX <= viewRight &&
                note.y + note.height >= viewTop && note.y <= viewBottom) {
                this.drawNote(note);
            }
        }
    }

    /**
     * Draw a single note
     */
    drawNote(note) {
        const isSelected = this.pianoRoll.noteManager.selectedNotes.has(note);
        const isPlaying = this.pianoRoll.playingNotes && this.pianoRoll.playingNotes.has(note);
        
        // Scale note position and width based on current grid width
        const scaleFactor = this.pianoRoll.gridWidth / this.pianoRoll.baseGridWidth;
        const scaledX = PIANO_KEY_WIDTH + (note.x - PIANO_KEY_WIDTH) * scaleFactor;
        const scaledWidth = note.width * scaleFactor;
        
        // Get instrument color
        const instrumentColor = this.pianoRoll.getInstrumentColor(note.instrument);
        
        // Draw note body
        if (isSelected) {
            // Use orange for selected notes
            this.ctx.fillStyle = '#ffa500';
        } else if (isPlaying) {
            this.ctx.fillStyle = instrumentColor.border;
        } else {
            this.ctx.fillStyle = instrumentColor.note;
        }
        
        this.ctx.fillRect(scaledX, note.y, scaledWidth, note.height);
        
        // Draw note border
        if (isSelected) {
            this.ctx.strokeStyle = '#ff8800';
            this.ctx.lineWidth = 2;
        } else {
            this.ctx.strokeStyle = instrumentColor.border;
            this.ctx.lineWidth = 1;
        }
        this.ctx.strokeRect(scaledX, note.y, scaledWidth, note.height);
        
        // Draw velocity indicator (darker = lower velocity)
        // Skip velocity overlay for selected notes to keep orange color clear
        if (!isSelected) {
            const velocityAlpha = 1 - (note.velocity / 127) * 0.6;
            this.ctx.fillStyle = `rgba(0, 0, 0, ${velocityAlpha})`;
            this.ctx.fillRect(scaledX, note.y, scaledWidth, note.height);
        }
        
        // Draw pipi indicator for notes with pipi=true
        if (note.pipi) {
            this.ctx.save();
            // Draw a small "P" indicator in the top-left corner
            this.ctx.fillStyle = isSelected ? '#ffffff' : '#ffff00';
            this.ctx.font = 'bold 10px Arial';
            this.ctx.fillText('P', scaledX + 2, note.y + 10);
            this.ctx.restore();
        }
        
        // Draw microtonal indicator arrows for 38 EDO
        const keyInOctave = note.key % NOTES_PER_OCTAVE;
        
        // Check if this is NOT an exact 12-tone match
        let isExactMatch = false;
        const exactPositions = [0, 3, 6, 9, 12, 15, 18, 22, 25, 28, 31, 34]; // C, C#, D, D#, E, F, F#, G, G#, A, A#, B
        for (const edoStep of exactPositions) {
            if (keyInOctave === edoStep) {
                isExactMatch = true;
                break;
            }
        }
        
        // Debug logging for arrow issues
        if (keyInOctave === 0 || keyInOctave === 3 || keyInOctave === 6 || keyInOctave === 28) {
            console.log(`Note at key ${note.key}, octave position ${keyInOctave}, exact match: ${isExactMatch}`);
        }
        
        if (!isExactMatch) {
            this.ctx.save();
            this.ctx.fillStyle = isSelected ? '#ffffff' : '#cccccc';
            
            // Find the closest 12-tone notes (before and after)
            let closestLower = -1;
            let closestUpper = 38;
            let lowerNote = -1;
            let upperNote = -1;
            
            // Create sorted array of EDO positions
            const edoPositions = [0, 3, 6, 9, 12, 15, 18, 22, 25, 28, 31, 34]; // C, C#, D, D#, E, F, F#, G, G#, A, A#, B
            
            for (let i = 0; i < edoPositions.length; i++) {
                const edoStep = edoPositions[i];
                if (edoStep < keyInOctave && edoStep > closestLower) {
                    closestLower = edoStep;
                    lowerNote = i;
                }
                if (edoStep > keyInOctave && edoStep < closestUpper) {
                    closestUpper = edoStep;
                    upperNote = i;
                }
            }
            
            // Handle wrap-around at octave boundary
            if (closestUpper === 38 && keyInOctave > 35) {
                closestUpper = 38; // Next C
                upperNote = 0;
            }
            
            // Determine which 12-tone note we're closest to
            const distToLower = keyInOctave - closestLower;
            const distToUpper = closestUpper - keyInOctave;
            
            let numArrows = 0;
            let isUp = false;
            
            // Each step in 38 EDO is about 31.58 cents
            // Show arrows based on distance from nearest 12-tone note
            // Max 3 arrows to avoid clutter
            if (distToLower <= distToUpper) {
                numArrows = Math.min(distToLower, 3);
                isUp = true; // Sharp from lower note
            } else {
                numArrows = Math.min(distToUpper, 3);
                isUp = false; // Flat from upper note
            }
            
            // Draw arrows
            if (numArrows > 0) {
                const arrowSpacing = 4;
                const startX = scaledX + scaledWidth - 8 - (numArrows - 1) * arrowSpacing;
                const arrowY = note.y + note.height; // Position at bottom of note
                
                for (let i = 0; i < numArrows; i++) {
                    const arrowX = startX + i * arrowSpacing;
                    
                    if (!isUp) {
                        // Down arrow for flat microtones
                        this.ctx.beginPath();
                        this.ctx.moveTo(arrowX, arrowY + 3);
                        this.ctx.lineTo(arrowX - 2, arrowY);
                        this.ctx.lineTo(arrowX + 2, arrowY);
                        this.ctx.closePath();
                        this.ctx.fill();
                    } else {
                        // Up arrow for sharp microtones
                        this.ctx.beginPath();
                        this.ctx.moveTo(arrowX, arrowY);
                        this.ctx.lineTo(arrowX - 2, arrowY + 3);
                        this.ctx.lineTo(arrowX + 2, arrowY + 3);
                        this.ctx.closePath();
                        this.ctx.fill();
                    }
                }
            }
            this.ctx.restore();
        }
        
        // Draw pan indicator if not centered
        if (Math.abs(note.pan) > 5) {
            this.ctx.save();
            this.ctx.font = '8px Arial';
            this.ctx.fillStyle = '#fff';
            this.ctx.textAlign = note.pan < 0 ? 'left' : 'right';
            const panText = note.pan < 0 ? 'L' : 'R';
            const textX = note.pan < 0 ? scaledX + 2 : scaledX + scaledWidth - 2;
            this.ctx.fillText(panText, textX, note.y + note.height - 2);
            this.ctx.restore();
        }
    }

    /**
     * Draw piano keys with caching
     */
    drawPianoKeys() {
        // Check if we need to redraw piano keys
        const needsRedraw = !this.pianoKeysCache || 
                          this.lastPianoScrollY !== this.pianoRoll.scrollY ||
                          this.pianoKeysCacheInvalid;
        
        if (needsRedraw) {
            this.drawPianoKeysToCache();
        }
        
        // Draw from cache
        if (this.pianoKeysCache) {
            this.ctx.drawImage(this.pianoKeysCache, 0, 0);
        }
        
        this.lastPianoScrollY = this.pianoRoll.scrollY;
        this.pianoKeysCacheInvalid = false;
    }
    
    /**
     * Draw piano keys to cache canvas
     */
    drawPianoKeysToCache() {
        if (!this.pianoKeysCache) {
            this.pianoKeysCache = document.createElement('canvas');
            this.pianoKeysCache.width = PIANO_KEY_WIDTH;
            this.pianoKeysCache.height = this.canvas.height;
        }
        
        if (this.pianoKeysCache.height !== this.canvas.height) {
            this.pianoKeysCache.height = this.canvas.height;
        }
        
        const cacheCtx = this.pianoKeysCache.getContext('2d');
        cacheCtx.clearRect(0, 0, PIANO_KEY_WIDTH, this.canvas.height);
        
        cacheCtx.save();
        cacheCtx.translate(0, -this.pianoRoll.scrollY);
        
        // Draw background
        cacheCtx.fillStyle = '#2a2a2a';
        cacheCtx.fillRect(0, 0, PIANO_KEY_WIDTH, this.pianoRoll.totalHeight);
        
        // Draw keys
        for (let i = 0; i < this.pianoRoll.numKeys; i++) {
            const y = i * NOTE_HEIGHT;
            const keyNumber = this.pianoRoll.numKeys - 1 - i;
            const keyInOctave = keyNumber % NOTES_PER_OCTAVE;
            const octave = Math.floor(keyNumber / NOTES_PER_OCTAVE);
            
            // Find which 12-tone note this 38-EDO step is closest to
            let closestNote = -1;
            let minDistance = 38;
            let isExactMatch = false;
            
            for (const [note, edoStep] of Object.entries(this.twelveToThirtyEightMap)) {
                const distance = Math.abs(keyInOctave - edoStep);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestNote = parseInt(note);
                    isExactMatch = (distance === 0);
                }
            }
            
            // Determine if this is a "black key" equivalent
            const isBlackKey = [1, 3, 6, 8, 10].includes(closestNote);
            
            // Check if key is pressed or hovered
            const isPressed = this.pianoRoll.inputHandler?.pressedKeys.has(keyNumber);
            const isHovered = i === this.pianoRoll.hoveredRow;
            
            // Draw key
            if (isPressed) {
                cacheCtx.fillStyle = '#4a9eff';
            } else if (isHovered) {
                // Highlight hovered key
                cacheCtx.fillStyle = isBlackKey ? '#3a3a3a' : '#5a5a5a';
            } else if (isBlackKey) {
                cacheCtx.fillStyle = COLORS.blackKey;
            } else {
                cacheCtx.fillStyle = COLORS.whiteKey;
            }
            
            cacheCtx.fillRect(0, y, PIANO_KEY_WIDTH - 1, NOTE_HEIGHT);
            
            // Draw key border
            cacheCtx.strokeStyle = COLORS.keyBorder;
            cacheCtx.strokeRect(0, y, PIANO_KEY_WIDTH - 1, NOTE_HEIGHT);
            
            
            
            // Draw note label only for C notes (octave markers)
            if (isExactMatch && closestNote === 0) {
                cacheCtx.fillStyle = '#fff';
                cacheCtx.font = '10px Arial';
                cacheCtx.textAlign = 'right';
                
                const label = `C${octave}`;
                
                cacheCtx.fillText(label, PIANO_KEY_WIDTH - 5, y + NOTE_HEIGHT - 2);
            }
        }
        
        // Draw border
        cacheCtx.strokeStyle = '#555';
        cacheCtx.lineWidth = 1;
        cacheCtx.strokeRect(0, 0, PIANO_KEY_WIDTH, this.pianoRoll.totalHeight);
        
        cacheCtx.restore();
    }

    /**
     * Draw selection box
     */
    drawSelectionBox() {
        const box = this.pianoRoll.inputHandler?.selectionBox;
        if (!box) return;
        
        const x = Math.min(box.x1, box.x2);
        const y = Math.min(box.y1, box.y2);
        const width = Math.abs(box.x2 - box.x1);
        const height = Math.abs(box.y2 - box.y1);
        
        // Different colors for delete selection
        const isDelete = this.pianoRoll.inputHandler?.isDeleteSelecting;
        
        this.ctx.fillStyle = isDelete ? 'rgba(255, 100, 100, 0.2)' : 'rgba(100, 150, 255, 0.2)';
        this.ctx.fillRect(x, y, width, height);
        
        this.ctx.strokeStyle = isDelete ? '#ff6666' : '#6696ff';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(x, y, width, height);
    }

    /**
     * Draw playhead (measure highlight)
     */
    drawPlayhead() {
        if (!this.pianoRoll.isPlaying && !this.pianoRoll.isPaused) return;
        
        const currentMeasure = this.pianoRoll.currentMeasure;
        if (currentMeasure >= 0 && currentMeasure < this.pianoRoll.totalMeasures) {
            const measureWidth = BEATS_PER_MEASURE * this.pianoRoll.gridWidth;
            const measureX = PIANO_KEY_WIDTH + currentMeasure * measureWidth;
            
            // Draw measure highlight
            this.ctx.fillStyle = 'rgba(255, 68, 68, 0.1)';
            this.ctx.fillRect(measureX, this.pianoRoll.scrollY, measureWidth, this.canvas.height);
            
            // Draw measure border
            this.ctx.strokeStyle = 'rgba(255, 68, 68, 0.5)';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(measureX, this.pianoRoll.scrollY, measureWidth, this.canvas.height);
        }
    }

    /**
     * Draw FPS counter
     */
    drawFPS() {
        this.ctx.save();
        this.ctx.fillStyle = '#fff';
        this.ctx.font = '12px Arial';
        this.ctx.textAlign = 'right';
        this.ctx.fillText(`FPS: ${Math.round(this.fps)}`, this.canvas.width - 10, 20);
        this.ctx.restore();
    }

    /**
     * Update FPS calculation
     */
    updateFPS(now) {
        this.frameCount++;
        
        if (now - this.lastFrameTime >= 1000) {
            this.fps = this.frameCount * 1000 / (now - this.lastFrameTime);
            this.frameCount = 0;
            this.lastFrameTime = now;
        }
    }

    /**
     * Adjust color brightness
     */
    adjustBrightness(color, percent) {
        const num = parseInt(color.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = (num >> 16) + amt;
        const G = (num >> 8 & 0x00FF) + amt;
        const B = (num & 0x0000FF) + amt;
        
        return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
            (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
            (B < 255 ? B < 1 ? 0 : B : 255))
            .toString(16).slice(1);
    }

    /**
     * Resize canvas
     */
    resize() {
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        this.fullRedraw = true;
    }
    
    /**
     * Mark for full redraw
     */
    markFullRedraw() {
        this.fullRedraw = true;
    }
}